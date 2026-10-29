import { readFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { loadInboxState, saveEmailRecord } from "./state-store.js";
import { digest, evidenceFile, type FileEvidence } from "./evidence.js";
import { messageKey } from "./intake.js";

/** Called for a selected To Do file, never by scanning Blocked for changes. */
export function requeueMovedEmailTicket(root: string, path: string, observedAt: string) {
  if (!/^Task Board\/To Do\/[^/\\]+\.md$/.test(path) || !Number.isFinite(Date.parse(observedAt))) {
    throw new Error("Select the actual existing To Do ticket and observation time.");
  }
  const ticket = evidenceFile(root, path); // Verifies this selected file is private.
  const loaded = loadInboxState(root);
  const matches = loaded.state.messages.flatMap(record => record.vacancies
    .filter(v => v.taskPath?.startsWith("Task Board/Blocked/") && basename(v.taskPath) === basename(path))
    .map(vacancy => ({ record, vacancy })));
  if (!matches.length) return { kind: "notMovedEmailTicket" as const };
  if (matches.length !== 1) throw new Error("Ambiguous source binding; inspect this selected ticket before resuming.");
  const { record, vacancy } = matches[0]!;
  if (record.cleanupState !== "notReady" || vacancy.disposition !== "blocked" || !vacancy.taskId || !vacancy.taskEvidence) {
    throw new Error("Preserve cleanup/confirmation ownership before requeuing this task.");
  }
  if (ticket.sha256 !== vacancy.taskEvidence.sha256 || digest(readFileSync(resolve(root, path))) !== ticket.sha256) {
    throw new Error("The moved ticket was also edited; review this selected To Do ticket and reconcile its source binding explicitly.");
  }
  const previousPath = vacancy.taskPath!;
  const previousEvidence: FileEvidence = vacancy.taskEvidence;
  // Keep the same message, vacancy, task, state, original source and uncertainty.
  // The agent reads only this queued task's saved state/context before resuming.
  vacancy.taskPath = path;
  vacancy.taskEvidence = ticket;
  vacancy.disposition = "pending";
  const history = (vacancy as typeof vacancy & { requeueHistory?: unknown[] });
  history.requeueHistory = [...(history.requeueHistory ?? []), { previousPath, previousEvidence, path, observedAt,
    reason: "Existing ticket moved to To Do by the user; dependency clearance still requires verification." }];
  saveEmailRecord(root, record, loaded.revision);
  return { kind: "requeued" as const, messageKey: messageKey(record.identity), vacancyKey: vacancy.vacancyKey,
    taskId: vacancy.taskId, path, dependencyVerified: false };
}
