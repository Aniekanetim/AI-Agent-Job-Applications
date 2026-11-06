import { resolve, isAbsolute } from "node:path";
import { lstatSync } from "node:fs";
import { savePrivateJson } from "../workflow/private-json.js";
import { readAttentionMetadata as readPrivateJson } from "./metadata.js";
import { withWriteOwnership } from "../workflow/ownership.js";
import { readEvidence, type FileEvidence } from "../email/evidence.js";
import { time, safeText } from "./types.js";

export const preferenceFile = ".local/attention-preferences.json";
export interface AttentionPreferences {
  schemaVersion: 1; mode: "manual" | "recurring"; everyMinutes: number | null; timezone: string;
  paused: boolean; snoozedUntil: string | null; muted: string[]; sourceReference: string;
  scheduleReference: string | null;
}
export function validateAttentionPreferences(value: unknown): asserts value is AttentionPreferences {
  const v = value as AttentionPreferences;
  if (!v || v.schemaVersion !== 1 || !["manual", "recurring"].includes(v.mode) || typeof v.paused !== "boolean" ||
    !(v.snoozedUntil === null || time(v.snoozedUntil)) || !Array.isArray(v.muted) || v.muted.some(k => typeof k !== "string" || k.length > 500) ||
    !safeText(v.sourceReference, 300) || !(v.scheduleReference === null || safeText(v.scheduleReference, 200)) ||
    !(v.everyMinutes === null || Number.isSafeInteger(v.everyMinutes) && v.everyMinutes > 0) || typeof v.timezone !== "string" || !v.timezone.trim() ||
    v.mode === "recurring" && (v.everyMinutes === null || !v.scheduleReference)) throw new Error("Save the actual reminder choice separately from application scheduling.");
  try { new Intl.DateTimeFormat("en", { timeZone: v.timezone }); } catch { throw new Error("Use a named reminder timezone."); }
}
export function loadAttentionPreferences(root: string) {
  const loaded = readPrivateJson(root, preferenceFile);
  let timezone = "Africa/Lagos";
  if (!loaded.data) { const operation = readPrivateJson(root, ".local/operation-preferences.json").data as { timezone?: string } | null; timezone = operation?.timezone ?? timezone; }
  const value = (loaded.data ?? { schemaVersion: 1, mode: "manual", everyMinutes: null, timezone, paused: false,
    snoozedUntil: null, muted: [], sourceReference: "package-default", scheduleReference: null }) as AttentionPreferences;
  validateAttentionPreferences(value); return { value, revision: loaded.revision };
}
export interface ReminderCapability {
  schemaVersion: 1; workingRoot: string; executionContext: "scheduled"; notificationOnly: true;
  scheduleReference: string; channel: "native"; checkedAt: string; rehearsalReference: string; evidence: FileEvidence[];
}
export function verifyReminderCapability(root: string, scheduleReference: string) {
  const c = readPrivateJson(root, ".local/attention-capability.json").data as ReminderCapability | null;
  if (!c || c.schemaVersion !== 1 || typeof c.workingRoot !== "string" || !isAbsolute(c.workingRoot) || resolve(c.workingRoot).toLowerCase() !== resolve(root).toLowerCase() || c.executionContext !== "scheduled" ||
    c.notificationOnly !== true || c.channel !== "native" || c.scheduleReference !== scheduleReference || !time(c.checkedAt) ||
    !safeText(c.rehearsalReference, 300) || !c.evidence?.length) throw new Error("Keep timed reminders off until the actual scheduled notification-only rehearsal is verified.");
  const operation = readPrivateJson(root, ".local/operation-preferences.json").data as { scheduleReference?: string } | null;
  if (operation?.scheduleReference === scheduleReference) throw new Error("Use a separate notification-only schedule; preserve application check-ins.");
  for (const e of c.evidence) {
    if (!/^\.local\/attention-capability-evidence\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.(?:json|md|txt)$/.test(e.path) || e.path.split("/").includes("..")) throw new Error("Use dedicated notification rehearsal evidence; reminder runs cannot open task or candidate context.");
    const parts = e.path.split("/");
    for (let i = 1; i <= parts.length; i++) if (lstatSync(resolve(root, ...parts.slice(0, i))).isSymbolicLink()) throw new Error("Notification rehearsal evidence cannot link to task, context or external files.");
    readEvidence(root, e);
  }
  return c;
}
export function saveAttentionPreferences(root: string, patch: Partial<Omit<AttentionPreferences, "schemaVersion">> & { sourceReference: string }) {
  return withWriteOwnership(root, "attention-index", () => withWriteOwnership(root, "attention-preferences", () => {
    const loaded = loadAttentionPreferences(root), next = { ...loaded.value, ...patch };
    validateAttentionPreferences(next);
    const configurationChanged = ["mode", "everyMinutes", "timezone", "scheduleReference"].some(k => next[k as keyof AttentionPreferences] !== loaded.value[k as keyof AttentionPreferences]);
    if (next.mode === "recurring" && !next.paused && (configurationChanged || patch.paused === false)) verifyReminderCapability(root, next.scheduleReference!);
    savePrivateJson(root, preferenceFile, next, loaded.revision); return next;
  }));
}
export function snoozeAttention(root: string, until: string, sourceReference: string, now: string) {
  if (!time(now) || !time(until) || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(until) || Date.parse(until) <= Date.parse(now)) throw new Error("Choose an actual future reminder time with its timezone offset.");
  return saveAttentionPreferences(root, { snoozedUntil: until, sourceReference });
}
