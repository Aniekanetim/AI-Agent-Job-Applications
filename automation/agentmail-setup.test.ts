import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { AgentMailError } from "./agentmail.js";
import { readInboxConfig, checkInboxAccess, inboxCheckFailure, InboxConfigurationError } from "./agentmail-setup.js";

const inboxId = "fixture-alerts@example.invalid";
const apiKey = "synthetic # $ key";

function workspace(t: TestContext, contents?: string): string {
  const root = mkdtempSync(join(tmpdir(), "job-application-mail-setup-"));
  const folder = join(root, "automation");
  const file = join(folder, ".env");
  mkdirSync(folder);
  if (contents !== undefined) writeFileSync(file, contents, { flag: "wx" });
  t.after(() => {
    if (existsSync(file)) unlinkSync(file);
    rmdirSync(folder);
    rmdirSync(root);
  });
  return root;
}

test("inbox setup requires this copy's private environment file", t => {
  assert.throws(() => readInboxConfig(workspace(t)), InboxConfigurationError);
});

test("commented setup placeholders do not configure live access", t => {
  const root = workspace(t, '# AGENTMAIL_INBOX_ID=""\n# AGENTMAIL_API_KEY=""\n');
  assert.throws(() => readInboxConfig(root), InboxConfigurationError);
});

test("partial or blank inbox configuration stays unconfigured", t => {
  for (const contents of ['AGENTMAIL_INBOX_ID=""\nAGENTMAIL_API_KEY="fixture"',
    `AGENTMAIL_INBOX_ID="${inboxId}"\nAGENTMAIL_API_KEY=""`]) {
    assert.throws(() => readInboxConfig(workspace(t, contents)), InboxConfigurationError);
  }
});

test("private configuration preserves quoted characters without shell execution", t => {
  const root = workspace(t, `AGENTMAIL_INBOX_ID="${inboxId}"\nAGENTMAIL_API_KEY="${apiKey}"\n`);
  assert.deepEqual(readInboxConfig(root), { inboxId, apiKey });
});

test("the access check paginates headers using GET and returns no message data", async () => {
  const calls: { url: URL; method: string | undefined }[] = [];
  const result = await checkInboxAccess({ inboxId, apiKey }, async (input, init) => {
    const url = new URL(input);
    calls.push({ url, method: init?.method });
    return new Response(JSON.stringify({
      messages: [{ inbox_id: inboxId, message_id: `m${calls.length}`,
        subject: "private fixture subject", text: "private fixture body" }],
      next_page_token: calls.length === 1 ? "fixture-next-page" : undefined,
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(c => c.method === "GET" && c.url.pathname.endsWith("/messages")));
  assert.equal(calls[1].url.searchParams.get("page_token"), "fixture-next-page");
  assert.deepEqual(result, { inboxReachable: true, headersListed: 2,
    verificationScope: "Read-only message headers", messageBodiesVerified: false,
    deletionVerified: false, alertsConvertedToTasks: 0 });
  for (const value of [inboxId, apiKey, "private fixture subject", "private fixture body"]) {
    assert.equal(JSON.stringify(result).includes(value), false);
  }
});

test("an accessible empty inbox is reachable without a test send", async () => {
  let calls = 0;
  const result = await checkInboxAccess({ inboxId, apiKey }, async (_input, init) => {
    calls++;
    assert.equal(init?.method, "GET");
    return new Response(JSON.stringify({ messages: [] }), { status: 200 });
  });
  assert.equal(calls, 1);
  assert.equal(result.headersListed, 0);
  assert.equal(result.inboxReachable, true);
});

test("failed access is not reported ready and does not expose response content", async () => {
  await assert.rejects(checkInboxAccess({ inboxId, apiKey }, async () =>
    new Response(`private response ${apiKey}`, { status: 401 })), error => {
    const failure = inboxCheckFailure(error);
    assert.deepEqual(failure, { exitCode: 1,
      message: "AgentMail access could not be verified (HTTP 401)." });
    assert.equal(failure.message.includes(apiKey), false);
    return true;
  });
});

test("unexpected and network failure output is sanitized", () => {
  assert.deepEqual(inboxCheckFailure(new Error(`private error ${apiKey}`)), {
    exitCode: 1, message: "AgentMail inbox check did not complete.",
  });
  assert.deepEqual(inboxCheckFailure(new AgentMailError()), { exitCode: 1,
    message: "AgentMail access could not be verified (network or response error)." });
});

test("the CLI does not fall back to credentials inherited from another agent", t => {
  const root = workspace(t);
  const entry = fileURLToPath(new URL("./agentmail-setup.js", import.meta.url));
  const result = spawnSync(process.execPath, [entry], { cwd: root, encoding: "utf8",
    env: { ...process.env, AGENTMAIL_INBOX_ID: inboxId, AGENTMAIL_API_KEY: apiKey } });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /private automation\/\.env file/);
  assert.equal(result.stderr.includes(apiKey), false);
  assert.equal(result.stderr.includes(inboxId), false);
});
