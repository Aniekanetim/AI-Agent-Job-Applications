import { resolve } from "node:path";
import { readPrivateJson } from "../workflow/private-json.js";
import { loadEmailConnection, validateEmailReport } from "./connection.js";
import { loadInboxState, saveEmailRecord } from "./state-store.js";
import { messageKey, type EmailRecord } from "./intake.js";
import { createInventory, verifyInventory, type AlertInventory } from "./inventory.js";
import { evidenceFile } from "./evidence.js";
import { verifyAlertCompletion } from "./verification.js";
import { prepareNativeCleanup, resumeNativeCleanup, authorizeNativeCleanup, recordNativeCleanup, type CleanupOptions } from "./cleanup.js";

const [command = "help", ...args] = process.argv.slice(2);
function option(name: string, required = true) { const i = args.indexOf(`--${name}`), value = i >= 0 ? args[i + 1] : undefined; if (required && !value) throw new Error(`Supply --${name}.`); return value!; }
const root = resolve(option("root", false) || process.cwd());
async function main() {
  if (command === "help") return { commands: ["inventory --source .local/source.json", "reconcile --message-key KEY --inventory .local/inventory.json", "record --file .local/record.json", "verify --message-key KEY", "native-prepare --message-key KEY --owner-id STABLE-WORKER", "native-resume --message-key KEY --owner-id ID --token TOKEN", "native-authorize --message-key KEY --owner-id ID --token TOKEN", "native-observe --message-key KEY --owner-id ID --token TOKEN --evidence .local/result.json"], note: "All commands accept --root and native commands accept --context interactive|scheduled. No command calls an email provider." };
  if (command === "inventory") return createInventory(root, evidenceFile(root, option("source")));
  const loaded = loadInboxState(root);
  if (command === "record") {
    const record = readPrivateJson(root, option("file")).data as EmailRecord;
    saveEmailRecord(root, record, loaded.revision); return { saved: true, messageKey: messageKey(record.identity) };
  }
  const key = option("message-key"), record = loaded.state.messages.find(r => messageKey(r.identity) === key);
  if (!record) throw new Error("Save/classify this exact source message before recording its work.");
  if (command === "reconcile") {
    const inventory = readPrivateJson(root, option("inventory")).data as AlertInventory;
    const jobs = verifyInventory(root, inventory, key);
    if (record.vacancies.some(v => !jobs.has(v.vacancyKey))) throw new Error("Preserve existing tasks; reconcile their posting identities instead of discarding them.");
    record.inventory = inventory; record.enumerationComplete = true;
    record.vacancies = [...jobs].map(([vacancyKey, postingUrl]) => ({ ...record.vacancies.find(v => v.vacancyKey === vacancyKey), vacancyKey, postingUrl,
      disposition: record.vacancies.find(v => v.vacancyKey === vacancyKey)?.disposition ?? "pending" }));
    saveEmailRecord(root, record, loaded.revision); return { postings: jobs.size, outcomes: record.vacancies.map(v => ({ vacancyKey: v.vacancyKey, disposition: v.disposition })) };
  }
  if (command === "verify") return verifyAlertCompletion(root, record);
  const context = option("context", false) || "interactive";
  if (context !== "interactive" && context !== "scheduled") throw new Error("Use interactive or scheduled context.");
  const connection = loadEmailConnection(root).connection;
  const report = readPrivateJson(root, context === "interactive" ? ".local/email-capabilities.json" : ".local/email-capabilities-scheduled.json").data;
  if (!connection) throw new Error("Select the actual email connection first."); validateEmailReport(report);
  const options: CleanupOptions & { ownerId: string } = { root, connection, report, context, identity: record.identity, now: new Date().toISOString(), ownerId: option("owner-id") };
  if (command === "native-prepare") return prepareNativeCleanup(options);
  const owned = { ...options, token: option("token") };
  if (command === "native-resume") return resumeNativeCleanup(owned);
  if (command === "native-authorize") return authorizeNativeCleanup(owned);
  if (command === "native-observe") return recordNativeCleanup({ ...owned, evidence: evidenceFile(root, option("evidence")) });
  throw new Error("Unknown email work command; run help.");
}
try { console.log(JSON.stringify(await main(), null, 2)); }
catch (error) { console.error(error instanceof Error ? error.message : "Preserve the checkpoint and investigate email work."); process.exitCode = 1; }
