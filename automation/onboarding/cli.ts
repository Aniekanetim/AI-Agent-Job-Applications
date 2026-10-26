import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { configureProgress, newBoard, formatProgress, refreshProgress, mappingAreas, emptyCheck,
  preparationIds, type PreparationId, type OnboardingScope, type StepId, type MappingArea, type ProgressStatus } from "./progress.js";
import { loadProgress, saveProgress, completedCheck, evidenceReference, inspectReadiness } from "./state-store.js";
import { selectBrowser, resolveAutomaticBrowser, type BrowserChoice } from "../browser/preferences.js";
import { loadBrowserPreferences, saveBrowserPreferences } from "../browser/preferences-store.js";
import { readPrivateJson, savePrivateJson } from "../workflow/private-json.js";
import { validateCapabilityReport, capabilityIssues } from "../browser/capabilities.js";
import { amendOperatingPreferences, type OperatingPreferences, type OperatingPatch } from "../scheduling/preferences.js";
import { emailSetupStatus, formatEmailSetup } from "../email/onboarding.js";
import { inspectEmailReadiness } from "../email/state-store.js";

// Compiled location: .local/build/automation/onboarding/cli.js.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const args = process.argv.slice(2);
const command = args.shift() ?? "status";
const values = (key: string) => args.flatMap((value, index) => value === key ? [args[index + 1]] : []);
const value = (key: string) => values(key).at(-1);
const now = new Date().toISOString();
try {
  if (command === "help" || args.includes("--help")) {
    console.log(`Agent-managed onboarding commands (from the working root):
  status                       Show progress without writing
  start --scope S              Save the chosen scope and 1–3 boards for application mode
    --board 'NAME|HTTPS_URL|Site Architecture Context/NAME' (repeat up to three)
  migrate                      Preserve schema-1/2 context and add the new missing checks
  browser-choice --browser automatic|inApp|playwright --source REFERENCE
  browser-resolve --reference PATH   Resolve an automatic choice from actual browser reports
  operation-choice --mode onDemand|recurring --source REFERENCE
    --cadence TEXT --timezone IANA_NAME (required for recurring)
    --per-run-limit N|none --per-day-limit N|none --reporting summary|blockersOnly|digest|unspecified
    Later changes preserve omitted fields; --mode is required only for the first choice.
    --timezone IANA_NAME is also required for a daily limit in onDemand mode
  record --preparation ${preparationIds.join("|")} --reference PATH
  record --step ID --reference PATH (repeat references)
    --status pending|inProgress|complete|blocked|skipped (default complete)
    --next-action TEXT --reason TEXT (for checkpoints, blockers and observation boundaries)
  record --board NAME --area access|${mappingAreas.join("|")} --reference PATH
  record --email --reference PATH
  defer-board --board NAME --reason TEXT --source REFERENCE
  resume-board --board NAME
  check                        Validate preparation and references without writing
  finish --reference PATH      Verify preparation, save the handoff reference and mark scope complete
Scopes: profileSetup, manualApplications, emailApplications, bothApplications.
Record only observed checks. Use private state for an in-progress checkpoint or a
blocked/skipped mapping boundary with evidence, reason and next action. Never pass answers or secrets as arguments.`);
  } else {
    const loaded = loadProgress(root, now);
    let state = loaded.state;
    if (command === "start") {
      const scope = value("--scope") as OnboardingScope;
      if (!scope) throw new Error("The user's setup scope is required.");
      const boards = values("--board").map(spec => {
        const [name, url, path, extra] = (spec ?? "").split("|");
        if (!name || !url || !path || extra) throw new Error("Use NAME|HTTPS_URL|Site Architecture Context/NAME for each selected board.");
        return newBoard(name, url, path);
      });
      state = configureProgress(state, scope, boards, now);
    } else if (command === "browser-choice") {
      const existing = loadBrowserPreferences(root);
      const browser = value("--browser") as BrowserChoice;
      if (!["automatic", "inApp", "playwright"].includes(browser) || !value("--source")?.trim()) throw new Error("Record the user's actual browser choice and source.");
      saveBrowserPreferences(root, selectBrowser(browser, value("--source")!, now), existing.revision);
      state.preparation.browserChoice = completedCheck(root, [".local/browser-preferences.json"], now);
      state.steps.readiness = emptyCheck();
    } else if (command === "browser-resolve") {
      const existing = loadBrowserPreferences(root);
      let inApp = false, playwright = false;
      try {
        const found = readPrivateJson(root, ".local/browser-in-app.json").data;
        validateCapabilityReport(found); inApp = capabilityIssues(found, root, "interactive", false).length === 0;
      } catch { /* Missing/unsupported host tools remain unavailable. */ }
      const report = readPrivateJson(root, ".local/browser-readiness.json").data as { ready?: boolean; capabilities?: { fileUpload?: boolean }; fingerprint?: { root?: string } } | null;
      playwright = report?.ready === true && report.capabilities?.fileUpload === true && report.fingerprint?.root === root;
      const reference = value("--reference");
      if (!reference) throw new Error("Reference the actual capability comparison for automatic selection.");
      evidenceReference(root, reference);
      const resolved = resolveAutomaticBrowser(existing.preferences, { inApp, playwright }, reference);
      saveBrowserPreferences(root, resolved, existing.revision);
      state.preparation.browserChoice = completedCheck(root, [".local/browser-preferences.json", reference], now);
      state.steps.readiness = emptyCheck();
    } else if (command === "operation-choice") {
      const previous = readPrivateJson(root, ".local/operation-preferences.json");
      const patch: OperatingPatch = {};
      for (const [flag, key] of [["--mode", "mode"], ["--cadence", "cadence"], ["--timezone", "timezone"], ["--reporting", "reporting"]] as const) {
        if (value(flag) !== undefined) Object.assign(patch, { [key]: value(flag) });
      }
      for (const [flag, key] of [["--per-run-limit", "perRunLimit"], ["--per-day-limit", "perDayLimit"]] as const) {
        if (value(flag) !== undefined) patch[key] = value(flag) === "none" ? null : Number(value(flag));
      }
      const operating = amendOperatingPreferences(previous.data as OperatingPreferences | null, patch, value("--source") ?? "");
      savePrivateJson(root, ".local/operation-preferences.json", operating, previous.revision);
      state.preparation.scheduleChoice = completedCheck(root, [".local/operation-preferences.json"], now);
      state.preparation.operatingPreferences = completedCheck(root, [".local/operation-preferences.json"], now);
      if (operating.mode === "onDemand") state.preparation.scheduledAccess =
        { ...completedCheck(root, [".local/operation-preferences.json"], now), status: "skipped", reason: "User selected on-demand operation." };
      else if (!(previous.data as OperatingPreferences | null)?.scheduleReference) state.preparation.scheduledAccess = emptyCheck();
      else state.preparation.scheduledAccess.evidence = state.preparation.scheduledAccess.evidence.map(ref =>
        ref.path === ".local/operation-preferences.json" ? evidenceReference(root, ref.path) : ref);
      state.steps.readiness = emptyCheck();
    } else if (command === "record") {
      state.steps.readiness = emptyCheck();
      const status = (value("--status") ?? "complete") as ProgressStatus;
      if (!["pending", "inProgress", "complete", "blocked", "skipped"].includes(status)) throw new Error("Unknown step status.");
      const reason = value("--reason") ?? null, nextAction = value("--next-action") ?? null;
      if ((status === "blocked" && (!reason?.trim() || !nextAction?.trim())) ||
        (status === "inProgress" && !nextAction?.trim()) || (status === "skipped" && !reason?.trim())) throw new Error("Provide the checkpoint action, blocker reason/action or skip boundary.");
      const paths = values("--reference");
      const check = status === "complete" ? completedCheck(root, paths, now) :
        { ...emptyCheck(status), evidence: paths.map(path => evidenceReference(root, path)), checkedAt: paths.length ? now : null, reason, nextAction };
      const boardName = value("--board");
      if (boardName) {
        const board = state.boards.find(board => board.name === boardName);
        const area = value("--area");
        if (!board || !area || !["access", ...mappingAreas].includes(area)) throw new Error("Choose a selected board and its observed area.");
        if (area === "access") board.access = check;
        else board.mapping[area as MappingArea] = check;
      } else if (args.includes("--email")) state.emailConnection = check;
      else if (value("--preparation")) {
        const id = value("--preparation") as PreparationId;
        if (!preparationIds.includes(id)) throw new Error("Choose a known preparation check.");
        state.preparation[id] = check;
      }
      else {
        const id = value("--step") as StepId;
        if (!["browserTools", "candidateProfiles", "applicationInstructions"].includes(id)) throw new Error("Record browserTools, candidateProfiles or applicationInstructions; other steps are derived.");
        state.steps[id] = check;
      }
    } else if (["defer-board", "resume-board"].includes(command)) {
      state.steps.readiness = emptyCheck();
      const board = state.boards.find(board => board.name === value("--board"));
      if (!board) throw new Error("Choose a selected board.");
      if (command === "defer-board") {
        const reason = value("--reason"), sourceReference = value("--source");
        if (!reason?.trim() || !sourceReference?.trim()) throw new Error("A board deferral needs the user's actual reason and source reference.");
        board.deferred = { reason, sourceReference, recordedAt: now };
      } else board.deferred = null;
    } else if (command === "finish") {
      if (state.conversation?.mode === "paused" || state.conversation?.activeQuestionId || readPrivateJson(root, ".local/onboarding-pending-response.json").data !== null) throw new Error("Resume onboarding, recover any staged answer and resolve or explicitly defer its active question before finishing.");
      // An explicit new handoff replaces the old one after required preparation is checked.
      state.steps.readiness = emptyCheck();
      const result = inspectReadiness(root, state);
      if (!result.ready) throw new Error(`Setup is not ready:\n${result.blockers.join("\n")}`);
      state.steps.readiness = completedCheck(root, values("--reference"), now);
    } else if (!["status", "check", "migrate"].includes(command)) throw new Error("Unknown command. Use onboarding:help.");

    state = inspectReadiness(root, refreshProgress(state)).state;
    if (!["status", "check"].includes(command) && !(command === "migrate" && !loaded.migrated)) {
      state.updatedAt = now;
      saveProgress(root, state, loaded.revision);
    }
    console.log(formatProgress(state));
    if (["emailApplications", "bothApplications"].includes(state.scope ?? "")) {
      const email = inspectEmailReadiness(root, "interactive");
      console.log(`\n${formatEmailSetup(emailSetupStatus(root, email.ready, email.issues))}`);
    }
    const inspected = inspectReadiness(root, state);
    if (inspected.invalidEvidence.length) console.log(`\nRevalidation needed:\n${inspected.invalidEvidence.join("\n")}`);
    if (command === "check") process.exitCode = inspected.ready && state.phase === "complete" ? 0 : 2;
  }
} catch (error) {
  // Only our controlled validation messages are useful; filesystem/network errors may contain private data.
  const message = error instanceof Error && !/^(ENOENT|EACCES|EPERM|Command failed)/.test(error.message) ? error.message : "Onboarding state needs investigation; existing private records were preserved.";
  console.error(message); process.exitCode = 1;
}
