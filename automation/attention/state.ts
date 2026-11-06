import { savePrivateJson } from "../workflow/private-json.js";
import { readAttentionMetadata as readPrivateJson } from "./metadata.js";
import { withWriteOwnership } from "../workflow/ownership.js";
import { itemKey, validateItem, safeText, time, type AttentionState, type AttentionItem } from "./types.js";

export const attentionFile = ".local/attention-state.json";
export const healthFile = ".local/attention-health.json";
export const emptyAttention = (): AttentionState => ({ schemaVersion: 1, coverage: "partial", revision: 0, items: [], events: [], deliveries: [] });
export function loadAttention(root: string) {
  const loaded = readPrivateJson(root, attentionFile), state = (loaded.data ?? emptyAttention()) as AttentionState;
  if (state.schemaVersion !== 1 || state.coverage !== "partial" || !Number.isInteger(state.revision) ||
    !Array.isArray(state.items) || !Array.isArray(state.events) || !Array.isArray(state.deliveries)) throw new Error("Preserve the attention index and repair its metadata before reminders.");
  const keys = new Set<string>(), active = new Set<string>(), events = new Set<string>(), deliveries = new Set<string>();
  for (const item of state.items) {
    validateItem(item); const key = itemKey(item);
    if (keys.has(key) || item.state !== "retired" && active.has(item.taskId)) throw new Error("Reconcile duplicate attention identities.");
    keys.add(key); if (item.state !== "retired") active.add(item.taskId);
  }
  for (const event of state.events) {
    if (!safeText(event.id, 180) || events.has(event.id) || !safeText(event.taskId, 150) || !Number.isInteger(event.sequence) || event.sequence < 1 || event.sequence > state.revision ||
      !["staged", "committed"].includes(event.state) || event.state === "committed" && (typeof event.receipt !== "string" || !event.receipt.trim())) throw new Error("Preserve incomplete attention events.");
    events.add(event.id); if (event.item) { validateItem(event.item); if (event.item.taskId !== event.taskId) throw new Error("Preserve event/task identity."); }
  }
  for (const delivery of state.deliveries) {
    if (!safeText(delivery.id, 100) || deliveries.has(delivery.id) || !safeText(delivery.window, 300) || !/^[a-f0-9]{64}$/.test(delivery.snapshot) ||
      typeof delivery.itemKey !== "string" || !time(delivery.createdAt) || !["prepared", "dispatched", "delivered", "unknown", "notDelivered", "cancelled"].includes(delivery.state) ||
      ["delivered", "unknown", "notDelivered"].includes(delivery.state) && !safeText(delivery.reference, 300)) throw new Error("Inspect incomplete native delivery metadata before another notification.");
    deliveries.add(delivery.id);
  }
  return { state, revision: loaded.revision };
}
export function updateAttention<T>(root: string, run: (state: AttentionState) => T): T {
  return withWriteOwnership(root, "attention-index", () => {
    const loaded = loadAttention(root), next = structuredClone(loaded.state), result = run(next);
    if (JSON.stringify(next) !== JSON.stringify(loaded.state)) { next.revision++; savePrivateJson(root, attentionFile, next, loaded.revision); }
    return result;
  });
}
/** Separate durable quarantine: a damaged projection must not block a confirmed application outcome. */
export function quarantineAttention(root: string, eventId: string, taskId?: string) {
  withWriteOwnership(root, "attention-health", () => {
    const loaded = readPrivateJson(root, healthFile), old = loaded.data as { pending: { id: string; taskId?: string }[] } | null;
    if (old && !Array.isArray(old.pending)) throw new Error("Preserve damaged attention quarantine metadata.");
    const pending = [...(old?.pending ?? [])];
    const existing = pending.find(e => e.id === eventId);
    if (!existing) pending.push({ id: eventId, ...(taskId ? { taskId } : {}) });
    else if (taskId) existing.taskId = taskId;
    savePrivateJson(root, healthFile, { schemaVersion: 1, pending }, loaded.revision);
  });
}
export function attentionHealthy(root: string) { const health = readPrivateJson(root, healthFile).data as { schemaVersion?: number; pending?: unknown[] } | null; return !health || health.schemaVersion === 1 && Array.isArray(health.pending) && !health.pending.length; }
export function clearAttentionQuarantine(root: string, eventId: string) {
  withWriteOwnership(root, "attention-health", () => {
    const loaded = readPrivateJson(root, healthFile), health = loaded.data as { schemaVersion: number; pending: { id: string; taskId?: string }[] } | null;
    if (!health) return;
    if (health.schemaVersion !== 1 || !Array.isArray(health.pending)) throw new Error("Repair the retained quarantine first.");
    savePrivateJson(root, healthFile, { ...health, pending: health.pending.filter(e => e.id !== eventId) }, loaded.revision);
  });
}
export function markInputRecorded(root: string, key: string) {
  return updateAttention(root, s => { const item = s.items.find(i => itemKey(i) === key); if (!item) throw new Error("Reconcile this selected attention item first."); if (item.state !== "retired") item.state = "inputRecorded"; });
}
export function sameGeneration(a: AttentionItem, b: AttentionItem) { return itemKey(a) === itemKey(b); }
