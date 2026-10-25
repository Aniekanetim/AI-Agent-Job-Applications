import test from "node:test";
import assert from "node:assert/strict";
import { alertFixture, fixtureNow, writeFixture } from "./email-fixture.js";
import { cleanupCompletedAlert, prepareNativeCleanup, resumeNativeCleanup, authorizeNativeCleanup, recordNativeCleanup, cancelNativeCleanup, cancelPendingCleanup } from "../email/cleanup.js";
import { loadInboxState, saveEmailRecord, saveInboxState, changeCleanupRecord, alertOwnershipKey, migrateStoredInbox } from "../email/state-store.js";
import type { EmailTransport } from "../email/host-connectors/adapter.js";
import { savePrivateJson } from "../workflow/private-json.js";
import { acquireOwnership } from "../workflow/ownership.js";
import { saveAlertArtifact } from "../email/artifact-store.js";
import { loadEmailConnection, saveEmailConnection } from "../email/connection.js";
import { classifyMessage, messageKey } from "../email/intake.js";
import fs from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { syncBuiltinESMExports } from "node:module";

test("a work save cannot change the verified alert while cleanup owns it", async t => {
  const f = alertFixture(t); let enter!: () => void, release!: () => void, calls = 0;
  const entered = new Promise<void>(r => { enter = r; }), held = new Promise<void>(r => { release = r; });
  const transport: EmailTransport = { source: f.identity.source, listPage: async () => ({ messages: [] }), readMessage: async () => { throw new Error(); },
    applyCleanup: async () => { calls++; enter(); await held; return { evidenceReference: "synthetic-provider-result", observedAt: fixtureNow }; } };
  const operation = cleanupCompletedAlert({ ...f.options, transport }); await entered;
  const loaded = loadInboxState(f.root); loaded.state.messages[0].vacancies.push({ vacancyKey: "newly-discovered", disposition: "pending" });
  let rejected = false;
  try { saveEmailRecord(f.root, loaded.state.messages[0], loaded.revision); } catch { rejected = true; }
  finally { release(); }
  let completed = false; try { completed = (await operation).state === "complete"; } catch { /* Old code detects the change too late. */ }
  assert.equal(rejected, true, "The competing work write must be refused before it changes owned work.");
  assert.equal(completed, true); assert.equal(calls, 1);
  assert.equal(loadInboxState(f.root).state.messages[0].vacancies.length, 4);
});
test("an older work record cannot erase pending cleanup even with a current ledger revision", async t => {
  const f = alertFixture(t); let calls = 0, observations = 0;
  const transport: EmailTransport = { source: f.identity.source, listPage: async () => ({ messages: [] }), readMessage: async () => { throw new Error(); },
    applyCleanup: async () => { calls++; throw new Error("Synthetic timeout after provider action"); },
    observeCleanup: async () => { observations++; return { state: "unknown", evidenceReference: "synthetic-uncertain-result", observedAt: fixtureNow }; } };
  await assert.rejects(cleanupCompletedAlert({ ...f.options, transport }));
  const before = loadInboxState(f.root).state.messages[0];
  assert.throws(() => f.save(), /cleanup|pending|dedicated/i);
  assert.deepEqual(loadInboxState(f.root).state.messages[0], before);
  assert.equal((await cleanupCompletedAlert({ ...f.options, transport })).state, "pending");
  assert.equal(calls, 1); assert.equal(observations, 1);
  for (const edit of [
    (r: typeof f.record) => { r.cleanupState = "notReady"; },
    (r: typeof f.record) => { r.cleanupAttempt!.round = 0; },
    (r: typeof f.record) => { r.cleanupHistory = []; },
    (r: typeof f.record) => { r.enumerationComplete = false; },
  ]) {
    const loaded = loadInboxState(f.root), before = fs.readFileSync(resolve(f.root, ".local/inbox-state.json")); edit(loaded.state.messages[0]);
    assert.throws(() => saveInboxState(f.root, loaded.state, loaded.revision), /cleanup|pending|dedicated/i);
    assert.deepEqual(fs.readFileSync(resolve(f.root, ".local/inbox-state.json")), before);
  }
});

test("bulk and generic writes cannot reset cleanup controls or discard message history", async t => {
  const f = alertFixture(t), prepared = await prepareNativeCleanup({ ...f.options, ownerId: "synthetic-worker" });
  assert.equal(prepared.state, "prepared"); if (prepared.state !== "prepared") return;
  const snapshot = fs.readFileSync(resolve(f.root, ".local/inbox-state.json"));
  const loaded = loadInboxState(f.root);
  assert.throws(() => savePrivateJson(f.root, ".local/inbox-state.json", loaded.state, loaded.revision), /protected/);
  assert.throws(() => savePrivateJson(f.root, ".local/./inbox-state.json", loaded.state, loaded.revision), /protected/);
  loaded.state.messages[0].cleanupState = "notReady";
  assert.throws(() => saveInboxState(f.root, loaded.state, loaded.revision));
  assert.deepEqual(fs.readFileSync(resolve(f.root, ".local/inbox-state.json")), snapshot);
  cancelNativeCleanup({ ...f.options, ownerId: prepared.ownerId, token: prepared.token });
  const cancelled = loadInboxState(f.root);
  assert.equal(cancelled.state.messages[0].cleanupState, "notReady");
  assert.equal((cancelled.state.messages[0].cleanupHistory as unknown[]).length, 1);
  const stale = structuredClone(f.record);
  assert.throws(() => saveEmailRecord(f.root, { ...stale, cleanupState: "retained", cleanupAction: f.connection.cleanup }, cancelled.revision));
  assert.throws(() => saveInboxState(f.root, { schemaVersion: 2, messages: [] }, cancelled.revision), /Preserve/);
});

test("native ownership protects CLI proposals, evidence artifacts and selected cleanup settings", async t => {
  const f = alertFixture(t), prepared = await prepareNativeCleanup({ ...f.options, ownerId: "synthetic-native-worker" });
  if (prepared.state !== "prepared") assert.fail("Expected pending preparation");
  const proposal = writeFixture(f.root, ".local/proposal.json", f.record), before = fs.readFileSync(resolve(f.root, proposal.path));
  const cli = fileURLToPath(new URL("../email/work-cli.js", import.meta.url));
  const result = spawnSync(process.execPath, [cli, "record", "--root", f.root, "--file", proposal.path], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 1); assert.deepEqual(fs.readFileSync(resolve(f.root, proposal.path)), before);
  const destination = `.local/alerts/${messageKey(f.identity)}/new.json`;
  assert.throws(() => saveAlertArtifact(f.root, f.identity, destination, Buffer.from("proposal"), null));
  const changed = structuredClone(f.connection); changed.cleanup = { mode: "retain", effect: "retain", labelId: null, sourceReference: "synthetic-new-choice" };
  assert.throws(() => saveEmailConnection(f.root, changed, loadEmailConnection(f.root).revision), /pending/);
  assert.throws(() => savePrivateJson(f.root, ".local/email-connection.json", changed, loadEmailConnection(f.root).revision), /protected/);
  const owned = { ...f.options, ownerId: prepared.ownerId, token: prepared.token };
  cancelNativeCleanup(owned);
  assert.throws(() => authorizeNativeCleanup(owned));
  const status = spawnSync(process.execPath, [cli, "status", "--root", f.root, "--message-key", messageKey(f.identity)], { encoding: "utf8", windowsHide: true });
  assert.equal(status.status, 0); assert.equal(JSON.parse(status.stdout).nativeOwner, null);
  const evidence = saveAlertArtifact(f.root, f.identity, destination, Buffer.from("proposal"), null);
  assert.equal(evidence.sha256.length, 64);
  assert.throws(() => saveAlertArtifact(f.root, f.identity, evidence.path, Buffer.from("stale"), null), /changed/);
  assert.throws(() => saveAlertArtifact(f.root, f.identity, ".local/alerts/another-message/proof.json", Buffer.from("wrong owner"), null), /exact alert/);
  const other = classifyMessage({ ...f.identity, messageId: "another-message", from: "alerts@example.invalid", timestamp: fixtureNow }, "jobAlert", "v1", "rules", "synthetic-observation", fixtureNow);
  other.vacancies = [{ vacancyKey: "other-job", disposition: "pending", taskId: "other-task", taskPath: f.record.vacancies[0].taskPath }];
  assert.throws(() => saveEmailRecord(f.root, other, loadInboxState(f.root).revision), /same ticket/);
});

test("an invoked native attempt cannot be cancelled on uncertainty, but observed absence permits recorded cancellation", async t => {
  const f = alertFixture(t), prepared = await prepareNativeCleanup({ ...f.options, ownerId: "synthetic-cancel-worker" });
  if (prepared.state !== "prepared") assert.fail("Expected native preparation");
  const owned = { ...f.options, ownerId: prepared.ownerId, token: prepared.token }, invoked = authorizeNativeCleanup(owned);
  assert.throws(() => cancelNativeCleanup(owned), /cancelled/);
  const evidence = (state: string) => writeFixture(f.root, `.local/${state}.json`, { schemaVersion: 1, operationId: prepared.operationId,
    round: invoked.round, messageKey: messageKey(f.identity), action: f.connection.cleanup, state, observedAt: fixtureNow,
    toolReference: "synthetic-current-message-observation", toolEvidence: writeFixture(f.root, `.local/raw-${state}.txt`, `Synthetic ${state}`) });
  recordNativeCleanup({ ...owned, evidence: evidence("unknown") }); assert.throws(() => cancelNativeCleanup(owned));
  recordNativeCleanup({ ...owned, evidence: evidence("notApplied") });
  assert.equal(cancelNativeCleanup(owned).state, "cancelled");
  const current = loadInboxState(f.root), history = current.state.messages[0].cleanupHistory as { attempt: { reference: string; invocations: unknown[]; observations: unknown[] } }[];
  assert.equal(history[0].attempt.reference, prepared.operationId); assert.equal(history[0].attempt.invocations.length, 1); assert.equal(history[0].attempt.observations.length, 2);
  current.state.messages[0].vacancies.push({ vacancyKey: "needs-reconciliation", disposition: "pending" });
  saveInboxState(f.root, current.state, current.revision);
  assert.equal(loadInboxState(f.root).state.messages[0].vacancies.length, 5);
});

test("callback cancellation requires an observed not-applied result and retains the original application identities", async t => {
  const f = alertFixture(t); let calls = 0, absent = false;
  const transport: EmailTransport = { source: f.identity.source, listPage: async () => ({ messages: [] }), readMessage: async () => { throw new Error(); },
    applyCleanup: async () => { calls++; throw new Error("Synthetic interrupted cleanup"); },
    observeCleanup: async () => ({ state: absent ? "notApplied" : "unknown", evidenceReference: "synthetic-exact-message-check", observedAt: fixtureNow }) };
  await assert.rejects(cleanupCompletedAlert({ ...f.options, transport }));
  await assert.rejects(cancelPendingCleanup({ ...f.options, transport }), /not-applied/);
  assert.throws(() => f.save()); absent = true;
  assert.equal((await cancelPendingCleanup({ ...f.options, transport })).state, "cancelled");
  const saved = loadInboxState(f.root).state.messages[0]; assert.equal(saved.vacancies[0].taskId, f.record.vacancies[0].taskId); assert.equal(calls, 1);
});

test("fake or incorrectly scoped ownership cannot mutate cleanup controls", t => {
  const f = alertFixture(t), bad = { token: "not-real", ownerId: "not-real", assertOwned() {}, release() {} };
  assert.throws(() => changeCleanupRecord(f.root, f.identity, bad, "prepare", r => { r.cleanupState = "cleanupPending"; }));
  const wrong = acquireOwnership(f.root, "alert:another-message");
  try { assert.throws(() => changeCleanupRecord(f.root, f.identity, wrong, "prepare", () => {})); } finally { wrong.release(); }
});

test("legacy pending progress is preserved and inspected before any new mutation", async t => {
  const f = alertFixture(t), legacy = structuredClone(f.record); legacy.cleanupState = "cleanupPending"; legacy.cleanupAction = f.connection.cleanup;
  legacy.cleanupAttempt = { reference: "synthetic-existing-attempt", startedAt: fixtureNow }; legacy.extraHistory = "preserve";
  // Seed the old on-disk format; ordinary runtime writes are intentionally unable to do this.
  writeFixture(f.root, ".local/inbox-state.json", { schemaVersion: 2, messages: [legacy] }); let calls = 0;
  const transport: EmailTransport = { source: f.identity.source, listPage: async () => ({ messages: [] }), readMessage: async () => { throw new Error(); },
    applyCleanup: async () => { calls++; throw new Error("Must not invoke"); }, observeCleanup: async () => ({ state: "unknown", evidenceReference: "synthetic-legacy-inspection", observedAt: fixtureNow }) };
  assert.equal((await cleanupCompletedAlert({ ...f.options, transport })).state, "pending");
  const saved = loadInboxState(f.root).state.messages[0]; assert.equal(saved.cleanupAttempt!.reference, legacy.cleanupAttempt.reference);
  assert.equal(saved.cleanupAttempt!.protocolVersion, 2); assert.equal(saved.extraHistory, "preserve"); assert.equal(calls, 0);
});

test("schema-1 migration uses the guarded store without inventing completed work or losing fields", t => {
  const source = { provider: "agentmail", transport: "agentmail" as const, accountId: "synthetic-account", mailboxId: "synthetic-inbox", address: null, connectionReference: "synthetic-connection" };
  const f = alertFixture(t, 1, "delete", source), old = { schemaVersion: 1, custom: "keep", messages: [{ inboxId: source.mailboxId,
    messageId: f.identity.messageId, enumerationComplete: false, cleanupState: "cleanupPending", vacancies: [{ vacancyKey: "job-1", disposition: "blocked", taskId: "existing-task" }], extraHistory: "keep" }] };
  writeFixture(f.root, ".local/inbox-state.json", old);
  assert.equal(migrateStoredInbox(f.root, source, "synthetic-original-delete-instruction", fixtureNow), true);
  const saved = loadInboxState(f.root); assert.equal(saved.state.custom, "keep"); assert.equal(saved.state.messages[0].vacancies[0].taskId, "existing-task");
  assert.equal(saved.state.messages[0].cleanupAttempt, undefined); assert.equal(saved.state.messages[0].extraHistory, "keep");
  assert.equal(migrateStoredInbox(f.root, source, "synthetic-original-delete-instruction", fixtureNow), false);
});

test("a failed pending-checkpoint replacement never authorizes an external action", async t => {
  const f = alertFixture(t), before = fs.readFileSync(resolve(f.root, ".local/inbox-state.json")), original = fs.renameSync; let calls = 0;
  const transport: EmailTransport = { source: f.identity.source, listPage: async () => ({ messages: [] }), readMessage: async () => { throw new Error(); },
    applyCleanup: async () => { calls++; return { evidenceReference: "synthetic-result", observedAt: fixtureNow }; } };
  fs.renameSync = ((from: fs.PathLike, to: fs.PathLike) => { if (String(to) === resolve(f.root, ".local/inbox-state.json")) throw new Error("Synthetic interrupted checkpoint replacement"); return original(from, to); }) as typeof fs.renameSync;
  syncBuiltinESMExports();
  try { await assert.rejects(cleanupCompletedAlert({ ...f.options, transport }), /interrupted checkpoint/); }
  finally { fs.renameSync = original; syncBuiltinESMExports(); }
  assert.equal(calls, 0); assert.deepEqual(fs.readFileSync(resolve(f.root, ".local/inbox-state.json")), before);
  assert.equal((await cleanupCompletedAlert({ ...f.options, transport })).state, "complete"); assert.equal(calls, 1);
});

test("a stopped worker leaves a recoverable invoked checkpoint and never recreates its applications", { timeout: 25000 }, async t => {
  const f = alertFixture(t), module = new URL("../email/cleanup.js", import.meta.url).href;
  const options = writeFixture(f.root, ".local/child-options.json", f.options);
  const worker = writeFixture(f.root, ".local/cleanup-worker.mjs", `import { readFileSync } from 'node:fs'; import { cleanupCompletedAlert } from ${JSON.stringify(module)}; const options=JSON.parse(readFileSync(process.argv[2],'utf8')); const transport={source:options.identity.source,listPage:async()=>({messages:[]}),readMessage:async()=>{},applyCleanup:async()=>{console.log('invoked');setInterval(()=>{},1000);return new Promise(()=>{})}}; await cleanupCompletedAlert({...options,transport});`);
  const child = spawn(process.execPath, [resolve(f.root, worker.path), resolve(f.root, options.path)], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  await new Promise<void>((done, fail) => { let error = ""; child.stderr!.on("data", c => { error += String(c); }); child.stdout!.once("data", () => done()); child.once("error", fail); child.once("exit", () => fail(new Error(error || "Worker exited before invocation"))); });
  const attempt = loadInboxState(f.root).state.messages[0].cleanupAttempt!; assert.equal(attempt.phase, "invoked");
  const ended = once(child, "exit"); child.kill(); await ended; let calls = 0;
  const transport: EmailTransport = { source: f.identity.source, listPage: async () => ({ messages: [] }), readMessage: async () => { throw new Error(); }, applyCleanup: async () => { calls++; throw new Error(); },
    observeCleanup: async () => ({ state: "applied", evidenceReference: "synthetic-confirmed-previous-action", observedAt: fixtureNow }) };
  assert.equal((await cleanupCompletedAlert({ ...f.options, transport })).state, "complete");
  const saved = loadInboxState(f.root).state.messages[0]; assert.equal(saved.cleanupAttempt!.reference, attempt.reference); assert.equal(saved.cleanupAttempt!.round, 1);
  assert.equal(saved.vacancies[0].taskId, f.record.vacancies[0].taskId); assert.equal(calls, 0);
});

test("a post-replacement flush failure keeps native ownership recoverable without authorizing a tool", async t => {
  const f = alertFixture(t), originalOpen = fs.openSync, originalSync = fs.fsyncSync; let target: number | undefined;
  fs.openSync = ((path: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => { const fd = originalOpen(path, flags, mode); if (String(path) === resolve(f.root, ".local/inbox-state.json") && flags === "r+") target = fd; return fd; }) as typeof fs.openSync;
  fs.fsyncSync = (fd => { if (fd === target) throw new Error("Synthetic unacknowledged checkpoint flush"); return originalSync(fd); }) as typeof fs.fsyncSync;
  syncBuiltinESMExports();
  try { await assert.rejects(prepareNativeCleanup({ ...f.options, ownerId: "synthetic-flush-worker" }), /unacknowledged checkpoint/); }
  finally { fs.openSync = originalOpen; fs.fsyncSync = originalSync; syncBuiltinESMExports(); }
  const saved = loadInboxState(f.root).state.messages[0]; assert.equal(saved.cleanupAttempt!.phase, "prepared"); assert.equal(saved.cleanupAttempt!.round, 0);
  assert.throws(() => acquireOwnership(f.root, alertOwnershipKey(f.identity)));
  const owned = { ...f.options, ownerId: saved.cleanupAttempt!.native!.ownerId, token: saved.cleanupAttempt!.native!.token };
  assert.equal((await resumeNativeCleanup(owned)).state, "pending"); assert.equal(cancelNativeCleanup(owned).state, "cancelled");
});
