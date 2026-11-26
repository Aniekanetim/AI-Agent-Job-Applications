import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { digest, type FileEvidence } from "../email/evidence.js";
import { assertCaptchaInspection, type CaptchaInspection } from "../browser/captcha-inspection.js";
import { checkSiteEvidence, siteFile } from "../sites/files.js";
import { assertSiteAction, type SitePage } from "../sites/execution.js";
import { markSubmissionAttempted, type ApplicationTask } from "../workflow/application-state.js";
import { readPrivateJson, savePrivateJson } from "../workflow/private-json.js";
import { assertAuthorizedTaskAction, authorizeTaskAction, loadTaskControl, observeTaskAction } from "../workflow/task-control.js";

export type ExecutionContext = "interactive" | "scheduled";
type Method = "native" | "mcp" | "cli";
type Purpose = "inspect" | "fill" | "submit";
type JsonObject = Record<string, unknown>;

export interface Context {
  taskId: string;
  page: SitePage;
  pageId: number;
  context: ExecutionContext;
  method: Method;
  connection: string;
  browserEndpoint?: string;
  vacancy: string;
  account: string;
  evidence: FileEvidence;
}
export interface DocumentObservation {
  url: string;
  apiObserved: boolean;
  documents: { path: string; documentId: string; url: string }[] | null;
}
export interface Observation {
  target: Context;
  document: DocumentObservation;
  tools: { name: string; inputSchema: unknown; description?: string; annotations?: unknown }[];
}
interface Inventory {
  targetHash: string;
  documentsHash: string;
  tools: { name: string; schemaHash: string; definitionHash: string }[];
  expiresAt: number;
  access: FileEvidence;
}

/** Read only document identity. The bridge does not attribute tool names to frames. */
export const documentObservationScript = `() => {
  const documents = [];
  let complete = true;
  const visit = (frame, path, depth) => {
    if (depth > 16 || documents.length >= 64) { complete = false; return; }
    try {
      if (!frame.document) { complete = false; return; }
      documents.push({path, documentId: String(frame.performance.timeOrigin), url: frame.location.href});
      for (let i = 0; i < frame.frames.length; i++) visit(frame.frames[i], path + "." + i, depth + 1);
    } catch { complete = false; }
  };
  visit(window, "0", 0);
  return {url: location.href, apiObserved: !!document.modelContext, documents: complete ? documents : null};
}`;

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 256;
}
function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function fingerprint(value: unknown): string {
  const raw = JSON.stringify(value);
  if (typeof raw !== "string" || Buffer.byteLength(raw) > 32_768) throw new Error("WebMCP data exceeds the supported size.");
  const sort = (key: string, val: unknown) => object(val)
    ? Object.fromEntries(Object.keys(val).sort().map(name => [name, val[name]]))
    : val;
  return digest(JSON.stringify(value, sort));
}

function currentTask(root: string, target: Context): ApplicationTask {
  if (!text(target.taskId) || !text(target.connection) || !text(target.vacancy) || !text(target.account) ||
    !["interactive", "scheduled"].includes(target.context) || !["native", "mcp", "cli"].includes(target.method) ||
    !Number.isInteger(target.pageId) || target.pageId < 0) throw new Error("Record the observed vacancy, account, page and current tool connection.");
  checkSiteEvidence(root, target.evidence);
  const task = loadTaskControl(root, target.taskId).data?.task;
  if (!task?.siteExecution?.access) throw new Error("Bind the selected application and record current browser access first.");
  assertSiteAction(root, task, target.page, "webmcp");
  return task;
}
function snapshot(o: Observation) {
  const { target, document, tools } = o;
  if (!document.apiObserved) throw new Error("WebMCP is unavailable on this browser page.");
  const page = new URL(target.page.url);
  if (document.url !== page.href || !Array.isArray(document.documents) || !document.documents.length ||
    document.documents.length > 64 || document.documents[0].path !== "0" || document.documents[0].url !== page.href) {
    throw new Error("Verify the same page and inspectable document tree before using WebMCP.");
  }
  const paths = new Set<string>();
  const documentsHash = fingerprint(document.documents.map(({ path, documentId, url }) => {
    if (!/^0(?:\.\d+){0,16}$/.test(path) || paths.has(path) || path !== "0" && !paths.has(path.slice(0, path.lastIndexOf("."))) ||
      !text(documentId) || !["about:blank", "about:srcdoc"].includes(url) && new URL(url).origin !== page.origin) {
      throw new Error("A document is outside the inspected origin or has changed. Use the existing browser route.");
    }
    paths.add(path);
    return { path, documentId, urlHash: digest(url) };
  }));
  if (!Array.isArray(tools) || tools.length > 80) throw new Error("The browser returned an unsupported WebMCP catalogue.");
  const names = new Set<string>();
  const definitions = tools.map(tool => {
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(tool.name) || names.has(tool.name) || !object(tool.inputSchema) ||
      tool.inputSchema.type !== "object") throw new Error("WebMCP returned an ambiguous or unsupported action definition.");
    names.add(tool.name);
    return { name: tool.name, schemaHash: fingerprint(tool.inputSchema),
      definitionHash: fingerprint([tool.description ?? "", tool.annotations ?? null]) };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { documentsHash, tools: definitions };
}
function targetHash(root: string, target: Context, task: ApplicationTask) {
  const { evidence, ...identity } = target;
  return fingerprint([realpathSync(root), identity, task.siteExecution, task.selectedRoleId,
    task.cvVersion, task.cvSha256, task.ticket]);
}
function recordPath(kind: "inventories" | "actions", id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Use the returned WebMCP record ID.");
  return `.local/webmcp/${kind}/${id}.json`;
}

export function saveInventory(root: string, observation: Observation) {
  const task = currentTask(root, observation.target);
  const observed = snapshot(observation);
  if (!observed.tools.length) return { status: "noTools" as const, tools: [] };
  const id = randomUUID();
  const inventory: Inventory = { ...observed, targetHash: targetHash(root, observation.target, task),
    expiresAt: Date.now() + 5 * 60_000, access: observation.target.evidence };
  savePrivateJson(root, recordPath("inventories", id), inventory, null);
  return { status: "available" as const, id, tools: inventory.tools };
}

export interface Request {
  inventoryId: string;
  toolName: string;
  purpose: Purpose;
  input: JsonObject;
  mapping: FileEvidence;
  ownerId: string;
  captchaInspection?: CaptchaInspection;
}
interface Invocation {
  taskId: string;
  token: string;
  inventoryId: string;
  toolName: string;
  purpose: Purpose;
  inputHash: string;
  mapping: FileEvidence;
  startedAt: string;
  outcomeEvidence?: FileEvidence;
  result?: string;
}

/** Runs immediately before the real call. The task claim spans provider calls and process restarts. */
export function prepareWebMcpAction(root: string, observation: Observation, request: Request) {
  if (!["inspect", "fill", "submit"].includes(request.purpose) || !object(request.input)) {
    throw new Error("Use an observed, mapped vacancy action and its necessary fields.");
  }
  const { target } = observation;
  const task = currentTask(root, target);
  const inventory = readPrivateJson(root, recordPath("inventories", request.inventoryId)).data as Inventory | null;
  if (!inventory || !Number.isFinite(inventory.expiresAt) || Date.now() >= inventory.expiresAt ||
    targetHash(root, target, task) !== inventory.targetHash) {
    throw new Error("Refresh the inventory for this exact vacancy, account, connection and execution context.");
  }
  checkSiteEvidence(root, inventory.access);
  checkSiteEvidence(root, request.mapping);
  if (!request.mapping.path.startsWith("Site Architecture Context/")) throw new Error("Link this action's observed site mapping.");
  if (!request.mapping.path.startsWith(task.siteExecution!.architecturePath.split("/").slice(0, -1).join("/") + "/")) {
    throw new Error("Use the mapping for the currently bound job site or employer.");
  }
  const observed = snapshot(observation);
  if (inventory.documentsHash !== observed.documentsHash || fingerprint(inventory.tools) !== fingerprint(observed.tools)) {
    throw new Error("The document or tool catalogue changed. Inspect again before using a WebMCP action.");
  }
  const definition = observation.tools.find(tool => tool.name === request.toolName);
  if (!definition || !object(definition.inputSchema)) throw new Error("The selected action is absent from the current catalogue.");
  const registered = inventory.tools.find(tool => tool.name === request.toolName);
  const mapping = JSON.parse(readFileSync(siteFile(root, request.mapping.path), "utf8")) as JsonObject;
  const fields = mapping.fields;
  if (!registered || mapping.toolName !== request.toolName || mapping.purpose !== request.purpose ||
    mapping.schemaHash !== registered.schemaHash || mapping.definitionHash !== registered.definitionHash ||
    mapping.origin !== new URL(target.page.url).origin || !text(mapping.observation) ||
    !Array.isArray(fields) || fields.some(key => !text(key))) {
    throw new Error("Match the observed site action, schema and effect before executing it.");
  }
  const schema = definition.inputSchema;
  const properties = object(schema.properties) ? schema.properties : {};
  if (Object.keys(request.input).some(key => !fields.includes(key) || !Object.hasOwn(properties, key) ||
      /password|secret|token|otp|cookie|authorization|file|upload|attachment/i.test(key) ||
      !["string", "number", "boolean"].includes(typeof request.input[key])) ||
    Array.isArray(schema.required) && schema.required.some(key => typeof key !== "string" || !Object.hasOwn(request.input, key))) {
    throw new Error("Use only mapped scalar fields required for the action. Credentials and document uploads use the existing browser workflow.");
  }
  if (target.method === "cli" && (request.purpose !== "inspect" || Object.keys(request.input).length)) {
    throw new Error("CLI calls are limited to parameterless inspection. Use MCP or the existing browser route for candidate inputs.");
  }
  if (request.purpose === "submit" && (request.captchaInspection || task.captchaHandoffs?.length)) {
    assertCaptchaInspection(request.captchaInspection ?? { state: "unknown", provider: null }, !!task.captchaHandoffs?.length);
  }
  const inputHash = fingerprint(request.input);
  const action = authorizeTaskAction(root, task, request.purpose === "submit" ? "submit" : "webmcp", request.ownerId, target.page);
  const record: Invocation = { taskId: task.taskId, token: action.token, inventoryId: request.inventoryId,
    toolName: request.toolName, purpose: request.purpose, inputHash, mapping: request.mapping, startedAt: new Date().toISOString() };
  savePrivateJson(root, recordPath("actions", action.id), record, null);
  if (request.purpose === "submit") markSubmissionAttempted(task, root, target.page);
  assertAuthorizedTaskAction(root, task.taskId, action.token);
  return { actionId: action.id, pageId: target.pageId, toolName: request.toolName, inputHash };
}

export function observeWebMcpAction(root: string, id: string, result: "completed" | "notSubmitted" | "confirmed" | "unknown",
  evidence: FileEvidence, confirmed?: ApplicationTask) {
  const path = recordPath("actions", id);
  const saved = readPrivateJson(root, path);
  const action = saved.data as Invocation | null;
  if (!action || action.result && action.result !== "unknown") throw new Error("Use the same pending WebMCP action for recovery.");
  checkSiteEvidence(root, evidence);
  if (evidence.path.startsWith(".local/webmcp/actions/")) throw new Error("Record independently observed application evidence.");
  const current = loadTaskControl(root, action.taskId).data;
  if (!current?.action?.invoked || current.action.id !== id) throw new Error("Reconcile the action with its existing task checkpoint.");
  if (confirmed && (confirmed.taskId !== action.taskId || confirmed.selectedRoleId !== current.task.selectedRoleId ||
    confirmed.cvVersion !== current.task.cvVersion || confirmed.cvSha256 !== current.task.cvSha256 ||
    confirmed.confirmation?.reference !== evidence.path ||
    fingerprint(confirmed.siteExecution) !== fingerprint(current.task.siteExecution))) {
    throw new Error("Preserve the same vacancy, task, role, CV and observed confirmation.");
  }
  const observed = observeTaskAction(root, action.taskId, action.token, result, evidence, confirmed);
  savePrivateJson(root, path, { ...action, result, outcomeEvidence: evidence }, saved.revision);
  return observed;
}
