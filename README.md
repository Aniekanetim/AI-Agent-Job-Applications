# AI Agent Job Applications

A portable, autonomous job-application workflow. Job-alert emails and manual tickets supply work. Self-contained candidate role profiles supply the facts and instructions. The agent reuses learned website navigation, discovers unfamiliar steps, submits applications and records confirmed outcomes.

**Version:** 1.7.0 — 24 October 2026. **State:** unconfigured reusable package. No inbox connected, role enabled, live application submitted or schedule activated. Website maps are unlearned templates, not verified integrations.

[Use this template](https://github.com/Aniekanetim/AI-Agent-Job-Applications/generate) · [Fork](https://github.com/Aniekanetim/AI-Agent-Job-Applications/fork) · [Setup](SETUP.md)

## Start here

1. Give a file- and browser-capable agent the adoption prompt below. It will help create or open a private working copy using [SETUP.md](SETUP.md).
2. Tell it which roles you want. [Onboarding](Application%20Workflow/onboarding-workflow.md) asks for each role's PDF, DOCX or TXT CV, saves the unchanged original in its private Documents folder, checks extraction and fills the [candidate profiles](Job%20Context/Candidate/README.md). It asks short follow-ups; you do not need to edit Markdown files.
3. Provide a job task or choose email alerts. For [AgentMail setup](automation/email/agentmail/setup.md), the agent first detects existing configured connections and reuses a suitable one. Only when none is usable does it ask for your API key in private `automation/.env`. The agent lists inboxes and asks which address to use, accepting an already supplied choice. You do not need an inbox ID or a separate skill installation. [Per-board `.env` files](Job%20Context/Job%20Boards/README.md) hold separate website login details. A manual task needs no inbox.
4. Request periodic check-ins separately when the context and access are ready.

```text
Adopt https://github.com/Aniekanetim/AI-Agent-Job-Applications as my
job-application workflow. Read AGENTS.md, SETUP.md,
unified_project_context.md, Job Context/README.md, Task Board/README.md and
Application Workflow/application-workflow.md. Preserve existing project files.
On first use, follow Application Workflow/onboarding-workflow.md. Ask for my CV
for each selected role (PDF, DOCX or TXT) unless already supplied. Save and hash
its unchanged original in that role's private Documents folder, check extraction,
reuse existing profile answers, and ask only relevant missing questions in
small batches and save my replies into the private candidate files automatically.
Resume unfinished onboarding without repeating unchanged questions. Respect a
profile-setup-only request. Use my supplied application instructions for live work.
Process job-alert emails and To Do tickets autonomously, without review gates. Reuse relevant
Site Architecture Context and its Playwright routines; discover missing or changed
steps using Application Workflow/discovery-workflow.md. Move unresolved tasks to
Blocked with the exact context file and action needed. Move only confirmed
submissions to Applied. Delete a source alert only after every vacancy in it is
accounted for under my instructions. Read automation/README.md for component requirements,
supporting utilities and scheduling.
For email-alert mode, follow automation/email/agentmail/setup.md. First detect existing
AgentMail connections, including configured skills and connected tools; reuse a suitable
connection within its permissions without copying its key. Ask for a new API key only
when none is usable. List inbox addresses and ask which to use, or verify my already
supplied address. Reuse a saved choice; never ask me to look up an inbox ID or
add a blanket account-reuse approval question.
Setup sends no mail and deletes no messages.
Do not invent candidate facts, claim unobserved submissions or activate a schedule
from this prompt alone. Keep candidate data, tickets, credentials and sessions private.
```

For URL-only adoption, forks and integration, see [use with another agent or project](SETUP.md#6-use-with-another-agent-or-project).

## What supplies work, and what explains execution

| Component | Purpose |
| --- | --- |
| [Task Board](Task%20Board/README.md) | Email Alerts and To Do are the two intake sources; Blocked and Applied retain outcomes and progress |
| [Job Context](Job%20Context/README.md) | Candidate-supplied profiles, CV references, platform access and application instructions, saved by the agent |
| [Candidate onboarding](Application%20Workflow/onboarding-workflow.md) | Conversational CV import, targeted follow-up questions and automatic private context updates |
| [Site Architecture Context](Site%20Architecture%20Context/README.md) | Agent-maintained navigation maps and Playwright TypeScript routines, including external application destinations |
| [Application workflow](Application%20Workflow/application-workflow.md) | Role selection, form completion, submission verification, blocking and resumption |
| [Discovery workflow](Application%20Workflow/discovery-workflow.md) | Learn unfamiliar or changed application steps and preserve reusable knowledge |
| [Automation components](automation/README.md) | Capability requirements, browser tooling, email integration, state helpers and optional scheduling |
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

This repository supplies conversational onboarding, the application workflow, an empty board, role/context templates, offline-tested completion rules, an AgentMail HTTP helper and TypeScript website scaffolds. An AI agent runs onboarding in its conversation and writes the files; there is no separate onboarding web app or background service. Portal-specific selectors and application routines are learned from actual access; the initial routines deliberately report that discovery is required.

Install optional TypeScript tooling with `npm ci`. `npm run check` checks types; `npm test` runs offline policy/helper checks with fake data and mocked HTTP. These commands neither log in to websites nor submit applications.

## Reuse and privacy

Fork or use this repository as a template, then create a private working copy for real candidate information. The public edition contains blank `.md` templates. Give your CV and answers to the agent; it writes ignored `*.local.md` counterparts and records the designated private CV. Direct file editing remains optional. The agent reads a local counterpart instead of its blank template, never both as competing sources. See [setup](SETUP.md#private-working-information).

Credentials, inbox progress, task tickets, application evidence, CVs and reusable browser state are excluded from Git by default. When moving machines, transfer the private working information separately and reconnect authentication. [Moving to another machine](SETUP.md#7-move-the-same-setup-to-another-machine) explains resumption.

For browser passwords, keep actual values in each board's ignored `.env`; the repository publishes only commented `.env.example` files. [Authentication setup](Job%20Context/Job%20Boards/README.md) explains the keys and runtime loading. Creating the file does not log in or establish a working site integration.

## License

[MIT license](LICENSE).
