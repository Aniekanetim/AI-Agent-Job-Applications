import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { resolve } from "node:path";
import { listIntakeTickets } from "../workflow/intake.js";
import { requeueMovedEmailTicket } from "../email/requeue.js";
import { loadInboxState, saveEmailRecord } from "../email/state-store.js";
import { classifyMessage } from "../email/intake.js";
import { alertFixture, fixtureNow, writeFixture } from "./email-fixture.js";
import { acquireOwnership } from "../workflow/ownership.js";
import { alertOwnershipKey } from "../email/state-store.js";
import { saveAlertArtifact } from "../email/artifact-store.js";
import { assertTaskMove, canMarkApplied, messageReadyForDeletion, DiscoveryRequired,
  type ApplicationTask, type MessageProgress } from "../workflow/application-state.js";

// Synthetic fixture values, not candidate data or real application evidence.
const confirmed = (): ApplicationTask => ({
  taskId: "APP-fixture", originalIntake: "Email Alerts", selectedRoleId: "fixture-role",
  cvVersion: "fixture-1", cvSha256: "a".repeat(64), checkpoint: "confirmed",
  confirmation: { reference: "fixture-receipt", observedAt: "2026-10-23T10:00:00Z" },
});
const complete = (): MessageProgress => attachInventory({
  inboxId: "fixture@example.invalid", messageId: "fixture-message",
  enumerationComplete: true, cleanupState: "cleanupPending", vacancies: [{
    vacancyKey: "fixture-job", disposition: "applied", taskId: "APP-fixture",
    taskPath: "Task Board/Applied/APP-fixture.md", applicationRecordSaved: true,
    confirmationReference: "fixture-receipt",
  }],
});
function attachInventory(email: MessageProgress) {
  const ref = { path: ".local/source.json", sha256: "a".repeat(64) };
  email.vacancies.forEach((v, i) => { v.postingUrl = `https://example.invalid/jobs/${i}`; v.outcomeEvidence = { ...ref, path: `.local/outcome-${i}.json` }; if (v.taskPath) v.taskEvidence = { ...ref, path: v.taskPath }; });
  email.inventory = { schemaVersion: 1, messageKey: "b".repeat(64), source: ref,
    candidates: email.vacancies.map((v, i) => ({ candidateId: `link-${i}`, href: v.postingUrl! })),
    decisions: email.vacancies.map((v, i) => ({ candidateId: `link-${i}`, kind: "posting", vacancyKey: v.vacancyKey, postingUrl: v.postingUrl, evidence: ref })) };
  return email;
}

test("a click/attempt alone cannot become Applied", () => {
  const task = confirmed(); task.checkpoint = "submissionAttempted";
  assert.equal(canMarkApplied(task), false);
  assert.throws(() => assertTaskMove(task, "Email Alerts", "Applied"));
});

test("an Applied move requires the actual selected role and versioned CV identity", () => {
  for (const field of ["selectedRoleId", "cvVersion", "cvSha256"] as const) {
    const task = confirmed(); delete task[field];
    assert.equal(canMarkApplied(task), false);
  }
  const task = confirmed(); task.cvSha256 = "not-a-hash";
  assert.equal(canMarkApplied(task), false);
});

test("a confirmation requires a receipt reference and an actual timestamp", () => {
  const task = confirmed(); delete task.confirmation;
  assert.equal(canMarkApplied(task), false);
  task.confirmation = { reference: "receipt", observedAt: "not-a-date" };
  assert.equal(canMarkApplied(task), false);
});

test("a confirmed versioned application can move from either original intake", () => {
  assert.doesNotThrow(() => assertTaskMove(confirmed(), "Email Alerts", "Applied"));
  const manual = confirmed(); manual.originalIntake = "To Do";
  assert.doesNotThrow(() => assertTaskMove(manual, "To Do", "Applied"));
});

test("blocked tasks must name the dependency, context file and resume action", () => {
  const task = confirmed();
  assert.throws(() => assertTaskMove(task, "Email Alerts", "Blocked"));
  task.blocker = { reason: "Required answer absent", lastCompletedStep: "Form page 2",
    contextPath: "Job Context/Candidate/Role Profiles/Fixture/application-answers.local.md",
    nextAction: "Supply the factual answer", resumeCheckpoint: "Form page 2" };
  assert.doesNotThrow(() => assertTaskMove(task, "Email Alerts", "Blocked"));
  task.blocker.contextPath = "";
  assert.throws(() => assertTaskMove(task, "Email Alerts", "Blocked"));
});

test("the user requeues Blocked in To Do without clearing its unresolved dependency", () => {
  const task = confirmed(); task.blocker = { reason: "Missing answer",
    lastCompletedStep: "Questions", contextPath: "answers.local.md",
    nextAction: "Answer question", resumeCheckpoint: "Questions" };
  assert.throws(() => assertTaskMove(task, "Blocked", "Email Alerts"));
  assert.doesNotThrow(() => assertTaskMove(task, "Blocked", "To Do"));
  assert.throws(() => assertTaskMove(task, "To Do", "Applied"));
  task.blocker.resolvedAt = "2026-10-23T11:00:00Z";
  task.blocker.resolutionEvidence = "Required factual answer supplied and inspected";
  assert.throws(() => assertTaskMove(task, "Blocked", "Email Alerts"));
  assert.doesNotThrow(() => assertTaskMove(task, "Blocked", "To Do"));
  assert.doesNotThrow(() => assertTaskMove(task, "To Do", "Applied"));
  assert.equal(task.originalIntake, "Email Alerts");
  assert.throws(() => assertTaskMove(task, "Blocked", "Applied"));
});

test("default intake lists only Email Alerts and To Do without traversing Blocked or Applied", t => {
  const f = alertFixture(t, 1);
  writeFixture(f.root, "Task Board/Email Alerts/current.md", "Current task");
  writeFixture(f.root, "Task Board/To Do/requeued.md", "Queued task");
  writeFixture(f.root, "Task Board/Blocked/do-not-read.md", "Unresolved task");
  const visited: string[] = [], original = fs.readdirSync.bind(fs);
  const readDirectory = ((path: fs.PathLike, options: unknown) => {
    visited.push(String(path));
    assert.ok(!String(path).includes("Blocked") && !String(path).includes("Applied"));
    return original(path, options as never);
  }) as typeof fs.readdirSync;
  assert.deepEqual(listIntakeTickets(f.root, readDirectory).map(t => t.path), [
    "Task Board/Email Alerts/current.md", "Task Board/To Do/requeued.md",
  ]);
  assert.equal(visited.length, 2);
});

function movedFixture(t: Parameters<typeof alertFixture>[0]) {
  const f = alertFixture(t, 1), identity = { ...f.identity, messageId: "synthetic-requeue" };
  const record = classifyMessage({ ...identity, from: "alerts@example.invalid", timestamp: fixtureNow },
    "jobAlert", "synthetic-rule", ".local/rules.md", ".local/source.md", fixtureNow);
  const oldPath = "Task Board/Blocked/APP-requeue.md", newPath = "Task Board/To Do/APP-requeue.md";
  const ticket = writeFixture(f.root, oldPath, "# APP-requeue\nOriginal source and saved checkpoint.\n");
  record.vacancies = [{ vacancyKey: "job-requeue", disposition: "blocked", taskId: "APP-requeue", taskPath: oldPath, taskEvidence: ticket }];
  saveEmailRecord(f.root, record, loadInboxState(f.root).revision);
  fs.mkdirSync(resolve(f.root, "Task Board/To Do"), { recursive: true });
  fs.renameSync(resolve(f.root, oldPath), resolve(f.root, newPath));
  return { ...f, identity, oldPath, newPath };
}

test("a user-moved To Do ticket rebinds its exact email assignment without reading Blocked", t => {
  const f = movedFixture(t), result = requeueMovedEmailTicket(f.root, f.newPath, fixtureNow);
  assert.equal(result.kind, "requeued");
  if (result.kind !== "requeued") assert.fail("Expected the original email task");
  assert.equal(result.taskId, "APP-requeue"); assert.equal(result.dependencyVerified, false);
  const record = loadInboxState(f.root).state.messages.find(r => r.identity.messageId === f.identity.messageId)!;
  assert.equal(record.vacancies[0]!.disposition, "pending");
  assert.equal(record.vacancies[0]!.taskEvidence!.path, f.newPath);
  assert.equal(fs.existsSync(resolve(f.root, f.oldPath)), false);
  assert.equal(requeueMovedEmailTicket(f.root, f.newPath, fixtureNow).kind, "notMovedEmailTicket");
});

test("a moved-and-edited ticket requires selected-task reconciliation, never a fresh assignment", t => {
  const f = movedFixture(t), before = loadInboxState(f.root);
  fs.appendFileSync(resolve(f.root, f.newPath), "User reply\n");
  assert.throws(() => requeueMovedEmailTicket(f.root, f.newPath, fixtureNow), /also edited/);
  assert.equal(loadInboxState(f.root).revision, before.revision);
});

test("a requeued email ticket supports guarded To Do writes and preserves source identity", t => {
  const f = movedFixture(t); requeueMovedEmailTicket(f.root, f.newPath, fixtureNow);
  const loaded = loadInboxState(f.root), record = loaded.state.messages.find(r => r.identity.messageId === f.identity.messageId)!;
  const bytes = fs.readFileSync(resolve(f.root, f.newPath));
  assert.doesNotThrow(() => saveAlertArtifact(f.root, f.identity, f.newPath, bytes, record.vacancies[0]!.taskEvidence!.sha256));
  assert.equal(record.vacancies[0]!.taskId, "APP-requeue");
  assert.equal(record.identity.messageId, "synthetic-requeue");
});

test("requeue respects an active alert owner without changing pending work", t => {
  const f = movedFixture(t), owner = acquireOwnership(f.root, alertOwnershipKey(f.identity), { kind: "native", ownerId: "synthetic-owner" });
  const before = loadInboxState(f.root).revision;
  try { assert.throws(() => requeueMovedEmailTicket(f.root, f.newPath, fixtureNow), /owns/); }
  finally { owner.release(); }
  assert.equal(loadInboxState(f.root).revision, before);
});

test("completed tasks are not reopened as intake by a routine check-in", () => {
  assert.throws(() => assertTaskMove(confirmed(), "Applied", "Email Alerts"));
});

test("one confirmed vacancy does not allow deletion of an alert with a blocked sibling", () => {
  const email = complete();
  email.vacancies.push({ vacancyKey: "other-job", disposition: "blocked" });
  assert.equal(messageReadyForDeletion(email), false);
});

test("pending vacancies and incomplete enumeration retain the source email", () => {
  const email = complete(); email.enumerationComplete = false;
  assert.equal(messageReadyForDeletion(email), false);
  email.enumerationComplete = true;
  email.vacancies.push({ vacancyKey: "other-job", disposition: "pending" });
  assert.equal(messageReadyForDeletion(email), false);
});

test("unsaved application records or absent confirmations prevent alert deletion", () => {
  const email = complete(); email.vacancies[0].applicationRecordSaved = false;
  assert.equal(messageReadyForDeletion(email), false);
  email.vacancies[0].applicationRecordSaved = true;
  email.vacancies[0].confirmationReference = null;
  assert.equal(messageReadyForDeletion(email), false);
});

test("a task still in Blocked or an escaping path cannot be treated as persisted Applied", () => {
  for (const path of ["Task Board/Blocked/APP.md", "Task Board/Applied/../APP.md",
    "C:/private/Applied/APP.md", "Task Board/Applied/.md"]) {
    const email = complete(); email.vacancies[0].taskPath = path;
    assert.equal(messageReadyForDeletion(email), false);
  }
});

test("a nonapplication needs a reason and the candidate instruction allowing it", () => {
  const email = complete(); email.vacancies.push({ vacancyKey: "outside-scope",
    disposition: "notApplicable", nonapplicationReason: "Location excluded" });
  assert.equal(messageReadyForDeletion(email), false);
  email.vacancies[1].instructionReference = "fixture preferences: allowed locations";
  attachInventory(email);
  assert.equal(messageReadyForDeletion(email), true);
});

test("empty or inconsistent vacancy enumeration does not authorize deletion", () => {
  const email = complete(); email.vacancies = [];
  assert.equal(messageReadyForDeletion(email), false);
  const repeated = complete(); repeated.vacancies.push({ ...repeated.vacancies[0] });
  assert.equal(messageReadyForDeletion(repeated), false);
});

test("all persisted outcomes allow cleanup without a cross-source history lookup", () => {
  assert.equal(messageReadyForDeletion(complete()), true);
});

test("all six initial site adapters require discovery before any browser action", async () => {
  const paths = ["LinkedIn", "Indeed", "Glassdoor", "CryptoJobsList",
    "LinkedIn/Application destinations/Workday",
    "LinkedIn/Application destinations/Employer career site"];
  for (const path of paths) {
    const module = await import(`../../Site Architecture Context/${path}/playwright/application-flow.js`);
    const page = new Proxy({}, { get() { assert.fail("Unlearned code touched a browser"); } });
    await assert.rejects(module.executeApplication(page, {}), DiscoveryRequired);
  }
});
