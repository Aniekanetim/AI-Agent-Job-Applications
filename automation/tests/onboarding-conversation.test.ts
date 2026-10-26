import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve, dirname, relative, isAbsolute } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createProgress, configureProgress, emptyCheck, readiness, migrateProgress } from "../onboarding/progress.js";
import { loadProgress, saveProgress, digest, completedCheck } from "../onboarding/state-store.js";
import { queueQuestions, nextQuestion, recordQuestionPresented, recordRoadmapShown, setConversationMode, deferQuestion,
  clarifyQuestion, recoverUnshownQuestion, reconcileStagedResponse, applyResponse, conversationSummary, type ResponseBundle } from "../onboarding/conversation.js";
import { readPrivateJson } from "../workflow/private-json.js";
import type { Decision, FocusedQuestion } from "../onboarding/conversation-types.js";
import { saveBrowserPreferences } from "../browser/preferences-store.js";
import { selectBrowser } from "../browser/preferences.js";

const now = "2026-10-26T10:00:00Z", later = "2026-10-26T10:05:00Z";
const qa = "Job Context/Candidate/Role Profiles/QA/job-preferences.local.md";
const support = "Job Context/Candidate/Role Profiles/Support/job-preferences.local.md";
function sandbox(t: TestContext) {
  const root = fs.mkdtempSync(join(tmpdir(), "focused-onboarding-"));
  execFileSync("git", ["init", "--quiet", root], { windowsHide: true });
  fs.writeFileSync(join(root, ".gitignore"), ".local/\n**/*.local.md\n");
  const write = (path: string, content: string) => { fs.mkdirSync(dirname(resolve(root, path)), { recursive: true }); fs.writeFileSync(resolve(root, path), content); };
  write("Job Context/Candidate/role-routing.local.md", "| Role ID | Profile path relative to Candidate | Enabled |\n|---|---|---|\n| qa | Role Profiles/QA | Yes |\n| support | Role Profiles/Support | Yes |\n");
  write(qa, "# QA preferences\nUnrelated fact: preserve this.\n"); write(support, "# Support preferences\n");
  t.after(() => { const part = relative(tmpdir(), resolve(root)); assert.ok(part && !part.startsWith("..") && !isAbsolute(part)); fs.rmSync(root, { recursive: true }); });
  return { root, write };
}
const decision = (id: string, contextPath = qa, roleId: string | null = "qa"): Decision => ({ id, step: "applicationInstructions", substep: id, roleId, contextPath, field: id });
const question = (id: string, required = true): Omit<FocusedQuestion, "status" | "askedAt"> => ({ ...decision(id), prompt: `What should I record for ${id}?`, required });
function response(root: string, id: string, decisions: Decision[], contents: Record<string, string>): ResponseBundle {
  return { schemaVersion: 1, id, sourceReference: `synthetic-user-message-${id}`, observedAt: later,
    answers: decisions.map(d => ({ decision: d, kind: "answer" })),
    writes: Object.entries(contents).map(([path, content]) => ({ path, content, expectedSha256: fs.existsSync(resolve(root, path)) ? digest(fs.readFileSync(resolve(root, path))) : null })), references: [] };
}
function ask(root: string) {
  const result = nextQuestion(root); assert.equal(result.next.action, "present");
  if (result.next.action === "present") recordQuestionPresented(root, result.next.question.id, "synthetic-actual-prompt", now);
  return result;
}

test("one global question focus is shared across candidate and connection subflows", t => {
  const { root } = sandbox(t);
  queueQuestions(root, [question("work-setting"), { ...decision("browser", ".local/browser-preferences.json", null),
    step: "boardSelection", prompt: "Which browser should I use?", required: true }]);
  const first = ask(root), before = fs.readFileSync(resolve(root, ".local/onboarding-state.json"));
  assert.equal(nextQuestion(root).next.action, "wait");
  assert.equal(nextQuestion(root).state.conversation!.activeQuestionId, "work-setting");
  assert.deepEqual(fs.readFileSync(resolve(root, ".local/onboarding-state.json")), before);
  assert.equal(first.next.action, "present");
  assert.throws(() => recordQuestionPresented(root, "browser", "wrong-subflow-prompt", now));
});

test("ten volunteered answers are saved once and later stages ask only the eleventh missing decision", t => {
  const { root } = sandbox(t), decisions = Array.from({ length: 10 }, (_, i) => decision(`field-${i + 1}`));
  queueQuestions(root, [question("field-1")]); ask(root);
  const content = "# QA preferences\nUnrelated fact: preserve this.\n" + decisions.map((d, i) => `${d.field}: synthetic-value-${i + 1}`).join("\n");
  const bundle = response(root, "ten-answers", decisions, { [qa]: content });
  applyResponse(root, bundle);
  const state = queueQuestions(root, [...decisions.map(d => ({ ...d, prompt: `What should I record for ${d.id}?`, required: true })), question("field-11")]);
  assert.equal(state.conversation!.answers.length, 10);
  assert.equal(state.conversation!.questions.filter(q => q.status === "answered").length, 10);
  const next = nextQuestion(root).next;
  assert.equal(next.action, "present"); if (next.action === "present") assert.equal(next.question.id, "field-11");
  assert.equal(fs.readFileSync(resolve(root, qa), "utf8"), content);
  assert.equal(JSON.stringify(loadProgress(root).state).includes("synthetic-value-"), false);
  assert.equal(fs.existsSync(resolve(root, ".local/onboarding-pending-response.json")), false);
  const before = fs.readFileSync(resolve(root, qa)); applyResponse(root, bundle); assert.deepEqual(fs.readFileSync(resolve(root, qa)), before);
});

test("an interrupted prompt presentation is inspected before any retry of that same question", t => {
  const { root } = sandbox(t); queueQuestions(root, [question("current"), question("future")]);
  const first = nextQuestion(root).next; assert.equal(first.action, "present");
  const before = fs.readFileSync(resolve(root, ".local/onboarding-state.json"));
  assert.equal(nextQuestion(root).next.action, "verifyPresentation");
  assert.deepEqual(fs.readFileSync(resolve(root, ".local/onboarding-state.json")), before);
  recoverUnshownQuestion(root, "current", "synthetic-host-confirmed-not-shown", now);
  const retry = nextQuestion(root).next; assert.equal(retry.action, "present");
  if (retry.action === "present") assert.equal(retry.question.id, "current");
  recordQuestionPresented(root, "current", "synthetic-actual-prompt", now);
  assert.throws(() => recoverUnshownQuestion(root, "current", "not-a-new-observation", later));
  assert.equal(nextQuestion(root).next.action, "wait");
});

test("answers for future steps do not falsely resolve the current question", t => {
  const { root } = sandbox(t); queueQuestions(root, [question("current"), question("later")]); ask(root);
  applyResponse(root, response(root, "future-answer", [decision("later")], { [qa]: "# QA\nlater: synthetic-value\n" }));
  assert.equal(nextQuestion(root).next.action, "wait");
  const c = loadProgress(root).state.conversation!;
  assert.equal(c.activeQuestionId, "current"); assert.equal(c.questions[1].status, "answered");
});

test("an ambiguous answer gets one focused clarification while the original prompt and clear answers survive", t => {
  const { root } = sandbox(t); queueQuestions(root, [question("salary"), question("notice")]); ask(root);
  applyResponse(root, response(root, "partial", [decision("notice")], { [qa]: "# QA\nnotice: synthetic-two-weeks\n" }));
  clarifyQuestion(root, "salary", "Which currency should I use for that minimum pay?", "synthetic-ambiguous-reply", later);
  const next = nextQuestion(root).next;
  assert.equal(next.action, "present"); if (next.action === "present") assert.match(next.question.prompt, /^Which currency/);
  recordQuestionPresented(root, "salary", "synthetic-clarification-prompt", later);
  assert.equal(nextQuestion(root).next.action, "wait");
  const q = loadProgress(root).state.conversation!.questions[0];
  assert.equal(q.prompt, question("salary").prompt); assert.equal(q.clarifications!.length, 1);
  assert.equal(loadProgress(root).state.conversation!.answers[0].id, "notice");
});

test("pause survives reload and volunteered answers without resuming prompts or changing a schedule", t => {
  const { root, write } = sandbox(t); queueQuestions(root, [question("remote"), question("notice")]); ask(root);
  write(".local/operation-preferences.json", '{"scheduleReference":"synthetic-existing-schedule"}');
  const schedule = fs.readFileSync(resolve(root, ".local/operation-preferences.json"));
  setConversationMode(root, "paused", "synthetic-user-pause", now);
  const before = fs.readFileSync(resolve(root, ".local/onboarding-state.json"));
  assert.equal(nextQuestion(root).next.action, "paused"); assert.deepEqual(fs.readFileSync(resolve(root, ".local/onboarding-state.json")), before);
  applyResponse(root, response(root, "volunteered-while-paused", [decision("notice")], { [qa]: "# QA\nnotice: synthetic-value\n" }));
  assert.equal(nextQuestion(root).next.action, "paused");
  setConversationMode(root, "active", "synthetic-user-resume", later);
  assert.equal(nextQuestion(root).next.action, "wait"); assert.equal(nextQuestion(root, true).next.action, "repeatOnRequest");
  assert.deepEqual(fs.readFileSync(resolve(root, ".local/operation-preferences.json")), schedule);
});

test("role binding prevents answers leaking into another profile or an unbound role file", t => {
  const { root } = sandbox(t), original = fs.readFileSync(resolve(root, support));
  assert.throws(() => applyResponse(root, response(root, "wrong-role", [decision("remote", support, "qa")], { [support]: "Wrong role content" })));
  assert.throws(() => applyResponse(root, response(root, "unbound-role", [decision("remote", qa, null)], { [qa]: "Unbound content" })));
  const state = applyResponse(root, response(root, "two-roles", [decision("qa-remote"), decision("support-hours", support, "support")], {
    [qa]: "# QA\nremote: synthetic-remote-only\n", [support]: "# Support\nhours: synthetic-support-hours\n" }));
  assert.deepEqual(state.conversation!.answers.map(a => a.roleId), ["qa", "support"]);
  assert.notDeepEqual(fs.readFileSync(resolve(root, support)), original);
});

test("a revision preserves answer history and invalidates only affected preparation", t => {
  const { root, write } = sandbox(t); applyResponse(root, response(root, "initial", [decision("remote")], { [qa]: "# QA\nremote: synthetic-remote-only\nUnrelated fact: preserve this.\n" }));
  const loaded = loadProgress(root); write(".local/browser-proof.md", "Synthetic independent tooling evidence");
  loaded.state.steps.applicationInstructions = completedCheck(root, [qa], now);
  loaded.state.steps.browserTools = completedCheck(root, [".local/browser-proof.md"], now);
  saveProgress(root, loaded.state, loaded.revision);
  const bundle = response(root, "correction", [decision("remote")], { [qa]: "# QA\nremote: synthetic-hybrid\nUnrelated fact: preserve this.\n" });
  assert.throws(() => applyResponse(root, bundle)); bundle.answers[0].kind = "correction";
  const state = applyResponse(root, bundle);
  assert.equal(state.conversation!.answers.length, 2); assert.equal(state.steps.applicationInstructions.status, "inProgress");
  assert.equal(state.steps.browserTools.status, "complete"); assert.match(fs.readFileSync(resolve(root, qa), "utf8"), /Unrelated fact: preserve this/);
});

test("optional deferral is explicit and required questions cannot be silently skipped", t => {
  const { root } = sandbox(t); queueQuestions(root, [question("required"), question("optional", false)]);
  assert.throws(() => deferQuestion(root, "required", "synthetic-skip"));
  const state = deferQuestion(root, "optional", "synthetic-user-later");
  assert.equal(state.conversation!.questions[1].status, "deferred"); assert.equal(readiness(state).ready, false);
});

test("an interrupted multi-file save retains the complete reply and recovers without asking again", t => {
  const { root } = sandbox(t); queueQuestions(root, [question("qa-answer")]); ask(root);
  const bundle = response(root, "interrupted", [decision("qa-answer"), decision("support-answer", support, "support")], {
    [qa]: "# QA\nsynthetic-answer-qa\n", [support]: "# Support\nsynthetic-answer-support\n" });
  const rename = fs.renameSync;
  try {
    fs.renameSync = ((from, to) => { if (String(to).replaceAll("\\", "/").includes("/Support/")) throw new Error("Synthetic write failure"); return rename(from, to); }) as typeof fs.renameSync;
    syncBuiltinESMExports(); assert.throws(() => applyResponse(root, bundle));
  } finally { fs.renameSync = rename; syncBuiltinESMExports(); }
  assert.match(fs.readFileSync(resolve(root, qa), "utf8"), /synthetic-answer-qa/);
  assert.equal(loadProgress(root).state.conversation!.answers.length, 0);
  assert.equal(nextQuestion(root).next.action, "recoverResponse");
  assert.equal(readPrivateJson(root, ".local/onboarding-pending-response.json").data !== null, true);
  const recovered = applyResponse(root); assert.equal(recovered.conversation!.answers.length, 2);
  assert.equal(fs.existsSync(resolve(root, ".local/onboarding-pending-response.json")), false);
  assert.match(fs.readFileSync(resolve(root, support), "utf8"), /synthetic-answer-support/);
});

test("missing/changed canonical references and stale proposals cannot resolve a question", t => {
  const { root, write } = sandbox(t); queueQuestions(root, [question("answer")]); ask(root);
  const bundle = response(root, "stale", [decision("answer")], { [qa]: "# QA\nproposed\n" });
  write(qa, "# QA\nNewer independent information\n");
  assert.throws(() => applyResponse(root, bundle)); assert.equal(loadProgress(root).state.conversation!.answers.length, 0);
  const refs = { ...bundle, writes: [], references: [{ path: qa, sha256: "a".repeat(64) }] };
  assert.throws(() => applyResponse(root, refs)); assert.equal(nextQuestion(root).next.action, "wait");
});

test("a conflicting interrupted reply can be reconciled without dropping newer context or re-asking", t => {
  const { root, write } = sandbox(t); queueQuestions(root, [question("answer")]); ask(root);
  const bundle = response(root, "conflicted-response", [decision("answer")], { [qa]: "# QA\nUnrelated fact: preserve this.\nanswer: synthetic-saved\n" });
  const rename = fs.renameSync;
  try {
    fs.renameSync = ((from, to) => { if (String(to).endsWith("onboarding-state.json")) throw new Error("Synthetic progress interruption"); return rename(from, to); }) as typeof fs.renameSync;
    syncBuiltinESMExports(); assert.throws(() => applyResponse(root, bundle));
  } finally { fs.renameSync = rename; syncBuiltinESMExports(); }
  write(qa, bundle.writes[0].content + "New independent information: keep it.\n");
  assert.throws(() => applyResponse(root));
  const rebased = structuredClone(bundle); rebased.writes[0].expectedSha256 = digest(fs.readFileSync(resolve(root, qa)));
  rebased.writes[0].content = fs.readFileSync(resolve(root, qa), "utf8");
  assert.throws(() => reconcileStagedResponse(root, { ...rebased, sourceReference: "different-reply" }, "synthetic-review"));
  reconcileStagedResponse(root, rebased, "synthetic-conflict-review");
  const recovered = applyResponse(root);
  assert.equal(recovered.conversation!.answers.length, 1); assert.equal(recovered.conversation!.activeQuestionId, null);
  assert.match(fs.readFileSync(resolve(root, qa), "utf8"), /New independent information: keep it/);
});

test("failure after canonical saves but before progress persistence recovers the same response", t => {
  const { root } = sandbox(t); queueQuestions(root, [question("answer")]); ask(root);
  const bundle = response(root, "metadata-interruption", [decision("answer")], { [qa]: "# QA\nUnrelated fact: preserve this.\nanswer: synthetic-saved\n" });
  const rename = fs.renameSync;
  try {
    fs.renameSync = ((from, to) => { if (String(to).endsWith("onboarding-state.json")) throw new Error("Synthetic progress-save interruption"); return rename(from, to); }) as typeof fs.renameSync;
    syncBuiltinESMExports(); assert.throws(() => applyResponse(root, bundle));
  } finally { fs.renameSync = rename; syncBuiltinESMExports(); }
  assert.match(fs.readFileSync(resolve(root, qa), "utf8"), /synthetic-saved/);
  assert.equal(loadProgress(root).state.conversation!.answers.length, 0);
  const recovered = applyResponse(root);
  assert.equal(recovered.conversation!.answers.length, 1); assert.equal(recovered.conversation!.questions[0].status, "answered");
});

test("reconciling an already supplied legacy answer preserves its original question without asking it", t => {
  const { root, write } = sandbox(t), state = createProgress();
  write(qa, "# QA preferences\nUnrelated fact: preserve this.\nlegacy-answer: synthetic-original-value\n");
  const original = { id: "legacy-answer", question: "Original synthetic question", extra: "preserve" };
  state.pendingQuestions.push(original); saveProgress(root, state, null);
  const result = applyResponse(root, { schemaVersion: 1, id: "legacy-reconcile", sourceReference: "synthetic-original-source", observedAt: now,
    answers: [{ decision: decision("legacy-answer"), kind: "answer" }], writes: [], references: [{ path: qa, sha256: digest(fs.readFileSync(resolve(root, qa))) }] });
  assert.equal(result.pendingQuestions.length, 0); assert.equal(result.conversation!.activeQuestionId, null);
  assert.deepEqual(result.conversation!.legacyResolutions![0].question, original);
});

test("new conversation metadata preserves legacy completion, pending questions and custom state", t => {
  const { root } = sandbox(t); const state = configureProgress(createProgress(), "profileSetup", [], now);
  state.selectedRoles = [{ roleId: "qa" }];
  state.steps.candidateProfiles = completedCheck(root, [qa], now); state.steps.applicationInstructions = completedCheck(root, [qa], now);
  state.steps.readiness = completedCheck(root, [qa], now); state.phase = "complete";
  const { conversation: _, ...legacy } = state;
  const migrated = migrateProgress({ ...legacy, customCheckpoint: { preserve: true } }, later);
  assert.equal(migrated.phase, "complete"); assert.equal(readiness(migrated).ready, true); assert.deepEqual(migrated.customCheckpoint, { preserve: true });
  const withQuestion = { ...legacy, phase: "waitingForUser", pendingQuestions: [{ id: "legacy-question", askedAt: now, custom: "keep" }] };
  fs.mkdirSync(resolve(root, ".local"), { recursive: true });
  fs.writeFileSync(resolve(root, ".local/onboarding-state.json"), JSON.stringify(withQuestion));
  const q = queueQuestions(root, [question("legacy-question")]).conversation!.questions[0];
  assert.deepEqual(q.legacy, withQuestion.pendingQuestions[0]); assert.equal(nextQuestion(root).next.action, "wait");
});

test("profile-only scope rejects browser/email questions and brief progress separates saved answers from readiness", t => {
  const { root } = sandbox(t); const state = configureProgress(createProgress(), "profileSetup", [], now); saveProgress(root, state, null);
  assert.throws(() => queueQuestions(root, [{ ...decision("browser", ".local/browser-preferences.json", null), prompt: "Which browser?", required: true }]));
  queueQuestions(root, [question("remote")]); recordRoadmapShown(root);
  const text = conversationSummary(nextQuestion(root).state);
  assert.match(text, /step 2 of 3/); assert.match(text, /separate checks/);
  assert.equal(loadProgress(root).state.conversation!.roadmapShown, true);
});

test("existing settings utilities save volunteered choices without falsely verifying browser access", t => {
  const { root } = sandbox(t), d = { ...decision("browser", ".local/browser-preferences.json", null), step: "boardSelection" as const };
  saveBrowserPreferences(root, selectBrowser("inApp", "synthetic-user-response", now), null);
  const state = applyResponse(root, { schemaVersion: 1, id: "browser-answer", sourceReference: "synthetic-user-response", observedAt: now,
    answers: [{ decision: d, kind: "answer" }], writes: [], references: [{ path: d.contextPath, sha256: digest(fs.readFileSync(resolve(root, d.contextPath))) }] });
  assert.equal(state.conversation!.answers.length, 1); assert.equal(state.steps.browserTools.status, "pending"); assert.equal(readiness(state).ready, false);
  assert.throws(() => applyResponse(root, { ...response(root, "secret", [{ ...decision("password"), field: "password" }], { [qa]: "secret" }) }));
});

test("the focused CLI queues one prompt, waits quietly and persists explicit pause/resume", t => {
  const { root, write } = sandbox(t);
  write("package.json", '{"type":"module"}');
  fs.cpSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."), resolve(root, ".local/build/automation"), { recursive: true });
  write(".local/questions.json", JSON.stringify([question("remote"), question("notice")]));
  const run = (...args: string[]) => spawnSync(process.execPath, [resolve(root, ".local/build/automation/onboarding/conversation-cli.js"), ...args], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(run("queue", "--file", ".local/questions.json").status, 0);
  const first = run("next"); assert.equal(first.status, 0); assert.match(first.stdout, /"action": "present"/);
  assert.equal(run("asked", "--id", "remote", "--source", "synthetic-prompt").status, 0);
  assert.match(run("next").stdout, /"action": "wait"/);
  assert.equal(run("pause", "--source", "synthetic-pause").status, 0); assert.match(run("next").stdout, /"action": "paused"/);
  assert.equal(run("resume", "--source", "synthetic-resume").status, 0); assert.match(run("next").stdout, /"action": "wait"/);
});
