import type { Page } from "playwright";

export type CaptchaInspection = { state: "humanRequired" | "cleared" | "notObserved" | "unknown"; provider: "hcaptcha" | null };

/** Read only the observed hCaptcha checkbox. Never click it, solve a puzzle or read/inject a response token. */
export async function inspectHcaptcha(page: Page): Promise<CaptchaInspection> {
  try {
    const widgets = page.locator('iframe[title="Widget containing checkbox for hCaptcha security challenge"]');
    if (!await widgets.count()) return { state: "notObserved", provider: null };
    let inspected = 0;
    for (const widget of await widgets.all()) {
      if (!await widget.isVisible()) continue;
      const frame = await (await widget.elementHandle())?.contentFrame();
      if (!frame) return { state: "unknown", provider: "hcaptcha" };
      const checkbox = frame.getByRole("checkbox");
      await checkbox.first().waitFor({ state: "visible", timeout: 3_000 });
      if (await checkbox.count() !== 1 || !await checkbox.isVisible()) return { state: "unknown", provider: "hcaptcha" };
      inspected++;
      if (!await checkbox.isChecked()) return { state: "humanRequired", provider: "hcaptcha" };
    }
    return { state: inspected ? "cleared" : "unknown", provider: "hcaptcha" };
  } catch { return { state: "unknown", provider: "hcaptcha" }; }
}

/** A known challenge must be rechecked immediately before submission; absence is not clearance. */
export function assertCaptchaInspection(inspection: CaptchaInspection, expected: boolean): void {
  if (inspection.state !== "cleared" && !(inspection.state === "notObserved" && !expected)) {
    throw new Error("CAPTCHA needs human completion or a current clearance check; preserve the checkpoint and do not submit.");
  }
}
