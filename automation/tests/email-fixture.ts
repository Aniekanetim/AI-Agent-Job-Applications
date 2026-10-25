import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import type { TestContext } from "node:test";
import { classifyMessage, messageKey, type EmailRecord } from "../email/intake.js";
import { evidenceFile } from "../email/evidence.js";
import { createInventory, type SourceCapture } from "../email/inventory.js";
import { taskRecordBlock } from "../email/verification.js";
import { saveEmailConnection, operations, sourceKey, type CleanupChoice, type EmailSource, type EmailConnection, type EmailCapabilityReport } from "../email/connection.js";
import { loadInboxState, saveEmailRecord } from "../email/state-store.js";

export const fixtureNow = "2026-10-25T15:00:00.000Z";
export function writeFixture(root: string, path: string, value: unknown) {
  mkdirSync(dirname(resolve(root, path)), { recursive: true });
  writeFileSync(resolve(root, path), typeof value === "string" ? value : JSON.stringify(value, null, 2));
  return evidenceFile(root, path);
}
/** Actual synthetic files, never a live mailbox or real submission. */
export function bindFixture(root: string, record: EmailRecord, count = 1) {
  const key = messageKey(record.identity), base = `.local/alerts/${key}`;
  const capture: SourceCapture = { schemaVersion: 1, messageKey: key, completeness: "full", observedAt: fixtureNow, toolReference: "synthetic-message-body",
    html: Array.from({ length: count }, (_, i) => `<a href="https://jobs.example.invalid/view?job=${i + 1}">Job ${i + 1}</a>`).join("\n") };
  const source = writeFixture(root, `${base}/source.json`, capture);
  record.inventory = createInventory(root, source);
  record.inventory.decisions = record.inventory.candidates.map((c, i) => ({ candidateId: c.candidateId, kind: "posting", vacancyKey: `job-${i + 1}`, postingUrl: c.href, evidence: source }));
  record.enumerationComplete = true;
  record.vacancies = record.inventory.decisions.map((d, i) => {
    const taskId = i === 0 ? "APP-synthetic" : `APP-synthetic-${i + 1}`;
    const taskPath = `Task Board/Applied/${taskId}-${key.slice(0, 8)}.md`, reference = `synthetic-confirmation-${i + 1}`;
    const raw = writeFixture(root, `${base}/confirmation-${i + 1}.json`, { synthetic: true, vacancyKey: d.vacancyKey, postingUrl: d.postingUrl, reference });
    const taskEvidence = writeFixture(root, taskPath, `# Synthetic application ${i + 1}\n\n${taskRecordBlock({ schemaVersion: 1, messageKey: key,
      vacancyKey: d.vacancyKey!, postingUrl: d.postingUrl!, confirmationEvidence: raw,
      task: { taskId, originalIntake: "Email Alerts", selectedRoleId: "synthetic-role", cvVersion: "synthetic-v1", cvSha256: "a".repeat(64), checkpoint: "confirmed", confirmation: { reference, observedAt: fixtureNow } } })}\n`);
    const outcomeEvidence = writeFixture(root, `${base}/outcome-${i + 1}.json`, { schemaVersion: 1, messageKey: key, vacancyKey: d.vacancyKey,
      postingUrl: d.postingUrl, kind: "applied", observedAt: fixtureNow, taskId, confirmationReference: reference, evidence: raw });
    return { vacancyKey: d.vacancyKey!, postingUrl: d.postingUrl, disposition: "applied" as const, taskId, taskPath, taskEvidence, outcomeEvidence, confirmationReference: reference, applicationRecordSaved: true };
  });
  return record;
}
export function alertFixture(t: TestContext, count = 4, mode: CleanupChoice["mode"] = "delete", suppliedSource?: EmailSource) {
  const root = mkdtempSync(join(tmpdir(), "alert-coordination-"));
  execFileSync("git", ["init", "--quiet", root], { windowsHide: true });
  writeFileSync(join(root, ".gitignore"), ".local/\nTask Board/*/*.md\n");
  t.after(() => { const part = relative(tmpdir(), resolve(root)); if (!part || part.startsWith("..") || isAbsolute(part)) throw new Error("Unsafe temp cleanup."); rmSync(root, { recursive: true }); });
  const source: EmailSource = suppliedSource ?? { provider: "gmail", accountId: "synthetic-account", mailboxId: "synthetic-mailbox", address: "candidate@example.invalid", transport: "hostConnector", connectionReference: "synthetic-session" };
  const evidence = writeFixture(root, ".local/capability-proof.md", "Synthetic capability evidence; no real account accessed.");
  const action: CleanupChoice = { mode, effect: mode === "delete" ? source.provider === "agentmail" ? "permanentDelete" : "trash" : mode, labelId: mode === "label" ? "handled" : null, sourceReference: "synthetic-user-instruction" };
  const connection: EmailConnection = { schemaVersion: 1, source, selection: { method: "user", sourceReference: "synthetic-user" }, scope: { folderOrLabel: "Jobs", query: null, ruleReference: evidence.path, revision: "v1" }, cleanup: action };
  saveEmailConnection(root, connection, null);
  const report: EmailCapabilityReport = { schemaVersion: 1, sourceKey: sourceKey(source), connectionReference: source.connectionReference, workingRoot: root, executionContext: "interactive", checkedAt: fixtureNow,
    operations: Object.fromEntries(operations.map(operation => [operation, { status: ["list", "read", mode].includes(operation) ? "verified" : "unsupported", granularity: "message", effect: operation === "delete" ? action.effect : ["archive", "label"].includes(operation) ? operation : null, requiresConfirmation: false, evidence: [evidence], reason: ["list", "read", mode].includes(operation) ? null : "Synthetic unavailable operation." }])) as EmailCapabilityReport["operations"] };
  writeFixture(root, ".local/email-capabilities.json", report);
  const identity = { source, messageId: "<synthetic/message?4>" };
  const record = bindFixture(root, classifyMessage({ ...identity, from: "alerts@example.invalid", timestamp: fixtureNow }, "jobAlert", "v1", evidence.path, evidence.path, fixtureNow), count);
  saveEmailRecord(root, record, null);
  const save = () => saveEmailRecord(root, record, loadInboxState(root).revision);
  const options = { root, connection, report, identity, context: "interactive" as const, now: fixtureNow };
  return { ...options, record, save, options };
}
