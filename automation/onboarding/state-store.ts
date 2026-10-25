import { readFileSync, existsSync, realpathSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createProgress, migrateProgress, validateProgress, refreshProgress, readiness, mappingAreas,
  preparationIds, type OnboardingProgress, type EvidenceReference, type ProgressCheck } from "./progress.js";
import { loadBrowserPreferences } from "../browser/preferences-store.js";
import { validateCapabilityReport, capabilityIssues } from "../browser/capabilities.js";
import { validateOperatingPreferences } from "../scheduling/preferences.js";

export function digest(value: string | Buffer) { return createHash("sha256").update(value).digest("hex"); }
function contained(root: string, path: string): string {
  const absolute = resolve(root, path);
  const part = relative(realpathSync(root), existsSync(absolute) ? realpathSync(absolute) : absolute);
  if (part === ".." || part.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(part)) throw new Error("Progress references must stay inside this working copy.");
  return absolute;
}
export function evidenceReference(root: string, path: string): EvidenceReference {
  const absolute = contained(root, path);
  return { path: relative(root, absolute).replaceAll("\\", "/"), sha256: digest(readFileSync(absolute)) };
}
export function completedCheck(root: string, paths: string[], now: string): ProgressCheck {
  if (!paths.length) throw new Error("Actual evidence references are required.");
  return { status: "complete", evidence: paths.map(path => evidenceReference(root, path)), checkedAt: now, nextAction: null, reason: null };
}
export function loadProgress(root: string, now = new Date().toISOString()) {
  const path = contained(root, ".local/onboarding-state.json");
  if (!existsSync(path)) return { state: createProgress(), revision: null, migrated: false };
  const bytes = readFileSync(path);
  let data;
  try { data = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error("Onboarding progress is unreadable. Preserve the file and investigate; candidate records remain authoritative."); }
  return { state: migrateProgress(data, now), revision: digest(bytes), migrated: data.schemaVersion !== 3 };
}

/** Atomic, revision-checked saves; no state or credentials may be published through this helper. */
export function saveProgress(root: string, state: OnboardingProgress, expectedRevision: string | null): boolean {
  validateProgress(state);
  const folder = resolve(root, ".local");
  mkdirSync(folder, { recursive: true });
  contained(root, ".local");
  const path = contained(root, ".local/onboarding-state.json");
  const current = existsSync(path) ? readFileSync(path) : null;
  if ((current ? digest(current) : null) !== expectedRevision) throw new Error("Onboarding changed in another session; reload it before saving.");
  const tracked = execFileSync("git", ["-C", root, "ls-files", "--", ".local/onboarding-state.json"], { encoding: "utf8", windowsHide: true });
  if (tracked.trim()) throw new Error("Private onboarding progress is tracked by Git; stop and correct storage before saving.");
  try { execFileSync("git", ["-C", root, "check-ignore", "--no-index", "--quiet", ".local/onboarding-state.json"], { windowsHide: true }); }
  catch { throw new Error("Private onboarding progress must be ignored by Git."); }
  const contents = JSON.stringify(state, null, 2) + "\n";
  if (current?.toString("utf8") === contents) return false;
  const temporary = resolve(folder, `onboarding-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, contents, { flag: "wx", mode: 0o600 });
    // Recheck immediately before replacement; agents must also coordinate one writer.
    const latest = existsSync(path) ? digest(readFileSync(path)) : null;
    if (latest !== expectedRevision) throw new Error("Onboarding changed in another session; reload it before saving.");
    renameSync(temporary, path);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  return true;
}

export function inspectReadiness(root: string, source: OnboardingProgress) {
  const state = refreshProgress(source);
  const invalidEvidence: string[] = [];
  const checks: [string, ProgressCheck][] = [
    ["candidateProfiles", state.steps.candidateProfiles], ["applicationInstructions", state.steps.applicationInstructions],
  ];
  if (state.scope && state.scope !== "profileSetup") {
    checks.push(["browserTools", state.steps.browserTools]);
    for (const id of preparationIds) checks.push([id, state.preparation[id]]);
    if (["emailApplications", "bothApplications"].includes(state.scope)) checks.push(["emailConnection", state.emailConnection]);
    for (const board of state.boards.filter(value => !value.deferred)) {
      checks.push([`${board.name}:access`, board.access]);
      for (const area of mappingAreas) checks.push([`${board.name}:${area}`, board.mapping[area]]);
    }
  }
  for (const [label, check] of checks) {
    for (const reference of check.evidence) {
      try {
        if (evidenceReference(root, reference.path).sha256 !== reference.sha256) {
          invalidEvidence.push(`${label}: saved evidence changed; recheck the affected step.`);
          check.status = "inProgress"; check.nextAction = "Revalidate the changed evidence before recording completion.";
        }
      } catch {
        invalidEvidence.push(`${label}: saved evidence is unavailable in this working copy.`);
        check.status = "inProgress"; check.nextAction = "Locate and verify this evidence in the working copy.";
      }
    }
  }
  if (state.steps.browserTools.status === "complete" && state.scope !== "profileSetup") {
    try {
      const report = JSON.parse(readFileSync(contained(root, ".local/browser-readiness.json"), "utf8"));
      const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
      if (report.ready !== true || report.fingerprint?.root !== root || report.fingerprint.platform !== process.platform ||
        report.fingerprint.arch !== process.arch || report.fingerprint.nodeMajor !== Number(process.versions.node.split(".")[0]) ||
        report.fingerprint.cliVersion !== pkg.devDependencies["@playwright/cli"] || report.fingerprint.libraryVersion !== pkg.devDependencies.playwright ||
        !existsSync(resolve(root, "node_modules/@playwright/cli/playwright-cli.js")) ||
        report.capabilities?.fileUpload !== true ||
        !Array.isArray(report.checks) || report.checks.length !== 2 ||
        report.checks.some((check: { installed?: boolean; executablePath?: string }) => !check.installed || !check.executablePath || !existsSync(check.executablePath))) throw new Error();
    } catch {
      invalidEvidence.push("browserTools: verify the CLI in this working copy and runtime before marking it ready.");
      state.steps.browserTools.status = "inProgress";
      state.steps.browserTools.nextAction = "Run the local browser setup/check and record its actual successful report.";
    }
  }
  if (state.scope && state.scope !== "profileSetup" && state.preparation.browserChoice.status === "complete") {
    let preferences;
    try {
      preferences = loadBrowserPreferences(root).preferences;
      if (!preferences.choice) throw new Error();
    } catch {
      invalidEvidence.push("browserChoice: preserve and resolve the missing or unreadable user preference.");
      state.preparation.browserChoice.status = "inProgress";
    }
    if (preferences?.choice) {
      try {
        if (!preferences.resolvedDefault) throw new Error();
        if (preferences.resolvedDefault === "inApp") {
          const report = JSON.parse(readFileSync(contained(root, ".local/browser-in-app.json"), "utf8"));
          validateCapabilityReport(report);
          if (report.backend !== "inApp" || capabilityIssues(report, root, "interactive", false).length) throw new Error();
          for (const check of Object.values(report.capabilities)) for (const ref of check.evidence) {
            if (evidenceReference(root, ref.path).sha256 !== ref.sha256) throw new Error();
          }
        }
      } catch {
        invalidEvidence.push("browserTools: verify the selected host browser or resolve automatic selection from actual capabilities; the saved preference remains unchanged.");
        state.steps.browserTools.status = "inProgress";
        state.steps.browserTools.nextAction = "Verify the chosen browser through its actual host tools; preserve known choices and the upload fallback.";
      }
    }
  }
  if (state.scope && state.scope !== "profileSetup" && state.preparation.scheduleChoice.status === "complete") {
    let operating;
    try {
      operating = JSON.parse(readFileSync(contained(root, ".local/operation-preferences.json"), "utf8"));
      validateOperatingPreferences(operating);
    } catch {
      invalidEvidence.push("scheduleChoice: preserve and resolve the missing or invalid operating choice.");
      state.preparation.scheduleChoice.status = "inProgress";
    }
    if (operating) {
      try {
        if (operating.mode === "onDemand") {
          if (state.preparation.scheduledAccess.status !== "skipped") throw new Error();
        } else {
          if (!operating.scheduleReference?.trim() || state.preparation.scheduledAccess.status !== "complete") throw new Error();
          const { preferences } = loadBrowserPreferences(root);
          if (!preferences.resolvedDefault) throw new Error();
          const required = preferences.resolvedDefault === "inApp" ? ["inApp", "playwright"] : ["playwright"];
          for (const backend of required) {
            const reportPath = backend === "inApp" ? ".local/browser-in-app-scheduled.json" : ".local/browser-playwright-scheduled.json";
            const report = JSON.parse(readFileSync(contained(root, reportPath), "utf8"));
            validateCapabilityReport(report);
            if (report.backend !== backend || capabilityIssues(report, root, "scheduled", backend === "playwright").length) throw new Error();
            for (const check of Object.values(report.capabilities)) for (const ref of check.evidence) {
              if (evidenceReference(root, ref.path).sha256 !== ref.sha256) throw new Error();
            }
          }
        }
      } catch {
        invalidEvidence.push("scheduledAccess: verify the requested schedule and its selected browser/fallback in the actual scheduled environment.");
        state.preparation.scheduledAccess.status = "inProgress";
      }
    }
  }
  if (state.steps.readiness.status === "complete") {
    for (const reference of state.steps.readiness.evidence) {
      try { if (evidenceReference(root, reference.path).sha256 !== reference.sha256) throw new Error(); }
      catch {
        invalidEvidence.push("readiness: the saved handoff changed or is unavailable; refresh it.");
        state.steps.readiness.status = "inProgress";
      }
    }
  }
  const refreshed = refreshProgress(state);
  const result = readiness(refreshed);
  return { ...result, ready: result.ready && !invalidEvidence.length, blockers: [...result.blockers, ...invalidEvidence], invalidEvidence, state: refreshed };
}
