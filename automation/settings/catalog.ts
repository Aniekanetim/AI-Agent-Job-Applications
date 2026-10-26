export const areas = [
  { id: "profiles", label: "Role profiles and CVs" },
  { id: "preferences", label: "Job preferences and application answers" },
  { id: "connections", label: "Job boards and email" },
  { id: "browser", label: "Browser and visibility" },
  { id: "schedule", label: "Check-in schedule" },
  { id: "operating", label: "Application limits and reporting" },
] as const;
export type AreaId = typeof areas[number]["id"];
export interface Setting {
  id: string; area: AreaId; label: string; scope: "global" | "role" | "board";
  path: string; field?: string; procedure: string; prompt: string;
}
export const settings: Setting[] = [
  { id: "roles", area: "profiles", label: "Add or manage role profiles", scope: "global", path: "Job Context/Candidate/role-routing.local.md", procedure: "onboarding role routing", prompt: "Which role profile would you like to add or change?" },
  { id: "profile", area: "profiles", label: "Candidate details", scope: "role", path: "role-profile.local.md", procedure: "focused response", prompt: "What would you like to change in these candidate details?" },
  { id: "experience", area: "profiles", label: "Experience and qualifications", scope: "role", path: "experience-and-qualifications.local.md", procedure: "focused response", prompt: "What experience or qualification would you like to update?" },
  { id: "cv", area: "profiles", label: "CV and application documents", scope: "role", path: "Documents/README.local.md", procedure: "onboarding document import and focused response", prompt: "Which CV or application document would you like to add or replace?" },
  { id: "job-preferences", area: "preferences", label: "Job preferences", scope: "role", path: "job-preferences.local.md", procedure: "focused response", prompt: "Which job preference would you like to change?" },
  { id: "answers", area: "preferences", label: "Application answers", scope: "role", path: "application-answers.local.md", procedure: "focused response", prompt: "Which application answer would you like to update?" },
  { id: "instructions", area: "preferences", label: "Application instructions", scope: "role", path: "application-instructions.local.md", procedure: "focused response", prompt: "What application instruction would you like to change?" },
  { id: "verification", area: "preferences", label: "Verification-email and MFA access", scope: "role", path: "verification-access.local.md", procedure: "email verification setup and focused response", prompt: "How should the agent receive verification messages for this profile?" },
  { id: "boards", area: "connections", label: "Primary job boards", scope: "global", path: ".local/onboarding-state.json", field: "boards", procedure: "onboarding:start", prompt: "Which one to three primary job boards should I prepare?" },
  { id: "intake", area: "connections", label: "Task intake sources", scope: "global", path: ".local/onboarding-state.json", field: "scope", procedure: "onboarding:start", prompt: "Should I use email alerts, manual tasks, or both?" },
  { id: "board-access", area: "connections", label: "Job-board account access", scope: "board", path: "access-and-instructions.local.md", procedure: "job-board authentication setup and focused response", prompt: "What account access or sign-in instruction should change? Do not send a password in chat." },
  { id: "email", area: "connections", label: "Email account and alert scope", scope: "global", path: ".local/email-connection.json", field: "source", procedure: "email:select / shared email onboarding", prompt: "Which email connection or alert scope would you like to use?" },
  { id: "cleanup", area: "connections", label: "Completed-alert handling", scope: "global", path: ".local/email-connection.json", field: "cleanup", procedure: "email:cleanup / protected connection store", prompt: "How should fully handled job-alert emails be treated?" },
  { id: "default-browser", area: "browser", label: "Default browser", scope: "global", path: ".local/browser-preferences.json", field: "choice", procedure: "onboarding:browser", prompt: "Which browser should I use by default?" },
  { id: "visibility", area: "browser", label: "Playwright visibility", scope: "global", path: ".local/browser/visibility.json", field: "mode", procedure: "browser visibility", prompt: "Should Playwright use a visible window or headless mode?" },
  { id: "check-in", area: "schedule", label: "On-demand use or recurring interval", scope: "global", path: ".local/operation-preferences.json", field: "mode", procedure: "onboarding:operation / actual scheduler reconciliation", prompt: "How often should I check for work, or should I check only when asked?" },
  { id: "per-run", area: "operating", label: "Applications per check", scope: "global", path: ".local/operation-preferences.json", field: "perRunLimit", procedure: "onboarding:operation", prompt: "What application limit should apply to each check, or should there be no fixed limit?" },
  { id: "per-day", area: "operating", label: "Applications per day", scope: "global", path: ".local/operation-preferences.json", field: "perDayLimit", procedure: "onboarding:operation", prompt: "What daily application limit should apply, or should there be no fixed limit?" },
  { id: "reporting", area: "operating", label: "Results reporting", scope: "global", path: ".local/operation-preferences.json", field: "reporting", procedure: "onboarding:operation", prompt: "How would you like application results reported?" },
];
export function settingById(id: string) {
  const setting = settings.find(s => s.id === id);
  if (!setting) throw new Error("Choose a setting from the displayed menu.");
  return setting;
}
