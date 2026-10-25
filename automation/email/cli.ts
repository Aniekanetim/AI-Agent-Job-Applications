import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { readPrivateJson, savePrivateJson } from "../workflow/private-json.js";
import { loadEmailConnection, saveEmailConnection, validateInventory, validateCleanup, validateEmailReport, sourceKey, type EmailConnection, type CleanupChoice } from "./connection.js";
import { loadInboxState, inspectEmailReadiness, saveEmailRecord } from "./state-store.js";
import { classifyMessage, messageKey, terminalCleanup, type MailHeader, type MessageKind } from "./intake.js";
import { migrateLegacyEmail } from "./migration.js";
import { detectExistingConnections } from "./agentmail/connection.js";
import { validateProviderCatalog, normalizeCodexCatalog, providerId, providerOptions, formatProviderOptions, type ProviderCatalog } from "./discovery.js";
import { loadEmailOnboarding, saveEmailOnboarding, chooseEmailProvider, emailStages, emailSetupStatus, formatEmailSetup } from "./onboarding.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const args = process.argv.slice(2), command = args.shift() ?? "status";
const value = (key: string) => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
const required = (key: string) => { const found = value(key); if (!found?.trim()) throw new Error(`Provide ${key} using the actual selected context or evidence.`); return found; };
const now = new Date().toISOString();
function discovery() {
  const inventory = readPrivateJson(root, ".local/email-host-connections.json").data;
  if (inventory !== null) validateInventory(inventory);
  const catalog = readPrivateJson(root, ".local/email-provider-catalog.json").data;
  if (catalog !== null) validateProviderCatalog(catalog);
  const selected = loadEmailConnection(root).connection;
  return { selected, hostInventory: inventory, catalog, options: providerOptions(catalog, inventory, selected, root) };
}
try {
  if (command === "help") console.log(`Agent-managed email commands; no command automatically opens a mailbox or performs cleanup:
  status       Inspect saved selection/readiness without provider calls
  discover     Read saved choice, actual provider catalog, account inventory and bounded AgentMail references; no provider calls
  options      Show Connect your email with Google first, actual connection statuses and Set up email later
  catalog --file .local/ACTUAL_CATALOG.json
    --format codexCli|codexDirectory --reference REF (optional: normalize actual Codex catalog output)
  onboarding choose --provider ID --source-reference REF
  onboarding checkpoint --stage ${emailStages.join("|")} --next-action TEXT
  onboarding defer --reason TEXT --source-reference REF
  onboarding resume --source-reference REF
  onboarding status            Show the current email setup checkpoint without writing
  migrate --policy-reference REF  Retain the existing selected AgentMail inbox and cleanup policy
  select --candidate ID --source-reference REF --rule-reference REF --rules-revision VERSION
    --folder-or-label TEXT --query TEXT (optional); --change-source only for an explicit new user choice
  cleanup-choice --mode delete|archive|label|retain --effect permanentDelete|trash|archive|label|retain --source-reference REF
    --label-id ID (required only for label mode)
  capabilities --file .local/ACTUAL_REPORT.json   Validate and save actual interactive/scheduled tool evidence
  classify --header .local/ACTUAL_HEADER.json --kind jobAlert|otp|receipt|recruiter|unrelated|unknown --evidence-reference REF
Read automation/email/README.md. Host inventory and capability reports must come from the actual available tools; these helpers cannot discover every harness themselves.`);
  else if (command === "discover") {
    console.log(JSON.stringify({ ...discovery(),
      agentMailConfiguration: detectExistingConnections(root), note: "Metadata only. Missing host inventory means unknown, not that no other connection exists." }, null, 2));
  } else if (command === "options") {
    console.log(formatProviderOptions(discovery().options));
  } else if (command === "catalog") {
    const input = readPrivateJson(root, required("--file")).data;
    const format = value("--format");
    if (format !== undefined && !["codexCli", "codexDirectory"].includes(format)) throw new Error("Choose codexCli or codexDirectory for documented Codex metadata, or omit the format for a normalized catalog.");
    const catalog: ProviderCatalog = format ? normalizeCodexCatalog(input, format as "codexCli" | "codexDirectory", root, now, required("--reference")) : input as ProviderCatalog;
    validateProviderCatalog(catalog);
    if (catalog.workingRoot !== root) throw new Error("Discover providers in this actual working copy; do not import another machine's catalog as current availability.");
    const previous = readPrivateJson(root, ".local/email-provider-catalog.json");
    savePrivateJson(root, ".local/email-provider-catalog.json", catalog, previous.revision);
    console.log("Saved provider availability. No account was connected and email readiness was not changed.");
  } else if (command === "onboarding") {
    const action = args[0] ?? "status";
    const loaded = loadEmailOnboarding(root); let state = loaded.state;
    if (action === "choose") {
      const id = required("--provider");
      if (!discovery().options.some(option => option.id === id)) throw new Error("Choose a displayed provider or first discover the requested integration.");
      state = chooseEmailProvider(state, id, required("--source-reference"), now);
    } else if (action === "checkpoint") {
      const stage = required("--stage") as typeof emailStages[number];
      if (!emailStages.includes(stage)) throw new Error("Choose a known email setup stage; readiness comes from actual capability checks.");
      state.checkpoint = { stage, nextAction: required("--next-action"), recordedAt: now };
    } else if (action === "defer") {
      state.deferred = { reason: required("--reason"), sourceReference: required("--source-reference"), recordedAt: now };
    } else if (action === "resume") {
      required("--source-reference"); state.deferred = null;
    } else if (action !== "status") throw new Error("Use choose, checkpoint, defer, resume or status for email onboarding.");
    if (action !== "status") saveEmailOnboarding(root, state, loaded.revision);
    const readiness = inspectEmailReadiness(root, "interactive");
    console.log(formatEmailSetup(emailSetupStatus(root, readiness.ready, readiness.issues)));
  } else if (command === "migrate") console.log(JSON.stringify(migrateLegacyEmail(root, required("--policy-reference"), now), null, 2));
  else if (command === "select") {
    const inventory = readPrivateJson(root, ".local/email-host-connections.json").data; validateInventory(inventory);
    const candidate = inventory.candidates.find(c => c.id === required("--candidate"));
    if (!candidate?.available) throw new Error("The requested connection is unavailable; preserve any saved selection.");
    if (["needsAuthentication", "denied"].includes(candidate.authentication ?? "")) throw new Error("Complete the harness connection or resolve its access restriction before selecting this account.");
    const existing = loadEmailConnection(root);
    const sameSource = existing.connection && sourceKey(existing.connection.source) === sourceKey(candidate.source);
    if (existing.connection && !sameSource) {
      if (!args.includes("--change-source")) throw new Error("A saved mailbox remains selected; changing it needs the user's explicit choice.");
      const ledger = loadInboxState(root);
      if (ledger.state.messages.some(record => sourceKey(record.identity.source) === sourceKey(existing.connection!.source) && record.classification.kind === "jobAlert" && !terminalCleanup(record))) throw new Error("Resolve active work and pending cleanup on the previous source before switching.");
    }
    const connection: EmailConnection = { schemaVersion: 1, source: candidate.source,
      selection: { method: "user", sourceReference: required("--source-reference") },
      scope: { folderOrLabel: value("--folder-or-label") ?? null, query: value("--query") ?? null,
        ruleReference: required("--rule-reference"), revision: required("--rules-revision") },
      cleanup: sameSource ? existing.connection!.cleanup : null };
    const setup = loadEmailOnboarding(root);
    let chosen = null;
    if (setup.state.providerChoice || setup.state.deferred) {
      chosen = chooseEmailProvider(setup.state, providerId(candidate.source.provider), required("--source-reference"), now);
      chosen.checkpoint = { stage: "preferences", nextAction: "Choose alert scope and supported completed-alert handling, then verify actual access.", recordedAt: now };
    }
    saveEmailConnection(root, connection, existing.revision);
    if (chosen) saveEmailOnboarding(root, chosen, setup.revision);
    console.log("Selected the actual connection; verify its capabilities and choose cleanup before declaring email intake ready.");
  } else if (command === "cleanup-choice") {
    const existing = loadEmailConnection(root);
    if (!existing.connection) throw new Error("Select the actual email source first.");
    const choice: CleanupChoice = { mode: required("--mode") as CleanupChoice["mode"], effect: required("--effect") as CleanupChoice["effect"],
      labelId: value("--label-id") ?? null, sourceReference: required("--source-reference") }; validateCleanup(choice);
    const ledger = loadInboxState(root);
    if (ledger.state.messages.some(record => sourceKey(record.identity.source) === sourceKey(existing.connection!.source) && record.cleanupState === "cleanupPending")) throw new Error("Resolve pending cleanup before changing its effect.");
    saveEmailConnection(root, { ...existing.connection, cleanup: choice }, existing.revision);
    console.log("Saved the user's completed-alert handling choice; no email was changed.");
  } else if (command === "capabilities") {
    const report = readPrivateJson(root, required("--file")).data; validateEmailReport(report);
    const selected = loadEmailConnection(root).connection;
    if (!selected || report.sourceKey !== sourceKey(selected.source) || report.workingRoot !== root) throw new Error("Evidence must belong to this actual account and working copy.");
    const name = report.executionContext === "interactive" ? ".local/email-capabilities.json" : ".local/email-capabilities-scheduled.json";
    const existing = readPrivateJson(root, name); savePrivateJson(root, name, report, existing.revision);
    console.log(JSON.stringify(inspectEmailReadiness(root, report.executionContext), null, 2));
  } else if (command === "classify") {
    const selected = loadEmailConnection(root).connection;
    if (!selected) throw new Error("Select the email source first.");
    const header = readPrivateJson(root, required("--header")).data as MailHeader;
    if (sourceKey(header.source) !== sourceKey(selected.source)) throw new Error("Classify only the selected source's message.");
    const record = classifyMessage(header, required("--kind") as MessageKind, selected.scope.revision, selected.scope.ruleReference, required("--evidence-reference"), now);
    const loaded = loadInboxState(root);
    const old = loaded.state.messages.find(old => messageKey(old.identity) === messageKey(record.identity));
    if (old) {
      if (old.vacancies.length || terminalCleanup(old) || old.cleanupState === "cleanupPending") throw new Error("Preserve existing task and cleanup history; refresh only its classification metadata through the state helper after inspection.");
      Object.assign(record, { ...old, classification: record.classification });
    }
    saveEmailRecord(root, record, loaded.revision); console.log("Saved message classification without modifying the email.");
  } else if (command === "status") {
    const selected = loadEmailConnection(root).connection;
    const interactive = inspectEmailReadiness(root, "interactive");
    console.log(JSON.stringify({ selected, setup: emailSetupStatus(root, interactive.ready, interactive.issues), interactive, scheduled: inspectEmailReadiness(root, "scheduled") }, null, 2));
  } else throw new Error("Unknown email command. Use email:help.");
} catch (error) {
  const detail = error instanceof Error && !["TypeError", "SyntaxError"].includes(error.name) && !/^(ENOENT|EACCES|EPERM|Command failed)/.test(error.message) ? error.message : "Inspect the selected context and private evidence; existing records were preserved.";
  console.error(`Email setup: ${detail} No provider operation was requested by this CLI.`); process.exitCode = 1;
}
