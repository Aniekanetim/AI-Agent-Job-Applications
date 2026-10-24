import type { Page } from "playwright";
import { ApplicationPage } from "./pages.js";
import { DiscoveryRequired, type ApplicationInputs,
  type ConfirmedApplication } from "../../../../../automation/workflow/application-state.js";

/** No navigation, form filling or submission is implemented in this scaffold. */
export async function executeApplication(
  page: Page, _inputs: ApplicationInputs,
): Promise<ConfirmedApplication> {
  await new ApplicationPage(page).recognize();
  throw new DiscoveryRequired("Employer career site destination example");
}
