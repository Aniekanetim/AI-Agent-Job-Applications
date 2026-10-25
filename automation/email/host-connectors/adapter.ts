import { emailCapabilityIssues, type EmailSource, type EmailConnection, type EmailCapabilityReport, type CleanupChoice } from "../connection.js";
import { messageKey, type EmailIdentity, type MailHeader, type MailMessage } from "../intake.js";
import { assertCleanupAuthorization, type CleanupAuthorization } from "../authorization.js";

export interface CleanupObservation { state: "applied" | "notApplied" | "unknown"; evidenceReference: string; observedAt: string }
export interface CleanupResult { evidenceReference: string; observedAt: string }
export interface EmailTransport {
  source: EmailSource;
  listPage(cursor?: string): Promise<{ messages: MailHeader[]; nextCursor?: string }>;
  readMessage(messageId: string): Promise<MailMessage>;
  applyCleanup(identity: EmailIdentity, action: CleanupChoice, authorization?: CleanupAuthorization): Promise<CleanupResult>;
  observeCleanup?(identity: EmailIdentity, action: CleanupChoice): Promise<CleanupObservation>;
}
/** Bind these callbacks to actual tools exposed by the harness; this module performs no OAuth. */
export interface HostBindings {
  listPage: EmailTransport["listPage"];
  readMessage: EmailTransport["readMessage"];
  cleanup?: EmailTransport["applyCleanup"];
  observeCleanup?: EmailTransport["observeCleanup"];
}
export class HostEmailAdapter implements EmailTransport {
  readonly source: EmailSource;
  constructor(private readonly connection: EmailConnection, private readonly report: EmailCapabilityReport,
    private readonly root: string, private readonly context: "interactive" | "scheduled", private readonly bindings: HostBindings) {
    const issues = emailCapabilityIssues(connection, report, root, context);
    if (issues.length) throw new Error(issues.join(" "));
    this.source = structuredClone(connection.source);
  }
  async listPage(cursor?: string) {
    try {
      const page = await this.bindings.listPage(cursor);
      if (!page || !Array.isArray(page.messages) || !(page.nextCursor === undefined || typeof page.nextCursor === "string")) throw new Error();
      for (const header of page.messages) {
        if (messageKey(header) !== messageKey({ source: this.source, messageId: header.messageId })) throw new Error();
      }
      // A listing never returns message bodies to the intake caller.
      return { messages: page.messages.map(h => ({ source: structuredClone(this.source), messageId: h.messageId,
        from: h.from, subject: h.subject, timestamp: h.timestamp, labels: h.labels, contentRevision: h.contentRevision, threadId: h.threadId })), nextCursor: page.nextCursor };
    } catch { throw new Error("The selected host email connection could not list messages; preserve its selection."); }
  }
  async readMessage(messageId: string) {
    try {
      const message = await this.bindings.readMessage(messageId);
      if (messageKey(message) !== messageKey({ source: this.source, messageId })) throw new Error();
      return message;
    } catch { throw new Error("The selected host email connection could not read this exact message."); }
  }
  async applyCleanup(identity: EmailIdentity, action: CleanupChoice, authorization?: CleanupAuthorization) {
    if (messageKey(identity) !== messageKey({ source: this.source, messageId: identity.messageId }) ||
      JSON.stringify(action) !== JSON.stringify(this.connection.cleanup) || !this.bindings.cleanup) throw new Error("This connection cannot perform the selected message-specific cleanup.");
    const issues = emailCapabilityIssues(this.connection, this.report, this.root, this.context);
    if (issues.length) throw new Error(issues.join(" "));
    assertCleanupAuthorization(authorization, this.source, identity.messageId, action, true);
    try { return await this.bindings.cleanup({ source: structuredClone(this.source), messageId: identity.messageId }, structuredClone(action), authorization); }
    catch { throw new Error("Email cleanup was not confirmed; preserve the pending checkpoint and inspect the exact message before retrying."); }
  }
  async observeCleanup(identity: EmailIdentity, action: CleanupChoice): Promise<CleanupObservation> {
    if (messageKey(identity) !== messageKey({ source: this.source, messageId: identity.messageId }) || !this.bindings.observeCleanup) return { state: "unknown", evidenceReference: "No exact-message recovery tool is available.", observedAt: new Date().toISOString() };
    try { return await this.bindings.observeCleanup(identity, action); }
    catch { return { state: "unknown", evidenceReference: "Exact-message cleanup outcome remains unverified.", observedAt: new Date().toISOString() }; }
  }
}
export async function* listAllHeaders(transport: EmailTransport): AsyncGenerator<MailHeader> {
  let cursor: string | undefined;
  const visited = new Set<string>();
  do {
    const page = await transport.listPage(cursor);
    for (const message of page.messages) yield message;
    cursor = page.nextCursor;
    if (cursor && visited.has(cursor)) throw new Error("Email pagination repeated a cursor; enumeration is incomplete.");
    if (cursor) visited.add(cursor);
  } while (cursor);
}
