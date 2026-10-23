import test from "node:test";
import assert from "node:assert/strict";
import { assertTaskMove, canMarkApplied, messageReadyForDeletion, DiscoveryRequired,
  type ApplicationTask, type MessageProgress } from "./application-state.js";

// Synthetic fixture values, not candidate data or real application evidence.
const confirmed = (): ApplicationTask => ({
  taskId: "APP-fixture", originalIntake: "Email Alerts", selectedRoleId: "fixture-role",
  cvVersion: "fixture-1", cvSha256: "a".repeat(64), checkpoint: "confirmed",
  confirmation: { reference: "fixture-receipt", observedAt: "2026-10-23T10:00:00Z" },
});
const complete = (): MessageProgress => ({
  inboxId: "fixture@example.invalid", messageId: "fixture-message",
  enumerationComplete: true, cleanupState: "cleanupPending", vacancies: [{
    vacancyKey: "fixture-job", disposition: "applied", taskId: "APP-fixture",
    taskPath: "Task Board/Applied/APP-fixture.md", applicationRecordSaved: true,
    confirmationReference: "fixture-receipt",
  }],
});

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

test("blocked resumption requires resolution evidence and returns to original intake", () => {
  const task = confirmed(); task.blocker = { reason: "Missing answer",
    lastCompletedStep: "Questions", contextPath: "answers.local.md",
    nextAction: "Answer question", resumeCheckpoint: "Questions" };
  assert.throws(() => assertTaskMove(task, "Blocked", "Email Alerts"));
  task.blocker.resolvedAt = "2026-10-23T11:00:00Z";
  task.blocker.resolutionEvidence = "Required factual answer supplied and inspected";
  assert.doesNotThrow(() => assertTaskMove(task, "Blocked", "Email Alerts"));
  assert.throws(() => assertTaskMove(task, "Blocked", "To Do"));
  assert.throws(() => assertTaskMove(task, "Blocked", "Applied"));
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
    const module = await import(`../Site Architecture Context/${path}/playwright/application-flow.js`);
    const page = new Proxy({}, { get() { assert.fail("Unlearned code touched a browser"); } });
    await assert.rejects(module.executeApplication(page, {}), DiscoveryRequired);
  }
});
