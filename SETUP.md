# Set up a working copy

The repository is a reusable package. It starts with no connected inbox, enabled candidate profile, known website flow, live ticket or schedule. An AI agent with file, browser and authorized inbox access performs the work; installing Node dependencies alone does not start an agent.

## 1. Create your private working copy

Clone, fork or use the repository template. Open its actual root with your agent and read [AGENTS.md](AGENTS.md). Read README, AGENTS and SETUP at a consistent revision. Record the workflow revision in private [shared progress](unified_project_context.md), separately from candidate-profile/CV versions and website observations. Keep the public template free of personal records. For integration into an existing project, follow [section 6](#6-use-with-another-agent-or-project).

## Private working information

For every human template `name.md`, put real values in the adjacent ignored `name.local.md`. For example, use `Job Context/Candidate/role-routing.local.md` and `Role Profiles/Software QA Engineer/role-profile.local.md`. The local file replaces the template at read time; do not merge contradictory copies or populate both. This preserves the approved folder organization while keeping public templates blank.

Supply actual CV files inside the selected role's Documents directory. Put their exact filename, format, date/version and SHA-256 in that directory's `README.local.md`. Use local paths for secure external documents if preferred. Actual CVs are not included in the package. Source CVs and supporting facts must agree; do not invent missing qualifications.

Live `Task Board/<status>/*.md`, `unified_project_context.local.md`, `.local/`, `.auth/`, credentials and browser storage are ignored. Use `git check-ignore --no-index <path>` to confirm before saving private information. Keep `unified_project_context.md` as the public unconfigured template; record actual setup/progress in its local counterpart. A tracked file remains tracked regardless of ignore rules.

## 2. Configure each independent role

Follow [candidate setup](Job%20Context/Candidate/README.md). Enable only supplied profiles in role-routing.local.md. Complete the selected profile's identity, experience, preferences, answers and application instructions, including handling of unsuitable/closed vacancies, account registration and overlapping roles. A role's Documents/README.local.md identifies its actual CV. There is no Shared candidate folder.

The supplied QA and technical-support directories are blank examples. Add another role by copying that structure with empty templates and supplying its own local values. Disable or remove an unused example profile in your working copy. A profile being present does not make it enabled.

## 3. Connect websites and inbox

Complete the relevant [job-board access instructions](Job%20Context/README.md) using local counterparts. Reference a secure credential store or existing authorized browser session. Do not paste passwords into tickets or public files. Employer destinations can have their own access requirements, recorded as nonsecret references in the parent platform's local instructions.

Configure [automation/README.md](automation/README.md): actual AgentMail inbox, secret reference, sender selection rules and cadence. An address such as `pass@agentmail.to` is a placeholder until the user supplies an actual inbox. Use an existing connector or the portable HTTP helper. Pagination and deletion rules are documented there. Do not run a send-email smoke test or delete live mail during setup.

## 4. Prepare browser tooling

Use a browser-capable agent and available browser tools. The TypeScript skeletons use Playwright library page objects for website navigation. For local code validation:

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

After the manual procedure is usable, configure periodic check-ins in the chosen agent/scheduler with [the check-in prompt](automation/check-in-prompt.md). Cadence, timezone and target working root must be supplied for this setup. Copying files does not transfer an existing schedule. Do not configure a second worker against the same inbox/board without coordinating claims.

## Setup complete means

An agent can locate the chosen role and CV, read its instructions, access the actual target and record private tasks. Inbox and browser capabilities are verified only after actual access. No submission or successful application is established by this checklist or the offline tests.

## 6. Use with another agent or project

Point the agent to this repository's [README and adoption prompt](README.md#start-here), or give it a fork, template copy or clone. Reading the URL supplies instructions; it does not create local files, authenticate accounts or activate a schedule. The agent needs a writable working copy plus the browser and inbox tools required by the task.

For an existing project, inspect and preserve its working contract, README, candidate data, tasks and application records before merging this workflow. Resolve instruction conflicts explicitly rather than overwriting files. If the workflow is nested, read its AGENTS.md explicitly unless the agent is known to discover it automatically.

For a different candidate or independent setup, begin with empty live queues and no copied outcomes. Supply that candidate's own role profiles, routing, CVs, platform accounts and inbox. Do not inherit another person's facts, application records, authority or schedule. Follow sections 2–5 to begin execution; missing tools or inputs become specific dependencies, not claims of success.

## 7. Move the same setup to another machine

A public clone does not contain ignored operational information. Transfer the following through a private mechanism:

- Actual role-profile `*.local.md` files and CV/supporting documents.
- Live board tickets, private shared progress and `.local/inbox-state.json`.
- Relevant restricted evidence and learned site maps/code with their observation versions.

Preserve task IDs, source-message/vacancy associations, chosen role/CV versions, questions, confirmations, cleanup state and checkpoints. Keep credentials and reusable browser sessions out of published context; reconnect authentication securely on the destination machine.

Recheck actual document paths, CV hashes, tools, website conditions and worker ownership. Read any Submission attempted checkpoint before resuming. Establish an uncertain result for that same vacancy rather than submitting again. Retry outstanding email cleanup using its existing message reference without repeating the application.

If an old scheduler still runs, coordinate ownership before starting another worker. File transfer neither moves nor disables it. Configure the destination schedule only when requested, using its actual root, cadence and timezone.

## 8. Maintain a reusable template

Keep public role templates blank and live board folders empty. Mark initial website routines unlearned. Publish sanitized workflow/code improvements deliberately; do not push candidate records or authenticated evidence. Record a newly adopted workflow version without rewriting ongoing task history or claiming old observations were freshly verified.
