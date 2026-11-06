import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { alertFixture, bindFixture, fixtureNow, writeFixture } from "./email-fixture.js";
import { readySite } from "./sites-fixture.js";
import { classifyMessage, intakeDecision, validateInboxState } from "../email/intake.js";
import { loadInboxState, saveEmailRecord, saveInboxState, alertOwnershipKey } from "../email/state-store.js";
import { verifyAlertCompletion, taskRecordBlock } from "../email/verification.js";
import { cleanupCompletedAlert, prepareNativeCleanup, cancelNativeCleanup } from "../email/cleanup.js";
import { requeueMovedEmailTicket } from "../email/requeue.js";
import { listIntakeTickets } from "../workflow/intake.js";
import { acquireOwnership } from "../workflow/ownership.js";
import { digest, evidenceFile, readEvidence } from "../email/evidence.js";
import { canMarkApplied, markSubmissionAttempted, type ApplicationTask } from "../workflow/application-state.js";
import { bindTaskTicket, transitionTask, recoverTaskTransition, loadTaskControl, assertTaskActive, recordTaskCheckpoint,
  resumeMovedDeferredTask, refreshTaskTicket, saveTaskTicket, taskOwnershipKey, authorizeTaskAction, assertAuthorizedTaskAction, observeTaskAction, requestTaskStop } from "../workflow/task-control.js";
import { ticketFolder } from "../workflow/board.js";
import { readPrivateJson } from "../workflow/private-json.js";

function manual(t: Parameters<typeof alertFixture>[0]) {
  const f = alertFixture(t, 1);
  const task: ApplicationTask = { taskId: "APP-lifecycle-manual", originalIntake: "To Do", checkpoint: "working" };
  const path = `Task Board/To Do/${task.taskId}.md`;
  writeFixture(f.root, path, "# Synthetic manual application\nPreserved draft checkpoint.\n");
  const authority = writeFixture(f.root, ".local/lifecycle-authority.md", "Synthetic explicit user instruction to cancel/defer/restore this selected task. Completed cancellations may follow the selected cleanup policy.");
  return { ...f, task, path, authority, actor: "synthetic-user", reason: "User selected this lifecycle action.", observedAt: fixtureNow };
}
function email(t: Parameters<typeof alertFixture>[0], count = 1) {
  const f = manual(t), identity = { ...f.identity, messageId: "synthetic-lifecycle" };
  const record = bindFixture(f.root, classifyMessage({ ...identity, from: "alerts@example.invalid", timestamp: fixtureNow }, "jobAlert", "lifecycle", f.authority.path, f.authority.path, fixtureNow), count);
  const tasks = record.vacancies.map((v, i) => {
    const task: ApplicationTask = { taskId: `APP-lifecycle-email-${i}`, originalIntake: "Email Alerts", checkpoint: "working" };
    const path = `Task Board/Email Alerts/${task.taskId}.md`;
    const ticket = writeFixture(f.root, path, `# ${task.taskId}\nSynthetic original email assignment.\n`);
    Object.assign(v, { disposition: "pending", taskId: task.taskId, taskPath: path, taskEvidence: ticket });
    delete v.outcomeEvidence; delete v.confirmationReference; delete v.applicationRecordSaved;
    return { task, path };
  });
  saveEmailRecord(f.root, record, loadInboxState(f.root).revision);
  const current = () => loadInboxState(f.root).state.messages.find(r => r.identity.messageId === identity.messageId)!;
  return { ...f, ...tasks[0], identity, record, tasks, current, options: { ...f.options, identity } };
}

test("manual cancellation and deferral preserve identity, checkpoint and history without a role/CV", t => {
  for (const action of ["cancel", "defer"] as const) {
    const f = manual(t), old = fs.readFileSync(resolve(f.root, f.path));
    const result = transitionTask({ ...f, action });
    assert.equal(result.kind, "moved");
    if (result.kind !== "moved") return;
    assert.equal(ticketFolder(result.path), action === "cancel" ? "Cancelled" : "Deferred");
    assert.equal(fs.existsSync(resolve(f.root, f.path)), false);
    assert.ok(fs.readFileSync(resolve(f.root, result.path)).subarray(0, old.length).equals(old));
    const data = loadTaskControl(f.root, f.task.taskId).data!;
    assert.equal(data.task.checkpoint, "working"); assert.equal(data.task.taskId, f.task.taskId);
    assert.equal(data.history.length, 1); assert.throws(() => assertTaskActive(f.root, f.task), /stopped/);
    assert.equal(execFileSync("git", ["-C", f.root, "check-ignore", "--no-index", result.path], { encoding: "utf8" }).trim(), result.path);
  }
});
test("a restored cancellation reuses the existing ticket and leaves its cancellation history intact", t => {
  const f = manual(t), cancelled = transitionTask({ ...f, action: "cancel" });
  if (cancelled.kind !== "moved") return;
  const restored = transitionTask({ ...f, path: cancelled.path, action: "restore" });
  assert.equal(restored.kind, "moved");
  assert.equal(loadTaskControl(f.root, f.task.taskId).data!.history.length, 2);
  assert.equal(loadTaskControl(f.root, f.task.taskId).data!.path, f.path);
  assert.doesNotThrow(() => assertTaskActive(f.root, f.task));
});
test("Deferred, Cancelled, Blocked and Applied are never traversed as intake", t => {
  const f = manual(t);
  writeFixture(f.root, "Task Board/Email Alerts/active.md", "Synthetic active assignment");
  for (const folder of ["Deferred", "Cancelled", "Blocked", "Applied"]) writeFixture(f.root, `Task Board/${folder}/do-not-open.md`, "Private inactive work");
  const seen: string[] = [];
  const list = ((path: fs.PathLike, options: any) => { seen.push(String(path)); assert.match(String(path), /(?:Email Alerts|To Do)$/); return fs.readdirSync(path, options); }) as typeof fs.readdirSync;
  listIntakeTickets(f.root, list); assert.equal(seen.length, 2);
});
test("a moved Deferred email ticket resumes the same source without reading its old inactive path", t => {
  const f = email(t), moved = transitionTask({ ...f, action: "defer" });
  if (moved.kind !== "moved") return;
  const next = `Task Board/To Do/${f.task.taskId}.md`;
  fs.mkdirSync(resolve(f.root, "Task Board/To Do"), { recursive: true }); fs.renameSync(resolve(f.root, moved.path), resolve(f.root, next));
  assert.equal(requeueMovedEmailTicket(f.root, next, fixtureNow).kind, "requeued");
  const vacancy = f.current().vacancies[0];
  assert.equal(vacancy.taskId, f.task.taskId); assert.equal(vacancy.disposition, "pending"); assert.equal(vacancy.taskPath, next);
  assert.equal(f.current().identity.messageId, f.identity.messageId);
  assert.equal(loadTaskControl(f.root, f.task.taskId).data!.history.length, 2);
});
test("moving and editing a Deferred ticket requires explicit reconciliation", t => {
  const f = email(t), moved = transitionTask({ ...f, action: "defer" }); if (moved.kind !== "moved") return;
  const next = `Task Board/To Do/${f.task.taskId}.md`;
  fs.mkdirSync(resolve(f.root, "Task Board/To Do"), { recursive: true }); fs.renameSync(resolve(f.root, moved.path), resolve(f.root, next));
  fs.appendFileSync(resolve(f.root, next), "Unreviewed edit");
  const before = loadInboxState(f.root).revision;
  assert.throws(() => requeueMovedEmailTicket(f.root, next, fixtureNow), /edited/);
  assert.equal(loadInboxState(f.root).revision, before);
});
test("cancelling a selected Blocked task does not resolve its CAPTCHA or require invented candidate fields", t => {
  const f = manual(t), path = `Task Board/Blocked/${f.task.taskId}.md`;
  fs.mkdirSync(resolve(f.root, "Task Board/Blocked"), { recursive: true }); fs.renameSync(resolve(f.root, f.path), resolve(f.root, path));
  f.task.blocker = { kind: "captcha", reason: "Synthetic CAPTCHA", contextPath: ".local/site.md", lastCompletedStep: "Draft", nextAction: "Human challenge", resumeCheckpoint: "Draft" };
  transitionTask({ ...f, path, action: "cancel" });
  assert.equal(loadTaskControl(f.root, f.task.taskId).data!.task.blocker!.resolvedAt, undefined);
});
test("confirmed submissions cannot be cancelled or deferred", t => {
  const f = manual(t); f.task.checkpoint = "confirmed"; f.task.confirmation = { reference: "actual synthetic receipt", observedAt: fixtureNow };
  assert.throws(() => transitionTask({ ...f, action: "cancel" }), /confirmed/);
  assert.ok(fs.existsSync(resolve(f.root, f.path)));
});
test("uncertain submissions retain their attempt and become stop requests rather than concluded cancellations", t => {
  const f = manual(t); f.task.checkpoint = "submissionAttempted";
  assert.equal(transitionTask({ ...f, action: "cancel" }).kind, "requested");
  assert.equal(loadTaskControl(f.root, f.task.taskId).data!.task.checkpoint, "submissionAttempted");
  assert.ok(fs.existsSync(resolve(f.root, f.path)));
  assert.throws(() => recordTaskCheckpoint(f.root, { ...f.task, checkpoint: "working" }), /Preserve/);
});
test("active owners receive a durable stop request instead of having their ticket moved", t => {
  const f = manual(t); bindTaskTicket(f.root, f.task, f.path);
  const owner = acquireOwnership(f.root, taskOwnershipKey(f.task.taskId), { kind: "native", ownerId: "synthetic-browser-owner" });
  try {
    assert.equal(transitionTask({ ...f, action: "defer" }).kind, "requested");
    assert.ok(fs.existsSync(resolve(f.root, f.path)));
    assert.throws(() => assertTaskActive(f.root, f.task), /stopped/);
  } finally { owner.release(); }
  assert.equal(transitionTask({ ...f, action: "defer" }).kind, "moved");
});
test("Cancelled email assignments need separate cleanup authority and Deferred siblings retain their alert", t => {
  const f = email(t, 2);
  transitionTask({ ...f, action: "cancel", cleanupAuthority: f.authority });
  transitionTask({ ...f, ...f.tasks[1], action: "defer" });
  assert.throws(() => verifyAlertCompletion(f.root, f.current()), /unresolved/);
  assert.equal(intakeDecision(f.current(), { ...f.identity, from: "alerts@example.invalid", timestamp: fixtureNow }, "lifecycle"), "waiting");
  transitionTask({ ...f, task: f.tasks[1].task, path: `Task Board/Deferred/${f.tasks[1].task.taskId}.md`, action: "cancel", cleanupAuthority: f.authority });
  assert.equal(verifyAlertCompletion(f.root, f.current()).cancelled, 2);
  assert.equal(verifyAlertCompletion(f.root, f.current()).applied, 0);
  assert.equal(loadInboxState(f.root).state.schemaVersion, 3);
});
test("cancellation without cleanup policy authority remains retained and nonactionable", t => {
  const f = email(t); transitionTask({ ...f, action: "cancel" });
  assert.throws(() => verifyAlertCompletion(f.root, f.current()), /unresolved/);
  assert.equal(intakeDecision(f.current(), { ...f.identity, from: "alerts@example.invalid", timestamp: fixtureNow }, "lifecycle"), "waiting");
});
test("a changed cancellation instruction invalidates cleanup proof", t => {
  const f = email(t); transitionTask({ ...f, action: "cancel", cleanupAuthority: f.authority });
  fs.appendFileSync(resolve(f.root, f.authority.path), "Changed instruction");
  assert.throws(() => verifyAlertCompletion(f.root, f.current()), /changed/);
});
test("legacy schema 2 remains readable and new lifecycle data cannot be downgraded", t => {
  const f = email(t); assert.equal(loadInboxState(f.root).state.schemaVersion, 2);
  transitionTask({ ...f, action: "defer" });
  const found = loadInboxState(f.root);
  assert.throws(() => validateInboxState({ ...found.state, schemaVersion: 2 }), /schema 3/);
  assert.throws(() => saveInboxState(f.root, { ...found.state, schemaVersion: 2 }, found.revision));
});
test("guarded ticket saves preserve the source association and detect stale hashes", t => {
  const f = email(t), bound = bindTaskTicket(f.root, f.task, f.path);
  const ticket = saveTaskTicket(f.root, f.task.taskId, Buffer.from("# Reviewed synthetic application progress\n"), bound.ticket!.sha256);
  assert.deepEqual(f.current().vacancies[0].taskEvidence, ticket);
  assert.equal(loadTaskControl(f.root, f.task.taskId).data!.edits!.length, 1);
  assert.doesNotThrow(() => assertTaskActive(f.root, { ...bound, ticket }));
  assert.throws(() => saveTaskTicket(f.root, f.task.taskId, Buffer.from("Stale write"), bound.ticket!.sha256), /Reload/);
});
test("destination collisions and stale authority cannot overwrite or move an application", t => {
  const f = manual(t); writeFixture(f.root, `Task Board/Cancelled/${f.task.taskId}.md`, "Other preserved work");
  assert.throws(() => transitionTask({ ...f, action: "cancel" }), /already exists/);
  assert.ok(fs.existsSync(resolve(f.root, f.path)));
  assert.throws(() => transitionTask({ ...f, action: "defer", authority: { ...f.authority, sha256: "0".repeat(64) } }), /changed/);
});
test("an interrupted email move recovers the same ticket and source, with cleanup frozen until recovery", t => {
  const f = email(t), original = fs.unlinkSync;
  const mock = t.mock.method(fs, "unlinkSync", (path: fs.PathLike) => { if (String(path) === resolve(f.root, f.path)) throw new Error("Synthetic interruption before source removal"); return original(path); });
  assert.throws(() => transitionTask({ ...f, action: "cancel", cleanupAuthority: f.authority }), /Synthetic interruption/);
  assert.ok(loadTaskControl(f.root, f.task.taskId).data!.transition);
  assert.throws(() => transitionTask({ ...f, action: "defer" }), /Recover the existing/);
  assert.throws(() => verifyAlertCompletion(f.root, f.current()), /unresolved/);
  const before = loadInboxState(f.root), changed = structuredClone(f.current()); delete changed.vacancies[0].taskTransition;
  assert.throws(() => saveEmailRecord(f.root, changed, before.revision), /transition/);
  mock.mock.restore(); assert.equal(recoverTaskTransition(f.root, f.task.taskId).kind, "moved");
  assert.equal(recoverTaskTransition(f.root, f.task.taskId).kind, "nothingToRecover");
  assert.equal(verifyAlertCompletion(f.root, f.current()).cancelled, 1);
  assert.equal(loadTaskControl(f.root, f.task.taskId).data!.history.length, 1);
});
test("another alert owner blocks a transition without stealing its claim", t => {
  const f = email(t), before = loadInboxState(f.root).revision;
  const owner = acquireOwnership(f.root, alertOwnershipKey(f.identity), { kind: "native", ownerId: "synthetic-cleanup-owner" });
  try { assert.throws(() => transitionTask({ ...f, action: "defer" }), /owns/); }
  finally { owner.release(); }
  assert.equal(loadInboxState(f.root).revision, before);
  assert.equal(recoverTaskTransition(f.root, f.task.taskId).kind, "nothingToRecover");
  assert.equal(transitionTask({ ...f, action: "defer" }).kind, "moved");
});
test("restoring a cancelled task after handled-source cleanup preserves the completed marker and immutable proof", async t => {
  const f = email(t); const cancelled = transitionTask({ ...f, action: "cancel", cleanupAuthority: f.authority }); if (cancelled.kind !== "moved") return;
  const result = await cleanupCompletedAlert({ ...f.options, transport: { source: f.identity.source, listPage: async () => ({ messages: [] }), readMessage: async () => { throw new Error("No real inbox"); }, applyCleanup: async () => ({ evidenceReference: "synthetic-message-cleanup", observedAt: fixtureNow }) } });
  assert.equal(result.state, "complete"); const frozen = JSON.stringify(f.current());
  transitionTask({ ...f, path: cancelled.path, action: "restore" });
  assert.equal(JSON.stringify(f.current()), frozen);
  assert.equal(loadTaskControl(f.root, f.task.taskId).data!.source!.completed, true);
  assert.equal(verifyAlertCompletion(f.root, f.current()).cancelled, 1);
  const control = loadTaskControl(f.root, f.task.taskId).data!;
  saveTaskTicket(f.root, f.task.taskId, Buffer.from("# Reviewed restored-cycle progress\n"), control.ticket.sha256);
  assert.equal(JSON.stringify(f.current()), frozen);
  const deferred = transitionTask({ ...f, path: control.path, action: "defer" }); if (deferred.kind !== "moved") return;
  const next = `Task Board/To Do/${f.task.taskId}.md`;
  fs.renameSync(resolve(f.root, deferred.path), resolve(f.root, next));
  assert.equal(requeueMovedEmailTicket(f.root, next, fixtureNow).kind, "requeued");
  assert.equal(JSON.stringify(f.current()), frozen);
});
test("a pending native cleanup snapshot is not frozen by an unowned restore request", async t => {
  const f = email(t); const cancelled = transitionTask({ ...f, action: "cancel", cleanupAuthority: f.authority }); if (cancelled.kind !== "moved") return;
  const prepared = await prepareNativeCleanup({ ...f.options, ownerId: "synthetic-cleanup-before-restore" });
  if (prepared.state !== "prepared") assert.fail("Expected a prepared owned cleanup");
  assert.throws(() => transitionTask({ ...f, path: cancelled.path, action: "restore" }), /owns/);
  assert.equal(loadTaskControl(f.root, f.task.taskId).data!.transition, undefined);
  assert.equal(verifyAlertCompletion(f.root, f.current()).cancelled, 1);
  cancelNativeCleanup({ ...f.options, ownerId: prepared.ownerId, token: prepared.token });
  assert.equal(transitionTask({ ...f, path: cancelled.path, action: "restore" }).kind, "moved");
});
test("native submission authorization is single-use, and a stale worker cannot submit after a stop request", t => {
  const f = manual(t);
  const prepared: ApplicationTask = { ...f.task, checkpoint: "prepared", selectedRoleId: "synthetic-qa", cvVersion: "v1", cvSha256: "a".repeat(64) };
  const site = readySite(t, prepared, undefined, f.root), bound = bindTaskTicket(f.root, site.task, f.path);
  const action = authorizeTaskAction(f.root, bound, "submit", "synthetic-browser-worker", site.page);
  const attempted = markSubmissionAttempted(bound, f.root, site.page);
  assertAuthorizedTaskAction(f.root, bound.taskId, action.token);
  assert.throws(() => assertAuthorizedTaskAction(f.root, bound.taskId, action.token), /Stop/);
  requestTaskStop(f.root, bound.taskId, { ...f, action: "cancel" });
  const proof = writeFixture(f.root, ".local/attempt-uncertain.json", { synthetic: true, outcome: "unknown" });
  assert.equal(observeTaskAction(f.root, bound.taskId, action.token, "unknown", proof).kind, "uncertain");
  assert.equal(transitionTask({ ...f, task: attempted, action: "cancel" }).kind, "requested");
  const absent = writeFixture(f.root, ".local/not-submitted.json", { synthetic: true, observed: "No submission for this vacancy" });
  observeTaskAction(f.root, bound.taskId, action.token, "notSubmitted", absent);
  assert.equal(transitionTask({ ...f, task: attempted, action: "cancel" }).kind, "moved");
});
test("the task CLI operates only on explicit private proposals and exposes compact status", t => {
  const f = manual(t), proposal = writeFixture(f.root, ".local/transition.json", { ...f, action: "defer" });
  const cli = resolve(import.meta.dirname, "../workflow/task-cli.js");
  const result = JSON.parse(execFileSync(process.execPath, [cli, "transition", "--root", f.root, "--file", proposal.path], { encoding: "utf8", windowsHide: true }));
  assert.equal(result.kind, "moved");
  const status = JSON.parse(execFileSync(process.execPath, [cli, "status", "--root", f.root, "--task-id", f.task.taskId], { encoding: "utf8", windowsHide: true }));
  assert.equal(status.path, `Task Board/Deferred/${f.task.taskId}.md`); assert.equal(status.transitionPending, false);
});
test("ticket paths reject traversal and invalid status folders", () => {
  for (const path of ["Task Board/Deferred/../secret.md", "Task Board/Low priority/a.md", "Task Board/Cancelled/C:bad.md", "Task Board/Cancelled/.md"]) assert.throws(() => ticketFolder(path));
});
test("a manually moved Deferred task resumes through the selected To Do ticket", t => {
  const f = manual(t), moved = transitionTask({ ...f, action: "defer" }); if (moved.kind !== "moved") return;
  fs.renameSync(resolve(f.root, moved.path), resolve(f.root, f.path));
  assert.equal(resumeMovedDeferredTask(f.root, f.task, f.path, fixtureNow).kind, "moved");
  assert.equal(loadTaskControl(f.root, f.task.taskId).data!.history.at(-1)!.action, "resume");
  const originalAuthority = loadTaskControl(f.root, f.task.taskId).data!.history.at(-1)!.authority;
  const second = transitionTask({ ...f, action: "defer" }); if (second.kind !== "moved") return;
  fs.renameSync(resolve(f.root, second.path), resolve(f.root, f.path));
  resumeMovedDeferredTask(f.root, f.task, f.path, fixtureNow);
  assert.doesNotThrow(() => readEvidence(f.root, originalAuthority));
  assert.notEqual(loadTaskControl(f.root, f.task.taskId).data!.history.at(-1)!.authority.path, originalAuthority.path);
});
test("ordinary inbox work cannot silently reactivate a cancelled or deferred assignment", t => {
  const f = email(t); transitionTask({ ...f, action: "cancel", cleanupAuthority: f.authority });
  const record = f.current(); record.vacancies[0].disposition = "pending";
  assert.throws(() => saveEmailRecord(f.root, record, loadInboxState(f.root).revision), /guarded task transition/);
});
test("failure after destination persistence and source removal remains recoverable", t => {
  const f = email(t), original = fs.renameSync; let count = 0;
  const mock = t.mock.method(fs, "renameSync", (from: fs.PathLike, to: fs.PathLike) => {
    if (String(to) === resolve(f.root, ".local/inbox-state.json") && ++count === 2) throw new Error("Synthetic final-ledger failure");
    return original(from, to);
  });
  syncBuiltinESMExports();
  t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
  assert.throws(() => transitionTask({ ...f, action: "cancel", cleanupAuthority: f.authority }), /Synthetic final-ledger/);
  assert.equal(fs.existsSync(resolve(f.root, f.path)), false);
  assert.ok(f.current().vacancies[0].taskTransition);
  mock.mock.restore(); syncBuiltinESMExports(); assert.equal(recoverTaskTransition(f.root, f.task.taskId).kind, "moved");
  assert.equal(verifyAlertCompletion(f.root, f.current()).cancelled, 1);
});
test("a failure at the final control commit prevents cleanup until the same journal is recovered", t => {
  const f = email(t), original = fs.renameSync;
  const control = resolve(f.root, `.local/task-controls/${digest(f.task.taskId)}.json`);
  const mock = t.mock.method(fs, "renameSync", (from: fs.PathLike, to: fs.PathLike) => {
    if (String(to) === control) { const value = JSON.parse(fs.readFileSync(from, "utf8")); if (value.history.length === 1 && !value.transition) throw new Error("Synthetic control-commit failure"); }
    return original(from, to);
  });
  syncBuiltinESMExports();
  t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
  assert.throws(() => transitionTask({ ...f, action: "cancel", cleanupAuthority: f.authority }), /Synthetic control/);
  assert.throws(() => verifyAlertCompletion(f.root, f.current()), /Recover the task move/);
  mock.mock.restore(); syncBuiltinESMExports(); recoverTaskTransition(f.root, f.task.taskId);
  assert.equal(loadTaskControl(f.root, f.task.taskId).data!.history.length, 1);
  assert.equal(verifyAlertCompletion(f.root, f.current()).cancelled, 1);
});
test("mixed Applied and Cancelled vacancies retain distinct counts and confirmation evidence", t => {
  const f = email(t, 2), current = f.current(), v = current.vacancies[1];
  const key = current.inventory!.messageKey;
  // Active assignments cannot change task IDs; materialize a confirmation for this exact existing task instead.
  const proof = writeFixture(f.root, ".local/sibling-confirmation.json", { vacancyKey: v.vacancyKey, reference: "sibling-receipt", synthetic: true });
  const confirmed: ApplicationTask = { ...f.tasks[1].task, checkpoint: "confirmed", selectedRoleId: "qa", cvVersion: "v1", cvSha256: "a".repeat(64), confirmation: { reference: "sibling-receipt", observedAt: fixtureNow } };
  const path = `Task Board/Applied/${v.taskId}.md`;
  Object.assign(v, { disposition: "applied", taskPath: path, applicationRecordSaved: true, confirmationReference: "sibling-receipt",
    taskEvidence: writeFixture(f.root, path, taskRecordBlock({ schemaVersion: 1, messageKey: key, vacancyKey: v.vacancyKey, postingUrl: v.postingUrl!, task: confirmed, confirmationEvidence: proof })),
    outcomeEvidence: writeFixture(f.root, ".local/sibling-outcome.json", { schemaVersion: 1, messageKey: key, vacancyKey: v.vacancyKey, postingUrl: v.postingUrl, kind: "applied", taskId: v.taskId, confirmationReference: "sibling-receipt", observedAt: fixtureNow, evidence: proof }) });
  saveEmailRecord(f.root, current, loadInboxState(f.root).revision);
  transitionTask({ ...f, action: "cancel", cleanupAuthority: f.authority });
  const report = verifyAlertCompletion(f.root, f.current()); assert.equal(report.applied, 1); assert.equal(report.cancelled, 1);
});
test("known submission success after a stop request stays confirmed and can finish Applied", t => {
  const f = manual(t), prepared: ApplicationTask = { ...f.task, checkpoint: "prepared", selectedRoleId: "qa", cvVersion: "v1", cvSha256: "a".repeat(64) };
  const site = readySite(t, prepared, undefined, f.root), bound = bindTaskTicket(f.root, site.task, f.path);
  const action = authorizeTaskAction(f.root, bound, "submit", "synthetic-late-stop", site.page);
  const attempted = markSubmissionAttempted(bound, f.root, site.page); assertAuthorizedTaskAction(f.root, f.task.taskId, action.token);
  requestTaskStop(f.root, f.task.taskId, { ...f, action: "cancel" });
  const proof = writeFixture(f.root, ".local/actual-receipt.json", { synthetic: true, reference: "late-stop-receipt" });
  const confirmed: ApplicationTask = { ...attempted, checkpoint: "confirmed", confirmation: { reference: "late-stop-receipt", observedAt: fixtureNow } };
  observeTaskAction(f.root, f.task.taskId, action.token, "confirmed", proof, confirmed);
  const old = loadTaskControl(f.root, f.task.taskId).data!, path = `Task Board/Applied/${f.task.taskId}.md`;
  fs.mkdirSync(resolve(f.root, "Task Board/Applied"), { recursive: true }); fs.renameSync(resolve(f.root, f.path), resolve(f.root, path));
  refreshTaskTicket(f.root, confirmed, old.ticket.sha256, path);
  assert.equal(loadTaskControl(f.root, f.task.taskId).data!.path, path);
  assert.equal(loadTaskControl(f.root, f.task.taskId).data!.stopHistory!.length, 1);
  assert.ok(canMarkApplied(confirmed));
});
test("existing Blocked moves and user requeue can refresh selected control without scanning old paths", t => {
  const f = manual(t); bindTaskTicket(f.root, f.task, f.path);
  const old = loadTaskControl(f.root, f.task.taskId).data!;
  const blocked: ApplicationTask = { ...f.task, blocker: { reason: "Answer needed", contextPath: ".local/answers.md", lastCompletedStep: "Questions", nextAction: "User supplies answer", resumeCheckpoint: "Questions" } };
  const path = `Task Board/Blocked/${f.task.taskId}.md`;
  fs.mkdirSync(resolve(f.root, "Task Board/Blocked"), { recursive: true }); fs.renameSync(resolve(f.root, f.path), resolve(f.root, path));
  refreshTaskTicket(f.root, blocked, old.ticket.sha256, path);
  assert.throws(() => assertTaskActive(f.root, blocked), /stopped/);
  fs.renameSync(resolve(f.root, path), resolve(f.root, f.path));
  refreshTaskTicket(f.root, blocked, old.ticket.sha256, f.path);
  assert.equal(loadTaskControl(f.root, f.task.taskId).data!.task.blocker!.resolvedAt, undefined);
});
test("an uncertain upload cannot be bypassed through a cached task or the ordinary site guard", t => {
  const f = manual(t), prepared: ApplicationTask = { ...f.task, checkpoint: "prepared", selectedRoleId: "qa", cvVersion: "v1", cvSha256: "a".repeat(64) };
  const site = readySite(t, prepared, undefined, f.root), task = bindTaskTicket(f.root, site.task, f.path);
  const action = authorizeTaskAction(f.root, task, "upload", "synthetic-upload-worker", site.page);
  assertAuthorizedTaskAction(f.root, task.taskId, action.token);
  const proof = writeFixture(f.root, ".local/upload-inspection.json", { synthetic: true, observed: "Unknown upload outcome" });
  observeTaskAction(f.root, task.taskId, action.token, "unknown", proof);
  assert.throws(() => assertTaskActive(f.root, task), /stopped/);
  const completed = writeFixture(f.root, ".local/upload-completed.json", { synthetic: true, observed: "Same upload now confirmed" });
  observeTaskAction(f.root, task.taskId, action.token, "completed", completed);
  assert.doesNotThrow(() => assertTaskActive(f.root, task));
});
test("a changed source pointer stops a bound stale worker before browser execution", t => {
  const f = email(t), task = bindTaskTicket(f.root, f.task, f.path);
  const record = f.current(); record.vacancies[0].disposition = "blocked";
  saveEmailRecord(f.root, record, loadInboxState(f.root).revision);
  assert.throws(() => assertTaskActive(f.root, task), /stopped or changed source/);
});
test("prior ticket snapshots survive repeated content after an email task is requeued in To Do", t => {
  const f = email(t), bound = bindTaskTicket(f.root, f.task, f.path), original = fs.readFileSync(resolve(f.root, f.path));
  const changed = saveTaskTicket(f.root, f.task.taskId, Buffer.from("Synthetic revised draft"), bound.ticket!.sha256);
  const restored = saveTaskTicket(f.root, f.task.taskId, original, changed.sha256);
  const firstSnapshot = loadTaskControl(f.root, f.task.taskId).data!.edits![0];
  const task: ApplicationTask = { ...f.task, blocker: { reason: "Answer needed", contextPath: ".local/answers.md", lastCompletedStep: "Questions", nextAction: "Supply answer", resumeCheckpoint: "Questions" } };
  const blocked = `Task Board/Blocked/${f.task.taskId}.md`, next = `Task Board/To Do/${f.task.taskId}.md`;
  fs.mkdirSync(resolve(f.root, "Task Board/Blocked"), { recursive: true }); fs.renameSync(resolve(f.root, f.path), resolve(f.root, blocked));
  const record = f.current(); Object.assign(record.vacancies[0], { disposition: "blocked", taskPath: blocked, taskEvidence: evidenceFile(f.root, blocked) });
  saveEmailRecord(f.root, record, loadInboxState(f.root).revision);
  refreshTaskTicket(f.root, task, restored.sha256, blocked);
  fs.renameSync(resolve(f.root, blocked), resolve(f.root, next));
  requeueMovedEmailTicket(f.root, next, fixtureNow); refreshTaskTicket(f.root, task, restored.sha256, next);
  assert.doesNotThrow(() => saveTaskTicket(f.root, f.task.taskId, Buffer.from("Synthetic latest reviewed draft"), restored.sha256));
  assert.doesNotThrow(() => readEvidence(f.root, firstSnapshot));
  assert.equal(loadTaskControl(f.root, f.task.taskId).data!.edits!.length, 3);
});
