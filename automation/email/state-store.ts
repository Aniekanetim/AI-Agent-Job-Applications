import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { readPrivateJson, savePrivateJson } from "../workflow/private-json.js";
import { loadEmailConnection, emailCapabilityIssues, validateEmailReport, validateInventory, sourceKey, type EmailSource, type CleanupChoice } from "./connection.js";
import { validateInboxState, type InboxState, type EmailRecord, messageKey } from "./intake.js";
import { loadEmailOnboarding } from "./onboarding.js";
import { providerId } from "./discovery.js";

export function loadInboxState(root: string) {
  const found = readPrivateJson(root, ".local/inbox-state.json");
  if (found.data === null) return { state: { schemaVersion: 2, messages: [] } as InboxState, revision: null };
  validateInboxState(found.data); return { state: found.data, revision: found.revision };
}
export function saveInboxState(root: string, state: InboxState, revision: string | null) {
  validateInboxState(state);
  const previous = loadInboxState(root);
  if (previous.revision !== revision) throw new Error("Private configuration changed in another session; reload it before saving.");
  for (const old of previous.state.messages) {
    const next = state.messages.find(r => messageKey(r.identity) === messageKey(old.identity));
    if (!next) throw new Error("Preserve existing message progress and completed markers.");
    preserveRecord(old, next);
  }
  return savePrivateJson(root, ".local/inbox-state.json", state, revision);
}
function preserveRecord(old: EmailRecord, record: EmailRecord) {
  if (["deleted", "retained", "archived", "labeled"].includes(old.cleanupState) &&
    (record.cleanupState !== old.cleanupState || JSON.stringify(record.cleanupReceipt) !== JSON.stringify(old.cleanupReceipt))) throw new Error("Preserve the completed message marker and cleanup history.");
  for (const previous of old.vacancies) {
    const next = record.vacancies.find(v => v.vacancyKey === previous.vacancyKey);
    if (!next || (previous.taskId && previous.taskId !== next.taskId) ||
      (previous.postingUrl && previous.postingUrl !== next.postingUrl) ||
      (previous.disposition === "applied" && (next.disposition !== "applied" || next.confirmationReference !== previous.confirmationReference))) throw new Error("Preserve existing vacancy, posting, task and confirmation identities.");
  }
}
export function saveEmailRecord(root: string, record: EmailRecord, expectedRevision: string | null) {
  const loaded = loadInboxState(root);
  if (loaded.revision !== expectedRevision) throw new Error("Inbox progress changed; reload before saving.");
  const index = loaded.state.messages.findIndex(existing => messageKey(existing.identity) === messageKey(record.identity));
  if (index < 0) loaded.state.messages.push(record); else {
    const old = loaded.state.messages[index];
    preserveRecord(old, record);
    loaded.state.messages[index] = { ...old, ...record };
  }
  return saveInboxState(root, loaded.state, loaded.revision);
}
export function migrateInboxState(value: unknown, source: EmailSource, policyReference: string, now: string): InboxState {
  const old = value as { schemaVersion?: number; messages?: unknown[]; [key: string]: unknown };
  if (old?.schemaVersion === 2) { validateInboxState(old); return structuredClone(old); }
  if (old?.schemaVersion !== 1 || !Array.isArray(old.messages) || !policyReference.trim() || source.provider !== "agentmail" || source.transport !== "agentmail") throw new Error("Legacy email progress needs its actual AgentMail source and existing cleanup instruction.");
  const action: CleanupChoice = { mode: "delete", effect: "permanentDelete", labelId: null, sourceReference: policyReference };
  const messages = old.messages.map(value => {
    const previous = value as Record<string, unknown>;
    if (previous.inboxId !== source.mailboxId || typeof previous.messageId !== "string") throw new Error("Legacy progress belongs to another inbox; preserve it until its source is resolved.");
    const identity = { source: structuredClone(source), messageId: previous.messageId };
    const record = { ...structuredClone(previous), identity,
      classification: { kind: "jobAlert", fingerprint: createHash("sha256").update(`legacy:${messageKey(identity)}`).digest("hex"),
        rulesRevision: "legacy", ruleReference: policyReference, evidenceReference: ".local/inbox-state.json (legacy recorded work)", classifiedAt: now },
      cleanupAction: previous.cleanupState === "notReady" ? null : action,
      ...(previous.cleanupState === "deleted" ? { cleanupReceipt: { messageKey: messageKey(identity), action,
        observedAt: null, basis: "legacyCheckpoint", evidenceReference: "Legacy deleted checkpoint; original observation metadata retained, not reverified." } } : {}),
    } as EmailRecord;
    validateInboxState({ schemaVersion: 2, messages: [record] }); return record;
  });
  const migrated = { ...structuredClone(old), schemaVersion: 2, messages,
    migration: { previousSchemaVersion: 1, migratedAt: now, sourceReference: policyReference, previousMigration: old.migration ?? null } } as InboxState;
  validateInboxState(migrated); return migrated;
}
export function inspectEmailReadiness(root: string, context: "interactive" | "scheduled") {
  try {
    const setup = loadEmailOnboarding(root).state;
    if (setup.deferred) return { ready: false, issues: ["Email setup is deferred. Continue eligible manual tasks; resume email setup before reading alerts."] };
    const { connection } = loadEmailConnection(root);
    if (!connection) return { ready: false, issues: ["Select or migrate the actual email connection; preserve any existing AgentMail binding."] };
    if (setup.providerChoice && setup.providerChoice.id !== providerId(connection.source.provider)) return { ready: false, issues: ["Finish connecting the newly chosen provider; preserve the saved mailbox and its active work until an explicit source switch is safe."] };
    // Negative current account observations supersede an older successful capability report.
    // An absent account entry never authorizes selecting a different source.
    const inventory = readPrivateJson(root, ".local/email-host-connections.json").data;
    if (inventory !== null) {
      validateInventory(inventory);
      const account = inventory.candidates.find(c => sourceKey(c.source) === sourceKey(connection.source) && c.source.connectionReference === connection.source.connectionReference);
      if (account && (!account.available || account.authentication === "needsAuthentication" || account.authentication === "denied")) return {
        ready: false, issues: ["Reconnect or resolve access for the selected account in the harness; the saved selection is unchanged."] };
    }
    const report = readPrivateJson(root, context === "interactive" ? ".local/email-capabilities.json" : ".local/email-capabilities-scheduled.json").data;
    validateEmailReport(report);
    const issues = emailCapabilityIssues(connection, report, root, context);
    for (const check of Object.values(report.operations)) for (const ref of check.evidence) {
      const path = realpathSync(resolve(root, ref.path)); const part = relative(realpathSync(root), path);
      if (part === ".." || part.startsWith("../") || part.startsWith("..\\") || isAbsolute(part) ||
        createHash("sha256").update(readFileSync(path)).digest("hex") !== ref.sha256) issues.push("Email capability evidence changed or is outside this working copy.");
    }
    return { ready: issues.length === 0, issues };
  } catch { return { ready: false, issues: ["Verify the selected email connection, cleanup choice and actual tool evidence; existing records were preserved."] }; }
}
