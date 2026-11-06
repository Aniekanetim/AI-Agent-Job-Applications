import { savePrivateJson } from "../workflow/private-json.js";
import { readAttentionMetadata as readPrivateJson, attentionMetadataExists } from "./metadata.js";
import { withWriteOwnership } from "../workflow/ownership.js";
import type { Decision } from "../onboarding/conversation-types.js";
import type { FileEvidence } from "../email/evidence.js";
import { time, safeText } from "./types.js";

export const sessionFile = ".local/attention-session.json";
export interface AttentionSession {
  schemaVersion: 1; phase: "closed" | "reviewing" | "awaitingInput" | "awaitingContinue" | "suspended";
  key: string | null; taskId: string | null; path: string | null; ticketHash: string | null;
  sourceReference: string | null; prompt?: string; decision?: Decision;
  presentation?: { reference: string; at: string }; presentationPending?: boolean;
  response?: { path: string; sha256: string; id: string }; lastResponse?: string;
  responseHistory?: { path: string; sha256: string; id: string; reference: string }[];
  reviewEvidence?: FileEvidence[]; reviewReference?: string; reviewedAt?: string;
}
export const emptySession = (): AttentionSession => ({ schemaVersion: 1, phase: "closed", key: null, taskId: null, path: null, ticketHash: null, sourceReference: null });
export function loadAttentionSession(root: string) {
  const loaded = readPrivateJson(root, sessionFile), session = (loaded.data ?? emptySession()) as AttentionSession;
  if (session.schemaVersion !== 1 || !["closed", "reviewing", "awaitingInput", "awaitingContinue", "suspended"].includes(session.phase) ||
    session.phase !== "closed" && (!session.key || !session.taskId || !session.path || !session.ticketHash || !session.sourceReference) ||
    session.prompt !== undefined && !safeText(session.prompt, 500) || session.presentation && (!safeText(session.presentation.reference, 300) || !time(session.presentation.at))) throw new Error("Preserve the interrupted attention review checkpoint.");
  return { session, revision: loaded.revision };
}
export function updateAttentionSession<T>(root: string, run: (s: AttentionSession) => T) {
  return withWriteOwnership(root, "attention-session", () => {
    const loaded = loadAttentionSession(root), next = structuredClone(loaded.session), result = run(next);
    if (JSON.stringify(next) !== JSON.stringify(loaded.session)) savePrivateJson(root, sessionFile, next, loaded.revision);
    return result;
  });
}
export function hasAttentionFocus(root: string) { return ["reviewing", "awaitingInput", "awaitingContinue"].includes(loadAttentionSession(root).session.phase); }
export function otherConversationFocus(root: string): "settings" | "recoverResponse" | "onboarding" | null {
  if (attentionMetadataExists(root, ".local/onboarding-pending-response.json")) return "recoverResponse";
  const settings = readPrivateJson(root, ".local/settings-menu.json").data as { phase?: string } | null;
  if (settings && settings.phase !== "closed") return "settings";
  const progress = readPrivateJson(root, ".local/onboarding-state.json").data as { conversation?: { mode: string; activeQuestionId: string | null; questions: { id: string; status: string }[] } } | null;
  const c = progress?.conversation;
  if (c?.mode === "active" && c.questions.some(q => q.status === "pending" && (q.id === c.activeQuestionId || !hasAttentionFocus(root)))) return "onboarding";
  return null;
}
/** Explicit settings entry/Stop retains the selected review and never unpauses onboarding. */
export function suspendAttention(root: string, sourceReference: string) {
  if (!sourceReference.trim()) throw new Error("Reference the actual focus-transfer request.");
  return updateAttentionSession(root, s => { if (s.response || attentionMetadataExists(root, ".local/onboarding-pending-response.json")) throw new Error("Recover the retained canonical answer save before changing focus."); if (s.phase !== "closed") s.phase = "suspended"; });
}
