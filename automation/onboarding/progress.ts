export type OnboardingScope = "profileSetup" | "manualApplications" | "emailApplications" | "bothApplications";
export type ProgressStatus = "pending" | "inProgress" | "complete" | "blocked" | "skipped";
export type StepId = "boardSelection" | "browserTools" | "candidateProfiles" | "applicationInstructions" | "connections" | "siteMapping" | "readiness";
export const stepLabels: Record<StepId, string> = {
  boardSelection: "Select 1–3 primary job boards", browserTools: "Prepare automation tools and browser",
  candidateProfiles: "Import CVs and configure role profiles", applicationInstructions: "Save preferences and application instructions",
  connections: "Connect selected websites and email inbox", siteMapping: "Map selected boards and encountered application destinations",
  readiness: "Verify readiness and explain how to start",
};
export const stepIds = Object.keys(stepLabels) as StepId[];
export interface EvidenceReference { path: string; sha256: string }
export interface ProgressCheck {
  status: ProgressStatus;
  evidence: EvidenceReference[];
  checkedAt: string | null;
  nextAction: string | null;
  reason: string | null;
}
export const mappingAreas = ["navigation", "applicationRoute", "accessibleForms", "reusableCode", "limits"] as const;
export type MappingArea = typeof mappingAreas[number];
export const mappingLabels: Record<MappingArea, string> = {
  navigation: "Vacancy search and details", applicationRoute: "Application entry and destination",
  accessibleForms: "Accessible forms and review steps", reusableCode: "Reusable navigation methods", limits: "Unvisited branches and refresh conditions",
};
export interface BoardProgress {
  name: string;
  url: string;
  contextPath: string;
  access: ProgressCheck;
  mapping: Record<MappingArea, ProgressCheck>;
  deferred: { reason: string; sourceReference: string; recordedAt: string } | null;
}
export interface OnboardingProgress {
  schemaVersion: 2;
  scope: OnboardingScope | null;
  phase: "notStarted" | "inProgress" | "waitingForUser" | "complete";
  selectedRoles: unknown[];
  currentRoleId: string | null;
  pendingQuestions: unknown[];
  deferredQuestions: unknown[];
  contextRevisions: Record<string, string>;
  steps: Record<StepId, ProgressCheck>;
  boards: BoardProgress[];
  emailConnection: ProgressCheck;
  updatedAt: string | null;
  [key: string]: unknown;
}

export function emptyCheck(status: ProgressStatus = "pending", reason: string | null = null): ProgressCheck {
  return { status, evidence: [], checkedAt: null, nextAction: null, reason };
}
export function hasEmail(scope: OnboardingScope | null) {
  return scope === "emailApplications" || scope === "bothApplications";
}
export function createProgress(): OnboardingProgress {
  return { schemaVersion: 2, scope: null, phase: "notStarted", selectedRoles: [], currentRoleId: null,
    pendingQuestions: [], deferredQuestions: [], contextRevisions: {},
    steps: Object.fromEntries(stepIds.map(id => [id, emptyCheck()])) as Record<StepId, ProgressCheck>,
    boards: [], emailConnection: emptyCheck(), updatedAt: null };
}

export function newBoard(name: string, url: string, contextPath: string): BoardProgress {
  const value = new URL(url);
  if (!name.trim() || name.length > 100 || /[\r\n\0]/.test(name) || value.protocol !== "https:" ||
    value.username || value.password || value.search || value.hash || !contextPath.startsWith("Site Architecture Context/") ||
    contextPath.split(/[\\/]/).includes("..") || /[\r\n\0]/.test(contextPath)) throw new Error("Invalid board selection.");
  return { name: name.trim(), url: value.href, contextPath,
    access: emptyCheck(), mapping: Object.fromEntries(mappingAreas.map(area => [area, emptyCheck()])) as BoardProgress["mapping"], deferred: null };
}

export function configureProgress(state: OnboardingProgress, scope: OnboardingScope, boards: BoardProgress[], now: string): OnboardingProgress {
  if (!["profileSetup", "manualApplications", "emailApplications", "bothApplications"].includes(scope)) throw new Error("Unknown onboarding scope.");
  if (scope !== "profileSetup" && (boards.length < 1 || boards.length > 3)) throw new Error("Select one to three primary job boards.");
  if (new Set(boards.map(board => board.name.toLowerCase())).size !== boards.length ||
    new Set(boards.map(board => board.url)).size !== boards.length) throw new Error("Board selections must be distinct.");
  const next = structuredClone(state);
  next.scope = scope;
  next.boards = (scope === "profileSetup" && !boards.length ? state.boards : boards).map(board => {
    const existing = state.boards.find(old => old.name === board.name && old.url === board.url && old.contextPath === board.contextPath);
    return structuredClone(existing ?? board);
  });
  next.steps.boardSelection = scope === "profileSetup" ? emptyCheck("skipped", "Profile setup needs no job board.") :
    { ...emptyCheck("complete"), checkedAt: now, reason: "User-selected primary boards; additional websites remain available for assigned tasks." };
  for (const id of ["browserTools", "connections", "siteMapping"] as const) {
    if (scope === "profileSetup") next.steps[id] = emptyCheck("skipped", "Outside profile-only scope.");
    else if (next.steps[id].status === "skipped") next.steps[id] = emptyCheck();
  }
  if (!hasEmail(scope) && next.emailConnection.status === "pending") next.emailConnection = emptyCheck("skipped", "Email intake was not selected.");
  else if (next.emailConnection.status === "skipped") next.emailConnection = emptyCheck();
  next.steps.readiness = emptyCheck();
  next.phase = "inProgress"; next.updatedAt = now;
  return next;
}

/** Preserve every previous field, question and context reference; old 'complete' is not new proof. */
export function migrateProgress(input: unknown, now: string): OnboardingProgress {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid progress file; preserve it for investigation.");
  const data = input as Record<string, unknown>;
  if (data.schemaVersion === 2) { validateProgress(data); return structuredClone(data) as OnboardingProgress; }
  if (data.schemaVersion !== 1 || !Array.isArray(data.selectedRoles) || !Array.isArray(data.pendingQuestions) ||
    !Array.isArray(data.deferredQuestions) || typeof data.contextRevisions !== "object" || !data.contextRevisions) {
    throw new Error("Unsupported progress file; preserve it for investigation.");
  }
  const next = { ...createProgress(), ...structuredClone(data), schemaVersion: 2,
    phase: data.phase === "notStarted" ? "notStarted" : "inProgress", updatedAt: now,
    migration: { fromSchemaVersion: 1, previousPhase: data.phase, nextAction: "Check canonical saved context; revalidate only the relevant steps and select primary boards from the user's existing instructions." },
  } as OnboardingProgress;
  validateProgress(next);
  return next;
}

function validateCheck(value: unknown): asserts value is ProgressCheck {
  const data = value as ProgressCheck;
  if (!data || !["pending", "inProgress", "complete", "blocked", "skipped"].includes(data.status) || !Array.isArray(data.evidence) ||
    data.evidence.some(ref => !ref || typeof ref.path !== "string" || !ref.path || !/^[a-f0-9]{64}$/.test(ref.sha256)) ||
    !(data.checkedAt === null || (typeof data.checkedAt === "string" && Number.isFinite(Date.parse(data.checkedAt)))) ||
    ![data.nextAction, data.reason].every(value => value === null || typeof value === "string")) throw new Error("Invalid progress check.");
}
export function validateProgress(value: unknown): asserts value is OnboardingProgress {
  const state = value as OnboardingProgress;
  if (!state || state.schemaVersion !== 2 || ![null, "profileSetup", "manualApplications", "emailApplications", "bothApplications"].includes(state.scope) ||
    !["notStarted", "inProgress", "waitingForUser", "complete"].includes(state.phase) || !Array.isArray(state.selectedRoles) ||
    !Array.isArray(state.pendingQuestions) || !Array.isArray(state.deferredQuestions) || !state.contextRevisions ||
    typeof state.contextRevisions !== "object" || !state.steps || !Array.isArray(state.boards) || state.boards.length > 3) throw new Error("Invalid onboarding progress.");
  for (const id of stepIds) validateCheck(state.steps[id]);
  validateCheck(state.emailConnection);
  for (const board of state.boards) {
    newBoard(board.name, board.url, board.contextPath);
    validateCheck(board.access);
    for (const area of mappingAreas) validateCheck(board.mapping[area]);
    if (board.deferred && (!board.deferred.reason?.trim() || !board.deferred.sourceReference?.trim() ||
      !Number.isFinite(Date.parse(board.deferred.recordedAt)))) throw new Error("A board deferral requires the user's source and reason.");
  }
}

function evidenced(check: ProgressCheck) {
  return check.status === "complete" && !!check.checkedAt && check.evidence.length > 0;
}
export function readiness(state: OnboardingProgress): { ready: boolean; partial: boolean; blockers: string[]; deferredBoards: string[] } {
  validateProgress(state);
  const blockers: string[] = [];
  const deferredBoards = state.scope === "profileSetup" ? [] : state.boards.filter(board => board.deferred).map(board => board.name);
  if (!state.scope) blockers.push("Choose the setup scope.");
  if (!state.selectedRoles.length) blockers.push("Select and verify at least one candidate role and CV.");
  for (const id of ["candidateProfiles", "applicationInstructions"] as const) {
    if (!evidenced(state.steps[id])) blockers.push(stepLabels[id]);
  }
  if (state.pendingQuestions.length) blockers.push("Resolve the outstanding scope-required questions, or record an appropriate optional deferral.");
  if (state.scope && state.scope !== "profileSetup") {
    if (!state.boards.length) blockers.push("Select one to three primary job boards.");
    if (!evidenced(state.steps.browserTools)) blockers.push(stepLabels.browserTools);
    for (const board of state.boards.filter(board => !board.deferred)) {
      if (!evidenced(board.access)) blockers.push(`${board.name}: verify website access.`);
      for (const area of mappingAreas) {
        const check = board.mapping[area];
        const limited = ["accessibleForms", "reusableCode"].includes(area) && check.status === "skipped" && !!check.reason?.trim() &&
          !!check.checkedAt && check.evidence.length > 0;
        if (!evidenced(check) && !limited) blockers.push(`${board.name}: ${mappingLabels[area].toLowerCase()} mapping is unfinished.`);
      }
    }
    if (state.boards.length && state.boards.every(board => board.deferred)) blockers.push("At least one primary board must be prepared for application readiness.");
    if (hasEmail(state.scope) && !evidenced(state.emailConnection)) blockers.push("Verify the user's selected email inbox.");
  }
  return { ready: blockers.length === 0, partial: deferredBoards.length > 0, blockers, deferredBoards };
}

function aggregate(checks: ProgressCheck[]): ProgressCheck {
  if (checks.every(evidenced)) return { ...emptyCheck("complete"), evidence: checks.flatMap(check => check.evidence),
    checkedAt: checks.map(check => check.checkedAt!).sort().at(-1) ?? null };
  return emptyCheck(checks.some(check => check.status === "blocked") ? "blocked" : checks.some(check => check.status !== "pending") ? "inProgress" : "pending");
}
export function refreshProgress(state: OnboardingProgress): OnboardingProgress {
  const next = structuredClone(state);
  if (next.scope && next.scope !== "profileSetup") {
    const active = next.boards.filter(board => !board.deferred);
    next.steps.connections = active.length ? aggregate([...active.map(board => board.access), ...(hasEmail(next.scope) ? [next.emailConnection] : [])]) : emptyCheck();
    const checks = active.flatMap(board => mappingAreas.map(area => {
      const check = board.mapping[area];
      if (["accessibleForms", "reusableCode"].includes(area) && check.status === "skipped" && check.reason && check.checkedAt && check.evidence.length) {
        return { ...check, status: "complete" as const };
      }
      return check;
    }));
    next.steps.siteMapping = checks.length ? aggregate(checks) : emptyCheck();
  }
  const result = readiness(next);
  if (!result.ready) {
    next.steps.readiness = emptyCheck();
    if (next.phase !== "notStarted") next.phase = next.pendingQuestions.length ? "waitingForUser" : "inProgress";
  } else if (next.steps.readiness.status === "complete" && evidenced(next.steps.readiness)) next.phase = "complete";
  else next.phase = "inProgress";
  return next;
}

export function formatProgress(state: OnboardingProgress): string {
  const next = refreshProgress(state);
  const required = stepIds.filter(id => next.steps[id].status !== "skipped");
  const count = required.filter(id => next.steps[id].status === "complete").length;
  const symbol: Record<ProgressStatus, string> = { pending: "○", inProgress: "→", complete: "✓", blocked: "!", skipped: "–" };
  const result = readiness(next);
  const scopeNames = { profileSetup: "Candidate profile only", manualApplications: "Manual applications",
    emailApplications: "Email-alert applications", bothApplications: "Email alerts and manual applications" };
  const lines = [`Onboarding — ${count} of ${required.length} steps complete`, `Scope: ${next.scope ? scopeNames[next.scope] : "not selected"}`, ""];
  for (const id of required) {
    lines.push(`${symbol[next.steps[id].status]} ${stepLabels[id]}`);
    if (next.steps[id].nextAction && next.steps[id].status !== "complete") lines.push(`  Next: ${next.steps[id].nextAction}`);
  }
  for (const board of next.scope === "profileSetup" ? [] : next.boards) {
    lines.push("", board.deferred ? `${board.name} — deferred: ${board.deferred.reason}` : board.name);
    if (board.deferred) continue;
    lines.push(`${symbol[board.access.status]} Access`);
    if (board.access.nextAction && board.access.status !== "complete") lines.push(`  Next: ${board.access.nextAction}`);
    for (const area of mappingAreas) {
      const check = board.mapping[area];
      lines.push(`${symbol[check.status]} ${mappingLabels[area]}${check.reason ? ` — ${check.reason}` : ""}`);
      if (check.nextAction && check.status !== "complete") lines.push(`  Next: ${check.nextAction}`);
    }
  }
  if (result.partial) lines.push("", `Partial preparation: deferred boards — ${result.deferredBoards.join(", ")}.`);
  if (result.blockers.length) lines.push("", "Remaining work:", ...result.blockers.map(value => `- ${value}`));
  else lines.push("", next.phase === "complete" ? "Ready for the configured scope. No application has been submitted by onboarding." : "Required preparation is verified. Complete the readiness handoff.");
  return lines.join("\n");
}
