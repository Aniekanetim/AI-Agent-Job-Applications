import test from "node:test";
import assert from "node:assert/strict";
import { messageReadyForDeletion, type MessageProgress } from "../workflow/application-state.js";
import { readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { alertFixture, fixtureNow, writeFixture } from "./email-fixture.js";
import { verifyAlertCompletion, readTaskRecord, taskRecordBlock } from "../email/verification.js";
import { createInventory, verifyInventory, sourceLinks, type SourceCapture } from "../email/inventory.js";
import { evidenceFile } from "../email/evidence.js";
import { cleanupCompletedAlert, prepareNativeCleanup, authorizeNativeCleanup, recordNativeCleanup } from "../email/cleanup.js";
import { HostEmailAdapter, type EmailTransport } from "../email/host-connectors/adapter.js";
import { AgentMailInbox, AgentMailError } from "../email/agentmail/client.js";
import { agentMailTransport } from "../email/agentmail/adapter.js";
import { loadInboxState, saveEmailRecord, saveInboxState } from "../email/state-store.js";
import { classifyMessage, messageKey } from "../email/intake.js";
import { acquireOwnership, OwnershipBusy } from "../workflow/ownership.js";

const legacy = (count: number): MessageProgress => ({ inboxId: "synthetic-inbox", messageId: "synthetic-alert",
  enumerationComplete: true, cleanupState: "notReady", vacancies: Array.from({ length: count }, (_, i) => ({
    vacancyKey: `job-${i + 1}`, disposition: "applied", taskId: `task-${i + 1}`,
    taskPath: `Task Board/Applied/task-${i + 1}.md`, applicationRecordSaved: true, confirmationReference: `receipt-${i + 1}`,
  })) });
test("a completion flag without a source-linked inventory cannot authorize cleanup", () => {
  for (const count of [3, 21]) assert.equal(messageReadyForDeletion(legacy(count)), false);
});
test("one application task cannot complete several different vacancies", () => {
  const message = legacy(4);
  for (const vacancy of message.vacancies) Object.assign(vacancy, { taskId: "one-task", taskPath: "Task Board/Applied/one-task.md", confirmationReference: "one-receipt" });
  assert.equal(messageReadyForDeletion(message), false);
});

for (const count of [4, 22]) {
  test(`${count} distinct confirmed postings allow exactly one cleanup`, async t => {
    const f = alertFixture(t, count); let calls = 0;
    const transport: EmailTransport = { source: f.identity.source, listPage: async () => ({ messages: [] }), readMessage: async () => { throw new Error(); },
      applyCleanup: async () => { calls++; return { evidenceReference: "synthetic-tool-result", observedAt: fixtureNow }; } };
    assert.equal(verifyAlertCompletion(f.root, f.record).vacancies, count);
    assert.equal((await cleanupCompletedAlert({ ...f.options, transport })).state, "complete");
    assert.equal((await cleanupCompletedAlert({ ...f.options, transport })).state, "complete");
    assert.equal(calls, 1);
  });
  test(`a ${count}-posting source cannot be cleaned with only ${count - 1} outcomes`, t => {
    const f = alertFixture(t, count); f.record.vacancies.pop();
    assert.throws(() => verifyAlertCompletion(f.root, f.record), /unresolved/);
    assert.throws(() => f.save(), /Preserve/);
  });
  test(`dropping a source link and its decision from a ${count}-posting inventory is detected`, t => {
    const f = alertFixture(t, count); f.record.inventory!.candidates.pop(); f.record.inventory!.decisions.pop(); f.record.vacancies.pop();
    assert.equal(messageReadyForDeletion({ ...f.record, cleanupState: "notReady" }), true);
    assert.throws(() => verifyAlertCompletion(f.root, f.record), /source message/);
  });
}
test("different postings cannot reuse task IDs, paths, outcome records or confirmations", t => {
  const f = alertFixture(t);
  for (const field of ["taskId", "taskPath", "taskEvidence", "outcomeEvidence"] as const) {
    const record = structuredClone(f.record); Object.assign(record.vacancies[1], { [field]: record.vacancies[0][field] });
    assert.throws(() => verifyAlertCompletion(f.root, record));
  }
  const v = f.record.vacancies[1], task = readTaskRecord(readFileSync(resolve(f.root, v.taskPath!)));
  task.vacancyKey = f.record.vacancies[0].vacancyKey;
  v.taskEvidence = writeFixture(f.root, v.taskPath!, taskRecordBlock(task));
  assert.throws(() => verifyAlertCompletion(f.root, f.record), /job-specific/);
});
test("missing or changed actual confirmation files block cleanup despite a true callback", async t => {
  const f = alertFixture(t, 1), v = f.record.vacancies[0]; let calls = 0;
  const task = readTaskRecord(readFileSync(resolve(f.root, v.taskPath!)));
  unlinkSync(resolve(f.root, task.confirmationEvidence.path));
  await assert.rejects(cleanupCompletedAlert({ ...f.options, verifyPersistence: async () => true, transport: {
    source: f.identity.source, listPage: async () => ({ messages: [] }), readMessage: async () => { throw new Error(); },
    applyCleanup: async () => { calls++; throw new Error(); },
  } })); assert.equal(calls, 0);
});
test("pending, blocked and uncertain submission checkpoints never complete an alert", t => {
  const f = alertFixture(t);
  for (const disposition of ["pending", "blocked"] as const) {
    const record = structuredClone(f.record); record.vacancies[2].disposition = disposition;
    assert.throws(() => verifyAlertCompletion(f.root, record));
  }
  const v = f.record.vacancies[2], task = readTaskRecord(readFileSync(resolve(f.root, v.taskPath!)));
  task.task.checkpoint = "submissionAttempted"; v.taskEvidence = writeFixture(f.root, v.taskPath!, taskRecordBlock(task));
  assert.throws(() => verifyAlertCompletion(f.root, f.record));
});
test("a permitted exclusion needs its actual instruction file and posting-specific outcome", t => {
  const f = alertFixture(t), v = f.record.vacancies[2];
  const instruction = writeFixture(f.root, ".local/exclusion-rule.local.md", "Synthetic user instruction: skip closed vacancies.");
  Object.assign(v, { disposition: "notApplicable", nonapplicationReason: "Observed vacancy closed", instructionReference: instruction.path });
  v.outcomeEvidence = writeFixture(f.root, v.outcomeEvidence!.path, { schemaVersion: 1, messageKey: messageKey(f.identity), vacancyKey: v.vacancyKey,
    postingUrl: v.postingUrl, kind: "notApplicable", reason: v.nonapplicationReason, instruction, observedAt: fixtureNow });
  assert.equal(verifyAlertCompletion(f.root, f.record).excluded, 1);
  writeFixture(f.root, instruction.path, "Changed instruction.");
  assert.throws(() => verifyAlertCompletion(f.root, f.record), /changed/);
});
test("HTML entities, repeated title/Apply links, navigation and distinct query IDs are inventoried", t => {
  const f = alertFixture(t);
  const capture: SourceCapture = { schemaVersion: 1, messageKey: messageKey(f.identity), completeness: "full", observedAt: fixtureNow, toolReference: "synthetic-full-message",
    html: '<a href="https://jobs.example.invalid/view?job=1&amp;lang=en">Title</a><a href="https://jobs.example.invalid/view?job=1&amp;lang=en">Apply</a><a href="https://jobs.example.invalid/view?job=2">Second</a><a href="https://jobs.example.invalid/settings">Settings</a>',
    text: "https://jobs.example.invalid/view?job=2" };
  const source = writeFixture(f.root, ".local/links-source.json", capture), inventory = createInventory(f.root, source);
  assert.equal(inventory.candidates.length, 5);
  inventory.decisions = inventory.candidates.map(c => c.href.includes("settings") ? { candidateId: c.candidateId, kind: "navigation", reason: "Observed alert settings link", evidence: source } :
    { candidateId: c.candidateId, kind: "posting", vacancyKey: c.href.includes("job=1") ? "job-1" : "job-2", postingUrl: c.href, evidence: source });
  assert.equal(verifyInventory(f.root, inventory, messageKey(f.identity)).size, 2);
  assert.equal(inventory.candidates[0].href.includes("&amp;"), false);
  inventory.decisions[4].kind = "unresolved";
  assert.throws(() => verifyInventory(f.root, inventory, messageKey(f.identity)), /Resolve/);
});
test("tracking links require observed destination evidence and truncated bodies remain ineligible", t => {
  const f = alertFixture(t);
  const capture: SourceCapture = { schemaVersion: 1, messageKey: messageKey(f.identity), completeness: "full", observedAt: fixtureNow, toolReference: "synthetic-full-message", html: '<a href="https://tracker.example.invalid/click">Job</a>' };
  let source = writeFixture(f.root, ".local/tracked-source.json", capture), inventory = createInventory(f.root, source);
  const postingUrl = "https://jobs.example.invalid/job/1";
  inventory.decisions[0] = { candidateId: "html-1", kind: "posting", vacancyKey: "job-1", postingUrl, evidence: source };
  assert.throws(() => verifyInventory(f.root, inventory, messageKey(f.identity)), /redirected/);
  inventory.decisions[0].evidence = writeFixture(f.root, ".local/redirect.json", { sourceHref: inventory.candidates[0].href, postingUrl, observedAt: fixtureNow });
  assert.equal(verifyInventory(f.root, inventory, messageKey(f.identity)).size, 1);
  capture.completeness = "truncated"; source = writeFixture(f.root, ".local/tracked-source.json", capture); inventory.source = source;
  assert.throws(() => verifyInventory(f.root, inventory, messageKey(f.identity)), /full source/);
  assert.equal(sourceLinks({ ...capture, html: '<a data-url="/unknown">Unknown</a>' }).length, 1);
});
test("overlapping workers issue one mutation and preserve unrelated message updates", async t => {
  const f = alertFixture(t); let calls = 0, enter!: () => void, release!: () => void;
  const entered = new Promise<void>(r => { enter = r; }), waiting = new Promise<void>(r => { release = r; });
  const transport: EmailTransport = { source: f.identity.source, listPage: async () => ({ messages: [] }), readMessage: async () => { throw new Error(); },
    applyCleanup: async () => { calls++; enter(); await waiting; return { evidenceReference: "synthetic-result", observedAt: fixtureNow }; } };
  const first = cleanupCompletedAlert({ ...f.options, transport }); await entered;
  assert.equal((await cleanupCompletedAlert({ ...f.options, transport })).state, "busy");
  const other = classifyMessage({ ...f.identity, messageId: "another", from: "person@example.invalid", timestamp: fixtureNow }, "unrelated", "v1", "rules", "observed", fixtureNow);
  saveEmailRecord(f.root, other, loadInboxState(f.root).revision); release();
  assert.equal((await first).state, "complete"); assert.equal(calls, 1); assert.equal(loadInboxState(f.root).state.messages.length, 2);
});
test("a true legacy callback cannot bypass the guarded host transport", async t => {
  const f = alertFixture(t); let calls = 0;
  const transport = new HostEmailAdapter(f.connection, f.report, f.root, "interactive", { listPage: async () => ({ messages: [] }), readMessage: async () => { throw new Error(); }, cleanup: async () => { calls++; return { evidenceReference: "result", observedAt: fixtureNow }; } });
  await assert.rejects(transport.applyCleanup(f.identity, f.connection.cleanup!), /single-use/); assert.equal(calls, 0);
  assert.equal((await cleanupCompletedAlert({ ...f.options, transport })).state, "complete"); assert.equal(calls, 1);
});
test("native cleanup holds ownership across CLI exits and rejects repeated authorization or stale observations", async t => {
  const f = alertFixture(t), prepared = await prepareNativeCleanup({ ...f.options, ownerId: "synthetic-harness-worker" });
  assert.equal(prepared.state, "prepared"); if (prepared.state !== "prepared") return;
  const owned = { ...f.options, ownerId: prepared.ownerId, token: prepared.token };
  assert.throws(() => acquireOwnership(f.root, `alert:${messageKey(f.identity)}`), OwnershipBusy);
  const authorized = authorizeNativeCleanup(owned); assert.equal(authorized.round, 1);
  assert.throws(() => authorizeNativeCleanup(owned), /Inspect/);
  const result = (state: string, round: number) => writeFixture(f.root, `.local/native-${state}-${round}.json`, { schemaVersion: 1, operationId: prepared.operationId, round,
    messageKey: messageKey(f.identity), action: f.connection.cleanup, state, observedAt: fixtureNow, toolReference: "synthetic-message-level-tool", toolEvidence: writeFixture(f.root, `.local/native-tool-${state}-${round}.txt`, `Synthetic exact-message result: ${state}, round ${round}`) });
  assert.equal(recordNativeCleanup({ ...owned, evidence: result("unknown", 1) }).state, "pending");
  assert.throws(() => authorizeNativeCleanup(owned));
  const absent = result("notApplied", 1); recordNativeCleanup({ ...owned, evidence: absent });
  assert.equal(authorizeNativeCleanup(owned).round, 2);
  assert.throws(() => recordNativeCleanup({ ...owned, evidence: absent }), /actual exact-message/);
  assert.equal(recordNativeCleanup({ ...owned, evidence: result("applied", 2) }).state, "complete");
  const free = acquireOwnership(f.root, `alert:${messageKey(f.identity)}`); free.release();
});
test("native preparation and retain mode never require an external mutation", async t => {
  const f = alertFixture(t, 4, "retain");
  assert.equal((await prepareNativeCleanup({ ...f.options, ownerId: "synthetic-owner" })).state, "complete");
  assert.equal(loadInboxState(f.root).state.messages[0].cleanupState, "retained");
});
test("AgentMail coordinated cleanup encodes only the individual message and sanitizes failures", async t => {
  const source = { provider: "agentmail", accountId: "synthetic-account", mailboxId: "fixture+alerts@example.invalid", address: "fixture+alerts@example.invalid", transport: "agentmail" as const, connectionReference: "synthetic-agentmail" };
  const f = alertFixture(t, 4, "delete", source), calls: string[] = []; let fail = true;
  const client = new AgentMailInbox({ apiKey: "synthetic-secret", inboxId: source.mailboxId, fetch: async (url, init) => {
    calls.push(`${init?.method}:${url}`); return fail ? new Response("private-body synthetic-secret", { status: 429 }) : new Response(null, { status: 204 });
  } });
  const transport = agentMailTransport(client, source, async () => loadInboxState(f.root).state.messages[0], async () => true);
  await assert.rejects(cleanupCompletedAlert({ ...f.options, transport }), error => error instanceof AgentMailError && error.status === 429 && !error.message.includes("synthetic-secret") && !error.message.includes("private-body"));
  fail = false; transport.observeCleanup = async () => ({ state: "notApplied", evidenceReference: "synthetic-exact-message-observation", observedAt: fixtureNow });
  assert.equal((await cleanupCompletedAlert({ ...f.options, transport })).state, "complete");
  assert.equal(calls.length, 2); assert.ok(calls.every(c => c === `DELETE:https://api.agentmail.to/v0/inboxes/${encodeURIComponent(source.mailboxId)}/messages/${encodeURIComponent(f.identity.messageId)}`));
});
test("a terminated local process claim is recoverable, while a live owner cannot be displaced", { timeout: 15000 }, async t => {
  const f = alertFixture(t, 1), module = new URL("../workflow/ownership.js", import.meta.url).href;
  const script = writeFixture(f.root, ".local/claim.mjs", `import { acquireOwnership } from ${JSON.stringify(module)}; acquireOwnership(process.argv[2], "crash-test"); console.log("claimed"); setInterval(()=>{}, 1000);`);
  const child = spawn(process.execPath, [resolve(f.root, script.path), f.root], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  await new Promise<void>((done, fail) => {
    let errors = ""; child.stderr!.on("data", chunk => { errors += String(chunk); });
    child.stdout!.once("data", () => done()); child.once("error", fail); child.once("exit", () => fail(new Error(errors || "Synthetic claim worker exited before acquiring ownership.")));
  });
  assert.throws(() => acquireOwnership(f.root, "crash-test"), OwnershipBusy);
  const exited = once(child, "exit"); child.kill(); await exited;
  const recovered = acquireOwnership(f.root, "crash-test"); recovered.assertOwned(); recovered.release();
});
test("copying the same confirmation into another file cannot complete a second posting", t => {
  const f = alertFixture(t), [first, second] = f.record.vacancies;
  const original = readTaskRecord(readFileSync(resolve(f.root, first.taskPath!)));
  const copied = writeFixture(f.root, ".local/copied-confirmation.json", readFileSync(resolve(f.root, original.confirmationEvidence.path)).toString("utf8"));
  const task = readTaskRecord(readFileSync(resolve(f.root, second.taskPath!))); task.confirmationEvidence = copied;
  second.taskEvidence = writeFixture(f.root, second.taskPath!, taskRecordBlock(task));
  const outcome = JSON.parse(readFileSync(resolve(f.root, second.outcomeEvidence!.path), "utf8")); outcome.evidence = copied;
  second.outcomeEvidence = writeFixture(f.root, second.outcomeEvidence!.path, outcome);
  assert.throws(() => verifyAlertCompletion(f.root, f.record), /own job-specific/);
});
test("native CLI ownership survives process exit through authorization and result recording", t => {
  const f = alertFixture(t, 1), cli = fileURLToPath(new URL("../email/work-cli.js", import.meta.url));
  const run = (...args: string[]) => JSON.parse(execFileSync(process.execPath, [cli, ...args, "--root", f.root, "--message-key", messageKey(f.identity), "--owner-id", "synthetic-cli-worker"], { encoding: "utf8", windowsHide: true }));
  const prepared = run("native-prepare");
  assert.throws(() => acquireOwnership(f.root, `alert:${messageKey(f.identity)}`), OwnershipBusy);
  assert.equal(run("native-resume", "--token", prepared.token).next, "authorize");
  const authorized = run("native-authorize", "--token", prepared.token);
  assert.equal(run("native-resume", "--token", prepared.token).next, "inspect");
  const proof = writeFixture(f.root, ".local/native-cli-result.json", { schemaVersion: 1, operationId: prepared.operationId, round: authorized.round,
    messageKey: messageKey(f.identity), action: f.connection.cleanup, state: "applied", observedAt: new Date().toISOString(), toolReference: "synthetic-tool-result", toolEvidence: writeFixture(f.root, ".local/native-cli-raw.txt", "Synthetic exact-message cleanup confirmed.") });
  assert.equal(run("native-observe", "--token", prepared.token, "--evidence", proof.path).state, "complete");
});
test("two processes using the same JSON revision cannot overwrite each other", { timeout: 20000 }, async t => {
  const f = alertFixture(t, 1), module = new URL("../workflow/private-json.js", import.meta.url).href;
  const script = writeFixture(f.root, ".local/writer.mjs", `import { existsSync } from 'node:fs'; import { readPrivateJson, savePrivateJson } from ${JSON.stringify(module)}; const root=process.argv[2], id=process.argv[3]; const old=readPrivateJson(root,'.local/race.json'); console.log('ready'); while(!existsSync(root+'/.local/go')) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10); try { savePrivateJson(root,'.local/race.json',{id},old.revision); process.exitCode=0; } catch { process.exitCode=2; }`);
  const children = ["one", "two"].map(id => spawn(process.execPath, [resolve(f.root, script.path), f.root, id], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }));
  t.after(() => children.forEach(child => { if (child.exitCode === null) child.kill(); }));
  const exits = children.map(child => once(child, "exit"));
  await Promise.all(children.map(child => once(child.stdout!, "data")));
  writeFixture(f.root, ".local/go", "go");
  const codes = (await Promise.all(exits)).map(([code]) => code).sort(); assert.deepEqual(codes, [0, 2]);
  assert.ok(["one", "two"].includes(JSON.parse(readFileSync(resolve(f.root, ".local/race.json"), "utf8")).id));
});
test("legacy active progress waits for source reconciliation without recreating its application", async t => {
  const f = alertFixture(t, 1, "retain"), legacy = structuredClone(f.record);
  delete legacy.inventory; delete legacy.vacancies[0].taskEvidence; delete legacy.vacancies[0].outcomeEvidence;
  saveEmailRecord(f.root, legacy, loadInboxState(f.root).revision);
  const transport: EmailTransport = { source: f.identity.source, listPage: async () => ({ messages: [] }), readMessage: async () => { throw new Error(); }, applyCleanup: async () => { throw new Error("Retain never mutates email"); } };
  await assert.rejects(cleanupCompletedAlert({ ...f.options, transport }), /source inventory/);
  f.save(); assert.equal((await cleanupCompletedAlert({ ...f.options, transport })).state, "complete");
  assert.equal(loadInboxState(f.root).state.messages[0].vacancies[0].taskId, legacy.vacancies[0].taskId);
});
test("completed legacy markers remain handled without inventing missing historical evidence", async t => {
  const f = alertFixture(t, 1, "retain"), transport: EmailTransport = { source: f.identity.source, listPage: async () => ({ messages: [] }), readMessage: async () => { throw new Error(); }, applyCleanup: async () => { throw new Error(); } };
  await cleanupCompletedAlert({ ...f.options, transport });
  const loaded = loadInboxState(f.root); delete loaded.state.messages[0].inventory;
  delete loaded.state.messages[0].vacancies[0].taskEvidence; delete loaded.state.messages[0].vacancies[0].outcomeEvidence;
  saveInboxState(f.root, loaded.state, loaded.revision);
  const before = readFileSync(resolve(f.root, ".local/inbox-state.json"));
  assert.equal((await cleanupCompletedAlert({ ...f.options, transport })).state, "complete");
  assert.deepEqual(readFileSync(resolve(f.root, ".local/inbox-state.json")), before);
});
