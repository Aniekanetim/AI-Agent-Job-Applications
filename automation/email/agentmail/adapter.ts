import { AgentMailInbox, AgentMailError } from "./client.js";
import type { EmailSource, CleanupChoice } from "../connection.js";
import { sourceKey } from "../connection.js";
import { messageKey, type EmailIdentity, type MailMessage, type EmailRecord } from "../intake.js";
import type { EmailTransport, CleanupResult } from "../host-connectors/adapter.js";
import { assertCleanupAuthorization, bindInboxAuthorization } from "../authorization.js";

/** Keep the existing AgentMail client and its guarded individual-message deletion. */
export function agentMailTransport(client: AgentMailInbox, source: EmailSource,
  loadVerifiedRecord: (identity: EmailIdentity) => Promise<EmailRecord>,
  verifyPersistence: (record: EmailRecord) => Promise<boolean>,
  recordResult: (identity: EmailIdentity, action: CleanupChoice) => Promise<CleanupResult> = async () => ({ evidenceReference: "AgentMail individual-message DELETE returned success.", observedAt: new Date().toISOString() })): EmailTransport {
  if (source.provider !== "agentmail" || source.transport !== "agentmail") throw new Error("Use the selected AgentMail source.");
  return { source,
    async listPage(cursor) {
      const page = await client.listMessagePage(cursor);
      if (page.messages.some(header => header.inbox_id !== source.mailboxId)) throw new Error("The client is connected to a different AgentMail inbox.");
      return { messages: page.messages.map(header => ({ source, messageId: header.message_id, threadId: header.thread_id,
        from: header.from, subject: header.subject, timestamp: header.timestamp, labels: header.labels })), nextCursor: page.next_page_token };
    },
    async readMessage(messageId) {
      const message = await client.getMessage(messageId);
      if (message.inbox_id !== source.mailboxId) throw new Error("The client is connected to a different AgentMail inbox.");
      return { source, messageId, threadId: message.thread_id, from: message.from, subject: message.subject,
        timestamp: message.timestamp, labels: message.labels, text: message.text, html: message.html } satisfies MailMessage;
    },
    async applyCleanup(identity, action, authorization) {
      if (sourceKey(identity.source) !== sourceKey(source) || action.mode !== "delete" || action.effect !== "permanentDelete") throw new Error("This AgentMail adapter supports only its documented individual-message deletion.");
      const record = await loadVerifiedRecord(identity);
      if (record.classification.kind !== "jobAlert" || messageKey(record.identity) !== messageKey(identity)) throw new Error("Only this classified alert can reach AgentMail cleanup.");
      if (!await verifyPersistence(record)) throw new Error("Additional persistence checks refused cleanup.");
      assertCleanupAuthorization(authorization, source, identity.messageId, action);
      bindInboxAuthorization(authorization!, source.mailboxId);
      await client.deleteCompletedAlert({ ...record, cleanupState: "cleanupPending" }, authorization!);
      return recordResult(identity, action);
    },
    async observeCleanup(identity, action) {
      if (sourceKey(identity.source) !== sourceKey(source) || action.mode !== "delete" || action.effect !== "permanentDelete") throw new Error("Inspect only this selected AgentMail message.");
      const result = (state: "applied" | "notApplied" | "unknown", evidenceReference: string) => ({ state, evidenceReference, observedAt: new Date().toISOString() });
      try {
        const message = await client.getMessage(identity.messageId);
        return message.inbox_id === source.mailboxId ? result("notApplied", "Exact-message read confirms the completed alert still exists.") : result("unknown", "The returned mailbox differs from the selected source.");
      } catch (error) {
        if (!(error instanceof AgentMailError) || error.status !== 404) return result("unknown", "Exact-message access could not establish cleanup outcome.");
        try {
          for await (const header of client.listMessageHeaders()) {
            if (header.inbox_id !== source.mailboxId || header.message_id === identity.messageId) return result("unknown", "The listing contradicts absence or belongs to another mailbox.");
          }
          return result("applied", "Exact-message 404 plus successful full selected-inbox listing confirms absence; no new deletion was claimed.");
        } catch { return result("unknown", "Selected-inbox access could not corroborate exact-message absence."); }
      }
    },
  };
}
