import { randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import { resolve } from "node:path";
import { digest, readEvidence, type FileEvidence } from "../email/evidence.js";
import { readPrivateJson, savePrivateJson } from "../workflow/private-json.js";
import { acquireOwnership, assertOperationOwnership, type Ownership } from "../workflow/ownership.js";
import { isSlot, nextSlots, slotMs, validInstant, validateSchedule, type Schedule } from "./schedule.js";

export const publishingFile = ".local/publishing/state.json";
export const dispatchKey = "linkedin-publishing-dispatch";
export const publishingWorker = "linkedin-publishing-worker";
const evidenceDirectory = ".local/publishing/evidence/";
export type Format = "text" | "image" | "video";
type Account = { profileUrl: string; storageState: string; audience: "Anyone" | "Connections only"; routeReference: string };
type PublicProfile = { voice: string; topics: string[]; facts: { id: string; text: string }[] };
type Access = { sourceReference: string; accountRevision: string; formats: Format[]; scheduled: boolean };
export type Preferences = {
  timezone: string; schedule: Schedule; scheduleReference: string | null; paused: boolean;
  account: Account | null; profile: PublicProfile; sourceReference: string;
};
type Media = FileEvidence & { kind: "image" | "video"; rightsReference: string; origin: "supplied" | "online"; url?: string; credit?: string };
export type Draft = { text: string; topic: string; facts: string[]; media?: Media };
type Slot = { at: string; recurring: boolean; scheduleRevision: string | null };
export type Receipt = { reference: string; observedAt: string; url?: string };
type Attempt = {
  id: string; at: string; accountRevision: string; profileUrl: string; draftRevision: string; format: Format;
  pilot: boolean; sourceReference: string; result?: { status: "published" | "notPublished"; receipt: Receipt; evidence?: FileEvidence };
};
export type Post = {
  id: string; draft: Draft; profileRevision: string; createdAt: string; slot: Slot | null;
  status: "draft" | "queued" | "skipped" | "attempted" | "published"; attempts: Attempt[];
};
type ScheduledCheck = { revision: string; checkedAt: string; evidence: FileEvidence };
export type State = {
  schemaVersion: 1; preferences: Preferences | null; access: Access | null; scheduledCheck: ScheduledCheck | null; posts: Post[];
};
const emptyState = (): State => ({ schemaVersion: 1, preferences: null, access: null, scheduledCheck: null, posts: [] });
const hash = (value: unknown) => digest(JSON.stringify(value));
const format = (post: Post): Format => post.draft.media?.kind ?? "text";
const formats: Format[] = ["text", "image", "video"];
const statusValues = ["draft", "queued", "skipped", "attempted", "published"];
const text = (value: unknown, max = 300): value is string => typeof value === "string" && !!value.trim() && value.length <= max && !/\u0000/.test(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const sha = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const only = (object: object, keys: string[]) => Object.keys(object).every(key => keys.includes(key));
const profileUrl = (value: unknown): value is string => typeof value === "string" && /^https:\/\/www\.linkedin\.com\/in\/[a-z0-9_%-]+\/$/i.test(value);
const postUrl = (value: unknown): value is string => typeof value === "string" &&
  /^https:\/\/www\.linkedin\.com\/feed\/update\/urn:li:(?:activity|ugcPost|share):\d+\/?$/.test(value);
const accountRevision = (preferences: Preferences) => hash(preferences.account);
const scheduleRevision = (preferences: Preferences) => hash([preferences.schedule, preferences.timezone, preferences.scheduleReference]);
const scheduledRevision = (preferences: Preferences) => hash([accountRevision(preferences), scheduleRevision(preferences)]);

/** Check every existing segment, including junctions and missing descendants of aliases. */
export function publishingPath(root: string, name: string) {
  if (!/^(?:\.local\/publishing\/|\.auth\/)[a-zA-Z0-9_./-]+$/.test(name) ||
    name.split("/").some(part => !part || part === ".." || part === ".")) throw new Error("Use a contained private publishing or browser-state path.");
  const parts = name.split("/");
  for (let i = 1; i <= parts.length; i++) {
    try {
      const info = lstatSync(resolve(root, ...parts.slice(0, i)));
      if (info.isSymbolicLink() || (i < parts.length ? !info.isDirectory() : !info.isFile())) {
        throw new Error("Keep publishing files in their private workspace without filesystem aliases.");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      break;
    }
  }
  return resolve(root, name);
}

function validatePreferences(p: Preferences) {
  if (!p || typeof p.paused !== "boolean" || !text(p.sourceReference) ||
    !(p.scheduleReference === null || text(p.scheduleReference)) || !p.profile ||
    !only(p.profile, ["voice", "topics", "facts"]) ||
    typeof p.profile.voice !== "string" || p.profile.voice.length > 2000 ||
    !Array.isArray(p.profile.topics) || p.profile.topics.some(topic => !text(topic)) ||
    !Array.isArray(p.profile.facts) || p.profile.facts.some(fact => !fact || !only(fact, ["id", "text"]) || !id(fact.id) || !text(fact.text, 2000)) ||
    new Set(p.profile.facts.map(fact => fact.id)).size !== p.profile.facts.length) throw new Error("Save the user's public content profile and scheduling choices.");
  validateSchedule(p.schedule, p.timezone);
  if (p.account !== null && (!p.account || !only(p.account, ["profileUrl", "storageState", "audience", "routeReference"]) ||
    !profileUrl(p.account.profileUrl) || !/^\.auth\/[a-z0-9_.-]+\.json$/i.test(p.account.storageState) ||
    !["Anyone", "Connections only"].includes(p.account.audience) || !text(p.account.routeReference))) {
    throw new Error("Bind the exact LinkedIn member profile, authorized browser state, audience and route reference.");
  }
}

function validateDraft(d: Draft) {
  if (!d || !only(d, ["text", "topic", "facts", "media"]) || !text(d.text, 3000) || !text(d.topic) ||
    !Array.isArray(d.facts) || d.facts.some(fact => !id(fact)) || (!d.facts.length && !d.media)) {
    throw new Error("Stage a LinkedIn post grounded in the public profile or supplied media.");
  }
  const m = d.media;
  if (!m) return;
  if (!only(m, ["path", "sha256", "kind", "rightsReference", "origin", "url", "credit"]) ||
    !/^\.local\/publishing\/media\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.(?:jpe?g|png|webp|mp4)$/i.test(m.path) ||
    !sha(m.sha256) || !text(m.rightsReference) || !["supplied", "online"].includes(m.origin) ||
    (m.kind === "video" ? !/\.mp4$/i.test(m.path) : m.kind !== "image" || /\.mp4$/i.test(m.path)) ||
    (m.origin === "online" && (!m.url || !/^https:\/\//.test(m.url) || !text(m.credit))) ||
    (m.credit && !d.text.includes(m.credit))) throw new Error("Bind the media file, publication rights and any attribution included in the post.");
}

export function loadPublishing(root: string) {
  publishingPath(root, publishingFile);
  const loaded = readPrivateJson(root, publishingFile);
  const state = (loaded.data ?? emptyState()) as State;
  if (state.schemaVersion !== 1 || !Array.isArray(state.posts) || new Set(state.posts.map(post => post?.id)).size !== state.posts.length ||
    (state.access !== null && (!state.access || !text(state.access.sourceReference) || !sha(state.access.accountRevision) ||
      !Array.isArray(state.access.formats) || !state.access.formats.every(value => formats.includes(value)) || typeof state.access.scheduled !== "boolean")) ||
    (state.scheduledCheck !== null && (!state.scheduledCheck || !sha(state.scheduledCheck.revision) ||
      !validInstant(state.scheduledCheck.checkedAt) || !state.scheduledCheck.evidence))) throw new Error("Preserve the unreadable LinkedIn publishing checkpoint for investigation.");
  if (state.preferences !== null) validatePreferences(state.preferences);
  for (const post of state.posts) {
    if (!post || !id(post.id) || !statusValues.includes(post.status) || !sha(post.profileRevision) || !validInstant(post.createdAt) ||
      !Array.isArray(post.attempts) || (post.slot !== null && (!post.slot || !validInstant(post.slot.at) ||
        typeof post.slot.recurring !== "boolean" || (post.slot.recurring ? !sha(post.slot.scheduleRevision) : post.slot.scheduleRevision !== null))) ||
      (post.status === "queued" && !post.slot) ||
      (post.status === "attempted" && (!post.attempts.length || post.attempts.at(-1)?.result)) ||
      (post.status === "published" && post.attempts.at(-1)?.result?.status !== "published") ||
      post.attempts.some((attempt, index) => !attempt || !id(attempt.id) || !validInstant(attempt.at) || !profileUrl(attempt.profileUrl) ||
        !sha(attempt.accountRevision) || !sha(attempt.draftRevision) || !formats.includes(attempt.format) || typeof attempt.pilot !== "boolean" ||
        !text(attempt.sourceReference) || (!attempt.result && (index !== post.attempts.length - 1 || post.status !== "attempted")) ||
        (attempt.result && (!["published", "notPublished"].includes(attempt.result.status) || !validReceipt(attempt.result.receipt))))) {
      throw new Error("Preserve the unreadable LinkedIn post and attempt history.");
    }
    validateDraft(post.draft);
  }
  return { state, revision: loaded.revision };
}

function change<T>(root: string, run: (state: State) => T, lock = true) {
  const update = () => {
    const loaded = loadPublishing(root);
    const result = run(loaded.state);
    savePrivateJson(root, publishingFile, loaded.state, loaded.revision);
    return result;
  };
  if (!lock) return update();
  const owner = acquireOwnership(root, dispatchKey, { waitMs: 1000 });
  try { return update(); } finally { owner.release(); }
}

function requirePreferences(state: State) {
  if (!state.preferences) throw new Error("Set up LinkedIn publishing before managing its drafts or schedule.");
  return state.preferences;
}

export function savePublishingPreferences(root: string, patch: Partial<Preferences> & { sourceReference: string }) {
  if (!patch || Object.keys(patch).some(key => !["timezone", "schedule", "scheduleReference", "paused", "account", "profile", "sourceReference"].includes(key))) {
    throw new Error("Supply only LinkedIn publishing settings.");
  }
  return change(root, state => {
    const current = state.preferences;
    const defaults: Preferences = { timezone: "UTC", schedule: { kind: "onDemand" }, scheduleReference: null, paused: false,
      profile: { voice: "", topics: [], facts: [] }, account: null, sourceReference: patch.sourceReference };
    const next = { ...defaults, ...current, ...patch };
    validatePreferences(next);
    if (next.account) publishingPath(root, next.account.storageState);
    if (next.scheduleReference && next.scheduleReference !== current?.scheduleReference) {
      for (const path of [".local/operation-preferences.json", ".local/attention-preferences.json"]) {
        const other = readPrivateJson(root, path).data as { scheduleReference?: string } | null;
        if (other?.scheduleReference === next.scheduleReference) throw new Error("Use a dedicated LinkedIn publishing timer.");
      }
    }
    if (current && accountRevision(current) !== accountRevision(next)) state.access = null;
    if (current && scheduledRevision(current) !== scheduledRevision(next)) state.scheduledCheck = null;
    state.preferences = next;
    return next;
  });
}

function selected(state: State, postId: string) {
  const post = state.posts.find(entry => entry.id === postId);
  if (!post) throw new Error("Select an existing LinkedIn post.");
  return post;
}

function verifyMedia(root: string, media: Media | undefined) {
  if (!media) return;
  const path = publishingPath(root, media.path), length = lstatSync(path).size;
  if (!length || length > (media.kind === "video" ? 128 : 20) * 1024 * 1024) throw new Error("The selected media exceeds the local publishing size limit.");
  const bytes = readEvidence(root, media);
  const valid = /\.mp4$/i.test(path) ? bytes.subarray(4, 8).toString() === "ftyp" :
    /\.png$/i.test(path) ? bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) :
    /\.webp$/i.test(path) ? bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP" :
      bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!valid) throw new Error("Use media whose bytes match its supported file format.");
  return { name: media.path.split("/").at(-1)!, bytes, kind: media.kind };
}

export function saveDraft(root: string, draft: Draft, now: string, postId?: string) {
  validateDraft(draft);
  if (!validInstant(now)) throw new Error("Use the current draft time.");
  verifyMedia(root, draft.media);
  return change(root, state => {
    const p = requirePreferences(state);
    if (draft.facts.some(fact => !p.profile.facts.some(saved => saved.id === fact))) throw new Error("Use only saved public-profile fact references.");
    const profileRevision = hash(p.profile);
    const post = postId ? selected(state, postId) : null;
    if (post) {
      if (!["draft", "queued"].includes(post.status)) throw new Error("Resolve the selected post's outcome before editing it.");
      Object.assign(post, { draft, profileRevision });
      return post;
    }
    const next: Post = { id: randomUUID(), draft, profileRevision, createdAt: now, slot: null, status: "draft", attempts: [] };
    state.posts.push(next);
    return next;
  });
}

export function queuePost(root: string, postId: string, at: string, recurring: boolean, now: string) {
  if (!validInstant(at) || !validInstant(now) || at <= now || typeof recurring !== "boolean") throw new Error("Choose an actual future publishing time.");
  return change(root, state => {
    const p = requirePreferences(state), post = selected(state, postId);
    if (!["draft", "queued", "skipped"].includes(post.status)) throw new Error("Resolve the existing publishing attempt before scheduling it.");
    if (recurring && !isSlot(p.schedule, p.timezone, at)) throw new Error("Use an occurrence of the saved publishing cadence.");
    if (state.posts.some(entry => entry.id !== post.id && entry.slot?.at === at && ["queued", "attempted", "published"].includes(entry.status))) {
      throw new Error("A post already owns that publishing slot.");
    }
    post.slot = { at, recurring, scheduleRevision: recurring ? scheduleRevision(p) : null };
    post.status = "queued";
    return post;
  });
}

export function skipPost(root: string, postId: string) {
  return change(root, state => {
    const post = selected(state, postId);
    if (post.status !== "queued") throw new Error("Select a queued LinkedIn post to skip.");
    post.status = "skipped";
    return post;
  });
}

export function publishingBrief(root: string, now: string) {
  const { state } = loadPublishing(root), p = state.preferences;
  let scheduledAccess = false;
  if (p && state.scheduledCheck) {
    try { checkScheduled(root, state, p); scheduledAccess = true; } catch { /* A changed capability is displayed as unavailable. */ }
  }
  return { configured: !!p, paused: p?.paused ?? false, mode: state.access ? "enabled" : "draftsOnly",
    timezone: p?.timezone ?? null, publicProfile: p?.profile ?? null,
    upcoming: p ? nextSlots(p.schedule, p.timezone, now) : [],
    scheduleReference: p?.scheduleReference ?? null, scheduledAccess,
    recentTopics: state.posts.slice(-12).map(post => post.draft.topic),
    posts: state.posts.map(({ id, status, slot, attempts }) => ({ id, status, slot,
      missed: status === "queued" && !!slot && Date.parse(now) >= Date.parse(slot.at) + slotMs,
      reschedule: status === "queued" && !!slot?.recurring && !!p && slot.scheduleRevision !== scheduleRevision(p),
      lastAttempt: attempts.at(-1)?.result ?? null })) };
}

export function showDraft(root: string, postId: string) { return selected(loadPublishing(root).state, postId); }

function checkEvidence(root: string, evidence: FileEvidence) {
  if (!evidence?.path?.startsWith(evidenceDirectory) || !/\.(json|md|txt)$/i.test(evidence.path)) {
    throw new Error("Use dedicated private LinkedIn publishing evidence.");
  }
  publishingPath(root, evidence.path);
  return readEvidence(root, evidence);
}

function checkSyntheticEvidence(root: string, evidence: FileEvidence, checkedAt: string) {
  const result = JSON.parse(checkEvidence(root, evidence).toString("utf8")) as {
    synthetic?: boolean; verified?: Format[]; checkedAt?: string;
  };
  if (result.synthetic !== true || !Array.isArray(result.verified) || !formats.every(value => result.verified!.includes(value)) ||
    !validInstant(result.checkedAt) || result.checkedAt > checkedAt) throw new Error("Complete the synthetic publishing rehearsal first.");
}

export function recordScheduledCheck(root: string, evidence: FileEvidence) {
  const report = JSON.parse(checkEvidence(root, evidence).toString("utf8")) as {
    executionContext?: string; workingRoot?: string; scheduleReference?: string; scheduleRunReference?: string; revision?: string;
    checkedAt?: string; composerOpened?: boolean; syntheticRehearsal?: FileEvidence;
  };
  return change(root, state => {
    const p = requirePreferences(state);
    if (!p.account || !p.scheduleReference || report.executionContext !== "scheduled" || report.scheduleReference !== p.scheduleReference ||
      !text(report.scheduleRunReference) || report.revision !== scheduledRevision(p) || !report.workingRoot || resolve(report.workingRoot) !== resolve(root) ||
      !validInstant(report.checkedAt) || report.composerOpened !== true || !report.syntheticRehearsal) {
      throw new Error("Verify the same account and composer through the actual dedicated scheduled execution.");
    }
    checkSyntheticEvidence(root, report.syntheticRehearsal, report.checkedAt);
    state.scheduledCheck = { revision: scheduledRevision(p), checkedAt: report.checkedAt, evidence };
    return state.scheduledCheck;
  });
}

function checkScheduled(root: string, state: State, p: Preferences) {
  if (!p.scheduleReference || state.scheduledCheck?.revision !== scheduledRevision(p)) throw new Error("Verify the dedicated scheduled LinkedIn browser first.");
  const report = JSON.parse(checkEvidence(root, state.scheduledCheck.evidence).toString("utf8")) as { syntheticRehearsal: FileEvidence };
  checkSyntheticEvidence(root, report.syntheticRehearsal, state.scheduledCheck.checkedAt);
}

export function enablePublishing(root: string, allowedFormats: Format[], scheduled: boolean, sourceReference: string) {
  if (!Array.isArray(allowedFormats) || !allowedFormats.length || new Set(allowedFormats).size !== allowedFormats.length ||
    !allowedFormats.every(value => formats.includes(value)) || typeof scheduled !== "boolean" || !text(sourceReference)) {
    throw new Error("Record the actual standing permission and the verified publishing formats.");
  }
  return change(root, state => {
    const p = requirePreferences(state), account = accountRevision(p);
    if (!p.account || allowedFormats.some(value => !state.posts.some(post => post.attempts.some(attempt =>
      attempt.pilot && attempt.accountRevision === account && attempt.format === value && attempt.result?.status === "published")))) {
      throw new Error("Confirm an explicitly authorized pilot for each publishing format and the selected account.");
    }
    if (scheduled) checkScheduled(root, state, p);
    state.access = { accountRevision: account, formats: allowedFormats, scheduled, sourceReference };
    return state.access;
  });
}

export function disablePublishing(root: string, sourceReference: string) {
  if (!text(sourceReference)) throw new Error("Reference the user's publishing stop request.");
  return change(root, state => {
    state.access = null;
    if (state.preferences) Object.assign(state.preferences, { paused: true, sourceReference });
    return { paused: true };
  });
}

export type RunRequest = { kind: "scheduled"; scheduleReference: string } | { kind: "manual"; postId: string; sourceReference: string; pilot?: true };

export function inspectRun(root: string, request: RunRequest, now: string) {
  if (!validInstant(now)) throw new Error("Use the current publishing time.");
  const { state } = loadPublishing(root);
  const p = state.preferences;
  if (!p?.account || p.paused) return null;
  const account = p.account, accountKey = accountRevision(p);
  const pilot = request.kind === "manual" && request.pilot === true;
  const access = state.access;
  if (!pilot && (!access || access.accountRevision !== accountKey)) return null;
  let post: Post | undefined;
  if (request.kind === "scheduled") {
    if (!access?.scheduled || request.scheduleReference !== p.scheduleReference) return null;
    post = state.posts.find(entry => entry.status === "queued" && entry.slot &&
      (!entry.slot.recurring || entry.slot.scheduleRevision === scheduleRevision(p)) &&
      now >= entry.slot.at && Date.parse(now) < Date.parse(entry.slot.at) + slotMs);
    if (!post) return null;
    checkScheduled(root, state, p);
  } else {
    post = selected(state, request.postId);
    if (!["draft", "queued"].includes(post.status)) throw new Error("Resolve the original publishing attempt before sending this post again.");
  }
  const sourceReference = request.kind === "manual" ? request.sourceReference : access!.sourceReference;
  if (!text(sourceReference) || (!pilot && !access!.formats.includes(format(post)))) throw new Error("Verify publishing permission for the selected post format.");
  if (post.profileRevision !== hash(p.profile)) throw new Error("Recheck this draft against the current public publishing profile.");
  return { post, account, accountKey, pilot, sourceReference, revision: hash([post.draft, post.slot, post.profileRevision, p.scheduleReference, sourceReference]) };
}

export function prepareMedia(root: string, draft: Draft) { return verifyMedia(root, draft.media); }

/** The dispatch owner serializes schedule edits with this revision check and the actual click. */
export function recordAttempt(root: string, owner: Ownership, request: RunRequest, expected: NonNullable<ReturnType<typeof inspectRun>>, now: string) {
  assertOperationOwnership(root, dispatchKey, owner);
  const current = inspectRun(root, request, now);
  if (!current || current.post.id !== expected.post.id || current.revision !== expected.revision || current.accountKey !== expected.accountKey) return null;
  const attempt: Attempt = { id: randomUUID(), at: now, accountRevision: current.accountKey, profileUrl: current.account.profileUrl,
    draftRevision: hash(current.post.draft), format: format(current.post), pilot: current.pilot, sourceReference: current.sourceReference };
  return change(root, state => {
    const post = selected(state, current.post.id);
    post.attempts.push(attempt);
    post.status = "attempted";
    return attempt;
  }, false);
}

function validReceipt(receipt: Receipt) {
  return receipt && text(receipt.reference) && validInstant(receipt.observedAt) && (receipt.url === undefined || postUrl(receipt.url));
}

function finish(root: string, postId: string, attemptId: string, result: NonNullable<Attempt["result"]>) {
  if (!validReceipt(result.receipt)) throw new Error("Record the actual outcome and exact LinkedIn post link when available.");
  return change(root, state => {
    const post = selected(state, postId), attempt = post.attempts.at(-1);
    if (post.status !== "attempted" || attempt?.id !== attemptId || result.receipt.observedAt < attempt.at) throw new Error("Reconcile the same unresolved publishing attempt.");
    attempt.result = result;
    post.status = result.status === "published" ? "published" : "draft";
    if (result.status === "notPublished") post.slot = null;
    return post;
  });
}

export function confirmPost(root: string, owner: Ownership, postId: string, attemptId: string, receipt: Receipt) {
  assertOperationOwnership(root, publishingWorker, owner);
  return finish(root, postId, attemptId, { status: "published", receipt });
}

export function reconcilePost(root: string, postId: string, attemptId: string, status: "published" | "notPublished", receipt: Receipt, evidence: FileEvidence) {
  if (!["published", "notPublished"].includes(status) || !validReceipt(receipt) || status === "notPublished" && receipt.url) {
    throw new Error("Keep uncertain publication unresolved until there is evidence.");
  }
  checkEvidence(root, evidence);
  const owner = acquireOwnership(root, publishingWorker);
  try { return finish(root, postId, attemptId, { status, receipt, evidence }); }
  finally { owner.release(); }
}

export function accountProbe(root: string) {
  const p = requirePreferences(loadPublishing(root).state);
  if (!p.account) throw new Error("Select the LinkedIn account for the publishing rehearsal.");
  return { account: p.account, revision: scheduledRevision(p), scheduleReference: p.scheduleReference };
}
