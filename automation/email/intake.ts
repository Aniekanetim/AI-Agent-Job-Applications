import { createHash } from "node:crypto";
import { messageReadyForDeletion, type MessageProgress } from "../workflow/application-state.js";
import { sourceKey, validateSource, validateCleanup, type EmailSource, type CleanupChoice } from "./connection.js";

export interface EmailIdentity { source: EmailSource; messageId: string }
export interface MailHeader extends EmailIdentity {
  from: string; subject?: string; timestamp: string; threadId?: string; labels?: string[]; contentRevision?: string;
}
export interface MailMessage extends MailHeader { text?: string; html?: string }
export type MessageKind = "jobAlert" | "otp" | "receipt" | "recruiter" | "unrelated" | "unknown";
export interface Classification {
  kind: MessageKind; fingerprint: string; rulesRevision: string;
  ruleReference: string; evidenceReference: string; classifiedAt: string;
}
export interface CleanupReceipt {
  messageKey: string; action: CleanupChoice; observedAt: string | null; evidenceReference: string;
  basis: "observed" | "legacyCheckpoint";
}
export interface EmailRecord extends Omit<MessageProgress, "cleanupState"> {
  identity: EmailIdentity;
  classification: Classification;
  cleanupState: "notReady" | "cleanupPending" | "deleted" | "retained" | "archived" | "labeled";
  cleanupAction: CleanupChoice | null;
  cleanupReceipt?: CleanupReceipt;
  cleanupAttempt?: { startedAt: string; reference: string; workDigest?: string;
    native?: { ownerId: string; token: string; phase: "prepared" | "invoked" | "inspect"; round: number; lastObservation?: import("./evidence.js").FileEvidence } };
  [key: string]: unknown;
}
export interface InboxState { schemaVersion: 2; messages: EmailRecord[]; [key: string]: unknown }
export const terminalCleanup = (record: EmailRecord) => ["deleted", "retained", "archived", "labeled"].includes(record.cleanupState);
export function messageKey(identity: EmailIdentity): string {
  if (!identity?.messageId?.trim()) throw new Error("Use the provider's actual message ID.");
  return createHash("sha256").update(JSON.stringify([sourceKey(identity.source), identity.messageId])).digest("hex");
}
export function headerFingerprint(header: MailHeader): string {
  return createHash("sha256").update(JSON.stringify([messageKey(header), header.from, header.subject ?? "", header.contentRevision ?? ""])).digest("hex");
}
export function classifyMessage(header: MailHeader, kind: MessageKind, rulesRevision: string,
  ruleReference: string, evidenceReference: string, now: string): EmailRecord {
  validateSource(header.source); messageKey(header);
  const record: EmailRecord = { identity: { source: structuredClone(header.source), messageId: header.messageId },
    inboxId: header.source.mailboxId, messageId: header.messageId, enumerationComplete: false, vacancies: [],
    classification: { kind, fingerprint: headerFingerprint(header), rulesRevision, ruleReference, evidenceReference, classifiedAt: now },
    cleanupState: "notReady", cleanupAction: null };
  validateRecord(record); return record;
}
export function validateRecord(record: EmailRecord): void {
  messageKey(record.identity);
  const c = record.classification;
  if (record.inboxId !== record.identity.source.mailboxId || record.messageId !== record.identity.messageId || !c ||
    !["jobAlert", "otp", "receipt", "recruiter", "unrelated", "unknown"].includes(c.kind) ||
    !/^[a-f0-9]{64}$/.test(c.fingerprint) || ![c.rulesRevision, c.ruleReference, c.evidenceReference].every(v => typeof v === "string" && !!v.trim()) ||
    !Number.isFinite(Date.parse(c.classifiedAt)) || !Array.isArray(record.vacancies) || typeof record.enumerationComplete !== "boolean" ||
    !["notReady", "cleanupPending", "deleted", "retained", "archived", "labeled"].includes(record.cleanupState)) throw new Error("Preserve and investigate the incomplete email progress record.");
  if (record.cleanupAction) validateCleanup(record.cleanupAction);
  if (record.cleanupAttempt && (!record.cleanupAttempt.reference?.trim() || !Number.isFinite(Date.parse(record.cleanupAttempt.startedAt)))) throw new Error("Preserve and reconcile incomplete cleanup-attempt metadata.");
  const owner = record.cleanupAttempt?.native;
  if (owner && (!owner.ownerId?.trim() || !owner.token?.trim() || !["prepared", "invoked", "inspect"].includes(owner.phase) ||
    !Number.isInteger(owner.round) || owner.round < 0 || !/^[a-f0-9]{64}$/.test(record.cleanupAttempt!.workDigest ?? ""))) throw new Error("Preserve the native owner and reconcile its incomplete checkpoint.");
  const keys = new Set<string>();
  for (const vacancy of record.vacancies) {
    if (!vacancy.vacancyKey?.trim() || keys.has(vacancy.vacancyKey) || !["pending", "blocked", "applied", "notApplicable"].includes(vacancy.disposition)) throw new Error("Preserve distinct, identified vacancy checkpoints.");
    keys.add(vacancy.vacancyKey);
  }
  if (c.kind !== "jobAlert" && record.vacancies.length) throw new Error("Unrelated correspondence is not an application assignment.");
  if (record.cleanupState !== "notReady" && !record.cleanupAction) throw new Error("A cleanup checkpoint needs its selected action.");
  if (c.kind !== "jobAlert" && record.cleanupState !== "notReady") throw new Error("Only a classified job alert is eligible for alert cleanup.");
  if (terminalCleanup(record) && (!record.cleanupReceipt || record.cleanupReceipt.messageKey !== messageKey(record.identity) ||
    !record.cleanupReceipt.evidenceReference?.trim() ||
    !(record.cleanupReceipt.basis === "observed" ? !!record.cleanupReceipt.observedAt && Number.isFinite(Date.parse(record.cleanupReceipt.observedAt)) :
      record.cleanupReceipt.basis === "legacyCheckpoint" && record.cleanupState === "deleted" && record.cleanupReceipt.observedAt === null) ||
    JSON.stringify(record.cleanupReceipt.action) !== JSON.stringify(record.cleanupAction))) throw new Error("Completed cleanup needs the actual message-specific result.");
}
export function validateInboxState(value: unknown): asserts value is InboxState {
  const state = value as InboxState;
  if (!state || state.schemaVersion !== 2 || !Array.isArray(state.messages)) throw new Error("Unknown inbox progress format; preserve it for investigation.");
  const seen = new Set<string>();
  for (const record of state.messages) {
    validateRecord(record); const key = messageKey(record.identity);
    if (seen.has(key)) throw new Error("Repeated message identity in inbox progress."); seen.add(key);
  }
}
export function alertWorkComplete(record: EmailRecord): boolean {
  validateRecord(record);
  return record.classification.kind === "jobAlert" && messageReadyForDeletion({ ...record, cleanupState: "notReady" });
}
export function intakeDecision(record: EmailRecord | undefined, header: MailHeader, rulesRevision: string) {
  if (!record) return "classify" as const;
  validateRecord(record);
  if (messageKey(record.identity) !== messageKey(header)) throw new Error("This progress belongs to a different message/account.");
  const changed = record.classification.fingerprint !== headerFingerprint(header) || record.classification.rulesRevision !== rulesRevision;
  if (terminalCleanup(record)) return changed ? "reviewChangedCompleted" as const : "skip" as const;
  if (record.classification.kind !== "jobAlert") return changed ? "classify" as const : "skip" as const;
  // Resume existing assignments even if intake filters changed; never create them twice.
  return alertWorkComplete(record) ? "cleanupOnly" as const : "resume" as const;
}
