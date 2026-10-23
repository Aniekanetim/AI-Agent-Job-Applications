# AI Agent Job Applications

A portable, autonomous job-application workflow. Job-alert emails and manual tickets supply work. Self-contained candidate role profiles supply the facts and instructions. The agent reuses learned website navigation, discovers unfamiliar steps, submits applications and records confirmed outcomes.

**Version:** 1.0.0 — 23 October 2026. **State:** unconfigured reusable package. No inbox connected, role enabled, live application submitted or schedule activated. Website maps are unlearned templates, not verified integrations.

[Use this template](https://github.com/Aniekanetim/AI-Agent-Job-Applications/generate) · [Fork](https://github.com/Aniekanetim/AI-Agent-Job-Applications/fork) · [Setup](SETUP.md)

## Start here

1. Follow [SETUP.md](SETUP.md) in a private working copy.
2. Populate the relevant [candidate role profiles](Job%20Context/Candidate/README.md), including their CVs, answers and application instructions.
3. Configure [platform access](Job%20Context/README.md) and the [alert inbox](automation/README.md#inbox-access).
4. Give your agent the adoption prompt below. It can start from a manual ticket without an inbox.
5. Configure periodic check-ins separately when the inbox, context and browser access are ready.

```text
Adopt https://github.com/Aniekanetim/AI-Agent-Job-Applications as my
job-application workflow. Read AGENTS.md, SETUP.md,
unified_project_context.md, Job Context/README.md, Task Board/README.md and
Application Workflow/application-workflow.md. Preserve existing project files.
Use my configured role profiles and application instructions. Process job-alert
emails and To Do tickets autonomously, without review gates. Reuse relevant
Site Architecture Context and its Playwright routines; discover missing or changed
steps using Application Workflow/discovery-workflow.md. Move unresolved tasks to
Blocked with the exact context file and action needed. Move only confirmed
submissions to Applied. Delete a source alert only after every vacancy in it is
accounted for under my instructions. Read automation/README.md before inbox work.
Do not invent candidate facts, claim unobserved submissions or activate a schedule
from this prompt alone. Keep candidate data, tickets, credentials and sessions private.
```

For URL-only adoption, forks and integration, see [use with another agent or project](SETUP.md#6-use-with-another-agent-or-project).

## What supplies work, and what explains execution

| Component | Purpose |
| --- | --- |
| [Task Board](Task%20Board/README.md) | Email Alerts and To Do are the two intake sources; Blocked and Applied retain outcomes and progress |
| [Job Context](Job%20Context/README.md) | Human-maintained role profiles, CV references, platform access and application instructions |
| [Site Architecture Context](Site%20Architecture%20Context/README.md) | Agent-maintained navigation maps and Playwright TypeScript routines, including external application destinations |
| [Application workflow](Application%20Workflow/application-workflow.md) | Role selection, form completion, submission verification, blocking and resumption |
| [Discovery workflow](Application%20Workflow/discovery-workflow.md) | Learn unfamiliar or changed application steps and preserve reusable knowledge |
| [Check-ins and inbox integration](automation/README.md) | Inbox pagination, progress records, message cleanup and optional scheduling |
| [Shared progress](unified_project_context.md) | Current setup, operational checkpoint and links, without duplicating candidate documents |

The agent acts within the candidate's supplied instructions without routine review gates. A missing fact or access requirement is a specific dependency: record it in Blocked and continue other eligible work. Website discovery does not authorize inventing qualifications, changing candidate instructions, paying fees or sending unrelated messages.

```text
Email alert / manual task -> select role profile -> use site knowledge -> submit
                                                       |                  |
                                                discover changed steps    v
                                                                  confirm -> Applied
                                                       |
                                                unresolved dependency
                                                       v
                                                    Blocked
                                                       |
                                                context resolved -> resume
```

A source email can contain several vacancies. The agent keeps one small progress record for that email, including vacancies excluded by an explicit candidate rule. It deletes only the completed message after all relevant applications have confirmed outcomes. An unfinished or blocked application keeps its alert available. No routine comparison across email tasks, manual tasks and historical applications is required.

## Available now and learned later

This repository supplies the workflow, empty board, role/context templates, offline-tested completion rules, an AgentMail HTTP helper and TypeScript website scaffolds. It is not a background service or a universal prebuilt application bot. A browser-capable AI agent runs the workflow. Portal-specific selectors and application routines are learned from actual access; the initial routines deliberately report that discovery is required.

Install optional TypeScript tooling with `npm ci`. `npm run check` checks types; `npm test` runs offline policy/helper checks with fake data and mocked HTTP. These commands neither log in to websites nor submit applications.

## Reuse and privacy

Fork or use this repository as a template, then create a private working copy for real candidate information. The public edition contains blank `.md` templates. Supply actual values using ignored `*.local.md` counterparts, and put CVs in their profile's ignored Documents files. The agent reads a local counterpart instead of its blank template, never both as competing sources. See [setup](SETUP.md#private-working-information).

Credentials, inbox progress, task tickets, application evidence, CVs and reusable browser state are excluded from Git by default. When moving machines, transfer the private working information separately and reconnect authentication. [Moving to another machine](SETUP.md#7-move-the-same-setup-to-another-machine) explains resumption.

## License

[MIT license](LICENSE).
