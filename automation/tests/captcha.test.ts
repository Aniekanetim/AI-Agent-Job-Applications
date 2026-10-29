import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pauseForCaptcha, recordCaptchaRequest, captchaNextAction, resolveCaptcha,
  type CaptchaObservation, type CaptchaResolution } from "../browser/captcha.js";
import { assertCaptchaInspection } from "../browser/captcha-inspection.js";
import { decideBrowser, saveUploadHandoff } from "../browser/fallback.js";
import { selectBrowser } from "../browser/preferences.js";
import { assertTaskMove, canMarkApplied, markSubmissionAttempted, type ApplicationTask } from "../workflow/application-state.js";
import { alertFixture, bindFixture, writeFixture } from "./email-fixture.js";
import { readTaskRecord, taskRecordBlock, verifyAlertCompletion } from "../email/verification.js";
import { cleanupCompletedAlert } from "../email/cleanup.js";
import { classifyMessage } from "../email/intake.js";
import { loadInboxState, saveEmailRecord } from "../email/state-store.js";
import { saveAlertArtifact } from "../email/artifact-store.js";
import { evidenceFile } from "../email/evidence.js";
import { readySite } from "./sites-fixture.js";

const now = "2026-10-26T08:00:00.000Z", later = "2026-10-26T08:05:00.000Z";
const jobUrl = "https://employer.example.invalid/jobs/synthetic-qa/apply";
const task = (): ApplicationTask => ({ taskId: "APP-synthetic-captcha", originalIntake: "Email Alerts",
  selectedRoleId: "synthetic-qa", cvVersion: "synthetic-v1", cvSha256: "a".repeat(64), checkpoint: "prepared",
  browserExecution: { defaultBrowser: "inApp", activeBrowser: "playwright", requiresFileUpload: true, handoffs: [] } });
const observation = (): CaptchaObservation => ({ handoffId: "synthetic-challenge-1", jobUrl,
  sessionReference: "synthetic-task-browser", sessionAccess: "visible", draftReference: "synthetic-draft",
  checkpointReference: ".local/synthetic-checkpoint.md", evidenceReference: ".local/synthetic-challenge.md",
  accessContextPath: "Site Architecture Context/Example/architecture.local.md", lastCompletedStep: "Review form", observedAt: now });
const blocked = () => pauseForCaptcha(task(), observation());
const resolution = (): CaptchaResolution => ({ handoffId: observation().handoffId, taskId: task().taskId, jobUrl,
  browser: "playwright", sessionReference: observation().sessionReference, sameVacancyVerified: true, sessionVerified: true,
  observedAt: later, evidenceReference: ".local/synthetic-clearance.md", submissionEvidenceReference: ".local/synthetic-not-submitted.md",
  outcome: "notSubmitted", humanCompletionReference: "synthetic-user-handoff", challengeCleared: true,
  sessionVisible: true, fieldsReviewed: true, cvChecked: true, recovery: "sameSession", draftReference: observation().draftReference });

test("CAPTCHA pauses either intake immediately and preserves candidate/browser/task identity", () => {
  for (const originalIntake of ["Email Alerts", "To Do"] as const) {
    const original = { ...task(), originalIntake }, paused = pauseForCaptcha(original, observation());
    assert.deepEqual(paused.browserExecution, original.browserExecution);
    assert.equal(paused.taskId, original.taskId); assert.equal(paused.cvSha256, original.cvSha256);
    assert.equal(paused.checkpoint, "prepared"); assert.equal(paused.originalIntake, originalIntake);
    assert.equal(original.captchaHandoffs, undefined);
    assert.doesNotThrow(() => assertTaskMove(paused, originalIntake, "Blocked"));
    assert.equal(captchaNextAction(paused), "reportOnce");
  }
});

test("an absent user leaves the persisted task waiting without repeated requests or timestamp changes", t => {
  const f = alertFixture(t, 1);
  const paused = recordCaptchaRequest(blocked(), observation().handoffId, "synthetic-ticket-comment", now);
  const ref = writeFixture(f.root, ".local/paused-task.json", paused), before = readFileSync(resolve(f.root, ref.path));
  const reloaded: ApplicationTask = JSON.parse(before.toString());
  for (let i = 0; i < 10; i++) {
    assert.equal(captchaNextAction(reloaded), "wait");
    assert.equal(recordCaptchaRequest(reloaded, observation().handoffId, "another-request", later), reloaded);
    assert.equal(pauseForCaptcha(reloaded, { ...observation(), observedAt: later }), reloaded);
  }
  assert.deepEqual(readFileSync(resolve(f.root, ref.path)), before);
  assert.equal(captchaNextAction(reloaded, true), "humanHandoff");
  assert.equal(captchaNextAction(reloaded, true, "unavailable"), "recoverSession");
});

test("CAPTCHA prevents a browser fallback, submission and forged Applied/Blocked resumption", () => {
  const paused = blocked(), prefs = selectBrowser("inApp", "synthetic-choice", now);
  assert.equal(decideBrowser(paused, prefs, { inApp: true, playwright: true }, false).action, "blocked");
  assert.throws(() => markSubmissionAttempted(paused));
  assert.throws(() => saveUploadHandoff({ ...paused, browserExecution: { ...paused.browserExecution!, activeBrowser: "inApp" } }, jobUrl, "checkpoint", now));
  assert.equal(canMarkApplied({ ...paused, checkpoint: "confirmed", confirmation: { reference: "forged", observedAt: now } }), false);
  const forged = structuredClone(paused); forged.blocker!.resolvedAt = later; forged.blocker!.resolutionEvidence = "flag-only";
  assert.throws(() => assertTaskMove(forged, "Blocked", "Email Alerts"));
});

test("a readiness reply alone, a different task/browser/session and stale evidence cannot clear CAPTCHA", () => {
  const checks = resolution();
  for (const change of [{ taskId: "other" }, { handoffId: "old" }, { jobUrl: `${jobUrl}-other` },
    { browser: "inApp" }, { sessionReference: "other-session" }, { observedAt: "2026-10-25T00:00:00Z" },
    { humanCompletionReference: "" }, { challengeCleared: false }, { sessionVisible: false },
    { fieldsReviewed: false }, { cvChecked: false }, { sameVacancyVerified: false }, { sessionVerified: false },
    { submissionEvidenceReference: "" }, { outcome: "unknown" }]) {
    assert.throws(() => resolveCaptcha(blocked(), { ...checks, ...change } as CaptchaResolution));
  }
  for (const change of [{ selectedRoleId: "other-role" }, { cvVersion: "other-cv" }, { cvSha256: "b".repeat(64) }]) {
    assert.throws(() => resolveCaptcha({ ...blocked(), ...change }, checks));
  }
  assert.equal(blocked().captchaHandoffs![0].state, "awaitingHuman");
});

test("human completion resumes after user requeue in To Do and requires a fresh form review before submit", t => {
  const resumed = resolveCaptcha(blocked(), resolution());
  assert.equal(resumed.checkpoint, "working"); assert.equal(resumed.captchaHandoffs![0].state, "resolved");
  assert.doesNotThrow(() => assertTaskMove(resumed, "Blocked", "To Do"));
  assert.throws(() => assertTaskMove(resumed, "Blocked", "Applied"));
  assert.throws(() => markSubmissionAttempted(resumed));
  const site = readySite(t, { ...resumed, checkpoint: "prepared" });
  assert.equal(markSubmissionAttempted(site.task, site.root, site.page).checkpoint, "submissionAttempted");
  assert.throws(() => markSubmissionAttempted({ ...resumed, taskId: "", checkpoint: "prepared" }));
  assert.equal(canMarkApplied(resumed), false);
});

test("headless/unavailable sessions require an actual accessible same-browser draft recovery", () => {
  for (const sessionAccess of ["headless", "unavailable"] as const) {
    const paused = recordCaptchaRequest(pauseForCaptcha(task(), { ...observation(), sessionAccess }), observation().handoffId, "synthetic-comment", now);
    assert.equal(captchaNextAction(paused), "wait"); assert.equal(captchaNextAction(paused, true), "recoverSession");
    assert.throws(() => resolveCaptcha(paused, { ...resolution(), sessionReference: "restored", recovery: "restoredDraft" } as CaptchaResolution));
    const resumed = resolveCaptcha(paused, { ...resolution(), outcome: "notSubmitted", sessionReference: "restored",
      humanCompletionReference: "actual-synthetic-human-step", challengeCleared: true, sessionVisible: true, fieldsReviewed: true, cvChecked: true,
      recovery: "restoredDraft", draftReference: "restored-draft", recoveryEvidenceReference: ".local/restoration.md" });
    assert.equal(resumed.browserExecution!.activeBrowser, "playwright"); assert.equal(resumed.taskId, task().taskId);
  }
});

test("an expired/new CAPTCHA keeps its own history and must be completed again", () => {
  const first = resolveCaptcha(blocked(), resolution());
  assert.throws(() => pauseForCaptcha(first, observation()));
  const next = pauseForCaptcha(first, { ...observation(), handoffId: "challenge-2", observedAt: later });
  assert.equal(next.captchaHandoffs!.length, 2); assert.equal(next.captchaHandoffs![0].state, "resolved");
  assert.throws(() => markSubmissionAttempted({ ...next, checkpoint: "prepared" }));
  assert.throws(() => resolveCaptcha(next, resolution()));
});

test("a CAPTCHA after Submit preserves uncertainty and can finish from an actual receipt without resubmission", () => {
  const paused = recordCaptchaRequest(pauseForCaptcha({ ...task(), checkpoint: "submissionAttempted" }, observation()), observation().handoffId, "synthetic-comment", now);
  assert.equal(paused.checkpoint, "submissionAttempted"); assert.equal(captchaNextAction(paused), "inspectOutcome");
  assert.equal(decideBrowser(paused, selectBrowser("playwright", "synthetic-choice", now), { playwright: true, inApp: true }, true).action, "resolveOutcome");
  assert.throws(() => markSubmissionAttempted(paused));
  const completed = resolveCaptcha(paused, { ...resolution(), outcome: "confirmed", confirmation: { reference: "synthetic-existing-receipt", observedAt: now } });
  assert.equal(completed.checkpoint, "confirmed"); assert.equal(canMarkApplied(completed), true);
  assert.doesNotThrow(() => assertTaskMove(completed, "Blocked", "To Do"));
  assert.doesNotThrow(() => assertTaskMove(completed, "To Do", "Applied"));
});

test("an explicit not-submitted result permits recovery of an interrupted submit but never a blind retry", () => {
  const paused = pauseForCaptcha({ ...task(), checkpoint: "submissionAttempted" }, observation());
  const recovered = resolveCaptcha(paused, resolution());
  assert.equal(recovered.checkpoint, "working"); assert.equal(recovered.confirmation, undefined);
  assert.throws(() => markSubmissionAttempted(recovered));
});

test("a different unresolved dependency is preserved instead of silently replaced by CAPTCHA", () => {
  const original = task(); original.blocker = { reason: "Missing required factual answer", lastCompletedStep: "Questions",
    contextPath: "answers.local.md", nextAction: "Provide answer", resumeCheckpoint: "questions" };
  assert.throws(() => pauseForCaptcha(original, observation()));
  assert.equal(original.blocker.reason, "Missing required factual answer");
});

test("one blocked CAPTCHA vacancy retains a four-job alert; resumption preserves three siblings and cleans up once", async t => {
  const f = alertFixture(t, 1), identity = { ...f.identity, messageId: "synthetic-captcha-alert" };
  const record = bindFixture(f.root, classifyMessage({ ...identity, from: "alerts@example.invalid", timestamp: now },
    "jobAlert", "v1", "synthetic-rule", "synthetic-source", now), 4);
  const v = record.vacancies[3], originalAppliedPath = v.taskPath!;
  const bound = readTaskRecord(readFileSync(resolve(f.root, originalAppliedPath)));
  bound.task = pauseForCaptcha({ ...bound.task, checkpoint: "prepared", confirmation: undefined, browserExecution: task().browserExecution },
    { ...observation(), jobUrl: v.postingUrl! });
  v.taskPath = `Task Board/Blocked/${bound.task.taskId}-captcha.md`;
  v.taskEvidence = writeFixture(f.root, v.taskPath, taskRecordBlock(bound));
  v.disposition = "blocked"; v.applicationRecordSaved = false; v.confirmationReference = null;
  saveEmailRecord(f.root, record, loadInboxState(f.root).revision);
  const siblings = JSON.stringify(record.vacancies.slice(0, 3));
  let cleanupCalls = 0;
  const options = { ...f.options, identity, now: later, verifyPersistence: async () => true, transport: {
    source: identity.source, listPage: async () => ({ messages: [] }), readMessage: async () => { throw new Error(); },
    applyCleanup: async () => { cleanupCalls++; return { evidenceReference: "synthetic-cleanup", observedAt: later }; },
  } };
  await assert.rejects(cleanupCompletedAlert(options)); assert.equal(cleanupCalls, 0);
  assert.equal(JSON.stringify(record.vacancies.slice(0, 3)), siblings);
  // A persisted caller-supplied confirmation cannot hide the pending challenge on the bound ticket.
  const forged = structuredClone(bound); forged.task.checkpoint = "confirmed";
  forged.task.confirmation = { reference: "forged", observedAt: later };
  v.taskEvidence = saveAlertArtifact(f.root, identity, v.taskPath!, Buffer.from(taskRecordBlock(forged)), v.taskEvidence!.sha256);
  assert.equal(canMarkApplied(forged.task), false);
  // Human completion and fresh review restore the original vacancy, role, CV and task ID.
  const restored = resolveCaptcha(bound.task, { ...resolution(), taskId: bound.task.taskId, jobUrl: v.postingUrl! });
  const site = readySite(t, { ...restored, checkpoint: "prepared" }, v.postingUrl!, f.root);
  const attempted = markSubmissionAttempted(site.task, site.root, site.page);
  const rawOutcome = JSON.parse(readFileSync(resolve(f.root, v.outcomeEvidence!.path), "utf8"));
  bound.task = { ...attempted, checkpoint: "confirmed", confirmation: { reference: rawOutcome.confirmationReference, observedAt: rawOutcome.observedAt } };
  v.taskPath = originalAppliedPath;
  v.taskEvidence = undefined;
  saveEmailRecord(f.root, record, loadInboxState(f.root).revision);
  v.taskEvidence = saveAlertArtifact(f.root, identity, originalAppliedPath, Buffer.from(taskRecordBlock(bound)), evidenceFile(f.root, originalAppliedPath).sha256);
  v.disposition = "applied"; v.applicationRecordSaved = true; v.confirmationReference = rawOutcome.confirmationReference;
  saveEmailRecord(f.root, record, loadInboxState(f.root).revision);
  assert.equal(verifyAlertCompletion(f.root, record).applied, 4);
  assert.equal((await cleanupCompletedAlert(options)).state, "complete");
  assert.equal((await cleanupCompletedAlert(options)).state, "complete");
  assert.equal(cleanupCalls, 1); assert.equal(JSON.stringify(record.vacancies.slice(0, 3)), siblings);
});

test("an expected CAPTCHA cannot be treated as cleared from a missing widget or an unknown state", () => {
  for (const state of ["humanRequired", "unknown", "notObserved"] as const) assert.throws(() => assertCaptchaInspection({ state, provider: "hcaptcha" }, true));
  assert.doesNotThrow(() => assertCaptchaInspection({ state: "cleared", provider: "hcaptcha" }, true));
  assert.doesNotThrow(() => assertCaptchaInspection({ state: "notObserved", provider: null }, false));
});
