import { mkdtempSync, mkdirSync, writeFileSync, rmSync, appendFileSync } from "node:fs";
import { resolve, dirname, join, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import type { TestContext } from "node:test";
import type { ApplicationTask } from "../workflow/application-state.js";
import { siteEvidence } from "../sites/files.js";
import { ensureSite } from "../sites/registry.js";
import { bindTaskSite, recordSiteAccess, type SitePage } from "../sites/execution.js";
export const siteNow = "2026-10-29T12:00:00Z";
export function siteBox(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "sites-synthetic-")); execFileSync("git", ["init", "--quiet", root], { windowsHide: true });
  writeFileSync(resolve(root, ".gitignore"), ".local/\n**/*.local.md\n**/*.local.ts\n**/.env\n");
  t.after(() => { const p = relative(tmpdir(), root); if (!p || p.startsWith("..") || isAbsolute(p)) throw new Error("Unsafe temporary path."); rmSync(root, { recursive: true }); });
  const write = (path: string, value: unknown) => { mkdirSync(dirname(resolve(root, path)), { recursive: true }); writeFileSync(resolve(root, path), typeof value === "string" ? value : JSON.stringify(value)); return siteEvidence(root, path); };
  return { root, write };
}
/** Synthetic metadata/evidence only. The caller's browser test remains responsible for observing its own UI. */
export function readySite(t: TestContext, task: ApplicationTask, url = "https://employer.example.invalid/jobs/synthetic-qa/apply", existingRoot?: string) {
  const box = existingRoot ? { root: existingRoot } : siteBox(t), root = box.root;
  if (existingRoot) appendFileSync(resolve(root, ".gitignore"), "\n**/*.local.md\n**/*.local.ts\n**/.env\n");
  const base = `.local/site-fixture/${task.taskId.replace(/[^a-zA-Z0-9-]/g, "-")}`;
  const write = (path: string, value: unknown) => { mkdirSync(dirname(resolve(root, path)), { recursive: true }); writeFileSync(resolve(root, path), typeof value === "string" ? value : JSON.stringify(value)); return siteEvidence(root, path); };
  const observed = write(`${base}/observation.json`, { synthetic: true, url, note: "Fixture, no real account or employer accessed." });
  const result = ensureSite(root, { kind: "direct", label: "Synthetic employer", url, observation: observed });
  if (result.action !== "prepared") throw new Error("Expected synthetic website.");
  const page: SitePage = { url, browser: task.browserExecution?.activeBrowser ?? "playwright", sessionReference: "synthetic-site-session" };
  const candidate = { ...task, browserExecution: task.browserExecution ?? { defaultBrowser: "playwright" as const, activeBrowser: "playwright" as const, requiresFileUpload: false, handoffs: [] } };
  const bound = bindTaskSite(root, candidate, result.site.id, page);
  const report = write(`${base}/access.json`, { schemaVersion: 1, ...page, taskId: task.taskId, siteId: result.site.id, observedAt: siteNow, access: "anonymous", identityVerified: true, challengeCleared: true, permittedActions: ["upload", "submit"], evidence: observed });
  return { root, page, task: recordSiteAccess(root, bound, report), site: result.site, write };
}
