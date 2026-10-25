import { sourceKey, type CleanupChoice, type EmailSource } from "./connection.js";

export interface CleanupAuthorization { readonly operationId: string }
const issued = new WeakMap<CleanupAuthorization, { sourceKey: string; messageId: string; action: string; verify: () => void; used: boolean }>();
/** Internal capability, created only after persisted inventory/task/evidence checks and operation ownership. */
export function issueCleanupAuthorization(operationId: string, source: EmailSource, messageId: string, action: CleanupChoice, verify: () => void): CleanupAuthorization {
  const permit = Object.freeze({ operationId });
  issued.set(permit, { sourceKey: sourceKey(source), messageId, action: JSON.stringify(action), verify, used: false }); return permit;
}
export function assertCleanupAuthorization(permit: CleanupAuthorization | undefined, source: EmailSource, messageId: string, action: CleanupChoice, consume = false) {
  const metadata = permit && issued.get(permit);
  if (!metadata || metadata.used || metadata.sourceKey !== sourceKey(source) || metadata.messageId !== messageId || metadata.action !== JSON.stringify(action)) throw new Error("Cleanup requires a current single-use authorization for this exact message and selected action.");
  metadata.verify(); if (consume) metadata.used = true;
}
/** The AgentMail low-level client additionally checks its private inbox identity. */
export function consumeInboxAuthorization(permit: CleanupAuthorization | undefined, inboxId: string, messageId: string) {
  const metadata = permit && issued.get(permit);
  if (!metadata || metadata.used || metadata.messageId !== messageId) throw new Error("Use the coordinated email cleanup procedure; a callback Boolean is not cleanup authorization.");
  // The source and effect were bound before the transport received this permit.
  metadata.verify();
  const bound = inboxBindings.get(permit!);
  if (bound !== inboxId) throw new Error("Cleanup authorization belongs to another inbox.");
  metadata.used = true;
}
const inboxBindings = new WeakMap<CleanupAuthorization, string>();
export function bindInboxAuthorization(permit: CleanupAuthorization, inboxId: string) { if (!issued.has(permit)) throw new Error("Unknown cleanup authorization."); inboxBindings.set(permit, inboxId); }
