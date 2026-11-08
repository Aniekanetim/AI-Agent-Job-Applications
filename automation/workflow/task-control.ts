import fs from "node:fs";
import { basename, dirname, relative, resolve, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readPrivateJson, savePrivateJson } from "./private-json.js";
import { acquireOwnership, resumeNativeOwnership, OwnershipBusy, type Ownership } from "./ownership.js";
import { ticketFolder, validateDecision, taskDecisionBlock, type TaskDecision, type TaskDecisionAction } from "./board.js";
import { assertTaskMove, canMarkApplied, type ApplicationTask } from "./application-state.js";
import { digest, evidenceFile, readEvidence, type FileEvidence } from "../email/evidence.js";
import { loadInboxState, alertOwnershipKey, saveTaskEmailRecord } from "../email/state-store.js";
import { messageKey, terminalCleanup, type EmailIdentity } from "../email/intake.js";
import { saveAlertArtifact } from "../email/artifact-store.js";
import { assertSiteAction, type SitePage } from "../sites/execution.js";
import { stageTaskAttention, stageAttentionChange, commitAttentionChange } from "../attention/events.js";
import { registeredContentTicketId } from "./intake.js";

interface StopRequest { action: "cancel" | "defer"; reason: string; actor: string; observedAt: string; authority: FileEvidence }
interface Source { identity: EmailIdentity; vacancyKey: string; completed?: boolean }
interface MoveJournal {
  decision: TaskDecision; inputPath: string; sourceHash: string; destination: string; original: string; bytes: string;
  task: ApplicationTask; source?: Source; cleanupAuthority?: FileEvidence;
}
export interface TaskControl {
  schemaVersion: 1; taskId: string; path: string; ticket: FileEvidence; task: ApplicationTask;
  source?: Source; history: TaskDecision[]; request?: StopRequest; transition?: MoveJournal;
  stopHistory?: StopRequest[];
  edits?: FileEvidence[];
  action?: { id: string; kind: "credentials" | "upload" | "submit"; ownerId: string; token: string; invoked?: boolean; uncertain?: boolean; evidence?: FileEvidence };
}
export const taskOwnershipKey = (id: string) => `task:${id}`;
const controlPath = (id: string) => {
  if (!id?.trim()) throw new Error("Preserve the existing task ID.");
  return `.local/task-controls/${digest(id)}.json`;
};
export function loadTaskControl(root: string, id: string) {
  const found = readPrivateJson(root, controlPath(id));
  const data = found.data as TaskControl | null;
  if (data && (data.schemaVersion !== 1 || data.taskId !== id || !Array.isArray(data.history) || data.task.taskId !== id)) throw new Error("Preserve and reconcile incomplete task control.");
  if (data) ticketFolder(data.path);
  return { data, revision: found.revision };
}
function save(root: string, data: TaskControl, revision: string | null) { savePrivateJson(root, controlPath(data.taskId), data, revision); }
function authority(root: string, ref: FileEvidence) { readEvidence(root, ref); }
/** Validate before reading or writing any selected ticket; never traverse inactive queues. */
export function privateTicket(root: string, path: string) {
  ticketFolder(path);
  for (const part of ["Task Board", dirname(path), path]) {
    try { if (fs.lstatSync(resolve(root, part)).isSymbolicLink()) throw new Error("Task tickets cannot use filesystem aliases."); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const absolute = resolve(root, path);
  let parent = fs.existsSync(absolute) ? absolute : dirname(absolute);
  while (!fs.existsSync(parent)) parent = dirname(parent);
  const part = relative(fs.realpathSync(root), fs.realpathSync(parent));
  if (!part || part.startsWith("..") || isAbsolute(part)) throw new Error("Task tickets must stay inside this private copy.");
  if (execFileSync("git", ["-C", root, "ls-files", "--", path], { encoding: "utf8", windowsHide: true }).trim()) throw new Error("Task tickets must be untracked.");
  try { execFileSync("git", ["-C", root, "check-ignore", "--no-index", "--quiet", path], { windowsHide: true }); }
  catch { throw new Error("Task tickets must be ignored by Git before they are written."); }
  return absolute;
}
export function writeTicket(root: string, path: string, bytes: Buffer, expected: string | null) {
  const absolute = privateTicket(root, path);
  fs.mkdirSync(dirname(absolute), { recursive: true }); privateTicket(root, path);
  if ((fs.existsSync(absolute) ? digest(fs.readFileSync(absolute)) : null) !== expected) throw new Error("The selected ticket changed; preserve the transition for reconciliation.");
  // Exclusive creation prevents destination overwrites. In-place user-move reconciliation uses an atomic replacement.
  const temporary = resolve(dirname(absolute), `.task-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600, flush: true });
    if (expected === null) { fs.linkSync(temporary, absolute); }
    else {
      if (digest(fs.readFileSync(absolute)) !== expected) throw new Error("The ticket changed during its save.");
      fs.renameSync(temporary, absolute);
    }
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  return evidenceFile(root, path);
}
function sourceFor(root: string, path: string, id: string): Source | undefined {
  const found = loadInboxState(root).state.messages.flatMap(r => r.vacancies.filter(v => v.taskPath === path).map(v => ({ r, v })));
  if (found.length > 1 || found.some(({ v }) => v.taskId !== id)) throw new Error("Reconcile this selected ticket's ambiguous source assignment.");
  if (found.some(({ v }) => v.taskTransition || v.taskEvidence && digest(fs.readFileSync(privateTicket(root, path))) !== v.taskEvidence.sha256)) throw new Error("Recover or reconcile this selected source ticket before binding it.");
  return found[0] && { identity: found[0].r.identity, vacancyKey: found[0].v.vacancyKey, completed: terminalCleanup(found[0].r) };
}
function assertCurrentSource(root: string, data: TaskControl) {
  if (!data.source || data.source.completed) return;
  const record = loadInboxState(root).state.messages.find(r => messageKey(r.identity) === messageKey(data.source!.identity));
  const vacancy = record?.vacancies.find(v => v.vacancyKey === data.source!.vacancyKey);
  if (!record || record.cleanupState !== "notReady" || !vacancy || vacancy.taskId !== data.taskId || vacancy.taskPath !== data.path || vacancy.disposition !== "pending" || vacancy.taskTransition) throw new Error("Reconcile the stopped or changed source assignment before execution.");
}
function bind(root: string, task: ApplicationTask, path: string): TaskControl {
  if (ticketFolder(path) === "Content Creation" || registeredContentTicketId(root, basename(path))) throw new Error("Select a job application ticket.");
  privateTicket(root, path);
  const found = loadTaskControl(root, task.taskId);
  if (found.data) {
    if (found.data.path !== path || found.data.transition) throw new Error("Recover the existing task move before rebinding it.");
    readEvidence(root, found.data.ticket); return found.data;
  }
  const data: TaskControl = { schemaVersion: 1, taskId: task.taskId, path, ticket: evidenceFile(root, path), task: structuredClone(task), history: [], source: sourceFor(root, path, task.taskId) };
  if ((task.originalIntake === "Email Alerts") !== !!data.source) throw new Error("Reconcile the selected ticket's original email association before binding it.");
  save(root, data, found.revision); return data;
}
export function bindTaskTicket(root: string, task: ApplicationTask, path: string): ApplicationTask {
  if (!["Email Alerts", "To Do"].includes(ticketFolder(path))) throw new Error("Bind active execution only from an intake queue.");
  const owner = acquireOwnership(root, taskOwnershipKey(task.taskId));
  try { const data = bind(root, task, path); assertTaskActive(root, task); return { ...structuredClone(task), ticket: data.ticket }; }
  finally { owner.release(); }
}
/** Save reviewed active-ticket text, including a restored cycle whose source cleanup is already immutable. */
export function saveTaskTicket(root: string, id: string, bytes: Buffer, expectedHash: string) {
  const owner = acquireOwnership(root, taskOwnershipKey(id));
  try {
    assertTaskActive(root, { taskId: id } as ApplicationTask);
    const found = loadTaskControl(root, id), data = found.data;
    if (!data || data.action || data.ticket.sha256 !== expectedHash) throw new Error("Reload the bound ticket before saving reviewed text.");
    const previous = readEvidence(root, data.ticket), backup = `.local/task-edits/${digest(id)}/${digest(data.ticket.path)}-${data.ticket.sha256}.json`;
    const oldBackup = readPrivateJson(root, backup), snapshot = { taskId: id, ticket: data.ticket, bytes: previous.toString("base64") };
    if (oldBackup.data && JSON.stringify(oldBackup.data) !== JSON.stringify(snapshot)) throw new Error("Preserve the changed prior-ticket snapshot for investigation.");
    if (!oldBackup.data) savePrivateJson(root, backup, snapshot, oldBackup.revision);
    let ticket: FileEvidence;
    if (data.source && !data.source.completed) {
      const alertOwner = acquireOwnership(root, alertOwnershipKey(data.source.identity));
      try {
        const loaded = loadInboxState(root), record = loaded.state.messages.find(r => messageKey(r.identity) === messageKey(data.source!.identity));
        const vacancy = record?.vacancies.find(v => v.vacancyKey === data.source!.vacancyKey);
        if (!record || !vacancy || vacancy.taskId !== id || vacancy.taskPath !== data.path || vacancy.disposition !== "pending") throw new Error("Reconcile the active source pointer before writing its ticket.");
        ticket = saveAlertArtifact(root, data.source.identity, data.path, bytes, expectedHash, alertOwner);
        vacancy.taskEvidence = ticket;
        saveTaskEmailRecord(root, record, loaded.revision, alertOwner, randomUUID());
      } finally { alertOwner.release(); }
    } else ticket = writeTicket(root, data.path, bytes, expectedHash);
    const latest = loadTaskControl(root, id);
    const savedBackup = evidenceFile(root, backup);
    if (!latest.data!.edits?.some(e => e.path === backup)) latest.data!.edits = [...(latest.data!.edits ?? []), savedBackup];
    latest.data!.ticket = ticket; latest.data!.task.ticket = ticket;
    save(root, latest.data!, latest.revision); return ticket;
  } finally { owner.release(); }
}
/** Legacy unregistered state remains readable. A stopped task always has an indexed control, so dropping ticket fields cannot bypass it. */
export function assertTaskActive(root: string, task: ApplicationTask) {
  const data = loadTaskControl(root, task.taskId).data;
  if (data) {
    if (data.request || data.transition || data.action?.uncertain || data.action?.invoked || !["Email Alerts", "To Do"].includes(ticketFolder(data.path)) ||
      ["submissionAttempted", "confirmed"].includes(data.task.checkpoint)) throw new Error("Task execution is stopped, transitioning or awaiting submission recovery.");
    privateTicket(root, data.path); readEvidence(root, data.ticket);
    assertCurrentSource(root, data);
    if (task.ticket && JSON.stringify(task.ticket) !== JSON.stringify(data.ticket)) throw new Error("Reload the changed task ticket before execution.");
  } else if (task.ticket) {
    if (!["Email Alerts", "To Do"].includes(ticketFolder(task.ticket.path))) throw new Error("Only intake tasks may execute.");
    privateTicket(root, task.ticket.path); readEvidence(root, task.ticket);
  }
}
/** Persist the checkpoint alongside an already-bound task; never release an uncertain attempt by downgrade. */
export function recordTaskCheckpoint(root: string, task: ApplicationTask) {
  const found = loadTaskControl(root, task.taskId); if (!found.data) return false;
  const data = found.data;
  if (data.transition || data.task.checkpoint === "confirmed" && task.checkpoint !== "confirmed" ||
    data.task.checkpoint === "submissionAttempted" && !["submissionAttempted", "confirmed"].includes(task.checkpoint) && task.submissionResolution?.state !== "notSubmitted") throw new Error("Preserve this task's submission outcome and move checkpoint.");
  if (task.submissionResolution) authority(root, task.submissionResolution.evidence);
  if (task.checkpoint === "confirmed" && !canMarkApplied(task)) throw new Error("Verify the complete job-specific confirmation before recording success.");
  if (task.checkpoint === "submissionAttempted" && data.request) throw new Error("A stop request prevents a new submission attempt.");
  if (task.checkpoint === "submissionAttempted" && data.action && data.action.kind !== "submit") throw new Error("Preserve the actual action identity before submission.");
  data.task = { ...structuredClone(task), decisions: data.task.decisions ?? task.decisions }; save(root, data, found.revision); return true;
}
export function refreshTaskTicket(root: string, task: ApplicationTask, expectedHash: string, path?: string) {
  const owner = acquireOwnership(root, taskOwnershipKey(task.taskId));
  try {
    const found = loadTaskControl(root, task.taskId), data = found.data;
    if (!data || data.ticket.sha256 !== expectedHash || data.request || data.transition || data.action || ["Cancelled", "Deferred"].includes(ticketFolder(data.path))) throw new Error("Reconcile the stopped or changed task before refreshing its reviewed ticket.");
    const destination = path ?? data.path, from = ticketFolder(data.path), to = ticketFolder(destination);
    if (["Cancelled", "Deferred"].includes(to) || basename(destination) !== basename(data.path) || task.originalIntake !== data.task.originalIntake) throw new Error("Use a guarded decision for lifecycle moves and preserve the existing task identity.");
    if (from !== to) assertTaskMove(task, from, to);
    if (data.task.checkpoint === "submissionAttempted" && task.checkpoint !== "submissionAttempted" && !canMarkApplied(task) && task.submissionResolution?.state !== "notSubmitted" || data.task.checkpoint === "confirmed" && !canMarkApplied(task)) throw new Error("Preserve submission recovery.");
    if (task.submissionResolution) authority(root, task.submissionResolution.evidence);
    privateTicket(root, destination); data.path = destination; data.ticket = evidenceFile(root, destination);
    const attention = stageTaskAttention(root, task, data.ticket);
    data.task = { ...structuredClone(task), ticket: data.ticket, decisions: data.task.decisions ?? task.decisions };
    save(root, data, found.revision); commitAttentionChange(root, attention, `${data.ticket.path}:${data.ticket.sha256}`); return data.task;
  } finally { owner.release(); }
}
/** Pickup of a selected user-moved Deferred ticket; never read or enumerate its old directory. */
export function resumeMovedDeferredTask(root: string, task: ApplicationTask, path: string, observedAt: string) {
  const data = loadTaskControl(root, task.taskId).data;
  if (!data || ticketFolder(data.path) !== "Deferred" || ticketFolder(path) !== "To Do" || basename(data.path) !== basename(path)) throw new Error("Select the existing Deferred ticket moved to To Do.");
  privateTicket(root, path);
  const ticket = evidenceFile(root, path);
  if (ticket.sha256 !== data.ticket.sha256) throw new Error("The moved ticket was also edited; reconcile this selected task first.");
  const name = `.local/task-moves/${digest(`${task.taskId}:${path}:${observedAt}:${ticket.sha256}`)}.json`;
  const before = readPrivateJson(root, name);
  savePrivateJson(root, name, { taskId: task.taskId, previousPath: data.path, path, ticket, observedAt, instruction: "The user moved this existing Deferred ticket to To Do; dependency verification remains required." }, before.revision);
  return transitionTask({ root, path, task: data.task, action: "resume", reason: "User requeued the existing Deferred ticket in To Do.", actor: "user", observedAt, authority: evidenceFile(root, name), userMoved: true });
}
export function requestTaskStop(root: string, id: string, request: StopRequest) {
  if (!["cancel", "defer"].includes(request.action) || !request.reason?.trim() || !request.actor?.trim() || !Number.isFinite(Date.parse(request.observedAt))) throw new Error("Record the actual stop instruction.");
  authority(root, request.authority);
  request = { action: request.action, reason: request.reason, actor: request.actor, observedAt: request.observedAt, authority: request.authority };
  for (let n = 0; n < 4; n++) {
    const found = loadTaskControl(root, id), data = found.data;
    if (!data || data.transition || data.task.checkpoint === "confirmed" || ticketFolder(data.path) === "Applied") throw new Error("Select the existing unconfirmed task; recover any move first.");
    if (data.request && JSON.stringify(data.request) !== JSON.stringify(request)) throw new Error("Reconcile the existing stop request before replacing it.");
    if (!data.request) data.stopHistory = [...(data.stopHistory ?? []), structuredClone(request)];
    data.request = structuredClone(request);
    try { save(root, data, found.revision); return { kind: "requested" as const, taskId: id, next: "The owning worker must stop at a safe checkpoint; a dispatched submission still needs outcome verification." }; }
    catch (error) { if (!/changed in another session/.test(String(error)) || n === 3) throw error; }
  }
  throw new Error("Task state is busy; preserve the stop instruction.");
}
export interface TransitionOptions {
  root: string; path: string; task: ApplicationTask; action: TaskDecisionAction; reason: string; actor: string; observedAt: string;
  authority: FileEvidence; cleanupAuthority?: FileEvidence;
  /** A selected To Do file moved by the user, verified against its saved original hash. */
  userMoved?: boolean;
}

function verifiedUnblock(root: string, data: TaskControl, ref: FileEvidence) {
  if (data.request || data.action || !data.task.blocker || !ref.path.startsWith(".local/")) {
    throw new Error("Verify the selected Blocked task after its outstanding action or stop request is resolved.");
  }
  const report = JSON.parse(readEvidence(root, ref).toString("utf8")) as {
    taskId: string; ticketSha256: string; resolvedAt: string; dependencies: { id: string; evidence: FileEvidence }[];
  };
  const expected = data.task.blocker.dependencyIds ?? ["blocker"];
  if (report.taskId !== data.taskId || report.ticketSha256 !== data.ticket.sha256 || report.resolvedAt !== data.task.blocker.resolvedAt ||
    !expected.length || new Set(expected).size !== expected.length || !Array.isArray(report.dependencies) ||
    report.dependencies.length !== expected.length || !expected.every(id => report.dependencies.some(d => d?.id === id))) {
    throw new Error("Verify all dependencies for this exact ticket revision before automatic requeue.");
  }
  for (const dependency of report.dependencies) readEvidence(root, dependency.evidence);
}
export function transitionTask(o: TransitionOptions) {
  const stop = o.action === "cancel" || o.action === "defer";
  let owner: Ownership;
  try { owner = acquireOwnership(o.root, taskOwnershipKey(o.task.taskId)); }
  catch (error) {
    if (error instanceof OwnershipBusy && stop) return requestTaskStop(o.root, o.task.taskId, { ...o, action: o.action as "cancel" | "defer" });
    throw error;
  }
  let alertOwner: Ownership | undefined;
  try {
    let found = loadTaskControl(o.root, o.task.taskId);
    if (!found.data) { bind(o.root, o.task, o.path); found = loadTaskControl(o.root, o.task.taskId); }
    const data = found.data!;
    if (data.transition) throw new Error("Recover the existing task transition before accepting another decision.");
    const from = ticketFolder(data.path), to = o.action === "cancel" ? "Cancelled" : o.action === "defer" ? "Deferred" : "To Do";
    if (data.path !== o.path && !(o.userMoved && o.action === "resume" && from === "Deferred" && ticketFolder(o.path) === "To Do" && basename(data.path) === basename(o.path))) throw new Error("Reconcile only the selected existing task path.");
    privateTicket(o.root, o.path);
    const original = readEvidence(o.root, { ...data.ticket, path: o.path });
    authority(o.root, o.authority); if (o.cleanupAuthority) authority(o.root, o.cleanupAuthority);
    if (data.task.checkpoint === "submissionAttempted" && data.task.submissionResolution?.state !== "notSubmitted") {
      if (stop) return requestTaskStop(o.root, o.task.taskId, { ...o, action: o.action as "cancel" | "defer" });
      throw new Error("Investigate the existing submission before reactivation.");
    }
    if (data.task.submissionResolution) authority(o.root, data.task.submissionResolution.evidence);
    const d: TaskDecision = { id: randomUUID(), action: o.action, from, to, reason: o.reason, actor: o.actor, observedAt: o.observedAt, authority: o.authority };
    validateDecision(d);
    if (o.action === "unblock") verifiedUnblock(o.root, data, o.authority);
    assertTaskMove(data.task, from, to, d);
    const destination = `Task Board/${to}/${basename(data.path)}`;
    privateTicket(o.root, destination);
    if (destination !== o.path && fs.existsSync(resolve(o.root, destination))) throw new Error("The destination already exists; never overwrite a ticket.");
    const task = { ...structuredClone(data.task), decisions: [...(data.task.decisions ?? []), d] };
    delete task.ticket;
    const source = data.source && { ...data.source, completed: data.source.completed || !!loadInboxState(o.root).state.messages.find(r => messageKey(r.identity) === messageKey(data.source!.identity) && terminalCleanup(r)) };
    if (source) {
      alertOwner = acquireOwnership(o.root, alertOwnershipKey(source.identity));
      const current = loadInboxState(o.root).state.messages.find(r => messageKey(r.identity) === messageKey(source.identity));
      const vacancy = current?.vacancies.find(v => v.vacancyKey === source.vacancyKey);
      if (!current || !vacancy || vacancy.taskId !== data.taskId || vacancy.disposition === "applied") throw new Error("Preserve this source's confirmed application and exact task association.");
      if (current.cleanupState === "cleanupPending") throw new Error("Resolve the owned cleanup attempt before starting a task move.");
      source.completed = !!source.completed || terminalCleanup(current);
    }
    const bytes = Buffer.concat([original, Buffer.from(`\n\n## Task decision ${d.id}\n${d.observedAt}: ${d.actor} — ${d.action}. ${d.reason}\nAuthority: ${d.authority.path}\n\n${taskDecisionBlock({ taskId: task.taskId, messageKey: source && messageKey(source.identity), vacancyKey: source?.vacancyKey, decision: d, task })}\n`)]);
    data.source = source;
    data.transition = { decision: d, inputPath: o.path, sourceHash: digest(original), destination, original: original.toString("base64"), bytes: bytes.toString("base64"), task, source, cleanupAuthority: o.cleanupAuthority };
    stageAttentionChange(o.root, data.taskId, d.id, null);
    save(o.root, data, found.revision);
    return recoverOwned(o.root, data, owner, alertOwner);
  } finally { alertOwner?.release(); owner.release(); }
}
function recoverOwned(root: string, data: TaskControl, owner: Ownership, ownedAlert?: Ownership) {
  owner.assertOwned(); const j = data.transition!;
  validateDecision(j.decision); authority(root, j.decision.authority);
  const attention = stageAttentionChange(root, data.taskId, j.decision.id, null);
  if (j.cleanupAuthority) authority(root, j.cleanupAuthority);
  const source = j.source;
  const alertOwner = ownedAlert ?? (source ? acquireOwnership(root, alertOwnershipKey(source.identity)) : undefined);
  try {
    const sourceRecord = () => {
      const loaded = loadInboxState(root), record = loaded.state.messages.find(r => messageKey(r.identity) === messageKey(source!.identity));
      const vacancy = record?.vacancies.find(v => v.vacancyKey === source!.vacancyKey);
      if (!record || !vacancy || vacancy.taskId !== data.taskId) throw new Error("Preserve the original email task association.");
      return { loaded, record, vacancy };
    };
    if (source && !source.completed) {
      const { loaded, record, vacancy } = sourceRecord();
      if (record.cleanupState !== "notReady") throw new Error("Resolve owned email cleanup before changing its task.");
      if (vacancy.taskTransition && vacancy.taskTransition !== j.decision.id) throw new Error("Another task transition must be reconciled first.");
      vacancy.taskTransition = j.decision.id; vacancy.taskPath = j.destination;
      saveTaskEmailRecord(root, record, loaded.revision, alertOwner!, j.decision.id);
    }
    const bytes = Buffer.from(j.bytes, "base64"), absolute = privateTicket(root, j.destination);
    let ticket: FileEvidence;
    if (fs.existsSync(absolute) && digest(fs.readFileSync(absolute)) === digest(bytes)) ticket = evidenceFile(root, j.destination);
    else if (source && !source.completed) ticket = saveAlertArtifact(root, source.identity, j.destination, bytes, j.inputPath === j.destination ? j.sourceHash : null, alertOwner);
    else ticket = writeTicket(root, j.destination, bytes, j.inputPath === j.destination ? j.sourceHash : null);
    let outcome: FileEvidence | undefined;
    if (source && !source.completed && j.decision.action === "cancel") {
      const base = `.local/alerts/${messageKey(source.identity)}/cancellations/${j.decision.id}`;
      const snapshot = saveAlertArtifact(root, source.identity, `${base}/ticket.md`, bytes, fs.existsSync(resolve(root, `${base}/ticket.md`)) ? digest(bytes) : null, alertOwner);
      const value = { schemaVersion: 2, messageKey: messageKey(source.identity), vacancyKey: source.vacancyKey,
        postingUrl: sourceRecord().vacancy.postingUrl, kind: "cancelled", observedAt: j.decision.observedAt,
        taskId: data.taskId, task: j.task, decision: j.decision, ticketSnapshot: snapshot, cleanupAuthority: j.cleanupAuthority };
      const payload = Buffer.from(JSON.stringify(value, null, 2));
      outcome = saveAlertArtifact(root, source.identity, `${base}/outcome.json`, payload, fs.existsSync(resolve(root, `${base}/outcome.json`)) ? digest(payload) : null, alertOwner);
    }
    if (j.inputPath !== j.destination && fs.existsSync(resolve(root, j.inputPath))) {
      const input = privateTicket(root, j.inputPath);
      if (digest(fs.readFileSync(input)) !== j.sourceHash) throw new Error("The original ticket changed; preserve both files for recovery.");
      fs.unlinkSync(input);
    }
    // Commit source progress before releasing the control journal. A crash remains recoverable and execution stays stopped.
    if (source && !source.completed) {
      const { loaded, record, vacancy } = sourceRecord();
      vacancy.taskPath = j.destination; vacancy.taskEvidence = ticket;
      vacancy.disposition = j.decision.action === "cancel" ? "cancelled" : j.decision.action === "defer" ? "deferred" : "pending";
      vacancy.decision = j.decision;
      if (outcome) { vacancy.outcomeEvidence = outcome; vacancy.cancellationCleanupAuthority = j.cleanupAuthority; }
      else { delete vacancy.outcomeEvidence; delete vacancy.cancellationCleanupAuthority; }
      delete vacancy.taskTransition;
      saveTaskEmailRecord(root, record, loaded.revision, alertOwner!, j.decision.id);
    }
    const latest = loadTaskControl(root, data.taskId);
    if (latest.data?.transition?.decision.id !== j.decision.id) throw new Error("Preserve the changed task journal.");
    data = latest.data; data.path = j.destination; data.ticket = ticket; data.task = { ...j.task, ticket };
    data.history.push(j.decision); delete data.transition; delete data.request;
    save(root, data, latest.revision);
    const projection = commitAttentionChange(root, attention, `${ticket.path}:${ticket.sha256}`);
    return { kind: "moved" as const, taskId: data.taskId, path: data.path, decision: j.decision, dependencyVerified: j.decision.action === "unblock", ...projection };
  } finally { if (!ownedAlert) alertOwner?.release(); }
}
export function recoverTaskTransition(root: string, id: string) {
  const owner = acquireOwnership(root, taskOwnershipKey(id));
  try { const data = loadTaskControl(root, id).data; if (!data?.transition) return { kind: "nothingToRecover" as const }; return recoverOwned(root, data, owner); }
  finally { owner.release(); }
}
/** Claim across native browser invocations. Tools are called by the agent, never by this module. */
export function authorizeTaskAction(root: string, task: ApplicationTask, kind: "credentials" | "upload" | "submit", ownerId: string, page: SitePage) {
  if (!ownerId?.trim()) throw new Error("Use the actual stable worker identity.");
  const owner = acquireOwnership(root, taskOwnershipKey(task.taskId), { kind: "native", ownerId });
  try {
    assertTaskActive(root, task);
    assertSiteAction(root, task, page, kind);
    const found = loadTaskControl(root, task.taskId), data = found.data;
    if (!data || data.action || !["credentials", "upload", "submit"].includes(kind) || kind === "submit" && (task.checkpoint !== "prepared" || data.task.checkpoint !== "prepared")) throw new Error("Bind and prepare this task before authorizing its one browser action.");
    data.action = { id: randomUUID(), kind, ownerId, token: owner.token };
    save(root, data, found.revision);
    return { taskId: task.taskId, ...data.action };
  } catch (error) { owner.release(); throw error; }
}
export function assertAuthorizedTaskAction(root: string, id: string, token: string) {
  const found = loadTaskControl(root, id), data = found.data, a = data?.action;
  if (!data || !a || a.token !== token || data.request || data.transition || a.uncertain || a.invoked || !["Email Alerts", "To Do"].includes(ticketFolder(data.path))) throw new Error("Stop or reconcile this browser action before any further invocation.");
  resumeNativeOwnership(root, taskOwnershipKey(id), token, a.ownerId).assertOwned(); readEvidence(root, data.ticket);
  assertCurrentSource(root, data);
  if (a.kind === "submit" && data.task.checkpoint !== "submissionAttempted") throw new Error("Persist Submission attempted before the final browser action.");
  if (a.kind !== "submit" && !["working", "prepared"].includes(data.task.checkpoint)) throw new Error("Preserve this task's submission recovery before other browser actions.");
  a.invoked = true; save(root, data, found.revision);
}
export function observeTaskAction(root: string, id: string, token: string, result: "completed" | "notSubmitted" | "confirmed" | "unknown", evidence: FileEvidence, confirmed?: ApplicationTask) {
  if (!["completed", "notSubmitted", "confirmed", "unknown"].includes(result)) throw new Error("Record a supported actual browser outcome.");
  const found = loadTaskControl(root, id), data = found.data, a = data?.action;
  if (!data || !a || a.token !== token) throw new Error("Resume the same owned browser action.");
  const owner = resumeNativeOwnership(root, taskOwnershipKey(id), token, a.ownerId); authority(root, evidence);
  if (a.kind === "submit" && result === "completed" || a.kind !== "submit" && ["notSubmitted", "confirmed"].includes(result)) throw new Error("Record the actual action-specific outcome.");
  if (result === "unknown") { a.uncertain = true; a.evidence = evidence; save(root, data, found.revision); return { kind: "uncertain" as const }; }
  const stopRequested = !!data.request;
  if (result === "confirmed") {
    if (!confirmed || confirmed.taskId !== id || !canMarkApplied(confirmed)) throw new Error("Preserve uncertainty until the actual job-specific confirmation is recorded.");
    data.task = { ...structuredClone(confirmed), decisions: data.task.decisions ?? confirmed.decisions };
    delete data.request; // The requested stop remains in stopHistory; actual success is not relabeled Cancelled.
  } else if (result === "notSubmitted") data.task.submissionResolution = { state: "notSubmitted", evidence };
  delete data.action; save(root, data, found.revision); owner.release();
  return { kind: "observed" as const, result, stopRequested };
}
