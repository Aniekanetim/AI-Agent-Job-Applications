import { randomUUID } from "node:crypto";
import { emailCapabilityIssues, loadEmailConnection, sourceKey, type EmailConnection, type EmailCapabilityReport } from "./connection.js";
import { readPrivateJson } from "../workflow/private-json.js";
import { acquireOwnership, OwnershipBusy, resumeNativeOwnership, type Ownership } from "../workflow/ownership.js";
import { messageKey, terminalCleanup, type EmailIdentity, type EmailRecord, type CleanupReceipt } from "./intake.js";
import { loadInboxState, changeCleanupRecord, alertOwnershipKey, alertWorkDigest, inspectEmailReadiness } from "./state-store.js";
import { verifyAlertCompletion } from "./verification.js";
import { digest, readEvidence, type FileEvidence } from "./evidence.js";
import { issueCleanupAuthorization } from "./authorization.js";
import type { EmailTransport, CleanupObservation } from "./host-connectors/adapter.js";

export interface CleanupOptions {
  root: string; connection: EmailConnection; report: EmailCapabilityReport; context: "interactive" | "scheduled";
  identity: EmailIdentity; now: string;
  /** Additional veto only; true never substitutes for built-in verification. */
  verifyPersistence?: (record: EmailRecord) => Promise<boolean>;
}
function current(root: string, identity: EmailIdentity) {
  const record = loadInboxState(root).state.messages.find(r => messageKey(r.identity) === messageKey(identity));
  if (!record) throw new Error("Save this alert's task and completion records before cleanup."); return record;
}
function selected(options: CleanupOptions) {
  const { root, connection, context } = options;
  const saved = loadEmailConnection(root).connection;
  const report = readPrivateJson(root, context === "interactive" ? ".local/email-capabilities.json" : ".local/email-capabilities-scheduled.json").data;
  if (JSON.stringify(saved) !== JSON.stringify(connection) || JSON.stringify(report) !== JSON.stringify(options.report)) throw new Error("Reload the selected connection and actual capability report before cleanup.");
  if (sourceKey(connection.source) !== sourceKey(options.identity.source)) throw new Error("Cleanup must stay on the selected message/account.");
  const issues = [...emailCapabilityIssues(connection, options.report, root, context), ...inspectEmailReadiness(root, context).issues];
  if (issues.length || !connection.cleanup) throw new Error(issues.join(" ") || "Choose alert cleanup first."); return connection.cleanup;
}
function change(options: CleanupOptions, owner: Ownership, transition: Parameters<typeof changeCleanupRecord>[3], apply: (r: EmailRecord) => void) {
  return changeCleanupRecord(options.root, options.identity, owner, transition, apply);
}
function mirror(record: EmailRecord) {
  const a = record.cleanupAttempt!;
  if (a.native && a.phase !== "complete") { a.native.phase = a.phase!; a.native.round = a.round!; }
}
function proof(options: CleanupOptions, owner: Ownership, expected: string) {
  owner.assertOwned(); selected(options); const record = current(options.root, options.identity);
  if (record.cleanupAttempt?.workDigest !== alertWorkDigest(record) || verifyAlertCompletion(options.root, record).digest !== expected) throw new Error("This alert's sealed work changed; preserve and reconcile the pending attempt.");
  return record;
}
async function prepare(options: CleanupOptions, owner: Ownership, native?: { ownerId: string; token: string }) {
  owner.assertOwned(); const action = selected(options), old = current(options.root, options.identity);
  if (terminalCleanup(old)) return { terminal: old.cleanupReceipt! };
  const priorPending = old.cleanupState === "cleanupPending";
  if (priorPending && JSON.stringify(old.cleanupAction) !== JSON.stringify(action)) throw new Error("Resolve pending cleanup before changing its action.");
  if (old.cleanupAttempt?.native && (!native || native.token !== old.cleanupAttempt.native.token || native.ownerId !== old.cleanupAttempt.native.ownerId)) throw new Error("Resume the existing native cleanup owner; do not replace it with another transport or worker.");
  if (!priorPending) {
    verifyAlertCompletion(options.root, old);
    if (options.verifyPersistence && !await options.verifyPersistence(structuredClone(old))) throw new Error("Additional saved-work verification rejected cleanup.");
  }
  let record = old;
  if (!priorPending || old.cleanupAttempt?.protocolVersion !== 2) {
    const before = JSON.stringify(old);
    record = change(options, owner, priorPending ? "recover" : "prepare", record => {
      if (JSON.stringify(record) !== before) throw new Error("Reload this alert's changed checkpoint.");
      record.cleanupState = "cleanupPending"; record.cleanupAction = structuredClone(action);
      record.cleanupAttempt ??= { startedAt: options.now, reference: `email-cleanup-${randomUUID()}`, ...(priorPending ? { legacyRecovery: true } : {}) };
      const a = record.cleanupAttempt;
      a.workDigest = alertWorkDigest(record); a.protocolVersion = 2;
      a.connectionDigest = digest(JSON.stringify(options.connection));
      a.phase = priorPending ? "inspect" : "prepared"; a.round = a.round ?? a.native?.round ?? 0;
      a.invocations ??= []; a.observations ??= [];
      if (native) a.native = { ...a.native, ...native, phase: a.phase, round: a.round }; mirror(record);
    });
  }
  return { action, priorPending, record, digest: digest(JSON.stringify(record)) };
}
function observe(options: CleanupOptions, owner: Ownership, expected: string, result: CleanupObservation, nativeEvidence?: FileEvidence) {
  if (!["applied", "notApplied", "unknown"].includes(result.state) || !result.evidenceReference?.trim() || !Number.isFinite(Date.parse(result.observedAt))) throw new Error("Preserve the pending attempt until an actual exact-message observation is available.");
  return change(options, owner, "inspect", record => {
    if (digest(JSON.stringify(record)) !== expected) throw new Error("Reload the changed cleanup attempt before recording its observation.");
    const a = record.cleanupAttempt!;
    a.observations!.push({ ...result, round: a.round! }); a.phase = result.state === "notApplied" ? "prepared" : "inspect";
    if (nativeEvidence && a.native) a.native.lastObservation = nativeEvidence; mirror(record);
  });
}
function invoke(options: CleanupOptions, owner: Ownership, expected: string) {
  proof(options, owner, expected);
  const record = change(options, owner, "invoke", record => {
    if (digest(JSON.stringify(record)) !== expected) throw new Error("Reload the changed cleanup attempt before invocation.");
    const a = record.cleanupAttempt!; a.phase = "invoked"; a.round!++;
    a.invocations!.push({ round: a.round!, authorizedAt: options.now }); mirror(record);
  });
  return { record, digest: verifyAlertCompletion(options.root, record).digest };
}
function finish(options: CleanupOptions, owner: Ownership, expected: string, result: { evidenceReference: string; observedAt: string }, savedObservation = false) {
  let record = current(options.root, options.identity);
  if (!savedObservation) record = observe(options, owner, expected, { ...result, state: "applied" });
  const observedDigest = digest(JSON.stringify(record)); proof(options, owner, observedDigest);
  const action = options.connection.cleanup!;
  const receipt: CleanupReceipt = { messageKey: messageKey(options.identity), action: structuredClone(action), observedAt: result.observedAt, evidenceReference: result.evidenceReference, basis: "observed" };
  change(options, owner, "complete", record => {
    if (digest(JSON.stringify(record)) !== observedDigest) throw new Error("Reload the changed attempt before completion.");
    const states = { delete: "deleted", archive: "archived", label: "labeled", retain: "retained" } as const;
    record.cleanupState = states[action.mode]; record.cleanupReceipt = receipt; record.cleanupAttempt!.phase = "complete";
  });
  return { state: "complete" as const, receipt };
}
/** Own this alert's work and controls across verification, external action and persistence. */
export async function cleanupCompletedAlert(options: CleanupOptions & { transport: EmailTransport }) {
  const { root, identity, transport } = options;
  if (sourceKey(transport.source) !== sourceKey(identity.source)) throw new Error("Cleanup must stay on the selected message/account.");
  let owner: Ownership;
  try { owner = acquireOwnership(root, alertOwnershipKey(identity)); }
  catch (error) { if (error instanceof OwnershipBusy) return { state: "busy" as const, reason: error.message }; throw error; }
  try {
    const prepared = await prepare(options, owner);
    if ("terminal" in prepared) return { state: "complete" as const, receipt: prepared.terminal };
    let record = prepared.record, expected = prepared.digest;
    if (prepared.action.mode === "retain") return finish(options, owner, expected, { evidenceReference: "Persisted completed-alert marker; source message retained.", observedAt: options.now });
    if (prepared.priorPending) {
      const saved = record.cleanupAttempt!.observations!.at(-1);
      if (saved?.state === "applied" && saved.round === record.cleanupAttempt!.round) return finish(options, owner, expected, saved, true);
      const result = await transport.observeCleanup?.(identity, prepared.action);
      if (!result || !result.evidenceReference?.trim() || !Number.isFinite(Date.parse(result.observedAt))) return { state: "pending" as const, reason: "Inspect this exact message before retrying cleanup." };
      record = observe(options, owner, expected, result); expected = digest(JSON.stringify(record));
      if (result.state === "unknown") return { state: "pending" as const, reason: "The previous operation's outcome remains unknown." };
      if (result.state === "applied") return finish(options, owner, expected, result, true);
    }
    if (options.verifyPersistence && prepared.priorPending && !await options.verifyPersistence(structuredClone(record))) throw new Error("Additional saved-work verification rejected cleanup.");
    const invoked = invoke(options, owner, expected);
    const authorization = issueCleanupAuthorization(invoked.record.cleanupAttempt!.reference, identity.source, identity.messageId, prepared.action, () => { proof(options, owner, invoked.digest); });
    const result = await transport.applyCleanup(identity, prepared.action, authorization);
    return finish(options, owner, invoked.digest, result);
  } finally { owner.release(); }
}

/** Native claims survive CLI exits. All mutation commands use the protected store. */
export async function prepareNativeCleanup(options: CleanupOptions & { ownerId: string }) {
  const owner = acquireOwnership(options.root, alertOwnershipKey(options.identity), { kind: "native", ownerId: options.ownerId });
  try {
    const prepared = await prepare(options, owner, { ownerId: owner.ownerId, token: owner.token });
    if ("terminal" in prepared) { owner.release(); return { state: "complete" as const, receipt: prepared.terminal }; }
    if (prepared.action.mode === "retain") { const done = finish(options, owner, prepared.digest, { evidenceReference: "Persisted completed-alert marker; source message retained.", observedAt: options.now }); owner.release(); return done; }
    return { state: "prepared" as const, ownerId: owner.ownerId, token: owner.token, operationId: prepared.record.cleanupAttempt!.reference,
      identity: options.identity, action: prepared.action, next: prepared.priorPending ? "inspect" : "authorize" };
  } catch (error) {
    // A failed acknowledgement may follow a successful replacement. Keep a matching native claim recoverable.
    let release = false;
    try { const saved = current(options.root, options.identity); release = saved.cleanupState !== "cleanupPending" || saved.cleanupAttempt?.native?.token !== owner.token; } catch { /* Preserve uncertain ownership. */ }
    if (release) owner.release(); throw error;
  }
}
export interface NativeObservation {
  schemaVersion: 1; operationId: string; round: number; messageKey: string; action: NonNullable<EmailConnection["cleanup"]>;
  state: "applied" | "notApplied" | "unknown"; observedAt: string; toolReference: string; toolEvidence: FileEvidence;
}
function native(options: CleanupOptions & { ownerId: string; token: string }) {
  const owner = resumeNativeOwnership(options.root, alertOwnershipKey(options.identity), options.token, options.ownerId);
  selected(options); const record = current(options.root, options.identity);
  if (record.cleanupState !== "cleanupPending" || record.cleanupAttempt?.native?.token !== options.token || record.cleanupAttempt.native.ownerId !== options.ownerId) throw new Error("Resume the saved native cleanup checkpoint.");
  return { owner, record, digest: digest(JSON.stringify(record)) };
}
export async function resumeNativeCleanup(options: CleanupOptions & { ownerId: string; token: string }) {
  const owner = resumeNativeOwnership(options.root, alertOwnershipKey(options.identity), options.token, options.ownerId);
  const old = current(options.root, options.identity);
  if (terminalCleanup(old)) { owner.release(); return { state: "complete" as const, receipt: old.cleanupReceipt! }; }
  await prepare(options, owner, { ownerId: options.ownerId, token: options.token });
  const work = native(options), a = work.record.cleanupAttempt!;
  return { state: "pending" as const, operationId: a.reference, round: a.round,
    next: a.phase === "prepared" ? "authorize" : "inspect", identity: options.identity, action: options.connection.cleanup };
}
function observation(options: CleanupOptions, attempt: NonNullable<EmailRecord["cleanupAttempt"]>, ref: FileEvidence): NativeObservation {
  const value = JSON.parse(readEvidence(options.root, ref).toString("utf8")) as NativeObservation;
  if (value.schemaVersion !== 1 || value.operationId !== attempt.reference || value.round !== attempt.round || value.messageKey !== messageKey(options.identity) ||
    JSON.stringify(value.action) !== JSON.stringify(options.connection.cleanup) || !["applied", "notApplied", "unknown"].includes(value.state) ||
    !value.toolReference?.trim() || !Number.isFinite(Date.parse(value.observedAt)) || Date.parse(value.observedAt) < Date.parse(attempt.startedAt)) throw new Error("Use the actual exact-message native tool observation for this attempt.");
  readEvidence(options.root, value.toolEvidence);
  if (value.toolEvidence.path === ref.path) throw new Error("Retain the underlying tool result separately from its normalized observation."); return value;
}
export function authorizeNativeCleanup(options: CleanupOptions & { ownerId: string; token: string }) {
  const work = native(options);
  if (work.record.cleanupAttempt!.phase !== "prepared") throw new Error("Inspect this attempt's outcome before another native mutation.");
  const invoked = invoke(options, work.owner, work.digest), a = invoked.record.cleanupAttempt!;
  return { operationId: a.reference, round: a.round, identity: options.identity, action: options.connection.cleanup, instruction: "Invoke this exact message-level action once, then persist its actual result. Never repeat after uncertainty." };
}
export function recordNativeCleanup(options: CleanupOptions & { ownerId: string; token: string; evidence: FileEvidence }) {
  const work = native(options), found = observation(options, work.record.cleanupAttempt!, options.evidence);
  const record = observe(options, work.owner, work.digest, { state: found.state, observedAt: found.observedAt, evidenceReference: options.evidence.path }, options.evidence);
  if (found.state === "applied") { const done = finish(options, work.owner, digest(JSON.stringify(record)), { evidenceReference: options.evidence.path, observedAt: found.observedAt }, true); work.owner.release(); return done; }
  return { state: "pending" as const, next: found.state === "notApplied" ? "authorize" : "inspect" };
}
function cancel(options: CleanupOptions, owner: Ownership, expected: string) {
  const old = current(options.root, options.identity);
  change(options, owner, "cancel", record => {
    if (digest(JSON.stringify(record)) !== expected) throw new Error("Reload the changed attempt before cancellation.");
    const history = (record.cleanupHistory as unknown[] | undefined) ?? [];
    record.cleanupHistory = [...history, { attempt: structuredClone(record.cleanupAttempt), action: record.cleanupAction, cancelledAt: options.now }];
    record.cleanupState = "notReady"; record.cleanupAction = null; delete record.cleanupAttempt; delete record.cleanupReceipt;
  });
  return { state: "cancelled" as const, operationId: old.cleanupAttempt!.reference, next: "Reconcile the existing work; do not recreate confirmed applications." };
}
export function cancelNativeCleanup(options: CleanupOptions & { ownerId: string; token: string }) {
  const work = native(options), result = cancel(options, work.owner, work.digest); work.owner.release(); return result;
}
/** Explicit cancellation for work correction; never an ordinary pending-to-notReady save. */
export async function cancelPendingCleanup(options: CleanupOptions & { transport: EmailTransport }) {
  if (sourceKey(options.transport.source) !== sourceKey(options.identity.source)) throw new Error("Inspect the selected source only.");
  const owner = acquireOwnership(options.root, alertOwnershipKey(options.identity));
  try {
    if (current(options.root, options.identity).cleanupState !== "cleanupPending") throw new Error("Only an existing pending attempt can be cancelled.");
    const prepared = await prepare(options, owner);
    if ("terminal" in prepared) throw new Error("Completed cleanup cannot be cancelled.");
    let record = prepared.record;
    if (!(record.cleanupAttempt!.phase === "prepared" && record.cleanupAttempt!.round === 0)) {
      const found = await options.transport.observeCleanup?.(options.identity, prepared.action);
      if (!found) throw new Error("Inspect the previous operation before cancellation.");
      record = observe(options, owner, digest(JSON.stringify(record)), found);
      if (found.state !== "notApplied") throw new Error("Cancellation requires a confirmed not-applied outcome; preserve this attempt.");
    }
    return cancel(options, owner, digest(JSON.stringify(record)));
  } finally { owner.release(); }
}
