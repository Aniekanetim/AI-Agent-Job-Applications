import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { AgentMailError } from "./agentmail.js";
import { readInboxConfig, checkInboxAccess, resolveIntakeInbox, inboxCheckFailure,
  InboxConfigurationError, InboxSelectionRequired, InboxSetupStateError } from "./agentmail-setup.js";
import type { InboxSummary } from "./agentmail-inboxes.js";

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
    const local = join(root, ".local");
    if (existsSync(local)) {
      for (const name of readdirSync(local)) unlinkSync(join(local, name));
      rmdirSync(local);
    }
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

test("a missing API key remains unconfigured regardless of an optional inbox override", t => {
  for (const contents of ['AGENTMAIL_API_KEY=""',
    `AGENTMAIL_INBOX_ID="${inboxId}"\nAGENTMAIL_API_KEY=""`]) {
    assert.throws(() => readInboxConfig(workspace(t, contents)), InboxConfigurationError);
  }
});

test("an API key alone is sufficient configuration", t => {
  assert.deepEqual(readInboxConfig(workspace(t, `AGENTMAIL_API_KEY="${apiKey}"\n`)), { apiKey });
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

const reply = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
const mailbox = (id: string, extra: Partial<InboxSummary> = {}): InboxSummary => ({
  inbox_id: id, email: `${id}@example.invalid`, ...extra,
});

test("API-key-only setup discovers and saves the sole mailbox before checking headers", async t => {
  const root = workspace(t, `AGENTMAIL_API_KEY="${apiKey}"\n`);
  const config = readInboxConfig(root);
  const methods: string[] = [];
  const http = async (input: string | URL, init?: RequestInit) => {
    methods.push(init?.method ?? "");
    return new URL(input).pathname.endsWith("/inboxes")
      ? reply({ inboxes: [mailbox("discovered")], next_page_token: null })
      : reply({ messages: [] });
  };
  const selected = await resolveIntakeInbox(root, config, { allowCreate: true, http });
  const result = await checkInboxAccess({ ...config, inboxId: selected.inbox_id }, http);
  assert.equal(result.inboxReachable, true);
  assert.deepEqual(methods, ["GET", "GET"]);
  const state = JSON.parse(readFileSync(join(root, ".local/agentmail-intake.json"), "utf8"));
  assert.equal(state.inboxId, "discovered");
  assert.equal(JSON.stringify(state).includes(apiKey), false);
});

test("inbox discovery visits every page before choosing the unique intake mailbox", async t => {
  let pages = 0;
  const selected = await resolveIntakeInbox(workspace(t), { apiKey }, { http: async (input, init) => {
    assert.equal(init?.method, "GET");
    pages++;
    if (pages === 1) return reply({ inboxes: [mailbox("general")], next_page_token: "next+page" });
    assert.equal(new URL(input).searchParams.get("page_token"), "next+page");
    return reply({ inboxes: [mailbox("alerts", { display_name: "Job application alerts" })] });
  } });
  assert.equal(pages, 2);
  assert.equal(selected.inbox_id, "alerts");
});

test("setup creates one intake mailbox when none exist and reuses it on restart", async t => {
  const root = workspace(t);
  let created: InboxSummary | undefined;
  let posts = 0;
  const http = async (_input: string | URL, init?: RequestInit) => {
    if (init?.method === "GET") return reply({ inboxes: created ? [created] : [] });
    assert.equal(init?.method, "POST"); posts++;
    const body = JSON.parse(String(init.body));
    const state = JSON.parse(readFileSync(join(root, ".local/agentmail-intake.json"), "utf8"));
    assert.equal(body.client_id, state.clientId);
    created = mailbox("created", { client_id: body.client_id });
    return reply(created);
  };
  await resolveIntakeInbox(root, { apiKey }, { allowCreate: true, http });
  const again = await resolveIntakeInbox(root, { apiKey }, { allowCreate: true, http });
  assert.equal(posts, 1);
  assert.equal(again.inbox_id, "created");
});

test("an interrupted create retries with the same persisted provider client ID", async t => {
  const root = workspace(t);
  const clientIds: string[] = [];
  const http = async (_input: string | URL, init?: RequestInit) => {
    if (init?.method === "GET") return reply({ inboxes: [] });
    const body = JSON.parse(String(init?.body)); clientIds.push(body.client_id);
    if (clientIds.length === 1) throw new Error(`lost response ${apiKey}`);
    return reply(mailbox("same-created-inbox", { client_id: body.client_id }));
  };
  await assert.rejects(resolveIntakeInbox(root, { apiKey }, { allowCreate: true, http }), AgentMailError);
  const resolved = await resolveIntakeInbox(root, { apiKey }, { allowCreate: true, http });
  assert.equal(clientIds.length, 2);
  assert.equal(clientIds[0], clientIds[1]);
  assert.equal(resolved.inbox_id, "same-created-inbox");
});

test("concurrent first starts share one creation identity", async t => {
  const root = workspace(t); const clientIds: string[] = [];
  const http = async (_input: string | URL, init?: RequestInit) => {
    if (init?.method === "GET") return reply({ inboxes: [] });
    const body = JSON.parse(String(init?.body)); clientIds.push(body.client_id);
    return reply(mailbox("one-inbox", { client_id: body.client_id }));
  };
  const found = await Promise.all([1, 2].map(() =>
    resolveIntakeInbox(root, { apiKey }, { allowCreate: true, http })));
  assert.equal(new Set(clientIds).size, 1);
  assert.ok(found.every(item => item.inbox_id === "one-inbox"));
});

test("the read-only check never provisions an inbox or writes binding state", async t => {
  const root = workspace(t); const methods: string[] = [];
  await assert.rejects(resolveIntakeInbox(root, { apiKey }, { http: async (_input, init) => {
    methods.push(init?.method ?? ""); return reply({ inboxes: [] });
  } }), InboxSelectionRequired);
  assert.deepEqual(methods, ["GET"]);
  assert.equal(existsSync(join(root, ".local/agentmail-intake.json")), false);
});

test("multiple plausible inboxes are returned to the agent instead of choosing the first", async t => {
  const root = workspace(t);
  const candidates = [mailbox("one"), mailbox("two")];
  const http = async (_input: string | URL, init?: RequestInit) => {
    assert.equal(init?.method, "GET"); return reply({ inboxes: candidates });
  };
  await assert.rejects(resolveIntakeInbox(root, { apiKey }, { allowCreate: true, http }), error => {
    assert.ok(error instanceof InboxSelectionRequired);
    assert.equal(error.candidates.length, 2);
    assert.equal(inboxCheckFailure(error).exitCode, 3);
    return true;
  });
  const selected = await resolveIntakeInbox(root, { apiKey }, {
    allowCreate: true, selectedInboxId: "two", http,
  });
  assert.equal(selected.inbox_id, "two");
});

test("an unavailable saved inbox is preserved rather than silently replaced", async t => {
  const root = workspace(t); mkdirSync(join(root, ".local"));
  const path = join(root, ".local/agentmail-intake.json");
  const saved = JSON.stringify({ schemaVersion: 1, inboxId: "previous-inbox" });
  writeFileSync(path, saved);
  await assert.rejects(resolveIntakeInbox(root, { apiKey }, { allowCreate: true,
    http: async (_input, init) => {
      assert.equal(init?.method, "GET"); return reply({ inboxes: [mailbox("different-inbox")] });
    } }), InboxSetupStateError);
  assert.equal(readFileSync(path, "utf8"), saved);
});

test("a paused saved inbox is an access dependency, not permission to create another", async t => {
  await assert.rejects(resolveIntakeInbox(workspace(t), { apiKey, inboxId: "paused" }, {
    allowCreate: true, http: async (_input, init) => {
      assert.equal(init?.method, "GET");
      return reply({ inboxes: [mailbox("paused", { status: "paused" })] });
    },
  }), InboxSetupStateError);
});

test("repeated listing tokens and malformed responses stop discovery without provisioning", async t => {
  let calls = 0;
  await assert.rejects(resolveIntakeInbox(workspace(t), { apiKey }, { allowCreate: true,
    http: async (_input, init) => {
      calls++; assert.equal(init?.method, "GET");
      return reply({ inboxes: [], next_page_token: "repeat" });
    } }), AgentMailError);
  assert.equal(calls, 2);
  await assert.rejects(resolveIntakeInbox(workspace(t), { apiKey }, {
    allowCreate: true, http: async () => reply({ inboxes: [{ inbox_id: "" }] }),
  }), AgentMailError);
});

test("a listing permission failure remains blocked and cannot trigger inbox creation", async t => {
  await assert.rejects(resolveIntakeInbox(workspace(t), { apiKey }, { allowCreate: true,
    http: async (_input, init) => {
      assert.equal(init?.method, "GET"); return new Response(`private ${apiKey}`, { status: 403 });
    } }), error => {
      const failure = inboxCheckFailure(error);
      assert.equal(failure.exitCode, 1);
      assert.equal(failure.message.includes(apiKey), false);
      return true;
    });
});
