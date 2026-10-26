import { existsSync, readFileSync, mkdirSync, realpathSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { resolve, relative, dirname, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { withWriteOwnership } from "../workflow/ownership.js";
import { readPrivateJson, savePrivateJson } from "../workflow/private-json.js";
import { loadProgress, saveProgress, digest } from "./state-store.js";
import { refreshProgress, stepIds, stepLabels, emptyCheck, type OnboardingProgress, type EvidenceReference } from "./progress.js";
import { emptyConversation, validateDecision, sameDecision, supplied, validTime,
  type Decision, type FocusedQuestion, type ConversationState } from "./conversation-types.js";
import { workCheckpoint, type WorkCheckpoint } from "./continuation.js";
import { loadMenu } from "../settings/state.js";

const journal = ".local/onboarding-pending-response.json";
const globalTargets = new Set(["Job Context/Candidate/role-routing.local.md", ".local/browser-preferences.json", ".local/browser/visibility.json",
  ".local/operation-preferences.json", ".local/email-onboarding.json", ".local/email-connection.json"]);
const conversation = (s: OnboardingProgress): ConversationState => s.conversation ?? emptyConversation();
const fieldKey = (d: Decision) => JSON.stringify([d.roleId, d.contextPath, d.field]);

function privatePath(root: string, name: string): string {
  if (name.includes("\\") || isAbsolute(name) || name.split("/").some(p => !p || p === ".." || p === ".")) throw new Error("Use a contained private relative path.");
  const path = resolve(root, name);
  let ancestor = path;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  const part = relative(realpathSync(root), realpathSync(ancestor));
  if (part === ".." || part.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(part)) throw new Error("Private onboarding data must stay in this working copy.");
  if (execFileSync("git", ["-C", root, "ls-files", "--", name], { encoding: "utf8", windowsHide: true }).trim()) throw new Error("Actual onboarding data must be untracked.");
  try { execFileSync("git", ["-C", root, "check-ignore", "--no-index", "--quiet", name], { windowsHide: true }); }
  catch { throw new Error("Actual onboarding data must be ignored by Git."); }
  return path;
}
function validateTarget(root: string, d: Decision, routing?: string) {
  validateDecision(d); privatePath(root, d.contextPath);
  if (d.roleId !== null) {
    const path = resolve(root, "Job Context/Candidate/role-routing.local.md");
    const contents = routing ?? (existsSync(path) ? readFileSync(path, "utf8") : "");
    const rows = contents.split(/\r?\n/).filter(line => line.trim().startsWith("|")).map(line => line.split("|").slice(1, -1).map(cell => cell.trim()));
    const matches = rows.filter(row => row[0] === d.roleId);
    if (matches.length !== 1 || !/^Role Profiles\/[^/\\]+$/.test(matches[0][1]) ||
      !d.contextPath.startsWith(`Job Context/Candidate/${matches[0][1]}/`) || !d.contextPath.endsWith(".local.md")) {
      throw new Error("Bind each role answer to its exact profile path in canonical role routing; do not mix profiles.");
    }
  } else if (!globalTargets.has(d.contextPath) && !/^Job Context\/Job Boards\/[^/]+\/access-and-instructions\.local\.md$/.test(d.contextPath)) {
    throw new Error("A global decision must use an existing canonical setup/access location, not a role's facts.");
  }
}
function update(root: string, run: (state: OnboardingProgress) => void) {
  return withWriteOwnership(root, "onboarding-conversation", () => {
    const loaded = loadProgress(root), state = structuredClone(loaded.state); state.conversation ??= emptyConversation();
    run(state);
    const next = refreshProgress(state);
    if (JSON.stringify(next) !== JSON.stringify(loaded.state)) saveProgress(root, next, loaded.revision);
    return next;
  });
}
export function queueQuestions(root: string, questions: Omit<FocusedQuestion, "status" | "askedAt">[]) {
  return update(root, state => {
    const c = state.conversation!;
    for (const input of questions) {
      validateTarget(root, input);
      if (!supplied(input.prompt) || input.prompt.length > 500 || typeof input.required !== "boolean") throw new Error("Write one concise question about the bound decision.");
      if (state.scope === "profileSetup" && (input.roleId === null && input.contextPath !== "Job Context/Candidate/role-routing.local.md" ||
        ["browserTools", "connections", "siteMapping"].includes(input.step))) throw new Error("Ask only questions relevant to profile-only setup.");
      const old = c.questions.find(q => q.id === input.id), answer = c.answers.filter(a => fieldKey(a) === fieldKey(input)).at(-1);
      if (old) {
        if (!sameDecision(old, input) || old.prompt !== input.prompt || old.required !== input.required) throw new Error("Preserve question identity; clarify or revise it explicitly instead of replacing history.");
        continue;
      }
      if (c.questions.some(q => fieldKey(q) === fieldKey(input))) throw new Error("Reuse the existing question for this field instead of asking it twice.");
      const legacy = state.pendingQuestions.find(q => !!q && typeof q === "object" && (q as { id?: unknown }).id === input.id);
      const askedAt = (legacy as { askedAt?: unknown })?.askedAt;
      c.questions.push({ ...input, status: answer ? "answered" : "pending", askedAt: validTime(askedAt) ? askedAt : null,
        ...(legacy ? { legacy: structuredClone(legacy) } : {}) });
    }
  });
}

export type NextQuestion = WorkCheckpoint | { action: "paused" | "wait" | "verifyPresentation" | "recoverResponse" | "settings" } |
  { action: "present" | "repeatOnRequest"; question: FocusedQuestion };
export function nextQuestion(root: string, requestedRepeat = false): { state: OnboardingProgress; next: NextQuestion } {
  let next: NextQuestion = { action: "wait" };
  const state = update(root, state => {
    const c = state.conversation!;
    if (c.mode === "paused") { next = { action: "paused" }; return; }
    if (readPrivateJson(root, journal).data !== null) { next = { action: "recoverResponse" }; return; }
    if (loadMenu(root).state.phase !== "closed") { next = { action: "settings" }; return; }
    let q = c.questions.find(q => q.id === c.activeQuestionId);
    if (!q) {
      q = c.questions.find(q => q.status === "pending");
      if (q) c.activeQuestionId = q.id;
    }
    if (!q) { next = workCheckpoint(root, state); return; }
    const clarification = q.clarifications?.at(-1), presented = clarification ? clarification.presentedAt : q.askedAt;
    const display = clarification ? { ...q, prompt: clarification.prompt } : q;
    if (!presented && q.presentationPending && !requestedRepeat) { next = { action: "verifyPresentation" }; return; }
    if (!presented) q.presentationPending = true;
    next = presented ? requestedRepeat ? { action: "repeatOnRequest", question: display } : { action: "wait" } : { action: "present", question: display };
  });
  return { state, next };
}
export function resumeOnboarding(root: string, sourceReference: string, now: string) {
  setConversationMode(root, "active", sourceReference, now);
  return nextQuestion(root, true);
}

/** Reopen only the requested decision; keep its prior prompt and all saved answers. */
export function reviseQuestion(root: string, id: string, prompt: string, sourceReference: string, now: string) {
  if (!supplied(prompt) || prompt.length > 500 || !supplied(sourceReference) || !validTime(now)) throw new Error("Use one focused settings question and the actual change request.");
  return update(root, state => {
    if (readPrivateJson(root, journal).data !== null) throw new Error("Recover the saved response before changing another setting.");
    const c = state.conversation!, q = c.questions.find(q => q.id === id);
    if (!q) throw new Error("Queue a new decision for an unrecorded setting; revise an existing question by its saved ID.");
    if (q.status === "pending") throw new Error("Continue or clarify this pending decision instead of reopening it.");
    c.revisions ??= []; c.revisions.push({ question: structuredClone(q), sourceReference, recordedAt: now });
    q.prompt = prompt; q.status = "pending"; q.askedAt = null; q.presentationPending = false;
    delete q.sourceReference; delete q.deferredReference; delete q.clarifications;
    c.activeQuestionId = id;
    state.steps.readiness = emptyCheck();
  });
}
export function recordQuestionPresented(root: string, id: string, reference: string, now: string) {
  return update(root, state => {
    const c = state.conversation!, q = c.questions.find(q => q.id === id);
    if (c.mode === "paused" || c.activeQuestionId !== id || !q || q.status !== "pending" || !supplied(reference) || !validTime(now)) throw new Error("Record the actual presentation of the one active question.");
    const clarification = q.clarifications?.at(-1);
    if (clarification && !clarification.presentedAt) { clarification.presentedAt = now; clarification.presentedReference = reference; }
    if (!q.askedAt) { q.askedAt = now; q.sourceReference = reference; }
    q.presentationPending = false;
  });
}
export function recoverUnshownQuestion(root: string, id: string, sourceReference: string, now: string) {
  return update(root, state => {
    const c = state.conversation!, q = c.questions.find(q => q.id === id);
    const presented = q?.clarifications?.length ? q.clarifications.at(-1)!.presentedAt : q?.askedAt;
    if (!q || c.activeQuestionId !== id || q.status !== "pending" || !q.presentationPending || presented || !supplied(sourceReference) || !validTime(now)) throw new Error("Inspect the actual unacknowledged prompt and record that it was not shown before retrying it.");
    q.presentationRecovery ??= []; q.presentationRecovery.push({ sourceReference, recordedAt: now }); q.presentationPending = false;
  });
}
export function clarifyQuestion(root: string, id: string, prompt: string, sourceReference: string, now: string) {
  if (!supplied(prompt) || prompt.length > 500 || !supplied(sourceReference) || !validTime(now)) throw new Error("Clarify only the unresolved decision using the actual reply reference.");
  return update(root, state => {
    const q = state.conversation!.questions.find(q => q.id === id);
    if (!q || q.status !== "pending") throw new Error("Clarification must retain an existing unanswered decision.");
    const previous = q.clarifications?.at(-1);
    if (previous?.prompt === prompt && previous.sourceReference === sourceReference) return;
    q.clarifications ??= [];
    q.clarifications.push({ prompt, sourceReference, recordedAt: now });
    q.presentationPending = false;
  });
}
export function setConversationMode(root: string, mode: "active" | "paused", sourceReference: string, now: string) {
  if (!["active", "paused"].includes(mode) || !supplied(sourceReference) || !validTime(now)) throw new Error("Pause/resume requires the user's actual instruction reference.");
  return update(root, state => {
    const c = state.conversation!;
    if (c.mode === mode) return;
    c.mode = mode; c.pauseReference = { sourceReference, recordedAt: now };
  });
}
export function deferQuestion(root: string, id: string, sourceReference: string) {
  return update(root, state => {
    const c = state.conversation!, q = c.questions.find(q => q.id === id);
    if (!q || q.required || !supplied(sourceReference)) throw new Error("Only an optional question can be deferred under the user's instruction.");
    q.status = "deferred"; q.deferredReference = sourceReference; q.presentationPending = false;
    if (c.activeQuestionId === id) c.activeQuestionId = null;
    state.pendingQuestions = state.pendingQuestions.filter(old => (old as { id?: unknown })?.id !== id);
  });
}
export function recordRoadmapShown(root: string) {
  return update(root, state => { state.conversation!.roadmapShown = true; });
}

export interface ResponseBundle {
  schemaVersion: 1;
  id: string;
  sourceReference: string;
  observedAt: string;
  answers: { decision: Decision; kind: "answer" | "correction" }[];
  writes: { path: string; expectedSha256: string | null; content: string }[];
  references: EvidenceReference[];
  reconciliation?: { previousProposalSha256: string; reviewReference: string };
}
function validateBundle(root: string, state: OnboardingProgress, value: unknown): asserts value is ResponseBundle {
  const b = value as ResponseBundle, c = conversation(state);
  if (!b || b.schemaVersion !== 1 || !/^[a-zA-Z0-9_-]{1,100}$/.test(b.id) || !supplied(b.sourceReference) || !validTime(b.observedAt) ||
    !Array.isArray(b.answers) || !b.answers.length || !Array.isArray(b.writes) || !Array.isArray(b.references)) throw new Error("Record all clear answers from one actual response with canonical write/reference bindings.");
  const routing = b.writes.find(w => w.path === "Job Context/Candidate/role-routing.local.md")?.content;
  const bindings = new Set<string>(), ids = new Set<string>(), paths = new Set<string>();
  for (const a of b.answers) {
    validateTarget(root, a.decision, routing);
    const key = fieldKey(a.decision), q = c.questions.find(q => q.id === a.decision.id || fieldKey(q) === key), old = c.answers.filter(old => fieldKey(old) === key).at(-1);
    if (bindings.has(key) || ids.has(a.decision.id) || !["answer", "correction"].includes(a.kind) ||
      q && !sameDecision(q, a.decision) || old && old.responseId !== b.id && a.kind !== "correction") throw new Error("Preserve field/profile identity; a changed saved answer needs an explicit correction.");
    bindings.add(key); ids.add(a.decision.id);
  }
  for (const w of b.writes) {
    if (!w.path.endsWith(".local.md") || !b.answers.some(a => a.decision.contextPath === w.path) || typeof w.content !== "string" ||
      !w.content.trim() || paths.has(w.path) || !(w.expectedSha256 === null || /^[a-f0-9]{64}$/.test(w.expectedSha256))) throw new Error("Stage one revision-checked canonical Markdown proposal per changed file; settings use their existing utilities.");
    privatePath(root, w.path); paths.add(w.path);
  }
  for (const r of b.references) {
    if (!b.answers.some(a => a.decision.contextPath === r.path) || paths.has(r.path) || !/^[a-f0-9]{64}$/.test(r.sha256)) throw new Error("Reference only the actual canonical files saved by existing setup utilities.");
    privatePath(root, r.path); paths.add(r.path);
  }
  if (b.answers.some(a => !paths.has(a.decision.contextPath))) throw new Error("Every answer must bind to an actual canonical save before it can be resolved.");
}
/** Rebase only actual file conflicts; preserve the original reply and decision identities. */
export function reconcileStagedResponse(root: string, proposed: ResponseBundle, reviewReference: string) {
  return withWriteOwnership(root, "onboarding-conversation", () => {
    const loaded = loadProgress(root), stored = readPrivateJson(root, journal), old = stored.data as ResponseBundle;
    validateBundle(root, loaded.state, old); validateBundle(root, loaded.state, proposed);
    if (!supplied(reviewReference) || old.id !== proposed.id || old.sourceReference !== proposed.sourceReference || old.observedAt !== proposed.observedAt ||
      old.answers.length !== proposed.answers.length || old.answers.some((a, i) => a.kind !== proposed.answers[i].kind || !sameDecision(a.decision, proposed.answers[i].decision)) ||
      old.writes.length !== proposed.writes.length || old.references.length !== proposed.references.length) throw new Error("Reconcile the same retained reply and bindings; a new answer cannot replace pending work.");
    let conflict = false;
    for (const w of old.writes) {
      const replacement = proposed.writes.find(next => next.path === w.path), current = fileHash(root, w.path);
      if (!replacement) throw new Error("Preserve every staged canonical file.");
      if (current === w.expectedSha256 || current === digest(w.content)) {
        if (replacement.content !== w.content || replacement.expectedSha256 !== w.expectedSha256) throw new Error("Preserve already saved or unconflicted proposals.");
      } else {
        conflict = true;
        if (replacement.expectedSha256 !== current) throw new Error("Review and merge against the actual newer canonical revision.");
      }
    }
    for (const ref of old.references) {
      const replacement = proposed.references.find(next => next.path === ref.path), current = fileHash(root, ref.path);
      if (!replacement || replacement.sha256 !== current) throw new Error("Recheck the actual semantic setting before updating its retained reference.");
      if (ref.sha256 !== current) conflict = true;
    }
    if (!conflict) throw new Error("No changed canonical file needs reconciliation; recover the original response.");
    const next = { ...structuredClone(proposed), reconciliation: { previousProposalSha256: digest(JSON.stringify(old)), reviewReference } };
    savePrivateJson(root, journal, next, stored.revision); return next;
  });
}
function fileHash(root: string, name: string) { const path = privatePath(root, name); return existsSync(path) ? digest(readFileSync(path)) : null; }
function invalidateChangedChecks(state: OnboardingProgress, canonical: Map<string, string>) {
  const checks = [...Object.values(state.steps), ...Object.values(state.preparation), state.emailConnection,
    ...state.boards.flatMap(b => [b.access, ...Object.values(b.mapping)])];
  let changed = false;
  for (const check of checks) if (check.evidence.some(ref => canonical.has(ref.path) && canonical.get(ref.path) !== ref.sha256)) {
    changed = true;
    check.status = "inProgress"; check.nextAction = "Revalidate this changed canonical context; preserve unrelated preparation.";
  }
  if (changed) state.steps.readiness = emptyCheck();
}

/** The agent interprets language. This store commits its reviewed private file proposals, never guesses answers. */
export function applyResponse(root: string, input?: ResponseBundle): OnboardingProgress {
  return withWriteOwnership(root, "onboarding-conversation", () => {
    const loaded = loadProgress(root), stored = readPrivateJson(root, journal), bundle = input ?? stored.data;
    validateBundle(root, loaded.state, bundle);
    if (stored.data && JSON.stringify(stored.data) !== JSON.stringify(bundle)) throw new Error("Recover the existing staged response before accepting another response.");
    const previous = conversation(loaded.state).responses.find(r => r.id === bundle.id);
    if (previous) {
      if (previous.proposalSha256 !== digest(JSON.stringify(bundle))) throw new Error("Do not reuse a response ID for different answers.");
      if (stored.data && (bundle.writes.some(w => fileHash(root, w.path) !== digest(w.content)) || bundle.references.some(r => fileHash(root, r.path) !== r.sha256))) throw new Error("Reconcile changed canonical context before clearing the retained response.");
      if (stored.data) unlinkSync(privatePath(root, journal));
      return loaded.state;
    }
    // Check the whole proposal before the first canonical change. A resumed partial save accepts its own exact output hash.
    for (const w of bundle.writes) {
      const hash = fileHash(root, w.path);
      if (hash !== w.expectedSha256 && hash !== digest(w.content)) throw new Error("Canonical context changed; preserve and reconcile the staged response instead of overwriting it.");
    }
    for (const ref of bundle.references) if (fileHash(root, ref.path) !== ref.sha256) throw new Error("A referenced answer was not saved or changed; keep the question unresolved.");
    if (!stored.data) savePrivateJson(root, journal, bundle, null);
    for (const w of bundle.writes) {
      const hash = fileHash(root, w.path), expected = digest(w.content);
      if (hash === expected) continue;
      const path = privatePath(root, w.path); mkdirSync(dirname(path), { recursive: true }); privatePath(root, w.path);
      const temp = resolve(dirname(path), `onboarding-${randomUUID()}.local.md`);
      try {
        writeFileSync(temp, w.content, { mode: 0o600, flag: "wx", flush: true });
        if (fileHash(root, w.path) !== w.expectedSha256) throw new Error("Context changed during its save; recover the retained response.");
        renameSync(temp, path);
      } finally { if (existsSync(temp)) unlinkSync(temp); }
    }
    const canonical = new Map([...bundle.references.map(r => [r.path, r.sha256] as const), ...bundle.writes.map(w => [w.path, digest(w.content)] as const)]);
    for (const [path, sha] of canonical) if (fileHash(root, path) !== sha) throw new Error("Verify the interrupted canonical save before resolving any question.");
    const state = structuredClone(loaded.state); state.conversation ??= emptyConversation(); const c = state.conversation;
    for (const a of bundle.answers) {
      const d = a.decision;
      c.answers.push({ ...d, responseId: bundle.id, sourceReference: bundle.sourceReference,
        canonical: { path: d.contextPath, sha256: canonical.get(d.contextPath)! }, savedAt: bundle.observedAt, kind: a.kind });
      state.contextRevisions[d.contextPath] = canonical.get(d.contextPath)!;
      const q = c.questions.find(q => fieldKey(q) === fieldKey(d));
      if (q) { q.status = "answered"; q.presentationPending = false; if (q.id === c.activeQuestionId) c.activeQuestionId = null; }
      if (!q?.legacy) for (const old of state.pendingQuestions.filter(old => (old as { id?: unknown })?.id === d.id)) {
        c.legacyResolutions ??= [];
        c.legacyResolutions.push({ decisionId: d.id, responseId: bundle.id, question: structuredClone(old) });
      }
      state.pendingQuestions = state.pendingQuestions.filter(old => (old as { id?: unknown })?.id !== d.id);
    }
    c.responses.push({ id: bundle.id, sourceReference: bundle.sourceReference, savedAt: bundle.observedAt,
      decisionIds: bundle.answers.map(a => a.decision.id), proposalSha256: digest(JSON.stringify(bundle)) });
    invalidateChangedChecks(state, canonical);
    state.updatedAt = bundle.observedAt;
    saveProgress(root, refreshProgress(state), loaded.revision);
    unlinkSync(privatePath(root, journal));
    return state;
  });
}

export function readConversationInput(root: string, name: string): unknown {
  if (!name.startsWith(".local/") || name === journal) throw new Error("Use a private proposal file under .local; do not pass answers in command arguments.");
  return JSON.parse(readFileSync(privatePath(root, name), "utf8"));
}
export function conversationSummary(state: OnboardingProgress): string {
  const c = conversation(state), active = c.questions.find(q => q.id === c.activeQuestionId);
  const required = stepIds.filter(id => state.steps[id].status !== "skipped");
  const stage = active?.step ?? required.find(id => state.steps[id].status !== "complete");
  const lines = [c.mode === "paused" ? "Onboarding paused — progress saved." : stage ?
    required.includes(stage) ? `Onboarding — step ${required.indexOf(stage) + 1} of ${required.length}: ${stepLabels[stage]}` :
      `Onboarding focus: ${stepLabels[stage]}. Reconcile this question with the current scope.` : "Onboarding preparation recorded."];
  if (active) lines.push(`Current focus: ${active.substep}${active.roleId ? ` (${active.roleId})` : ""}.`);
  if (stage) {
    const saved = new Set(c.answers.filter(a => a.step === stage).map(fieldKey)).size;
    lines.push(`Saved decisions in this stage: ${saved}. Preparation and access require their separate checks.`);
  }
  if (c.mode !== "paused" && active?.askedAt) lines.push("Waiting for the current answer; previously supplied details remain saved.");
  return lines.join("\n");
}
