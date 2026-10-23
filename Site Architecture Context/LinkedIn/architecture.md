# LinkedIn: site architecture

**Knowledge state:** Unlearned. **Observed URL/host:** Not supplied. **Account/session:** Not established. **Last live verification:** Never. **Entry version:** template-1.

This is an organizational scaffold, not an observed site map or verified integration. No selector, route, form requirement or successful submission is established. Before an actual application, follow the discovery workflow linked from [the site context index](../README.md).

| Area | Actual knowledge |
| --- | --- |
| Listing route and vacancy identity | Not observed |
| Application entry / internal or external mode | Not observed |
| Authentication / registration / account role | Not observed |
| Pages and navigation decisions | Not observed |
| Fields, required values and conditional branches | Not observed |
| CV upload and preview requirements | Not observed |
| Final-submit action and recovery checkpoint | Not observed |
| Matching confirmation / application-record signal | Not observed |
| Unvisited branches / known limits | All branches unvisited |
| Refresh triggers | First discovery, then relevant page/session/flow changes |

[Page object](playwright/pages.ts) and [application flow](playwright/application-flow.ts) are typed unlearned stubs. They throw DiscoveryRequired before browser interaction. Replace only the relevant scaffold with actual observations and code; do not fill this template with assumptions based on a platform name.

For an external destination, record the actual company, host/tenant and originating portal. Keep credentials in the secure access mechanism and personal evidence in private storage. Use stable OBS IDs and record real conditions/versions when learning.
