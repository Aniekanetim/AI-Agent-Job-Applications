import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { AgentMailError, AgentMailInbox, type Fetch } from "./agentmail.js";

export interface InboxConfig {
  readonly inboxId: string;
  readonly apiKey: string;
}

export class InboxConfigurationError extends Error {
  constructor() {
    super("Configure AGENTMAIL_INBOX_ID and AGENTMAIL_API_KEY in the private automation/.env file.");
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
  if (!inboxId || !apiKey) throw new InboxConfigurationError();
  return { inboxId, apiKey };
}

/** Verify paginated header access only. No body reads, sending or deletion. */
export async function checkInboxAccess(config: InboxConfig, http?: Fetch) {
  const client = new AgentMailInbox({ ...config, fetch: http });
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
  if (error instanceof AgentMailError) {
    return { exitCode: 1, message: error.status === undefined
      ? "AgentMail access could not be verified (network or response error)."
      : `AgentMail access could not be verified (HTTP ${error.status}).` };
  }
  return { exitCode: 1, message: "AgentMail inbox check did not complete." };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await checkInboxAccess(readInboxConfig(process.cwd()))));
  } catch (error) {
    const failure = inboxCheckFailure(error);
    console.error(failure.message);
    process.exitCode = failure.exitCode;
  }
}
