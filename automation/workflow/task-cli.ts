import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readPrivateJson } from "./private-json.js";
import { attentionHealthy } from "../attention/state.js";
import { boardWork } from "./dispatch.js";
import { ticketFolder } from "./board.js";
import { canMarkApplied } from "./application-state.js";
import { bindTaskTicket, saveTaskTicket, transitionTask, recoverTaskTransition, loadTaskControl, recordTaskCheckpoint, refreshTaskTicket,
  resumeMovedDeferredTask, authorizeTaskAction, assertAuthorizedTaskAction, observeTaskAction, type TaskControl } from "./task-control.js";

function taskGuidance(data: TaskControl) {
  const { task, action } = data;
  const folder = ticketFolder(data.path);
  if (data.transition) {
    return { nextAction: "recoverMove", reasonCode: "taskMovePending", nextActionMessage: "Recover the existing ticket move." };
  }
  if (action?.kind === "submit" && (action.invoked || action.uncertain) ||
      task.checkpoint === "submissionAttempted" && task.submissionResolution?.state !== "notSubmitted") {
    return { nextAction: "verifySubmission", reasonCode: "submissionOutcomeUnknown", nextActionMessage: "Check whether the application went through." };
  }
  if (action) {
    return { nextAction: "inspectCheckpoint", reasonCode: "browserActionPending", nextActionMessage: "Review the existing browser action and its ownership." };
  }
  if (task.checkpoint === "confirmed") {
    if (!canMarkApplied(task)) {
      return { nextAction: "inspectCheckpoint", reasonCode: "confirmationIncomplete", nextActionMessage: "Review the saved application confirmation." };
    }
    return folder === "Applied"
      ? { nextAction: "none", reasonCode: "applicationCompleted", nextActionMessage: "The confirmed application is recorded." }
      : { nextAction: "finalizeApplication", reasonCode: "submissionConfirmed", nextActionMessage: "Finish recording the confirmed application on the board." };
  }
  if (data.request) {
    return { nextAction: "inspectCheckpoint", reasonCode: "stopRequested", nextActionMessage: "Review the pending stop request before continuing." };
  }
  if (["Blocked", "Deferred", "Cancelled"].includes(folder)) {
    return { nextAction: "waitForRequeue", reasonCode: "applicationParked", nextActionMessage: "This application is parked. Review its saved status before requeueing." };
  }
  if (!["To Do", "Email Alerts"].includes(folder) || task.checkpoint === "submissionAttempted") {
    return { nextAction: "inspectCheckpoint", reasonCode: "taskCheckpointNeedsReview", nextActionMessage: "Review the selected application's saved checkpoint." };
  }
  return { nextAction: "checkApplicationEligibility", reasonCode: "applicationTicketActive", nextActionMessage: "Check eligibility before resuming the application." };
}

const args = process.argv.slice(2), command = args.shift() ?? "help";
function option(key: string) { const i = args.indexOf(`--${key}`); if (i < 0 || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Supply --${key}.`); return args[i + 1]; }
const root = args.includes("--root") ? resolve(option("root")) : resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
try {
  let result: unknown;
  if (command === "help") result = { commands: ["work", "bind --file .local/proposal.json", "write --file .local/proposal.json", "transition --file .local/proposal.json", "pickup --file .local/proposal.json", "recover --task-id ID", "status --task-id ID", "checkpoint --file .local/proposal.json", "refresh --file .local/proposal.json", "action-authorize --file .local/proposal.json", "action-invoke --task-id ID --token TOKEN", "action-observe --file .local/proposal.json"], note: "No command opens a website or calls an email provider. Use private JSON proposals and actual saved decision evidence. Task cancellation is separate from email native-cancel." };
  else if (command === "work") result = boardWork(root);
  else if (command === "recover") result = recoverTaskTransition(root, option("task-id"));
  else if (command === "status") {
    const id = option("task-id");
    try {
      const data = loadTaskControl(root, id).data;
      result = data ? { taskId: data.taskId, path: data.path, checkpoint: data.task.checkpoint, stopRequested: data.request?.action ?? null,
        transitionPending: !!data.transition, browserActionPending: !!data.action, decisions: data.history.length, ...taskGuidance(data) } :
        { registered: false, nextAction: "inspectCheckpoint", reasonCode: "taskControlMissing", nextActionMessage: "Check the selected ticket and its task ID." };
    } catch {
      result = { nextAction: "inspectCheckpoint", reasonCode: "taskControlUnreadable", nextActionMessage: "Inspect the selected application's control record." };
      process.exitCode = 1;
    }
  } else if (command === "action-invoke") { assertAuthorizedTaskAction(root, option("task-id"), option("token")); result = { invokeOnce: true }; }
  else {
    const proposal = readPrivateJson(root, option("file")).data as any;
    if (!proposal || typeof proposal !== "object") throw new Error("Supply a private proposal with the actual selected task and evidence.");
    if (command === "write") { if (typeof proposal.content !== "string") throw new Error("Supply reviewed ticket content in the private proposal."); result = saveTaskTicket(root, proposal.taskId, Buffer.from(proposal.content), proposal.expectedHash); }
    else if (command === "bind") result = bindTaskTicket(root, proposal.task, proposal.path);
    else if (command === "transition") result = transitionTask({ ...proposal, root });
    else if (command === "checkpoint") { if (!recordTaskCheckpoint(root, proposal.task)) throw new Error("Bind this selected task before saving its execution checkpoint."); result = { saved: true }; }
    else if (command === "refresh") result = { ...refreshTaskTicket(root, proposal.task, proposal.expectedHash, proposal.path), attentionProjection: attentionHealthy(root) ? "healthy" : "needsRepair" };
    else if (command === "pickup") result = resumeMovedDeferredTask(root, proposal.task, proposal.path, proposal.observedAt);
    else if (command === "action-authorize") result = authorizeTaskAction(root, proposal.task, proposal.kind, proposal.ownerId, proposal.page);
    else if (command === "action-observe") result = observeTaskAction(root, proposal.taskId, proposal.token, proposal.result, proposal.evidence, proposal.confirmed);
    else throw new Error("Unknown task command; run help.");
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(error instanceof Error ? error.message : "Preserve the task checkpoint and investigate."); process.exitCode = 1; }
