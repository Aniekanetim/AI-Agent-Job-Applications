# Application-site discovery workflow

Discovery learns the website navigation needed to complete an application. Human Job Context supplies candidate facts and instructions; agent-maintained site knowledge records actual observations. The learning objective and checkpoint stay on the application task, without a separate request file or review gate.

## 1. Read what is already known

Read the active task, selected role's application instructions, platform access reference, site architecture and applicable destination records. Reuse the known branch. Identify the specific missing route, form state or changed interaction instead of exploring unrelated features.

Record the actual URL/host, account role, date/time, page state, applicable entry version and task ID. A job site's hidden build is Unknown unless exposed; the local workflow commit is not its website version. Website knowledge is separate from candidate qualifications.

## 2. Establish access and the missing route

Use authorized account/session or candidate registration instructions. For a password flow, privately load the selected board's ignored `.env` or configured secure-store values following [job-board access](../Job%20Context/Job%20Boards/README.md). Keep credentials/storage state private and exclude login secrets from captured artifacts. Human-assisted login may be needed; do not bypass authentication, CAPTCHA or platform controls. Missing access goes to Blocked with a precise context update/action, not a generic approval request.

Explore the normal application journey with the actual task's legitimate candidate information. Record navigation, multi-step forms, conditional branches, CV upload, validation, return/back behavior and submission confirmation. Avoid a practice submission: final submission belongs to the real task and happens once, followed by actual confirmation.

Only learn areas necessary for the assignment. Do not claim knowledge of the entire site from one path. Do not use discovery to change candidate facts or expand into scraping unrelated personal information or probing hidden endpoints.

## 3. Preserve Markdown knowledge

Update the relevant architecture.md under Site Architecture Context. Use [the entry format](../Site%20Architecture%20Context/README.md#knowledge-entry-format). Separate observed routes/states from inferred explanations. Record a page/flow map, source conditions, evidence references, unvisited branches and refresh triggers. Remove personal values, authenticated links and tokens from reusable maps.

An external application site gets its own specific destination subfolder, with parent link and origin. The sample Workday and Employer career site folders are unlearned examples; a company-specific host/tenant path must be recorded before use.

## 4. Maintain Playwright TypeScript routines

Use actual observed role/label/test-ID locators or inspected selectors. The initial pages.ts and application-flow.ts intentionally throw DiscoveryRequired; they are scaffolds, not working portal adapters. Replace the relevant methods only after observation. Do not invent selectors or import temporary snapshot element IDs as persistent locators.

Keep page interactions in pages.ts. Keep flow sequencing, profile inputs and outcome confirmation in application-flow.ts. Check current host/session/page shape before side effects and required fields before final submit. Final submission must consume the task's recorded checkpoint and return an actual confirmed receipt or a specific blocked/uncertain outcome; never catch every error and report success.

Do not hard-code candidate answers, passwords, document paths or tokens in source code. Pass selected private values at runtime. The same portal routine can serve different role profiles without merging their data.

Type-check after changing code. Exercise nonsubmitting page recognition where possible before the real final action. Compilation and offline fixtures do not establish that a live portal works. Preserve the task's prior attempts and the actual verification conditions.

## 5. Resume the application and refresh narrowly

Record which gap was resolved, updated knowledge/code versions and the application checkpoint. Resume the existing task without a new approval gate. If its final-submit outcome is uncertain, establish that outcome before any further submission action.

Refresh only affected routes when expected controls/page shape change, a different application mode appears or the account/session conditions no longer apply. Classify session expiration, closed vacancies and changed layouts separately. Mark old entries historical/needs refresh with the reason; retain their history. Do not repeatedly rediscover unchanged pages or replace missing evidence with guesses.
