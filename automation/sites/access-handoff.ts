import type { ApplicationTask } from "../workflow/application-state.js";
import { loadSites, matchesSite } from "./registry.js";
import { checkSiteEvidence, type SiteEvidence } from "./files.js";
import type { SitePage } from "./execution.js";

export interface AccessHandoff extends SitePage {
  id: string; taskId: string; siteId: string; challenge: string;
  detectedAt: string; evidence: SiteEvidence; checkpointReference: string;
  sessionAccess: "visible" | "headless" | "unavailable";
  state: "awaitingHuman" | "resolved";
  reportedReference?: string; resolution?: { observedAt: string; evidence: SiteEvidence; humanReference: string; recoveredSession?: { sessionReference: string; evidence: SiteEvidence } };
}
/** Early website access only. Form/CV challenges still use the stricter CAPTCHA handoff. */
export function pauseForSiteAccess(root: string, task: ApplicationTask, input: Omit<AccessHandoff, "taskId" | "state">): ApplicationTask {
  const site = loadSites(root).state.sites.find(s => s.id === input.siteId), binding = task.siteExecution;
  if (!site || !binding || binding.siteId !== site.id || binding.taskId !== task.taskId || !matchesSite(site, input.url) || input.url !== binding.url || input.browser !== binding.browser || input.sessionReference !== binding.sessionReference ||
    task.selectedRoleId || task.cvVersion || task.cvSha256 || task.checkpoint !== "working" || task.blocker && !task.blocker.resolvedAt || task.captchaHandoffs?.some(h => h.state !== "resolved") || task.accessHandoffs?.some(h => h.state !== "resolved") || task.browserExecution?.handoffs.some(h => h.state === "awaitingResume") ||
    !input.id?.trim() || !input.challenge?.trim() || !input.checkpointReference?.trim() || !Number.isFinite(Date.parse(input.detectedAt)) || !["visible", "headless", "unavailable"].includes(input.sessionAccess)) throw new Error("Preserve a genuine pre-profile access checkpoint; use the form/CV handoff after profile selection.");
  checkSiteEvidence(root, input.evidence);
  const next = structuredClone(task); next.accessHandoffs ??= [];
  if (next.accessHandoffs.some(h => h.id === input.id)) throw new Error("Resume the existing access handoff instead of replacing its history.");
  next.accessHandoffs.push({ ...input, taskId: task.taskId, state: "awaitingHuman" });
  if (next.siteExecution) delete next.siteExecution.access;
  next.blocker = { kind: "siteAccess", reason: input.challenge, lastCompletedStep: "Observed site identity before role/CV selection", contextPath: site.accessPath,
    nextAction: input.sessionAccess === "visible" ? "Complete human verification in the saved browser; then inspect actual clearance." : "Recover an accessible browser session for human verification; preserve the same task.", resumeCheckpoint: input.checkpointReference };
  return next;
}
export function reportSiteAccess(task: ApplicationTask, id: string, reference: string): ApplicationTask {
  const h = task.accessHandoffs?.find(h => h.id === id && h.state === "awaitingHuman");
  if (!h || !reference.trim()) throw new Error("Reference the actual human request for the pending access handoff.");
  if (h.reportedReference) return task;
  const next = structuredClone(task); next.accessHandoffs!.find(h => h.id === id)!.reportedReference = reference; return next;
}
export function resolveSiteAccess(root: string, task: ApplicationTask, input: SitePage & {
  id: string; siteId: string; taskId: string; observedAt: string; evidence: SiteEvidence;
  humanReference: string; challengeCleared: boolean; sameVacancyVerified: boolean; sessionVerified: boolean;
  outcome: "notSubmitted" | "unknown";
  recovery?: { fromSessionReference: string; evidence: SiteEvidence };
}): ApplicationTask {
  const h = task.accessHandoffs?.find(h => h.id === input.id && h.state === "awaitingHuman"), site = loadSites(root).state.sites.find(s => s.id === h?.siteId);
  if (!h || !site || !task.siteExecution || task.siteExecution.taskId !== task.taskId || task.siteExecution.siteId !== h.siteId || task.siteExecution.url !== h.url || task.siteExecution.sessionReference !== h.sessionReference || task.siteExecution.browser !== h.browser || task.browserExecution?.activeBrowser !== h.browser || !task.blocker || task.blocker.kind !== "siteAccess" || task.checkpoint !== "working" || task.selectedRoleId || task.cvSha256 || task.cvVersion ||
    input.taskId !== task.taskId || input.siteId !== h.siteId || input.browser !== h.browser || !input.sessionReference?.trim() || input.sessionReference !== h.sessionReference && (!input.recovery || input.recovery.fromSessionReference !== h.sessionReference) || input.url !== h.url || !matchesSite(site, input.url) ||
    !input.challengeCleared || !input.sameVacancyVerified || !input.sessionVerified || input.outcome !== "notSubmitted" || !input.humanReference?.trim() ||
    !Number.isFinite(Date.parse(input.observedAt)) || Date.parse(input.observedAt) < Date.parse(h.detectedAt)) throw new Error("Human readiness or new context is not clearance. Inspect the same vacancy/session and establish its unsubmitted outcome.");
  checkSiteEvidence(root, input.evidence);
  if (input.recovery) { if (input.recovery.fromSessionReference !== h.sessionReference) throw new Error("Recover the original session explicitly."); checkSiteEvidence(root, input.recovery.evidence); }
  const next = structuredClone(task), resolved = next.accessHandoffs!.find(v => v.id === input.id)!;
  resolved.state = "resolved"; resolved.resolution = { observedAt: input.observedAt, evidence: input.evidence, humanReference: input.humanReference };
  if (input.sessionReference !== h.sessionReference) {
    resolved.resolution.recoveredSession = { sessionReference: input.sessionReference, evidence: input.recovery!.evidence };
    next.siteHistory ??= []; next.siteHistory.push(structuredClone(next.siteExecution!));
    next.siteExecution!.sessionReference = input.sessionReference;
  }
  delete next.siteExecution!.access;
  next.blocker!.resolvedAt = input.observedAt; next.blocker!.resolutionEvidence = input.evidence.path;
  return next;
}
