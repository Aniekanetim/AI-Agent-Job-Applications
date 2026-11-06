import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { resolve, dirname, relative, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { savePrivateJson, readPrivateJson } from "../workflow/private-json.js";
import { acquireOwnership } from "../workflow/ownership.js";
import { evidenceFile, digest } from "../email/evidence.js";
import type { ApplicationTask } from "../workflow/application-state.js";
import { bindTaskTicket, refreshTaskTicket, loadTaskControl, transitionTask, taskOwnershipKey } from "../workflow/task-control.js";
import { emptyAttention, loadAttention, attentionFile, attentionHealthy } from "../attention/state.js";
import { attentionForTask, stageAttentionChange, commitAttentionChange } from "../attention/events.js";
import { itemKey, type AttentionItem } from "../attention/types.js";
import { nextAttention, browseAttention, attentionQueue } from "../attention/queue.js";
import { loadAttentionPreferences, saveAttentionPreferences, snoozeAttention } from "../attention/preferences.js";
import { beginAttentionReview, verifyAttentionReview, recordAttentionPresentation, saveAttentionAnswer, recordAttentionHumanAction,
  continueAttentionReview, registerSelectedAttention, repairSelectedAttention, reconcileAttentionAnswer } from "../attention/review.js";
import { loadAttentionSession, suspendAttention } from "../attention/session-state.js";
import { prepareAttentionDelivery, authorizeAttentionDelivery, observeAttentionDelivery, recoverUnsentAttentionDelivery } from "../attention/delivery.js";
import { openSettings, chooseSetting } from "../settings/menu.js";
import { currentSetting } from "../settings/context.js";
import { settingById } from "../settings/catalog.js";
import { queueQuestions, nextQuestion, setConversationMode, type ResponseBundle } from "../onboarding/conversation.js";
import { loadProgress } from "../onboarding/state-store.js";
import type { Decision } from "../onboarding/conversation-types.js";
import { alertFixture, bindFixture, writeFixture } from "./email-fixture.js";
import { classifyMessage } from "../email/intake.js";
import { loadInboxState, saveEmailRecord } from "../email/state-store.js";
import { requeueMovedEmailTicket } from "../email/requeue.js";
import { pauseForCaptcha } from "../browser/captcha.js";

const now = "2026-11-06T10:00:00.000Z", later = "2026-11-06T12:00:00.000Z";
function fixture(t: TestContext) {
  const root = fs.mkdtempSync(join(tmpdir(), "attention-synthetic-"));
  execFileSync("git", ["init", "--quiet", root], { windowsHide: true });
  fs.writeFileSync(resolve(root, ".gitignore"), ".local/\nTask Board/\nJob Context/**/*.local.md\n");
  t.after(() => { const part = relative(tmpdir(), root); assert.ok(part && !part.startsWith("..") && !isAbsolute(part)); fs.rmSync(root, { recursive: true }); });
  const write = (path: string, content: string) => { fs.mkdirSync(dirname(resolve(root, path)), { recursive: true }); fs.writeFileSync(resolve(root, path), content); return evidenceFile(root, path); };
  write(".local/operation-preferences.json", JSON.stringify({ schemaVersion: 1, mode: "onDemand", cadence: null, timezone: "Africa/Lagos", perRunLimit: null, perDayLimit: null, reporting: "summary", sourceReference: "synthetic", scheduleReference: null }));
  return { root, write };
}
function item(n = 1): AttentionItem {
  return { humanRequired: true, taskId: `APP-${String(n).padStart(3, "0")}`, path: `Task Board/Blocked/APP-${String(n).padStart(3, "0")}.md`,
    generation: "missing-answer-v1", kind: "answer", label: "Provide the missing application answer", blockedAt: now, verifiedAt: now, ticketHash: "a".repeat(64), state: "waiting" };
}
function seed(root: string, count: number) { const state = emptyAttention(); state.items = Array.from({ length: count }, (_, i) => item(i + 1)); savePrivateJson(root, attentionFile, state, null); return state; }
function enable(root: string, write: ReturnType<typeof fixture>["write"]) {
  const proof = write(".local/attention-capability-evidence/synthetic-proof.md", "Synthetic notification-only rehearsal; no real delivery.");
  savePrivateJson(root, ".local/attention-capability.json", { schemaVersion: 1, workingRoot: root, executionContext: "scheduled", notificationOnly: true,
    scheduleReference: "synthetic-reminder-schedule", channel: "native", checkedAt: now, rehearsalReference: "synthetic-host-rehearsal", evidence: [proof] }, null);
  saveAttentionPreferences(root, { mode: "recurring", everyMinutes: 60, scheduleReference: "synthetic-reminder-schedule", sourceReference: "synthetic-user-choice" });
}
function selectedFixture(t: TestContext, canonical = true) {
  const f = fixture(t), i = item(), contextPath = canonical ? "Job Context/Candidate/Role Profiles/Synthetic/application-answers.local.md" : "Job Context/Job Boards/Synthetic/access-and-instructions.local.md";
  const binding: Decision = { id: "salary", step: "applicationInstructions", substep: "Salary expectation", roleId: "role-one", contextPath, field: "salary" };
  if (canonical) f.write("Job Context/Candidate/role-routing.local.md", "| role-one | Role Profiles/Synthetic | yes |\n");
  const context = f.write(contextPath, "# Synthetic private context\nAnswer not yet supplied.\n");
  const task: ApplicationTask = { taskId: i.taskId, originalIntake: "To Do", checkpoint: "working", ...(canonical ? { selectedRoleId: "role-one" } : {}),
    blocker: { reason: "Synthetic human dependency", lastCompletedStep: "Prepared synthetic draft", contextPath, nextAction: "Supply the missing information", resumeCheckpoint: "synthetic-draft",
      attention: { humanRequired: true, generation: i.generation, kind: canonical ? "answer" : "access", label: i.label, ...(canonical ? { binding } : {}) } } };
  const ticket = f.write(i.path, "# Synthetic task\nPreserved checkpoint and original source.\n");
  registerSelectedAttention(f.root, task, i.path, "synthetic-explicit-review", now);
  return { ...f, i: loadAttention(f.root).state.items[0], task, binding, context, ticket };
}
function verify(f: ReturnType<typeof selectedFixture>) {
  beginAttentionReview(f.root, itemKey(f.i), "synthetic-review", now);
  return verifyAttentionReview(f.root, { task: f.task, ticketHash: f.ticket.sha256, observedAt: now, reference: "synthetic-context-review", context: [f.context], outcome: "needsInput", prompt: "What salary should I use for this application?", decision: f.binding });
}

test("empty installations are quiet and partial; reading creates no attention files", t => {
  const f = fixture(t), before = fs.readFileSync(resolve(f.root, ".local/operation-preferences.json"));
  assert.equal(prepareAttentionDelivery(f.root, now).action, "quiet");
  assert.equal(nextAttention(f.root, now, true).recorded, 0);
  assert.equal(nextAttention(f.root, now, true).coverage, "partial");
  assert.equal(loadAttentionPreferences(f.root).value.mode, "manual");
  assert.equal(fs.existsSync(resolve(f.root, attentionFile)), false);
  assert.deepEqual(fs.readFileSync(resolve(f.root, ".local/operation-preferences.json")), before);
});

test("125 items expose one preview, ten browse rows, stable priority/deadline ordering", t => {
  const f = fixture(t), s = seed(f.root, 125);
  s.items[124].priority = 9; s.items[100].priority = 9; s.items[100].deadline = later;
  savePrivateJson(f.root, attentionFile, s, loadAttention(f.root).revision);
  const next = nextAttention(f.root, now, true), first = browseAttention(f.root, now), last = browseAttention(f.root, now, 13);
  assert.equal(next.recorded, 125); assert.equal(next.eligible, 125); assert.equal(next.preview?.taskId, "APP-101"); assert.equal(next.choices.length, 3);
  assert.equal(first.rows.length, 10); assert.equal(last.rows.length, 5); assert.equal(first.pages, 13);
  assert.equal(browseAttention(f.root, now, 1, "captcha").rows.length, 0);
  assert.throws(() => browseAttention(f.root, now, 0));
});

test("reminder selectors and dispatch never enumerate/read/hash/stat Blocked, context or execution mirrors", t => {
  const f = fixture(t); seed(f.root, 125); enable(f.root, f.write);
  f.write("Task Board/To Do/APP-001.md", "Synthetic requeued item, with an intentionally different hash.");
  const originals = { readFileSync: fs.readFileSync, readdirSync: fs.readdirSync, statSync: fs.statSync, lstatSync: fs.lstatSync, existsSync: fs.existsSync, realpathSync: fs.realpathSync };
  const check = (path: unknown) => { const p = String(path).replaceAll("\\", "/"); if (/Task Board\/Blocked|task-controls|Job Context|inbox-state|\.auth/i.test(p)) throw new Error(`Prohibited reminder read: ${p}`); };
  try {
    for (const key of Object.keys(originals) as (keyof typeof originals)[]) (fs as any)[key] = (...args: any[]) => { check(args[0]); return (originals[key] as Function)(...args); };
    syncBuiltinESMExports();
    assert.equal(nextAttention(f.root, now).eligible, 124); assert.equal(browseAttention(f.root, now).rows.length, 10);
    const prepared = prepareAttentionDelivery(f.root, now); assert.equal(prepared.action, "prepared");
    if (prepared.action === "prepared") { assert.equal(authorizeAttentionDelivery(f.root, prepared.id, now).dispatch, true); observeAttentionDelivery(f.root, prepared.id, "delivered", "synthetic-host-receipt"); }
  } finally { Object.assign(fs, originals); syncBuiltinESMExports(); }
});

test("duplicate generations stay stable, tombstones reject late replay, a real new generation registers", t => {
  const f = fixture(t), a = item();
  stageAttentionChange(f.root, a.taskId, "block-a", a); commitAttentionChange(f.root, "block-a", "committed-ticket-a");
  const revision = loadAttention(f.root).revision;
  stageAttentionChange(f.root, a.taskId, "block-a", { ...a, verifiedAt: later }); commitAttentionChange(f.root, "block-a", "committed-ticket-a");
  assert.equal(loadAttention(f.root).revision, revision);
  stageAttentionChange(f.root, a.taskId, "reviewed-priority", { ...a, priority: 8, label: "Provide the reviewed missing answer", verifiedAt: later }); commitAttentionChange(f.root, "reviewed-priority", "actual-reviewed-ticket");
  assert.equal(loadAttention(f.root).state.items[0].priority, 8); assert.equal(loadAttention(f.root).state.items[0].blockedAt, now);
  stageAttentionChange(f.root, a.taskId, "old-block", a); stageAttentionChange(f.root, a.taskId, "cancel-a", null); commitAttentionChange(f.root, "cancel-a", "actual-cancel");
  commitAttentionChange(f.root, "old-block", "late-old-ticket");
  assert.equal(nextAttention(f.root, later, true).eligible, 0);
  stageAttentionChange(f.root, a.taskId, "replay-a", a); commitAttentionChange(f.root, "replay-a", "replayed-old-ticket");
  assert.equal(nextAttention(f.root, later, true).eligible, 0);
  const renewed = { ...a, generation: "new-human-handoff" };
  stageAttentionChange(f.root, a.taskId, "renewed", renewed); commitAttentionChange(f.root, "renewed", "actual-renewed-handoff");
  assert.equal(nextAttention(f.root, later, true).eligible, 1);
});

test("staged lifecycle changes suppress a row until actual commit or selected recovery", t => {
  const f = fixture(t); seed(f.root, 1);
  stageAttentionChange(f.root, "APP-001", "move-in-progress", null);
  assert.equal(nextAttention(f.root, now, true).eligible, 0);
  assert.equal(loadAttention(f.root).state.items[0].state, "waiting");
  commitAttentionChange(f.root, "move-in-progress", "actual-committed-move");
  assert.equal(loadAttention(f.root).state.items[0].state, "retired");
});

test("snooze applies to the whole queue, survives restart and expires at the saved instant", t => {
  const f = fixture(t); seed(f.root, 125); enable(f.root, f.write);
  snoozeAttention(f.root, later, "synthetic-remind-later", now);
  assert.equal(nextAttention(f.root, now).suppressed, "snoozed"); assert.equal(nextAttention(f.root, now).preview, null);
  assert.equal(browseAttention(f.root, now).eligible, 125);
  assert.equal(nextAttention(f.root, later).eligible, 125);
  assert.equal(loadAttentionPreferences(f.root).value.timezone, "Africa/Lagos");
  saveAttentionPreferences(f.root, { paused: true, sourceReference: "synthetic-pause" });
  assert.equal(prepareAttentionDelivery(f.root, later).action, "quiet");
  assert.throws(() => snoozeAttention(f.root, now, "synthetic", later));
});

test("one native summary per window; unknown delivery suppresses retries across future windows", t => {
  const f = fixture(t); seed(f.root, 125); enable(f.root, f.write);
  const d = prepareAttentionDelivery(f.root, now); assert.equal(d.action, "prepared"); if (d.action !== "prepared") return;
  assert.equal(prepareAttentionDelivery(f.root, now).action, "inspectDelivery");
  assert.equal(authorizeAttentionDelivery(f.root, d.id, now).dispatch, true);
  assert.throws(() => authorizeAttentionDelivery(f.root, d.id, now));
  observeAttentionDelivery(f.root, d.id, "unknown", "synthetic-timeout-after-dispatch");
  assert.equal(prepareAttentionDelivery(f.root, later).action, "inspectDelivery");
  observeAttentionDelivery(f.root, d.id, "delivered", "synthetic-inspected-host-receipt");
  assert.equal(prepareAttentionDelivery(f.root, now).action, "quiet");
  assert.equal(prepareAttentionDelivery(f.root, later).action, "prepared");
});

test("snooze or lifecycle change between preparation and dispatch cancels the stale summary", t => {
  const f = fixture(t); seed(f.root, 1); enable(f.root, f.write);
  const d = prepareAttentionDelivery(f.root, now); assert.equal(d.action, "prepared"); if (d.action !== "prepared") return;
  snoozeAttention(f.root, later, "synthetic-snooze", now);
  assert.equal(authorizeAttentionDelivery(f.root, d.id, now).dispatch, false);
  assert.throws(() => observeAttentionDelivery(f.root, d.id, "delivered", "invented-receipt"));
});

test("a prepared but uninvoked summary needs explicit cancellation; capability absence keeps timers off", t => {
  const f = fixture(t); seed(f.root, 1);
  assert.throws(() => saveAttentionPreferences(f.root, { mode: "recurring", everyMinutes: 60, scheduleReference: "unverified", sourceReference: "synthetic" }), /rehearsal/);
  assert.equal(loadAttentionPreferences(f.root).value.mode, "manual");
  enable(f.root, f.write);
  const d = prepareAttentionDelivery(f.root, now); if (d.action !== "prepared") return assert.fail("Expected preparation");
  recoverUnsentAttentionDelivery(f.root, d.id, "synthetic-confirmed-uninvoked");
  assert.equal(prepareAttentionDelivery(f.root, now).action, "quiet");
});

test("selected legacy registration is idempotent, scoped and never implies full coverage", t => {
  const f = selectedFixture(t);
  registerSelectedAttention(f.root, f.task, f.i.path, "another-explicit-review", later);
  assert.equal(loadAttention(f.root).state.items.length, 1); assert.equal(loadAttention(f.root).state.coverage, "partial");
  assert.ok(loadAttention(f.root).state.events[0].requestReference);
  assert.throws(() => registerSelectedAttention(f.root, f.task, ".local/operation-preferences.json", "synthetic", now));
});

test("one selected review preserves canonical answer saves, extra answers and paused onboarding without requeueing", t => {
  const f = selectedFixture(t); setConversationMode(f.root, "paused", "synthetic-pause", now);
  assert.equal(verify(f).action, "presentOne"); recordAttentionPresentation(f.root, "synthetic-actual-question", now);
  const extra: Decision = { ...f.binding, id: "notice", field: "notice", substep: "Notice period" };
  const content = "# Synthetic private answers\nSalary: synthetic amount\nNotice: synthetic period\n";
  const bundle: ResponseBundle = { schemaVersion: 1, id: "reply-one", sourceReference: "synthetic-user-reply", observedAt: now,
    answers: [{ decision: f.binding, kind: "answer" }, { decision: extra, kind: "answer" }], writes: [{ path: f.context.path, expectedSha256: f.context.sha256, content }], references: [] };
  f.write(".local/response.json", JSON.stringify(bundle));
  const result = saveAttentionAnswer(f.root, ".local/response.json"); assert.equal(result.saved, true); assert.equal(result.requeued, false);
  assert.equal(loadProgress(f.root).state.conversation?.mode, "paused"); assert.equal(loadProgress(f.root).state.conversation?.answers.length, 2);
  assert.equal(loadAttentionSession(f.root).session.phase, "awaitingContinue");
  assert.equal(fs.existsSync(resolve(f.root, f.i.path)), true); assert.equal(nextAttention(f.root, now, true).eligible, 0);
  assert.equal(continueAttentionReview(f.root, "synthetic-continue", later).action, "noRecordedItems");
});

test("settings suspends attention; onboarding cannot open a competing question", t => {
  const f = selectedFixture(t); verify(f);
  assert.equal(nextQuestion(f.root).next.action, "attention");
  queueQuestions(f.root, [{ ...f.binding, id: "future-notice", field: "notice", prompt: "Synthetic future question?", required: true }]);
  recordAttentionPresentation(f.root, "synthetic-current-question", now);
  const view = openSettings(f.root, "synthetic-open-settings"); assert.equal(view.options.length, 7);
  assert.equal(loadAttentionSession(f.root).session.phase, "suspended");
  chooseSetting(f.root, "operating"); const edit = chooseSetting(f.root, "blocked-reminders");
  assert.match(edit.current!.text, /automatic reminders are off/);
  assert.throws(() => beginAttentionReview(f.root, itemKey(f.i), "synthetic-review", later), /settings/);
});

test("an existing onboarding question remains focused and suppresses reminders", t => {
  const f = selectedFixture(t); enable(f.root, f.write);
  queueQuestions(f.root, [{ ...f.binding, prompt: "Synthetic pending question?", required: true }]);
  assert.equal(nextAttention(f.root, now).suppressed, "conversation");
  assert.throws(() => beginAttentionReview(f.root, itemKey(f.i), "synthetic-review", now), /onboarding/);
  assert.equal(loadProgress(f.root).state.conversation!.questions[0].status, "pending");
});

test("changed context/ticket and foreign role bindings cannot produce or acknowledge a stale question", t => {
  const f = selectedFixture(t); verify(f);
  f.write(f.context.path, "# Newer canonical context\nAlready supplied.\n");
  assert.throws(() => recordAttentionPresentation(f.root, "synthetic-stale", now), /changed/);
  beginAttentionReview(f.root, itemKey(f.i), "synthetic-rereview", later);
  assert.throws(() => verifyAttentionReview(f.root, { task: f.task, ticketHash: f.ticket.sha256, observedAt: later, reference: "synthetic-review", context: [evidenceFile(f.root, f.context.path)], outcome: "needsInput", prompt: "Synthetic question?", decision: { ...f.binding, roleId: "another-role" } }), /exact recorded/);
});

test("review honors task/native claims and ambiguous user-move metadata without reading old Blocked", t => {
  const f = selectedFixture(t), owner = acquireOwnership(f.root, taskOwnershipKey(f.task.taskId));
  try { assert.throws(() => beginAttentionReview(f.root, itemKey(f.i), "synthetic-review", now), /owns/); } finally { owner.release(); }
  f.write("Task Board/To Do/APP-001.md", "Ambiguous user-moved and edited ticket.");
  assert.equal(nextAttention(f.root, now, true).eligible, 0);
  assert.equal(beginAttentionReview(f.root, itemKey(f.i), "synthetic-selected-requeue-review", now).action, "reconcileSelectedToDo");
});

test("a human-action reply records input only, without CAPTCHA/session clearance or submission changes", t => {
  const f = selectedFixture(t, false); f.task.checkpoint = "submissionAttempted";
  beginAttentionReview(f.root, itemKey(f.i), "synthetic-review", now);
  verifyAttentionReview(f.root, { task: f.task, ticketHash: f.ticket.sha256, observedAt: now, reference: "synthetic-current-session-inspection", context: [f.context], outcome: "needsInput", prompt: "Restore access to this saved application session." });
  recordAttentionPresentation(f.root, "synthetic-actual-action-request", now);
  const before = fs.readFileSync(resolve(f.root, f.i.path));
  assert.equal(recordAttentionHumanAction(f.root, "synthetic-human-ready").verified, false);
  assert.equal(f.task.checkpoint, "submissionAttempted"); assert.deepEqual(fs.readFileSync(resolve(f.root, f.i.path)), before);
});

test("guarded lifecycle blocks register after commit and cancellation retires without altering checkpoints", t => {
  const f = fixture(t), sample = item(), task: ApplicationTask = { taskId: sample.taskId, originalIntake: "To Do", checkpoint: "working" };
  const from = "Task Board/To Do/APP-001.md", to = sample.path;
  f.write(from, "# Synthetic active ticket\n"); bindTaskTicket(f.root, task, from);
  task.blocker = { reason: "Human action", lastCompletedStep: "Draft", contextPath: ".local/context.md", nextAction: "Supply missing fact", resumeCheckpoint: "draft", attention: sample };
  fs.mkdirSync(dirname(resolve(f.root, to)), { recursive: true }); fs.renameSync(resolve(f.root, from), resolve(f.root, to));
  const oldHash = loadTaskControl(f.root, task.taskId).data!.ticket.sha256;
  refreshTaskTicket(f.root, task, oldHash, to); assert.equal(nextAttention(f.root, now, true).eligible, 1);
  const authority = f.write(".local/user-decision.md", "Synthetic actual cancel instruction.");
  transitionTask({ root: f.root, path: to, task, action: "cancel", actor: "synthetic-user", reason: "Synthetic user decision", observedAt: now, authority });
  assert.equal(nextAttention(f.root, now, true).eligible, 0); assert.equal(loadTaskControl(f.root, task.taskId).data!.task.checkpoint, "working");
});

test("projection promotion failure preserves committed core state, quarantines reminders and repairs only the selected task", t => {
  const f = fixture(t), sample = item(), task: ApplicationTask = { taskId: sample.taskId, originalIntake: "To Do", checkpoint: "working" };
  const from = "Task Board/To Do/APP-001.md";
  f.write(from, "# Synthetic active ticket\n"); bindTaskTicket(f.root, task, from);
  task.blocker = { reason: "Human action", lastCompletedStep: "Draft", contextPath: ".local/context.md", nextAction: "Supply missing fact", resumeCheckpoint: "draft", attention: sample };
  fs.mkdirSync(dirname(resolve(f.root, sample.path)), { recursive: true }); fs.renameSync(resolve(f.root, from), resolve(f.root, sample.path));
  const oldHash = loadTaskControl(f.root, task.taskId).data!.ticket.sha256, rename = fs.renameSync;
  let commits = 0;
  try {
    fs.renameSync = ((a: fs.PathLike, b: fs.PathLike) => { if (String(b).replaceAll("\\", "/").endsWith("attention-state.json") && ++commits === 2) throw new Error("Synthetic projection write failure"); return rename(a, b); }) as typeof fs.renameSync;
    syncBuiltinESMExports(); refreshTaskTicket(f.root, task, oldHash, sample.path);
  } finally { fs.renameSync = rename; syncBuiltinESMExports(); }
  assert.equal(loadTaskControl(f.root, task.taskId).data!.path, sample.path); assert.equal(attentionHealthy(f.root), false);
  assert.equal(nextAttention(f.root, now, true).suppressed, "repair");
  assert.equal(repairSelectedAttention(f.root, task, sample.path, "synthetic-explicit-projection-repair", later).attention, "synced");
  assert.equal(attentionHealthy(f.root), true); assert.equal(nextAttention(f.root, later, true).eligible, 1);
});

test("privacy metadata is whitelisted and unsafe labels are rejected", t => {
  const f = fixture(t), a = item();
  const task: ApplicationTask = { taskId: a.taskId, originalIntake: "To Do", checkpoint: "working", cvVersion: "Private CV", blocker: {
    reason: "Private candidate answer must never be copied", lastCompletedStep: "Draft", contextPath: ".local/context.md", nextAction: "Sensitive full question", resumeCheckpoint: "private-session", attention: { ...a, candidateAnswer: "DO NOT COPY" } as any } };
  const indexed = attentionForTask(task, { path: a.path, sha256: a.ticketHash }, now)!;
  assert.ok(!JSON.stringify(indexed).includes("DO NOT COPY")); assert.ok(!JSON.stringify(indexed).includes("Private CV"));
  assert.throws(() => attentionForTask({ ...task, blocker: { ...task.blocker!, attention: { ...a, label: "token=secret" } } }, { path: a.path, sha256: a.ticketHash }, now));
});

test("interrupted canonical save recovers the retained reply before settings or another question", t => {
  const f = selectedFixture(t); verify(f); recordAttentionPresentation(f.root, "synthetic-asked", now);
  const response: ResponseBundle = { schemaVersion: 1, id: "interrupted-answer", sourceReference: "synthetic-user-reply", observedAt: now,
    answers: [{ decision: f.binding, kind: "answer" }], writes: [{ path: f.context.path, expectedSha256: f.context.sha256, content: "# Synthetic saved answer\nSalary: synthetic.\n" }], references: [] };
  f.write(".local/interrupted-answer.json", JSON.stringify(response));
  const rename = fs.renameSync;
  try {
    fs.renameSync = ((a: fs.PathLike, b: fs.PathLike) => { if (String(b).replaceAll("\\", "/").endsWith("onboarding-state.json")) throw new Error("Synthetic progress-save interruption"); return rename(a, b); }) as typeof fs.renameSync;
    syncBuiltinESMExports(); assert.throws(() => saveAttentionAnswer(f.root, ".local/interrupted-answer.json"), /interruption/);
  } finally { fs.renameSync = rename; syncBuiltinESMExports(); }
  assert.ok(loadAttentionSession(f.root).session.response); assert.ok(readPrivateJson(f.root, ".local/onboarding-pending-response.json").data);
  assert.throws(() => openSettings(f.root, "synthetic-settings"), /Recover/);
  assert.equal(saveAttentionAnswer(f.root).saved, true);
  assert.equal(loadProgress(f.root).state.conversation!.answers.length, 1); assert.equal(loadAttentionSession(f.root).session.phase, "awaitingContinue");
});

test("a newer canonical file is merged without discarding the original attention reply or unrelated context", t => {
  const f = selectedFixture(t); verify(f); recordAttentionPresentation(f.root, "synthetic-asked", now);
  const response: ResponseBundle = { schemaVersion: 1, id: "conflicted-answer", sourceReference: "synthetic-user-reply", observedAt: now,
    answers: [{ decision: f.binding, kind: "answer" }], writes: [{ path: f.context.path, expectedSha256: f.context.sha256, content: "# Synthetic answer\nSalary: synthetic.\n" }], references: [] };
  f.write(".local/original-answer.json", JSON.stringify(response));
  const newer = f.write(f.context.path, "# Synthetic context\nPreserve this newer unrelated instruction.\n");
  assert.throws(() => saveAttentionAnswer(f.root, ".local/original-answer.json"), /changed/);
  const merged = { ...response, writes: [{ path: f.context.path, expectedSha256: newer.sha256, content: "# Synthetic context\nPreserve this newer unrelated instruction.\nSalary: synthetic.\n" }] };
  f.write(".local/merged-answer.json", JSON.stringify(merged));
  assert.equal(reconcileAttentionAnswer(f.root, ".local/merged-answer.json", "synthetic-actual-comparison").saved, true);
  assert.match(fs.readFileSync(resolve(f.root, f.context.path), "utf8"), /newer unrelated/);
  assert.equal(loadAttentionSession(f.root).session.responseHistory!.length, 1);
  assert.equal(loadProgress(f.root).state.conversation!.responses.length, 1);
});

test("a source-bound user requeue retires metadata and retains the same task/email checkpoint", t => {
  const f = alertFixture(t, 1), identity = { ...f.identity, messageId: "synthetic-attention-requeue" };
  const record = bindFixture(f.root, classifyMessage({ ...identity, from: "alerts@example.invalid", timestamp: now }, "jobAlert", "synthetic", ".local/capability-proof.md", ".local/capability-proof.md", now), 1);
  const a = item(), ticket = writeFixture(f.root, a.path, "# Synthetic existing email task\nSubmission outcome remains uncertain.\n");
  const vacancy = record.vacancies[0]; Object.assign(vacancy, { disposition: "blocked", taskId: a.taskId, taskPath: a.path, taskEvidence: ticket });
  delete vacancy.outcomeEvidence; delete vacancy.confirmationReference; delete vacancy.applicationRecordSaved;
  saveEmailRecord(f.root, record, loadInboxState(f.root).revision); seed(f.root, 1);
  const destination = "Task Board/To Do/APP-001.md"; fs.mkdirSync(dirname(resolve(f.root, destination)), { recursive: true }); fs.renameSync(resolve(f.root, a.path), resolve(f.root, destination));
  const result = requeueMovedEmailTicket(f.root, destination, now);
  assert.equal(result.kind, "requeued"); assert.equal(result.taskId, a.taskId); assert.equal(result.dependencyVerified, false);
  assert.equal(loadAttention(f.root).state.items[0].state, "retired");
  assert.equal(evidenceFile(f.root, destination).sha256, ticket.sha256);
});

test("a failure staging attention suppresses reminders while the committed task remains recoverable", t => {
  const f = fixture(t), a = item(), task: ApplicationTask = { taskId: a.taskId, originalIntake: "To Do", checkpoint: "working" };
  const from = "Task Board/To Do/APP-001.md"; f.write(from, "# Synthetic active ticket\n"); bindTaskTicket(f.root, task, from);
  task.blocker = { reason: "Human action", lastCompletedStep: "Draft", contextPath: ".local/context.md", nextAction: "Supply missing fact", resumeCheckpoint: "draft", attention: a };
  fs.mkdirSync(dirname(resolve(f.root, a.path)), { recursive: true }); fs.renameSync(resolve(f.root, from), resolve(f.root, a.path));
  const hash = loadTaskControl(f.root, task.taskId).data!.ticket.sha256, rename = fs.renameSync;
  try {
    fs.renameSync = ((x: fs.PathLike, y: fs.PathLike) => { if (String(y).replaceAll("\\", "/").endsWith("attention-state.json")) throw new Error("Synthetic attention storage unavailable"); return rename(x, y); }) as typeof fs.renameSync;
    syncBuiltinESMExports(); refreshTaskTicket(f.root, task, hash, a.path);
  } finally { fs.renameSync = rename; syncBuiltinESMExports(); }
  assert.equal(loadTaskControl(f.root, task.taskId).data!.path, a.path); assert.equal(attentionHealthy(f.root), false);
  assert.equal(nextAttention(f.root, now, true).preview, null);
  assert.equal(repairSelectedAttention(f.root, task, a.path, "synthetic-selected-repair", later).attention, "synced");
  assert.equal(attentionHealthy(f.root), true);
});

test("delivery acknowledgment failure retains the dispatched identity instead of sending again", t => {
  const f = fixture(t); seed(f.root, 1); enable(f.root, f.write);
  const d = prepareAttentionDelivery(f.root, now); if (d.action !== "prepared") return assert.fail("Expected preparation");
  authorizeAttentionDelivery(f.root, d.id, now);
  const rename = fs.renameSync;
  try {
    fs.renameSync = ((a: fs.PathLike, b: fs.PathLike) => { if (String(b).replaceAll("\\", "/").endsWith("attention-state.json")) throw new Error("Synthetic acknowledgment failure"); return rename(a, b); }) as typeof fs.renameSync;
    syncBuiltinESMExports(); assert.throws(() => observeAttentionDelivery(f.root, d.id, "delivered", "synthetic-actual-receipt"), /acknowledgment/);
  } finally { fs.renameSync = rename; syncBuiltinESMExports(); }
  assert.equal(prepareAttentionDelivery(f.root, later).action, "inspectDelivery");
  observeAttentionDelivery(f.root, d.id, "delivered", "synthetic-inspected-actual-receipt");
});

test("muting is item-specific and equivalent timezone instants share the same summary window", t => {
  const f = fixture(t); seed(f.root, 2); enable(f.root, f.write);
  saveAttentionPreferences(f.root, { muted: [itemKey(item(1))], sourceReference: "synthetic-mute-one" });
  assert.equal(nextAttention(f.root, now).eligible, 1);
  const d = prepareAttentionDelivery(f.root, now); if (d.action !== "prepared") return assert.fail("Expected preparation");
  authorizeAttentionDelivery(f.root, d.id, now); observeAttentionDelivery(f.root, d.id, "delivered", "synthetic-receipt");
  assert.equal(prepareAttentionDelivery(f.root, "2026-11-06T11:00:00+01:00").action, "quiet");
});

test("unavailable notification capability still permits snooze/pause and cannot redirect proof reads into Blocked", t => {
  const f = fixture(t); seed(f.root, 1); enable(f.root, f.write);
  const path = ".local/attention-capability.json", capability = readPrivateJson(f.root, path).data as any;
  capability.evidence = [{ path: "Task Board/Blocked/APP-001.md", sha256: "a".repeat(64) }];
  f.write(path, JSON.stringify(capability));
  const read = fs.readFileSync;
  try {
    fs.readFileSync = ((path: fs.PathOrFileDescriptor, ...args: any[]) => { if (String(path).replaceAll("\\", "/").includes("Task Board/Blocked")) throw new Error("Prohibited Blocked read"); return (read as Function)(path, ...args); }) as typeof fs.readFileSync;
    syncBuiltinESMExports(); assert.throws(() => prepareAttentionDelivery(f.root, now), /dedicated notification rehearsal evidence/);
  } finally { fs.readFileSync = read; syncBuiltinESMExports(); }
  assert.equal(snoozeAttention(f.root, later, "synthetic-snooze", now).snoozedUntil, later);
  assert.equal(saveAttentionPreferences(f.root, { paused: true, sourceReference: "synthetic-pause" }).paused, true);
  assert.throws(() => snoozeAttention(f.root, "2026-11-07 12:00", "synthetic-ambiguous", now), /timezone offset/);
});

test("routine focus detection never opens the retained canonical answer proposal", t => {
  const f = fixture(t); seed(f.root, 1); enable(f.root, f.write);
  f.write(".local/onboarding-pending-response.json", "Synthetic retained candidate answer payload must not be read by a reminder.");
  const read = fs.readFileSync;
  try {
    fs.readFileSync = ((path: fs.PathOrFileDescriptor, ...args: any[]) => { if (String(path).replaceAll("\\", "/").endsWith("onboarding-pending-response.json")) throw new Error("Prohibited pending-answer read"); return (read as Function)(path, ...args); }) as typeof fs.readFileSync;
    syncBuiltinESMExports(); assert.equal(nextAttention(f.root, now).suppressed, "conversation"); assert.equal(prepareAttentionDelivery(f.root, now).action, "quiet");
  } finally { fs.readFileSync = read; syncBuiltinESMExports(); }
});

test("a To Do directory alias cannot make reminder metadata enumerate Blocked", t => {
  const f = fixture(t); seed(f.root, 1);
  fs.mkdirSync(resolve(f.root, "Task Board/Blocked"), { recursive: true });
  fs.symlinkSync(resolve(f.root, "Task Board/Blocked"), resolve(f.root, "Task Board/To Do"), process.platform === "win32" ? "junction" : "dir");
  const read = fs.readdirSync; let listed = false;
  try {
    fs.readdirSync = ((...args: any[]) => { listed = true; return (read as Function)(...args); }) as typeof fs.readdirSync; syncBuiltinESMExports();
    assert.throws(() => nextAttention(f.root, now, true), /cannot link/); assert.equal(listed, false);
  } finally { fs.readdirSync = read; syncBuiltinESMExports(); }
});

test("CAPTCHA pause stays pure and its committed metadata uses the exact existing handoff generation", t => {
  const f = fixture(t), a = item();
  const task: ApplicationTask = { taskId: a.taskId, originalIntake: "To Do", checkpoint: "prepared", selectedRoleId: "synthetic-role", cvVersion: "synthetic-v1", cvSha256: "b".repeat(64),
    browserExecution: { defaultBrowser: "playwright", activeBrowser: "playwright", requiresFileUpload: true, handoffs: [] } };
  const paused = pauseForCaptcha(task, { handoffId: "actual-synthetic-handoff", jobUrl: "https://example.invalid/jobs/1", sessionReference: "synthetic-session", sessionAccess: "visible", draftReference: null,
    checkpointReference: ".local/synthetic-draft.md", evidenceReference: ".local/synthetic-captcha.md", accessContextPath: "Job Context/Job Boards/Synthetic/access-and-instructions.local.md", lastCompletedStep: "Synthetic form prepared", observedAt: now });
  assert.equal(fs.existsSync(resolve(f.root, attentionFile)), false);
  const row = attentionForTask(paused, { path: a.path, sha256: a.ticketHash }, now)!;
  assert.equal(row.generation, "actual-synthetic-handoff"); assert.equal(row.kind, "captcha");
  assert.ok(!JSON.stringify(row).includes("synthetic-session")); assert.ok(!JSON.stringify(row).includes("example.invalid"));
  assert.equal(attentionForTask({ ...task, blocker: { reason: "Agent-recoverable discovery", contextPath: ".local/context.md", lastCompletedStep: "Page loaded", nextAction: "Inspect navigation", resumeCheckpoint: "page" } }, { path: a.path, sha256: a.ticketHash }, now), null);
});
