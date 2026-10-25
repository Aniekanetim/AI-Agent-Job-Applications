import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { readPrivateJson, protectedJsonWriter } from "../workflow/private-json.js";
import { acquireOwnership, assertOperationOwnership, type Ownership } from "../workflow/ownership.js";
import { loadEmailConnection, emailCapabilityIssues, validateEmailReport, validateInventory, sourceKey, type EmailSource, type CleanupChoice } from "./connection.js";
import { validateInboxState, terminalCleanup, type InboxState, type EmailRecord, type EmailIdentity, messageKey } from "./intake.js";
import { loadEmailOnboarding } from "./onboarding.js";
import { providerId } from "./discovery.js";

export function loadInboxState(root: string) {
  const found = readPrivateJson(root, ".local/inbox-state.json");
  if (found.data === null) return { state: { schemaVersion: 2, messages: [] } as InboxState, revision: null };
  validateInboxState(found.data); return { state: found.data, revision: found.revision };
}
export const alertOwnershipKey = (identity: EmailIdentity) => `alert:${messageKey(identity)}`;
export const alertWorkDigest = (r: EmailRecord) => createHash("sha256").update(JSON.stringify([r.identity, r.classification, r.enumerationComplete, r.inventory, r.vacancies])).digest("hex");
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const controls = (r: EmailRecord) => [r.cleanupState, r.cleanupAction, r.cleanupAttempt, r.cleanupReceipt, r.cleanupHistory];
export type CleanupTransition = "prepare" | "recover" | "inspect" | "invoke" | "complete" | "cancel";
type WriteContext = { claims: Map<string, Ownership> } & (
  { kind: "work" } | { kind: "cleanup"; key: string; transition: CleanupTransition } |
  { kind: "migration"; source: EmailSource; policy: string; now: string });
function claimChanges<T>(root: string, keys: string[], run: (claims: Map<string, Ownership>) => T): T {
  const claims = new Map<string, Ownership>();
  try {
    for (const key of [...new Set(keys)].sort()) claims.set(key, acquireOwnership(root, `alert:${key}`));
    return run(claims);
  } finally { for (const claim of [...claims.values()].reverse()) claim.release(); }
}
const writeInbox = protectedJsonWriter<WriteContext>(".local/inbox-state.json", (root, raw, value, context) => {
  validateInboxState(value);
  // Resource ownership, not vacancy/history duplicate screening: two assignments cannot own one ticket file.
  const paths = new Map<string, string>();
  for (const record of value.messages) for (const vacancy of record.vacancies) for (const path of [vacancy.taskPath, vacancy.taskEvidence?.path]) {
    if (!path) continue;
    const normalized = process.platform === "win32" ? resolve(root, path).toLowerCase() : resolve(root, path), owner = `${messageKey(record.identity)}:${vacancy.vacancyKey}`;
    if (paths.has(normalized) && paths.get(normalized) !== owner) throw new Error("Different assignments cannot own the same ticket file."); paths.set(normalized, owner);
  }
  if (context.kind === "migration") {
    if (!same(value, migrateInboxState(raw, context.source, context.policy, context.now))) throw new Error("Migration must preserve the actual saved history.");
    for (const record of value.messages) assertOperationOwnership(root, alertOwnershipKey(record.identity), context.claims.get(messageKey(record.identity))!);
    return;
  }
  const before = raw ?? { schemaVersion: 2, messages: [] }; validateInboxState(before);
  for (const old of before.messages) {
    const next = value.messages.find(r => messageKey(r.identity) === messageKey(old.identity));
    if (!next) throw new Error("Preserve existing message progress and completed markers."); preserveRecord(old, next);
  }
  for (const next of value.messages) {
    const key = messageKey(next.identity), old = before.messages.find(r => messageKey(r.identity) === key);
    if (same(old, next)) continue;
    assertOperationOwnership(root, alertOwnershipKey(next.identity), context.claims.get(key)!);
    if (context.kind === "cleanup") {
      if (!old || key !== context.key) throw new Error("A cleanup transition may change only its owned alert.");
      if (["prepare", "recover"].includes(context.transition)) {
        const selected = loadEmailConnection(root).connection;
        const hash = createHash("sha256").update(JSON.stringify(selected)).digest("hex");
        if (!selected || hash !== next.cleanupAttempt?.connectionDigest || !same(selected.cleanup, next.cleanupAction) || sourceKey(selected.source) !== sourceKey(next.identity.source)) throw new Error("The selected connection changed before the pending checkpoint was committed; reload it first.");
      }
      validateCleanupTransition(old, next, context.transition);
    } else {
      if (old ? !same(controls(old), controls(next)) : next.cleanupState !== "notReady" || next.cleanupAction !== null || next.cleanupAttempt || next.cleanupReceipt || next.cleanupHistory) throw new Error("Only dedicated cleanup operations may change cleanup controls or history.");
      if (old?.cleanupState === "cleanupPending") throw new Error("Cleanup is pending; inspect its outcome and use dedicated cancellation before correcting work.");
    }
  }
});
export function saveInboxState(root: string, state: InboxState, revision: string | null) {
  validateInboxState(state); const loaded = loadInboxState(root);
  if (loaded.revision !== revision) throw new Error("Private configuration changed in another session; reload it before saving.");
  const keys = state.messages.filter(r => !same(r, loaded.state.messages.find(old => messageKey(old.identity) === messageKey(r.identity)))).map(r => messageKey(r.identity));
  return claimChanges(root, keys, claims => writeInbox(root, state, revision, { kind: "work", claims }));
}
/** Internal cleanup boundary. The claim is genuine, correctly scoped and rechecked inside the commit lock. */
export function changeCleanupRecord(root: string, identity: EmailIdentity, owner: Ownership, transition: CleanupTransition, apply: (record: EmailRecord) => void) {
  assertOperationOwnership(root, alertOwnershipKey(identity), owner);
  for (let n = 0; n < 8; n++) {
    const loaded = loadInboxState(root), key = messageKey(identity), record = loaded.state.messages.find(r => messageKey(r.identity) === key);
    if (!record) throw new Error("Save the alert before changing cleanup."); apply(record);
    try { writeInbox(root, loaded.state, loaded.revision, { kind: "cleanup", key, transition, claims: new Map([[key, owner]]) }); return record; }
    catch (error) { if (!/changed in another session/.test(String(error))) throw error; }
  }
  throw new Error("Inbox progress is busy; preserve and reconcile the pending attempt.");
}
function validateCleanupTransition(old: EmailRecord, next: EmailRecord, transition: CleanupTransition) {
  if (terminalCleanup(old) || alertWorkDigest(old) !== alertWorkDigest(next)) throw new Error("Cleanup must preserve its verified work snapshot and completed outcomes.");
  const a = old.cleanupAttempt, b = next.cleanupAttempt;
  if (transition === "cancel") {
    const last = a?.observations?.at(-1), safe = a?.round === 0 && !a.invocations?.length || last?.state === "notApplied" && last.round === a?.round;
    const history = next.cleanupHistory as { attempt: unknown; cancelledAt: string }[] | undefined, prior = old.cleanupHistory as unknown[] | undefined;
    if (old.cleanupState !== "cleanupPending" || a?.phase !== "prepared" || !safe || next.cleanupState !== "notReady" || next.cleanupAction !== null || b || next.cleanupReceipt ||
      !history || history.length !== (prior?.length ?? 0) + 1 || !same(history.slice(0, -1), prior ?? []) || !same(history.at(-1)?.attempt, a) || !Number.isFinite(Date.parse(history.at(-1)!.cancelledAt))) throw new Error("Only an uninvoked or observed-not-applied attempt can be explicitly cancelled with history.");
    return;
  }
  if (b?.protocolVersion !== 2 || b.workDigest !== alertWorkDigest(next)) throw new Error("Seal the exact work snapshot before changing cleanup.");
  if (!same(old.cleanupHistory, next.cleanupHistory)) throw new Error("Preserve cleanup history.");
  if (transition === "prepare") {
    if (old.cleanupState !== "notReady" || a || next.cleanupState !== "cleanupPending" || b.phase !== "prepared" || b.round !== 0 || b.invocations?.length || b.observations?.length) throw new Error("Prepare a new owned attempt once; never overwrite a pending attempt.");
    return;
  }
  if (old.cleanupState !== "cleanupPending" || !same(old.cleanupAction, next.cleanupAction)) throw new Error("Resolve this pending action before changing it.");
  if (a && (a.reference !== b.reference || a.startedAt !== b.startedAt || a.workDigest && a.workDigest !== b.workDigest || a.connectionDigest && a.connectionDigest !== b.connectionDigest)) throw new Error("Preserve the pending attempt identity and sealed snapshot.");
  if (a?.native && (a.native.ownerId !== b.native?.ownerId || a.native.token !== b.native?.token) || !a?.native && b.native && transition !== "recover") throw new Error("Preserve the native owner and token.");
  if (transition === "recover") {
    if (a?.protocolVersion === 2 || b.phase !== "inspect" || b.round !== (a?.round ?? a?.native?.round ?? 0) || next.cleanupState !== "cleanupPending" ||
      !same(a?.invocations ?? [], b.invocations) || !same(a?.observations ?? [], b.observations)) throw new Error("Legacy recovery must inspect the same pending operation first.");
    return;
  }
  if (a?.protocolVersion !== 2) throw new Error("Recover the legacy checkpoint before changing its lifecycle.");
  const oldEvents = a.observations ?? [], events = b.observations ?? [], last = events.at(-1);
  if (!same(events.slice(0, oldEvents.length), oldEvents) || events.length > oldEvents.length + 1) throw new Error("Preserve actual cleanup observations.");
  if (events.length > oldEvents.length && (!last || last.round !== a.round || !last.evidenceReference?.trim() || !Number.isFinite(Date.parse(last.observedAt)))) throw new Error("Save the actual current-round observation.");
  if (transition === "inspect") {
    if (next.cleanupState !== "cleanupPending" || b.round !== a.round || events.length !== oldEvents.length + 1 ||
      b.phase !== (last?.state === "notApplied" ? "prepared" : "inspect") || !same(a.invocations, b.invocations)) throw new Error("Inspection must preserve this attempt and record its actual result.");
  } else if (transition === "invoke") {
    const invocations = b.invocations ?? [], previous = a.invocations ?? [];
    if (a.phase !== "prepared" || (a.round! > 0 && !(oldEvents.at(-1)?.state === "notApplied" && oldEvents.at(-1)?.round === a.round)) ||
      b.phase !== "invoked" || next.cleanupState !== "cleanupPending" || b.round !== a.round! + 1 || !same(events, oldEvents) ||
      invocations.length !== previous.length + 1 || !same(invocations.slice(0, -1), previous) || invocations.at(-1)?.round !== b.round || !Number.isFinite(Date.parse(invocations.at(-1)!.authorizedAt))) throw new Error("Authorize one invocation, inspecting the previous round before retry.");
  } else if (transition === "complete") {
    const states = { delete: "deleted", archive: "archived", label: "labeled", retain: "retained" };
    if (next.cleanupState !== states[old.cleanupAction!.mode] || b.phase !== "complete" || b.round !== a.round || !same(a.invocations, b.invocations) ||
      last?.state !== "applied" || last.round !== b.round || next.cleanupReceipt?.evidenceReference !== last.evidenceReference || next.cleanupReceipt?.observedAt !== last.observedAt) throw new Error("Complete only from an actual matching cleanup result.");
  } else throw new Error("Unknown cleanup transition.");
}
export function migrateStoredInbox(root: string, source: EmailSource, policy: string, now: string) {
  const loaded = readPrivateJson(root, ".local/inbox-state.json");
  if (loaded.data === null) return false;
  if ((loaded.data as InboxState).schemaVersion === 2) { validateInboxState(loaded.data); return false; }
  const migrated = migrateInboxState(loaded.data, source, policy, now);
  return claimChanges(root, migrated.messages.map(r => messageKey(r.identity)), claims => writeInbox(root, migrated, loaded.revision, { kind: "migration", claims, source, policy, now }));
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
