import { randomUUID } from "node:crypto";
import { emailCapabilityIssues, loadEmailConnection, sourceKey, type EmailConnection, type EmailCapabilityReport, type CleanupChoice } from "./connection.js";
import { readPrivateJson } from "../workflow/private-json.js";
import { alertWorkComplete, messageKey, terminalCleanup, type EmailIdentity, type EmailRecord, type CleanupReceipt } from "./intake.js";
import { loadInboxState, saveInboxState, inspectEmailReadiness } from "./state-store.js";
import type { EmailTransport } from "./host-connectors/adapter.js";

/** Persist work first; a timeout or failed cleanup can never restart an application. */
export async function cleanupCompletedAlert(options: {
  root: string; connection: EmailConnection; report: EmailCapabilityReport; context: "interactive" | "scheduled";
  transport: EmailTransport; identity: EmailIdentity; now: string;
  verifyPersistence: (record: EmailRecord) => Promise<boolean>;
}) {
  const { root, connection, transport, now } = options;
  const identity: EmailIdentity = { source: structuredClone(options.identity.source), messageId: options.identity.messageId };
  const saved = loadEmailConnection(root).connection;
  const savedReport = readPrivateJson(root, options.context === "interactive" ? ".local/email-capabilities.json" : ".local/email-capabilities-scheduled.json").data;
  if (JSON.stringify(saved) !== JSON.stringify(connection) || JSON.stringify(savedReport) !== JSON.stringify(options.report)) throw new Error("Reload the selected connection and actual capability report before cleanup.");
  const key = messageKey(identity);
  if (sourceKey(connection.source) !== sourceKey(identity.source) || sourceKey(transport.source) !== sourceKey(identity.source)) throw new Error("Cleanup must stay on the selected message/account.");
  const loaded = loadInboxState(root);
  const record = loaded.state.messages.find(record => messageKey(record.identity) === key);
  if (!record) throw new Error("Save this alert's task and completion records before cleanup.");
  if (terminalCleanup(record)) return { state: "complete" as const, receipt: record.cleanupReceipt! };
  if (!alertWorkComplete(record) || !await options.verifyPersistence(structuredClone(record))) throw new Error("The classified alert still has unresolved or unverified saved work.");
  const issues = [...emailCapabilityIssues(connection, options.report, root, options.context), ...inspectEmailReadiness(root, options.context).issues];
  if (issues.length || !connection.cleanup) throw new Error(issues.join(" ") || "Choose alert cleanup first.");
  const action = connection.cleanup;
  const priorPending = record.cleanupState === "cleanupPending";
  if (priorPending && JSON.stringify(record.cleanupAction) !== JSON.stringify(action)) throw new Error("Resolve the pending cleanup outcome before changing its action.");
  record.cleanupState = "cleanupPending"; record.cleanupAction = structuredClone(action);
  if (!priorPending) record.cleanupAttempt = { startedAt: now, reference: `email-cleanup-${randomUUID()}` };
  saveInboxState(root, loaded.state, loaded.revision);
  const pending = loadInboxState(root);
  const pendingRecord = pending.state.messages.find(value => messageKey(value.identity) === key)!;
  let result: { evidenceReference: string; observedAt: string };
  if (action.mode === "retain") result = { evidenceReference: "Persisted completed-alert marker; source message retained.", observedAt: now };
  else {
    if (priorPending) {
      const observed = await transport.observeCleanup?.(identity, action);
      if (!observed || !["applied", "notApplied"].includes(observed.state) || !observed.evidenceReference?.trim() ||
        !Number.isFinite(Date.parse(observed.observedAt))) return { state: "pending" as const, reason: "Inspect the same message's cleanup outcome before retrying." };
      if (observed.state === "applied") result = observed;
      else result = await transport.applyCleanup(identity, action);
    } else result = await transport.applyCleanup(identity, action);
  }
  if (!result.evidenceReference?.trim() || !Number.isFinite(Date.parse(result.observedAt))) throw new Error("Cleanup has no confirmed result; its pending checkpoint was preserved.");
  // Another writer's changes must not be replaced by this delayed result.
  const latest = loadInboxState(root);
  if (latest.revision !== pending.revision) throw new Error("Inbox progress changed during cleanup; reconcile the saved attempt before continuing.");
  const receipt: CleanupReceipt = { messageKey: key, action: structuredClone(action), observedAt: result.observedAt, evidenceReference: result.evidenceReference, basis: "observed" };
  const states: Record<CleanupChoice["mode"], EmailRecord["cleanupState"]> = { delete: "deleted", archive: "archived", label: "labeled", retain: "retained" };
  pendingRecord.cleanupState = states[action.mode]; pendingRecord.cleanupReceipt = receipt;
  saveInboxState(root, pending.state, latest.revision);
  return { state: "complete" as const, receipt };
}
