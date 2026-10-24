import { readFileSync, mkdirSync, writeFileSync, renameSync, existsSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { AgentMailError, AgentMailInbox, type Fetch } from "./agentmail.js";
import { listAccessibleInboxes, createIntakeInbox, type InboxSummary } from "./agentmail-inboxes.js";

export interface InboxConfig {
  readonly inboxId?: string;
  readonly apiKey: string;
}

export class InboxConfigurationError extends Error {
  constructor() {
    super("Configure AGENTMAIL_API_KEY in the private automation/.env file; the agent discovers the inbox.");
    this.name = "InboxConfigurationError";
  }
}

/** Read this working copy only; never inherit another skill's account or secrets. */
export function readInboxConfig(workingRoot: string): InboxConfig {
  let values: ReturnType<typeof parseEnv>;
  try {
    values = parseEnv(readFileSync(resolve(workingRoot, "automation", ".env"), "utf8"));
  } catch {
    throw new InboxConfigurationError();
  }
  const inboxId = values.AGENTMAIL_INBOX_ID?.trim();
  const apiKey = values.AGENTMAIL_API_KEY?.trim();
  if (!apiKey) throw new InboxConfigurationError();
  return { ...(inboxId ? { inboxId } : {}), apiKey };
}

export class InboxSelectionRequired extends Error {
  constructor(public readonly candidates: InboxSummary[]) {
    super("The agent needs to resolve the intake mailbox from available context.");
    this.name = "InboxSelectionRequired";
  }
}

export class InboxSetupStateError extends Error {
  constructor() {
    super("The saved intake mailbox or setup state needs investigation; existing work was preserved.");
    this.name = "InboxSetupStateError";
  }
}

interface IntakeBinding { schemaVersion: 1; inboxId?: string; clientId?: string }

function bindingPath(root: string) { return resolve(root, ".local", "agentmail-intake.json"); }

function readBinding(root: string): IntakeBinding {
  const path = bindingPath(root);
  if (!existsSync(path)) return { schemaVersion: 1 };
  try {
    const state = JSON.parse(readFileSync(path, "utf8")) as IntakeBinding;
    if (state.schemaVersion !== 1 ||
      (state.inboxId !== undefined && (typeof state.inboxId !== "string" || !state.inboxId.trim())) ||
      (state.clientId !== undefined && (typeof state.clientId !== "string" || !state.clientId.trim()))) {
      throw new InboxSetupStateError();
    }
    return state;
  } catch { throw new InboxSetupStateError(); }
}

function saveBinding(root: string, state: IntakeBinding) {
  const folder = resolve(root, ".local");
  mkdirSync(folder, { recursive: true });
  const temporary = resolve(folder, `agentmail-intake-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(state, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    renameSync(temporary, bindingPath(root));
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}

function claimCreation(root: string): IntakeBinding {
  mkdirSync(resolve(root, ".local"), { recursive: true });
  const state: IntakeBinding = { schemaVersion: 1,
    clientId: `job-application-alerts-${randomUUID()}` };
  try {
    // Exclusive creation makes concurrent starts share one provider idempotency key.
    writeFileSync(bindingPath(root), JSON.stringify(state, null, 2) + "\n", {
      flag: "wx", mode: 0o600,
    });
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return readBinding(root);
    throw new InboxSetupStateError();
  }
}

/** Resolve IDs for the agent. Human onboarding only needs the API key. */
export async function resolveIntakeInbox(
  root: string, config: InboxConfig,
  options: { allowCreate?: boolean; selectedInboxId?: string; http?: Fetch } = {},
): Promise<InboxSummary> {
  const state = readBinding(root);
  const all = await listAccessibleInboxes(config.apiKey, options.http);
  const active = all.filter(item => item.status !== "paused");
  const preferred = options.selectedInboxId ?? config.inboxId ?? state.inboxId;
  let chosen: InboxSummary | undefined;
  if (preferred) {
    chosen = active.find(item => item.inbox_id === preferred);
    if (!chosen) throw new InboxSetupStateError();
  } else if (state.clientId) {
    chosen = active.find(item => item.client_id === state.clientId);
    if (!chosen) {
      if (!options.allowCreate) throw new InboxSetupStateError();
      chosen = await createIntakeInbox(config.apiKey, state.clientId, options.http);
    }
  } else if (active.length === 1) {
    chosen = active[0];
  } else {
    const dedicated = active.filter(item => item.display_name === "Job application alerts");
    if (dedicated.length === 1) chosen = dedicated[0];
    else if (active.length > 0) throw new InboxSelectionRequired(active);
    else {
      if (!options.allowCreate) throw new InboxSelectionRequired([]);
      const claimed = claimCreation(root);
      if (claimed.inboxId) return resolveIntakeInbox(root, config, options);
      if (!claimed.clientId) throw new InboxSetupStateError();
      state.clientId = claimed.clientId;
      chosen = await createIntakeInbox(config.apiKey, state.clientId, options.http);
    }
  }
  if (options.allowCreate) saveBinding(root, { ...state, inboxId: chosen.inbox_id });
  return chosen;
}

/** Verify paginated header access only. No body reads, sending or deletion. */
export async function checkInboxAccess(config: InboxConfig, http?: Fetch) {
  if (!config.inboxId) throw new InboxSetupStateError();
  const client = new AgentMailInbox({ inboxId: config.inboxId, apiKey: config.apiKey, fetch: http });
  let headersListed = 0;
  for await (const _header of client.listMessageHeaders()) headersListed++;
  return {
    inboxReachable: true,
    headersListed,
    verificationScope: "Read-only message headers",
    messageBodiesVerified: false,
    deletionVerified: false,
    alertsConvertedToTasks: 0,
  } as const;
}

/** CLI output must not contain raw exception text, message content or credentials. */
export function inboxCheckFailure(error: unknown): { exitCode: number; message: string } {
  if (error instanceof InboxConfigurationError) return { exitCode: 2, message: error.message };
  if (error instanceof InboxSelectionRequired) return { exitCode: 3, message: error.message };
  if (error instanceof InboxSetupStateError) return { exitCode: 3, message: error.message };
  if (error instanceof AgentMailError) {
    return { exitCode: 1, message: error.status === undefined
      ? "AgentMail access could not be verified (network or response error)."
      : `AgentMail access could not be verified (HTTP ${error.status}).` };
  }
  return { exitCode: 1, message: "AgentMail inbox check did not complete." };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = process.cwd();
    const config = readInboxConfig(root);
    const args = process.argv.slice(2);
    const allowCreate = args.includes("--setup");
    const selected = args.indexOf("--select");
    if (selected >= 0 && (!allowCreate || !args[selected + 1] || args[selected + 1].startsWith("--"))) {
      throw new InboxSetupStateError();
    }
    const resolved = await resolveIntakeInbox(root, config, {
      allowCreate, selectedInboxId: selected >= 0 ? args[selected + 1] : undefined,
    });
    const access = await checkInboxAccess({ ...config, inboxId: resolved.inbox_id });
    console.log(JSON.stringify({ ...access, inboxId: resolved.inbox_id,
      ...(resolved.email ? { email: resolved.email } : {}) }));
  } catch (error) {
    const failure = inboxCheckFailure(error);
    if (error instanceof InboxSelectionRequired) {
      console.error(JSON.stringify({ needsAgentSelection: true, candidates: error.candidates }));
    } else console.error(failure.message);
    process.exitCode = failure.exitCode;
  }
}
