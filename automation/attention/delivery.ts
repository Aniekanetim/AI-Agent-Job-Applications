import { randomUUID } from "node:crypto";
import { attentionQueue } from "./queue.js";
import { loadAttentionPreferences, verifyReminderCapability } from "./preferences.js";
import { loadAttention, updateAttention } from "./state.js";
import { itemKey, safeText } from "./types.js";

/** Native host calls are deliberately outside this module. A local record is never a delivery receipt. */
export function prepareAttentionDelivery(root: string, now: string) {
  return updateAttention(root, s => {
    const queue = attentionQueue(root, now), p = loadAttentionPreferences(root).value;
    if (!queue.items.length) return { action: "quiet" as const, reason: queue.suppressed ?? "empty" };
    verifyReminderCapability(root, p.scheduleReference!);
    const window = `${p.scheduleReference}:${Math.floor(Date.parse(now) / (p.everyMinutes! * 60_000))}`;
    const uncertain = s.deliveries.find(d => ["prepared", "dispatched", "unknown"].includes(d.state));
    if (uncertain) return { action: "inspectDelivery" as const, id: uncertain.id, state: uncertain.state };
    if (s.deliveries.some(d => d.window === window)) return { action: "quiet" as const, reason: "windowHandled" };
    const item = queue.items[0], id = randomUUID();
    s.deliveries.push({ id, window, snapshot: queue.revision, itemKey: itemKey(item), state: "prepared", createdAt: now });
    return { action: "prepared" as const, id, idempotencyKey: id,
      message: queue.eligible === 1 ? `One recorded application needs your attention. ${item.label}.` : `${queue.eligible} recorded applications need your attention. ${item.label}.`,
      choices: ["Review next", "Browse waiting tasks", "Remind me later"], coverage: "partial" as const };
  });
}
/** Call immediately before the one native dispatch. Rechecks lifecycle, snooze and focus. */
export function authorizeAttentionDelivery(root: string, id: string, now: string) {
  return updateAttention(root, s => {
    const q = attentionQueue(root, now), p = loadAttentionPreferences(root).value;
    if (q.items.length) verifyReminderCapability(root, p.scheduleReference!);
    const d = s.deliveries.find(d => d.id === id);
    if (!d || d.state !== "prepared") throw new Error("Inspect the retained native delivery outcome before another dispatch.");
    if (!q.items.length || q.revision !== d.snapshot || itemKey(q.items[0]) !== d.itemKey) { d.state = "cancelled"; return { dispatch: false as const }; }
    d.state = "dispatched"; return { dispatch: true as const, idempotencyKey: d.id };
  });
}
export function observeAttentionDelivery(root: string, id: string, outcome: "delivered" | "notDelivered" | "unknown", reference: string) {
  if (!["delivered", "notDelivered", "unknown"].includes(outcome) || !safeText(reference, 300)) throw new Error("Record the actual native delivery observation.");
  return updateAttention(root, s => {
    const d = s.deliveries.find(d => d.id === id);
    if (!d || !["dispatched", "unknown"].includes(d.state)) throw new Error("Observe the same dispatched/uncertain delivery; never invent success.");
    d.state = outcome; d.reference = reference; return { state: d.state };
  });
}
export function recoverUnsentAttentionDelivery(root: string, id: string, reference: string) {
  if (!safeText(reference, 300)) throw new Error("Reference the actual uninvoked preparation review.");
  return updateAttention(root, s => {
    const d = s.deliveries.find(d => d.id === id);
    if (!d || d.state !== "prepared") throw new Error("Only an uninvoked preparation can be cancelled without a host outcome.");
    d.state = "cancelled"; d.reference = reference;
  });
}
export function attentionDeliveryStatus(root: string) { return loadAttention(root).state.deliveries.map(d => ({ id: d.id, state: d.state, createdAt: d.createdAt, reference: d.reference })); }
