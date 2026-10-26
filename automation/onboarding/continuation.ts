import { inspectReadiness } from "./state-store.js";
import { stepIds, preparationIds, preparationLabels, mappingAreas, type OnboardingProgress, type StepId } from "./progress.js";

export type WorkCheckpoint = { action: "complete"; nextAction: string } |
  { action: "work"; step: StepId; substep: string; nextAction: string };

/** Pick the next real preparation gap when the conversation has no pending question. */
export function workCheckpoint(root: string, saved: OnboardingProgress): WorkCheckpoint {
  const checked = inspectReadiness(root, saved), state = checked.state;
  const work = (step: StepId, substep: string, nextAction: string): WorkCheckpoint => ({ action: "work", step, substep, nextAction });
  if (state.pendingQuestions.length) return work("applicationInstructions", "legacy questions", "Read and reconcile the retained question objects with canonical answers before asking anything new.");
  if (!state.scope) return work("boardSelection", "setup scope", "Ask one focused question about the desired setup scope; reuse any supplied choice.");
  if (state.scope !== "profileSetup") {
    if (!state.boards.length) return work("boardSelection", "primary boards", "Reuse or ask for one to three primary job boards.");
    if (state.preparation.browserChoice.status !== "complete") return work("boardSelection", "browser choice", "Reuse the saved browser choice; ask only if it is missing, then verify its capabilities.");
  }
  const prepStep: Record<string, StepId> = { uploadDocuments: "candidateProfiles", verificationAccess: "connections",
    operatingPreferences: "applicationInstructions", scheduleChoice: "applicationInstructions", scheduledAccess: "readiness", rehearsal: "readiness" };
  for (const step of stepIds) {
    if (step === "boardSelection") continue;
    if (state.scope === "profileSetup" && ["browserTools", "connections", "siteMapping"].includes(step)) continue;
    if (state.scope !== "profileSetup") {
      for (const id of preparationIds.filter(id => prepStep[id] === step)) {
        const check = state.preparation[id];
        if (!["complete", "skipped"].includes(check.status)) return work(step, id, check.nextAction ?? `Continue: ${preparationLabels[id]}. Read saved context and evidence first; ask only for a missing decision.`);
      }
      if (step === "connections" || step === "siteMapping") {
        for (const board of state.boards.filter(b => !b.deferred)) {
          const areas = step === "connections" ? ["access" as const] : mappingAreas;
          for (const area of areas) {
            const check = area === "access" ? board.access : board.mapping[area];
            if (!["complete", "skipped"].includes(check.status)) return work(step, `${board.name}: ${area}`, check.nextAction ?? `Resume ${board.name} ${area} using its saved session, site knowledge and checkpoint.`);
          }
        }
        if (step === "connections" && ["emailApplications", "bothApplications"].includes(state.scope) && state.emailConnection.status !== "complete")
          return work(step, "email access", state.emailConnection.nextAction ?? "Resume the selected email connection and verify access; preserve the mailbox choice.");
      }
    }
    const check = state.steps[step];
    if (!["complete", "skipped"].includes(check.status)) return work(step, step, check.nextAction ??
      (step === "readiness" ? "Recheck the configured scope and refresh the private handoff; do not restart completed steps." : `Resume ${step} from saved context and evidence; ask only the next missing decision.`));
  }
  if (checked.ready && state.phase === "complete") return { action: "complete", nextAction: "Onboarding is complete for the saved scope. Start a requested task or change a setting." };
  return work("readiness", "remaining checks", checked.blockers[0] ?? "Verify readiness and save the scoped handoff.");
}
