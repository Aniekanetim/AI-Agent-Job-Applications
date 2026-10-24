import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { configureProgress, newBoard, formatProgress, refreshProgress, mappingAreas, emptyCheck,
  type OnboardingScope, type StepId, type MappingArea, type ProgressStatus } from "./progress.js";
import { loadProgress, saveProgress, completedCheck, evidenceReference, inspectReadiness } from "./state-store.js";

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
  migrate                      Preserve schema-1 context/questions and add the new pending checks
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
    const inspected = inspectReadiness(root, state);
    if (inspected.invalidEvidence.length) console.log(`\nRevalidation needed:\n${inspected.invalidEvidence.join("\n")}`);
    if (command === "check") process.exitCode = inspected.ready && state.phase === "complete" ? 0 : 2;
  }
} catch (error) {
  // Only our controlled validation messages are useful; filesystem/network errors may contain private data.
  const message = error instanceof Error && !/^(ENOENT|EACCES|EPERM|Command failed)/.test(error.message) ? error.message : "Onboarding state needs investigation; existing private records were preserved.";
  console.error(message); process.exitCode = 1;
}
