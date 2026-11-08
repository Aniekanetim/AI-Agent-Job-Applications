import fs from "node:fs";
import { resolve } from "node:path";
import { digest, evidenceFile, readEvidence, type FileEvidence } from "../email/evidence.js";
import { acquireOwnership } from "../workflow/ownership.js";
import { ticketFolder, type BoardFolder } from "../workflow/board.js";
import { contentIdentityExists, contentIdentityPath, listContentTickets } from "../workflow/intake.js";
import { readPrivateJson, savePrivateJson } from "../workflow/private-json.js";
import { contentReference, readBoardConfig, readContentProfile, saveBoardConfig, type ContentMode } from "./board-config.js";
import { contentPath, moveContentTicket, readContentTicket, recoverContentMove, saveContentTicket, type ContentTicket } from "./board-tickets.js";
import { historyMatch, postFingerprint, recentContent, recordPublishedHistory, releasePublication } from "./history.js";
import { dispatchKey, importBoardPost, inspectRun, loadPublishing, prepareMedia, publishingPath, publishingWorker, recordAttempt,
  readBoardPost, reconcilePost, releaseConfirmedBoardDraft, saveDraft, validatePublishingAccount,
  type Draft, type Post } from "./store.js";
import { publish } from "./worker.js";

const clock = () => new Date().toISOString();
const legacyFolders = ["Content Creation", "Deferred", "Blocked", "Applied", "Cancelled"] as const;
const reportPath = (id: string, receipt: string) => `.local/publishing/evidence/confirm-${digest(`${id}:${receipt}`)}.json`;

export function configureBoardMode(root: string, mode: ContentMode, sourceReference: string, account?: Parameters<typeof saveBoardConfig>[3]) {
  if (account) {
    validatePublishingAccount(account);
    publishingPath(root, account.storageState);
  }
  const owner = acquireOwnership(root, dispatchKey);
  try {
    const current = readBoardConfig(root).data;
    if (mode !== "off" || !current) {
      const legacy = loadPublishing(root);
      if (cutoverIncomplete(root, current, legacy)) throw new Error("Preview and adopt the old publishing queue first.");
      if (!current) account ??= legacy.state.preferences?.account ?? null;
    }
    if (mode !== "off" && !(account === undefined ? current?.account : account)) throw new Error("Bind the selected LinkedIn account before enabling content work.");
    return saveBoardConfig(root, mode, sourceReference, account);
  } finally { owner.release(); }
}

export function contentBrief(root: string) {
  const config = readBoardConfig(root).data, mode = config?.mode ?? "off";
  if (mode === "off") return { mode };
  const account = config?.account;
  return { mode, ...readContentProfile(root), recent: account ? recentContent(root, account.profileUrl) : [] };
}

export function contentHistory(root: string, input: { text: string; topic: string; angle: string }) {
  const account = readBoardConfig(root).data?.account;
  if (!account || typeof input.text !== "string" || !contentReference(input.topic) || !contentReference(input.angle)) {
    throw new Error("Select the publishing account and actual topic and angle.");
  }
  return historyMatch(root, account.profileUrl, input.text, input.topic, input.angle);
}

export function createContentTask(root: string, input: { source: "agent" | "user"; sourceReference: string; topic: string; angle: string }) {
  const mode = readBoardConfig(root).data?.mode;
  if (!input || !contentReference(input.sourceReference) || !contentReference(input.topic) || !contentReference(input.angle) ||
    !["agent", "user"].includes(input.source) || !mode || mode === "off" || mode === "onDemand" && input.source !== "user") {
    throw new Error("Use an eligible source and the user's saved content mode.");
  }
  const { profile, sha256 } = readContentProfile(root);
  if (!profile.topics.includes(input.topic)) throw new Error("Use a topic covered by the saved content context.");
  const id = digest(input.sourceReference).slice(0, 32), path = contentPath(id);
  if (fs.existsSync(resolve(root, path))) return readContentTicket(root, path).file;
  if (contentIdentityExists(root, id)) {
    throw new Error("Resume the original content ticket through its lifecycle.");
  }
  return saveContentTicket(root, { schemaVersion: 1, kind: "content", id, source: input.source,
    sourceReference: input.sourceReference, topic: input.topic, angle: input.angle,
    fingerprint: digest(""), draftSha256: digest(""), profileSha256: sha256, ready: false }, null);
}

export function stageBoardDraft(root: string, input: { id?: string; source: "agent" | "user"; sourceReference: string; angle: string; draft: Draft }, now = clock()) {
  if (!input || !contentReference(input.sourceReference) || !contentReference(input.angle) || !["agent", "user"].includes(input.source) ||
    input.id !== undefined && !/^[a-zA-Z0-9_-]{1,100}$/.test(input.id)) throw new Error("Bind the draft to the actual source and intended content angle.");
  const mode = readBoardConfig(root).data?.mode;
  if (!mode || mode === "off" || mode === "onDemand" && (input.source !== "user" || input.draft?.media?.origin !== "supplied")) {
    throw new Error("Use Autonomous mode or supply the user's post and media in On-demand mode.");
  }
  const { profile, sha256 } = readContentProfile(root);
  if (!profile.topics.includes(input.draft?.topic)) throw new Error("Use a topic covered by the saved content context.");
  const id = input.id ?? digest(input.sourceReference).slice(0, 32), path = contentPath(id);
  const existing = fs.existsSync(resolve(root, path)) ? readContentTicket(root, path) : null;
  const account = readBoardConfig(root).data?.account;
  if (!account) throw new Error("Bind the selected LinkedIn account.");
  const previous = readBoardPost(root, id);
  if (!existing && contentIdentityExists(root, id)) throw new Error("Return this existing ticket to Content Creation before editing its draft.");
  if (existing && (existing.ticket.source !== input.source && existing.ticket.source !== "legacy" || !input.id && existing.ticket.sourceReference !== input.sourceReference)) {
    throw new Error("Keep the selected content ticket's original source.");
  }
  const media = input.draft.media, ownedPrefix = `.local/publishing/media/CONTENT-${id}-`;
  if (media && (media.origin === "online" || media.path.startsWith(".local/publishing/media/CONTENT-")) && !media.path.startsWith(ownedPrefix)) {
    throw new Error("Stage sourced media as a private copy owned by this exact content ticket.");
  }
  const fingerprint = postFingerprint(input.draft.text);
  const duplicate = historyMatch(root, account.profileUrl, input.draft.text, input.draft.topic, input.angle);
  if (duplicate.exact || duplicate.sameAngle) throw new Error("Choose a fresh text and angle for this LinkedIn account.");
  for (const item of listContentTickets(root)) {
    if (item.path === path) continue;
    const other = readContentTicket(root, item.path).ticket;
    if (other.ready && (other.fingerprint === fingerprint ||
      other.topic.trim().toLowerCase() === input.draft.topic.trim().toLowerCase() && other.angle.trim().toLowerCase() === input.angle.trim().toLowerCase())) {
      throw new Error("A prepared ticket already covers this content.");
    }
  }
  const draft = saveDraft(root, input.draft, now, previous?.id, { id, profile, sha256 });
  const ticket: ContentTicket = { schemaVersion: 1, kind: "content", id, source: existing?.ticket.source ?? input.source, preparedBy: input.source,
    sourceReference: existing?.ticket.sourceReference ?? input.sourceReference, topic: input.draft.topic, angle: input.angle,
    fingerprint, profileSha256: sha256, draftSha256: digest(JSON.stringify(draft.draft)), ready: true };
  return saveContentTicket(root, ticket, existing?.file.sha256 ?? null);
}

function archive(root: string, path: string, post: Post) {
  const last = post.attempts.at(-1), receipt = last?.result?.status === "published" ? last.result.receipt : undefined;
  if (!receipt || !last) throw new Error("Confirm the existing publication before completing the content ticket.");
  const selected = readContentTicket(root, path), t = selected.ticket;
  if (last.draftRevision !== t.draftSha256 || t.fingerprint !== postFingerprint(post.draft.text)) throw new Error("Match the receipt to this exact content draft.");
  recordPublishedHistory(root, { id: t.id, account: last.profileUrl, fingerprint: t.fingerprint, topic: t.topic, angle: t.angle, receipt });
  releasePublication(root, last.profileUrl, t.fingerprint, t.id);
  if (ticketFolder(path) !== "Applied") {
    const evidence = reportPath(t.id, last.id), file = publishingPath(root, evidence);
    fs.mkdirSync(resolve(root, ".local/publishing/evidence"), { recursive: true });
    const bytes = JSON.stringify({ ticketId: t.id, attemptId: last.id, draftSha256: t.draftSha256, receipt });
    if (!fs.existsSync(file)) fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600, flush: true });
    if (fs.readFileSync(file, "utf8") !== bytes) throw new Error("Preserve the actual publication evidence.");
    const authority = evidenceFile(root, evidence);
    const moved = moveContentTicket(root, path, selected.file.sha256, "Applied", authority, { receipt, attempts: post.attempts, ready: false });
    path = moved.path;
  }
  const media = post.draft.media;
  if (media?.origin === "online" && media.path.startsWith(`.local/publishing/media/CONTENT-${t.id}-`)) {
    const ownedCopy = publishingPath(root, media.path);
    if (fs.existsSync(ownedCopy) && digest(fs.readFileSync(ownedCopy)) === media.sha256) fs.unlinkSync(ownedCopy);
  }
  releaseConfirmedBoardDraft(root, t.id, receipt);
  return { action: "published" as const, path, receipt };
}

function requirePost(root: string, id: string) {
  const post = readBoardPost(root, id);
  if (!post) throw new Error("Recover the selected content draft.");
  return post;
}

export async function runBoardPost(root: string, id: string, scheduleReference?: string, prepare?: Parameters<typeof publish>[2], now = clock) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error("Select an active content ticket.");
  const path = contentPath(id);
  const selected = readContentTicket(root, path);
  if (!selected.ticket.ready) return { action: "idle" as const };
  const post = requirePost(root, id);
  if (post.status === "published") return archive(root, path, post);
  if (post.status === "attempted") return { action: "verifyAttempt" as const, postId: id, attemptId: post.attempts.at(-1)!.id };
  const result = await publish(root, { kind: "board", postId: id, scheduleReference }, prepare, now);
  return result.action === "published" ? archive(root, path, requirePost(root, id)) : result;
}

export function observeContentOutcome(root: string, input: { path: string; attemptId: string; status: Parameters<typeof reconcilePost>[3];
  receipt: Parameters<typeof reconcilePost>[4]; evidence: FileEvidence }) {
  const { ticket } = readContentTicket(root, input.path);
  const post = requirePost(root, ticket.id);
  const result = post.status === "published" && post.attempts.at(-1)?.id === input.attemptId ? post :
    reconcilePost(root, ticket.id, input.attemptId, input.status, input.receipt, input.evidence, true);
  return result.status === "published" ? archive(root, input.path, result) : { action: "notPublished" as const, postId: ticket.id };
}

type ToolChoice = { id: string; status: "verified" | "unsupported" | "unavailable" | "denied"; actions: string[]; evidence?: FileEvidence };
export function chooseContentTool(root: string, preferred: string, tools: ToolChoice[], action: string) {
  if (!contentReference(preferred) || !contentReference(action) || !Array.isArray(tools) || tools.some(tool =>
    !tool || !contentReference(tool.id) || !["verified", "unsupported", "unavailable", "denied"].includes(tool.status) ||
    !Array.isArray(tool.actions) || !tool.actions.every(contentReference))) throw new Error("Describe the available tools and their observed capabilities.");
  if (tools.some(tool => tool.id === preferred && tool.status === "denied")) throw new Error("Resolve the selected tool or account denial.");
  const candidates = tools.filter(tool => tool.status === "verified" && tool.actions.includes(action) && tool.evidence);
  const selected = candidates.find(tool => tool.id === preferred) ?? candidates[0];
  if (!selected) return { action: "toolNeedsAttention" as const };
  readEvidence(root, selected.evidence!);
  return { action: "useTool" as const, tool: selected.id };
}

/** Agent-owned tools use the same durable click boundary as the bundled browser. */
export function authorizeContentTool(root: string, input: { id: string; tool: string; scheduleReference?: string; evidence: FileEvidence }, now = clock()) {
  const request = { kind: "board" as const, postId: input.id, scheduleReference: input.scheduleReference };
  const worker = acquireOwnership(root, publishingWorker);
  try {
    const dispatch = acquireOwnership(root, dispatchKey);
    try {
      const target = inspectRun(root, request, now);
      if (!target || !contentReference(input.tool) || !input.evidence?.path.startsWith(".local/publishing/evidence/")) throw new Error("Verify the selected active publishing tool and prepared draft.");
      publishingPath(root, input.evidence.path);
      const observation = JSON.parse(readEvidence(root, input.evidence).toString("utf8")) as {
        tool: string; account: string; audience: string; draftSha256: string; mediaSha256?: string; controlsVerified: boolean;
      };
      prepareMedia(root, target.post.draft);
      if (observation.tool !== input.tool || observation.account !== target.account.profileUrl || observation.audience !== target.account.audience ||
        observation.draftSha256 !== digest(JSON.stringify(target.post.draft)) || observation.mediaSha256 !== target.post.draft.media?.sha256 ||
        observation.controlsVerified !== true) throw new Error("Verify the same LinkedIn account, audience, draft and media through this tool.");
      const attempt = recordAttempt(root, dispatch, request, target, now, { tool: input.tool, evidence: input.evidence });
      if (!attempt) throw new Error("The selected ticket or authorization changed before the action.");
      return { invokeOnce: true, attemptId: attempt.id, postId: input.id, tool: input.tool };
    } finally { dispatch.release(); }
  } finally { worker.release(); }
}

export function transitionContent(root: string, input: { path: string; expected: string; action: "block" | "unblock" | "defer" | "cancel" | "resume" | "restore";
  authority: FileEvidence; dependencies?: string[] }) {
  const owner = acquireOwnership(root, dispatchKey);
  try {
    if (readBoardConfig(root).data?.adopted === false) throw new Error("Finish importing the old publishing queue before moving its tickets.");
    const { ticket, file } = readContentTicket(root, input.path), from = ticketFolder(input.path);
    const post = readBoardPost(root, ticket.id);
    if (file.sha256 !== input.expected || post?.status === "published" || post?.status === "attempted" && input.action !== "block") {
      throw new Error("Reconcile this exact content ticket and its publication outcome before moving it.");
    }
    const to: BoardFolder = input.action === "block" ? "Blocked" : input.action === "defer" ? "Deferred" :
      input.action === "cancel" ? "Cancelled" : "Content Creation";
    if ((input.action === "unblock" && !["Blocked", "Content Creation"].includes(from)) || (input.action === "resume" && from !== "Deferred") ||
      (input.action === "restore" && from !== "Cancelled") || !["block", "unblock", "defer", "cancel", "resume", "restore"].includes(input.action)) {
      throw new Error("Use the exact selected content lifecycle action.");
    }
    if (input.action === "block" && (!Array.isArray(input.dependencies) || !input.dependencies.length ||
      !input.dependencies.every(id => /^[a-zA-Z0-9_-]{1,100}$/.test(id)) || new Set(input.dependencies).size !== input.dependencies.length)) {
      throw new Error("Record each concrete content dependency.");
    }
    if (input.action === "unblock") {
      const report = JSON.parse(readEvidence(root, input.authority).toString("utf8")) as {
        taskId: string; ticketSha256: string; dependencies: { id: string; evidence: FileEvidence }[];
      };
      if (!input.authority.path.startsWith(".local/") || report.taskId !== `CONTENT-${ticket.id}` || report.ticketSha256 !== file.sha256 ||
        !Array.isArray(report.dependencies) || !ticket.dependencies?.length || report.dependencies.length !== ticket.dependencies.length ||
        !ticket.dependencies.every(id => report.dependencies.some(d => d?.id === id))) throw new Error("Verify every content dependency for this exact ticket.");
      for (const dependency of report.dependencies) readEvidence(root, dependency.evidence);
      if (from === "Content Creation") {
        delete ticket.dependencies;
        return saveContentTicket(root, ticket, file.sha256);
      }
    }
    return moveContentTicket(root, input.path, input.expected, to, input.authority,
      input.action === "block" ? { dependencies: input.dependencies } : {});
  } finally { owner.release(); }
}

function cutoverIncomplete(root: string, config: ReturnType<typeof readBoardConfig>["data"], legacy: ReturnType<typeof loadPublishing>) {
  if (!config) return !!(legacy.state.posts.length || legacy.state.preferences?.scheduleReference);
  if (!config.adopted) return true;
  if (config.legacyRevision === legacy.revision) return false;
  // Older board settings could record adoption before copying every post.
  return legacy.state.posts.some(post => {
    if (!contentIdentityExists(root, post.id)) return true;
    const applied = `Task Board/Applied/CONTENT-${post.id}.md`;
    if (!fs.existsSync(resolve(root, applied))) return !readBoardPost(root, post.id);
    const ticket = readContentTicket(root, applied).ticket;
    if (!ticket.receipt) return true;
    const attempt = post.attempts.at(-1);
    return post.status === "published" && (!attempt || !historyMatch(root, attempt.profileUrl, post.draft.text, ticket.topic, ticket.angle).exact);
  });
}

export function previewPublishingCutover(root: string) {
  const legacy = loadPublishing(root), { state } = legacy, config = readBoardConfig(root).data;
  return { adopted: !!config && !cutoverIncomplete(root, config, legacy), legacyTimer: state.preferences?.scheduleReference ?? null,
    posts: state.posts.map(post => ({ id: post.id, status: post.status, destination: post.status === "published" ? "Applied" :
      post.status === "attempted" ? "Blocked" : "Deferred" })) };
}

export function adoptPublishingBoard(root: string, sourceReference: string, stoppedTimer?: FileEvidence) {
  const worker = acquireOwnership(root, publishingWorker);
  try {
    const dispatch = acquireOwnership(root, dispatchKey);
    let legacy: ReturnType<typeof loadPublishing>;
    try {
      legacy = loadPublishing(root);
      const { state } = legacy, existing = readBoardConfig(root).data;
      if (existing && existing.mode !== "off") throw new Error("Preserve the already enabled shared publishing workflow.");
      if (state.preferences?.scheduleReference) {
        if (!stoppedTimer?.path.startsWith(".local/publishing/evidence/")) throw new Error("Record the verified stop of the old publishing timer.");
        const report = JSON.parse(readEvidence(root, stoppedTimer).toString("utf8")) as { scheduleReference: string; status: string };
        if (report.scheduleReference !== state.preferences.scheduleReference || report.status !== "stopped") throw new Error("Verify the exact old timer is stopped.");
      }
      if (existing?.adopted && !cutoverIncomplete(root, existing, legacy)) {
        return { adopted: true, imported: state.posts.length };
      }
      saveBoardConfig(root, "off", sourceReference, existing?.account ?? state.preferences?.account, { adopted: false, legacyRevision: null });
    } finally { dispatch.release(); }
    for (const post of legacy.state.posts) {
      const known = legacyFolders.filter(folder => fs.existsSync(resolve(root, `Task Board/${folder}/CONTENT-${post.id}.md`)));
      if (known.length > 1) throw new Error("Reconcile the duplicate legacy content ticket paths.");
      const folder = post.status === "published" ? "Applied" : post.status === "attempted" ? "Blocked" : "Deferred";
      const last = post.attempts.at(-1), receipt = last?.result?.status === "published" ? last.result.receipt : undefined;
      const ticket: ContentTicket = { schemaVersion: 1, kind: "content", id: post.id, source: "legacy", sourceReference,
        topic: post.draft.topic, angle: post.draft.topic, fingerprint: postFingerprint(post.draft.text),
        profileSha256: post.profileRevision, draftSha256: digest(JSON.stringify(post.draft)), ready: false,
        ...(receipt ? { receipt, attempts: post.attempts } : {}), ...(folder === "Blocked" ? { dependencies: ["publicationOutcome"] } : {}) };
      if (!known.length) saveContentTicket(root, ticket, null, folder);
      else {
        const selected = readContentTicket(root, `Task Board/${known[0]}/CONTENT-${post.id}.md`);
        if (selected.ticket.source !== "legacy" || receipt && known[0] !== "Applied" ||
          known[0] === "Applied" && !selected.ticket.receipt) throw new Error("Reconcile the existing ticket for this legacy post before migration.");
        const identity = contentIdentityPath(post.id), saved = readPrivateJson(root, identity);
        if (!saved.data) savePrivateJson(root, identity, { id: post.id }, saved.revision);
      }
      if (receipt) archive(root, `Task Board/Applied/CONTENT-${post.id}.md`, post);
      else if (known[0] !== "Applied") importBoardPost(root, post);
    }
    const finalize = acquireOwnership(root, dispatchKey);
    try {
      if (loadPublishing(root).revision !== legacy.revision) throw new Error("The old publishing queue changed. Reconcile the cutover before enabling content work.");
      saveBoardConfig(root, "off", sourceReference, undefined, { adopted: true, legacyRevision: legacy.revision });
    } finally { finalize.release(); }
    return { adopted: true, imported: legacy.state.posts.length };
  } finally { worker.release(); }
}

export function recoverBoardPublication(root: string, id: string) {
  const moved = recoverContentMove(root, id);
  const applied = `Task Board/Applied/CONTENT-${id}.md`;
  if (!fs.existsSync(resolve(root, applied))) return moved;
  const post = readBoardPost(root, id);
  return post ? archive(root, applied, post) : moved;
}
