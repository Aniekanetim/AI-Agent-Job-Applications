# Set up a working copy

The repository is a reusable package. It starts with no connected inbox, enabled candidate profile, known website flow, live ticket or schedule. An AI agent with file and browser access performs the work; email mode also needs authorized inbox access. Installing Node dependencies alone does not start an agent.

To begin, tell your agent: “Set this up with my CV. Ask for the missing details and save my answers.” It follows [candidate onboarding](Application%20Workflow/onboarding-workflow.md). The steps below explain what the agent sets up; you do not need to populate the context files manually.

## 1. Create your private working copy

Clone, fork or use the repository template. Open its actual root with your agent and read [AGENTS.md](AGENTS.md). Read README, AGENTS and SETUP at a consistent revision. Record the workflow revision in private [shared progress](unified_project_context.md), separately from candidate-profile/CV versions and website observations. Keep the public template free of personal records. For integration into an existing project, follow [section 6](#6-use-with-another-agent-or-project).

## Private working information

For every human template `name.md`, the agent saves supplied values in the adjacent ignored `name.local.md`. For example, it uses `Job Context/Candidate/role-routing.local.md` and `Role Profiles/Software QA Engineer/role-profile.local.md`. The local file replaces the template at read time; do not merge contradictory copies or populate both. This preserves the approved folder organization while keeping public templates blank.

The agent asks you to upload/attach a PDF, DOCX or TXT CV for each selected role, or give an accessible file path when attachments are unavailable. It saves an unchanged copy under `Job Context/Candidate/Role Profiles/<role>/Documents/`, verifies its SHA-256 and records the filename, format, received date/version, hash and extraction status in `Documents/README.local.md`. An external path is used only when you prefer that storage. Text PDFs are extracted; scanned PDFs need available OCR/vision and a legibility check. An unreadable/encrypted document remains a specific dependency. Actual CVs are not included in the package. Source CVs and supporting facts must agree; do not invent missing qualifications.

Live `Task Board/<status>/*.md`, `unified_project_context.local.md`, `.local/`, `.auth/`, credentials and browser storage are ignored. Use `git check-ignore --no-index <path>` to confirm before saving private information. Keep `unified_project_context.md` as the public unconfigured template; record actual setup/progress in its local counterpart. A tracked file remains tracked regardless of ignore rules.

## 2. Answer the onboarding questions

The agent first reads supplied CVs and any existing [candidate context](Job%20Context/Candidate/README.md). It then asks one to three relevant questions at a time about missing identity details, job preferences, screening answers and application instructions. Answers are saved as they arrive. It does not ask you to retype CV facts or open a file to add each answer.

Select the roles and CVs you want to use. The agent configures one independent profile per selected role, adds a new role directory when needed and enables only supplied profiles in private role routing. The QA and support folders are blank examples, not enabled roles. There is no Shared candidate folder.

You can leave optional preferences unspecified or answer later. Missing mandatory information remains a specific dependency. Private `.local/onboarding-state.json` records pending/deferred question references and the resumption point, not another copy of your answers. Existing populated profiles are reused, and an interrupted session resumes its gaps. Onboarding has no approval gate and does not submit applications or activate a schedule by itself.

## 3. Connect websites and inbox

Tell the agent which job board or vacancy to use. It asks for the relevant access action, local `.env` reference or secure-store reference and updates the private [job-board access instructions](Job%20Context/Job%20Boards/README.md). Each board includes a commented `.env.example`. The agent creates a local `.env` from it only when absent; uncomment the email/password placeholders and enter the real values in that ignored file. The authentication runner must explicitly load the selected file at runtime. Keep passwords out of tickets, Markdown and public templates. Employer destinations have separate access requirements; a board password is not automatically their password.

For email-alert mode, follow [AgentMail setup](automation/email/agentmail/setup.md). Enter only `AGENTMAIL_API_KEY` in private `automation/.env`, using the commented [example](automation/.env.example). The agent runs `npm run inbox:setup` to discover a suitable inbox, provision one if none exists, save its identity and verify header access. Users do not need to find or enter inbox IDs or install a separate skill for the included client. `npm run inbox:check` remains read-only. Manual-task mode needs no inbox. Setup sends no test email, deletes no mail and starts no schedule.

## 4. Prepare browser tooling

Use a browser-capable agent and available browser tools. The TypeScript skeletons use Playwright library page objects for website navigation. For the included code utilities, use Node.js 22 or later and npm. The [automation component map](automation/README.md#what-runs-where) explains the required capabilities and where they come from. For local code validation:

```shell
npm ci
npm run check
npm test
```

For actual Playwright browser execution, install the selected browser when needed:

```shell
npx playwright install chromium
```

The agent can initially discover with its authorized browser tools. Generated Playwright routines must remain in the appropriate site's folder and follow its recorded access/session conditions. Initial routines are unlearned and cannot submit anything. See [site knowledge](Site%20Architecture%20Context/README.md). Browser sessions, CVs and accounts are not installed by npm.

## 5. Start work and optionally schedule it

Create a real ticket from the inline [board template](Task%20Board/README.md#ticket-template) in To Do, or read the configured alert inbox. Normal execution needs no review gate. Missing required information goes to Blocked with the exact context path. Discovery runs as needed under the same application instructions.

After setup is usable, configure periodic check-ins when requested in the chosen agent/scheduler with [the check-in prompt](automation/scheduling/check-in-prompt.md). Cadence, timezone and target working root must be supplied for this setup. Copying files does not transfer an existing schedule. Do not configure a second worker against the same inbox/board without coordinating claims.

## Setup complete means

Profile setup means the agent can locate the selected role, supplied facts and designated CV, with optional deferrals recorded. Application readiness additionally needs instructions and access for the actual task; email mode also needs its inbox. Onboarding reports that distinction. Inbox and browser capabilities are verified only after actual access. No submission or successful application is established by this checklist or the offline tests.

## 6. Use with another agent or project

Point the agent to this repository's [README and adoption prompt](README.md#start-here), or give it a fork, template copy or clone. Reading the URL supplies instructions; it does not create local files, authenticate accounts or activate a schedule. The agent needs a writable working copy plus the browser and inbox tools required by the task.

For an existing project, inspect and preserve its working contract, README, candidate data, tasks and application records before merging this workflow. Resolve instruction conflicts explicitly rather than overwriting files. If the workflow is nested, read its AGENTS.md explicitly unless the agent is known to discover it automatically.

For a different candidate or independent setup, begin with empty live queues and no copied outcomes. Run onboarding with that candidate's own CVs, answers and access. Do not inherit another person's facts, application records, authority or schedule. Follow sections 2–5 to begin execution; missing tools or inputs become specific dependencies, not claims of success.

## 7. Move the same setup to another machine

A public clone does not contain ignored operational information. Transfer the following through a private mechanism:

- Actual role-profile `*.local.md` files and CV/supporting documents.
- Per-board `.env` files, if used, through a private transfer; alternatively enter the values again on the new machine.
- Private `automation/.env` for the included AgentMail client, or reconnect the selected authenticated connector.
- Private `.local/agentmail-intake.json`, preserving the selected mailbox and any creation identity through restarts.
- Live board tickets, private shared progress and `.local/inbox-state.json`.
- Private `.local/onboarding-state.json` when setup has pending questions or deferrals.
- Relevant restricted evidence and learned site maps/code with their observation versions.

Preserve task IDs, source-message/vacancy associations, chosen role/CV versions, questions, confirmations, cleanup state and checkpoints. Keep credentials and reusable browser sessions out of published context; reconnect authentication securely on the destination machine.

Recheck actual document paths, CV hashes, tools, website conditions and worker ownership. Read any Submission attempted checkpoint before resuming. Establish an uncertain result for that same vacancy rather than submitting again. Retry outstanding email cleanup using its existing message reference without repeating the application.

If an old scheduler still runs, coordinate ownership before starting another worker. File transfer neither moves nor disables it. Configure the destination schedule only when requested, using its actual root, cadence and timezone.

## 8. Maintain a reusable template

Keep public role templates blank and live board folders empty. Mark initial website routines unlearned. Publish sanitized workflow/code improvements deliberately; do not push candidate records or authenticated evidence. Record a newly adopted workflow version without rewriting ongoing task history or claiming old observations were freshly verified.
