import { randomUUID } from "node:crypto";
import { emailCapabilityIssues, loadEmailConnection, sourceKey, type EmailConnection, type EmailCapabilityReport, type CleanupChoice } from "./connection.js";
import { readPrivateJson } from "../workflow/private-json.js";
import { acquireOwnership, OwnershipBusy, resumeNativeOwnership, type Ownership } from "../workflow/ownership.js";
import { messageKey, terminalCleanup, type EmailIdentity, type EmailRecord, type CleanupReceipt } from "./intake.js";
import { loadInboxState, saveInboxState, inspectEmailReadiness } from "./state-store.js";
import { verifyAlertCompletion } from "./verification.js";
import { digest as hash, readEvidence, type FileEvidence } from "./evidence.js";
import { issueCleanupAuthorization } from "./authorization.js";
import type { EmailTransport } from "./host-connectors/adapter.js";

export interface CleanupOptions {
  root: string; connection: EmailConnection; report: EmailCapabilityReport; context: "interactive" | "scheduled";
  identity: EmailIdentity; now: string;
  /** Additional veto only; true never substitutes for built-in verification. */
  verifyPersistence?: (record: EmailRecord) => Promise<boolean>;
}
const lockKey = (identity: EmailIdentity) => `alert:${messageKey(identity)}`;
const workDigest = (record: EmailRecord) => hash(JSON.stringify([record.identity, record.classification, record.enumerationComplete, record.inventory, record.vacancies]));
function current(root: string, identity: EmailIdentity) {
  const loaded = loadInboxState(root), record = loaded.state.messages.find(r => messageKey(r.identity) === messageKey(identity));
  if (!record) throw new Error("Save this alert's task and completion records before cleanup.");
  return { ...loaded, record };
}
function selected(options: CleanupOptions) {
  const { root, connection, context } = options;
  const saved = loadEmailConnection(root).connection;
  const report = readPrivateJson(root, context === "interactive" ? ".local/email-capabilities.json" : ".local/email-capabilities-scheduled.json").data;
  if (JSON.stringify(saved) !== JSON.stringify(connection) || JSON.stringify(report) !== JSON.stringify(options.report)) throw new Error("Reload the selected connection and actual capability report before cleanup.");
  if (sourceKey(connection.source) !== sourceKey(options.identity.source)) throw new Error("Cleanup must stay on the selected message/account.");
  const issues = [...emailCapabilityIssues(connection, options.report, root, context), ...inspectEmailReadiness(root, context).issues];
  if (issues.length || !connection.cleanup) throw new Error(issues.join(" ") || "Choose alert cleanup first.");
  return connection.cleanup;
}
/** Merge this message only; preserve other workers' message updates. */
function change(root: string, identity: EmailIdentity, apply: (record: EmailRecord) => void) {
  for (let n = 0; n < 8; n++) {
    const loaded = current(root, identity); apply(loaded.record);
    try { saveInboxState(root, loaded.state, loaded.revision); return loaded.record; }
    catch (error) { if (!/changed in another session/.test(String(error))) throw error; }
  }
  throw new Error("Inbox progress is busy; preserve this attempt and retry reconciliation.");
}
function proof(options: CleanupOptions, owner: Ownership, expected: string) {
  owner.assertOwned(); selected(options);
  const record = current(options.root, options.identity).record;
  if (verifyAlertCompletion(options.root, record).digest !== expected) throw new Error("This alert's work changed; reconcile the pending cleanup attempt.");
  return record;
}
async function prepare(options: CleanupOptions, owner: Ownership, native?: { ownerId: string; token: string }) {
  owner.assertOwned(); const action = selected(options), old = current(options.root, options.identity).record;
  if (terminalCleanup(old)) return { terminal: old.cleanupReceipt! };
  verifyAlertCompletion(options.root, old);
  if (options.verifyPersistence && !await options.verifyPersistence(structuredClone(old))) throw new Error("Additional saved-work verification rejected cleanup.");
  const priorPending = old.cleanupState === "cleanupPending";
  if (priorPending && JSON.stringify(old.cleanupAction) !== JSON.stringify(action)) throw new Error("Resolve pending cleanup before changing its action.");
  if (old.cleanupAttempt?.native && !native) throw new Error("Resume the existing native cleanup owner; do not replace it with a callback transport.");
  const before = JSON.stringify(old);
  const record = change(options.root, options.identity, record => {
    owner.assertOwned(); if (JSON.stringify(record) !== before) throw new Error("This alert changed while preparing cleanup.");
    record.cleanupState = "cleanupPending"; record.cleanupAction = structuredClone(action);
    record.cleanupAttempt ??= { startedAt: options.now, reference: `email-cleanup-${randomUUID()}` };
    record.cleanupAttempt.workDigest = workDigest(record);
    if (native) record.cleanupAttempt.native = { ...native, phase: priorPending ? "inspect" : "prepared", round: 0 };
  });
  return { action, priorPending, record, digest: verifyAlertCompletion(options.root, record).digest };
}
function finish(options: CleanupOptions, owner: Ownership, expected: string, result: { evidenceReference: string; observedAt: string }) {
  if (!result.evidenceReference?.trim() || !Number.isFinite(Date.parse(result.observedAt))) throw new Error("Cleanup has no confirmed result; its pending checkpoint was preserved.");
  proof(options, owner, expected);
  const action = options.connection.cleanup!;
  const receipt: CleanupReceipt = { messageKey: messageKey(options.identity), action: structuredClone(action), observedAt: result.observedAt, evidenceReference: result.evidenceReference, basis: "observed" };
  change(options.root, options.identity, record => {
    owner.assertOwned(); if (verifyAlertCompletion(options.root, record).digest !== expected) throw new Error("Reconcile this alert's changed cleanup checkpoint.");
    const states: Record<CleanupChoice["mode"], EmailRecord["cleanupState"]> = { delete: "deleted", archive: "archived", label: "labeled", retain: "retained" };
    record.cleanupState = states[action.mode]; record.cleanupReceipt = receipt;
  });
  return { state: "complete" as const, receipt };
}
/** Own the message across verification, provider action and persistence. */
export async function cleanupCompletedAlert(options: CleanupOptions & { transport: EmailTransport }) {
  const { root, identity, transport } = options;
  if (sourceKey(transport.source) !== sourceKey(identity.source)) throw new Error("Cleanup must stay on the selected message/account.");
  let owner: Ownership;
  try { owner = acquireOwnership(root, lockKey(identity)); }
  catch (error) { if (error instanceof OwnershipBusy) return { state: "busy" as const, reason: error.message }; throw error; }
  try {
    const prepared = await prepare(options, owner);
    if ("terminal" in prepared) return { state: "complete" as const, receipt: prepared.terminal };
    const { action, digest, record } = prepared;
    let result: { evidenceReference: string; observedAt: string } | undefined;
    if (action.mode === "retain") result = { evidenceReference: "Persisted completed-alert marker; source message retained.", observedAt: options.now };
    else if (prepared.priorPending) {
      const observed = await transport.observeCleanup?.(identity, action);
      proof(options, owner, digest);
      if (!observed || !["applied", "notApplied"].includes(observed.state) || !observed.evidenceReference?.trim() || !Number.isFinite(Date.parse(observed.observedAt))) return { state: "pending" as const, reason: "Inspect the same message's cleanup outcome before retrying." };
      if (observed.state === "applied") result = observed;
    }
    if (!result) {
      const authorization = issueCleanupAuthorization(record.cleanupAttempt!.reference, identity.source, identity.messageId, action, () => { proof(options, owner, digest); });
      proof(options, owner, digest);
      result = await transport.applyCleanup(identity, action, authorization);
    }
    return finish(options, owner, digest, result);
  } finally { owner.release(); }
}

/** Native tools execute outside Node; their claim survives these CLI processes. */
export async function prepareNativeCleanup(options: CleanupOptions & { ownerId: string }) {
  const owner = acquireOwnership(options.root, lockKey(options.identity), { kind: "native", ownerId: options.ownerId });
  try {
    const prepared = await prepare(options, owner, { ownerId: owner.ownerId, token: owner.token });
    if ("terminal" in prepared) { owner.release(); return { state: "complete" as const, receipt: prepared.terminal }; }
    if (prepared.action.mode === "retain") {
      const result = finish(options, owner, prepared.digest, { evidenceReference: "Persisted completed-alert marker; source message retained.", observedAt: options.now });
      owner.release(); return result;
    }
    return { state: "prepared" as const, ownerId: owner.ownerId, token: owner.token, operationId: prepared.record.cleanupAttempt!.reference,
      identity: options.identity, action: prepared.action, next: prepared.priorPending ? "inspect" : "authorize" };
  } catch (error) { owner.release(); throw error; }
}
export interface NativeObservation {
  schemaVersion: 1; operationId: string; round: number; messageKey: string; action: CleanupChoice;
  state: "applied" | "notApplied" | "unknown"; observedAt: string; toolReference: string; toolEvidence: FileEvidence;
}
/** Resume the same known-inactive native owner, including an interruption before preparation was saved. */
export async function resumeNativeCleanup(options: CleanupOptions & { ownerId: string; token: string }) {
  const owner = resumeNativeOwnership(options.root, lockKey(options.identity), options.token, options.ownerId);
  const old = current(options.root, options.identity).record;
  if (terminalCleanup(old)) { owner.release(); return { state: "complete" as const, receipt: old.cleanupReceipt! }; }
  if (!old.cleanupAttempt?.native) {
    const prepared = await prepare(options, owner, { ownerId: options.ownerId, token: options.token });
    if ("terminal" in prepared) { owner.release(); return { state: "complete" as const, receipt: prepared.terminal }; }
  }
  const work = native(options);
  return { state: "pending" as const, operationId: work.record.cleanupAttempt!.reference, round: work.record.cleanupAttempt!.native!.round,
    next: work.record.cleanupAttempt!.native!.phase === "prepared" ? "authorize" : "inspect", identity: options.identity, action: options.connection.cleanup };
}
function native(options: CleanupOptions & { ownerId: string; token: string }) {
  const owner = resumeNativeOwnership(options.root, lockKey(options.identity), options.token, options.ownerId);
  selected(options); const record = current(options.root, options.identity).record;
  if (record.cleanupState !== "cleanupPending" || record.cleanupAttempt?.native?.token !== options.token) throw new Error("Resume the saved native cleanup checkpoint.");
  if (record.cleanupAttempt.workDigest !== workDigest(record)) throw new Error("Native cleanup's saved work changed; reconcile it before continuing.");
  return { owner, record, digest: verifyAlertCompletion(options.root, record).digest };
}
function observation(options: CleanupOptions, attempt: NonNullable<EmailRecord["cleanupAttempt"]>, ref: FileEvidence): NativeObservation {
  const value = JSON.parse(readEvidence(options.root, ref).toString("utf8")) as NativeObservation;
  if (value.schemaVersion !== 1 || value.operationId !== attempt.reference || value.round !== attempt.native!.round || value.messageKey !== messageKey(options.identity) ||
    JSON.stringify(value.action) !== JSON.stringify(options.connection.cleanup) || !["applied", "notApplied", "unknown"].includes(value.state) ||
    !value.toolReference?.trim() || !Number.isFinite(Date.parse(value.observedAt)) || Date.parse(value.observedAt) < Date.parse(attempt.startedAt)) throw new Error("Use the actual exact-message native tool observation for this attempt.");
  readEvidence(options.root, value.toolEvidence);
  if (value.toolEvidence.path === ref.path) throw new Error("Retain the underlying native tool result separately from its normalized observation.");
  return value;
}
/** Call immediately before the native tool; durable authorization is single-use. */
export function authorizeNativeCleanup(options: CleanupOptions & { ownerId: string; token: string }) {
  const work = native(options), attempt = work.record.cleanupAttempt!;
  if (attempt.native!.phase !== "prepared") throw new Error("Inspect this attempt's exact cleanup outcome before another native mutation.");
  proof(options, work.owner, work.digest);
  change(options.root, options.identity, record => {
    if (JSON.stringify(record) !== JSON.stringify(work.record)) throw new Error("Reload changed native cleanup work.");
    record.cleanupAttempt!.native!.phase = "invoked";
    record.cleanupAttempt!.native!.round++;
  });
  return { operationId: attempt.reference, round: attempt.native!.round + 1, identity: options.identity, action: options.connection.cleanup, instruction: "Invoke this exact message-level action once, then persist the actual result. Do not repeat after uncertainty." };
}
export function recordNativeCleanup(options: CleanupOptions & { ownerId: string; token: string; evidence: FileEvidence }) {
  const work = native(options), attempt = work.record.cleanupAttempt!, found = observation(options, attempt, options.evidence);
  if (found.state === "applied") {
    const result = finish(options, work.owner, work.digest, { evidenceReference: options.evidence.path, observedAt: found.observedAt });
    work.owner.release(); return result;
  }
  change(options.root, options.identity, record => {
    work.owner.assertOwned(); if (JSON.stringify(record) !== JSON.stringify(work.record)) throw new Error("Reload changed native cleanup work.");
    record.cleanupAttempt!.native!.phase = found.state === "notApplied" ? "prepared" : "inspect";
    record.cleanupAttempt!.native!.lastObservation = options.evidence;
  });
  return { state: "pending" as const, next: found.state === "notApplied" ? "authorize" : "inspect" };
}
