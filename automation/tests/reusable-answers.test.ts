import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, relative, isAbsolute } from "node:path";
import { execFileSync } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { evidenceFile } from "../email/evidence.js";
import { applyResponse, nextQuestion, queueQuestions, reviseQuestion, setConversationMode, type ResponseBundle } from "../onboarding/conversation.js";
import { loadProgress } from "../onboarding/state-store.js";
import { chooseSetting, openSettings, saveSettingsReply } from "../settings/menu.js";
import { beginAttentionReview, continueAttentionReview, registerSelectedAttention, verifyAttentionReview, recordAttentionPresentation, saveAttentionAnswer } from "../attention/review.js";
import { itemKey } from "../attention/types.js";
import { loadAttention } from "../attention/state.js";
import type { ApplicationTask } from "../workflow/application-state.js";
import { answerDecision, loadReusableAnswers, reusableAnswerPath } from "../answers/context.js";
import { lookupApplicationAnswer, prepareReusableResponse, type AnswerRequest, type ReusableChange } from "../answers/workflow.js";

const today = "2026-11-07";
const now = `${today}T10:00:00Z`;
const qaContext = "Job Context/Candidate/Role Profiles/QA/application-answers.local.md";

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(join(tmpdir(), "reusable-answers-"));
  execFileSync("git", ["init", "--quiet", root], { windowsHide: true });
  fs.writeFileSync(join(root, ".gitignore"), ".local/\nTask Board/\n**/*.local.md\n");
  function write(name: string, value: string | object) {
    const path = resolve(root, name);
    fs.mkdirSync(dirname(path), { recursive: true });
    fs.writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
    return evidenceFile(root, name);
  }
  write("Job Context/Candidate/role-routing.local.md", "| qa | Role Profiles/QA | Yes |\n| support | Role Profiles/Support | Yes |\n");
  const context = write(qaContext, "# Synthetic role-specific answers\n");
  t.after(() => {
    const part = relative(tmpdir(), resolve(root));
    assert.ok(part && !part.startsWith("..") && !isAbsolute(part));
    fs.rmSync(root, { recursive: true });
  });
  return { root, write, context };
}

function request(fieldId: string, context: AnswerRequest["context"] = {}, questionScope: AnswerRequest["questionScope"] = {}): AnswerRequest {
  return { fieldId, context, questionScope, onDate: today };
}

function reply(root: string, id: string, ...changes: ReusableChange[]) {
  const response: ResponseBundle = { schemaVersion: 1, id, sourceReference: `synthetic-reply-${id}`, observedAt: now, answers: [], writes: [], references: [] };
  return prepareReusableResponse(root, response, changes);
}

const notice = { fieldId: "notice_period", value: "Two weeks", scope: {}, kind: "answer" } as const;

function registeredBlocker(f: ReturnType<typeof fixture>, shared: boolean, taskId = "APP-synthetic-qa") {
  const binding = shared ? answerDecision("notice_period", {}) :
    { id: "old-notice", step: "applicationInstructions" as const, substep: "notice", roleId: "qa", contextPath: qaContext, field: "notice" };
  const task: ApplicationTask = {
    taskId, originalIntake: "To Do", selectedRoleId: "qa", checkpoint: "working",
    blocker: { reason: "A notice period is required", lastCompletedStep: "Form opened", contextPath: qaContext, nextAction: "Confirm notice period",
      resumeCheckpoint: "Notice field", attention: { humanRequired: true, generation: "notice-1", kind: "answer", label: "Notice period", binding } },
  };
  const path = `Task Board/Blocked/${taskId}.md`;
  const ticket = f.write(path, "# Synthetic blocked ticket\n");
  registerSelectedAttention(f.root, task, path, "synthetic-explicit-review", now);
  const item = loadAttention(f.root).state.items.find(item => item.taskId === taskId)!;
  const observation = {
    task, ticketHash: ticket.sha256, observedAt: now, reference: "synthetic-current-form",
    context: [f.context], outcome: "needsInput" as const, prompt: "How much notice do you need to give?",
    answerLookup: { question: "How much notice do you need to give?", context: { roleId: "qa", taskId: task.taskId }, questionScope: {}, onDate: today },
  };
  return { item, observation };
}

function blocked(f: ReturnType<typeof fixture>, shared: boolean) {
  const { item, observation } = registeredBlocker(f, shared);
  beginAttentionReview(f.root, itemKey(item), "synthetic-review-choice", now);
  return verifyAttentionReview(f.root, observation);
}

test("a blocked review saves one general answer that another role reuses under different wording", t => {
  const f = fixture(t);
  assert.equal(blocked(f, true).action, "presentOne");
  recordAttentionPresentation(f.root, "synthetic-actual-prompt", now);
  const otherRole = { question: "What is your notice period?", context: { roleId: "support", taskId: "APP-synthetic-support" }, questionScope: {}, onDate: today };
  assert.equal(lookupApplicationAnswer(f.root, otherRole).action, "pending");
  f.write(".local/blocked-reply.json", reply(f.root, "blocked", notice));
  assert.equal(saveAttentionAnswer(f.root, ".local/blocked-reply.json").requeued, false);
  const result = lookupApplicationAnswer(f.root, otherRole);
  assert.equal(result.action, "match");
  if (result.action === "match") {
    assert.equal(result.answer.value, "Two weeks");
    assert.equal(result.evidence.path, reusableAnswerPath);
  }
  assert.equal(loadReusableAnswers(f.root).answers.length, 1);
  assert.equal(fs.existsSync(resolve(f.root, "Task Board/Blocked/APP-synthetic-qa.md")), true);
});

test("regular intake keeps one pending question and its answer satisfies a selected older blocker", t => {
  const f = fixture(t);
  const first = lookupApplicationAnswer(f.root, request("notice_period", { roleId: "support" }));
  assert.equal(first.action, "missing");
  if (first.action !== "missing") return;
  queueQuestions(f.root, [{ ...first.decision, prompt: "What is your notice period?", required: true }]);
  queueQuestions(f.root, [{ ...first.decision, prompt: "How much notice do you need to give?", required: true }]);
  assert.equal(loadProgress(f.root).state.conversation!.questions.length, 1);
  assert.equal(lookupApplicationAnswer(f.root, request("notice_period", { roleId: "qa" })).action, "pending");
  queueQuestions(f.root, [{ ...answerDecision("notice_period", { roleId: "qa" }), prompt: "What is your notice period for the QA application?", required: true }]);
  applyResponse(f.root, reply(f.root, "regular", notice));
  assert.notEqual(nextQuestion(f.root).next.action, "present");
  assert.equal(loadProgress(f.root).state.conversation!.questions[1].status, "answered");
  assert.equal(blocked(f, false).action, "awaitingContinue");
  assert.equal(loadAttention(f.root).state.items[0].state, "inputRecorded");
  assert.equal(loadProgress(f.root).state.conversation!.questions[0].status, "answered");
});

test("reusable lookup keeps country, sponsorship timing, task and date distinctions", t => {
  const { root } = fixture(t);
  applyResponse(root, reply(root, "scoped",
    { fieldId: "work_authorization", scope: { country: "NG" }, value: true, kind: "answer" },
    { fieldId: "sponsorship_now", scope: { country: "NG" }, value: false, kind: "answer" },
    { fieldId: "salary_expectation", scope: { taskId: "APP-one" }, value: "NGN 100000 per month", kind: "answer" },
    { fieldId: "available_start_date", scope: {}, value: "2026-11-06", kind: "answer" }));
  const nigeria = { roleId: "support", country: "NG", taskId: "APP-one" };
  assert.equal(lookupApplicationAnswer(root, request("work_authorization", nigeria, { country: "NG" })).action, "match");
  assert.equal(lookupApplicationAnswer(root, request("work_authorization", { country: "GB" }, { country: "GB" })).action, "missing");
  assert.throws(() => lookupApplicationAnswer(root, request("work_authorization", nigeria)), /relevant country/);
  assert.equal(lookupApplicationAnswer(root, request("sponsorship_future", nigeria, { country: "NG" })).action, "missing");
  assert.equal(lookupApplicationAnswer(root, request("salary_expectation", nigeria, { taskId: "APP-one" })).action, "match");
  assert.equal(lookupApplicationAnswer(root, request("salary_expectation", { taskId: "APP-two" }, { taskId: "APP-two" })).action, "missing");
  assert.equal(lookupApplicationAnswer(root, request("available_start_date")).action, "stale");
  assert.equal(lookupApplicationAnswer(root, request("notice_period")).action, "missing");
});

test("existing role facts remain usable without migration and conflicting scopes require clarification", t => {
  const f = fixture(t);
  const existing = { value: "One week", scope: { roleId: "qa" }, evidence: f.write(qaContext, "Notice period: One week\n") };
  const query = { ...request("notice_period", { roleId: "qa", country: "NG" }), existing };
  assert.equal(lookupApplicationAnswer(f.root, query).action, "match");
  assert.equal(fs.existsSync(resolve(f.root, reusableAnswerPath)), false);
  assert.throws(() => lookupApplicationAnswer(f.root, { ...query, context: { roleId: "support", country: "NG" } }), /selected role/);
  applyResponse(f.root, reply(f.root, "country-specific", { ...notice, scope: { country: "NG" } }));
  const conflict = lookupApplicationAnswer(f.root, query);
  assert.equal(conflict.action, "conflict");
  if (conflict.action !== "conflict") return;
  applyResponse(f.root, reply(f.root, "general-default", notice));
  queueQuestions(f.root, [{ ...conflict.decision, prompt: "Which notice period applies here?", required: true, scopeClarification: true }]);
  assert.equal(nextQuestion(f.root).next.action, "present");
});

test("settings can narrow an answer and reject a correction prepared against an older revision", t => {
  const f = fixture(t);
  applyResponse(f.root, reply(f.root, "initial", notice));
  const stale = reply(f.root, "stale", { ...notice, value: "Four weeks", kind: "correction" });
  openSettings(f.root, "synthetic-settings-request");
  chooseSetting(f.root, "preferences");
  chooseSetting(f.root, "reusable-answers");
  f.write(".local/narrow.json", reply(f.root, "narrow",
    { ...notice, value: null, kind: "correction" },
    { ...notice, scope: { roleId: "qa" }, value: "Three weeks" }));
  saveSettingsReply(f.root, ".local/narrow.json");
  assert.throws(() => applyResponse(f.root, stale), /Canonical context changed/);
  assert.equal(lookupApplicationAnswer(f.root, request("notice_period", { roleId: "support" })).action, "missing");
  const result = lookupApplicationAnswer(f.root, request("notice_period", { roleId: "qa" }));
  assert.equal(result.action, "match");
  if (result.action === "match") assert.equal(result.answer.value, "Three weeks");
});

test("a partially saved reply recovers before a later application can reuse it", t => {
  const { root } = fixture(t), bundle = reply(root, "interrupted", notice);
  const rename = fs.renameSync;
  try {
    fs.renameSync = ((from, to) => {
      if (String(to).endsWith("onboarding-state.json")) throw new Error("Synthetic progress interruption");
      return rename(from, to);
    }) as typeof fs.renameSync;
    syncBuiltinESMExports();
    assert.throws(() => applyResponse(root, bundle), /Synthetic progress interruption/);
  } finally {
    fs.renameSync = rename;
    syncBuiltinESMExports();
  }
  assert.equal(lookupApplicationAnswer(root, request("notice_period")).action, "recoverResponse");
  applyResponse(root);
  assert.equal(lookupApplicationAnswer(root, request("notice_period")).action, "match");
  assert.equal(loadProgress(root).state.conversation!.answers.length, 1);
});

test("an applicable pending correction suppresses the old answer and preserves a distinct role exception", t => {
  const { root } = fixture(t);
  const general = answerDecision("notice_period", {});
  queueQuestions(root, [{ ...general, prompt: "What is your notice period?", required: true }]);
  applyResponse(root, reply(root, "old-notice", notice, { ...notice, scope: { roleId: "qa" }, value: "One week" }));
  reviseQuestion(root, general.id, "What is your updated notice period?", "synthetic-request-to-correct", now);
  const waiting = lookupApplicationAnswer(root, request("notice_period", { roleId: "support" }, { roleId: "support" }));
  assert.equal(waiting.action, "pending");
  if (waiting.action === "pending") assert.deepEqual(waiting.decision, general);
  assert.equal(lookupApplicationAnswer(root, request("notice_period", { roleId: "qa" })).action, "match");
  applyResponse(root, reply(root, "corrected-notice", { ...notice, value: "Four weeks", kind: "correction" }));
  const updated = lookupApplicationAnswer(root, request("notice_period", { roleId: "support" }));
  assert.equal(updated.action, "match");
  if (updated.action === "match") assert.equal(updated.answer.value, "Four weeks");
});

test("an expired scoped answer remains pending despite a current general answer", t => {
  const { root } = fixture(t);
  applyResponse(root, reply(root, "start-dates",
    { fieldId: "available_start_date", scope: {}, value: "2099-12-01", kind: "answer" },
    { fieldId: "available_start_date", scope: { roleId: "qa" }, value: "2026-11-06", kind: "answer" }));
  const stale = lookupApplicationAnswer(root, request("available_start_date", { roleId: "qa" }));
  assert.equal(stale.action, "stale");
  if (stale.action !== "stale") return;
  const question = { prompt: "What date can you start?", required: true };
  // Older callers supplied the decision alone, without the application's qualifiers.
  const state = queueQuestions(root, [{ ...stale.decision, ...question }]);
  assert.equal(state.conversation!.questions[0].status, "pending");
  assert.equal(nextQuestion(root).next.action, "present");
  const other = lookupApplicationAnswer(root, request("available_start_date", { roleId: "support" }));
  assert.equal(other.action, "pending");
});

test("a reusable answer for an unrelated field cannot satisfy a recorded legacy blocker", t => {
  const f = fixture(t);
  applyResponse(f.root, reply(f.root, "start-date",
    { fieldId: "available_start_date", scope: {}, value: "2099-12-01", kind: "answer" }));
  const { item, observation } = registeredBlocker(f, false);
  beginAttentionReview(f.root, itemKey(item), "synthetic-review-choice", now);
  const answerLookup = request("available_start_date", observation.answerLookup.context);
  assert.throws(() => verifyAttentionReview(f.root, { ...observation, answerLookup }), /recorded field/);
  assert.equal(loadAttention(f.root).state.items[0].state, "waiting");
  assert.equal(verifyAttentionReview(f.root, observation).action, "presentOne");
});

test("Continue skips each ticket waiting on a linked answer during the current review", t => {
  const f = fixture(t);
  queueQuestions(f.root, [{ ...answerDecision("notice_period", {}), prompt: "What is your notice period?", required: true }]);
  setConversationMode(f.root, "paused", "synthetic-pause", now);
  const first = registeredBlocker(f, true, "APP-a");
  const second = registeredBlocker(f, true, "APP-b");
  beginAttentionReview(f.root, itemKey(first.item), "synthetic-review-first", now);
  assert.equal(verifyAttentionReview(f.root, first.observation).action, "awaitingExistingAnswer");
  const next = continueAttentionReview(f.root, "synthetic-continue-second", now);
  assert.equal(next.action, "inspectSelectedTask");
  if (next.action === "inspectSelectedTask") assert.equal(next.ticket.path, second.item.path);
  assert.equal(verifyAttentionReview(f.root, second.observation).action, "awaitingExistingAnswer");
  assert.deepEqual(continueAttentionReview(f.root, "synthetic-continue-done", now), { action: "awaitingLinkedAnswers", waiting: 2 });
  assert.deepEqual(loadAttention(f.root).state.items.map(item => item.state), ["waiting", "waiting"]);
  assert.equal(beginAttentionReview(f.root, itemKey(first.item), "synthetic-new-review", now).action, "inspectSelectedTask");
});

test("a vacancy-only reply satisfies the selected review and stays private to that vacancy", t => {
  const f = fixture(t);
  assert.equal(blocked(f, true).action, "presentOne");
  recordAttentionPresentation(f.root, "synthetic-vacancy-prompt", now);
  const proposal = ".local/vacancy-only.json";
  f.write(proposal, reply(f.root, "wrong-vacancy", { ...notice, scope: { taskId: "APP-other" } }));
  assert.throws(() => saveAttentionAnswer(f.root, proposal), /canonical field/);
  assert.equal(fs.existsSync(resolve(f.root, reusableAnswerPath)), false);
  f.write(proposal, reply(f.root, "selected-vacancy", { ...notice, scope: { taskId: "APP-synthetic-qa" } }));
  assert.equal(saveAttentionAnswer(f.root, proposal).requeued, false);
  assert.equal(loadAttention(f.root).state.items[0].state, "inputRecorded");
  assert.equal(lookupApplicationAnswer(f.root, request("notice_period", { taskId: "APP-synthetic-qa" })).action, "match");
  assert.equal(lookupApplicationAnswer(f.root, request("notice_period", { taskId: "APP-other" })).action, "missing");
  assert.equal(fs.existsSync(resolve(f.root, "Task Board/Blocked/APP-synthetic-qa.md")), true);
});

test("a malformed reusable answer file leaves Preferences and its navigation usable", t => {
  const f = fixture(t);
  const proposal = ".local/repair-proposal.json";
  f.write(proposal, reply(f.root, "cannot-overwrite", notice));
  const malformed = "# Incomplete private answer edit";
  f.write(reusableAnswerPath, malformed);
  openSettings(f.root, "synthetic-open-settings");
  assert.equal(chooseSetting(f.root, "preferences").phase, "area");
  const unavailable = chooseSetting(f.root, "reusable-answers");
  assert.equal(unavailable.current?.status, "unavailable");
  assert.equal(unavailable.input, "choice");
  assert.throws(() => saveSettingsReply(f.root, proposal), /Reconcile the private reusable answer file/);
  assert.equal(chooseSetting(f.root, "back").phase, "area");
  assert.equal(chooseSetting(f.root, "back").phase, "root");
  assert.equal(chooseSetting(f.root, "preferences").phase, "area");
  assert.equal(chooseSetting(f.root, "close").phase, "closed");
  assert.equal(fs.readFileSync(resolve(f.root, reusableAnswerPath), "utf8"), malformed);
});

test("an invalid optional timezone cannot strand a retained reusable reply or block later replies", t => {
  const f = fixture(t);
  f.write(".local/operation-preferences.json", { timezone: "Synthetic/Unknown-Timezone" });
  const scope = { roleId: "qa" };
  queueQuestions(f.root, [
    { ...answerDecision("available_start_date", scope), prompt: "What date can you start?", required: true },
    { ...answerDecision("notice_period", scope), prompt: "What is your notice period?", required: true },
  ]);
  const bundle = reply(f.root, "retained", notice,
    { fieldId: "available_start_date", scope: {}, value: "2099-12-01", kind: "answer" });
  const journal = ".local/onboarding-pending-response.json";
  f.write(journal, bundle);
  f.write(reusableAnswerPath, bundle.writes[0].content);
  const state = applyResponse(f.root);
  assert.deepEqual(state.conversation!.questions.map(question => question.status), ["pending", "answered"]);
  assert.equal(fs.existsSync(resolve(f.root, journal)), false);
  assert.equal(applyResponse(f.root, reply(f.root, "later", { ...notice, scope })).conversation!.responses.length, 2);
});
