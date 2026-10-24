import { AgentMailError, type Fetch } from "./agentmail.js";

export interface InboxSummary {
  inbox_id: string;
  email?: string;
  display_name?: string;
  client_id?: string;
  status?: string;
}

async function request(apiKey: string, url: string, http: Fetch, body?: object) {
  if (!apiKey.trim()) throw new AgentMailError();
  let response: Response;
  try {
    response = await http(url, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${apiKey}`,
        ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: "error", signal: AbortSignal.timeout(30_000),
    });
  } catch { throw new AgentMailError(); }
  if (!response.ok) throw new AgentMailError(response.status);
  try { return await response.json() as unknown; }
  catch { throw new AgentMailError(); }
}

function inbox(value: unknown): InboxSummary {
  if (!value || typeof value !== "object") throw new AgentMailError();
  const item = value as Record<string, unknown>;
  if (typeof item.inbox_id !== "string" || !item.inbox_id.trim()) throw new AgentMailError();
  for (const key of ["email", "display_name", "client_id", "status"]) {
    if (item[key] != null && typeof item[key] !== "string") throw new AgentMailError();
  }
  return { inbox_id: item.inbox_id, email: (item.email ?? undefined) as string | undefined,
    display_name: (item.display_name ?? undefined) as string | undefined,
    client_id: (item.client_id ?? undefined) as string | undefined,
    status: (item.status ?? undefined) as string | undefined };
}

export async function listAccessibleInboxes(apiKey: string, http: Fetch = fetch): Promise<InboxSummary[]> {
  const found = new Map<string, InboxSummary>();
  const visited = new Set<string>();
  let next: string | undefined;
  do {
    const url = new URL("https://api.agentmail.to/v0/inboxes");
    url.searchParams.set("limit", "100");
    if (next) url.searchParams.set("page_token", next);
    const result = await request(apiKey, url.toString(), http);
    if (!result || typeof result !== "object") throw new AgentMailError();
    const page = result as Record<string, unknown>;
    if (!Array.isArray(page.inboxes) ||
      (page.next_page_token != null && typeof page.next_page_token !== "string")) {
      throw new AgentMailError();
    }
    for (const value of page.inboxes) {
      const item = inbox(value);
      found.set(item.inbox_id, item);
    }
    next = page.next_page_token as string | undefined | null ?? undefined;
    if (next) {
      if (visited.has(next)) throw new AgentMailError();
      visited.add(next);
    }
  } while (next);
  return [...found.values()];
}

/** The caller persists this clientId before the first request and reuses it on retry. */
export async function createIntakeInbox(apiKey: string, clientId: string, http: Fetch = fetch) {
  if (!clientId.trim()) throw new Error("A persisted creation identity is required.");
  const created = inbox(await request(apiKey, "https://api.agentmail.to/v0/inboxes", http, {
    display_name: "Job application alerts", client_id: clientId,
  }));
  if ((created.client_id != null && created.client_id !== clientId) ||
    created.status === "paused") throw new AgentMailError();
  return { ...created, client_id: clientId };
}
