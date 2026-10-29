import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { digest, loadProgress } from "../onboarding/state-store.js";
import { validateOperatingPreferences } from "../scheduling/preferences.js";
import { validateBrowserPreferences } from "../browser/preferences.js";
import { validateConnection } from "../email/connection.js";
import { type Setting } from "./catalog.js";
import { loadSites } from "../sites/registry.js";

export interface Role { id: string; path: string; label: string; enabled: boolean }
export interface CurrentSetting { status: "saved" | "notConfigured" | "default"; text: string; path: string | null; sha256: string | null; fingerprint: string }
export function containedFile(root: string, path: string) {
  if (isAbsolute(path) || path.includes("\\") || path.split("/").some(p => !p || p === "." || p === "..")) throw new Error("Use a contained settings context path.");
  const absolute = resolve(root, path);
  if (existsSync(absolute)) {
    const part = relative(realpathSync(root), realpathSync(absolute));
    if (part.startsWith("..") || isAbsolute(part)) throw new Error("Settings context resolves outside this working copy.");
  }
  return absolute;
}
export function roles(root: string): Role[] {
  const path = "Job Context/Candidate/role-routing.local.md";
  const file = containedFile(root, path); if (!existsSync(file)) return [];
  const found: Role[] = [];
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const cells = line.split("|").slice(1, -1).map(v => v.trim());
    if (!cells[1]?.startsWith("Role Profiles/")) continue;
    if (!/^[a-zA-Z0-9_-]+$/.test(cells[0]) || !/^Role Profiles\/[^/\\]+$/.test(cells[1]) || found.some(r => r.id === cells[0])) throw new Error("Reconcile the saved role-routing table before selecting a profile.");
    found.push({ id: cells[0], path: `Job Context/Candidate/${cells[1]}`, label: cells[1].slice(14), enabled: /^(yes|true|enabled)$/i.test(cells[2]) });
  }
  return found;
}
export function boardNames(root: string) { return loadProgress(root).state.boards.map(b => b.name); }
export function siteChoices(root: string) { return loadSites(root).state.sites.map(s => ({ id: s.id, label: `${s.label} — ${s.origin}${s.scopePath === "/" ? "" : s.scopePath}` })); }
export function targetPath(root: string, setting: Setting, roleId: string | null, board: string | null): string | null {
  if (setting.scope === "global") return setting.path;
  if (setting.scope === "site") return loadSites(root).state.sites.find(s => s.id === board)?.accessPath ?? null;
  if (setting.scope === "role") {
    const role = roles(root).find(r => r.id === roleId && r.enabled);
    return role ? `${role.path}/${setting.path}` : null;
  }
  const selected = loadProgress(root).state.boards.find(b => b.name === board);
  if (!selected) return null;
  const recorded = [...new Set(selected.access.evidence.map(e => e.path).filter(p => /^Job Context\/Job Boards\/[^/]+\/access-and-instructions\.local\.md$/.test(p)))];
  if (recorded.length > 1) throw new Error("Reconcile this board's account-context references before editing access.");
  if (recorded.length) return recorded[0];
  if (!board || /[\\/]/.test(board)) return null;
  return `Job Context/Job Boards/${board}/${setting.path}`;
}
const clean = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, "").split(/\r?\n/).map(line =>
  /(?:password|secret|(?:access[_ -]?)?token|api[_ -]?key)["']?\s*[:=]|Bearer\s+\S+|-----BEGIN.*PRIVATE KEY|https?:\/\/[^\s/]+:[^\s/]+@/i.test(line) ? "[Credential content hidden; use private authentication setup.]" : line).join("\n");

/** Read only the selected canonical context. Never read .env, CV bytes or authentication state. */
export function currentSetting(root: string, setting: Setting, roleId: string | null, board: string | null): CurrentSetting {
  const path = targetPath(root, setting, roleId, board);
  const value = (status: CurrentSetting["status"], text: string, sha256: string | null = null): CurrentSetting =>
    ({ status, text: clean(text), path, sha256, fingerprint: digest(JSON.stringify([path, text])) });
  if (!path || !existsSync(containedFile(root, path))) return value(setting.id === "visibility" ? "default" : "notConfigured",
    setting.id === "visibility" ? "Visible window (headed, package default)" : "Not configured");
  const bytes = readFileSync(containedFile(root, path)), sha = digest(bytes);
  if (path.endsWith(".md")) return value("saved", bytes.toString("utf8"), sha);
  const raw = JSON.parse(bytes.toString("utf8")) as Record<string, any>;
  let selected: unknown;
  if (setting.id === "boards") selected = loadProgress(root).state.boards.map(b => `${b.name}: ${b.url}${b.deferred ? " (deferred)" : ""}`).join(", ") || null;
  else if (setting.id === "intake") {
    const scope = loadProgress(root).state.scope;
    selected = scope ? { profileSetup: "Candidate profile setup only", manualApplications: "Manual To Do tasks", emailApplications: "Email job alerts", bothApplications: "Email alerts and manual To Do tasks" }[scope] : null;
  } else if (setting.id === "email" || setting.id === "cleanup") {
    validateConnection(raw);
    selected = setting.id === "email" ? `${raw.source.provider}: ${raw.source.address ?? raw.source.mailboxId}\nAlert folder: ${raw.scope.folderOrLabel ?? "Not specified"}\nFilter: ${raw.scope.query ?? "Not specified"}` :
      raw.cleanup ? `${raw.cleanup.mode} (${raw.cleanup.effect})` : null;
  } else if (setting.id === "default-browser") {
    validateBrowserPreferences(raw);
    const names = { inApp: "In-app browser", playwright: "Playwright browser", automatic: "Choose automatically" };
    selected = raw.choice ? `${names[raw.choice]}${raw.choice === "automatic" ? ` (${raw.resolvedDefault ? names[raw.resolvedDefault] : "capability check needed"})` : ""}` : null;
  }
  else if (setting.id === "visibility") {
    if (raw.schemaVersion !== 1 || !["headed", "headless"].includes(raw.mode) || !raw.sourceReference?.trim()) throw new Error("Reconcile the saved visibility setting; preserve the original file.");
    selected = raw.mode === "headed" ? "Visible window (headed)" : "Headless";
  } else {
    validateOperatingPreferences(raw);
    selected = setting.id === "check-in" ? raw.mode === "onDemand" ? "Only when asked" : `${raw.cadence}; ${raw.timezone}; schedule ${raw.scheduleReference ? "configured" : "not yet configured"}` :
      setting.id === "reporting" ? { summary: "Summary of applications, blockers and remaining work", blockersOnly: "Blockers only", digest: "Results digest", unspecified: "Not configured" }[raw.reporting] :
        `${(setting.id === "per-run" ? raw.perRunLimit : raw.perDayLimit) ?? "No fixed limit configured"}${setting.id === "per-day" && raw.timezone ? ` (${raw.timezone})` : ""}`;
  }
  return value(selected == null ? "notConfigured" : "saved", selected == null ? "Not configured" : typeof selected === "string" ? selected : JSON.stringify(selected, null, 2), sha);
}
