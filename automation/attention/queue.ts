import fs from "node:fs";
import { resolve, basename } from "node:path";
import { digest } from "../email/evidence.js";
import { loadAttention, attentionHealthy } from "./state.js";
import { loadAttentionPreferences } from "./preferences.js";
import { hasAttentionFocus, otherConversationFocus } from "./session-state.js";
import { itemKey, time, type AttentionKind, type AttentionItem } from "./types.js";
import { listContentTickets, registeredContentTicketId } from "../workflow/intake.js";

/** Metadata-only To Do listing. Never stat/read the former Blocked path or execution mirror. */
export function queuedNames(root: string): Set<string> {
  const directory = resolve(root, "Task Board/To Do");
  for (const path of [resolve(root, "Task Board"), directory]) {
    try { const info = fs.lstatSync(path); if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Reminder intake metadata cannot link to inactive task folders."); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set(); throw error; }
  }
  return new Set(fs.readdirSync(directory, { withFileTypes: true }).filter(e => e.isFile() && e.name.endsWith(".md")).map(e => e.name.toLowerCase()));
}
export function attentionQueue(root: string, now: string, options: { explicit?: boolean; kind?: AttentionKind } = {}) {
  if (!time(now)) throw new Error("Use the actual reminder observation time.");
  const { state } = loadAttention(root), p = loadAttentionPreferences(root).value, moved = queuedNames(root);
  if (state.items.some(item => item.state !== "retired" && registeredContentTicketId(root, basename(item.path)) === item.taskId)) {
    for (const ticket of listContentTickets(root)) moved.add(ticket.name.toLowerCase());
  }
  const pending = new Set(state.events.filter(e => e.state === "staged").map(e => e.taskId));
  const recorded = state.items.filter(i => i.state !== "retired"), waiting = recorded.filter(i => i.state === "waiting");
  const candidates = waiting.filter(i => !pending.has(i.taskId) && !moved.has(basename(i.path).toLowerCase()) && !p.muted.includes(itemKey(i)) && (!options.kind || i.kind === options.kind));
  candidates.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (a.deadline ? Date.parse(a.deadline) : Infinity) - (b.deadline ? Date.parse(b.deadline) : Infinity) ||
    Date.parse(a.blockedAt) - Date.parse(b.blockedAt) || a.taskId.localeCompare(b.taskId));
  const suppressed = !attentionHealthy(root) ? "repair" : options.explicit ? null :
    p.paused ? "paused" : p.snoozedUntil && Date.parse(p.snoozedUntil) > Date.parse(now) ? "snoozed" :
      otherConversationFocus(root) || hasAttentionFocus(root) ? "conversation" : p.mode !== "recurring" ? "manual" : null;
  const eligible = suppressed ? [] : candidates;
  return { coverage: "partial" as const, recorded: recorded.length, waiting: waiting.length, eligible: eligible.length,
    suppressed, items: eligible, revision: digest(JSON.stringify([state.items, state.events, p, moved.size ? [...moved].sort() : []])), timezone: p.timezone };
}
function preview(i: AttentionItem) { return { key: itemKey(i), taskId: i.taskId, kind: i.kind, label: i.label, verifiedAt: i.verifiedAt }; }
export function nextAttention(root: string, now: string, explicit = false) {
  const q = attentionQueue(root, now, { explicit });
  return { coverage: q.coverage, recorded: q.recorded, eligible: q.eligible, suppressed: q.suppressed,
    preview: q.items[0] ? preview(q.items[0]) : null, choices: q.items.length ? ["Review next", "Browse waiting tasks", "Remind me later"] : [],
    note: "Counts cover recorded items; older Blocked tasks have not been scanned." };
}
export function browseAttention(root: string, now: string, page = 1, kind?: AttentionKind) {
  if (!Number.isInteger(page) || page < 1) throw new Error("Choose a positive page number.");
  const q = attentionQueue(root, now, { explicit: true, kind });
  return { coverage: q.coverage, recorded: q.recorded, eligible: q.eligible, page, pageSize: 10, pages: Math.ceil(q.items.length / 10),
    rows: q.items.slice((page - 1) * 10, page * 10).map(preview), suppressed: q.suppressed };
}
