import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { assertTaskMove, canMarkApplied, type ApplicationTask } from "../workflow/application-state.js";
import { validateDecision, readDecisionSnapshot, type TaskDecision } from "../workflow/board.js";
import { loadTaskControl } from "../workflow/task-control.js";
import { alertWorkComplete, messageKey, type EmailRecord } from "./intake.js";
import { digest, readEvidence, type FileEvidence } from "./evidence.js";
import { postingUrl, verifyInventory } from "./inventory.js";

export interface BoundApplication {
  schemaVersion: 1;
  messageKey: string;
  vacancyKey: string;
  postingUrl: string;
  task: ApplicationTask;
  confirmationEvidence: FileEvidence;
}
export interface VacancyOutcome {
  schemaVersion: 1 | 2;
  messageKey: string;
  vacancyKey: string;
  postingUrl: string;
  kind: "applied" | "notApplicable" | "cancelled";
  observedAt: string;
  taskId?: string;
  confirmationReference?: string;
  evidence?: FileEvidence;
  reason?: string;
  instruction?: FileEvidence;
  task?: ApplicationTask;
  decision?: TaskDecision;
  ticketSnapshot?: FileEvidence;
  cleanupAuthority?: FileEvidence;
}
const marker = "<!-- job-application-record -->";
export function taskRecordBlock(record: BoundApplication): string { return `${marker}\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\``; }
export function readTaskRecord(bytes: Buffer): BoundApplication {
  const body = bytes.toString("utf8"), parts = body.split(marker);
  if (parts.length !== 2) throw new Error("The Applied ticket needs exactly one structured job-application record.");
  const match = /^\s*```json\s*\n([\s\S]*?)\n```/.exec(parts[1]);
  if (!match) throw new Error("Preserve and reconcile the Applied ticket's structured record before cleanup.");
  return JSON.parse(match[1]);
}
function actualPath(root: string, ref: FileEvidence) { const path = realpathSync(resolve(root, ref.path)); return process.platform === "win32" ? path.toLowerCase() : path; }
export function verifyAlertCompletion(root: string, record: EmailRecord): { digest: string; vacancies: number; applied: number; excluded: number; cancelled: number } {
  if (!alertWorkComplete(record) || !record.inventory) throw new Error("The alert has unresolved work or lacks a reconciled source inventory.");
  const key = messageKey(record.identity), jobs = verifyInventory(root, record.inventory, key);
  if (jobs.size !== record.vacancies.length) throw new Error("Every source posting must have exactly one outcome.");
  const tasks = new Set<string>(), receipts = new Set<string>(), rawEvidence = new Set<string>(), proofHashes = new Set<string>(), references = new Set<string>();
  let applied = 0, excluded = 0, cancelled = 0;
  for (const vacancy of record.vacancies) {
    if (jobs.get(vacancy.vacancyKey) !== postingUrl(vacancy.postingUrl!)) throw new Error("The posting and its saved outcome identity do not agree.");
    const outcome = JSON.parse(readEvidence(root, vacancy.outcomeEvidence!).toString("utf8")) as VacancyOutcome;
    const receipt = actualPath(root, vacancy.outcomeEvidence!);
    if (receipts.has(receipt)) throw new Error("Different vacancies cannot reuse one outcome artifact."); receipts.add(receipt);
    if (outcome.schemaVersion !== (outcome.kind === "cancelled" ? 2 : 1) || outcome.messageKey !== key || outcome.vacancyKey !== vacancy.vacancyKey ||
      postingUrl(outcome.postingUrl) !== jobs.get(vacancy.vacancyKey) || !Number.isFinite(Date.parse(outcome.observedAt)) || outcome.kind !== vacancy.disposition) throw new Error("The outcome artifact belongs to a different vacancy, message or disposition.");
    if (outcome.kind === "applied") {
      const task = readTaskRecord(readEvidence(root, vacancy.taskEvidence!));
      const path = actualPath(root, vacancy.taskEvidence!);
      if (tasks.has(path)) throw new Error("Different vacancies cannot reuse one Applied ticket."); tasks.add(path);
      if (task.schemaVersion !== 1 || task.messageKey !== key || task.vacancyKey !== vacancy.vacancyKey || postingUrl(task.postingUrl) !== jobs.get(vacancy.vacancyKey) ||
        !canMarkApplied(task.task) || task.task.taskId !== vacancy.taskId || task.task.originalIntake !== "Email Alerts" ||
        outcome.taskId !== task.task.taskId || outcome.confirmationReference !== vacancy.confirmationReference ||
        outcome.confirmationReference !== task.task.confirmation?.reference || outcome.observedAt !== task.task.confirmation?.observedAt ||
        !outcome.evidence || JSON.stringify(task.confirmationEvidence) !== JSON.stringify(outcome.evidence)) throw new Error("Verify the actual job-specific task, confirmation and evidence before cleanup.");
      readEvidence(root, outcome.evidence);
      const proof = actualPath(root, outcome.evidence);
      if (rawEvidence.has(proof) || proofHashes.has(outcome.evidence.sha256) || references.has(outcome.confirmationReference!)) throw new Error("Different vacancies need their own job-specific confirmation observation and reference.");
      rawEvidence.add(proof); proofHashes.add(outcome.evidence.sha256); references.add(outcome.confirmationReference!);
      applied++;
    } else if (outcome.kind === "notApplicable") {
      if (!outcome.reason?.trim() || outcome.reason !== vacancy.nonapplicationReason || !outcome.instruction || outcome.instruction.path !== vacancy.instructionReference) throw new Error("An excluded vacancy needs its actual reason and matching saved user instruction.");
      readEvidence(root, outcome.instruction); excluded++;
    } else if (outcome.kind === "cancelled") {
      const d = outcome.decision;
      validateDecision(d!);
      if (!outcome.task || !d || d.action !== "cancel" || outcome.taskId !== vacancy.taskId || outcome.task.taskId !== vacancy.taskId ||
        outcome.observedAt !== d.observedAt || JSON.stringify(d) !== JSON.stringify(vacancy.decision) ||
        !outcome.ticketSnapshot || outcome.ticketSnapshot.sha256 !== vacancy.taskEvidence?.sha256 ||
        !outcome.cleanupAuthority || JSON.stringify(outcome.cleanupAuthority) !== JSON.stringify(vacancy.cancellationCleanupAuthority)) throw new Error("Verify the exact cancelled task, decision, snapshot and cleanup authority.");
      if (loadTaskControl(root, outcome.taskId!).data?.transition) throw new Error("Recover the task move before cleaning up its source.");
      assertTaskMove(outcome.task, d.from, "Cancelled", d);
      const snapshot = readDecisionSnapshot(readEvidence(root, outcome.ticketSnapshot));
      if (snapshot.taskId !== vacancy.taskId || snapshot.messageKey !== key || snapshot.vacancyKey !== vacancy.vacancyKey ||
        JSON.stringify(snapshot.decision) !== JSON.stringify(d) || JSON.stringify(snapshot.task) !== JSON.stringify(outcome.task) || proofHashes.has(outcome.ticketSnapshot.sha256)) throw new Error("Different vacancies need their own source-bound cancellation snapshot.");
      proofHashes.add(outcome.ticketSnapshot.sha256);
      readEvidence(root, d.authority); readEvidence(root, outcome.cleanupAuthority);
      if (outcome.task.submissionResolution) readEvidence(root, outcome.task.submissionResolution.evidence);
      cancelled++;
    } else {
      throw new Error("An unresolved or unknown outcome cannot authorize email cleanup.");
    }
  }
  return { digest: digest(JSON.stringify(record)), vacancies: jobs.size, applied, excluded, cancelled };
}
