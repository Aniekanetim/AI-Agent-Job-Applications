/** Local integrity checks; these do not establish that external evidence is true. */
export type IntakeFolder = "Email Alerts" | "To Do";
export type BoardFolder = IntakeFolder | "Blocked" | "Applied";

export interface Blocker {
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
}

export interface MessageProgress {
  inboxId: string;
  messageId: string;
  enumerationComplete: boolean;
  cleanupState: "notReady" | "cleanupPending" | "deleted";
  vacancies: VacancyProgress[];
}

const supplied = (value: string | null | undefined): boolean =>
  typeof value === "string" && value.trim().length > 0;

const validTime = (value: string | undefined): boolean =>
  supplied(value) && Number.isFinite(Date.parse(value!));

export function canMarkApplied(task: ApplicationTask): boolean {
  return supplied(task.taskId) && task.checkpoint === "confirmed" &&
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
      !supplied(task.blocker?.resolutionEvidence)) {
      throw new Error("Resolve the actual dependency and return to original intake.");
    }
    return;
  }
  if (to !== "Applied" || !canMarkApplied(task)) {
    throw new Error("Applied requires a confirmed outcome and selected role/CV identity.");
  }
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
  return message.vacancies.every(v => {
    if (v.disposition === "applied") {
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
