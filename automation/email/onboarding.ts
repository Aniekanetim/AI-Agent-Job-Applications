import { loadEmailConnection, validateInventory, sourceKey } from "./connection.js";
import { providerId, providerLabel, validateProviderCatalog } from "./discovery.js";
import { readPrivateJson, savePrivateJson } from "../workflow/private-json.js";

export const emailStages = ["discovery", "providerChoice", "authentication", "accountChoice", "preferences", "verification"] as const;
export interface EmailOnboarding {
  schemaVersion: 1;
  providerChoice: { id: string; sourceReference: string } | null;
  deferred: { reason: string; sourceReference: string; recordedAt: string } | null;
  checkpoint: { stage: typeof emailStages[number]; nextAction: string; recordedAt: string } | null;
}
export const emptyEmailOnboarding = (): EmailOnboarding => ({ schemaVersion: 1, providerChoice: null, deferred: null, checkpoint: null });
const supplied = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 1000 && !/[\r\n\0]/.test(v);
const exact = (value: object, allowed: string[]) => Object.keys(value).every(k => allowed.includes(k));
export function validateEmailOnboarding(value: unknown): asserts value is EmailOnboarding {
  const s = value as EmailOnboarding;
  if (!s || s.schemaVersion !== 1 || !exact(s, ["schemaVersion", "providerChoice", "deferred", "checkpoint"]) ||
    !(s.providerChoice === null || s.providerChoice && exact(s.providerChoice, ["id", "sourceReference"]) && supplied(s.providerChoice.id) &&
      /^[a-z][a-z0-9-]{0,79}$/.test(s.providerChoice.id) && providerId(s.providerChoice.id) === s.providerChoice.id && supplied(s.providerChoice.sourceReference)) ||
    !(s.deferred === null || s.deferred && exact(s.deferred, ["reason", "sourceReference", "recordedAt"]) && supplied(s.deferred.reason) && supplied(s.deferred.sourceReference) && Number.isFinite(Date.parse(s.deferred.recordedAt))) ||
    !(s.checkpoint === null || s.checkpoint && exact(s.checkpoint, ["stage", "nextAction", "recordedAt"]) && emailStages.includes(s.checkpoint.stage) && supplied(s.checkpoint.nextAction) && Number.isFinite(Date.parse(s.checkpoint.recordedAt)))) throw new Error("Preserve the email setup checkpoint; record only the provider choice, deferral and next action without credentials.");
}
export function loadEmailOnboarding(root: string) {
  const found = readPrivateJson(root, ".local/email-onboarding.json");
  if (found.data !== null) validateEmailOnboarding(found.data);
  return { state: found.data ?? emptyEmailOnboarding(), revision: found.revision };
}
export function saveEmailOnboarding(root: string, state: EmailOnboarding, revision: string | null) {
  validateEmailOnboarding(state); return savePrivateJson(root, ".local/email-onboarding.json", state, revision);
}
export function chooseEmailProvider(state: EmailOnboarding, id: string, reference: string, now: string): EmailOnboarding {
  const next: EmailOnboarding = { ...structuredClone(state), providerChoice: { id, sourceReference: reference }, deferred: null,
    checkpoint: { stage: "authentication", nextAction: "Reuse an authorized connection or complete this provider's harness connection screen, then select the account.", recordedAt: now } };
  validateEmailOnboarding(next); return next;
}

/** Status is derived from the saved mailbox and real readiness checks, never a manual 'ready' flag. */
export function emailSetupStatus(root: string, ready: boolean, issues: string[] = []) {
  const { state } = loadEmailOnboarding(root);
  const { connection } = loadEmailConnection(root);
  const chosen = state.providerChoice?.id ?? (connection ? providerId(connection.source.provider) : null);
  const changing = !!connection && !!chosen && chosen !== providerId(connection.source.provider);
  const inventory = readPrivateJson(root, ".local/email-host-connections.json").data;
  if (inventory !== null) validateInventory(inventory);
  const account = !changing && connection ? inventory?.candidates.find(c => sourceKey(c.source) === sourceKey(connection.source) && c.source.connectionReference === connection.source.connectionReference) : null;
  const accessProblem = !!account && (!account.available || ["needsAuthentication", "denied"].includes(account.authentication ?? ""));
  const verified = ready && !state.deferred && !changing && !accessProblem;
  const catalog = readPrivateJson(root, ".local/email-provider-catalog.json").data;
  if (catalog !== null) validateProviderCatalog(catalog);
  const discoveryObserved = catalog !== null && catalog.workingRoot === root && catalog.executionContext === "interactive" && catalog.discovery !== "unavailable";
  const stage = state.deferred ? "deferred" : verified ? "ready" : changing || accessProblem ? "authentication" : connection ?
    connection.cleanup ? "verification" : "preferences" : state.checkpoint?.stage ?? (chosen ? "authentication" : "discovery");
  const nextAction = state.deferred ? "Email intake is paused. Continue eligible manual tasks; resume email setup when ready." : verified ?
    "Email access is ready for the verified execution environment." : changing ? "Complete the selected provider's connection; keep the saved mailbox until an explicit source switch is safe." :
      accessProblem ? account?.authentication === "needsAuthentication" ? "Reconnect the saved account through the harness connection screen, then verify access." : "Resolve the selected account's access restriction in the harness; preserve its selection." :
      connection ? connection.cleanup ? "Verify actual access for the saved account; preserve its selection and completed-alert handling." : "Choose alert scope and supported completed-alert handling." :
        state.checkpoint?.nextAction ?? "Discover available email providers, then choose a connection.";
  return { ready: verified, stage, providerId: chosen, savedAccount: connection?.source.address ?? connection?.source.mailboxId ?? null,
    accountSelected: !!connection && !changing, authenticationVerified: verified || !!account?.available && account.authentication === "connected",
    preferencesChosen: !!connection?.cleanup && !changing, discoveryObserved,
    nextAction, issues, deferred: state.deferred !== null };
}
export function formatEmailSetup(status: ReturnType<typeof emailSetupStatus>): string {
  const stages = status.stage === "deferred" ? ["– Email setup deferred — manual tasks can continue"] : [
    `${status.discoveryObserved ? "✓" : "○"} Discover available email providers`,
    `${status.providerId ? "✓" : "○"} Choose an email provider${status.providerId ? ` — ${providerLabel(status.providerId)}` : ""}`,
    `${status.authenticationVerified ? "✓" : "○"} Confirm account authentication`,
    `${status.accountSelected ? "✓" : "○"} Save the account selection${status.accountSelected && status.savedAccount ? ` — ${status.savedAccount}` : ""}`,
    `${status.preferencesChosen ? "✓" : "○"} Choose alert scope and completed-alert handling`,
    `${status.ready ? "✓" : "○"} Verify actual email access`,
  ];
  return ["Connect your email", ...stages, `Next: ${status.nextAction}`].join("\n");
}
