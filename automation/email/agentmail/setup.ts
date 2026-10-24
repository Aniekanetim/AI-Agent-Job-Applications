import { readFileSync, mkdirSync, writeFileSync, renameSync, existsSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { AgentMailError, AgentMailInbox, type Fetch } from "./client.js";
import { listAccessibleInboxes, createIntakeInbox, type InboxSummary } from "./inboxes.js";
import { credentialsFromSource, savedCredentialSource, saveCredentialSource,
  detectExistingConnections, ConnectionSourceError, type CredentialSource } from "./connection.js";

export interface InboxConfig {
  readonly inboxId?: string;
  readonly apiKey: string;
}

export class InboxConfigurationError extends Error {
  constructor() {
    super("No AgentMail connection is selected. Run inbox:detect before requesting an API key in private automation/.env.");
    this.name = "InboxConfigurationError";
  }
}

/** Prefer project configuration, then the existing source explicitly bound by the agent. */
export function readInboxConnection(workingRoot: string): { config: InboxConfig; source: CredentialSource } {
  const path = resolve(workingRoot, "automation", ".env");
  let values: ReturnType<typeof parseEnv> = {};
  try {
    values = parseEnv(readFileSync(path, "utf8"));
  } catch {
    if (existsSync(path)) throw new ConnectionSourceError();
  }
  const inboxId = values.AGENTMAIL_INBOX_ID?.trim();
  const apiKey = values.AGENTMAIL_API_KEY?.trim();
  if (apiKey) return { config: { ...(inboxId ? { inboxId } : {}),
    ...credentialsFromSource({ type: "envFile", path }) }, source: { type: "envFile", path } };
  const source = savedCredentialSource(workingRoot);
  if (source) return { config: credentialsFromSource(source), source };
  throw new InboxConfigurationError();
}

export function readInboxConfig(workingRoot: string): InboxConfig {
  return readInboxConnection(workingRoot).config;
}

export class InboxSelectionRequired extends Error {
  constructor(public readonly candidates: InboxSummary[]) {
    super("List the available inboxes and ask which the user wants to use; reuse an already supplied choice.");
    this.name = "InboxSelectionRequired";
  }
}

export class InboxSetupStateError extends Error {
  constructor() {
    super("The saved intake mailbox or setup state needs investigation; existing work was preserved.");
    this.name = "InboxSetupStateError";
  }
}

interface IntakeBinding {
  schemaVersion: 1; inboxId?: string; clientId?: string; selectionMethod?: "user" | "created";
}

function bindingPath(root: string) { return resolve(root, ".local", "agentmail-intake.json"); }

function readBinding(root: string): IntakeBinding {
  const path = bindingPath(root);
  if (!existsSync(path)) return { schemaVersion: 1 };
  try {
    const state = JSON.parse(readFileSync(path, "utf8")) as IntakeBinding;
    if (state.schemaVersion !== 1 ||
      (state.inboxId !== undefined && (typeof state.inboxId !== "string" || !state.inboxId.trim())) ||
      (state.clientId !== undefined && (typeof state.clientId !== "string" || !state.clientId.trim())) ||
      (state.selectionMethod !== undefined && !["user", "created"].includes(state.selectionMethod))) {
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

/** The user chooses the address; the agent resolves and stores its provider ID. */
export async function resolveIntakeInbox(
  root: string, config: InboxConfig,
  options: { allowCreate?: boolean; selectedInboxId?: string; selectedInboxAddress?: string; http?: Fetch } = {},
): Promise<InboxSummary> {
  const state = readBinding(root);
  const all = await listAccessibleInboxes(config.apiKey, options.http);
  const active = all.filter(item => item.status !== "paused");
  if (options.selectedInboxId && options.selectedInboxAddress) throw new InboxSetupStateError();
  const suppliedAddress = options.selectedInboxAddress?.trim().toLowerCase();
  if (options.selectedInboxAddress !== undefined && !suppliedAddress) throw new InboxSetupStateError();
  if (state.inboxId && !active.some(item => item.inbox_id === state.inboxId) &&
    !options.selectedInboxId && !suppliedAddress) throw new InboxSetupStateError();
  const preferred = options.selectedInboxId ?? config.inboxId ??
    (state.selectionMethod ? state.inboxId : undefined);
  let selectionMethod = state.selectionMethod;
  let chosen: InboxSummary | undefined;
  if (suppliedAddress) {
    const matches = active.filter(item => item.email?.toLowerCase() === suppliedAddress ||
      item.inbox_id.toLowerCase() === suppliedAddress);
    if (matches.length !== 1) throw new InboxSetupStateError();
    chosen = matches[0]; selectionMethod = "user";
  } else if (preferred) {
    chosen = active.find(item => item.inbox_id === preferred);
    if (!chosen) throw new InboxSetupStateError();
    if (options.selectedInboxId || config.inboxId) selectionMethod = "user";
  } else if (state.inboxId) {
    // Older bindings may have been selected automatically; preserve them while asking once.
    throw new InboxSelectionRequired(all);
  } else if (state.clientId) {
    chosen = active.find(item => item.client_id === state.clientId);
    if (!chosen) {
      if (!options.allowCreate) throw new InboxSetupStateError();
      chosen = await createIntakeInbox(config.apiKey, state.clientId, options.http);
    }
    selectionMethod = "created";
  } else if (all.length > 0) {
    // Even a sole or specially named existing inbox needs the user's choice.
    throw new InboxSelectionRequired(all);
  } else {
    if (!options.allowCreate) throw new InboxSelectionRequired([]);
    const claimed = claimCreation(root);
    if (claimed.inboxId) return resolveIntakeInbox(root, config, options);
    if (!claimed.clientId) throw new InboxSetupStateError();
    state.clientId = claimed.clientId;
    chosen = await createIntakeInbox(config.apiKey, state.clientId, options.http);
    selectionMethod = "created";
  }
  if (options.allowCreate) saveBinding(root, { ...state, inboxId: chosen.inbox_id, selectionMethod });
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
  if (error instanceof ConnectionSourceError) return { exitCode: 3, message: error.message };
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
    const args = process.argv.slice(2);
    const allowCreate = args.includes("--setup");
    const file = args.indexOf("--credential-file");
    const useEnvironment = args.includes("--use-environment");
    if ((file >= 0 && (!args[file + 1] || args[file + 1].startsWith("--"))) ||
      (file >= 0 && useEnvironment)) throw new ConnectionSourceError();
    const explicit: CredentialSource | undefined = file >= 0
      ? { type: "envFile", path: resolve(root, args[file + 1]) }
      : useEnvironment ? { type: "environment" } : undefined;
    const connection = explicit ? { source: explicit, config: credentialsFromSource(explicit) }
      : readInboxConnection(root);
    const { config } = connection;
    if (args.includes("--list-inboxes")) {
      const inboxes = await listAccessibleInboxes(config.apiKey);
      await new Promise<void>((done, reject) => process.stdout.write(JSON.stringify({ inboxes,
        operation: "Inbox metadata only", messagesRead: 0, bindingsWritten: 0 }) + "\n",
      error => error ? reject(error) : done()));
      process.exit(0);
    }
    const selected = args.indexOf("--select");
    const address = args.indexOf("--select-address");
    if ((selected >= 0 && (!args[selected + 1] || args[selected + 1].startsWith("--"))) ||
      (address >= 0 && (!args[address + 1] || args[address + 1].startsWith("--")))) {
      throw new InboxSetupStateError();
    }
    const resolved = await resolveIntakeInbox(root, config, {
      allowCreate, selectedInboxId: selected >= 0 ? args[selected + 1] : undefined,
      selectedInboxAddress: address >= 0 ? args[address + 1] : undefined,
    });
    const access = await checkInboxAccess({ ...config, inboxId: resolved.inbox_id });
    if (allowCreate) saveCredentialSource(root, connection.source);
    console.log(JSON.stringify({ ...access, inboxId: resolved.inbox_id,
      connectionSource: connection.source,
      ...(resolved.email ? { email: resolved.email } : {}) }));
  } catch (error) {
    const failure = inboxCheckFailure(error);
    if (error instanceof InboxConfigurationError) {
      const discovery = detectExistingConnections(process.cwd());
      if (discovery.existingSetupFound || discovery.savedReferenceNeedsAttention ||
        discovery.candidates.some(item => item.state === "unreadable")) {
        console.error(JSON.stringify({ needsAgentConnection: true, ...discovery }));
        process.exitCode = 4;
      } else { console.error(failure.message); process.exitCode = failure.exitCode; }
    } else if (error instanceof InboxSelectionRequired) {
      console.error(JSON.stringify({ needsAgentSelection: true, needsUserInboxChoice: true,
        candidates: error.candidates }));
      process.exitCode = failure.exitCode;
    } else { console.error(failure.message); process.exitCode = failure.exitCode; }
  }
}
