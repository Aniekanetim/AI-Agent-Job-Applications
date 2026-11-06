import type { Decision } from "../onboarding/conversation-types.js";
import { validateDecision } from "../onboarding/conversation-types.js";

export const attentionKinds = ["answer", "document", "decision", "login", "captcha", "access"] as const;
export type AttentionKind = typeof attentionKinds[number];
/** Explicit human responsibility, never inferred from an arbitrary tool error. No answers or browser data. */
export interface HumanAttention {
  humanRequired: true; generation: string; kind: AttentionKind; label: string;
  priority?: number; deadline?: string; binding?: Decision;
}
export interface AttentionItem extends HumanAttention {
  taskId: string; path: string; blockedAt: string; verifiedAt: string; ticketHash: string;
  state: "waiting" | "inputRecorded" | "retired"; retiredBy?: string;
}
export interface AttentionEvent {
  id: string; taskId: string; sequence: number; state: "staged" | "committed";
  item: AttentionItem | null; receipt?: string;
  requestReference?: string;
}
export interface Delivery {
  id: string; window: string; snapshot: string; itemKey: string;
  state: "prepared" | "dispatched" | "delivered" | "unknown" | "notDelivered" | "cancelled";
  createdAt: string; reference?: string;
}
export interface AttentionState {
  schemaVersion: 1; coverage: "partial"; revision: number;
  items: AttentionItem[]; events: AttentionEvent[]; deliveries: Delivery[];
}
export const itemKey = (item: Pick<AttentionItem, "taskId" | "generation">) => JSON.stringify([item.taskId, item.generation]);
export const time = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
export function safeText(value: unknown, max = 140): value is string {
  return typeof value === "string" && !!value.trim() && value.length <= max &&
    !/[\r\n\u0000-\u001f]|https?:|\S+@\S+|Bearer\s|password\s*[:=]|secret\s*[:=]|token\s*[:=]|api.?key\s*[:=]/i.test(value);
}
export function validateHumanAttention(value: unknown): asserts value is HumanAttention {
  const v = value as HumanAttention;
  if (!v || v.humanRequired !== true || !safeText(v.generation, 100) || !safeText(v.label) || !attentionKinds.includes(v.kind) ||
    v.priority !== undefined && (!Number.isInteger(v.priority) || Math.abs(v.priority) > 1000) || v.deadline !== undefined && !time(v.deadline))
    throw new Error("Record a stable human-required blocker generation and a short nonsecret action label.");
  if (v.binding) {
    validateDecision(v.binding);
    if (!v.binding.contextPath.endsWith(".local.md") || v.binding.contextPath.includes("..") || v.binding.contextPath.includes("\\") ||
      !v.binding.contextPath.startsWith("Job Context/")) throw new Error("Use an existing private canonical context binding.");
  }
}
export function validateItem(value: unknown): asserts value is AttentionItem {
  validateHumanAttention(value); const v = value as AttentionItem;
  if (!safeText(v.taskId, 150) || !/^Task Board\/Blocked\/[^/\\]+\.md$/.test(v.path) || !time(v.blockedAt) || !time(v.verifiedAt) ||
    !/^[a-f0-9]{64}$/.test(v.ticketHash) || !["waiting", "inputRecorded", "retired"].includes(v.state)) throw new Error("Preserve the verified selected Blocked-task reference.");
}
