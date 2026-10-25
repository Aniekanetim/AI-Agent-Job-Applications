import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { readPrivateJson, savePrivateJson } from "../workflow/private-json.js";
import { loadEmailConnection, saveEmailConnection, validateInventory, validateCleanup, validateEmailReport, sourceKey, type EmailConnection, type CleanupChoice } from "./connection.js";
import { loadInboxState, inspectEmailReadiness, saveEmailRecord } from "./state-store.js";
import { classifyMessage, messageKey, terminalCleanup, type MailHeader, type MessageKind } from "./intake.js";
import { migrateLegacyEmail } from "./migration.js";
import { detectExistingConnections } from "./agentmail/connection.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const args = process.argv.slice(2), command = args.shift() ?? "status";
const value = (key: string) => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
const required = (key: string) => { const found = value(key); if (!found?.trim()) throw new Error(`Provide ${key} using the actual selected context or evidence.`); return found; };
const now = new Date().toISOString();
try {
  if (command === "help") console.log(`Agent-managed email commands; no command automatically opens a mailbox or performs cleanup:
  status       Inspect saved selection/readiness without provider calls
  discover     Read the host-produced .local/email-host-connections.json inventory and bounded AgentMail configuration references
  migrate --policy-reference REF  Retain the existing selected AgentMail inbox and cleanup policy
  select --candidate ID --source-reference REF --rule-reference REF --rules-revision VERSION
    --folder-or-label TEXT --query TEXT (optional); --change-source only for an explicit new user choice
  cleanup-choice --mode delete|archive|label|retain --effect permanentDelete|trash|archive|label|retain --source-reference REF
    --label-id ID (required only for label mode)
  capabilities --file .local/ACTUAL_REPORT.json   Validate and save actual interactive/scheduled tool evidence
  classify --header .local/ACTUAL_HEADER.json --kind jobAlert|otp|receipt|recruiter|unrelated|unknown --evidence-reference REF
Read automation/email/README.md. Host inventory and capability reports must come from the actual available tools; these helpers cannot discover every harness themselves.`);
  else if (command === "discover") {
    const inventory = readPrivateJson(root, ".local/email-host-connections.json").data;
    if (inventory !== null) validateInventory(inventory);
    console.log(JSON.stringify({ selected: loadEmailConnection(root).connection, hostInventory: inventory,
      agentMailConfiguration: detectExistingConnections(root), note: "Metadata only. Missing host inventory means unknown, not that no other connection exists." }, null, 2));
  } else if (command === "migrate") console.log(JSON.stringify(migrateLegacyEmail(root, required("--policy-reference"), now), null, 2));
  else if (command === "select") {
    const inventory = readPrivateJson(root, ".local/email-host-connections.json").data; validateInventory(inventory);
    const candidate = inventory.candidates.find(c => c.id === required("--candidate"));
    if (!candidate?.available) throw new Error("The requested connection is unavailable; preserve any saved selection.");
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
    saveEmailConnection(root, connection, existing.revision);
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
    console.log(JSON.stringify({ selected, interactive: inspectEmailReadiness(root, "interactive"), scheduled: inspectEmailReadiness(root, "scheduled") }, null, 2));
  } else throw new Error("Unknown email command. Use email:help.");
} catch (error) {
  const detail = error instanceof Error && !["TypeError", "SyntaxError"].includes(error.name) && !/^(ENOENT|EACCES|EPERM|Command failed)/.test(error.message) ? error.message : "Inspect the selected context and private evidence; existing records were preserved.";
  console.error(`Email setup: ${detail} No provider operation was requested by this CLI.`); process.exitCode = 1;
}
