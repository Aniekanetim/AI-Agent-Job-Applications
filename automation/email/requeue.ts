import { readFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { loadInboxState, saveEmailRecord } from "./state-store.js";
import { digest, evidenceFile, type FileEvidence } from "./evidence.js";
import { messageKey, terminalCleanup } from "./intake.js";
import { loadTaskControl, resumeMovedDeferredTask } from "../workflow/task-control.js";
import { stageAttentionChange, commitAttentionChange, lifecycleEventId } from "../attention/events.js";

/** Called for a selected To Do file, never by scanning Blocked for changes. */
export function requeueMovedEmailTicket(root: string, path: string, observedAt: string) {
  if (!/^Task Board\/To Do\/[^/\\]+\.md$/.test(path) || !Number.isFinite(Date.parse(observedAt))) {
    throw new Error("Select the actual existing To Do ticket and observation time.");
  }
  const ticket = evidenceFile(root, path); // Verifies this selected file is private.
  const loaded = loadInboxState(root);
  const matches = loaded.state.messages.flatMap(record => record.vacancies
    .filter(v => ["Task Board/Blocked/", "Task Board/Deferred/", "Task Board/Cancelled/"].some(prefix => v.taskPath?.startsWith(prefix)) && basename(v.taskPath!) === basename(path))
    .map(vacancy => ({ record, vacancy })));
  if (!matches.length) return { kind: "notMovedEmailTicket" as const };
  if (matches.length !== 1) throw new Error("Ambiguous source binding; inspect this selected ticket before resuming.");
  const { record, vacancy } = matches[0]!;
  if (vacancy.disposition === "cancelled") {
    const control = vacancy.taskId && loadTaskControl(root, vacancy.taskId).data;
    if (control && control.source?.completed && terminalCleanup(record) && messageKey(control.source.identity) === messageKey(record.identity) && control.source.vacancyKey === vacancy.vacancyKey && control.history.some(d => d.action === "restore")) {
      if (control.path.startsWith("Task Board/Deferred/")) {
        const moved = resumeMovedDeferredTask(root, control.task, path, observedAt);
        return { ...moved, kind: "requeued" as const, messageKey: messageKey(record.identity), vacancyKey: vacancy.vacancyKey, dependencyVerified: false };
      }
      if (control.path === path) return { kind: "restoredSourceAlreadyHandled" as const, taskId: vacancy.taskId, path };
    }
    throw new Error("Explicitly restore this Cancelled task; a file move alone does not authorize reactivation.");
  }
  if (vacancy.disposition === "deferred") {
    const control = vacancy.taskId && loadTaskControl(root, vacancy.taskId).data;
    if (!control || control.path !== vacancy.taskPath || control.ticket.sha256 !== ticket.sha256) throw new Error("Review this moved or edited Deferred ticket and its existing control before resuming.");
    const moved = resumeMovedDeferredTask(root, control.task, path, observedAt);
    return { ...moved, kind: "requeued" as const, messageKey: messageKey(record.identity), vacancyKey: vacancy.vacancyKey, dependencyVerified: false };
  }
  if (record.cleanupState !== "notReady" || vacancy.disposition !== "blocked" || !vacancy.taskId || !vacancy.taskEvidence) {
    throw new Error("Preserve cleanup/confirmation ownership before requeuing this task.");
  }
  if (ticket.sha256 !== vacancy.taskEvidence.sha256 || digest(readFileSync(resolve(root, path))) !== ticket.sha256) {
    throw new Error("The moved ticket was also edited; review this selected To Do ticket and reconcile its source binding explicitly.");
  }
  const previousPath = vacancy.taskPath!;
  const previousEvidence: FileEvidence = vacancy.taskEvidence;
  const attention = stageAttentionChange(root, vacancy.taskId, lifecycleEventId(vacancy.taskId, path, ticket.sha256), null);
  // Keep the same message, vacancy, task, state, original source and uncertainty.
  // The agent reads only this queued task's saved state/context before resuming.
  vacancy.taskPath = path;
  vacancy.taskEvidence = ticket;
  vacancy.disposition = "pending";
  const history = (vacancy as typeof vacancy & { requeueHistory?: unknown[] });
  history.requeueHistory = [...(history.requeueHistory ?? []), { previousPath, previousEvidence, path, observedAt,
    reason: "Existing ticket moved to To Do by the user; dependency clearance still requires verification." }];
  saveEmailRecord(root, record, loaded.revision);
  commitAttentionChange(root, attention, `${ticket.path}:${ticket.sha256}`);
  return { kind: "requeued" as const, messageKey: messageKey(record.identity), vacancyKey: vacancy.vacancyKey,
    taskId: vacancy.taskId, path, dependencyVerified: false };
}
