import type { StepId, EvidenceReference } from "./progress.js";

export interface Decision {
  id: string;
  step: StepId;
  substep: string;
  roleId: string | null;
  contextPath: string;
  field: string;
}
export interface FocusedQuestion extends Decision {
  prompt: string;
  required: boolean;
  status: "pending" | "answered" | "deferred";
  askedAt: string | null;
  sourceReference?: string;
  deferredReference?: string;
  legacy?: unknown;
  presentationPending?: boolean;
  presentationRecovery?: { sourceReference: string; recordedAt: string }[];
  clarifications?: { prompt: string; sourceReference: string; recordedAt: string; presentedAt?: string; presentedReference?: string }[];
}
export interface SavedAnswer extends Decision {
  responseId: string;
  sourceReference: string;
  canonical: EvidenceReference;
  savedAt: string;
  kind: "answer" | "correction";
}
export interface ConversationState {
  schemaVersion: 1;
  mode: "active" | "paused";
  activeQuestionId: string | null;
  roadmapShown: boolean;
  questions: FocusedQuestion[];
  answers: SavedAnswer[];
  responses: { id: string; sourceReference: string; savedAt: string; decisionIds: string[]; proposalSha256: string }[];
  pauseReference: { sourceReference: string; recordedAt: string } | null;
  legacyResolutions?: { decisionId: string; responseId: string; question: unknown }[];
}
export function emptyConversation(): ConversationState {
  return { schemaVersion: 1, mode: "active", activeQuestionId: null, roadmapShown: false,
    questions: [], answers: [], responses: [], pauseReference: null };
}
export const supplied = (v: unknown): v is string => typeof v === "string" && !!v.trim();
export const validTime = (v: unknown): v is string => supplied(v) && Number.isFinite(Date.parse(v));
export function validateDecision(value: unknown): asserts value is Decision {
  const d = value as Decision;
  if (!d || ![d.id, d.substep, d.contextPath, d.field].every(supplied) || !/^[a-zA-Z0-9_-]{1,100}$/.test(d.id) ||
    !["boardSelection", "browserTools", "candidateProfiles", "applicationInstructions", "connections", "siteMapping", "readiness"].includes(d.step) ||
    !(d.roleId === null || supplied(d.roleId)) || /password|api.?key|secret|otp|access.?token/i.test(d.field)) {
    throw new Error("Use one nonsecret decision with a stable ID, stage, substep and canonical field binding.");
  }
}
export function sameDecision(a: Decision, b: Decision): boolean {
  return ["id", "step", "substep", "roleId", "contextPath", "field"].every(k => a[k as keyof Decision] === b[k as keyof Decision]);
}
export function validateConversation(value: unknown): asserts value is ConversationState {
  const c = value as ConversationState;
  if (!c || c.schemaVersion !== 1 || !["active", "paused"].includes(c.mode) || typeof c.roadmapShown !== "boolean" ||
    !Array.isArray(c.questions) || !Array.isArray(c.answers) || !Array.isArray(c.responses) ||
    !(c.activeQuestionId === null || supplied(c.activeQuestionId))) throw new Error("Invalid conversation checkpoint; preserve it for investigation.");
  const ids = new Set<string>();
  for (const q of c.questions) {
    validateDecision(q);
    if (ids.has(q.id) || !supplied(q.prompt) || typeof q.required !== "boolean" || !["pending", "answered", "deferred"].includes(q.status) ||
      !(q.askedAt === null || validTime(q.askedAt))) throw new Error("Preserve distinct focused questions and their actual state.");
    ids.add(q.id);
    if (q.presentationPending !== undefined && typeof q.presentationPending !== "boolean") throw new Error("Preserve the prompt presentation checkpoint.");
    if (q.presentationRecovery && (!Array.isArray(q.presentationRecovery) || q.presentationRecovery.some(r => !supplied(r.sourceReference) || !validTime(r.recordedAt)))) throw new Error("Prompt recovery needs the actual not-shown observation.");
    if (q.clarifications && (!Array.isArray(q.clarifications) || q.clarifications.some(c => !supplied(c.prompt) || !supplied(c.sourceReference) ||
      !validTime(c.recordedAt) || c.presentedAt !== undefined && (!validTime(c.presentedAt) || !supplied(c.presentedReference))))) throw new Error("Preserve actual clarification and presentation references.");
  }
  if (c.activeQuestionId && !c.questions.some(q => q.id === c.activeQuestionId && q.status === "pending")) throw new Error("Only one pending question can own the conversation focus.");
  for (const a of c.answers) {
    validateDecision(a);
    if (!supplied(a.responseId) || !supplied(a.sourceReference) || !validTime(a.savedAt) || !["answer", "correction"].includes(a.kind) ||
      a.canonical?.path !== a.contextPath || !/^[a-f0-9]{64}$/.test(a.canonical?.sha256 ?? "")) throw new Error("An answer needs its actual saved canonical reference.");
  }
  const responses = new Set<string>();
  for (const r of c.responses) {
    if (!supplied(r.id) || responses.has(r.id) || !supplied(r.sourceReference) || !validTime(r.savedAt) ||
      !/^[a-f0-9]{64}$/.test(r.proposalSha256) || !Array.isArray(r.decisionIds) || r.decisionIds.some(id => !supplied(id))) throw new Error("Preserve response identity and save references.");
    responses.add(r.id);
  }
  if (c.pauseReference !== null && (!supplied(c.pauseReference?.sourceReference) || !validTime(c.pauseReference?.recordedAt))) throw new Error("Pause needs the actual user request reference.");
  if (c.legacyResolutions && (!Array.isArray(c.legacyResolutions) || c.legacyResolutions.some(r => !supplied(r.decisionId) || !supplied(r.responseId)))) throw new Error("Preserve original legacy questions when reconciling existing answers.");
}
