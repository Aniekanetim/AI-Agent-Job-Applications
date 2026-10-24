import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

export type CredentialSource = { type: "envFile"; path: string } | { type: "environment" };
export interface ConnectionCandidate {
  source: CredentialSource;
  origin: "project" | "saved" | "skill" | "environment";
  state: "configured" | "unconfigured" | "unreadable";
  endpointCompatible: boolean;
  skillInstructions?: string;
}
type Environment = Readonly<Record<string, string | undefined>>;
export class ConnectionSourceError extends Error {
  constructor() {
    super("The selected AgentMail connection needs investigation; its credentials were preserved.");
    this.name = "ConnectionSourceError";
  }
}

function values(source: CredentialSource, environment: Environment): Environment {
  return source.type === "environment" ? environment : parseEnv(readFileSync(source.path, "utf8"));
}
function compatible(value: string | undefined): boolean {
  return !value?.trim() || /^https:\/\/api\.agentmail\.to\/?$/.test(value.trim());
}
function referencePath(root: string) { return resolve(root, ".local/agentmail-connection.json"); }

/** Only a nonsecret reference is saved; the original credential source remains untouched. */
export function savedCredentialSource(root: string): CredentialSource | undefined {
  const path = referencePath(root);
  if (!existsSync(path)) return undefined;
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    if (data?.schemaVersion !== 1 || !data.source) throw new ConnectionSourceError();
    if (data.source.type === "environment") return { type: "environment" };
    if (data.source.type === "envFile" && typeof data.source.path === "string" &&
      isAbsolute(data.source.path) && !data.source.path.includes("\0")) {
      return { type: "envFile", path: data.source.path };
    }
  } catch { throw new ConnectionSourceError(); }
  throw new ConnectionSourceError();
}

export function saveCredentialSource(root: string, source: CredentialSource): void {
  const reference: CredentialSource = source.type === "environment" ? { type: "environment" } :
    { type: "envFile", path: resolve(source.path) };
  const folder = resolve(root, ".local");
  mkdirSync(folder, { recursive: true });
  const temporary = resolve(folder, `agentmail-connection-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, source: reference }, null, 2) + "\n",
      { flag: "wx", mode: 0o600 });
    renameSync(temporary, referencePath(root));
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}

/** Bounded local discovery: no API calls, broad disk search or credential values in results. */
export function detectExistingConnections(
  root: string, options: { home?: string; environment?: Environment } = {},
): { existingSetupFound: boolean; accessVerified: false; savedReferenceNeedsAttention: boolean;
  candidates: ConnectionCandidate[] } {
  const environment = options.environment ?? process.env;
  const home = options.home ?? homedir();
  const candidates: ConnectionCandidate[] = [];
  const seen = new Set<string>();
  const probe = (source: CredentialSource, origin: ConnectionCandidate["origin"], skillInstructions?: string) => {
    const path = source.type === "envFile" ? resolve(source.path) : "environment";
    const id = process.platform === "win32" ? path.toLowerCase() : path;
    if (seen.has(id)) return;
    seen.add(id);
    try {
      const found = values(source, environment);
      candidates.push({ source, origin, state: found.AGENTMAIL_API_KEY?.trim() ? "configured" : "unconfigured",
        endpointCompatible: compatible(found.AGENTMAIL_BASE_URL),
        ...(skillInstructions ? { skillInstructions } : {}) });
    } catch {
      candidates.push({ source, origin, state: "unreadable", endpointCompatible: false,
        ...(skillInstructions ? { skillInstructions } : {}) });
    }
  };
  let savedReferenceNeedsAttention = false;
  try {
    const saved = savedCredentialSource(root);
    if (saved) probe(saved, "saved");
  } catch { savedReferenceNeedsAttention = true; }
  const project = resolve(root, "automation/.env");
  if (existsSync(project)) probe({ type: "envFile", path: project }, "project");
  const skillRoots = [resolve(environment.CODEX_HOME ?? resolve(home, ".codex"), "skills/agentmail"),
    resolve(home, ".agents/skills/agentmail"), resolve(home, ".claude/skills/agentmail")];
  for (const folder of skillRoots) {
    const instructions = resolve(folder, "SKILL.md");
    const file = resolve(folder, ".env");
    if (existsSync(file)) probe({ type: "envFile", path: file }, "skill",
      existsSync(instructions) ? instructions : undefined);
    else if (existsSync(instructions)) {
      candidates.push({ source: { type: "envFile", path: file }, origin: "skill",
        state: "unconfigured", endpointCompatible: true, skillInstructions: instructions });
    }
  }
  if (environment.AGENTMAIL_API_KEY?.trim()) probe({ type: "environment" }, "environment");
  return { existingSetupFound: candidates.some(item => item.state === "configured"),
    accessVerified: false, savedReferenceNeedsAttention, candidates };
}

/** Use an existing source only after the agent has established its purpose and permissions. */
export function credentialsFromSource(source: CredentialSource, environment: Environment = process.env) {
  try {
    const found = values(source, environment);
    const apiKey = found.AGENTMAIL_API_KEY?.trim();
    if (!apiKey || !compatible(found.AGENTMAIL_BASE_URL)) throw new ConnectionSourceError();
    return { apiKey };
  } catch { throw new ConnectionSourceError(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(detectExistingConnections(process.cwd())));
}
