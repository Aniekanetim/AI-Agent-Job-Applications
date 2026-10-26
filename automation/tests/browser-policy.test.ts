import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, cpSync } from "node:fs";
import { join, resolve, relative, isAbsolute, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { selectBrowser, emptyBrowserPreferences, resolveAutomaticBrowser, validateBrowserPreferences } from "../browser/preferences.js";
import { browserOperations, capabilityIssues, validateCapabilityReport, type BrowserCapabilityReport } from "../browser/capabilities.js";
import { beginBrowserExecution, decideBrowser, saveUploadHandoff, resumeUploadHandoff } from "../browser/fallback.js";
import { loadBrowserPreferences, saveBrowserPreferences } from "../browser/preferences-store.js";
import { validateOperatingPreferences, amendOperatingPreferences, type OperatingPreferences } from "../scheduling/preferences.js";
import { createProgress, configureProgress, newBoard, emptyCheck, migrateProgress } from "../onboarding/progress.js";
import { completedCheck, inspectReadiness, evidenceReference, loadProgress } from "../onboarding/state-store.js";
import { readPrivateJson, savePrivateJson } from "../workflow/private-json.js";
import { resumeOnboarding } from "../onboarding/conversation.js";
import type { ApplicationTask } from "../workflow/application-state.js";
import { canMarkApplied } from "../workflow/application-state.js";

const now = "2026-10-25T12:00:00.000Z";
const preferences = selectBrowser("inApp", "synthetic-user-choice", now);
const available = { inApp: true, playwright: true };
const jobUrl = "https://employer.test/jobs/qa-1";
const task: ApplicationTask = { taskId: "synthetic-task", originalIntake: "Email Alerts", selectedRoleId: "qa",
  cvVersion: "synthetic-v1", cvSha256: "a".repeat(64), checkpoint: "working" };
function sandbox(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "application-browser-policy-"));
  execFileSync("git", ["init", "--quiet", root], { windowsHide: true });
  writeFileSync(join(root, ".gitignore"), ".local/\n");
  t.after(() => { const part = relative(tmpdir(), resolve(root)); assert.ok(part && !part.startsWith("..") && !isAbsolute(part)); rmSync(root, { recursive: true }); });
  return root;
}

test("a saved in-app choice remains the default while required uploads route to Playwright", () => {
  assert.equal(beginBrowserExecution(task, preferences, available, false).browserExecution?.activeBrowser, "inApp");
  const upload = beginBrowserExecution(task, preferences, available, true);
  assert.equal(upload.browserExecution?.activeBrowser, "playwright");
  assert.equal(upload.browserExecution?.defaultBrowser, "inApp");
  assert.equal(preferences.resolvedDefault, "inApp"); assert.equal(task.browserExecution, undefined);
  assert.equal(beginBrowserExecution({ ...task, taskId: "next-task" }, preferences, available, null).browserExecution?.activeBrowser, "inApp");
});

test("automatic selection requires actual capability assessment; installation is not a user choice", () => {
  const empty = emptyBrowserPreferences(); assert.equal(empty.choice, null);
  const automatic = selectBrowser("automatic", "synthetic-choice", now);
  assert.equal(automatic.resolvedDefault, null);
  assert.equal(resolveAutomaticBrowser(automatic, { inApp: false, playwright: true }, "actual-report").resolvedDefault, "playwright");
  assert.equal(resolveAutomaticBrowser(automatic, { inApp: true, playwright: true }, "actual-report").resolvedDefault, "inApp");
  assert.equal(resolveAutomaticBrowser(automatic, { inApp: false, playwright: false }, "actual-report").resolvedDefault, null);
  assert.throws(() => validateBrowserPreferences({ ...preferences, resolvedDefault: "playwright" }));
});

test("unknown upload requirements use the default; a later requirement preserves task and role/CV identity", () => {
  const initial = beginBrowserExecution(task, preferences, available, null);
  const decision = decideBrowser(initial, preferences, available, true);
  assert.equal(decision.action, "switch");
  const saved = saveUploadHandoff(initial, jobUrl, ".local/synthetic-checkpoint.md", now);
  assert.equal(saved.taskId, initial.taskId); assert.equal(saved.selectedRoleId, initial.selectedRoleId);
  assert.equal(saved.cvSha256, initial.cvSha256); assert.equal(saved.originalIntake, initial.originalIntake);
  assert.equal(saved.browserExecution?.handoffs[0].state, "awaitingResume");
  assert.equal(initial.browserExecution?.handoffs.length, 0);
  assert.equal(decideBrowser(saved, preferences, available, true).action, "blocked");
});

test("resumption checks the same vacancy, authorized session, draft and submission state", () => {
  const saved = saveUploadHandoff(beginBrowserExecution(task, preferences, available, false), jobUrl, "checkpoint", now);
  const evidence = { taskId: task.taskId, jobUrl, sameVacancyVerified: true, sessionVerified: true,
    draftInspected: true, submissionStateChecked: true, evidenceReference: "private-recovery-evidence" };
  assert.throws(() => resumeUploadHandoff(saved, { ...evidence, jobUrl: "https://other.test/jobs/2" }));
  for (const field of ["sameVacancyVerified", "sessionVerified", "draftInspected", "submissionStateChecked"] as const) {
    assert.throws(() => resumeUploadHandoff(saved, { ...evidence, [field]: false }));
  }
  const resumed = resumeUploadHandoff(saved, evidence);
  assert.equal(resumed.browserExecution?.activeBrowser, "playwright");
  assert.equal(resumed.browserExecution?.handoffs.at(-1)?.state, "resumed");
  const nextPage = decideBrowser(resumed, preferences, available, false);
  assert.equal(nextPage.action, "continue");
  if (nextPage.action === "continue") assert.equal(nextPage.backend, "playwright");
});

test("an uncertain or confirmed submission never becomes a new browser execution", () => {
  assert.equal(decideBrowser({ ...task, checkpoint: "submissionAttempted" }, preferences, available, true).action, "resolveOutcome");
  assert.equal(decideBrowser({ ...task, checkpoint: "confirmed" }, preferences, available, true).action, "finished");
  assert.throws(() => beginBrowserExecution({ ...task, checkpoint: "submissionAttempted" }, preferences, available, true));
});

test("permission denial and missing fallback remain blockers; missing in-app access does not change a chosen default", () => {
  assert.equal(decideBrowser(task, preferences, available, true, true).action, "blocked");
  assert.equal(decideBrowser(task, preferences, { inApp: true, playwright: false }, true).action, "blocked");
  assert.equal(decideBrowser(task, preferences, { inApp: false, playwright: true }, false).action, "blocked");
  assert.equal(preferences.resolvedDefault, "inApp");
});

test("an unresolved browser handoff cannot be moved to Applied even with caller-supplied confirmation", () => {
  const saved = saveUploadHandoff(beginBrowserExecution(task, preferences, available, false), jobUrl, "checkpoint", now);
  assert.equal(canMarkApplied({ ...saved, checkpoint: "confirmed", confirmation: { reference: "synthetic-confirmation", observedAt: now } }), false);
});

test("capability reports distinguish unsupported uploads, denied operations and scheduled contexts", () => {
  const report: BrowserCapabilityReport = { schemaVersion: 1, backend: "inApp", providerId: "synthetic-host",
    workingRoot: "/synthetic", executionContext: "interactive", checkedAt: now,
    capabilities: Object.fromEntries(browserOperations.map(operation => [operation, {
      status: "verified", evidence: [{ path: "synthetic-proof.md", sha256: "a".repeat(64) }], reason: null,
    }])) as BrowserCapabilityReport["capabilities"] };
  report.capabilities.fileUpload = { ...report.capabilities.fileUpload, status: "unsupported", reason: "Host supports navigation but not upload." };
  validateCapabilityReport(report);
  assert.equal(capabilityIssues(report, "/synthetic", "interactive", false).length, 0);
  assert.ok(capabilityIssues(report, "/synthetic", "interactive", true).some(value => value.includes("fileUpload")));
  assert.ok(capabilityIssues(report, "/synthetic", "scheduled", false).length);
  report.capabilities.fileUpload.status = "denied";
  assert.ok(capabilityIssues(report, "/synthetic", "interactive", false).length);
  report.capabilities.navigation.evidence = [];
  assert.throws(() => validateCapabilityReport(report));
});

test("private browser preferences are reference-safe, revision-checked and never inferred from a clone", t => {
  const root = sandbox(t); const initial = loadBrowserPreferences(root);
  assert.equal(initial.preferences.choice, null);
  saveBrowserPreferences(root, preferences, initial.revision);
  const saved = loadBrowserPreferences(root); assert.deepEqual(saved.preferences, preferences);
  assert.throws(() => saveBrowserPreferences(root, preferences, null), /another session/);
  assert.equal(readFileSync(join(root, ".local/browser-preferences.json"), "utf8").includes("password"), false);
});

test("a missing in-app provider keeps the user's choice and reopens tooling instead of asking the choice again", t => {
  const root = sandbox(t); saveBrowserPreferences(root, preferences, null);
  const state = configureProgress(createProgress(), "manualApplications", [newBoard("Example", "https://example.test/", "Site Architecture Context/Example")], now);
  state.preparation.browserChoice = completedCheck(root, [".local/browser-preferences.json"], now);
  const inspected = inspectReadiness(root, state);
  assert.equal(inspected.state.preparation.browserChoice.status, "complete");
  assert.equal(inspected.state.steps.browserTools.status, "inProgress");
  assert.equal(loadBrowserPreferences(root).preferences.choice, "inApp");
});

test("schema-2 migration retains old evidence without choosing a default or losing existing conversations", () => {
  const state = createProgress();
  const { preparation: _preparation, ...old } = state;
  const input = { ...old, schemaVersion: 2, phase: "complete", pendingQuestions: [{ id: "existing-question" }],
    customSource: { checkpoint: "preserve" }, steps: { ...state.steps, browserTools: { ...emptyCheck("complete"), checkedAt: now, evidence: [{ path: "old-browser-report.json", sha256: "a".repeat(64) }] } } };
  const migrated = migrateProgress(input, now);
  assert.equal(migrated.schemaVersion, 3); assert.equal(migrated.phase, "inProgress");
  assert.deepEqual(migrated.steps.browserTools, input.steps.browserTools);
  assert.deepEqual(migrated.pendingQuestions, input.pendingQuestions);
  assert.deepEqual(migrated.customSource, input.customSource);
  assert.equal(migrated.preparation.browserChoice.status, "pending");
});

test("operating choices validate explicit cadence/timezone and limits without starting a schedule", () => {
  const base = { schemaVersion: 1, mode: "onDemand", cadence: null, timezone: null, perRunLimit: null,
    perDayLimit: null, reporting: "unspecified", sourceReference: "synthetic-choice", scheduleReference: null };
  assert.doesNotThrow(() => validateOperatingPreferences(base));
  assert.throws(() => validateOperatingPreferences({ ...base, perDayLimit: -1 }));
  assert.throws(() => validateOperatingPreferences({ ...base, perDayLimit: 5 }), /timezone/);
  assert.throws(() => validateOperatingPreferences({ ...base, mode: "recurring" }));
  assert.throws(() => validateOperatingPreferences({ ...base, mode: "recurring", cadence: "hourly", timezone: "not-a-zone" }));
  assert.doesNotThrow(() => validateOperatingPreferences({ ...base, mode: "recurring", cadence: "hourly", timezone: "Africa/Lagos" }));
});

function preparedFixture(t: TestContext, backend: "inApp" | "playwright" = "playwright") {
  const root = sandbox(t);
  const save = (path: string, data: unknown) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof data === "string" ? data : JSON.stringify(data));
  };
  save(".local/synthetic-evidence.md", "Synthetic evidence only; no live account or application.");
  const actual = () => completedCheck(root, [".local/synthetic-evidence.md"], now);
  const state = configureProgress(createProgress(), "manualApplications", [newBoard("Example", "https://example.test/", "Site Architecture Context/Example")], now);
  state.selectedRoles = [{ roleId: "synthetic" }];
  state.steps.candidateProfiles = actual(); state.steps.applicationInstructions = actual();
  for (const id of Object.keys(state.preparation) as (keyof typeof state.preparation)[]) state.preparation[id] = actual();
  state.boards[0].access = actual();
  for (const area of Object.keys(state.boards[0].mapping) as (keyof typeof state.boards[0]["mapping"])[]) state.boards[0].mapping[area] = actual();
  const pkg = { devDependencies: { "@playwright/cli": "synthetic-cli", playwright: "synthetic-library" } };
  save("package.json", pkg); save("node_modules/@playwright/cli/playwright-cli.js", "// Synthetic installed CLI marker, never executed.");
  save(".local/synthetic-browser.exe", "Synthetic executable marker, never executed.");
  save(".local/browser-readiness.json", { ready: true, visibility: "headed", capabilities: { fileUpload: true },
    fingerprint: { root, platform: process.platform, arch: process.arch, nodeMajor: Number(process.versions.node.split(".")[0]), cliVersion: "synthetic-cli", libraryVersion: "synthetic-library" },
    checks: ["cli", "library"].map(kind => ({ kind, installed: true, executablePath: join(root, ".local/synthetic-browser.exe") })) });
  state.steps.browserTools = completedCheck(root, [".local/browser-readiness.json"], now);
  saveBrowserPreferences(root, selectBrowser(backend, "synthetic-user-choice", now), null);
  state.preparation.browserChoice = completedCheck(root, [".local/browser-preferences.json"], now);
  const operating = { schemaVersion: 1, mode: "onDemand", cadence: null, timezone: null, perRunLimit: null,
    perDayLimit: null, reporting: "summary", sourceReference: "synthetic-choice", scheduleReference: null };
  save(".local/operation-preferences.json", operating);
  state.preparation.scheduleChoice = completedCheck(root, [".local/operation-preferences.json"], now);
  state.preparation.scheduledAccess = { ...actual(), status: "skipped", reason: "Explicit on-demand choice." };
  const report = (browser: "inApp" | "playwright", context: "interactive" | "scheduled"): BrowserCapabilityReport => ({
    schemaVersion: 1, backend: browser, providerId: "synthetic-provider", workingRoot: root, executionContext: context, checkedAt: now,
    capabilities: Object.fromEntries(browserOperations.map(operation => [operation, {
      status: operation === "fileUpload" && browser === "inApp" ? "unsupported" : "verified",
      evidence: [evidenceReference(root, ".local/synthetic-evidence.md")],
      reason: operation === "fileUpload" && browser === "inApp" ? "Synthetic unsupported upload condition." : null,
    }])) as BrowserCapabilityReport["capabilities"],
  });
  if (backend === "inApp") save(".local/browser-in-app.json", report("inApp", "interactive"));
  return { root, state, save, report, operating, actual };
}

test("on-demand readiness accepts a verified default and upload fallback without inventing a schedule", t => {
  const fixture = preparedFixture(t);
  assert.equal(inspectReadiness(fixture.root, fixture.state).ready, true);
  assert.equal(JSON.parse(readFileSync(join(fixture.root, ".local/operation-preferences.json"), "utf8")).scheduleReference, null);
});

test("old headless rehearsal evidence cannot establish visible-browser readiness", t => {
  const { root, state, save } = preparedFixture(t);
  const report = JSON.parse(readFileSync(join(root, ".local/browser-readiness.json"), "utf8"));
  delete report.visibility; save(".local/browser-readiness.json", report);
  state.steps.browserTools = completedCheck(root, [".local/browser-readiness.json"], now);
  const checked = inspectReadiness(root, state);
  assert.equal(checked.ready, false); assert.equal(checked.state.steps.browserTools.status, "inProgress");
  assert.equal(checked.state.steps.candidateProfiles.status, "complete");
  assert.deepEqual(checked.state.boards, state.boards);
});

test("continuing a verified completed setup does not restart its questions or preparation", t => {
  const { root, state, actual } = preparedFixture(t);
  state.steps.readiness = actual();
  savePrivateJson(root, ".local/onboarding-state.json", inspectReadiness(root, state).state, null);
  const before = readFileSync(join(root, ".local/onboarding-state.json"), "utf8");
  assert.equal(resumeOnboarding(root, "synthetic-continue", now).next.action, "complete");
  assert.equal(readFileSync(join(root, ".local/onboarding-state.json"), "utf8"), before);
});

test("operating amendments preserve unrelated choices and an existing schedule", () => {
  const old: OperatingPreferences = { schemaVersion: 1, mode: "recurring", cadence: "hourly", timezone: "Africa/Lagos",
    perRunLimit: 5, perDayLimit: 20, reporting: "summary", sourceReference: "synthetic-initial", scheduleReference: "synthetic-schedule" };
  const changed = amendOperatingPreferences(old, { reporting: "blockersOnly" }, "synthetic-change");
  assert.deepEqual(changed, { ...old, reporting: "blockersOnly", sourceReference: "synthetic-change" });
  assert.equal(amendOperatingPreferences(old, { perRunLimit: null }, "synthetic-no-limit").perRunLimit, null);
  assert.throws(() => amendOperatingPreferences(old, { cadence: "daily" }, "synthetic-change"), /scheduler/);
  assert.throws(() => amendOperatingPreferences(old, { mode: "onDemand" }, "synthetic-change"), /scheduler/);
  assert.equal(old.reporting, "summary"); assert.equal(old.perRunLimit, 5);
});

test("the operating CLI changes one field without clearing saved limits or interval", t => {
  const { root, save } = preparedFixture(t);
  cpSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."), resolve(root, ".local/build/automation"), { recursive: true });
  save("package.json", { type: "module", devDependencies: {} });
  const old: OperatingPreferences = { schemaVersion: 1, mode: "recurring", cadence: "daily", timezone: "Africa/Lagos", perRunLimit: 3,
    perDayLimit: 10, reporting: "summary", sourceReference: "synthetic-first", scheduleReference: "synthetic-schedule" };
  save(".local/operation-preferences.json", old);
  const run = (...args: string[]) => spawnSync(process.execPath, [join(root, ".local/build/automation/onboarding/cli.js"), "operation-choice", ...args], { cwd: root, encoding: "utf8", windowsHide: true });
  const result = run("--reporting", "digest", "--source", "synthetic-change"); assert.equal(result.status, 0, result.stderr);
  const read = () => JSON.parse(readFileSync(join(root, ".local/operation-preferences.json"), "utf8"));
  assert.deepEqual(read(), { ...old, reporting: "digest", sourceReference: "synthetic-change" });
  assert.equal(run("--cadence", "hourly", "--source", "synthetic-interval-change").status, 1);
  assert.deepEqual(read(), { ...old, reporting: "digest", sourceReference: "synthetic-change" });
});

test("an in-app default accepts an unsupported upload only with its independent Playwright proof", t => {
  const { root, state, save, report } = preparedFixture(t, "inApp");
  assert.equal(inspectReadiness(root, state).ready, true);
  const denied = report("inApp", "interactive"); denied.capabilities.fileUpload.status = "denied";
  save(".local/browser-in-app.json", denied);
  assert.equal(inspectReadiness(root, state).ready, false);
  save(".local/browser-in-app.json", report("inApp", "interactive"));
  writeFileSync(join(root, ".local/synthetic-evidence.md"), "Changed evidence, not yet verified.");
  const changed = inspectReadiness(root, state);
  assert.equal(changed.ready, false); assert.equal(changed.state.steps.browserTools.status, "inProgress");
  assert.equal(changed.state.preparation.browserChoice.status, "complete");
});

test("recurring readiness requires actual scheduled-context evidence for the default and upload fallback", t => {
  const { root, state, save, report, operating, actual } = preparedFixture(t, "inApp");
  const recurring = { ...operating, mode: "recurring", cadence: "hourly", timezone: "Africa/Lagos", scheduleReference: "synthetic-scheduler-id" };
  save(".local/operation-preferences.json", recurring);
  state.preparation.scheduleChoice = completedCheck(root, [".local/operation-preferences.json"], now);
  state.preparation.scheduledAccess = actual();
  save(".local/browser-in-app-scheduled.json", report("inApp", "interactive"));
  save(".local/browser-playwright-scheduled.json", report("playwright", "scheduled"));
  assert.equal(inspectReadiness(root, state).ready, false);
  save(".local/browser-in-app-scheduled.json", report("inApp", "scheduled"));
  assert.equal(inspectReadiness(root, state).ready, true);
  save(".local/operation-preferences.json", { ...recurring, scheduleReference: null });
  state.preparation.scheduleChoice = completedCheck(root, [".local/operation-preferences.json"], now);
  assert.equal(inspectReadiness(root, state).ready, false);
});

test("the onboarding CLI persists actual choices and preserves an existing native schedule", t => {
  const root = sandbox(t);
  writeFileSync(join(root, "package.json"), '{"type":"module"}');
  cpSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."), join(root, ".local/build/automation"), { recursive: true });
  const command = (...args: string[]) => spawnSync(process.execPath, [join(root, ".local/build/automation/onboarding/cli.js"), ...args], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(command("start", "--scope", "manualApplications", "--board", "Example|https://example.test/|Site Architecture Context/Example").status, 0);
  assert.equal(command("browser-choice", "--browser", "inApp", "--source", "synthetic-response").status, 0);
  assert.equal(loadBrowserPreferences(root).preferences.resolvedDefault, "inApp");
  assert.equal(loadProgress(root).state.preparation.browserChoice.status, "complete");
  assert.equal(command("operation-choice", "--mode", "onDemand", "--source", "synthetic-response", "--per-day-limit", "5", "--timezone", "Africa/Lagos", "--reporting", "summary").status, 0);
  const path = join(root, ".local/operation-preferences.json");
  const saved = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(saved.perDayLimit, 5); assert.equal(saved.scheduleReference, null);
  const stored = readPrivateJson(root, ".local/operation-preferences.json");
  savePrivateJson(root, ".local/operation-preferences.json", { ...saved, mode: "recurring", cadence: "hourly", timezone: "Africa/Lagos", scheduleReference: "synthetic-existing-id" }, stored.revision);
  const before = readFileSync(path);
  assert.equal(command("operation-choice", "--mode", "onDemand", "--source", "another-response").status, 1);
  assert.deepEqual(readFileSync(path), before);
});
