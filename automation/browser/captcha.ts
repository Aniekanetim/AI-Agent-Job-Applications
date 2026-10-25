import type { ApplicationTask } from "../workflow/application-state.js";
import type { BrowserBackend } from "./preferences.js";

/** Private task checkpoints, never CAPTCHA answers, response tokens or browser credentials. */
export interface CaptchaHandoff {
  handoffId: string;
  taskId: string;
  jobUrl: string;
  browser: BrowserBackend;
  selectedRoleId: string;
  cvVersion: string;
  cvSha256: string;
  sessionReference: string;
  sessionAccess: "visible" | "headless" | "unavailable";
  draftReference: string | null;
  checkpointReference: string;
  detectedAt: string;
  evidenceReference: string;
  state: "awaitingHuman" | "resolved";
  reported?: { reference: string; at: string };
  resolution?: {
    outcome: "notSubmitted" | "confirmed";
    evidenceReference: string;
    submissionEvidenceReference: string;
    observedAt: string;
    sessionReference: string;
    humanCompletionReference?: string;
    recovery?: "sameSession" | "restoredDraft";
    recoveryEvidenceReference?: string;
  };
}
export interface CaptchaObservation {
  handoffId: string;
  jobUrl: string;
  sessionReference: string;
  sessionAccess: CaptchaHandoff["sessionAccess"];
  draftReference: string | null;
  checkpointReference: string;
  evidenceReference: string;
  accessContextPath: string;
  lastCompletedStep: string;
  observedAt: string;
}
const text = (value: unknown): value is string => typeof value === "string" && !!value.trim();
const time = (value: string) => text(value) && Number.isFinite(Date.parse(value));
function cleanUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("Use the verified vacancy URL without authentication data.");
  return url.href;
}
export function pendingCaptcha(task: ApplicationTask): CaptchaHandoff | undefined {
  return task.captchaHandoffs?.find(handoff => handoff.state !== "resolved");
}

/** Saving this checkpoint is separate from moving the existing Markdown ticket. */
export function pauseForCaptcha(task: ApplicationTask, observation: CaptchaObservation): ApplicationTask {
  const browser = task.browserExecution?.activeBrowser;
  if (!text(task.taskId) || !text(task.selectedRoleId) || !text(task.cvVersion) || !/^[a-f0-9]{64}$/i.test(task.cvSha256 ?? "") ||
    task.checkpoint === "confirmed" || !browser ||
    task.browserExecution?.handoffs.some(h => h.state === "awaitingResume") ||
    !["visible", "headless", "unavailable"].includes(observation.sessionAccess) ||
    ![observation.handoffId, observation.sessionReference, observation.checkpointReference,
      observation.evidenceReference, observation.accessContextPath, observation.lastCompletedStep].every(text) ||
    observation.draftReference !== null && !text(observation.draftReference) || !time(observation.observedAt)) {
    throw new Error("CAPTCHA blocking needs the existing task, browser, observed challenge and private resume checkpoint.");
  }
  const jobUrl = cleanUrl(observation.jobUrl), pending = pendingCaptcha(task);
  if (pending) {
    if (pending.handoffId !== observation.handoffId || pending.jobUrl !== jobUrl || pending.browser !== browser) {
      throw new Error("Resume the existing CAPTCHA handoff; do not replace its identity or browser.");
    }
    return task; // No-op check-ins do not rewrite timestamps or repeat the request.
  }
  if (task.captchaHandoffs?.some(h => h.handoffId === observation.handoffId)) throw new Error("A new challenge needs a new handoff identity; preserve prior history.");
  if (task.blocker && !task.blocker.resolvedAt) throw new Error("Preserve the existing unresolved dependency instead of replacing it.");
  const next = structuredClone(task);
  next.captchaHandoffs ??= [];
  next.captchaHandoffs.push({ handoffId: observation.handoffId, taskId: task.taskId, jobUrl, browser,
    selectedRoleId: task.selectedRoleId!, cvVersion: task.cvVersion!, cvSha256: task.cvSha256!,
    sessionReference: observation.sessionReference, sessionAccess: observation.sessionAccess,
    draftReference: observation.draftReference, checkpointReference: observation.checkpointReference,
    detectedAt: observation.observedAt, evidenceReference: observation.evidenceReference, state: "awaitingHuman" });
  next.blocker = { kind: "captcha", reason: "CAPTCHA requires human completion",
    lastCompletedStep: observation.lastCompletedStep, contextPath: observation.accessContextPath,
    nextAction: task.checkpoint === "submissionAttempted" ? "Establish this application's submission outcome before any retry; human assistance may still be needed." :
      observation.sessionAccess === "visible" ? "Complete the CAPTCHA in this application's existing browser; the agent will verify and resume." :
      "Arrange an accessible browser session for this same application, restore its draft and complete the CAPTCHA manually.",
    resumeCheckpoint: observation.checkpointReference };
  return next;
}

/** Record an actual delivered notification/ticket comment, never an assumed notification channel. */
export function recordCaptchaRequest(task: ApplicationTask, handoffId: string, reference: string, now: string): ApplicationTask {
  const pending = pendingCaptcha(task);
  if (!pending || pending.handoffId !== handoffId || !text(reference) || !time(now) || Date.parse(now) < Date.parse(pending.detectedAt)) {
    throw new Error("Record the actual request against this pending CAPTCHA handoff.");
  }
  if (pending.reported) return task;
  const next = structuredClone(task);
  next.captchaHandoffs!.find(h => h.handoffId === handoffId)!.reported = { reference, at: now };
  return next;
}

export function captchaNextAction(task: ApplicationTask, humanReady = false,
  currentSessionAccess?: CaptchaHandoff["sessionAccess"]): "none" | "reportOnce" | "wait" | "inspectOutcome" | "humanHandoff" | "recoverSession" {
  const pending = pendingCaptcha(task);
  if (!pending) return "none";
  if (!pending.reported) return "reportOnce";
  if (task.checkpoint === "submissionAttempted") return "inspectOutcome";
  if (!humanReady) return "wait";
  return (currentSessionAccess ?? pending.sessionAccess) === "visible" ? "humanHandoff" : "recoverSession";
}

interface ResolutionBase {
  handoffId: string; taskId: string; jobUrl: string; browser: BrowserBackend;
  sessionReference: string; sameVacancyVerified: boolean; sessionVerified: boolean;
  observedAt: string; evidenceReference: string; submissionEvidenceReference: string;
}
export type CaptchaResolution = ResolutionBase & ({
  outcome: "notSubmitted"; humanCompletionReference: string; challengeCleared: boolean;
  sessionVisible: boolean; fieldsReviewed: boolean; cvChecked: boolean;
  recovery: "sameSession" | "restoredDraft"; draftReference: string | null; recoveryEvidenceReference?: string;
} | { outcome: "confirmed"; confirmation: { reference: string; observedAt: string } });

/** Evidence describes checks the agent actually performed. This helper cannot prove a remote site's result. */
export function resolveCaptcha(task: ApplicationTask, checks: CaptchaResolution): ApplicationTask {
  const pending = pendingCaptcha(task);
  if (!pending || task.blocker?.kind !== "captcha" || checks.handoffId !== pending.handoffId ||
    checks.taskId !== task.taskId || checks.taskId !== pending.taskId || cleanUrl(checks.jobUrl) !== pending.jobUrl ||
    task.selectedRoleId !== pending.selectedRoleId || task.cvVersion !== pending.cvVersion || task.cvSha256 !== pending.cvSha256 ||
    checks.browser !== pending.browser || task.browserExecution?.activeBrowser !== pending.browser ||
    !checks.sameVacancyVerified || !checks.sessionVerified || !text(checks.sessionReference) ||
    !text(checks.evidenceReference) || !text(checks.submissionEvidenceReference) || !time(checks.observedAt) ||
    Date.parse(checks.observedAt) < Date.parse(pending.detectedAt)) {
    throw new Error("Verify this exact task, vacancy, browser session and current submission outcome before resolving CAPTCHA.");
  }
  if (checks.outcome === "notSubmitted") {
    if (!text(checks.humanCompletionReference) || !checks.challengeCleared || !checks.sessionVisible ||
      !checks.fieldsReviewed || !checks.cvChecked ||
      checks.recovery === "sameSession" && (checks.sessionReference !== pending.sessionReference || checks.draftReference !== pending.draftReference) ||
      checks.recovery === "restoredDraft" && !text(checks.recoveryEvidenceReference) ||
      !["sameSession", "restoredDraft"].includes(checks.recovery)) {
      throw new Error("Human completion, cleared challenge, inspected fields/CV and the same or safely restored draft are required.");
    }
  } else if (checks.outcome !== "confirmed" || task.checkpoint !== "submissionAttempted" ||
    !text(checks.confirmation.reference) || !time(checks.confirmation.observedAt) ||
    Date.parse(checks.confirmation.observedAt) > Date.parse(checks.observedAt)) {
    throw new Error("An uncertain submission can finish only from its actual matching confirmation, without another submit.");
  }
  const next = structuredClone(task), handoff = next.captchaHandoffs!.find(h => h.handoffId === pending.handoffId)!;
  handoff.state = "resolved";
  handoff.resolution = { outcome: checks.outcome, evidenceReference: checks.evidenceReference,
    submissionEvidenceReference: checks.submissionEvidenceReference, observedAt: checks.observedAt,
    sessionReference: checks.sessionReference,
    ...(checks.outcome === "notSubmitted" ? { humanCompletionReference: checks.humanCompletionReference,
      recovery: checks.recovery, recoveryEvidenceReference: checks.recoveryEvidenceReference } : {}) };
  next.blocker!.resolvedAt = checks.observedAt; next.blocker!.resolutionEvidence = checks.evidenceReference;
  // Re-review after a human handoff, even if the task was prepared before the challenge.
  next.checkpoint = checks.outcome === "confirmed" ? "confirmed" : "working";
  if (checks.outcome === "confirmed") next.confirmation = structuredClone(checks.confirmation);
  return next;
}
