import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readPrivateJson } from "../workflow/private-json.js";
import { attentionHealthy } from "./state.js";
import { attentionRepairStatus } from "./events.js";
import { nextAttention, browseAttention, attentionQueue } from "./queue.js";
import { loadAttentionPreferences, saveAttentionPreferences, snoozeAttention } from "./preferences.js";
import { loadAttentionSession, suspendAttention } from "./session-state.js";
import { beginAttentionReview, verifyAttentionReview, recordAttentionPresentation, saveAttentionAnswer, reconcileAttentionAnswer,
  recordAttentionHumanAction, continueAttentionReview, registerSelectedAttention, repairSelectedAttention } from "./review.js";
import { prepareAttentionDelivery, authorizeAttentionDelivery, observeAttentionDelivery, recoverUnsentAttentionDelivery, attentionDeliveryStatus } from "./delivery.js";
import { itemKey, type AttentionKind } from "./types.js";

const args = process.argv.slice(2), command = args.shift() ?? "help";
function option(name: string, required = true) { const i = args.indexOf(`--${name}`), value = i < 0 ? undefined : args[i + 1]; if (required && (!value || value.startsWith("--"))) throw new Error(`Supply --${name}.`); return value; }
const root = option("root", false) ? resolve(option("root")!) : resolve(dirname(fileURLToPath(import.meta.url)), "../../../.."), now = new Date().toISOString();
try {
  let result: unknown;
  if (command === "help") result = { commands: ["status", "next", "browse [--page N] [--kind KIND]", "review-next --source REF", "review --file .local/proposal.json", "verify --file .local/proposal.json", "asked --source REF", "reply --file .local/response.json", "recover-response", "reconcile-response --file .local/merged.json --source REF", "human-action --source REF", "continue --source REF", "stop --source REF", "preferences --file .local/patch.json", "snooze --until ISO_WITH_OFFSET --source REF", "pause --source REF", "register-selected --file .local/proposal.json", "repair-selected --file .local/proposal.json", "delivery-prepare", "delivery-authorize --id ID", "delivery-observe --file .local/proposal.json", "delivery-cancel-prepared --id ID --source REF", "deliveries"], note: "No command sends notifications, opens browsers, polls email, scans Blocked, moves a task or submits an application. Only actual explicit selected-task review/registration/repair may read that one ticket. Keep proposals private. Automatic reminders default off." };
  else if (command === "status") result = { ...attentionRepairStatus(root), healthy: attentionHealthy(root), preferences: loadAttentionPreferences(root).value, session: loadAttentionSession(root).session };
  else if (command === "next") result = nextAttention(root, now, true);
  else if (command === "browse") result = browseAttention(root, now, Number(option("page", false) ?? 1), option("kind", false) as AttentionKind | undefined);
  else if (command === "review-next") { const item = attentionQueue(root, now, { explicit: true }).items[0]; result = item ? beginAttentionReview(root, itemKey(item), option("source")!, now) : { action: "noRecordedItems", coverage: "partial" }; }
  else if (command === "asked") result = recordAttentionPresentation(root, option("source")!, now);
  else if (command === "reply") result = saveAttentionAnswer(root, option("file")!);
  else if (command === "recover-response") result = saveAttentionAnswer(root);
  else if (command === "reconcile-response") result = reconcileAttentionAnswer(root, option("file")!, option("source")!);
  else if (command === "human-action") result = recordAttentionHumanAction(root, option("source")!);
  else if (command === "continue") result = continueAttentionReview(root, option("source")!, now);
  else if (command === "stop") result = suspendAttention(root, option("source")!);
  else if (command === "snooze") result = snoozeAttention(root, option("until")!, option("source")!, now);
  else if (command === "pause") result = saveAttentionPreferences(root, { paused: true, sourceReference: option("source")! });
  else if (command === "delivery-prepare") result = prepareAttentionDelivery(root, now);
  else if (command === "delivery-authorize") result = authorizeAttentionDelivery(root, option("id")!, now);
  else if (command === "deliveries") result = attentionDeliveryStatus(root);
  else if (command === "delivery-cancel-prepared") result = recoverUnsentAttentionDelivery(root, option("id")!, option("source")!);
  else {
    const p = readPrivateJson(root, option("file")!).data as any;
    if (!p || typeof p !== "object") throw new Error("Use an agent-managed private proposal.");
    if (command === "review") result = beginAttentionReview(root, p.key, p.sourceReference, now);
    else if (command === "verify") result = verifyAttentionReview(root, p);
    else if (command === "preferences") result = saveAttentionPreferences(root, p);
    else if (command === "register-selected") result = registerSelectedAttention(root, p.task, p.path, p.sourceReference, now);
    else if (command === "repair-selected") result = repairSelectedAttention(root, p.task, p.path, p.sourceReference, now);
    else if (command === "delivery-observe") result = observeAttentionDelivery(root, p.id, p.outcome, p.reference);
    else throw new Error("Unknown attention command; use help.");
  }
  console.log(JSON.stringify(result ?? { saved: true }, null, 2));
} catch (error) { console.error(error instanceof Error ? error.message : "Preserve the private attention checkpoint for investigation."); process.exitCode = 1; }
