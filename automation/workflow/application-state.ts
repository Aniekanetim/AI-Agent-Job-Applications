import type { BrowserExecution } from "../browser/fallback.js";
import type { CaptchaHandoff } from "../browser/captcha.js";
import type { AccessHandoff } from "../sites/access-handoff.js";
import { assertSiteAction, type SiteExecution, type SitePage } from "../sites/execution.js";
import { inventoryPostings, postingUrl, type AlertInventory } from "../email/inventory-shape.js";
import type { FileEvidence } from "../email/evidence.js";
/** Local integrity checks; these do not establish that external evidence is true. */
export type IntakeFolder = "Email Alerts" | "To Do";
export type BoardFolder = IntakeFolder | "Blocked" | "Applied";

export interface Blocker {
  kind?: "captcha" | "siteAccess";
  reason: string;
  lastCompletedStep: string;
  contextPath: string;
  nextAction: string;
  resumeCheckpoint: string;
  resolvedAt?: string;
  resolutionEvidence?: string;
}

export interface ApplicationTask {
  taskId: string;
  originalIntake: IntakeFolder;
  selectedRoleId?: string;
  cvVersion?: string;
  cvSha256?: string;
  checkpoint: "working" | "prepared" | "submissionAttempted" | "confirmed";
  confirmation?: { reference: string; observedAt: string };
  blocker?: Blocker;
  browserExecution?: BrowserExecution;
  captchaHandoffs?: CaptchaHandoff[];
  siteExecution?: SiteExecution;
  siteHistory?: SiteExecution[];
  accessHandoffs?: AccessHandoff[];
}

export interface VacancyProgress {
  vacancyKey: string;
  disposition: "pending" | "blocked" | "applied" | "notApplicable";
  taskId?: string | null;
  taskPath?: string | null;
  confirmationReference?: string | null;
  applicationRecordSaved?: boolean;
  nonapplicationReason?: string | null;
  instructionReference?: string | null;
  postingUrl?: string;
  taskEvidence?: FileEvidence;
  outcomeEvidence?: FileEvidence;
}

export interface MessageProgress {
  inboxId: string;
  messageId: string;
  enumerationComplete: boolean;
  cleanupState: "notReady" | "cleanupPending" | "deleted";
  vacancies: VacancyProgress[];
  inventory?: AlertInventory;
}

const supplied = (value: string | null | undefined): boolean =>
  typeof value === "string" && value.trim().length > 0;

const validTime = (value: string | undefined): boolean =>
  supplied(value) && Number.isFinite(Date.parse(value!));

export function canMarkApplied(task: ApplicationTask): boolean {
  return supplied(task.taskId) && task.checkpoint === "confirmed" &&
    !task.accessHandoffs?.some(handoff => handoff.state !== "resolved") &&
    !task.captchaHandoffs?.some(handoff => handoff.state !== "resolved") &&
    (!task.blocker || validTime(task.blocker.resolvedAt) && supplied(task.blocker.resolutionEvidence)) &&
    !task.browserExecution?.handoffs.some(handoff => handoff.state === "awaitingResume") &&
    supplied(task.selectedRoleId) && supplied(task.cvVersion) &&
    /^[a-f0-9]{64}$/i.test(task.cvSha256 ?? "") &&
    supplied(task.confirmation?.reference) && validTime(task.confirmation?.observedAt);
}

export function assertTaskMove(
  task: ApplicationTask, from: BoardFolder, to: BoardFolder,
): void {
  if (from === "Applied") throw new Error("An Applied task is not active intake.");
  if (from !== "Blocked" && from !== task.originalIntake) {
    throw new Error("The task must remain associated with its original intake.");
  }
  if (to === "Blocked") {
    if (from === "Blocked") throw new Error("An unchanged blocker needs no move.");
    const b = task.blocker;
    if (!b || ![b.reason, b.lastCompletedStep, b.contextPath, b.nextAction,
      b.resumeCheckpoint].every(supplied)) {
      throw new Error("Blocked requires a specific dependency and resumption details.");
    }
    return;
  }
  if (from === "Blocked") {
    if (to !== task.originalIntake || !validTime(task.blocker?.resolvedAt) ||
      task.accessHandoffs?.some(handoff => handoff.state !== "resolved") ||
      task.captchaHandoffs?.some(handoff => handoff.state !== "resolved") ||
      !supplied(task.blocker?.resolutionEvidence)) {
      throw new Error("Resolve the actual dependency and return to original intake.");
    }
    return;
  }
  if (to !== "Applied" || !canMarkApplied(task)) {
    throw new Error("Applied requires a confirmed outcome and selected role/CV identity.");
  }
}

/** Persist this result before the one final browser action; an attempted action is not success. */
export function markSubmissionAttempted(task: ApplicationTask, root?: string, currentPage?: SitePage): ApplicationTask {
  if (!supplied(task.taskId) || task.checkpoint !== "prepared" || !supplied(task.selectedRoleId) || !supplied(task.cvVersion) ||
    !/^[a-f0-9]{64}$/i.test(task.cvSha256 ?? "") ||
    task.captchaHandoffs?.some(handoff => handoff.state !== "resolved") ||
    task.accessHandoffs?.some(handoff => handoff.state !== "resolved") ||
    task.browserExecution?.handoffs.some(handoff => handoff.state === "awaitingResume") ||
    task.blocker && (!validTime(task.blocker.resolvedAt) || !supplied(task.blocker.resolutionEvidence))) {
    throw new Error("Review and prepare this application with all dependencies resolved before submitting once.");
  }
  if (!root || !currentPage) throw new Error("Inspect the current page and validate its registered site context before a new submission attempt. Historical confirmed records remain intact.");
  assertSiteAction(root, task, currentPage, "submit");
  return { ...structuredClone(task), checkpoint: "submissionAttempted" };
}

function isAppliedRecord(path: string | null | undefined): boolean {
  if (!supplied(path)) return false;
  const parts = path!.replaceAll("\\", "/").split("/");
  return parts.length === 3 && parts[0] === "Task Board" && parts[1] === "Applied" &&
    parts[2] !== ".md" && parts[2].endsWith(".md") &&
    !parts[2].includes(":") && !parts.some(p => p === ".." || p === "." || p === "");
}

export function messageReadyForDeletion(message: MessageProgress): boolean {
  if (!supplied(message.inboxId) || !supplied(message.messageId) ||
    !message.enumerationComplete || message.vacancies.length === 0) return false;
  const keys = message.vacancies.map(v => v.vacancyKey);
  if (keys.some(key => !supplied(key)) || new Set(keys).size !== keys.length) return false;
  const postings = inventoryPostings(message.inventory);
  if (!postings || postings.size !== keys.length || keys.some(key => !postings.has(key))) return false;
  const taskIds = new Set<string>(), taskPaths = new Set<string>(), outcomes = new Set<string>();
  return message.vacancies.every(v => {
    try { if (!v.postingUrl || postingUrl(v.postingUrl) !== postings.get(v.vacancyKey) || !v.outcomeEvidence) return false; } catch { return false; }
    if (outcomes.has(v.outcomeEvidence.path)) return false; outcomes.add(v.outcomeEvidence.path);
    if (v.disposition === "applied") {
      if (!v.taskId || !v.taskPath || !v.taskEvidence || v.taskEvidence.path !== v.taskPath || taskIds.has(v.taskId) || taskPaths.has(v.taskPath)) return false;
      taskIds.add(v.taskId); taskPaths.add(v.taskPath);
      return supplied(v.taskId) && isAppliedRecord(v.taskPath) &&
        v.applicationRecordSaved === true && supplied(v.confirmationReference);
    }
    if (v.disposition === "notApplicable") {
      return supplied(v.nonapplicationReason) && supplied(v.instructionReference);
    }
    return false;
  });
}

export class DiscoveryRequired extends Error {
  constructor(site: string) {
    super(`${site}: no observed website routine exists; follow discovery-workflow.md.`);
    this.name = "DiscoveryRequired";
  }
}

/** Inputs are supplied from one private role profile, never embedded in adapters. */
export interface ApplicationInputs {
  taskId: string;
  roleProfileId: string;
  jobUrl: string;
  cvPath: string;
  cvVersion: string;
  cvSha256: string;
  answers: Readonly<Record<string, string>>;
  saveCheckpoint: (checkpoint: "prepared" | "submissionAttempted") => Promise<void>;
}

export interface ConfirmedApplication {
  taskId: string;
  confirmationReference: string;
  confirmedAt: string;
  evidenceReference: string;
}
