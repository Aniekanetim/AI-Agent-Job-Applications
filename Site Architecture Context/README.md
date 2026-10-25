# Site Architecture Context

The agent maintains website knowledge here. [Human Job Context](../Job%20Context/README.md) supplies candidate facts, preferences and account instructions. Reusable navigation contains no candidate CV, password or invented screening answer.

**Initial state:** the four job-board maps and their initial Playwright routines remain unlearned scaffolds. A [Tezza direct-application example](Direct%20applications/Tezza%20Business%20Solutions/architecture.md) records its publicly observed form and hCaptcha boundary; submission and draft recovery remain unlearned. Supported directory names are organizational starting points, not claims of working integration.

| Portal | Initial knowledge |
| --- | --- |
| [LinkedIn](LinkedIn/architecture.md) | Unlearned |
| [Indeed](Indeed/architecture.md) | Unlearned |
| [Glassdoor](Glassdoor/architecture.md) | Unlearned |
| [CryptoJobsList](CryptoJobsList/architecture.md) | Unlearned |

## Initial mapping during onboarding

Application onboarding prepares one to three user-selected primary boards after verifying tools and access. [Onboarding discovery](../Application%20Workflow/discovery-workflow.md#onboarding-discovery) records actual vacancy navigation, application routing, accessible forms, reusable methods and limits. The agent shows per-board progress; a working login alone is not a completed map. No practice application is submitted. Encountered employer destinations get specific entries, while unvisited destinations remain unknown.

Actual user-specific knowledge can be saved in ignored `architecture.local.md` and `*.local.ts` companions. Read the applicable private counterpart/observations before the blank scaffold. Keep reusable public code sanitized and publish it only deliberately. Candidate data, login state and authenticated evidence remain private. Link the actual method file in each observation, rather than assuming a public stub was replaced.

Initial selected boards are a preparation scope. They do not restrict later assigned tasks to those websites or claim complete knowledge of their entire architecture.

## How to use the knowledge

Read the relevant architecture before code. If the required branch is unlearned, use [discovery](../Application%20Workflow/discovery-workflow.md) directly instead of repeatedly invoking a stub. If learned, check its recorded host/session/branch conditions against the current page and reuse its routine. Changed branches require narrow refresh, not a complete platform crawl.

Each portal has architecture.md, in-app, playwright and Application destinations. A directly assigned employer URL with no observed originating board can use Direct applications/<employer>/architecture.md; never invent a source board. Real destinations use descriptive employer/host directories. LinkedIn includes unlearned Workday and Employer career site examples to show nesting. Do not assume all Workday tenants or employer websites share one form.

Keep page actions in pages.ts and sequencing/inputs/confirmation in application-flow.ts. Candidate inputs arrive at runtime. Learned routines must persist the task's prepared/submission-attempted checkpoints and return an actual confirmed outcome or a specific dependency. Compilation is not live verification. Do not hard-code secrets, personal values or unobserved selectors.

## Knowledge-entry format

Use stable local OBS IDs, such as OBS-LINKEDIN-001. Group only claims with the same observation conditions.

~~~markdown
## OBS-<site>-<number>: <journey or page>
- State: Unlearned / Observed for these conditions / Needs refresh / Historical.
- Entry version and actual observation date/time:
- Originating task or onboarding board/observation ID and actual website URL/host:
- Account role/session conditions (nonsecret):
- Application mode and entry conditions:
- Observed pages/routes and numbered user actions:
- Fields, conditional branches and upload requirements:
- Actual locators and linked TypeScript methods:
- Submission checkpoint and confirmation signal:
- Evidence reference (private where personal data is present):
- Inference/alternatives, unvisited branches and limits:
- Refresh triggers and last actual verification:
~~~

Observed controls support navigation; they do not establish hidden architecture or intended business policy. A host name or visible button alone does not establish a complete usable flow. Preserve prior entries through Git or versioned snapshots. Sanitized generic maps/code can be published deliberately; task-specific evidence and authentication state cannot.

## Shared journeys and browser-specific actions

The common `architecture.md` describes pages, fields, decisions, upload requirements and confirmation signals. Each site's `in-app/actions.md` supplies the host-tool action template; actual account-specific methods go in ignored `actions.local.md`. Playwright methods stay under `playwright/`. Link both from the same observation when needed instead of copying the entire site map. All public in-app templates start unlearned, just like the Playwright stubs.

Learn the selected default during onboarding and prepare the Playwright upload branch as applicable. Check provider, host, account/session, observation date and known limits before reuse. A tool change must preserve the same task/vacancy/draft and follow [upload handoff](../automation/browser/upload-fallback.md). In-app capability checks and Playwright checks are separate; compiled TypeScript does not establish host-tool compatibility.
