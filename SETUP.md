# Set up a working copy

The repository is a reusable package. It starts with no connected inbox, enabled candidate profile, known website flow, live ticket or schedule. An AI agent with file, browser and authorized inbox access performs the work; installing Node dependencies alone does not start an agent.

## 1. Create your private working copy

Clone, fork or use the repository template. Open its actual root with your agent and read [AGENTS.md](AGENTS.md). Preserve existing files if adopting into another project. Record the workflow revision in [shared progress](unified_project_context.md). Keep the public template free of personal records.

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

Use a browser-capable agent and available browser tools. The TypeScript skeletons use Playwright library page objects, not QA test cases. For local code validation:

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

After the manual procedure is usable, configure periodic check-ins in the chosen agent/scheduler with [the check-in prompt](automation/check-in-prompt.md). Cadence, timezone and target working root must be supplied for this new project. No schedule from the QA project transfers automatically. Do not configure a second worker against the same inbox/board without coordinating claims.

## Setup complete means

An agent can locate the chosen role and CV, read its instructions, access the actual target and record private tasks. Inbox and browser capabilities are verified only after actual access. No submission or successful application is established by this checklist or the offline tests.
