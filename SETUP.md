# Set up a working copy

The repository is a reusable package. It starts with no connected inbox, enabled candidate profile, complete executable application flow, live ticket or schedule. A limited public form/CAPTCHA observation is included as a site-knowledge example. An AI agent with file and browser access performs the work; email mode also needs authorized inbox access. Installing Node dependencies alone does not start an agent.

To begin, tell your agent: “Set this up with my CV. Ask for the missing details and save my answers.” It follows [candidate onboarding](Application%20Workflow/onboarding-workflow.md). The steps below explain what the agent sets up; you do not need to populate the context files manually.

## 1. Create your private working copy

Clone, fork or use the repository template. Open its actual root with your agent and read [AGENTS.md](AGENTS.md). Read README, AGENTS and SETUP at a consistent revision. Record the workflow revision in private [shared progress](unified_project_context.md), separately from candidate-profile/CV versions and website observations. Keep the public template free of personal records. For integration into an existing project, follow [section 6](#6-use-with-another-agent-or-project).

## Private working information

For every human template `name.md`, the agent saves supplied values in the adjacent ignored `name.local.md`. For example, it uses `Job Context/Candidate/role-routing.local.md` and `Role Profiles/Software QA Engineer/role-profile.local.md`. The local file replaces the template at read time; do not merge contradictory copies or populate both. This preserves the approved folder organization while keeping public templates blank.

The agent asks you to upload/attach a PDF, DOCX or TXT CV for each selected role, or give an accessible file path when attachments are unavailable. It saves an unchanged copy under `Job Context/Candidate/Role Profiles/<role>/Documents/`, verifies its SHA-256 and records the filename, format, received date/version, hash and extraction status in `Documents/README.local.md`. An external path is used only when you prefer that storage. Text PDFs are extracted; scanned PDFs need available OCR/vision and a legibility check. An unreadable/encrypted document remains a specific dependency. Actual CVs are not included in the package. Source CVs and supporting facts must agree; do not invent missing qualifications.

Live `Task Board/<status>/*.md`, `unified_project_context.local.md`, `.local/`, `.auth/`, credentials and browser storage are ignored. Use `git check-ignore --no-index <path>` to confirm before saving private information. Keep `unified_project_context.md` as the public unconfigured template; record actual setup/progress in its local counterpart. A tracked file remains tracked regardless of ignore rules.

## 2. Choose the scope and prepare tools

Before starting work, the agent reads existing private context and shows the [onboarding roadmap](Application%20Workflow/onboarding-workflow.md#1-agree-the-scope-and-show-the-roadmap). Choose profile setup, manual applications, email-alert applications or both sources. For application mode, select one to three primary job boards: one required and two optional. Custom websites are welcome. This selection prepares common journeys; it does not restrict future assigned tasks to those websites.

Choose automatic, in-app or Playwright as the default before tool installation. The agent follows [browser setup](automation/browser/README.md) before website authentication or exploration, preparing Playwright as the upload fallback for an in-app choice. It checks Node.js 22+ and npm, installs this copy's pinned Playwright CLI/library and prepares missing browser runtimes. It verifies actual navigation, form entry, upload and checkpoint recovery on a harmless local page. An in-app choice also needs a separate host-browser capability check; the CLI check cannot stand in for it. Existing compatible installations are reused. No global CLI installation or separate browser skill is required. If the environment prevents installation, the agent explains the exact required user action instead of leaving the dependency until the first application.

These commands are for the agent operating the working copy, not a questionnaire for the user:

```shell
npm ci
npm run browser:setup
npm run onboarding:status
```

Profile-only setup skips browser tools, accounts, inbox and site mapping. Progress is saved privately and shown after meaningful changes. An interrupted setup resumes the relevant gap. An installed package or a green counter alone does not establish readiness.

## 3. Import CVs and save instructions

The agent reads supplied CVs and any existing [candidate context](Job%20Context/Candidate/README.md). It configures one independent profile per selected role and asks one to three relevant missing questions at a time about facts, job preferences, screening answers and application instructions. Answers are saved as they arrive. It does not ask you to retype CV facts or edit files for each answer.

The QA and support folders are blank examples, not enabled roles. There is no Shared candidate folder. Additional roles follow the same structure. CV receipt, extraction and suitability for an actual portal's upload requirements are distinct checks.

Optional preferences can remain unspecified or deferred until relevant. Scope-required missing information remains a concrete dependency. [Progress helpers](automation/onboarding/README.md) retain questions and checkpoints without copying the answers. Existing populated profiles are reused; onboarding introduces no routine approval gate.

## 4. Connect selected websites and inbox

For each selected board, the agent reuses authorized sessions or asks for the relevant access action, local configuration reference or secure-store reference. Each board provides a commented `.env.example`; the agent creates `.env` only when absent. Enter credentials privately and activate the supplied placeholders. Keep passwords out of chat, tickets and Markdown. The agent loads the selected board's values only for its verified login under [job-board access](Job%20Context/Job%20Boards/README.md). Employer destinations have separate account requirements.

For email-alert or both-source mode, the agent presents **Connect your email** under [shared email setup](automation/email/README.md). It follows [harness discovery](automation/email/host-connectors/discovery.md) before showing Google — Gmail / Google Workspace first, available Outlook and other discovered email services, optional AgentMail and Set up email later. Available, connected and ready are separate checks. A provider whose availability cannot be established stays Not yet verified.

Choose an existing connection or let the agent guide you through the harness's connection screen. Then choose from the actual accessible accounts and optionally scope alerts by folder, label or filter. A suitable Gmail, Outlook or other connection requires no AgentMail account or separate Gmail API key. Email authentication remains managed by the host; do not put your email password in chat or a job-board `.env` file. The agent saves the sign-in checkpoint and resumes after authentication. It preserves an existing confirmed source unless you choose to change it.

If you choose **Set up email later**, eligible manual tasks can proceed while email intake remains paused. The agent retains your selection and checkpoint. It does not claim email or both-source readiness; a switch to manual-only setup is recorded only when you choose that scope. [AgentMail setup](automation/email/agentmail/setup.md) remains available for a dedicated inbox.

Verify list/search, full message content, pagination and the available message-level cleanup effects. Ask whether to delete, archive, label or retain fully completed alerts. Read-only access can use retain mode with private handled markers. Explain Trash versus permanent deletion and never silently change the policy. Record actual capabilities, references and limitations; do not mutate messages to test setup. The agent manages provider IDs. An existing confirmed AgentMail selection is migrated without another mailbox-choice question.

Manual-only mode needs no alert inbox. For [verification access](automation/email/verification/README.md), reuse the selected email connection and mailbox if it also receives job-site codes. Ask about another access method only if codes go elsewhere or a challenge needs human help; mailbox selection already belongs to onboarding. Setup sends no mail and deletes no messages; recurring operation is configured only when explicitly selected. Account connection and site mapping are separate progress checks.

## 5. Map websites and verify readiness

The agent performs [initial discovery](Application%20Workflow/discovery-workflow.md#onboarding-discovery) for each selected board. It learns vacancy search/details, application routing, accessible forms and review steps, then saves Markdown observations and shared journey knowledge and methods for the selected browser, with Playwright upload handling in [Site Architecture Context](Site%20Architecture%20Context/README.md). Actual encountered destinations get employer/host-specific entries beneath their originating board. It records unknown branches and boundaries rather than pretending every form is known.

No practice application is submitted, and onboarding does not create an account, upload a CV or change an application draft merely to complete a map. Actions with account/application effects need applicable instructions. A route that fails remains unfinished or blocked. An inaccessible branch can have an evidenced boundary for later discovery. The user can explicitly defer a selected optional board; the agent identifies partial preparation and preserves progress elsewhere. At least one primary board must be prepared for application readiness.

Before handoff, check actual browser operation, selected profiles/CVs, instructions, board access/mapping, email when selected and writable private storage. The [readiness helper](automation/onboarding/README.md#deferrals-and-completion) checks references and runtime conditions; the agent inspects their contents. Write a private handoff, then explain what is ready, any deferrals or unverified branches, and how to start a real task. No live application is established by onboarding completion. An active schedule exists only if the user selected recurring operation and the agent configured and checked it through the host scheduler.

## Setup complete means

Completion is scoped: profile setup prepares role context; application setup additionally prepares tools and selected boards; email mode also verifies the chosen inbox. Both-source mode supports Email Alerts and To Do. Selected-board preparation covers the observed branches, not every future employer question or destination. Missing known scope-required work prevents completion; explicit optional deferrals are visible.

A fresh clone has no candidate configuration, account access or learned private application journeys. Its public example does not establish a complete employer integration. An old completion flag must be revalidated when new required checks are introduced or the setup moves machines. Preserve supplied data and resume relevant gaps instead of restarting questions.

To start work, supply a real [To Do ticket](Task%20Board/README.md#ticket-template) or use the selected job-alert inbox. Later concrete dependencies use Blocked; setup-only questions stay in private onboarding progress. Configure [periodic check-ins](automation/scheduling/check-in-prompt.md) only when requested, using the actual root, interval and timezone.

## 6. Use with another agent or project

Point the agent to this repository's [README and adoption prompt](README.md#start-here), or give it a fork, template copy or clone. Reading the URL supplies instructions; it does not create local files, authenticate accounts or activate a schedule. The agent needs a writable working copy plus the browser and inbox tools required by the task.

For an existing project, inspect and preserve its working contract, README, candidate data, tasks and application records before merging this workflow. Resolve instruction conflicts explicitly rather than overwriting files. If the workflow is nested, read its AGENTS.md explicitly unless the agent is known to discover it automatically.

For a different candidate or independent setup, begin with empty live queues and no copied outcomes. Run onboarding with that candidate's own CVs, answers and access. Do not inherit another person's facts, application records, authority or schedule. Follow sections 2–5 to prepare and begin execution; missing tools or inputs become specific dependencies, not claims of success.

## 7. Move the same setup to another machine

A public clone does not contain ignored operational information. Transfer the following through a private mechanism:

- Actual role-profile `*.local.md` files and CV/supporting documents.
- Per-board `.env` files, if used, through a private transfer; alternatively enter the values again on the new machine.
- Private `automation/.env` for the included AgentMail client, or reconnect the selected authenticated connector.
- Private `.local/agentmail-intake.json`, preserving the selected mailbox and any creation identity through restarts.
- Private `.local/agentmail-connection.json` when using an existing credential source. Reconnect or update its nonsecret path/tool reference on the destination machine; a reference does not transfer the credential or skill.
- Private `.local/email-connection.json` and actual capability evidence, plus live board tickets, shared progress and `.local/inbox-state.json` with retained-message markers. Revalidate access after relocation.
- Private `.local/onboarding-state.json`, retaining step/board progress, pending/deferred questions and references. Recheck actual tools and access on the destination machine; transferred completion is not current proof.
- Relevant restricted evidence and learned site maps/code with their observation versions.

Preserve task IDs, source-message/vacancy associations, chosen role/CV versions, questions, confirmations, cleanup state and checkpoints. Keep credentials and reusable browser sessions out of published context; reconnect authentication securely on the destination machine.

Recheck actual document paths, CV hashes, tools, website conditions and worker ownership. Read any Submission attempted checkpoint before resuming. Establish an uncertain result for that same vacancy rather than submitting again. Retry outstanding email cleanup through [the owned completion protocol](automation/email/alert-completion.md) using its existing message reference without repeating the application. Preserve private source/outcome evidence, staged correction proposals and attempt/cancellation history with unfinished records. The agent uses protected state and artifact commands; users do not need to edit these files. A pending attempt must be inspected or safely cancelled before work is changed. Stop the old worker before moving to another machine; independent copies do not share claims.

If an old scheduler still runs, coordinate ownership before starting another worker. File transfer neither moves nor disables it. Configure the destination schedule only when requested, using its actual root, cadence and timezone.

## 8. Maintain a reusable template

Keep public role templates blank and live board folders empty. Mark initial website routines unlearned. Publish sanitized workflow/code improvements deliberately; do not push candidate records or authenticated evidence. Record a newly adopted workflow version without rewriting ongoing task history or claiming old observations were freshly verified.

## Browser, document and operating choices

The agent reuses existing answers and asks only for missing choices. In-app stays the default when selected. Every application requiring a file upload uses Playwright; a midway discovery preserves the same task and draft under [the handoff procedure](automation/browser/upload-fallback.md). Sessions are verified separately. Unknown submission outcomes and permission denials remain specific blockers. For CAPTCHA, follow [human handoff](automation/browser/captcha-handoff.md). The task waits in Blocked when you are away, without repeated requests; other applications can continue. When available, you complete the challenge in an accessible application browser. The agent checks the actual vacancy, session, fields/CV and submission state before resuming. A session or draft may expire; the package does not guarantee uninterrupted browser persistence or automated CAPTCHA solving.

The original CV remains unchanged. When its format is unsuitable for upload, the agent uses available document tools to prepare and inspect a factual rendition, recording its original/version/hash in the role's existing Documents index. A readable TXT file may populate a profile while PDF/DOCX preparation remains unfinished. Actual portal restrictions are checked when observed.

Onboarding establishes application-email verification access, OTP/MFA resumption, limits and reporting. Explicitly choose the task-board check-in interval (for example hourly, daily or a custom supported interval), or on-demand use, under [schedule setup](automation/scheduling/README.md); recurring readiness needs actual scheduled-environment access, not only interactive success. Progress shows required preparation, explicit boundaries and the first-task action. Older state formats migrate without discarding supplied information or inventing the browser/schedule choice.
