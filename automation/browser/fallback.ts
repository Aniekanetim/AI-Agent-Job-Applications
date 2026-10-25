import type { ApplicationTask } from "../workflow/application-state.js";
import { validateBrowserPreferences, type BrowserPreferences, type BrowserBackend } from "./preferences.js";

export interface BrowserHandoff {
  from: BrowserBackend;
  to: "playwright";
  reason: "requiredFileUpload";
  taskId: string;
  jobUrl: string;
  savedCheckpointReference: string;
  observedAt: string;
  state: "awaitingResume" | "resumed";
  resumeEvidenceReference?: string;
}
export interface BrowserExecution {
  defaultBrowser: BrowserBackend;
  activeBrowser: BrowserBackend;
  requiresFileUpload: boolean | null;
  handoffs: BrowserHandoff[];
}
export type BrowserDecision = { action: "continue" | "switch"; backend: BrowserBackend; reason: string } |
  { action: "blocked" | "resolveOutcome" | "finished"; reason: string };

/** Routing is task-local. A required-upload exception never rewrites the saved default. */
export function decideBrowser(task: ApplicationTask, preferences: BrowserPreferences,
  available: Record<BrowserBackend, boolean>, requiresFileUpload: boolean | null,
  accessDenied = false): BrowserDecision {
  validateBrowserPreferences(preferences);
  if (task.checkpoint === "confirmed") return { action: "finished", reason: "This task already has a confirmed outcome." };
  if (task.checkpoint === "submissionAttempted") return { action: "resolveOutcome", reason: "Establish the same application's outcome before any browser switch or retry." };
  if (accessDenied) return { action: "blocked", reason: "A permission or access denial is not a browser-capability fallback." };
  if (!preferences.resolvedDefault) return { action: "blocked", reason: "Resolve the user's browser preference from actual available capabilities." };
  const existing = task.browserExecution;
  if (existing?.handoffs.some(handoff => handoff.state === "awaitingResume")) return { action: "blocked", reason: "Verify the saved handoff's same-vacancy draft/session before continuing." };
  // Remain in Playwright after switching, even if later pages do not request a file.
  const desired = existing?.activeBrowser === "playwright" || requiresFileUpload === true ? "playwright" : preferences.resolvedDefault;
  if (!available[desired]) return { action: "blocked", reason: `${desired} is unavailable for this application; preserve the checkpoint and resolve access.` };
  return { action: existing && existing.activeBrowser !== desired ? "switch" : "continue", backend: desired,
    reason: requiresFileUpload === true && preferences.resolvedDefault === "inApp" ? "Required file upload uses the prepared Playwright fallback." : "Use this task's browser while preserving the user's default." };
}

export function beginBrowserExecution(task: ApplicationTask, preferences: BrowserPreferences,
  available: Record<BrowserBackend, boolean>, requiresFileUpload: boolean | null): ApplicationTask {
  if (task.browserExecution) throw new Error("Resume the existing browser checkpoint instead of starting another execution.");
  const decision = decideBrowser(task, preferences, available, requiresFileUpload);
  if (decision.action !== "continue" || !preferences.resolvedDefault) throw new Error(decision.reason);
  return { ...structuredClone(task), browserExecution: { defaultBrowser: preferences.resolvedDefault,
    activeBrowser: decision.backend, requiresFileUpload, handoffs: [] } };
}

export function saveUploadHandoff(task: ApplicationTask, jobUrl: string,
  checkpointReference: string, now: string): ApplicationTask {
  if (!task.browserExecution || task.browserExecution.activeBrowser !== "inApp" ||
    !["working", "prepared"].includes(task.checkpoint) || task.browserExecution.handoffs.some(h => h.state === "awaitingResume") ||
    !task.taskId?.trim() || !checkpointReference.trim() || !Number.isFinite(Date.parse(now))) throw new Error("A browser handoff needs the existing pre-submission task and saved checkpoint.");
  const url = new URL(jobUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("Record the verified vacancy URL without authentication data.");
  const next = structuredClone(task);
  next.browserExecution!.requiresFileUpload = true;
  next.browserExecution!.handoffs.push({ from: "inApp", to: "playwright", reason: "requiredFileUpload", taskId: task.taskId,
    jobUrl: url.href, savedCheckpointReference: checkpointReference, observedAt: now, state: "awaitingResume" });
  return next;
}

/** These evidence fields describe observed checks; the agent must actually perform them. */
export function resumeUploadHandoff(task: ApplicationTask, confirmation: {
  taskId: string; jobUrl: string; sameVacancyVerified: boolean; sessionVerified: boolean;
  draftInspected: boolean; submissionStateChecked: boolean; evidenceReference: string;
}): ApplicationTask {
  const last = task.browserExecution?.handoffs.at(-1);
  if (!last || last.state !== "awaitingResume" || !["working", "prepared"].includes(task.checkpoint) ||
    confirmation.taskId !== task.taskId || confirmation.taskId !== last.taskId || confirmation.jobUrl !== last.jobUrl ||
    !confirmation.sameVacancyVerified || !confirmation.sessionVerified || !confirmation.draftInspected ||
    !confirmation.submissionStateChecked || !confirmation.evidenceReference.trim()) throw new Error("Verify the same vacancy, authorized session, draft and submission state before resuming.");
  const next = structuredClone(task);
  next.browserExecution!.activeBrowser = "playwright";
  const resumed = next.browserExecution!.handoffs.at(-1)!;
  resumed.state = "resumed"; resumed.resumeEvidenceReference = confirmation.evidenceReference;
  return next;
}
