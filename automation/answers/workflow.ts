import { readEvidence, type FileEvidence } from "../email/evidence.js";
import { loadProgress } from "../onboarding/state-store.js";
import type { ResponseBundle } from "../onboarding/conversation.js";
import type { Decision } from "../onboarding/conversation-types.js";
import { roles } from "../settings/context.js";
import { loadAttentionSession } from "../attention/session-state.js";
import { attentionMetadataExists } from "../attention/metadata.js";
import { withWriteOwnership } from "../workflow/ownership.js";
import { answerDecision, answerField, candidateFile, formatReusableAnswers, loadReusableAnswers, mostSpecific, normalizeScope, parseReusableAnswers,
  reusableAnswerPath, reusableBinding, scopeMatches, scopeOverrides, usableAnswer, validDate, validateAnswerValue, validateFieldId,
  type AnswerScope, type AnswerValue, type ReusableAnswer } from "./context.js";

const aliases = new Map([
  ["what is your notice period", "notice_period"],
  ["notice period", "notice_period"],
  ["how much notice do you need to give", "notice_period"],
  ["what date can you start", "available_start_date"],
  ["earliest start date", "available_start_date"],
]);

export function matchesLegacyAnswerField(field: string, decision: Decision) {
  const normalized = field.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const fieldId = normalized === "notice" ? "notice_period" : normalized;
  return fieldId === reusableBinding(decision).fieldId;
}

export interface AnswerRequest {
  fieldId?: string;
  question?: string;
  context: AnswerScope;
  questionScope: AnswerScope;
  onDate: string;
  /** The agent's interpretation of an actual applicable value in the selected role. */
  existing?: { value: AnswerValue; scope: AnswerScope; evidence: FileEvidence };
}

function requestDecision(request: AnswerRequest) {
  if (!validDate(request.onDate)) throw new Error("Use the current application date as YYYY-MM-DD.");
  const wording = request.question?.trim().toLowerCase().replace(/\s+/g, " ").replace(/[?.]+$/, "");
  const known = wording && aliases.get(wording);
  if (known && request.fieldId && known !== request.fieldId) throw new Error("Verify the question's meaning before reusing an answer.");
  const fieldId = request.fieldId ?? known;
  if (!fieldId) return null;
  const context = normalizeScope(request.context);
  const scope = normalizeScope(request.questionScope);
  if (!scopeMatches(scope, context)) throw new Error("The proposed answer scope must match this application.");
  return { fieldId, context, decision: answerDecision(fieldId, scope) };
}

type Match = { answer: ReusableAnswer; evidence: FileEvidence };

/** Run only for an active application or explicitly selected review. No task queue is read. */
export function lookupApplicationAnswer(root: string, request: AnswerRequest) {
  const target = requestDecision(request);
  if (!target) return { action: "unmapped" as const };
  return withWriteOwnership(root, "onboarding-conversation", () => resolveCurrentAnswer(root, request, target));
}

function resolveCurrentAnswer(root: string, request: AnswerRequest, target: NonNullable<ReturnType<typeof requestDecision>>) {
  const { fieldId, context, decision } = target;
  const session = loadAttentionSession(root).session;
  if (session.response || attentionMetadataExists(root, ".local/onboarding-pending-response.json")) return { action: "recoverResponse" as const };
  const stored = loadReusableAnswers(root);
  const candidates: Match[] = [];
  for (const answer of stored.answers) {
    if (answer.fieldId === fieldId && answer.value !== null && scopeMatches(answer.scope, context)) {
      candidates.push({ answer, evidence: { path: reusableAnswerPath, sha256: stored.sha256! } });
    }
  }
  if (request.existing) {
    const { value, evidence } = request.existing;
    const scope = normalizeScope(request.existing.scope);
    candidateFile(root, "Job Context/Candidate/role-routing.local.md");
    const role = roles(root).find(role => role.enabled && role.id === context.roleId);
    if (!role || scope.roleId !== role.id || !scopeMatches(scope, context) ||
      !["application-answers", "role-profile", "job-preferences", "experience-and-qualifications"].some(name => evidence.path === `${role.path}/${name}.local.md`)) {
      throw new Error("Bind an existing answer to the selected role's applicable canonical evidence.");
    }
    validateAnswerValue(fieldId, value);
    candidateFile(root, evidence.path);
    readEvidence(root, evidence);
    candidates.push({ answer: { fieldId, scope, value, sourceReference: evidence.path, updatedAt: request.onDate }, evidence });
  }
  const best = mostSpecific(candidates);
  function pendingApplies(candidate: Decision) {
    if (candidate.contextPath !== reusableAnswerPath) return false;
    const binding = reusableBinding(candidate);
    return binding.fieldId === fieldId && scopeMatches(binding.scope, context) &&
      !best.some(({ answer }) => scopeOverrides(answer.scope, binding.scope));
  }
  attentionMetadataExists(root, ".local/onboarding-state.json");
  const pending = loadProgress(root).state.conversation?.questions.find(q => q.status === "pending" && pendingApplies(q));
  const attentionPending = session.decision && !session.lastResponse && ["awaitingInput", "suspended"].includes(session.phase) &&
    pendingApplies(session.decision) ? session.decision : undefined;
  const existingDecision = pending ?? attentionPending;
  if (existingDecision) return { action: "pending" as const, decision: answerDecision(fieldId, reusableBinding(existingDecision).scope), requestedDecision: decision,
    owner: pending ? "conversation" as const : "attention" as const };
  const stale = best.some(({ answer }) => !usableAnswer(answer, request.onDate));
  const conflict = best.some(({ answer }) => answer.value !== best[0].answer.value);
  if (best.length && !stale && !conflict) {
    return { action: "match" as const, decision, ...best[0] };
  }
  const question = { ...decision, answerContext: context };
  if (stale) return { action: "stale" as const, decision, question: { ...question, scopeClarification: true as const } };
  if (conflict) return { action: "conflict" as const, decision, question: { ...question, scopeClarification: true as const },
    scopes: best.map(({ answer }) => answer.scope) };
  return { action: "missing" as const, decision, question };
}

export interface ReusableChange {
  fieldId: string;
  scope: AnswerScope;
  value: AnswerValue | null;
  kind: "answer" | "correction";
  validThrough?: string;
}

/** Stage the reusable fields alongside any extra role answers from the same reply. */
export function prepareReusableResponse(root: string, base: ResponseBundle, changes: ReusableChange[]): ResponseBundle {
  if (!Array.isArray(changes) || !changes.length || !base || base.schemaVersion !== 1 ||
    !Array.isArray(base.answers) || !Array.isArray(base.writes) || !Array.isArray(base.references) ||
    [...base.writes, ...base.references].some(ref => ref.path === reusableAnswerPath) ||
    base.answers.some(answer => answer.decision.contextPath === reusableAnswerPath)) {
    throw new Error("Prepare reusable fields once alongside the other answers from this reply.");
  }
  const current = loadReusableAnswers(root);
  const rows = new Map(current.answers.map(answer => [answerField(answer.fieldId, answer.scope), answer]));
  const answers = [...base.answers], seen = new Set<string>();
  for (const change of changes) {
    const { fieldId, value, kind, validThrough } = change;
    validateFieldId(fieldId);
    const scope = normalizeScope(change.scope), decision = answerDecision(fieldId, scope);
    if (seen.has(decision.field)) throw new Error("Save each field and scope once per reply.");
    seen.add(decision.field);
    rows.set(decision.field, { fieldId, scope, value, sourceReference: base.sourceReference, updatedAt: base.observedAt,
      ...(validThrough !== undefined ? { validThrough } : {}) });
    answers.push({ decision, kind });
  }
  const content = formatReusableAnswers([...rows.values()]);
  const result = { ...base, answers, writes: [...base.writes, { path: reusableAnswerPath, expectedSha256: current.sha256, content }] };
  validateReusableWrite(result, current.answers);
  return result;
}

export function validateReusableWrite(bundle: ResponseBundle, current?: ReusableAnswer[]) {
  const bindings = new Map(bundle.answers.filter(a => a.decision.contextPath === reusableAnswerPath).map(a => [a.decision.field, a.kind]));
  if (!bindings.size) return;
  const write = bundle.writes.find(w => w.path === reusableAnswerPath);
  if (!write) {
    if (current && [...bindings.keys()].some(key => !current.some(row => answerField(row.fieldId, row.scope) === key && row.value !== null))) {
      throw new Error("The referenced reusable field has no saved value.");
    }
    return;
  }
  const rows = new Map(parseReusableAnswers(write.content).map(row => [answerField(row.fieldId, row.scope), row]));
  for (const [key, kind] of bindings) {
    const row = rows.get(key);
    if (!row || row.sourceReference !== bundle.sourceReference || row.updatedAt !== bundle.observedAt ||
      !["answer", "correction"].includes(kind) || row.value === null && kind !== "correction") {
      throw new Error("Bind every reusable change to the actual reply and preserve explicit corrections.");
    }
  }
  if (!current) return;
  const old = new Map(current.map(row => [answerField(row.fieldId, row.scope), row]));
  for (const [key, row] of old) {
    const next = rows.get(key);
    if (!next) throw new Error("Withdraw an old scope with an explicit correction.");
    if (JSON.stringify(row) !== JSON.stringify(next) && (bindings.get(key) !== "correction" || Date.parse(next.updatedAt) < Date.parse(row.updatedAt))) {
      throw new Error("Preserve unrelated answers and correct an existing value explicitly.");
    }
  }
  for (const key of rows.keys()) {
    if (!old.has(key) && !bindings.has(key)) throw new Error("Every new reusable value requires a bound user reply.");
  }
}
