import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync,
  readdirSync, lstatSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, relative, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { detectExistingConnections, credentialsFromSource, saveCredentialSource,
  savedCredentialSource, ConnectionSourceError } from "../email/agentmail/connection.js";
import { readInboxConfig, InboxConfigurationError } from "../email/agentmail/setup.js";

const key = "synthetic-existing-connection-not-a-real-key";
function sandbox(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "application-connection-"));
  function contained(path: string) {
    const inside = relative(root, resolve(path));
    assert.ok(!inside.startsWith("..") && !isAbsolute(inside));
    return path;
  }
  function clean(path: string) {
    contained(path);
    if (lstatSync(path).isDirectory()) {
      for (const entry of readdirSync(path)) clean(join(path, entry));
      rmdirSync(path);
    } else unlinkSync(path);
  }
  t.after(() => clean(root));
  return { root, options: { home: root, environment: {} }, file(name: string, value: string) {
    const path = contained(resolve(root, name));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, value); return path;
  } };
}

test("discovery finds configured skill access before onboarding without exposing or copying the key", t => {
  const box = sandbox(t);
  const path = box.file(".codex/skills/agentmail/.env", `AGENTMAIL_API_KEY="${key}"`);
  box.file(".codex/skills/agentmail/SKILL.md", "Synthetic skill: inspect permissions before use.");
  const original = readFileSync(path);
  const found = detectExistingConnections(box.root, box.options);
  assert.equal(found.existingSetupFound, true);
  assert.equal(found.accessVerified, false);
  assert.equal(found.candidates[0].origin, "skill");
  assert.ok(found.candidates[0].skillInstructions?.endsWith("SKILL.md"));
  assert.equal(JSON.stringify(found).includes(key), false);
  assert.deepEqual(readFileSync(path), original);
  assert.equal(existsSync(resolve(box.root, "automation/.env")), false);
  assert.equal(existsSync(resolve(box.root, ".local")), false);
});

test("an installed skill without a key is not reported as authenticated or ready", t => {
  const box = sandbox(t);
  box.file(".agents/skills/agentmail/SKILL.md", "Unconfigured fixture");
  const found = detectExistingConnections(box.root, box.options);
  assert.equal(found.existingSetupFound, false);
  assert.equal(found.candidates[0].state, "unconfigured");
  assert.equal(found.accessVerified, false);
});

test("discovery supports a configured host skill root and other known skill locations", t => {
  const box = sandbox(t);
  for (const name of ["custom/skills/agentmail/.env", ".agents/skills/agentmail/.env",
    ".claude/skills/agentmail/.env"]) box.file(name, `AGENTMAIL_API_KEY="${key}"`);
  const found = detectExistingConnections(box.root, { home: box.root,
    environment: { CODEX_HOME: resolve(box.root, "custom") } });
  assert.equal(found.candidates.length, 3);
});

test("inherited environment access is detected but needs an intentional connection selection", t => {
  const box = sandbox(t);
  const found = detectExistingConnections(box.root, { home: box.root,
    environment: { AGENTMAIL_API_KEY: key } });
  assert.equal(found.existingSetupFound, true);
  assert.equal(found.candidates[0].source.type, "environment");
  assert.equal(JSON.stringify(found).includes(key), false);
  assert.throws(() => readInboxConfig(box.root), InboxConfigurationError);
});

test("a selected existing credential file is referenced and follows rotation without copying values", t => {
  const box = sandbox(t);
  const path = box.file("existing/.env", `AGENTMAIL_API_KEY="${key}"`);
  saveCredentialSource(box.root, { type: "envFile", path });
  assert.deepEqual(readInboxConfig(box.root), { apiKey: key });
  box.file("existing/.env", 'AGENTMAIL_API_KEY="synthetic-rotated-key"');
  assert.deepEqual(readInboxConfig(box.root), { apiKey: "synthetic-rotated-key" });
  const saved = readFileSync(resolve(box.root, ".local/agentmail-connection.json"), "utf8");
  assert.equal(saved.includes(key), false);
  assert.equal(saved.includes("synthetic-rotated-key"), false);
  assert.equal(existsSync(resolve(box.root, "automation/.env")), false);
});

test("configured project credentials take precedence over another saved source", t => {
  const box = sandbox(t);
  const path = box.file("existing/.env", `AGENTMAIL_API_KEY="${key}"`);
  saveCredentialSource(box.root, { type: "envFile", path });
  box.file("automation/.env", 'AGENTMAIL_API_KEY="synthetic-project-key"');
  assert.equal(readInboxConfig(box.root).apiKey, "synthetic-project-key");
});

test("a broken selected source is preserved instead of silently replaced", t => {
  const box = sandbox(t);
  const path = resolve(box.root, "missing/.env");
  saveCredentialSource(box.root, { type: "envFile", path });
  const reference = readFileSync(resolve(box.root, ".local/agentmail-connection.json"));
  assert.throws(() => readInboxConfig(box.root), ConnectionSourceError);
  const found = detectExistingConnections(box.root, box.options);
  assert.equal(found.candidates[0].state, "unreadable");
  assert.deepEqual(readFileSync(resolve(box.root, ".local/agentmail-connection.json")), reference);
});

test("malformed saved connection metadata requires investigation without losing it", t => {
  const box = sandbox(t);
  const path = box.file(".local/agentmail-connection.json", "not json");
  const found = detectExistingConnections(box.root, box.options);
  assert.equal(found.savedReferenceNeedsAttention, true);
  assert.equal(readFileSync(path, "utf8"), "not json");
});

test("discovery reports incompatible endpoints without redirecting credentials", t => {
  const box = sandbox(t);
  const path = box.file("automation/.env", `AGENTMAIL_API_KEY="${key}"\nAGENTMAIL_BASE_URL="https://example.invalid"`);
  const found = detectExistingConnections(box.root, box.options);
  assert.equal(found.candidates[0].endpointCompatible, false);
  assert.throws(() => credentialsFromSource({ type: "envFile", path }), ConnectionSourceError);
});

function runSetup(root: string, args: string[], mockResponses: boolean | "listOnly") {
  const entry = fileURLToPath(new URL("../email/agentmail/setup.js", import.meta.url));
  const mock = mockResponses === "listOnly"
    ? `globalThis.fetch=async(url,init)=>{if(init.method!=='GET'||!new URL(url).pathname.endsWith('/inboxes'))throw new Error('Inbox metadata only');return new Response(JSON.stringify({inboxes:[{inbox_id:'fixture-existing',email:'fixture@example.invalid'}]}));};`
    : mockResponses
    ? `globalThis.fetch=async url=>new Response(JSON.stringify(String(url).includes('/messages')?{messages:[]}:{inboxes:[{inbox_id:'fixture-existing',email:'fixture@example.invalid'}]}));`
    : `globalThis.fetch=async()=>{throw new Error('Offline fixture forbids requests')};`;
  return spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(mock)}`, entry, ...args], {
    cwd: root, encoding: "utf8", env: { ...process.env, USERPROFILE: root, HOME: root,
      CODEX_HOME: resolve(root, ".codex"), AGENTMAIL_API_KEY: "", AGENTMAIL_BASE_URL: "", AGENTMAIL_INBOX_ID: "" },
  });
}

test("setup surfaces a configured host skill to the agent instead of requesting another key", t => {
  const box = sandbox(t);
  box.file(".codex/skills/agentmail/.env", `AGENTMAIL_API_KEY="${key}"`);
  const result = runSetup(box.root, ["--setup"], false);
  assert.equal(result.status, 4);
  assert.equal(JSON.parse(result.stderr).needsAgentConnection, true);
  assert.equal(result.stderr.includes(key), false);
  assert.equal(existsSync(resolve(box.root, ".local")), false);
});

test("the agent can verify and bind an existing source without copying its key", t => {
  const box = sandbox(t);
  const path = box.file("existing/.env", `AGENTMAIL_API_KEY="${key}"`);
  const result = runSetup(box.root, ["--setup", "--credential-file", path,
    "--select-address", "fixture@example.invalid"], true);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).inboxReachable, true);
  assert.deepEqual(savedCredentialSource(box.root), { type: "envFile", path });
  assert.equal(existsSync(resolve(box.root, "automation/.env")), false);
  assert.equal(result.stdout.includes(key), false);
});

test("read-only access with an existing source saves no credential or inbox binding", t => {
  const box = sandbox(t);
  const path = box.file("existing/.env", `AGENTMAIL_API_KEY="${key}"`);
  const result = runSetup(box.root, ["--credential-file", path,
    "--select-address", "fixture@example.invalid"], true);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(resolve(box.root, ".local")), false);
});

test("listing existing inboxes reads metadata only and writes no binding", t => {
  const box = sandbox(t);
  const path = box.file("existing/.env", `AGENTMAIL_API_KEY="${key}"`);
  const result = runSetup(box.root, ["--list-inboxes", "--credential-file", path], "listOnly");
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.inboxes[0].email, "fixture@example.invalid");
  assert.equal(output.messagesRead, 0);
  assert.equal(output.bindingsWritten, 0);
  assert.equal(existsSync(resolve(box.root, ".local")), false);
  assert.equal(result.stdout.includes(key), false);
});
