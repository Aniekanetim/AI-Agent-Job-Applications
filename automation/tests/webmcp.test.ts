import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { readySite } from "./sites-fixture.js";
import { bindTaskTicket, loadTaskControl } from "../workflow/task-control.js";
import { recordSiteAccess } from "../sites/execution.js";
import { prepareWebMcpAction, observeWebMcpAction, saveInventory, type Observation, type Request } from "../chrome-devtools/webmcp.js";
import { invokeTool } from "../chrome-devtools/bridge.js";

function fixture(t: TestContext, purpose: Request["purpose"] = "submit") {
  const site = readySite(t, { taskId: "APP-webmcp", originalIntake: "To Do", checkpoint: "prepared",
    selectedRoleId: "synthetic-qa", cvVersion: "test-cv", cvSha256: "a".repeat(64) });
  const first = site.write(".local/webmcp-test/site.json", { synthetic: true });
  const report = site.write(".local/webmcp-test/access.json", { ...site.page, schemaVersion: 1,
    siteId: site.site.id, taskId: site.task.taskId, observedAt: new Date().toISOString(),
    access: "authenticated", identityVerified: true, challengeCleared: true, permittedActions: ["webmcp", "submit"], evidence: first });
  const task = recordSiteAccess(site.root, site.task, report);
  appendFileSync(site.root + "/.gitignore", "\n/Task Board/To Do/*\n**/*.local.json\n");
  const ticket = site.write("Task Board/To Do/APP-webmcp.md", "# Synthetic WebMCP task");
  bindTaskTicket(site.root, task, ticket.path);
  const checkedAt = new Date().toISOString();
  const call: Observation = {
    target: { taskId: task.taskId, page: site.page, pageId: 1, context: "interactive", method: "native",
      connection: "fixture-native", vacancy: "fixture-vacancy", account: "fixture-account", evidence: first },
    checkedAt,
    document: { url: site.page.url, observedAt: checkedAt, apiObserved: true, documents: [{ path: "0", documentId: "doc-1", url: site.page.url }] },
    tools: [{ name: "job_action", inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } }],
  };
  const attach = (value: Observation) => {
    const { nativeEvidence, ...actual } = value;
    return { ...actual, nativeEvidence: site.write(`.local/webmcp-test/call-${randomUUID()}.json`, actual) };
  };
  const observation = attach(call);
  const saved = saveInventory(site.root, observation);
  assert.equal(saved.status, "available");
  const mapping = site.write(dirname(site.site.architecturePath).replaceAll("\\", "/") + "/webmcp.local.json", {
    toolName: "job_action", purpose, ...saved.tools[0], origin: new URL(site.page.url).origin,
    fields: ["name"], observation: "Synthetic site behavior evidence",
  });
  const request: Request = { inventoryId: saved.id, toolName: "job_action", purpose,
    input: { name: "Synthetic candidate" }, mapping, ownerId: "fixture-worker" };
  return { ...site, task, observation, request, attach };
}

test("WebMCP requires a current document, account and execution context", t => {
  const f = fixture(t);
  for (const change of [
    (o: Observation) => { o.target.context = "scheduled"; },
    (o: Observation) => { o.target.account = "another-account"; },
    (o: Observation) => { o.document.documents![0].documentId = "new-doc"; },
    (o: Observation) => { o.tools[0].description = "Changed action"; },
  ]) {
    const changed = structuredClone(f.observation);
    change(changed);
    assert.throws(() => prepareWebMcpAction(f.root, f.attach(changed), f.request), /inventory|changed/i);
  }
  assert.equal(loadTaskControl(f.root, f.task.taskId).data?.action, undefined);
});

test("native evidence binds the original capture time and execution context", t => {
  const f = fixture(t);
  const old = structuredClone(f.observation);
  old.checkedAt = old.document.observedAt = new Date(Date.now() - 6 * 60_000).toISOString();
  assert.throws(() => saveInventory(f.root, f.attach(old)), /original, fresh/);
  assert.throws(() => prepareWebMcpAction(f.root, f.attach(old), f.request), /original, fresh/);
  const reused = structuredClone(f.observation);
  reused.target.context = "scheduled";
  assert.throws(() => saveInventory(f.root, reused), /evidence must match/);
});

test("inspection keeps bounded vacancy data and distinguishes provider outcomes", async () => {
  const details = { pageId: 1, toolName: "inspect_fixture" };
  const reply = (value: unknown) => async () => ({ content: [{ text: JSON.stringify(value) }] });
  assert.deepEqual(await invokeTool(reply({ status: "Completed", output: { vacancy: "fixture", token: "fake", url: "https://example.invalid/job?token=fake" } }), details, {}, true),
    { status: "completed", untrustedOutput: { vacancy: "fixture", token: "[redacted]", url: "https://example.invalid/job" } });
  assert.deepEqual(await invokeTool(reply({ status: "Pending" }), details, {}), { status: "awaitingSubmission" });
  assert.deepEqual(await invokeTool(reply({ status: "Completed", error: "synthetic error" }), details, {}), { status: "reportedError" });
  assert.deepEqual(await invokeTool(reply({ status: "Cancelled" }), details, {}), { status: "canceled" });
  assert.deepEqual(await invokeTool(reply({ status: "Completed", output: "x".repeat(16_500) }), details, {}, true), { status: "completed", outputOmitted: "tooLarge" });
  assert.deepEqual(await invokeTool(async () => { throw new Error("interrupted"); }, details, {}), { status: "unknown" });
});

test("WebMCP uses the canonical submission checkpoint and cannot dispatch again after an uncertain call", t => {
  const f = fixture(t);
  const action = prepareWebMcpAction(f.root, f.observation, f.request);
  const current = () => loadTaskControl(f.root, f.task.taskId).data;
  assert.equal(current()?.task.checkpoint, "submissionAttempted");
  assert.equal(current()?.action?.invoked, true);
  const uncertainty = f.write(".local/webmcp-test/unresolved.json", { outcome: "unknown" });
  observeWebMcpAction(f.root, action.actionId, "unknown", uncertainty);
  assert.throws(() => prepareWebMcpAction(f.root, f.observation, f.request), /awaiting submission recovery/);
  const receipt = f.write(".local/webmcp-test/receipt.json", { vacancy: "fixture-vacancy", status: "submitted" });
  const confirmed = { ...current()!.task, checkpoint: "confirmed" as const,
    confirmation: { reference: receipt.path, observedAt: new Date().toISOString() } };
  assert.throws(() => observeWebMcpAction(f.root, action.actionId, "confirmed", receipt, { ...confirmed, cvVersion: "different" }), /same vacancy/);
  observeWebMcpAction(f.root, action.actionId, "confirmed", receipt, confirmed);
  assert.equal(current()?.task.checkpoint, "confirmed");
  assert.equal(current()?.action, undefined);
});

test("a form-fill tool progresses only that step and cannot mark the task Applied", t => {
  const f = fixture(t, "fill");
  assert.throws(() => prepareWebMcpAction(f.root, f.observation, { ...f.request, purpose: "submit" }), /schema and effect/);
  const action = prepareWebMcpAction(f.root, f.observation, f.request);
  const evidence = f.write(".local/webmcp-test/form.json", { fieldsPopulated: true, submitted: false });
  assert.throws(() => observeWebMcpAction(f.root, action.actionId, "confirmed", evidence), /action-specific outcome/);
  observeWebMcpAction(f.root, action.actionId, "completed", evidence);
  assert.equal(loadTaskControl(f.root, f.task.taskId).data?.task.checkpoint, "prepared");
});
