import { existsSync } from "node:fs";
import { readPrivateJson, savePrivateJson } from "../workflow/private-json.js";
import { acquireOwnership } from "../workflow/ownership.js";
import { siteFile, siteDigest, checkSiteEvidence, createSiteFile, privateSitePaths, type SiteEvidence } from "./files.js";

export type SiteKind = "board" | "destination" | "direct";
export interface SiteRecord {
  id: string; label: string; origin: string; scopePath: string; kinds: SiteKind[];
  accessPath: string; architecturePath: string; methodDirectory: string;
  observations: SiteEvidence[];
  parents: string[];
}
export interface SiteRegistry { schemaVersion: 1; sites: SiteRecord[] }
export interface SiteRequest {
  kind: SiteKind | "tracker" | "identityProvider"; label: string; url: string;
  /** Exact observed account/tenant boundary, e.g. /Employer on a shared ATS origin. */
  scopePath?: string; parentSiteId?: string; observation: SiteEvidence;
  /** Adoption of existing context requires explicit paths; content is preserved. */
  context?: { accessPath: string; architecturePath: string };
}
export const registryFile = ".local/site-registry.json";
const validId = (id: string) => /^site-[a-f0-9]{24}$/.test(id);
export function siteUrl(value: string) {
  const u = new URL(value);
  if (u.protocol !== "https:" || u.username || u.password || u.hash || u.port || /(?:%2f|%5c|%00)/i.test(u.pathname)) throw new Error("Use the observed HTTPS site URL without credentials, fragments, ports or encoded path separators.");
  return u;
}
function boundary(value = "/") {
  if (!value.startsWith("/") || value.includes("//") || /[?#%\\\x00-\x20]/.test(value) || value.split("/").some(v => v === "." || v === "..")) throw new Error("Record an exact observed tenant path boundary.");
  return value === "/" ? value : value.replace(/\/$/, "");
}
export function matchesSite(site: SiteRecord, url: string) {
  const u = siteUrl(url);
  return u.origin === site.origin && (site.scopePath === "/" || u.pathname === site.scopePath || u.pathname.startsWith(site.scopePath + "/"));
}
function identity(origin: string, scopePath: string) { return `site-${siteDigest(JSON.stringify([origin, scopePath])).slice(0, 24)}`; }
function pathsOK(root: string, s: Pick<SiteRecord, "accessPath" | "architecturePath" | "methodDirectory">) {
  if (!/^Job Context\/(Job Boards|Application destinations)\/.+\/access-and-instructions\.local\.md$/.test(s.accessPath) ||
    !/^Site Architecture Context\/.+\/architecture\.local\.md$/.test(s.architecturePath) || s.methodDirectory !== s.architecturePath.slice(0, -"/architecture.local.md".length)) throw new Error("Bind site context to its private access and architecture locations.");
  for (const path of [s.accessPath, s.architecturePath, `${s.methodDirectory}/playwright/pages.local.ts`, `${s.methodDirectory}/in-app/actions.local.md`]) siteFile(root, path, false);
}
export function loadSites(root: string) {
  siteFile(root, registryFile);
  const found = readPrivateJson(root, registryFile), state = (found.data ?? { schemaVersion: 1, sites: [] }) as SiteRegistry;
  if (state.schemaVersion !== 1 || !Array.isArray(state.sites)) throw new Error("Preserve and reconcile the site registry.");
  const ids = new Set<string>(), contexts = new Set<string>();
  for (const s of state.sites) {
    if (!validId(s.id) || ids.has(s.id) || identity(siteUrl(s.origin).origin, boundary(s.scopePath)) !== s.id || s.origin !== siteUrl(s.origin).origin ||
      !s.label?.trim() || !Array.isArray(s.kinds) || !s.kinds.length || s.kinds.some(k => !["board", "destination", "direct"].includes(k)) ||
      !Array.isArray(s.parents) || !Array.isArray(s.observations) || !s.observations.length || s.observations.some(e => !e || !/^[a-f0-9]{64}$/.test(e.sha256) || typeof e.path !== "string")) throw new Error("Preserve and reconcile site identity before execution.");
    pathsOK(root, s); ids.add(s.id);
    for (const path of [s.accessPath, s.architecturePath]) { if (contexts.has(path.toLowerCase())) throw new Error("Different account boundaries cannot share canonical context."); contexts.add(path.toLowerCase()); }
  }
  for (const s of state.sites) if (s.parents.some(id => id === s.id || !ids.has(id))) throw new Error("Reconcile the site's source relationships.");
  privateSitePaths(root, state.sites.flatMap(s => [s.accessPath, s.architecturePath, `${s.methodDirectory}/playwright/pages.local.ts`, `${s.methodDirectory}/playwright/application-flow.local.ts`, `${s.methodDirectory}/in-app/actions.local.md`]));
  return { state, revision: found.revision };
}
export function registeredAccessPath(root: string, path: string) { return loadSites(root).state.sites.some(s => s.accessPath === path); }
/** Saved primary choices are identity metadata, not duplicated candidate context. */
function primaryContext(root: string, origin: string, scopePath: string) {
  if (scopePath !== "/") return undefined;
  siteFile(root, ".local/onboarding-state.json");
  const raw = readPrivateJson(root, ".local/onboarding-state.json").data as { boards?: { name: string; url: string; contextPath: string; access?: { evidence?: SiteEvidence[] } }[] } | null;
  if (!raw || !Array.isArray(raw.boards)) return undefined;
  const matches = raw.boards.filter(b => siteUrl(b.url).origin === origin);
  if (!matches.length) return undefined;
  if (matches.length !== 1) throw new Error("Reconcile primary board identity before adopting its context.");
  const b = matches[0], paths = [...new Set(b.access?.evidence?.map(e => e.path).filter(p => /^Job Context\/Job Boards\/[^/]+\/access-and-instructions\.local\.md$/.test(p)) ?? [])];
  if (paths.length > 1 || !b.name?.trim() || /[\\/\r\n]/.test(b.name)) throw new Error("Reconcile the primary board's canonical access path.");
  return { accessPath: paths[0] ?? `Job Context/Job Boards/${b.name}/access-and-instructions.local.md`, architecturePath: `${b.contextPath}/architecture.local.md` };
}
function scaffold(root: string, s: SiteRecord) {
  const publicMap = s.architecturePath.replace(/\.local\.md$/, ".md");
  const base = existsSync(siteFile(root, publicMap, false)) ? `\nReusable base knowledge: ${publicMap}. Read it with these private notes; do not discard its observations.\n` : "";
  createSiteFile(root, s.accessPath, `# Website access\n\nSite: ${s.origin}${s.scopePath === "/" ? "" : s.scopePath}\nSite ID: ${s.id}\n\nAuthentication: not yet established. Use public access or an authorized existing session first.\nAccount/registration instructions: not supplied; read the selected candidate's actual instructions.\nCredential source: not configured. Create a private .env only for a selected password flow.\nAccess challenge: inspect actual saved task/session evidence. Creating this file does not resolve it.\n`);
  createSiteFile(root, s.architecturePath, `# Observed website knowledge\n\nSite ID: ${s.id}\nAccount boundary: ${s.origin}${s.scopePath === "/" ? "" : s.scopePath}\n${base}\nPrivate branch navigation: unlearned.\nApplication route: unlearned.\nForms, upload and confirmation: unverified.\nLearn only the assigned journey, with actual evidence and refresh conditions. Folder creation does not establish access.\n`);
  for (const file of ["pages", "application-flow"]) if (!existsSync(siteFile(root, `${s.methodDirectory}/playwright/${file}.ts`, false))) createSiteFile(root, `${s.methodDirectory}/playwright/${file}.local.ts`, `export const knowledgeState = "unlearned";\nexport function ${file === "pages" ? "recognize" : "apply"}(): never { throw new Error("DiscoveryRequired: observe and verify this site before browser actions."); }\n`);
  createSiteFile(root, `${s.methodDirectory}/in-app/actions.local.md`, "# In-app browser actions\n\nUnlearned. Record actual tool, page conditions, steps and outcome checks. Do not translate Playwright selectors into assumed host commands.\n");
}
/** Files first, registry last. A crash can leave private scaffolds; the same identity repairs only missing parts. */
export function ensureSite(root: string, request: SiteRequest): { action: "prepared"; site: SiteRecord } | { action: "followDestination"; kind: "tracker" | "identityProvider" } {
  siteFile(root, registryFile); checkSiteEvidence(root, request.observation);
  const url = siteUrl(request.url);
  if (["tracker", "identityProvider"].includes(request.kind)) return { action: "followDestination", kind: request.kind as "tracker" | "identityProvider" };
  if (!["board", "destination", "direct"].includes(request.kind) || !request.label?.trim() || request.label.length > 100 || /[\r\n]/.test(request.label)) throw new Error("Classify the observed website before preparing context.");
  const scopePath = boundary(request.scopePath), id = identity(url.origin, scopePath);
  if (!matchesSite({ origin: url.origin, scopePath } as SiteRecord, url.href)) throw new Error("The observed URL is outside the selected account boundary.");
  if (/(^|\.)(greenhouse\.io|lever\.co|smartrecruiters\.com|myworkdaysite\.com)$/.test(url.hostname) && scopePath === "/") throw new Error("This shared ATS needs its observed employer/tenant path; do not merge accounts by vendor domain.");
  const ownership = acquireOwnership(root, "write:site-preparation", { waitMs: 30000 });
  try {
    const loaded = loadSites(root), state = structuredClone(loaded.state);
    const parent = request.parentSiteId ? state.sites.find(s => s.id === request.parentSiteId) : undefined;
    if (request.kind === "destination" && !parent || request.parentSiteId && !parent || parent?.id === id) throw new Error("A destination needs its registered originating site; direct applications need no invented source.");
    let s = state.sites.find(s => s.id === id);
    if (s && request.context && (s.accessPath !== request.context.accessPath || s.architecturePath !== request.context.architecturePath)) throw new Error("Reuse the existing canonical site paths instead of replacing them.");
    if (!s) {
      const context = request.context ?? primaryContext(root, url.origin, scopePath);
      const folder = `${request.label.replace(/[^a-zA-Z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 65) || "Website"}-${id.slice(5, 13)}`;
      const knowledge = parent ? `${parent.methodDirectory}/Application destinations/${folder}` : `Site Architecture Context/${folder}`;
      s = { id, label: request.label, origin: url.origin, scopePath, kinds: [request.kind as SiteKind], parents: parent ? [parent.id] : [],
        observations: [request.observation], accessPath: context?.accessPath ?? (parent ? `${parent.accessPath.slice(0, -"/access-and-instructions.local.md".length)}/Application destinations/${folder}` : `Job Context/${request.kind === "board" ? "Job Boards" : "Application destinations"}/${folder}`) + "/access-and-instructions.local.md",
        architecturePath: context?.architecturePath ?? `${knowledge}/architecture.local.md`, methodDirectory: "" };
      s.methodDirectory = s.architecturePath.slice(0, -"/architecture.local.md".length);
      state.sites.push(s);
    }
    if (!s.kinds.includes(request.kind as SiteKind)) s.kinds.push(request.kind as SiteKind);
    if (parent && !s.parents.includes(parent.id)) s.parents.push(parent.id);
    if (!s.observations.some(e => e.path === request.observation.path && e.sha256 === request.observation.sha256)) s.observations.push(request.observation);
    // Check every path/collision before writing any files.
    pathsOK(root, s);
    for (const other of state.sites.filter(v => v.id !== id)) if ([s.accessPath, s.architecturePath].some(p => [other.accessPath, other.architecturePath].some(v => p.toLowerCase() === v.toLowerCase()))) throw new Error("Keep separate tenant contexts; do not overwrite another identity.");
    scaffold(root, s);
    if (parent && !s.methodDirectory.startsWith(parent.methodDirectory + "/Application destinations/")) {
      createSiteFile(root, `${parent.methodDirectory}/Application destinations/${s.id}/reference.local.md`, `# Existing application destination\n\nSite ID: ${s.id}\nCanonical access: ${s.accessPath}\nCanonical architecture: ${s.architecturePath}\nUse the existing observed methods at ${s.methodDirectory}; do not duplicate account context.\n`);
    }
    if (JSON.stringify(state) !== JSON.stringify(loaded.state)) savePrivateJson(root, registryFile, state, loaded.revision);
    return { action: "prepared" as const, site: s };
  } finally { ownership.release(); }
}
/** Password setup is explicit, local and separate from context preparation. No plaintext is returned. */
export function prepareSitePassword(root: string, siteId: string) {
  const site = loadSites(root).state.sites.find(s => s.id === siteId);
  if (!site) throw new Error("Prepare the observed site first.");
  const path = site.accessPath.replace(/access-and-instructions\.local\.md$/, ".env");
  const created = createSiteFile(root, path, "# Uncomment and fill locally only for this site's password flow.\n# USERNAME=\n# PASSWORD=\n");
  return { path, created, nextAction: "Use the actual user-selected authentication method; file presence does not prove readiness." };
}
