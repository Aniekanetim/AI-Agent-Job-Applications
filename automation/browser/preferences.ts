export type BrowserBackend = "inApp" | "playwright";
export type BrowserChoice = "automatic" | BrowserBackend;
export interface BrowserPreferences {
  schemaVersion: 1;
  choice: BrowserChoice | null;
  resolvedDefault: BrowserBackend | null;
  uploadFallback: "playwright";
  sourceReference: string | null;
  decidedAt: string | null;
  resolutionReference: string | null;
}
export function emptyBrowserPreferences(): BrowserPreferences {
  return { schemaVersion: 1, choice: null, resolvedDefault: null, uploadFallback: "playwright",
    sourceReference: null, decidedAt: null, resolutionReference: null };
}
export function validateBrowserPreferences(value: unknown): asserts value is BrowserPreferences {
  const data = value as BrowserPreferences;
  if (!data || data.schemaVersion !== 1 || ![null, "automatic", "inApp", "playwright"].includes(data.choice) ||
    ![null, "inApp", "playwright"].includes(data.resolvedDefault) || data.uploadFallback !== "playwright" ||
    ![data.sourceReference, data.resolutionReference].every(v => v === null || typeof v === "string") ||
    !(data.decidedAt === null || (typeof data.decidedAt === "string" && Number.isFinite(Date.parse(data.decidedAt))))) throw new Error("Browser preferences need investigation; preserve the original configuration.");
  if (data.choice && (!data.sourceReference?.trim() || !data.decidedAt)) throw new Error("A browser preference needs the user's actual choice reference and date.");
  if (data.choice && data.choice !== "automatic" && data.resolvedDefault !== data.choice) throw new Error("The default must respect the user's selected browser.");
  if (data.choice === "automatic" && data.resolvedDefault && !data.resolutionReference?.trim()) throw new Error("Automatic selection needs an actual capability assessment reference.");
  if (!data.choice && data.resolvedDefault) throw new Error("Installed tooling does not establish a browser preference.");
}
export function selectBrowser(choice: BrowserChoice, sourceReference: string, now: string): BrowserPreferences {
  const next: BrowserPreferences = { ...emptyBrowserPreferences(), choice,
    resolvedDefault: choice === "automatic" ? null : choice, sourceReference, decidedAt: now };
  validateBrowserPreferences(next); return next;
}
export function resolveAutomaticBrowser(preferences: BrowserPreferences,
  available: Record<BrowserBackend, boolean>, reference: string): BrowserPreferences {
  validateBrowserPreferences(preferences);
  if (preferences.choice !== "automatic") return structuredClone(preferences);
  const resolvedDefault = available.inApp ? "inApp" : available.playwright ? "playwright" : null;
  const next = { ...preferences, resolvedDefault, resolutionReference: resolvedDefault ? reference : null };
  validateBrowserPreferences(next); return next;
}

export const browserNames: Record<BrowserBackend, string> = { inApp: "In-app browser", playwright: "Playwright browser" };
