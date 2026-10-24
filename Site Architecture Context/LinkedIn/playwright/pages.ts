import type { Page } from "playwright";
import { DiscoveryRequired } from "../../../automation/workflow/application-state.js";

export const knowledgeState = "unlearned" as const;

/** Replace with observed locators/state checks after legitimate site discovery. */
export class ApplicationPage {
  constructor(readonly page: Page) {}

  async recognize(): Promise<void> {
    throw new DiscoveryRequired("LinkedIn");
  }
}
