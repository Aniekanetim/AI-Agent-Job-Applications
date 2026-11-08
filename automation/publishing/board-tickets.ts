import fs from "node:fs";
import { resolve } from "node:path";
import { digest, readEvidence, type FileEvidence } from "../email/evidence.js";
import { readPrivateJson, savePrivateJson } from "../workflow/private-json.js";
import { ticketFolder, pickupFolder, type BoardFolder } from "../workflow/board.js";
import { acquireOwnership } from "../workflow/ownership.js";
import { privateTicket, taskOwnershipKey, writeTicket } from "../workflow/task-control.js";
import { commitAttentionChange, stageAttentionChange } from "../attention/events.js";
import { contentReference } from "./board-config.js";
import type { Receipt, Post } from "./store.js";

export type ContentTicket = {
  schemaVersion: 1; kind: "content"; id: string; source: "agent" | "user" | "legacy"; sourceReference: string;
  preparedBy?: "agent" | "user";
  topic: string; angle: string; fingerprint: string; profileSha256: string; draftSha256: string;
  ready: boolean; dependencies?: string[]; receipt?: Receipt; attempts?: Post["attempts"];
};
type Move = { from: string; to: string; original: string; bytes: string; event: string; authority: FileEvidence };
const marker = "<!-- content-task -->";
const pathOf = (id: string, folder: BoardFolder) => `Task Board/${folder}/CONTENT-${id}.md`;
const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const movePath = (id: string) => `.local/publishing/moves/${digest(id)}.json`;
const identityPath = (id: string) => `.local/publishing/ticket-ids/${digest(id)}.json`;
export const contentPath = (id: string) => pathOf(id, pickupFolder("content"));
const validId = (id: unknown): id is string => typeof id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
const taskKey = (id: string) => taskOwnershipKey(`CONTENT-${id}`);
export const contentIdentityExists = (root: string, id: string) => readPrivateJson(root, identityPath(id)).data !== null;

function render(ticket: ContentTicket) {
  return Buffer.from(`# Content creation — ${ticket.topic}\n\nTask ID: CONTENT-${ticket.id}\n\n${ticket.receipt ?
    `Confirmed publication: ${ticket.receipt.url ?? ticket.receipt.reference}` : ticket.ready ? "Prepared for check-in." : "Content preparation pending."}\n\n${marker}\n\x60\x60\x60json\n${JSON.stringify(ticket, null, 2)}\n\x60\x60\x60\n`);
}

export function readContentTicket(root: string, path: string) {
  const file = privateTicket(root, path), bytes = fs.readFileSync(file), raw = bytes.toString("utf8");
  const block = /<!-- content-task -->\s*\x60\x60\x60json\s*\r?\n([\s\S]+?)\r?\n\x60\x60\x60\s*$/.exec(raw);
  if (!block) throw new Error("Use the content ticket's structured board binding.");
  const ticket = JSON.parse(block[1]) as ContentTicket;
  if (!ticket || ticket.schemaVersion !== 1 || ticket.kind !== "content" || !validId(ticket.id) || path !== pathOf(ticket.id, ticketFolder(path)) ||
    !["agent", "user", "legacy"].includes(ticket.source) || (ticket.preparedBy !== undefined && !["agent", "user"].includes(ticket.preparedBy)) ||
    !contentReference(ticket.sourceReference) || !contentReference(ticket.topic) ||
    !contentReference(ticket.angle) || !hash(ticket.fingerprint) || !hash(ticket.profileSha256) || !hash(ticket.draftSha256) ||
    typeof ticket.ready !== "boolean" || (ticket.dependencies !== undefined && (!Array.isArray(ticket.dependencies) ||
      !ticket.dependencies.length || !ticket.dependencies.every(validId) || new Set(ticket.dependencies).size !== ticket.dependencies.length))) {
    throw new Error("Preserve the same content ticket identity and draft evidence.");
  }
  if (readPrivateJson(root, movePath(ticket.id)).data) throw new Error("Recover the selected content ticket's pending move before processing.");
  return { ticket, file: { path, sha256: digest(bytes) } };
}

export function saveContentTicket(root: string, ticket: ContentTicket, expected: string | null, folder = pickupFolder("content") as BoardFolder) {
  if (!validId(ticket.id)) throw new Error("Use a stable content ticket ID.");
  const owner = acquireOwnership(root, taskKey(ticket.id));
  try {
    if (readPrivateJson(root, movePath(ticket.id)).data) throw new Error("Recover the selected content move before editing.");
    const identity = readPrivateJson(root, identityPath(ticket.id));
    if (identity.data && expected === null) throw new Error("Resume the original content ticket through its lifecycle.");
    const saved = writeTicket(root, pathOf(ticket.id, folder), render(ticket), expected);
    if (!identity.data) savePrivateJson(root, identityPath(ticket.id), { id: ticket.id }, identity.revision);
    return saved;
  } finally { owner.release(); }
}

function finishMove(root: string, id: string, move: Move, revision: string) {
  const bytes = Buffer.from(move.bytes, "base64");
  const destination = privateTicket(root, move.to), source = privateTicket(root, move.from);
  const result = fs.existsSync(destination)
    ? { path: move.to, sha256: digest(fs.readFileSync(destination)) }
    : writeTicket(root, move.to, bytes, null);
  if (result.sha256 !== digest(bytes)) throw new Error("The content move destination changed. Preserve both records.");
  if (fs.existsSync(source)) {
    if (digest(fs.readFileSync(source)) !== move.original) throw new Error("The source ticket changed. Preserve both records.");
    fs.unlinkSync(source);
  }
  commitAttentionChange(root, move.event, `${result.path}:${result.sha256}`);
  savePrivateJson(root, movePath(id), null, revision);
  return result;
}

export function recoverContentMove(root: string, id: string) {
  if (!validId(id)) throw new Error("Select one existing content ticket.");
  const owner = acquireOwnership(root, taskKey(id));
  try {
    const current = readPrivateJson(root, movePath(id));
    if (!current.data) return null;
    const move = current.data as Move;
    if (move.from !== pathOf(id, ticketFolder(move.from)) || move.to !== pathOf(id, ticketFolder(move.to))) throw new Error("Recover only the selected content ticket.");
    readEvidence(root, move.authority);
    return finishMove(root, id, move, current.revision!);
  } finally { owner.release(); }
}

export function moveContentTicket(root: string, path: string, expected: string, to: BoardFolder, authority: FileEvidence,
  changes: Partial<Pick<ContentTicket, "dependencies" | "receipt" | "ready" | "attempts">> = {}) {
  const selected = readContentTicket(root, path), id = selected.ticket.id;
  const owner = acquireOwnership(root, taskKey(id));
  try {
    const current = readContentTicket(root, path);
    if (current.file.sha256 !== expected) throw new Error("Reload the selected content ticket before moving it.");
    const from = ticketFolder(path);
    const allowed = from === "Content Creation" ? ["Blocked", "Deferred", "Cancelled", "Applied"] :
      from === "Blocked" ? ["Content Creation", "Applied"] : ["Deferred", "Cancelled"].includes(from) ? ["Content Creation"] : [];
    if (!allowed.includes(to) || (to === "Applied" && !changes.receipt)) throw new Error("Use the content ticket's supported lifecycle transition.");
    readEvidence(root, authority);
    const destination = pathOf(id, to);
    if (fs.existsSync(privateTicket(root, destination))) throw new Error("The destination already exists. Preserve the selected ticket.");
    const next = { ...current.ticket, ...changes };
    if (to === "Content Creation" || to === "Applied") delete next.dependencies;
    const event = `content-${digest(JSON.stringify([id, path, expected, to]))}`;
    const attention = stageAttentionChange(root, `CONTENT-${id}`, event, to === "Blocked" && next.dependencies?.length ? {
      taskId: `CONTENT-${id}`, path: destination, ticketHash: digest(render(next)), state: "waiting",
      humanRequired: true, generation: event, kind: "decision", label: "Resolve the selected content task dependency",
      blockedAt: new Date().toISOString(), verifiedAt: new Date().toISOString(),
    } : null, true);
    const move: Move = { from: path, to: destination, original: expected, bytes: render(next).toString("base64"), event: attention!, authority };
    const prior = readPrivateJson(root, movePath(id));
    savePrivateJson(root, movePath(id), move, prior.revision);
    return finishMove(root, id, move, readPrivateJson(root, movePath(id)).revision!);
  } finally { owner.release(); }
}
