import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { digest } from "../email/evidence.js";
import { sameDecision, supplied, validTime, type Decision } from "../onboarding/conversation-types.js";

export const reusableAnswerPath = "Job Context/Candidate/reusable-answers.local.md";
export const scopeKeys = ["roleId", "country", "employerId", "taskId"] as const;
export type AnswerScope = Partial<Record<typeof scopeKeys[number], string>>;
export type AnswerValue = string | number | boolean;
export interface ReusableAnswer {
  fieldId: string;
  scope: AnswerScope;
  value: AnswerValue | null;
  sourceReference: string;
  updatedAt: string;
  validThrough?: string;
}

const header = "# Reusable application answers";
const restrictedField = /password|credential|secret|api_?key|token|(^|_)otp($|_)|captcha|consent|attestation|declaration|demographic/i;

export function validateFieldId(fieldId: unknown): asserts fieldId is string {
  if (typeof fieldId !== "string" || !/^[a-z][a-z0-9_]{1,79}$/.test(fieldId) || restrictedField.test(fieldId)) {
    throw new Error("Use a stable ID for a reusable factual field. Keep access and declarations in their dedicated workflows.");
  }
}

export function normalizeScope(value: unknown): AnswerScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Specify the answer's actual applicability scope.");
  const scope = value as AnswerScope;
  if (Object.keys(scope).some(key => !scopeKeys.some(allowed => key === allowed))) throw new Error("Use supported answer scope fields.");
  const ordered: AnswerScope = {};
  for (const key of scopeKeys) {
    if (!Object.hasOwn(scope, key)) continue;
    const id = scope[key];
    if (typeof id !== "string" || !(key === "country" ? /^[A-Z]{2}$/ : /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,149}$/).test(id)) {
      throw new Error("Use a verified country code or stable scope ID.");
    }
    ordered[key] = id;
  }
  return ordered;
}

export function answerField(fieldId: string, scope: AnswerScope) {
  validateFieldId(fieldId);
  const normalized = normalizeScope(scope);
  if (/^(work_authorization|sponsorship(?:_now|_future)?)(_|$)/.test(fieldId) && !normalized.country) {
    throw new Error("Bind work authorization and sponsorship answers to the relevant country.");
  }
  const qualifiers = scopeKeys.filter(key => normalized[key] !== undefined).map(key => `${key}=${normalized[key]}`);
  return [fieldId, ...qualifiers].join("|");
}

export function answerDecision(fieldId: string, scope: AnswerScope): Decision {
  const field = answerField(fieldId, scope);
  return { id: `answer-${digest(field).slice(0, 32)}`, step: "applicationInstructions", substep: fieldId.replaceAll("_", " "),
    roleId: null, contextPath: reusableAnswerPath, field };
}

export function reusableBinding(decision: Decision) {
  const [fieldId, ...qualifiers] = decision.field.split("|");
  const scope = normalizeScope(Object.fromEntries(qualifiers.map(part => part.split("="))));
  const canonical = answerDecision(fieldId, scope);
  if (!sameDecision(decision, canonical)) throw new Error("Use the canonical decision for this answer and scope.");
  return { fieldId, scope };
}

/** Scope validation uses the selected task's identity and does not read its context. */
export function assertTaskAnswerBinding(decision: Decision, roleId: string | undefined, taskId: string) {
  const { scope } = reusableBinding(decision);
  if (scope.roleId && scope.roleId !== roleId || scope.taskId && scope.taskId !== taskId) {
    throw new Error("Keep the reusable field bound to the selected role and task.");
  }
}

export function scopeMatches(scope: AnswerScope, context: AnswerScope) {
  return scopeKeys.every(key => scope[key] === undefined || scope[key] === context[key]);
}

export function mostSpecific<T extends { answer: ReusableAnswer }>(matches: T[]) {
  const taskMatches = matches.filter(({ answer }) => answer.scope.taskId);
  const applicable = taskMatches.length ? taskMatches : matches;
  return applicable.filter(({ answer }) => !applicable.some(({ answer: other }) =>
    scopeMatches(answer.scope, other.scope) && !scopeMatches(other.scope, answer.scope)));
}

export function validateAnswerValue(fieldId: string, value: unknown): asserts value is AnswerValue {
  if (typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) {
    if (fieldId === "available_start_date") throw new Error("Save an exact start date.");
    return;
  }
  if (typeof value !== "string" || !value.trim() || value.length > 4000 || /\u0000|\r|\n|Bearer\s+\S+|(?:password|api[_ -]?key|secret|token)\s*[:=]/i.test(value)) {
    throw new Error("Save a nonempty factual answer in its verified scope.");
  }
  if (fieldId === "available_start_date" && !validDate(value)) throw new Error("Save an exact start date as YYYY-MM-DD.");
}

export function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function usableAnswer(answer: ReusableAnswer, onDate: string) {
  return answer.value !== null && (!answer.validThrough || answer.validThrough >= onDate) &&
    (answer.fieldId !== "available_start_date" || String(answer.value) >= onDate);
}

export function parseReusableAnswers(content: string): ReusableAnswer[] {
  const match = /^# Reusable application answers\s+\x60\x60\x60json\r?\n([\s\S]+)\r?\n\x60\x60\x60\s*$/.exec(content.trim());
  if (!match) throw new Error("Reconcile the private reusable answer file with its supported format.");
  let data: { schemaVersion?: number; answers?: ReusableAnswer[] };
  try { data = JSON.parse(match[1]); }
  catch { throw new Error("The private reusable answer file is unreadable."); }
  if (data?.schemaVersion !== 1 || !Array.isArray(data.answers)) throw new Error("Unsupported reusable answer file version.");
  const seen = new Set<string>();
  for (const answer of data.answers) {
    if (!answer || !supplied(answer.sourceReference) || !validTime(answer.updatedAt) ||
      Object.keys(answer).some(key => !["fieldId", "scope", "value", "sourceReference", "updatedAt", "validThrough"].includes(key)) ||
      answer.validThrough !== undefined && !validDate(answer.validThrough)) throw new Error("Preserve the source, date and applicability of each answer.");
    const key = answerField(answer.fieldId, answer.scope);
    if (seen.has(key)) throw new Error("Reconcile duplicate answers with the same field and scope.");
    seen.add(key);
    if (answer.value !== null) validateAnswerValue(answer.fieldId, answer.value);
  }
  return data.answers;
}

export function formatReusableAnswers(answers: ReusableAnswer[]) {
  return `${header}\n\n\x60\x60\x60json\n${JSON.stringify({ schemaVersion: 1, answers }, null, 2)}\n\x60\x60\x60\n`;
}

/** Check the fixed candidate path before any read, including in-copy directory aliases. */
export function candidateFile(root: string, name: string) {
  const parts = name.split("/");
  if (!name.startsWith("Job Context/Candidate/") || parts.some(part => !part || part === "." || part === ".." || part.includes("\\"))) {
    throw new Error("Use the contained private candidate path.");
  }
  const path = resolve(root, name);
  for (let i = 1; i <= parts.length; i++) {
    try {
      const info = lstatSync(resolve(root, ...parts.slice(0, i)));
      if (info.isSymbolicLink() || (i === parts.length ? !info.isFile() : !info.isDirectory())) {
        throw new Error("Keep reusable answers in the private candidate file without filesystem aliases.");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path, exists: false };
      throw error;
    }
  }
  return { path, exists: true };
}

export function loadReusableAnswers(root: string) {
  const file = candidateFile(root, reusableAnswerPath);
  if (!file.exists) return { answers: [] as ReusableAnswer[], sha256: null };
  const bytes = readFileSync(file.path);
  return { answers: parseReusableAnswers(bytes.toString("utf8")), sha256: digest(bytes) };
}
