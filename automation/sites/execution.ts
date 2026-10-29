import { readFileSync } from "node:fs";
import type { ApplicationTask } from "../workflow/application-state.js";
import type { BrowserBackend } from "../browser/preferences.js";
import { loadSites, matchesSite, type SiteRecord } from "./registry.js";
import { checkSiteEvidence, siteEvidence, siteFile, type SiteEvidence } from "./files.js";

export interface SitePage { url: string; browser: BrowserBackend; sessionReference: string }
export interface SiteExecution extends SitePage {
  siteId: string; taskId: string; accessPath: string; architecturePath: string;
  access?: { report: SiteEvidence; context: SiteEvidence; architecture: SiteEvidence };
}
export type SiteAction = "credentials" | "upload" | "submit";
/** An observation report binds actual browser evidence to one task/account/session. It is not a live browser probe. */
export interface SiteAccessReport extends SitePage {
  schemaVersion: 1; siteId: string; taskId: string; observedAt: string;
  access: "anonymous" | "login" | "authenticated";
  identityVerified: true; challengeCleared: true;
  permittedActions: SiteAction[]; evidence: SiteEvidence;
}
function registered(root: string, task: ApplicationTask) {
  const binding = task.siteExecution, site = loadSites(root).state.sites.find(s => s.id === binding?.siteId);
  if (!binding || !site || binding.taskId !== task.taskId || binding.accessPath !== site.accessPath || binding.architecturePath !== site.architecturePath || !matchesSite(site, binding.url)) throw new Error("Prepare and bind this task to its observed website context first.");
  siteFile(root, site.accessPath); siteFile(root, site.architecturePath);
  // Reading, not merely resolving, catches interrupted/removed scaffolds.
  for (const path of [site.accessPath, site.architecturePath]) if (!readFileSync(siteFile(root, path), "utf8").trim()) throw new Error("Inspect incomplete website context before continuing.");
  return { binding, site };
}
export function bindTaskSite(root: string, task: ApplicationTask, siteId: string, page: SitePage): ApplicationTask {
  const site = loadSites(root).state.sites.find(s => s.id === siteId);
  if (!site || !matchesSite(site, page.url) || !task.taskId?.trim() || !page.sessionReference?.trim() ||
    !["inApp", "playwright"].includes(page.browser) || task.browserExecution?.activeBrowser !== page.browser ||
    task.checkpoint === "confirmed" || task.checkpoint === "submissionAttempted" || task.accessHandoffs?.some(h => h.state !== "resolved") || task.captchaHandoffs?.some(h => h.state !== "resolved")) throw new Error("Bind only the current pre-submission task/browser; recover prior outcomes or handoffs first.");
  const next = structuredClone(task);
  if (next.siteExecution) {
    if (next.siteExecution.siteId === siteId && next.siteExecution.url === page.url && next.siteExecution.browser === page.browser && next.siteExecution.sessionReference === page.sessionReference) return next;
    next.siteHistory ??= []; next.siteHistory.push(next.siteExecution);
  }
  // A transition always drops prior readiness: sessions/accounts do not transfer by assumption.
  next.siteExecution = { ...page, siteId, taskId: task.taskId, accessPath: site.accessPath, architecturePath: site.architecturePath };
  registered(root, next); return next;
}
function reportFor(root: string, task: ApplicationTask, evidence: SiteEvidence): { report: SiteAccessReport; site: SiteRecord } {
  const { binding, site } = registered(root, task); checkSiteEvidence(root, evidence);
  const r = JSON.parse(readFileSync(siteFile(root, evidence.path), "utf8")) as SiteAccessReport;
  if (r.schemaVersion !== 1 || r.siteId !== site.id || r.taskId !== task.taskId || r.browser !== binding.browser || r.sessionReference !== binding.sessionReference ||
    !matchesSite(site, r.url) || r.url !== binding.url || !Number.isFinite(Date.parse(r.observedAt)) || !["anonymous", "login", "authenticated"].includes(r.access) ||
    r.identityVerified !== true || r.challengeCleared !== true || !Array.isArray(r.permittedActions) || !r.permittedActions.length ||
    r.permittedActions.some(v => !["credentials", "upload", "submit"].includes(v)) || r.access === "anonymous" && r.permittedActions.includes("credentials") || r.access === "login" && r.permittedActions.some(a => a !== "credentials")) throw new Error("Bind actual access observations to the same site, tenant, task and browser session.");
  checkSiteEvidence(root, r.evidence); return { report: r, site };
}
export function recordSiteAccess(root: string, task: ApplicationTask, evidence: SiteEvidence): ApplicationTask {
  if (task.accessHandoffs?.some(h => h.state !== "resolved") || task.captchaHandoffs?.some(h => h.state !== "resolved") || task.blocker && (!task.blocker.resolvedAt || !task.blocker.resolutionEvidence) || !["working", "prepared"].includes(task.checkpoint)) throw new Error("Resolve the actual access dependency before recording readiness.");
  const { site } = reportFor(root, task, evidence), next = structuredClone(task);
  next.siteExecution!.access = { report: evidence, context: siteEvidence(root, site.accessPath), architecture: siteEvidence(root, site.architecturePath) }; return next;
}
/** Call with the just-inspected actual browser page immediately before each sensitive action. */
export function assertSiteAction(root: string, task: ApplicationTask, page: SitePage, action: SiteAction) {
  const { binding, site } = registered(root, task);
  if (!["working", "prepared"].includes(task.checkpoint) || action !== "credentials" && (!task.selectedRoleId?.trim() || !task.cvVersion?.trim() || !/^[a-f0-9]{64}$/i.test(task.cvSha256 ?? ""))) throw new Error("Preserve submission recovery; select the factual role/CV before upload or final submission.");
  if (task.browserExecution?.activeBrowser !== binding.browser || page.browser !== binding.browser || page.sessionReference !== binding.sessionReference || page.url !== binding.url || !matchesSite(site, page.url) ||
    task.accessHandoffs?.some(h => h.state !== "resolved") || task.captchaHandoffs?.some(h => h.state !== "resolved") || task.blocker && (!task.blocker.resolvedAt || !task.blocker.resolutionEvidence) || !binding.access) throw new Error("Verify this website/account/session and resolve its actual blocker before credentials, upload or submission.");
  checkSiteEvidence(root, binding.access.context); checkSiteEvidence(root, binding.access.architecture);
  const { report } = reportFor(root, task, binding.access.report);
  if (!report.permittedActions.includes(action)) throw new Error("The observed access report does not authorize this action; inspect the actual page first.");
}
