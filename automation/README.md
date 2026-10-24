# Automation components

A file- and browser-capable AI agent runs the [application workflow](../Application%20Workflow/application-workflow.md). This folder supplies utilities, state examples and a scheduled check-in prompt that support its work. AgentMail handles email intake; website navigation, candidate onboarding and task progress have separate responsibilities. This repository starts no background worker or schedule.

## What runs where

| Capability | Supplied by this repository | Supplied or configured in the agent environment |
| --- | --- | --- |
| Task execution | [Workflow](../Application%20Workflow/application-workflow.md), [board](../Task%20Board/README.md) and context instructions | An AI agent with a writable working copy and authorized tools |
| Browser automation | Playwright dependency and [site-specific TypeScript scaffolds](../Site%20Architecture%20Context/README.md) | Browser access, sessions and an installed browser for Playwright execution; actual site routines are learned through discovery |
| Supporting code | TypeScript sources, npm scripts and pinned tooling in [package.json](../package.json) | Node.js 22 or later and npm when running these utilities |
| Email-alert intake | [AgentMail clients and setup](email/agentmail/setup.md), inbox discovery, progress format and completed-message cleanup | An AgentMail account and API key; only email mode needs them |
| Candidate onboarding | [Conversational procedure](../Application%20Workflow/onboarding-workflow.md) and [progress example](onboarding/onboarding-state.example.json) | CVs, candidate answers and the agent's document tools; scanned PDFs need available OCR or vision |
| Periodic check-ins | [Scheduler prompt](scheduling/check-in-prompt.md) and resumption instructions | The selected agent environment's scheduler, with the requested cadence, timezone and working root |

AgentMail is the included email provider, not the entire automation system. A manual application can run without AgentMail. Installing Node packages does not supply an AI agent, authenticate websites or start recurring work.

## Folder guide

```text
automation/
├── README.md
├── .env.example
├── email/
│   └── agentmail/
│       ├── README.md
│       ├── client.ts
│       ├── inboxes.ts
│       ├── setup.ts
│       ├── setup.md
│       └── inbox-state.example.json
├── workflow/
│   └── application-state.ts
├── onboarding/
│   └── onboarding-state.example.json
├── scheduling/
│   └── check-in-prompt.md
└── tests/
    ├── agentmail.test.ts
    ├── agentmail-setup.test.ts
    └── application-state.test.ts
```

- **email/agentmail** contains provider-specific access, discovery and setup. Its [integration guide](email/agentmail/README.md) explains alert enumeration, progress and completed-message cleanup.
- **workflow** contains shared application-state types and integrity checks for task movement, confirmation and message completion. These checks do not establish whether external evidence is true; the agent must inspect it.
- **onboarding** contains the empty progress format. The [onboarding workflow](../Application%20Workflow/onboarding-workflow.md) directs the conversation and context updates; candidate answers stay in private role files.
- **scheduling** contains the prompt an existing scheduler uses to start a check-in. It contains no independent scheduler service.
- **tests** contains offline checks using synthetic data and mocked HTTP. They neither log in to websites nor submit applications.

Site-specific page objects and application routines stay with their observed navigation maps in [Site Architecture Context](../Site%20Architecture%20Context/README.md). The initial routines require discovery; their folder names are not claims of working portal integrations.

## Prepare the capabilities needed by a task

Follow [SETUP.md](../SETUP.md) for first use. The agent onboards the candidate, reads the task and prepares only the capabilities that task needs. Profile setup does not require an inbox or portal login. A manual application needs browser access and the selected profile; email mode also needs mail access.

For email mode, the user supplies only `AGENTMAIL_API_KEY` in ignored `automation/.env`, using [.env.example](.env.example). The agent follows [AgentMail setup](email/agentmail/setup.md) to discover or provision an inbox and save its identity privately. Do not ask the user to find or enter an inbox ID. A separate AgentMail skill installation is unnecessary for the included clients.

For browser execution, use the agent's authorized browser tools or Playwright with an installed browser, as explained in [browser setup](../SETUP.md#4-prepare-browser-tooling). The agent learns unfamiliar website flows through [discovery](../Application%20Workflow/discovery-workflow.md). Website passwords remain in the relevant board's private configuration, separate from the mail API key.

## Run the supporting utilities

Run commands from the repository root. The included TypeScript utilities require Node.js 22 or later and npm.

```shell
npm ci
npm run check
npm test
npm run build
```

`check` validates types. `test` runs the offline checks. `build` writes compiled code to ignored `.local/build/`; it starts no worker. The AgentMail module is `.local/build/automation/email/agentmail/client.js` and shared state rules are `.local/build/automation/workflow/application-state.js`.

Email commands use the project's private API key and contact AgentMail:

| Command | Action |
| --- | --- |
| `npm run inbox:setup` | Discover or provision an intake inbox, save its binding and check header access |
| `npm run inbox:check` | Discover an existing inbox and check headers without provisioning or saving a binding |

Both preserve the existing `automation/.env` location. Neither sends email, deletes messages or activates a schedule. Actual alert processing and completed-message deletion follow the [email procedure](email/agentmail/README.md#email-processing-and-cleanup).

## Working data and configuration

The source layout is separate from private runtime storage:

| Private location | Purpose |
| --- | --- |
| `automation/.env` | This working copy's AgentMail API key |
| `.local/agentmail-intake.json` | Resolved inbox binding and any creation identity |
| `.local/inbox-state.json` | Active alert-to-vacancy/task associations and cleanup checkpoints |
| `.local/onboarding-state.json` | Pending/deferred question references and onboarding resumption point |
| Candidate `*.local.md` files and private Documents | Candidate facts, instructions and designated CVs |
| Live Task Board files | Application checkpoints, blockers, confirmations and history |

Preserve these locations and existing values when updating the package. Do not copy another project or global skill's credentials. Keep only secret references in Markdown and retain actual candidate data, browser sessions and evidence outside public Git. An example file or offline passing check does not establish live access or a completed application.

## Optional periodic check-ins

After setup, configure the selected agent environment's existing scheduler with [check-in-prompt.md](scheduling/check-in-prompt.md), the actual project root, requested interval and timezone. No schedule is configured by this package. A scheduler starts the agent's check-in; it does not install browser or inbox capabilities.

Each check-in resumes eligible work, reads new intake, checks resolved blockers and retries eligible email cleanup. It resumes onboarding only for a relevant gap or actual answer, without repeating unchanged questions or introducing review gates. With no actionable work or changed dependency, leave files unchanged. Notify only meaningful applications, new blockers, failures or changes where the scheduler supports quiet results. Record the actual schedule identity and cadence privately.
