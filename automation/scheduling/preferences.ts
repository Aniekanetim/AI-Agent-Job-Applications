export interface OperatingPreferences {
  schemaVersion: 1;
  mode: "onDemand" | "recurring";
  cadence: string | null;
  timezone: string | null;
  perRunLimit: number | null;
  perDayLimit: number | null;
  reporting: "summary" | "blockersOnly" | "digest" | "unspecified";
  sourceReference: string;
  scheduleReference: string | null;
}
export function validateOperatingPreferences(value: unknown): asserts value is OperatingPreferences {
  const data = value as OperatingPreferences;
  if (!data || data.schemaVersion !== 1 || !["onDemand", "recurring"].includes(data.mode) ||
    ![data.cadence, data.timezone, data.scheduleReference].every(v => v === null || typeof v === "string") ||
    ![data.perRunLimit, data.perDayLimit].every(v => v === null || (Number.isInteger(v) && v! > 0)) ||
    !["summary", "blockersOnly", "digest", "unspecified"].includes(data.reporting) || !data.sourceReference?.trim()) throw new Error("Operating preferences need the user's scoped choices; no schedule was activated.");
  if (data.mode === "recurring" && (!data.cadence?.trim() || !data.timezone?.trim())) throw new Error("Recurring operation needs the user's task-board check-in interval and timezone.");
  if (data.perDayLimit !== null && !data.timezone?.trim()) throw new Error("A daily application limit needs the user's timezone for its day boundary.");
  if (data.timezone !== null) {
    try { new Intl.DateTimeFormat("en", { timeZone: data.timezone }); }
    catch { throw new Error("Use a valid named timezone for operating preferences."); }
  }
}

export type OperatingPatch = Partial<Omit<OperatingPreferences, "schemaVersion" | "sourceReference" | "scheduleReference">>;
/** A later answer changes only supplied fields. Null explicitly removes a limit. */
export function amendOperatingPreferences(previous: OperatingPreferences | null, patch: OperatingPatch, sourceReference: string): OperatingPreferences {
  if (previous) validateOperatingPreferences(previous);
  if (!sourceReference.trim()) throw new Error("Reference the actual settings change.");
  const next: OperatingPreferences = { schemaVersion: 1, mode: "onDemand", cadence: null, timezone: null,
    perRunLimit: null, perDayLimit: null, reporting: "unspecified", scheduleReference: null,
    ...previous, ...patch, sourceReference };
  if (!previous && !patch.mode) throw new Error("Choose on-demand or recurring operation before saving other operating settings.");
  if (patch.mode === "onDemand") next.cadence = null;
  if (previous?.scheduleReference && ["mode", "cadence", "timezone"].some(key =>
    previous[key as keyof OperatingPreferences] !== next[key as keyof OperatingPreferences])) {
    throw new Error("Update or stop the existing schedule through its scheduler first, verify the result and reconcile its saved reference before changing the interval. Other settings can be changed independently.");
  }
  validateOperatingPreferences(next);
  return next;
}
