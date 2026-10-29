# Application-site discovery workflow

Before opening an unfamiliar assigned site or destination, follow [website preparation](../automation/sites/README.md). Adopt existing contexts or create missing private scaffolds with exact observed account boundaries. This is independent of the one to three onboarding primary boards. Tracking/provider hops are not board records. Create no map/login work for a vacancy already clearly excluded by actual instructions. A source requiring inspection can block before role selection through the pre-profile access handoff, without a fabricated CV. Folder creation never establishes access, mapping or challenge clearance.

Discovery learns the website navigation needed to complete an application. Human Job Context supplies candidate facts and instructions; agent-maintained site knowledge records actual observations. During onboarding, the learning objective and checkpoint stay in private onboarding progress; during applications they stay on the existing task. Neither requires a separate discovery ticket or review gate.

## Onboarding discovery

Prepare each user-selected primary board after browser tooling and access are verified. Reuse already observed routes under their actual conditions. In this mode there may be no application ticket: use a stable onboarding observation ID and the board's progress entry instead. Do not create a fake application to hold discovery work.

Learn the visible search/results and vacancy-detail routes, built-in/external application entry, accessible form and review steps, and navigation methods. Inspect only the selected board and destinations actually encountered. A specific employer/host gets its own destination entry; a generic ATS name is insufficient. Record unknown routes and the boundary reached. Observe submission/confirmation locations only where visible without submitting; confirmation remains unverified until a real authorized application establishes it.

Do not submit a practice application, create an account, upload a CV or create/change a draft solely to complete mapping. When further exploration would mutate account/application data without applicable instructions, record that precise boundary. Accessible core routes still require actual observation. A challenge or failed route is blocked/unfinished, not a blanket exemption from mapping.

Keep the common journey in Markdown. Save observed actions in the active tool's files: `in-app/actions.local.md` for host tools and Playwright files for executable TypeScript; keep final-submit code guarded as unlearned until observed in an authorized task. Use `architecture.local.md` and private `*.local.ts` companions for account-specific learning; sanitized reusable files may be published deliberately. Read applicable private knowledge before the blank template and do not assume an unlearned public stub contains a learned private branch.

Record separate navigation, application-route, accessible-form, reusable-code and limits checks using [onboarding progress](../automation/onboarding/README.md#mapping-completion). Initial mapping completion describes the branches learned and the remaining boundaries. It does not mean every vacancy, destination or future page is known. Then resume the onboarding roadmap and readiness handoff.

## 1. Read what is already known

Read the active task (or onboarding board entry), selected role's application instructions, platform access reference, site architecture and applicable destination records. Reuse the known branch. Identify the specific missing route, form state or changed interaction instead of exploring unrelated features.

Record the actual URL/host, account role, date/time, page state, applicable entry version and task ID. A job site's hidden build is Unknown unless exposed; the local workflow commit is not its website version. Website knowledge is separate from candidate qualifications.

## 2. Establish access and the missing route

Use authorized account/session or candidate registration instructions. For a password flow, privately load the selected board's ignored `.env` or configured secure-store values following [job-board access](../Job%20Context/Job%20Boards/README.md). Keep credentials/storage state private and exclude login secrets from captured artifacts. Human-assisted login may be needed; do not bypass authentication, CAPTCHA or platform controls. Follow [CAPTCHA handoff](../automation/browser/captcha-handoff.md): record the observed boundary during setup-only discovery; for a real application preserve its checkpoint and move the same ticket to Blocked. The read-only inspector recognizes the documented hCaptcha widget; unfamiliar challenge types require observed recognition, never an invented clearance or automatic solving. For a real task, missing access goes to Blocked with a precise context update/action. During setup, record the dependency in onboarding progress. Neither is a generic approval request.

Explore the normal application journey with the actual task's legitimate candidate information. Record navigation, multi-step forms, conditional branches, CV upload, validation, return/back behavior and submission confirmation. Avoid a practice submission: final submission belongs to the real task and happens once, followed by actual confirmation.

Only learn areas necessary for the assignment. Do not claim knowledge of the entire site from one path. Do not use discovery to change candidate facts or expand into scraping unrelated personal information or probing hidden endpoints.

## 3. Preserve Markdown knowledge

Update the relevant architecture.md under Site Architecture Context. Use [the entry format](../Site%20Architecture%20Context/README.md#knowledge-entry-format). Separate observed routes/states from inferred explanations. Record a page/flow map, source conditions, evidence references, unvisited branches and refresh triggers. Remove personal values, authenticated links and tokens from reusable maps.

An external application site gets its own specific destination subfolder, with parent link and origin. The sample Workday and Employer career site folders are unlearned examples; a company-specific host/tenant path must be recorded before use.

## 4. Maintain methods for the active browser

For an in-app default, record its actual provider, page conditions, supported actions and state checks in `in-app/actions.local.md`, using the adjacent public template. Do not present Playwright code or snapshot IDs as host-browser commands. Reuse the common architecture map rather than duplicating the full journey per tool. Record observed Playwright upload/recovery actions when that branch can legitimately be learned; otherwise retain its precise boundary for the real task. Authentication is checked separately in each browser.

### Playwright TypeScript routines

Use actual observed role/label/test-ID locators or inspected selectors. The initial pages.ts and application-flow.ts intentionally throw DiscoveryRequired; they are scaffolds, not working portal adapters. Replace the relevant methods only after observation. Do not invent selectors or import temporary snapshot element IDs as persistent locators.

Keep page interactions in pages.ts. Keep flow sequencing, profile inputs and outcome confirmation in application-flow.ts. Check current host/session/page shape before side effects and required fields before final submit. Final submission must consume the task's recorded checkpoint and return an actual confirmed receipt or a specific blocked/uncertain outcome; never catch every error and report success.

Do not hard-code candidate answers, passwords, document paths or tokens in source code. Pass selected private values at runtime. The same portal routine can serve different role profiles without merging their data.

Type-check after changing code. Exercise nonsubmitting page recognition where possible before the real final action. Compilation and offline fixtures do not establish that a live portal works. Preserve the task's prior attempts and the actual verification conditions.

## 5. Resume the application and refresh narrowly

Record which gap was resolved, updated knowledge/code versions and the application checkpoint. Resume the existing task without a new approval gate. If its final-submit outcome is uncertain, establish that outcome before any further submission action.

Refresh only affected routes when expected controls/page shape change, a different application mode appears or the account/session conditions no longer apply. Classify session expiration, closed vacancies and changed layouts separately. Mark old entries historical/needs refresh with the reason; retain their history. Do not repeatedly rediscover unchanged pages or replace missing evidence with guesses.
