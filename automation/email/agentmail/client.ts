import { messageReadyForDeletion, type MessageProgress } from "../../workflow/application-state.js";
import { consumeInboxAuthorization, type CleanupAuthorization } from "../authorization.js";

export interface MessageHeader {
  inbox_id: string;
  message_id: string;
  thread_id: string;
  timestamp: string;
  from: string;
  subject?: string;
  labels?: string[];
}

interface MessagePage { messages: MessageHeader[]; next_page_token?: string | null }
export interface AlertMessage extends MessageHeader { text?: string; html?: string }
export type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class AgentMailError extends Error {
  constructor(public readonly status?: number) {
    super(status === undefined ? "AgentMail network/response error." :
      `AgentMail request failed (HTTP ${status}).`);
    this.name = "AgentMailError";
  }
}

/** No email sending or broader thread/inbox deletion operations are exposed. */
export class AgentMailInbox {
  readonly #key: string;
  readonly #inboxId: string;
  readonly #fetch: Fetch;
  readonly #root: string;

  constructor(options: { inboxId: string; apiKey: string; fetch?: Fetch }) {
    if (!options.inboxId.trim() || !options.apiKey.trim()) {
      throw new Error("Configure the actual inbox and a secure API key first.");
    }
    this.#key = options.apiKey;
    this.#inboxId = options.inboxId;
    this.#fetch = options.fetch ?? fetch;
    this.#root = `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(options.inboxId)}/messages`;
  }

  async #request(url: string, method = "GET"): Promise<Response> {
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method, headers: { Authorization: `Bearer ${this.#key}` },
        signal: AbortSignal.timeout(30_000), redirect: "error",
      });
    } catch {
      // Never return underlying exception text: it can contain credentials/body/URLs.
      throw new AgentMailError();
    }
    if (!response.ok) throw new AgentMailError(response.status);
    return response;
  }

  async #json<T>(response: Response): Promise<T> {
    try { return await response.json() as T; }
    catch { throw new AgentMailError(); }
  }

  async *listMessageHeaders(): AsyncGenerator<MessageHeader> {
    let next: string | undefined;
    const visited = new Set<string>();
    do {
      const page = await this.listMessagePage(next);
      for (const message of page.messages) yield message;
      next = page.next_page_token;
      if (next) {
        if (visited.has(next)) throw new Error("AgentMail pagination repeated a page token.");
        visited.add(next);
      }
    } while (next);
  }

  async listMessagePage(cursor?: string): Promise<{ messages: MessageHeader[]; next_page_token?: string }> {
    const url = new URL(this.#root); url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("page_token", cursor);
    const page = await this.#json<MessagePage>(await this.#request(url.toString()));
    if (!Array.isArray(page.messages) || !(page.next_page_token == null || typeof page.next_page_token === "string")) throw new AgentMailError();
    return { messages: page.messages.map(message => {
      if (message.inbox_id !== this.#inboxId || !message.message_id) throw new AgentMailError();
      return { inbox_id: message.inbox_id, message_id: message.message_id, thread_id: message.thread_id,
        timestamp: message.timestamp, from: message.from, subject: message.subject, labels: message.labels };
    }), next_page_token: page.next_page_token ?? undefined };
  }

  async getMessage(messageId: string): Promise<AlertMessage> {
    if (!messageId.trim()) throw new Error("A source message ID is required.");
    const message = await this.#json<AlertMessage>(await this.#request(
      `${this.#root}/${encodeURIComponent(messageId)}`));
    if (message.inbox_id !== this.#inboxId || message.message_id !== messageId) {
      throw new AgentMailError();
    }
    return message;
  }

  async deleteCompletedAlert(
    progress: MessageProgress,
    authorization: CleanupAuthorization | ((progress: MessageProgress) => Promise<boolean>),
  ): Promise<void> {
    const snapshot = structuredClone(progress);
    if (snapshot.inboxId !== this.#inboxId || snapshot.cleanupState !== "cleanupPending" ||
      !messageReadyForDeletion(snapshot)) {
      throw new Error("The source alert still has unresolved or unpersisted work.");
    }
    if (typeof authorization === "function") throw new Error("Use coordinated cleanup; a callback Boolean cannot authorize deletion.");
    consumeInboxAuthorization(authorization, this.#inboxId, snapshot.messageId);
    await this.#request(`${this.#root}/${encodeURIComponent(snapshot.messageId)}`, "DELETE");
    // Caller records the actual successful response/checkpoint atomically afterward.
  }
}
