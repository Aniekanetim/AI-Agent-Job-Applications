import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, cpSync } from "node:fs";
import { join, resolve, relative, isAbsolute, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { normalizeCodexCatalog, validateProviderCatalog, providerOptions, formatProviderOptions, type ProviderCatalog } from "../email/discovery.js";
import { saveEmailConnection, loadEmailConnection, validateInventory, type ConnectionInventory, type EmailConnection } from "../email/connection.js";
import { emptyEmailOnboarding, chooseEmailProvider, loadEmailOnboarding, saveEmailOnboarding, emailSetupStatus, formatEmailSetup, validateEmailOnboarding } from "../email/onboarding.js";
import { inspectEmailReadiness } from "../email/state-store.js";

const now = "2026-10-25T16:00:00.000Z";
const source = { provider: "gmail", accountId: "synthetic-account", mailboxId: "synthetic-mailbox", address: "candidate@example.invalid", transport: "hostConnector" as const, connectionReference: "synthetic-connection" };
const selected: EmailConnection = { schemaVersion: 1, source, selection: { method: "user", sourceReference: "synthetic-reply" },
  scope: { folderOrLabel: null, query: null, ruleReference: "synthetic-rules", revision: "v1" }, cleanup: null };
const inventory = (authentication: "connected" | "needsAuthentication" | "denied" | "unverified" = "connected"): ConnectionInventory => ({ schemaVersion: 1,
  candidates: [{ id: "gmail-one", source, available: true, authentication, evidenceReference: "synthetic-account-metadata" }] });
function sandbox(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "email-discovery-"));
  execFileSync("git", ["init", "--quiet", root], { windowsHide: true });
  mkdirSync(join(root, ".local")); writeFileSync(join(root, ".gitignore"), ".local/\n");
  t.after(() => { const part = relative(tmpdir(), resolve(root)); assert.ok(part && !part.startsWith("..") && !isAbsolute(part)); rmSync(root, { recursive: true }); });
  return root;
}
const catalog = (root = "synthetic-root"): ProviderCatalog => normalizeCodexCatalog({ installed: [], available: [
  { name: "outlook-email", installed: false }, { name: "gmail", installed: false },
] }, "codexCli", root, now, "synthetic-catalog-response");

test("fresh onboarding lists Google first, Outlook when discovered, optional AgentMail and manual-only deferral", () => {
  const options = providerOptions(catalog(), null, null, "synthetic-root");
  assert.deepEqual(options.map(p => p.id), ["gmail", "outlook", "agentmail"]);
  assert.equal(options[0].action, "Connect"); assert.deepEqual(options[0].accounts, []);
  assert.match(formatProviderOptions(options), /1\. Google — Gmail \/ Google Workspace — Connect/);
  assert.match(formatProviderOptions(options), /Set up email later — continue with manual tasks/);
});
test("a missing or differently scoped catalog means unknown, never unsupported or authenticated", () => {
  for (const input of [null, catalog("another-root"), { ...catalog(), executionContext: "scheduled" as const }]) {
    const options = providerOptions(input, null, null, "synthetic-root");
    assert.deepEqual(options.map(p => p.id), ["gmail", "agentmail"]);
    assert.equal(options[0].availability, "unknown"); assert.equal(options[0].action, "Not yet verified");
  }
});
test("Codex normalization ignores unrelated email descriptions and calendar integrations", () => {
  const c = normalizeCodexCatalog({ plugins: [
    { name: "gmail", installed: false, status: "ENABLED" },
    { name: "outlook-calendar", installed: false },
    { name: "todo-list", description: "Connect Gmail and Outlook", installed: true },
    { name: "constructor" }, { name: "__proto__" },
  ] }, "codexDirectory", "synthetic-root", now, "synthetic-tool-result");
  assert.deepEqual(c.providers.map(p => p.id), ["gmail"]);
  assert.throws(() => normalizeCodexCatalog({ unexpected: [] }, "codexCli", "root", now, "ref"));
});
test("disabled or denied integrations give an access action without fabricating a connected account", () => {
  const c = normalizeCodexCatalog({ installed: [{ name: "gmail", installed: true, enabled: false }], available: [{ name: "gmail" }] }, "codexCli", "synthetic-root", now, "synthetic-status");
  const options = providerOptions(c, null, null, "synthetic-root");
  assert.equal(options[0].availability, "restricted"); assert.equal(options[0].action, "Check access");
  assert.equal(options[0].accounts.length, 0);
});
test("account authentication is explicit; old account inventories do not imply authentication", () => {
  const connected = providerOptions(catalog(), inventory(), null, "synthetic-root")[0];
  assert.equal(connected.accounts[0].action, "Use existing connection");
  assert.equal(providerOptions(catalog(), inventory("needsAuthentication"), null, "synthetic-root")[0].accounts[0].action, "Reconnect");
  const legacy = inventory(); delete legacy.candidates[0].authentication;
  assert.doesNotThrow(() => validateInventory(legacy));
  assert.equal(providerOptions(catalog(), legacy, null, "synthetic-root")[0].accounts[0].action, "Verify connection");
});
test("multiple Gmail accounts remain separate and none is chosen automatically", () => {
  const many = inventory(); many.candidates.push({ ...many.candidates[0], id: "gmail-two", source: { ...source, accountId: "other-account", address: "other@example.invalid" } });
  const option = providerOptions(catalog(), many, null, "synthetic-root")[0];
  assert.equal(option.accounts.length, 2); assert.equal(option.selected, false);
  assert.equal(option.action, "Choose an account");
});
test("Claude Code and other providers use real observed catalog metadata without requiring a Codex CLI", () => {
  const c: ProviderCatalog = { ...catalog(), harness: "claudeCode", providers: [...catalog().providers,
    { id: "other-mail", displayName: "Other mail", availability: "available", connectionRoute: "harness", evidenceReference: "synthetic-mcp-observation", reason: null }] };
  assert.doesNotThrow(() => validateProviderCatalog(c));
  assert.deepEqual(providerOptions(c, null, null, "synthetic-root").map(p => p.id), ["gmail", "outlook", "other-mail", "agentmail"]);
});
test("catalog and checkpoint validation reject credential fields and false ready flags", () => {
  assert.throws(() => validateProviderCatalog({ ...catalog(), accessToken: "synthetic-secret" }));
  assert.throws(() => validateProviderCatalog({ ...catalog(), providers: [{ ...catalog().providers[0], credentials: "synthetic-secret" }] }));
  assert.throws(() => chooseEmailProvider(emptyEmailOnboarding(), "gmail", "", now));
  assert.throws(() => validateEmailOnboarding({ ...emptyEmailOnboarding(), ready: true }));
  assert.throws(() => validateProviderCatalog({ ...catalog(), discovery: "unavailable" }));
});
test("discovery and interrupted provider setup preserve the saved AgentMail choice and private files", t => {
  const root = sandbox(t);
  const mail = { ...selected, source: { ...source, provider: "agentmail", transport: "agentmail" as const } };
  saveEmailConnection(root, mail, null);
  const original = readFileSync(join(root, ".local/email-connection.json"));
  const defaults = loadEmailOnboarding(root);
  assert.equal(defaults.state.providerChoice, null); assert.equal(defaults.revision, null);
  const setup = chooseEmailProvider(defaults.state, "gmail", "synthetic-user-choice", now);
  saveEmailOnboarding(root, setup, defaults.revision);
  assert.equal(loadEmailConnection(root).connection?.source.provider, "agentmail");
  assert.deepEqual(readFileSync(join(root, ".local/email-connection.json")), original);
  assert.equal(emailSetupStatus(root, true).ready, false);
  assert.equal(emailSetupStatus(root, true).stage, "authentication");
  assert.equal(inspectEmailReadiness(root, "interactive").ready, false);
  assert.throws(() => saveEmailOnboarding(root, setup, null), /changed/);
});
test("saved account selection alone is never displayed as verified authentication or readiness", t => {
  const root = sandbox(t); saveEmailConnection(root, selected, null);
  const view = formatEmailSetup(emailSetupStatus(root, false));
  assert.match(view, /✓ Save the account selection/);
  assert.doesNotMatch(view, /✓ Confirm account authentication|✓ Verify actual email access/);
  assert.equal(emailSetupStatus(root, false).ready, false);
});
test("an expired saved connection shows the reconnect action and retains its account selection", t => {
  const root = sandbox(t); saveEmailConnection(root, selected, null);
  writeFileSync(join(root, ".local/email-host-connections.json"), JSON.stringify(inventory("needsAuthentication")));
  const status = emailSetupStatus(root, false);
  assert.equal(status.stage, "authentication"); assert.match(status.nextAction, /Reconnect the saved account/);
  assert.equal(status.accountSelected, true); assert.equal(status.authenticationVerified, false);
});
test("deferring email persists a resumable checkpoint without deleting the mailbox choice or claiming readiness", t => {
  const root = sandbox(t); saveEmailConnection(root, selected, null);
  const before = readFileSync(join(root, ".local/email-connection.json"));
  const setup = chooseEmailProvider(emptyEmailOnboarding(), "gmail", "synthetic-user-choice", now);
  setup.checkpoint = { stage: "accountChoice", nextAction: "Choose among the observed accounts.", recordedAt: now };
  setup.deferred = { reason: "Continue manual tasks first.", sourceReference: "synthetic-user-deferral", recordedAt: now };
  saveEmailOnboarding(root, setup, null);
  assert.equal(emailSetupStatus(root, true).stage, "deferred");
  assert.equal(inspectEmailReadiness(root, "scheduled").ready, false);
  const resumed = loadEmailOnboarding(root); resumed.state.deferred = null;
  saveEmailOnboarding(root, resumed.state, resumed.revision);
  assert.deepEqual(loadEmailOnboarding(root).state.checkpoint, setup.checkpoint);
  assert.deepEqual(readFileSync(join(root, ".local/email-connection.json")), before);
});
test("CLI imports catalog, offers options, resumes checkpoints and rejects expired account selection without mailbox calls", t => {
  const root = sandbox(t); writeFileSync(join(root, "package.json"), '{"type":"module"}');
  cpSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."), join(root, ".local/build/automation"), { recursive: true });
  writeFileSync(join(root, ".local/catalog-input.json"), JSON.stringify(catalog(root)));
  const run = (...args: string[]) => spawnSync(process.execPath, [join(root, ".local/build/automation/email/cli.js"), ...args], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(run("catalog", "--file", ".local/catalog-input.json").status, 0);
  const options = run("options"); assert.equal(options.status, 0); assert.match(options.stdout, /1\. Google/);
  assert.equal(run("onboarding", "choose", "--provider", "gmail", "--source-reference", "synthetic-choice").status, 0);
  assert.equal(run("onboarding", "checkpoint", "--stage", "authentication", "--next-action", "Finish the harness sign-in.").status, 0);
  assert.equal(run("onboarding", "defer", "--reason", "Later", "--source-reference", "synthetic-reply").status, 0);
  assert.equal(JSON.parse(run("status").stdout).setup.deferred, true);
  assert.equal(run("onboarding", "resume", "--source-reference", "synthetic-reply").status, 0);
  writeFileSync(join(root, ".local/email-host-connections.json"), JSON.stringify(inventory("needsAuthentication")));
  assert.equal(run("select", "--candidate", "gmail-one", "--source-reference", "synthetic-choice", "--rule-reference", "rules", "--rules-revision", "1").status, 1);
  assert.equal(loadEmailConnection(root).connection, null);
  assert.equal(run("onboarding", "checkpoint", "--stage", "ready", "--next-action", "Pretend ready").status, 1);
});
