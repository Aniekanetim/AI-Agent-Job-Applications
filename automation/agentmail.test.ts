import test from "node:test";
import assert from "node:assert/strict";
import { AgentMailInbox, AgentMailError, type Fetch } from "./agentmail.js";
import type { MessageProgress } from "./application-state.js";

const inboxId = "fixture+alerts@example.invalid";
const fakeKey = "offline-fixture-key-not-a-credential";
const complete = (): MessageProgress => ({ inboxId, messageId: "<message/with?characters>",
  enumerationComplete: true, cleanupState: "cleanupPending", vacancies: [{
    vacancyKey: "vacancy-fixture", disposition: "applied", taskId: "APP-fixture",
    taskPath: "Task Board/Applied/APP-fixture.md", applicationRecordSaved: true,
    confirmationReference: "fixture-confirmation",
  }] });
const json = (value: unknown) => new Response(JSON.stringify(value), {
  status: 200, headers: { "content-type": "application/json" },
});

test("inbox configuration must be explicit", () => {
  assert.throws(() => new AgentMailInbox({ inboxId: "", apiKey: fakeKey }));
  assert.throws(() => new AgentMailInbox({ inboxId, apiKey: "" }));
});

test("header listing paginates and does not return email bodies or authenticated headers", async () => {
  const calls: URL[] = [];
  const client = new AgentMailInbox({ inboxId, apiKey: fakeKey, fetch: async (input, init) => {
    const url = new URL(input); calls.push(url);
    assert.equal(init?.headers && (init.headers as Record<string, string>).Authorization,
      `Bearer ${fakeKey}`);
    return json({ messages: [{ inbox_id: inboxId, message_id: `m${calls.length}`,
      thread_id: "thread-fixture", timestamp: "2026-10-23T10:00:00Z", from: "alerts@example.invalid",
      text: "private-body", headers: { token: "private-header" } }],
      next_page_token: calls.length === 1 ? "opaque+page/token" : undefined });
  } });
  const found = [];
  for await (const header of client.listMessageHeaders()) found.push(header);
  assert.equal(found.length, 2);
  assert.equal(calls[1].searchParams.get("page_token"), "opaque+page/token");
  assert.equal(calls[0].searchParams.has("after"), false);
  assert.equal("text" in found[0], false);
  assert.equal("headers" in found[0], false);
});

test("repeating pagination tokens stops rather than polling indefinitely", async () => {
  const client = new AgentMailInbox({ inboxId, apiKey: fakeKey,
    fetch: async () => json({ messages: [], next_page_token: "same" }) });
  await assert.rejects(async () => { for await (const _ of client.listMessageHeaders()) { /* consume */ } },
    /pagination repeated/);
});

test("message identities are checked when reading a body", async () => {
  const client = new AgentMailInbox({ inboxId, apiKey: fakeKey,
    fetch: async () => json({ inbox_id: inboxId, message_id: "different" }) });
  await assert.rejects(client.getMessage("requested"), AgentMailError);
});

test("a successful read returns the exact requested alert", async () => {
  const client = new AgentMailInbox({ inboxId, apiKey: fakeKey,
    fetch: async () => json({ inbox_id: inboxId, message_id: "requested", text: "fixture alert" }) });
  assert.equal((await client.getMessage("requested")).text, "fixture alert");
});

test("blocked or incomplete multi-vacancy mail never reaches DELETE", async () => {
  let calls = 0;
  const client = new AgentMailInbox({ inboxId, apiKey: fakeKey,
    fetch: async () => { calls++; return new Response(null, { status: 204 }); } });
  const progress = complete(); progress.vacancies.push({ vacancyKey: "pending", disposition: "blocked" });
  await assert.rejects(client.deleteCompletedAlert(progress, async () => true));
  assert.equal(calls, 0);
});

test("cleanup requires saved private records and a persisted pending-cleanup checkpoint", async () => {
  let calls = 0;
  const client = new AgentMailInbox({ inboxId, apiKey: fakeKey,
    fetch: async () => { calls++; return new Response(null, { status: 204 }); } });
  await assert.rejects(client.deleteCompletedAlert(complete(), async () => false));
  const progress = complete(); progress.cleanupState = "notReady";
  await assert.rejects(client.deleteCompletedAlert(progress, async () => true));
  assert.equal(calls, 0);
});

test("cleanup cannot target an inbox other than the configured one", async () => {
  let calls = 0;
  const client = new AgentMailInbox({ inboxId, apiKey: fakeKey,
    fetch: async () => { calls++; return new Response(null, { status: 204 }); } });
  const progress = complete(); progress.inboxId = "another@example.invalid";
  await assert.rejects(client.deleteCompletedAlert(progress, async () => true));
  assert.equal(calls, 0);
});

test("completed mail deletes only the URL-encoded individual message", async () => {
  const calls: { input: string; init?: RequestInit }[] = [];
  const client = new AgentMailInbox({ inboxId, apiKey: fakeKey, fetch: async (input, init) => {
    calls.push({ input: String(input), init }); return new Response(null, { status: 204 });
  } });
  const progress = complete();
  await client.deleteCompletedAlert(progress, async () => true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input,
    `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(progress.messageId)}`);
  assert.equal(calls[0].init?.method, "DELETE");
  assert.equal(calls[0].input.includes("/threads/"), false);
});

test("an asynchronous storage check cannot retarget deletion by mutating its input", async () => {
  let actualUrl = "";
  const client = new AgentMailInbox({ inboxId, apiKey: fakeKey, fetch: async input => {
    actualUrl = String(input); return new Response(null, { status: 204 });
  } });
  const progress = complete(); const originalId = progress.messageId;
  await client.deleteCompletedAlert(progress, async passed => {
    passed.messageId = "other"; progress.messageId = "also-other"; return true;
  });
  assert.equal(actualUrl.endsWith(encodeURIComponent(originalId)), true);
});

test("HTTP failure preserves a retryable cleanup outcome without leaking body or key", async () => {
  const client = new AgentMailInbox({ inboxId, apiKey: fakeKey,
    fetch: async () => new Response(`private-body ${fakeKey}`, { status: 429 }) });
  await assert.rejects(client.deleteCompletedAlert(complete(), async () => true), (error: unknown) => {
    assert.ok(error instanceof AgentMailError); assert.equal(error.status, 429);
    assert.equal(error.message.includes(fakeKey), false);
    assert.equal(error.message.includes("private-body"), false); return true;
  });
});

test("network exceptions are sanitized and a 404 is not falsely claimed as deletion", async () => {
  const failing: Fetch = async () => { throw new Error(`network ${fakeKey}`); };
  const client = new AgentMailInbox({ inboxId, apiKey: fakeKey, fetch: failing });
  await assert.rejects(client.getMessage("m"), (error: unknown) => {
    assert.ok(error instanceof AgentMailError); assert.equal(error.message.includes(fakeKey), false); return true;
  });
  const missing = new AgentMailInbox({ inboxId, apiKey: fakeKey,
    fetch: async () => new Response(null, { status: 404 }) });
  await assert.rejects(missing.deleteCompletedAlert(complete(), async () => true), AgentMailError);
});
