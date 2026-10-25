import { createHash } from "node:crypto";
import { readPrivateJson, savePrivateJson } from "../workflow/private-json.js";

export const operations = ["list", "read", "delete", "archive", "label"] as const;
export type EmailOperation = typeof operations[number];
export type CleanupMode = "delete" | "archive" | "label" | "retain";
export type CleanupEffect = "permanentDelete" | "trash" | "archive" | "label" | "retain";
export interface EmailSource {
  provider: string;
  accountId: string;
  mailboxId: string;
  address: string | null;
  transport: "hostConnector" | "agentmail";
  connectionReference: string;
}
export interface CleanupChoice {
  mode: CleanupMode;
  effect: CleanupEffect;
  labelId: string | null;
  sourceReference: string;
}
export interface EmailConnection {
  schemaVersion: 1;
  source: EmailSource;
  selection: { method: "user" | "created" | "legacy"; sourceReference: string };
  scope: { folderOrLabel: string | null; query: string | null; ruleReference: string; revision: string };
  cleanup: CleanupChoice | null;
}
export interface EmailCapability {
  status: "verified" | "unsupported" | "unverified" | "denied";
  granularity: "message" | "thread" | "none";
  effect: CleanupEffect | null;
  requiresConfirmation: boolean;
  evidence: { path: string; sha256: string }[];
  reason: string | null;
}
export interface EmailCapabilityReport {
  schemaVersion: 1;
  sourceKey: string;
  connectionReference: string;
  workingRoot: string;
  executionContext: "interactive" | "scheduled";
  checkedAt: string;
  operations: Record<EmailOperation, EmailCapability>;
}
export interface ConnectionInventory {
  schemaVersion: 1;
  candidates: { id: string; source: EmailSource; available: boolean; evidenceReference: string;
    authentication?: "connected" | "needsAuthentication" | "denied" | "unverified" }[];
}
const supplied = (value: unknown): value is string => typeof value === "string" && !!value.trim();
export function sourceKey(source: EmailSource): string {
  validateSource(source);
  // Labels, queries and connector names are not account identity.
  return createHash("sha256").update(JSON.stringify([source.provider, source.accountId, source.mailboxId])).digest("hex");
}
export function validateSource(value: unknown): asserts value is EmailSource {
  const source = value as EmailSource;
  if (!source || ![source.provider, source.accountId, source.mailboxId, source.connectionReference].every(supplied) ||
    Object.keys(source).some(key => !["provider", "accountId", "mailboxId", "address", "transport", "connectionReference"].includes(key)) ||
    /Bearer\s+\S+|-----BEGIN|(?:api[_-]?key|access[_-]?token|password)\s*=/i.test(source.connectionReference) ||
    !["hostConnector", "agentmail"].includes(source.transport) || !(source.address === null || supplied(source.address)) ||
    (source.transport === "agentmail" && source.provider !== "agentmail")) throw new Error("Use the actual provider, stable account/mailbox identity and nonsecret connection reference.");
}
export function validateCleanup(value: unknown): asserts value is CleanupChoice {
  const choice = value as CleanupChoice;
  const effects: Record<CleanupMode, string[]> = { delete: ["trash", "permanentDelete"], archive: ["archive"], label: ["label"], retain: ["retain"] };
  if (!choice || !Object.hasOwn(effects, choice.mode) || !effects[choice.mode].includes(choice.effect) ||
    Object.keys(choice).some(key => !["mode", "effect", "labelId", "sourceReference"].includes(key)) ||
    !supplied(choice.sourceReference) || !(choice.labelId === null || supplied(choice.labelId)) ||
    (choice.mode === "label" && !choice.labelId) || (choice.mode !== "label" && choice.labelId !== null)) throw new Error("Record the user's cleanup mode and its exact message-level effect.");
}
export function validateConnection(value: unknown): asserts value is EmailConnection {
  const data = value as EmailConnection;
  if (!data || data.schemaVersion !== 1 || Object.keys(data).some(key => !["schemaVersion", "source", "selection", "scope", "cleanup"].includes(key))) throw new Error("Email connection format needs investigation; preserve the saved selection and keep credentials outside connection metadata.");
  validateSource(data.source);
  if (!data.selection || !["user", "created", "legacy"].includes(data.selection.method) || !supplied(data.selection.sourceReference) ||
    Object.keys(data.selection).some(key => !["method", "sourceReference"].includes(key)) ||
    !data.scope || Object.keys(data.scope).some(key => !["folderOrLabel", "query", "ruleReference", "revision"].includes(key)) || ![data.scope.folderOrLabel, data.scope.query].every(v => v === null || typeof v === "string") ||
    !supplied(data.scope.ruleReference) || !supplied(data.scope.revision)) throw new Error("Email intake needs the actual mailbox selection and job-alert scope instructions.");
  if (data.cleanup !== null) validateCleanup(data.cleanup);
}
export function validateInventory(value: unknown): asserts value is ConnectionInventory {
  const data = value as ConnectionInventory;
  if (!data || data.schemaVersion !== 1 || !Array.isArray(data.candidates) || Object.keys(data).some(key => !["schemaVersion", "candidates"].includes(key))) throw new Error("Record only nonsecret metadata for the connections actually exposed by the harness.");
  const ids = new Set<string>();
  for (const candidate of data.candidates) {
    validateSource(candidate.source);
    if (!supplied(candidate.id) || ids.has(candidate.id) || typeof candidate.available !== "boolean" || !supplied(candidate.evidenceReference) ||
      (candidate.authentication !== undefined && !["connected", "needsAuthentication", "denied", "unverified"].includes(candidate.authentication)) ||
      Object.keys(candidate).some(key => !["id", "source", "available", "evidenceReference", "authentication"].includes(key))) throw new Error("Connection inventory entries need unique IDs, nonsecret metadata and actual availability evidence.");
    ids.add(candidate.id);
  }
}
export function validateEmailReport(value: unknown): asserts value is EmailCapabilityReport {
  const data = value as EmailCapabilityReport;
  if (!data || data.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(data.sourceKey) || !supplied(data.connectionReference) || !supplied(data.workingRoot) ||
    !["interactive", "scheduled"].includes(data.executionContext) || !Number.isFinite(Date.parse(data.checkedAt)) || !data.operations) throw new Error("Email capability evidence is incomplete.");
  for (const operation of operations) {
    const check = data.operations[operation];
    if (!check || !["verified", "unsupported", "unverified", "denied"].includes(check.status) ||
      !["message", "thread", "none"].includes(check.granularity) || typeof check.requiresConfirmation !== "boolean" ||
      !(check.effect === null || ["permanentDelete", "trash", "archive", "label", "retain"].includes(check.effect)) ||
      !(check.reason === null || typeof check.reason === "string") || !Array.isArray(check.evidence) ||
      check.evidence.some(ref => !supplied(ref.path) || !/^[a-f0-9]{64}$/.test(ref.sha256)) ||
      (["verified", "unsupported", "denied"].includes(check.status) && !check.evidence.length) ||
      (["unsupported", "denied"].includes(check.status) && !check.reason?.trim())) throw new Error("Each email capability needs its actual scope, evidence and limitation.");
  }
}
export function emailCapabilityIssues(connection: EmailConnection, report: EmailCapabilityReport,
  root: string, context: "interactive" | "scheduled"): string[] {
  validateConnection(connection); validateEmailReport(report);
  const issues: string[] = [];
  if (report.sourceKey !== sourceKey(connection.source) || report.connectionReference !== connection.source.connectionReference || report.workingRoot !== root || report.executionContext !== context) issues.push("Verify the selected email connection/account in this working root and execution context.");
  if (!connection.cleanup) issues.push("Choose completed-alert handling: delete, archive, label or retain.");
  const required: EmailOperation[] = ["list", "read"];
  if (connection.cleanup && connection.cleanup.mode !== "retain") required.push(connection.cleanup.mode);
  for (const operation of required) {
    const check = report.operations[operation];
    if (check.status !== "verified") issues.push(`Email ${operation} is ${check.status}.`);
    if (operation !== "list" && check.granularity !== "message") issues.push(`Email ${operation} must target one message, not a thread.`);
    if (context === "scheduled" && check.requiresConfirmation) issues.push(`Scheduled email ${operation} still needs a human tool confirmation.`);
    if (!["list", "read"].includes(operation) && check.effect !== connection.cleanup?.effect) issues.push("The selected cleanup effect does not match the exposed operation.");
  }
  return issues;
}
export function loadEmailConnection(root: string) {
  const found = readPrivateJson(root, ".local/email-connection.json");
  if (found.data !== null) validateConnection(found.data);
  return { connection: found.data as EmailConnection | null, revision: found.revision };
}
export function saveEmailConnection(root: string, connection: EmailConnection, revision: string | null) {
  validateConnection(connection);
  return savePrivateJson(root, ".local/email-connection.json", connection, revision);
}
