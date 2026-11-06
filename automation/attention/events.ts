import type { ApplicationTask } from "../workflow/application-state.js";
import type { FileEvidence } from "../email/evidence.js";
import { digest } from "../email/evidence.js";
import { readPrivateJson } from "../workflow/private-json.js";
import { loadAttention, updateAttention, quarantineAttention, clearAttentionQuarantine } from "./state.js";
import { itemKey, validateItem, validateHumanAttention, time, type AttentionItem } from "./types.js";

/** The caller is already operating on this selected task. This function performs no task/context reads. */
export function attentionForTask(task: ApplicationTask, ticket: FileEvidence, observedAt: string): AttentionItem | null {
  if (!time(observedAt)) throw new Error("Use the actual lifecycle observation time.");
  if (!ticket.path.startsWith("Task Board/Blocked/") || !task.blocker || task.blocker.resolvedAt) return null;
  const captcha = task.captchaHandoffs?.find(h => h.state !== "resolved"), access = task.accessHandoffs?.find(h => h.state !== "resolved");
  const meta = task.blocker.attention ?? (captcha ? { humanRequired: true as const, generation: captcha.handoffId, kind: "captcha" as const, label: "Complete human verification for this application" } :
    access ? { humanRequired: true as const, generation: access.id, kind: "access" as const, label: "Restore access for this application" } : null);
  if (!meta) return null;
  validateHumanAttention(meta);
  if (meta.binding && (meta.binding.roleId !== (task.selectedRoleId ?? null) || meta.binding.contextPath !== task.blocker.contextPath)) throw new Error("Bind this human question to the existing selected role and blocker context.");
  // Whitelist metadata; never spread a whole blocker/task into the notification index.
  const item: AttentionItem = { humanRequired: true, generation: meta.generation, kind: meta.kind, label: meta.label,
    ...(meta.priority !== undefined ? { priority: meta.priority } : {}), ...(meta.deadline ? { deadline: meta.deadline } : {}),
    ...(meta.binding ? { binding: { id: meta.binding.id, step: meta.binding.step, substep: meta.binding.substep, roleId: meta.binding.roleId, contextPath: meta.binding.contextPath, field: meta.binding.field } } : {}), taskId: task.taskId, path: ticket.path,
    blockedAt: captcha?.detectedAt ?? access?.detectedAt ?? observedAt, verifiedAt: observedAt, ticketHash: ticket.sha256, state: "waiting" };
  validateItem(item); return item;
}
/** Stage before a lifecycle mutation. A staged event suppresses every generation for this task. */
export function stageAttentionChange(root: string, taskId: string, id: string, item: AttentionItem | null, force = false, requestReference?: string): string | null {
  if (item) { validateItem(item); if (item.taskId !== taskId) throw new Error("Keep the existing task identity."); }
  try {
    if (!force && !item && !readPrivateJson(root, ".local/attention-state.json").data) return null;
    return updateAttention(root, s => {
      const old = s.events.find(e => e.id === id);
      if (old) { if (old.taskId !== taskId || (old.item ? itemKey(old.item) : null) !== (item ? itemKey(item) : null)) throw new Error("Preserve this lifecycle event identity."); return id; }
      if (!force && !item && !s.items.some(i => i.taskId === taskId && i.state !== "retired")) return null;
      s.events.push({ id, taskId, sequence: s.revision + 1, state: "staged", item: item && structuredClone(item), ...(requestReference ? { requestReference } : {}) }); return id;
    });
  } catch { quarantineAttention(root, id, taskId); return id; }
}
/** Promote only after the core lifecycle commit. Failures retain suppression and never undo application results. */
export function commitAttentionChange(root: string, id: string | null, receipt: string) {
  if (!id) return { attention: "unchanged" as const };
  try {
    if (!receipt.trim()) throw new Error("Supply actual committed lifecycle evidence.");
    updateAttention(root, s => {
      const event = s.events.find(e => e.id === id);
      if (!event) throw new Error("Recover the missing staged event from the selected committed task.");
      if (event.state === "committed") { if (event.receipt !== receipt) throw new Error("Preserve the original commit receipt."); return; }
      const newer = s.events.some(e => e.taskId === event.taskId && e.sequence > event.sequence);
      event.state = "committed"; event.receipt = receipt;
      if (newer) return; // A late earlier block cannot revive a newer lifecycle decision.
      for (const old of s.items.filter(i => i.taskId === event.taskId && i.state !== "retired")) {
        if (event.item && itemKey(old) === itemKey(event.item)) continue;
        old.state = "retired"; old.retiredBy = id;
      }
      if (event.item) {
        const previous = s.items.find(i => itemKey(i) === itemKey(event.item!));
        if (!previous) s.items.push(structuredClone(event.item));
        else if (previous.state !== "retired") { // Same generation does not reset snooze/input history or age.
          if (previous.kind !== event.item.kind || JSON.stringify(previous.binding) !== JSON.stringify(event.item.binding)) throw new Error("A different question or role needs an actual renewed blocker generation.");
          previous.label = event.item.label; previous.priority = event.item.priority; previous.deadline = event.item.deadline;
          previous.ticketHash = event.item.ticketHash; previous.path = event.item.path; previous.verifiedAt = event.item.verifiedAt;
        }
      }
    });
    clearAttentionQuarantine(root, id); return { attention: "synced" as const };
  } catch { try { quarantineAttention(root, id); } catch { /* The durable staged suppression still prevents delivery. */ } return { attention: "pendingRepair" as const }; }
}
export const lifecycleEventId = (taskId: string, path: string, hash: string) => `lifecycle-${digest(JSON.stringify([taskId, path, hash]))}`;
export function stageTaskAttention(root: string, task: ApplicationTask, ticket: FileEvidence, observedAt = new Date().toISOString()) {
  const id = lifecycleEventId(task.taskId, ticket.path, `${ticket.sha256}:${task.blocker?.attention?.generation ?? task.captchaHandoffs?.at(-1)?.handoffId ?? task.accessHandoffs?.at(-1)?.id ?? ""}`);
  try { return stageAttentionChange(root, task.taskId, id, attentionForTask(task, ticket, observedAt)); }
  catch { quarantineAttention(root, id, task.taskId); return id; }
}
/** Explicit repair inspects only the caller-selected task through its existing workflow helper, never a backlog scan. */
export function attentionRepairStatus(root: string) { const s = loadAttention(root).state; return { coverage: s.coverage, pending: s.events.filter(e => e.state === "staged").map(e => ({ id: e.id, taskId: e.taskId })) }; }
