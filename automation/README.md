# Automation components

A file- and browser-capable AI agent runs the [application workflow](../Application%20Workflow/application-workflow.md). This folder supplies utilities, state examples and a scheduled check-in prompt that support its work. AgentMail handles email intake; website navigation, candidate onboarding and task progress have separate responsibilities. This repository starts no background worker or schedule.

## What runs where

| Capability | Supplied by this repository | Supplied or configured in the agent environment |
| --- | --- | --- |
| Task execution | [Workflow](../Application%20Workflow/application-workflow.md), [board](../Task%20Board/README.md) and context instructions | An AI agent with a writable working copy and authorized tools |
| Browser automation | Pinned Playwright CLI/library, [browser setup/check and launcher](browser/README.md), and site-specific TypeScript scaffolds | Node/npm and permitted browser installation/execution; account access and actual site methods are established during onboarding/discovery |
| Supporting code | TypeScript sources, npm scripts and pinned tooling in [package.json](../package.json) | Node.js 22 or later and npm when running these utilities |
| Email-alert intake | [AgentMail clients and setup](email/agentmail/setup.md), inbox discovery, progress format and completed-message cleanup | Existing suitable AgentMail integration, or an account/API key when none can be reused; only email mode needs mail access |
| Candidate onboarding | [Conversational procedure](../Application%20Workflow/onboarding-workflow.md), roadmap, per-board mapping progress and [readiness helpers](onboarding/README.md) | CVs, candidate instructions, selected boards, actual observations and document tools; scanned PDFs need available OCR or vision |
| Periodic check-ins | [Scheduler prompt](scheduling/check-in-prompt.md) and resumption instructions | The selected agent environment's scheduler, with the requested cadence, timezone and working root |

AgentMail is the included email provider, not the entire automation system. A manual application can run without AgentMail. Installing Node packages does not supply an AI agent, authenticate websites or start recurring work.

## Folder guide

```text
automation/
├── README.md
├── .env.example
├── browser/
│   ├── README.md
│   ├── runtime.mjs
│   ├── cli.mjs
│   └── setup.mjs
├── email/
│   └── agentmail/
│       ├── README.md
│       ├── connection.ts
│       ├── client.ts
│       ├── inboxes.ts
│       ├── setup.ts
│       ├── setup.md
│       └── inbox-state.example.json
├── workflow/
│   └── application-state.ts
├── onboarding/
│   ├── README.md
│   ├── progress.ts
│   ├── state-store.ts
│   ├── cli.ts
│   └── onboarding-state.example.json
├── scheduling/
│   └── check-in-prompt.md
└── tests/
    ├── agentmail-connection.test.ts
    ├── agentmail.test.ts
    ├── agentmail-setup.test.ts
    ├── application-state.test.ts
    ├── onboarding.test.ts
    └── browser.test.mjs
```

- **browser** resolves the pinned local CLI, prepares missing browser revisions and verifies an isolated local interaction. It has no candidate/account dependency.
- **email/agentmail** contains provider-specific access, discovery and setup. Its [integration guide](email/agentmail/README.md) explains alert enumeration, progress and completed-message cleanup.
- **workflow** contains shared application-state types and integrity checks for task movement, confirmation and message completion. These checks do not establish whether external evidence is true; the agent must inspect it.
- **onboarding** contains schema-2 progress, migration, readiness and agent CLI utilities. The [onboarding workflow](../Application%20Workflow/onboarding-workflow.md) directs the conversation, one-to-three primary-board selection and initial mapping. Candidate answers stay in private role files.
- **scheduling** contains the prompt an existing scheduler uses to start a check-in. It contains no independent scheduler service.
- **tests** contains offline checks using synthetic data and mocked HTTP. They neither log in to websites nor submit applications.

Site-specific page objects and application routines stay with their observed navigation maps in [Site Architecture Context](../Site%20Architecture%20Context/README.md). The initial routines require discovery; their folder names are not claims of working portal integrations.

## Prepare the capabilities needed by a task

Follow [SETUP.md](../SETUP.md) for first use. The agent onboards the candidate, reads the task and prepares only the capabilities that task needs. Profile setup does not require an inbox or portal login. A manual application needs browser access and the selected profile; email mode also needs mail access.

For email mode, the agent first runs `npm run inbox:detect` and checks available connected tools/skills. It reuses a suitable existing integration through its original source. Only when none is usable does the user supply `AGENTMAIL_API_KEY` in ignored `automation/.env`, using [.env.example](.env.example). The agent follows [AgentMail setup](email/agentmail/setup.md) to list available inboxes, obtain or reuse your choice, and save its identity privately. No existing inbox is chosen automatically, even when only one is available. Do not ask the user to find or enter an inbox ID. A separate AgentMail skill installation is unnecessary for the included clients.

For application setup, follow [browser setup](browser/README.md) before website authentication or mapping. The agent prepares and verifies the pinned CLI and actual browser operation, reusing compatible tooling. The agent learns unfamiliar website flows through [discovery](../Application%20Workflow/discovery-workflow.md). Website passwords remain in the relevant board's private configuration, separate from the mail API key.

## Run the supporting utilities

Run commands from the repository root. The included TypeScript utilities require Node.js 22 or later and npm.

```shell
npm ci
npm run check
npm test
npm run build
```

`check` validates types. `test` runs the offline checks. `build` writes compiled code to ignored `.local/build/`; it starts no worker. The AgentMail module is `.local/build/automation/email/agentmail/client.js` and shared state rules are `.local/build/automation/workflow/application-state.js`.

Browser setup can download missing components; its operation check visits loopback only. Onboarding status/check reads private progress. Email detection reads local metadata without network requests or writes; inbox setup/check contacts AgentMail through the configured project key or selected existing source:

| Command | Action |
| --- | --- |
| `npm run browser:setup` | Prepare missing pinned browser runtimes and verify actual CLI operation on a local page |
| `npm run browser:check` | Verify browser operation without installing components |
| `npm run browser -- ...` | Run the pinned local CLI |
| `npm run onboarding:status` | Display the saved roadmap and per-board progress without changing saved progress |
| `npm run onboarding:check` | Check scoped preparation, evidence references and local runtime without changing saved progress |
| `npm run inbox:detect` | Detect existing local setup and return nonsecret metadata; verify connected-tool access separately |
| `npm run inbox:list` | List inbox addresses and metadata for the user’s choice without reading messages or writing a binding |
| `npm run inbox:setup` | Bind the user’s selected inbox and check header access; create only for an empty account without a requested existing address |
| `npm run inbox:check` | Discover an existing inbox and check headers without provisioning or saving a binding |

These utilities preserve the existing `automation/.env` location. Setup/check sends no email, deletes no messages and activates no schedule. Actual alert processing and completed-message deletion follow the [email procedure](email/agentmail/README.md#email-processing-and-cleanup).

## Working data and configuration

The source layout is separate from private runtime storage:

| Private location | Purpose |
| --- | --- |
| `automation/.env` | This working copy's AgentMail API key |
| `.local/agentmail-intake.json` | Resolved inbox binding and any creation identity |
| `.local/agentmail-connection.json` | Selected existing credential source reference; no key value |
| `.local/inbox-state.json` | Active alert-to-vacancy/task associations and cleanup checkpoints |
| `.local/onboarding-state.json` | Schema-2 steps, selected-board access/mapping, pending/deferred questions and resumption point |
| `.local/browser-readiness.json` | Actual local CLI check and runtime fingerprint |
| `.local/browser/cli.config.json` | Private CLI browser/output configuration |
| `.local/onboarding-handoff.md` | Scoped readiness, boundaries and first-task instructions |
| Candidate `*.local.md` files and private Documents | Candidate facts, instructions and designated CVs |
| Live Task Board files | Application checkpoints, blockers, confirmations and history |

Preserve these locations and existing values when updating the package. Reuse an existing integration only within its actual permissions, through its original source or connector. Do not copy another project or global skill's credentials. Keep only secret references in Markdown and retain actual candidate data, browser sessions and evidence outside public Git. An example file or offline passing check does not establish live access or a completed application.

## Optional periodic check-ins

After setup, configure the selected agent environment's existing scheduler with [check-in-prompt.md](scheduling/check-in-prompt.md), the actual project root, requested interval and timezone. No schedule is configured by this package. A scheduler starts the agent's check-in; it does not install browser or inbox capabilities.

Each check-in resumes eligible work, reads new intake, checks resolved blockers and retries eligible email cleanup. It resumes onboarding only for a relevant gap or actual answer, without repeating unchanged questions or introducing review gates. Read saved step/board progress, check changed references and runtime, and preserve partial preparation. An unrelated deferred board does not block eligible work on a prepared one. With no actionable work or changed dependency, leave files unchanged. Notify only meaningful applications, new blockers, failures or changes where the scheduler supports quiet results. Record the actual schedule identity and cadence privately.
