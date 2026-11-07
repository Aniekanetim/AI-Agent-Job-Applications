import { acquireOwnership } from "../workflow/ownership.js";
import { loadTaskControl, taskOwnershipKey } from "../workflow/task-control.js";
import { readPrivateJson, savePrivateJson } from "../workflow/private-json.js";
import { evidenceFile, readEvidence, digest, type FileEvidence } from "../email/evidence.js";
import { applyResponse, readConversationInput, reconcileStagedResponse, type ResponseBundle } from "../onboarding/conversation.js";
import { validateDecision, sameDecision, type Decision } from "../onboarding/conversation-types.js";
import { loadProgress } from "../onboarding/state-store.js";
import type { ApplicationTask } from "../workflow/application-state.js";
import { loadAttention, markInputRecorded, updateAttention, clearAttentionQuarantine, healthFile } from "./state.js";
import { attentionForTask, stageAttentionChange, commitAttentionChange, lifecycleEventId } from "./events.js";
import { itemKey, safeText, time } from "./types.js";
import { attentionQueue, queuedNames } from "./queue.js";
import { loadAttentionSession, updateAttentionSession, otherConversationFocus } from "./session-state.js";
import { selectedTicketEvidence } from "./selected-ticket.js";
import { reusableAnswerPath } from "../answers/context.js";
import { lookupApplicationAnswer, type AnswerRequest } from "../answers/workflow.js";

function selected(root: string, key: string) {
  const item = loadAttention(root).state.items.find(i => itemKey(i) === key && i.state !== "retired");
  if (!item) throw new Error("Select an existing recorded attention item.");
  if (loadAttention(root).state.events.some(e => e.taskId === item.taskId && e.state === "staged")) throw new Error("Recover the selected lifecycle transition before asking about it.");
  return item;
}
function assertFocus(root: string, recovering = false) { const focus = otherConversationFocus(root); if (focus && !(recovering && focus === "recoverResponse" && loadAttentionSession(root).session.response)) throw new Error(`Finish or explicitly pause the existing ${focus} focus before reviewing a task.`); }
/** An actual user Review request authorizes exactly this selected ticket, never a background backlog read. */
export function beginAttentionReview(root: string, key: string, sourceReference: string, now: string) {
  if (!safeText(sourceReference, 300) || !time(now)) throw new Error("Reference the actual selected-task review request.");
  assertFocus(root);
  const item = selected(root, key), owner = acquireOwnership(root, taskOwnershipKey(item.taskId));
  try {
    const current = loadAttentionSession(root).session;
    if (current.response) throw new Error("Recover the retained attention answer first.");
    if (!["closed", "suspended", "awaitingContinue"].includes(current.phase) && current.key !== key) throw new Error("Finish or stop the current task review first.");
    const control = loadTaskControl(root, item.taskId).data;
    if (control?.transition || control?.action || control?.request) throw new Error("Preserve the existing task/browser owner and recovery checkpoint.");
    if (control && control.path !== item.path || queuedNames(root).has(item.path.split("/").at(-1)!.toLowerCase())) {
      const id = stageAttentionChange(root, item.taskId, `review-requeued-${digest(key + now)}`, null, true);
      commitAttentionChange(root, id, sourceReference); return { action: "reconcileSelectedToDo" as const, taskId: item.taskId };
    }
    const ticket = selectedTicketEvidence(root, item.path), contents = readEvidence(root, ticket).toString("utf8");
    updateAttentionSession(root, s => {
      Object.keys(s).forEach(k => { if (!["schemaVersion"].includes(k)) delete (s as unknown as Record<string, unknown>)[k]; });
      Object.assign(s, { phase: "reviewing", key, taskId: item.taskId, path: item.path, ticketHash: ticket.sha256, sourceReference });
    });
    return { action: "inspectSelectedTask" as const, ticket, contents, checkpoint: control?.task.checkpoint,
      next: "Inspect only this task and its required current context. Verify the missing action before presenting one question. A response does not requeue it." };
  } finally { owner.release(); }
}
export interface ReviewObservation {
  task: ApplicationTask; ticketHash: string; observedAt: string; reference: string; context: FileEvidence[];
  outcome: "needsInput" | "alreadySupplied"; prompt?: string; decision?: Decision;
  answerLookup?: AnswerRequest;
}
/** Agent interprets current evidence; helpers enforce scope, revisions and one selected question. */
export function verifyAttentionReview(root: string, input: ReviewObservation) {
  assertFocus(root);
  const s = loadAttentionSession(root).session;
  if (s.phase !== "reviewing" || !s.key || !s.path || input.task.taskId !== s.taskId || input.ticketHash !== s.ticketHash || !time(input.observedAt) || !safeText(input.reference, 300)) throw new Error("Verify the same selected review and actual observation.");
  const owner = acquireOwnership(root, taskOwnershipKey(input.task.taskId));
  try {
    readEvidence(root, { path: s.path, sha256: s.ticketHash! });
    const control = loadTaskControl(root, input.task.taskId).data;
    if (control?.transition || control?.action || control?.request || control && control.path !== s.path) throw new Error("Reconcile changed task ownership/lifecycle first.");
    const task = control?.task ?? input.task, item = selected(root, s.key);
    const observed = attentionForTask({ ...task, blocker: task.blocker && { ...task.blocker, attention: task.blocker.attention ?? item } }, { path: s.path, sha256: s.ticketHash! }, input.observedAt);
    if (!observed || itemKey(observed) !== s.key) throw new Error("Review the actual current blocker generation before asking anything.");
    if (!Array.isArray(input.context) || !input.context.some(e => e.path === task.blocker?.contextPath)) throw new Error("Verify this selected blocker's required current context before repeating a missing-fact question.");
    input.context.forEach(e => readEvidence(root, e));
    const sharedBinding = item.binding?.contextPath === reusableAnswerPath ? item.binding : undefined;
    if (sharedBinding && !input.answerLookup) throw new Error("Check the current reusable field before presenting this question.");
    if (input.answerLookup && (item.kind !== "answer" || task.checkpoint === "submissionAttempted" ||
      input.answerLookup.context.roleId !== task.selectedRoleId || input.answerLookup.context.taskId !== task.taskId)) {
      throw new Error("Look up a factual answer for this selected role and task after submission recovery.");
    }
    const answer = input.answerLookup && lookupApplicationAnswer(root, input.answerLookup);
    const checkedDecision = answer && "decision" in answer ? answer.decision : undefined;
    if (sharedBinding && checkedDecision && !sameDecision(sharedBinding, checkedDecision)) {
      throw new Error("Check the selected blocker's recorded answer field and scope.");
    }
    if (answer?.action === "recoverResponse") throw new Error("Recover the retained answer before reviewing this question.");
    if (answer?.action === "pending") {
      return updateAttentionSession(root, session => {
        session.phase = "awaitingContinue";
        return { action: "awaitingExistingAnswer" as const, decisionId: answer.decision.id, choices: ["Continue", "Stop for now"], requeued: false };
      });
    }
    if (input.outcome === "alreadySupplied" && answer && answer.action !== "match") {
      throw new Error("Verify the applicable saved answer or resolve its scope before recording input.");
    }
    if (input.outcome === "alreadySupplied" || answer?.action === "match") {
      markInputRecorded(root, s.key);
      return updateAttentionSession(root, session => { session.phase = "awaitingContinue"; session.reviewReference = input.reference; return { action: "awaitingContinue" as const, choices: ["Continue", "Stop for now"], requeued: false }; });
    }
    if (input.outcome !== "needsInput" || !safeText(input.prompt, 500)) throw new Error("Present one verified missing action or factual question.");
    const decision = checkedDecision ?? input.decision;
    if (task.checkpoint === "submissionAttempted" && decision) throw new Error("Investigate this same application's uncertain submission before asking new form answers.");
    if (sharedBinding && (!decision || !sameDecision(sharedBinding, decision))) throw new Error("Preserve the selected reusable field.");
    if (decision?.contextPath === reusableAnswerPath && (!checkedDecision || !sameDecision(checkedDecision, decision))) {
      throw new Error("Check this reusable field and its applicability before asking.");
    }
    if (decision && decision.contextPath !== reusableAnswerPath) {
      validateDecision(decision);
      if (!item.binding || !sameDecision(item.binding, decision) || decision.roleId !== (task.selectedRoleId ?? null) || decision.contextPath !== task.blocker?.contextPath) throw new Error("Use the exact recorded canonical field and selected role; do not generalize vacancy answers.");
      const answered = loadProgress(root).state.conversation?.answers.some(a => a.contextPath === decision.contextPath && a.roleId === decision.roleId && a.field === decision.field);
      if (answered) throw new Error("Reconcile the already saved canonical answer; do not ask it again.");
    }
    return updateAttentionSession(root, session => {
      Object.assign(session, { phase: "awaitingInput", prompt: input.prompt, decision, reviewEvidence: input.context, reviewReference: input.reference, reviewedAt: input.observedAt, presentationPending: true });
      delete session.presentation; return { action: "presentOne" as const, prompt: input.prompt, taskId: task.taskId, requeued: false };
    });
  } finally { owner.release(); }
}
export function recordAttentionPresentation(root: string, reference: string, now: string) {
  assertFocus(root);
  return updateAttentionSession(root, s => {
    if (s.phase !== "awaitingInput" || !s.presentationPending || !safeText(reference, 300) || !time(now)) throw new Error("Record the actual one-task question presentation.");
    selected(root, s.key!); readEvidence(root, { path: s.path!, sha256: s.ticketHash! }); s.reviewEvidence?.forEach(e => readEvidence(root, e));
    s.presentation = { reference, at: now }; s.presentationPending = false;
  });
}
export function saveAttentionAnswer(root: string, proposalPath?: string) {
  assertFocus(root, true);
  const current = loadAttentionSession(root).session, path = proposalPath ?? current.response?.path;
  if (current.phase !== "awaitingInput" || !current.presentation || !current.decision || !path) throw new Error("Bind the actual reply to the selected presented canonical question.");
  let bundle = readConversationInput(root, path) as ResponseBundle;
  const journal = readPrivateJson(root, ".local/onboarding-pending-response.json").data as ResponseBundle | null;
  if (current.response && journal?.reconciliation?.previousProposalSha256 === digest(JSON.stringify(bundle)) && journal.id === bundle.id &&
    journal.sourceReference === bundle.sourceReference && JSON.stringify(journal.answers) === JSON.stringify(bundle.answers)) bundle = journal;
  if (!bundle?.answers?.some(a => sameDecision(a.decision, current.decision!))) throw new Error("Preserve this task's canonical field and any clear additional answers in the same reply.");
  const hash = digest(readEvidence(root, evidenceFile(root, path)));
  updateAttentionSession(root, s => {
    if (s.response && (s.response.path !== path || s.response.sha256 !== hash)) throw new Error("Recover the same retained response before replacing it.");
    s.response = { path, sha256: hash, id: bundle.id };
  });
  // Existing journal supports restart recovery and all additional clearly bound answers; pause state is untouched.
  applyResponse(root, bundle);
  markInputRecorded(root, current.key!);
  return updateAttentionSession(root, s => { s.lastResponse = bundle.id; delete s.response; s.phase = "awaitingContinue"; return { saved: true, requeued: false, choices: ["Continue", "Stop for now"] }; });
}
/** Preserve both proposals and use the same canonical conflict checks as focused/settings replies. */
export function reconcileAttentionAnswer(root: string, proposalPath: string, reference: string) {
  assertFocus(root, true);
  const s = loadAttentionSession(root).session;
  if (!s.response || !safeText(reference, 300)) throw new Error("Select the retained attention response and actual conflict review.");
  const old = readConversationInput(root, s.response.path) as ResponseBundle, proposed = readConversationInput(root, proposalPath) as ResponseBundle;
  if (evidenceFile(root, s.response.path).sha256 !== s.response.sha256 || old.id !== proposed.id || old.sourceReference !== proposed.sourceReference ||
    old.observedAt !== proposed.observedAt || JSON.stringify(old.answers) !== JSON.stringify(proposed.answers)) throw new Error("Preserve the original reply and exact canonical bindings during reconciliation.");
  const stored = readPrivateJson(root, ".local/onboarding-pending-response.json").data as ResponseBundle | null;
  let next = proposed;
  if (stored) {
    if (stored.id !== old.id) throw new Error("Recover the other retained canonical response first.");
    next = JSON.stringify(stored.writes) === JSON.stringify(proposed.writes) && JSON.stringify(stored.references) === JSON.stringify(proposed.references) ? stored : reconcileStagedResponse(root, proposed, reference);
  } else {
    const conflicts = old.writes.filter(w => { try { return ![w.expectedSha256, digest(w.content)].includes(evidenceFile(root, w.path).sha256); } catch { return w.expectedSha256 !== null; } });
    if (!conflicts.length || old.writes.length !== proposed.writes.length || JSON.stringify(old.references) !== JSON.stringify(proposed.references) ||
      old.writes.some(w => !proposed.writes.some(n => n.path === w.path)) ||
      old.writes.some(w => !conflicts.includes(w) && JSON.stringify(proposed.writes.find(n => n.path === w.path)) !== JSON.stringify(w))) throw new Error("Reconcile only actual newer-file conflicts; preserve unrelated files and answers.");
    for (const w of conflicts) { let hash: string | null = null; try { hash = evidenceFile(root, w.path).sha256; } catch { /* A missing canonical file can be an actual conflict. */ }
      if (proposed.writes.find(n => n.path === w.path)?.expectedSha256 !== hash) throw new Error("Merge against the actual current canonical revision."); }
  }
  const path = `.local/attention-responses/${digest(JSON.stringify(next))}.json`, loaded = readPrivateJson(root, path);
  if (!loaded.data) savePrivateJson(root, path, next, null);
  updateAttentionSession(root, current => { current.responseHistory = [...(current.responseHistory ?? []), { ...current.response!, reference }]; current.response = { path, sha256: evidenceFile(root, path).sha256, id: next.id }; });
  return saveAttentionAnswer(root);
}
export function recordAttentionHumanAction(root: string, reference: string) {
  assertFocus(root);
  const s = loadAttentionSession(root).session;
  if (s.phase !== "awaitingInput" || !s.presentation || s.decision || !safeText(reference, 300)) throw new Error("Record the actual selected human-action reply, never assumed CAPTCHA clearance.");
  markInputRecorded(root, s.key!);
  return updateAttentionSession(root, session => { session.phase = "awaitingContinue"; session.lastResponse = reference; return { requeued: false, verified: false, choices: ["Continue", "Stop for now"] }; });
}
export function continueAttentionReview(root: string, sourceReference: string, now: string) {
  if (!safeText(sourceReference, 300) || !time(now)) throw new Error("Reference the actual Continue choice.");
  const s = loadAttentionSession(root).session;
  if (s.phase !== "awaitingContinue") throw new Error("Finish the current interaction before Continue.");
  const next = attentionQueue(root, now, { explicit: true }).items[0];
  if (!next) return updateAttentionSession(root, session => { session.phase = "closed"; return { action: "noRecordedItems" as const, coverage: "partial" as const }; });
  return beginAttentionReview(root, itemKey(next), sourceReference, now);
}
/** Explicit bounded legacy registration: caller supplies the single selected task, never a directory scan. */
export function registerSelectedAttention(root: string, task: ApplicationTask, path: string, requestReference: string, now: string) {
  if (!safeText(requestReference, 300) || !time(now)) throw new Error("Reference the explicit selected legacy-task review request.");
  if (!/^Task Board\/Blocked\/[^/\\]+\.md$/.test(path)) throw new Error("Select exactly one existing Blocked ticket.");
  const owner = acquireOwnership(root, taskOwnershipKey(task.taskId));
  try {
    const control = loadTaskControl(root, task.taskId).data;
    if (control && (control.path !== path || control.transition || control.action || control.request)) throw new Error("Reconcile this selected task's actual lifecycle first.");
    if (control && (control.task.checkpoint !== task.checkpoint || control.task.selectedRoleId !== task.selectedRoleId || control.task.cvSha256 !== task.cvSha256 ||
      JSON.stringify(control.task.captchaHandoffs) !== JSON.stringify(task.captchaHandoffs) || JSON.stringify(control.task.accessHandoffs) !== JSON.stringify(task.accessHandoffs))) throw new Error("Preserve the selected task's actual submission, profile and browser handoffs.");
    const ticket = selectedTicketEvidence(root, path), item = attentionForTask(task, ticket, now);
    if (!item) throw new Error("Register only an actual selected human-required Blocked task.");
    const id = stageAttentionChange(root, task.taskId, lifecycleEventId(task.taskId, path, `${ticket.sha256}:${item.generation}`), item, true, requestReference);
    return commitAttentionChange(root, id, `${ticket.path}:${ticket.sha256}`);
  } finally { owner.release(); }
}
/** Repair one explicitly selected committed core state; never infer an outcome from an interrupted event. */
export function repairSelectedAttention(root: string, task: ApplicationTask, path: string, reference: string, now: string) {
  if (!safeText(reference, 300) || !time(now)) throw new Error("Reference the explicit selected projection repair.");
  const owner = acquireOwnership(root, taskOwnershipKey(task.taskId));
  try {
    const control = loadTaskControl(root, task.taskId).data;
    if (!control || control.path !== path || control.transition || control.action || control.request) throw new Error("Recover this selected core task before repairing its reminder projection.");
    const ticket = selectedTicketEvidence(root, path); readEvidence(root, control.ticket);
    const item = attentionForTask(control.task, ticket, now), id = `repair-${digest(task.taskId + reference + ticket.sha256)}`;
    const event = stageAttentionChange(root, task.taskId, id, item, true, reference);
    const result = commitAttentionChange(root, event, `${ticket.path}:${ticket.sha256}`);
    if (result.attention === "synced") {
      const pending = loadAttention(root).state.events.filter(e => e.taskId === task.taskId && e.state === "staged").map(e => e.id);
      updateAttention(root, s => { for (const e of s.events.filter(e => pending.includes(e.id))) { e.state = "committed"; e.receipt = `Superseded by selected repair ${id}`; } });
      const quarantine = readPrivateJson(root, healthFile).data as { pending: { id: string; taskId?: string }[] } | null;
      [...pending, ...(quarantine?.pending.filter(e => e.taskId === task.taskId).map(e => e.id) ?? [])].forEach(id => clearAttentionQuarantine(root, id));
    }
    return result;
  } finally { owner.release(); }
}
