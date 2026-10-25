import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, cpSync } from "node:fs";
import { join, dirname, resolve, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { operations, sourceKey, validateCleanup, emailCapabilityIssues, loadEmailConnection, saveEmailConnection,
  type EmailSource, type CleanupChoice, type EmailConnection, type EmailCapabilityReport } from "../email/connection.js";
import { classifyMessage, intakeDecision, messageKey, headerFingerprint, alertWorkComplete, type MailHeader, type EmailRecord } from "../email/intake.js";
import { HostEmailAdapter, listAllHeaders, type HostBindings } from "../email/host-connectors/adapter.js";
import { loadInboxState, saveEmailRecord, saveInboxState, migrateInboxState, inspectEmailReadiness } from "../email/state-store.js";
import { migrateLegacyEmail } from "../email/migration.js";
import { cleanupCompletedAlert } from "../email/cleanup.js";
import { AgentMailInbox } from "../email/agentmail/client.js";
import { agentMailTransport } from "../email/agentmail/adapter.js";
import { configureProgress, createProgress, newBoard } from "../onboarding/progress.js";
import { completedCheck, inspectReadiness } from "../onboarding/state-store.js";
import { bindFixture } from "./email-fixture.js";

const now = "2026-10-25T15:00:00.000Z";
const gmail: EmailSource = { provider: "gmail", accountId: "synthetic-account", mailboxId: "synthetic-mailbox",
  address: "candidate@example.invalid", transport: "hostConnector", connectionReference: "synthetic-host-connection" };
const action = (mode: CleanupChoice["mode"]): CleanupChoice => ({ mode, effect: mode === "delete" ? "trash" : mode,
  labelId: mode === "label" ? "synthetic-handled-label" : null, sourceReference: "synthetic-user-instruction" });
const header: MailHeader = { source: gmail, messageId: "synthetic-message", from: "alerts@example.invalid", subject: "Synthetic job alert", timestamp: now };
function sandbox(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "job-email-intake-"));
  execFileSync("git", ["init", "--quiet", root], { windowsHide: true });
  writeFileSync(join(root, ".gitignore"), ".local/\n"); mkdirSync(join(root, ".local"));
  t.after(() => { const part = relative(tmpdir(), resolve(root)); assert.ok(part && !part.startsWith("..") && !isAbsolute(part)); rmSync(root, { recursive: true }); });
  return root;
}
function setup(t: TestContext, mode: CleanupChoice["mode"] = "retain") {
  const root = sandbox(t);
  const proof = "Synthetic capability evidence; no real mailbox was accessed.";
  writeFileSync(join(root, ".local/proof.md"), proof);
  const connection: EmailConnection = { schemaVersion: 1, source: gmail, selection: { method: "user", sourceReference: "synthetic-reply" },
    scope: { folderOrLabel: "Jobs", query: null, ruleReference: ".local/proof.md", revision: "rules-v1" }, cleanup: action(mode) };
  saveEmailConnection(root, connection, null);
  const report: EmailCapabilityReport = { schemaVersion: 1, sourceKey: sourceKey(gmail), connectionReference: gmail.connectionReference, workingRoot: root,
    executionContext: "interactive", checkedAt: now,
    operations: Object.fromEntries(operations.map(operation => [operation, { status: ["list", "read", mode].includes(operation) ? "verified" : "unsupported",
      granularity: "message", effect: operation === "delete" ? "trash" : ["archive", "label"].includes(operation) ? operation : null,
      requiresConfirmation: false, evidence: [{ path: ".local/proof.md", sha256: createHash("sha256").update(proof).digest("hex") }],
      reason: ["list", "read", mode].includes(operation) ? null : "Synthetic unavailable operation." }])) as EmailCapabilityReport["operations"] };
  const saveReport = () => writeFileSync(join(root, ".local/email-capabilities.json"), JSON.stringify(report)); saveReport();
  const record = classifyMessage(header, "jobAlert", "rules-v1", ".local/proof.md", ".local/proof.md", now);
  bindFixture(root, record);
  saveEmailRecord(root, record, null);
  let calls = 0;
  const bindings: HostBindings = { listPage: async () => ({ messages: [header] }), readMessage: async () => ({ ...header, text: "Synthetic alert body" }),
    cleanup: async () => { calls++; return { evidenceReference: "synthetic-message-level-result", observedAt: now }; },
    observeCleanup: async () => ({ state: "notApplied", evidenceReference: "synthetic-existing-message-check", observedAt: now }) };
  const transport = () => new HostEmailAdapter(connection, report, root, "interactive", bindings);
  const cleanup = (verifyPersistence = async () => true) => cleanupCompletedAlert({ root, connection, report, context: "interactive", transport: transport(), identity: header, now, verifyPersistence });
  return { root, connection, report, saveReport, record, bindings, cleanup, transport, calls: () => calls };
}

test("retained alerts finish without a mutation and their same-message marker prevents reapplication", async t => {
  const f = setup(t);
  assert.equal((await f.cleanup()).state, "complete"); assert.equal(f.calls(), 0);
  const saved = loadInboxState(f.root).state.messages[0];
  assert.equal(saved.cleanupState, "retained"); assert.equal(intakeDecision(saved, header, "rules-v1"), "skip");
  assert.equal((await f.cleanup()).state, "complete"); assert.equal(f.calls(), 0);
  assert.equal(readFileSync(join(f.root, ".local/inbox-state.json"), "utf8").includes("Synthetic alert body"), false);
});
test("delete, archive and label use the user's exact message-level choice", async t => {
  for (const mode of ["delete", "archive", "label"] as const) {
    const f = setup(t, mode); let received: unknown;
    f.bindings.cleanup = async (identity, choice) => { received = { identity, choice }; return { observedAt: now, evidenceReference: "synthetic-result" }; };
    const result = await f.cleanup(); assert.equal(result.state, "complete");
    assert.deepEqual(received, { identity: { source: gmail, messageId: header.messageId }, choice: action(mode) });
    assert.deepEqual(loadInboxState(f.root).state.messages[0].cleanupReceipt?.action, action(mode));
  }
});
test("read-only access is ready for retain mode but never gains cleanup capabilities implicitly", t => {
  const f = setup(t);
  assert.equal(inspectEmailReadiness(f.root, "interactive").ready, true);
  const deleting = { ...f.connection, cleanup: action("delete") };
  assert.ok(emailCapabilityIssues(deleting, f.report, f.root, "interactive").some(value => value.includes("unsupported")));
  assert.throws(() => new HostEmailAdapter(deleting, f.report, f.root, "interactive", f.bindings));
});
test("thread-wide operations, mismatched effects, denied access and wrong accounts fail readiness", t => {
  const f = setup(t, "delete");
  f.report.operations.delete.granularity = "thread";
  assert.ok(emailCapabilityIssues(f.connection, f.report, f.root, "interactive").length);
  f.report.operations.delete.granularity = "message"; f.report.operations.delete.effect = "permanentDelete";
  assert.ok(emailCapabilityIssues(f.connection, f.report, f.root, "interactive").length);
  f.report.operations.delete.effect = "trash"; f.report.operations.read.status = "denied"; f.report.operations.read.reason = "Synthetic denial.";
  f.saveReport(); assert.equal(inspectEmailReadiness(f.root, "interactive").ready, false);
  f.report.operations.read.status = "verified"; f.report.sourceKey = "a".repeat(64); f.saveReport();
  assert.equal(inspectEmailReadiness(f.root, "interactive").ready, false);
});
test("changing the connector reference requires fresh capability evidence while preserving message identity", t => {
  const f = setup(t);
  const changed = { ...f.connection, source: { ...gmail, connectionReference: "new-host-session" } };
  assert.equal(sourceKey(changed.source), sourceKey(gmail));
  assert.ok(emailCapabilityIssues(changed, f.report, f.root, "interactive").length);
  assert.throws(() => saveEmailConnection(f.root, { ...changed, source: { ...changed.source, accessToken: "synthetic-secret" } } as EmailConnection, loadEmailConnection(f.root).revision), /nonsecret/);
});
test("scheduled email readiness needs its own environment evidence and usable unattended operations", t => {
  const f = setup(t);
  assert.equal(inspectEmailReadiness(f.root, "scheduled").ready, false);
  const report = { ...f.report, executionContext: "scheduled" as const };
  writeFileSync(join(f.root, ".local/email-capabilities-scheduled.json"), JSON.stringify(report));
  assert.equal(inspectEmailReadiness(f.root, "scheduled").ready, true);
  report.operations.read.requiresConfirmation = true;
  writeFileSync(join(f.root, ".local/email-capabilities-scheduled.json"), JSON.stringify(report));
  assert.equal(inspectEmailReadiness(f.root, "scheduled").ready, false);
});
test("changed capability evidence reopens only the email preparation", t => {
  const f = setup(t);
  const state = configureProgress(createProgress(), "bothApplications", [newBoard("Example", "https://example.invalid/", "Site Architecture Context/Example")], now);
  state.emailConnection = completedCheck(f.root, [".local/email-capabilities.json"], now);
  writeFileSync(join(f.root, ".local/proof.md"), "Changed synthetic proof");
  const checked = inspectReadiness(f.root, state);
  assert.equal(checked.state.emailConnection.status, "inProgress");
  assert.equal(checked.state.preparation.browserChoice.status, "pending");
});

test("an expired or denied account observation invalidates old passing capability evidence without changing the source", t => {
  const f = setup(t);
  assert.equal(inspectEmailReadiness(f.root, "interactive").ready, true);
  const before = readFileSync(join(f.root, ".local/email-connection.json"));
  for (const authentication of ["needsAuthentication", "denied"]) {
    writeFileSync(join(f.root, ".local/email-host-connections.json"), JSON.stringify({ schemaVersion: 1, candidates: [
      { id: "gmail-current", source: gmail, available: true, authentication, evidenceReference: "synthetic-auth-observation" },
    ] }));
    assert.equal(inspectEmailReadiness(f.root, "interactive").ready, false);
    assert.deepEqual(readFileSync(join(f.root, ".local/email-connection.json")), before);
  }
});
test("unrelated mail is cached for alert intake but cannot receive application or cleanup state", t => {
  const f = setup(t);
  for (const kind of ["otp", "receipt", "recruiter", "unrelated", "unknown"] as const) {
    const record = classifyMessage(header, kind, "rules-v1", "rules", "synthetic-observation", now);
    assert.equal(intakeDecision(record, header, "rules-v1"), "skip");
    assert.equal(intakeDecision(record, header, "rules-v2"), "classify");
    assert.equal(alertWorkComplete(record), false);
  }
});
test("provider/account/message identity survives label and read-state changes without cross-source deduplication", () => {
  assert.equal(messageKey(header), messageKey({ ...header, source: { ...gmail, connectionReference: "another-session-reference" } }));
  assert.equal(headerFingerprint(header), headerFingerprint({ ...header, labels: ["Read", "Archived"] }));
  assert.notEqual(messageKey(header), messageKey({ ...header, source: { ...gmail, accountId: "another-account" } }));
  assert.notEqual(messageKey(header), messageKey({ ...header, source: { ...gmail, provider: "outlook" } }));
});
test("pagination reads every page, strips bodies from metadata and rejects repeated cursors", async t => {
  const f = setup(t); let calls = 0;
  f.bindings.listPage = async cursor => { calls++; return { messages: [{ ...header, messageId: cursor ? "second" : "first", text: "Must not appear in headers" }], nextCursor: cursor ? undefined : "page-2" }; };
  const found = []; for await (const h of listAllHeaders(f.transport())) found.push(h);
  assert.equal(calls, 2); assert.equal(found.length, 2); assert.equal(JSON.stringify(found).includes("Must not appear"), false);
  f.bindings.listPage = async () => ({ messages: [], nextCursor: "same-page" });
  await assert.rejects(async () => { for await (const _ of listAllHeaders(f.transport())) { /* enumerate */ } }, /repeated/);
});
test("a selected host reader rejects a response for a different mailbox and sanitizes tool errors", async t => {
  const f = setup(t);
  f.bindings.readMessage = async () => ({ ...header, source: { ...gmail, accountId: "wrong" } });
  await assert.rejects(f.transport().readMessage(header.messageId), /exact message/);
  f.bindings.readMessage = async () => { throw new Error("private-token-fixture"); };
  await assert.rejects(f.transport().readMessage(header.messageId), error => !String(error).includes("private-token-fixture"));
});
test("pending siblings, incomplete extraction and missing persistence never reach cleanup", async t => {
  const f = setup(t, "delete");
  await assert.rejects(f.cleanup(async () => false)); assert.equal(f.calls(), 0);
  let loaded = loadInboxState(f.root); loaded.state.messages[0].vacancies.push({ vacancyKey: "blocked-sibling", disposition: "blocked" });
  saveInboxState(f.root, loaded.state, loaded.revision);
  await assert.rejects(f.cleanup()); assert.equal(f.calls(), 0);
  loaded = loadInboxState(f.root); loaded.state.messages[0].vacancies[1].disposition = "notApplicable";
  loaded.state.messages[0].vacancies[1].nonapplicationReason = "Synthetic exclusion"; loaded.state.messages[0].vacancies[1].instructionReference = "synthetic-rule";
  loaded.state.messages[0].enumerationComplete = false; saveInboxState(f.root, loaded.state, loaded.revision);
  await assert.rejects(f.cleanup()); assert.equal(f.calls(), 0);
});
test("protected correspondence never reaches alert cleanup or receives a fake application task", async t => {
  const f = setup(t, "delete");
  for (const kind of ["otp", "receipt", "recruiter", "unrelated", "unknown"] as const) {
    const identity = { ...header, messageId: `protected-${kind}` };
    const protectedRecord = classifyMessage(identity, kind, "rules-v1", "rules", "synthetic-observation", now);
    saveEmailRecord(f.root, protectedRecord, loadInboxState(f.root).revision);
    await assert.rejects(cleanupCompletedAlert({ root: f.root, connection: f.connection, report: f.report, context: "interactive", transport: f.transport(), identity, now, verifyPersistence: async () => true }));
  }
  assert.equal(f.calls(), 0);
});
test("cleanup timeouts preserve completion and require observed recovery rather than another application", async t => {
  const f = setup(t, "delete"); let mutations = 0;
  f.bindings.cleanup = async () => { mutations++; throw new Error("Synthetic timeout after external operation"); };
  await assert.rejects(f.cleanup(), /not confirmed/);
  const pending = loadInboxState(f.root).state.messages[0]; assert.equal(pending.cleanupState, "cleanupPending");
  assert.equal(pending.vacancies[0].taskId, "APP-synthetic");
  f.bindings.observeCleanup = async () => ({ state: "unknown", evidenceReference: "Synthetic unknown", observedAt: now });
  assert.equal((await f.cleanup()).state, "pending"); assert.equal(mutations, 1);
  f.bindings.observeCleanup = async () => ({ state: "applied", evidenceReference: "Synthetic verified absence", observedAt: now });
  assert.equal((await f.cleanup()).state, "complete"); assert.equal(mutations, 1);
});
test("completed markers and vacancy identities cannot be overwritten by a fresh assignment", async t => {
  const f = setup(t); await f.cleanup();
  const current = loadInboxState(f.root);
  assert.throws(() => saveEmailRecord(f.root, f.record, current.revision), /completed message marker/);
  const altered = structuredClone(current.state.messages[0]); altered.vacancies[0].taskId = "new-task";
  assert.throws(() => saveEmailRecord(f.root, altered, current.revision), /identities/);
  const updated = structuredClone(current.state.messages[0]); updated.classification.rulesRevision = "reviewed-v2";
  saveEmailRecord(f.root, updated, current.revision);
  assert.equal(intakeDecision(loadInboxState(f.root).state.messages[0], header, "reviewed-v2"), "skip");
});
test("legacy migration retains provenance, unknown fields, task pointers and pending/deleted outcomes", () => {
  const source = { ...gmail, provider: "agentmail", transport: "agentmail" as const, mailboxId: "legacy-inbox" };
  const old = { schemaVersion: 1, lastCompletedMessage: { messageId: "previous" }, custom: { keep: true }, messages: [
    { inboxId: "legacy-inbox", messageId: "old", enumerationComplete: true, cleanupState: "deleted", vacancies: [], originalTimestamp: "old-date" },
    { inboxId: "legacy-inbox", messageId: "pending", enumerationComplete: false, cleanupState: "cleanupPending", vacancies: [{ vacancyKey: "j", disposition: "blocked", taskId: "same-task" }] },
  ] };
  const migrated = migrateInboxState(old, source, "legacy-user-policy", now);
  assert.deepEqual(migrated.custom, old.custom); assert.deepEqual(migrated.lastCompletedMessage, old.lastCompletedMessage);
  assert.equal(migrated.messages[0].originalTimestamp, "old-date");
  assert.equal(migrated.messages[0].cleanupReceipt?.basis, "legacyCheckpoint"); assert.equal(migrated.messages[0].cleanupReceipt?.observedAt, null);
  assert.equal(migrated.messages[1].cleanupState, "cleanupPending"); assert.equal(migrated.messages[1].vacancies[0].taskId, "same-task");
  assert.throws(() => migrateInboxState(old, gmail, "policy", now));
});
test("migrating an existing AgentMail choice makes no network call or credential/file replacement", t => {
  const root = sandbox(t);
  const original = '{"schemaVersion":1,"inboxId":"chosen@example.invalid","selectionMethod":"user"}';
  writeFileSync(join(root, ".local/agentmail-intake.json"), original);
  writeFileSync(join(root, ".local/agentmail-connection.json"), '{"source":{"type":"envFile","path":"untouched-reference"}}');
  const before = readFileSync(join(root, ".local/agentmail-connection.json"));
  migrateLegacyEmail(root, "prior-user-delete-policy", now);
  assert.equal(loadEmailConnection(root).connection?.source.mailboxId, "chosen@example.invalid");
  assert.equal(readFileSync(join(root, ".local/agentmail-intake.json"), "utf8"), original);
  assert.deepEqual(readFileSync(join(root, ".local/agentmail-connection.json")), before);
  const saved = readFileSync(join(root, ".local/email-connection.json"));
  migrateLegacyEmail(root, "prior-user-delete-policy", now);
  assert.deepEqual(readFileSync(join(root, ".local/email-connection.json")), saved);
  assert.equal(inspectEmailReadiness(root, "interactive").ready, false);
});
test("AgentMail remains a working adapter and exact-message recovery corroborates a 404", async t => {
  const f = setup(t); const source: EmailSource = { ...gmail, provider: "agentmail", transport: "agentmail", mailboxId: "legacy-inbox" };
  const calls: string[] = [];
  const client = new AgentMailInbox({ apiKey: "synthetic-key", inboxId: "legacy-inbox", fetch: async (url, init) => {
    calls.push(`${init?.method}:${url}`);
    if (String(url).includes("/messages/")) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify({ messages: [] }), { status: 200 });
  } });
  const transport = agentMailTransport(client, source, async () => f.record, async () => true);
  const observation = await transport.observeCleanup!({ source, messageId: "missing" }, { ...action("delete"), effect: "permanentDelete" });
  assert.equal(observation.state, "applied"); assert.equal(calls.length, 2); assert.equal(calls.some(call => call.startsWith("DELETE")), false);
});
test("the generic CLI selects a harness account without an AgentMail key and preserves an existing choice", t => {
  const root = sandbox(t); writeFileSync(join(root, "package.json"), '{"type":"module"}');
  cpSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."), join(root, ".local/build/automation"), { recursive: true });
  writeFileSync(join(root, ".local/email-host-connections.json"), JSON.stringify({ schemaVersion: 1, candidates: [
    { id: "gmail-1", source: gmail, available: true, evidenceReference: "synthetic-host-inventory" },
    { id: "gmail-2", source: { ...gmail, accountId: "second-account" }, available: true, evidenceReference: "synthetic-host-inventory" },
  ] }));
  const command = (...args: string[]) => spawnSync(process.execPath, [join(root, ".local/build/automation/email/cli.js"), ...args], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(command("select", "--candidate", "gmail-1", "--source-reference", "user-reply", "--rule-reference", "rules", "--rules-revision", "v1").status, 0);
  assert.equal(loadEmailConnection(root).connection?.source.provider, "gmail");
  assert.equal(command("cleanup-choice", "--mode", "retain", "--effect", "retain", "--source-reference", "user-reply").status, 0);
  const saved = readFileSync(join(root, ".local/email-connection.json"));
  assert.equal(command("select", "--candidate", "gmail-2", "--source-reference", "user-reply", "--rule-reference", "rules", "--rules-revision", "v1").status, 1);
  assert.deepEqual(readFileSync(join(root, ".local/email-connection.json")), saved);
  assert.doesNotThrow(() => validateCleanup(action("retain")));
  assert.throws(() => validateCleanup({ ...action("delete"), effect: "archive" }));
});
