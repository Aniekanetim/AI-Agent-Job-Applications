# AI Agent Job Applications

A portable, autonomous job-application workflow. Job-alert emails and manual tickets supply work. Self-contained candidate role profiles supply the facts and instructions. The agent reuses learned website navigation, discovers unfamiliar steps, submits applications and records confirmed outcomes.

**Version:** 1.8.0 — 24 October 2026. **State:** unconfigured reusable package. No inbox connected, role enabled, live application submitted or schedule activated. Website maps are unlearned templates, not verified integrations.

[Use this template](https://github.com/Aniekanetim/AI-Agent-Job-Applications/generate) · [Fork](https://github.com/Aniekanetim/AI-Agent-Job-Applications/fork) · [Setup](SETUP.md)

## Start here

1. Give a file- and browser-capable agent the adoption prompt below. It opens or creates a private working copy and shows the onboarding roadmap before starting.
2. Choose profile setup, manual applications, email-alert applications or both sources. For application setup, choose one to three primary job boards: one required and two optional. Another website can still be used later for an assigned task.
3. The agent prepares the bundled Playwright CLI/browser, imports each selected role's PDF, DOCX or TXT CV, saves its unchanged original and asks short follow-up questions. It saves answers privately; you do not need to edit Markdown.
4. It connects the selected websites and, when selected, the email inbox. [AgentMail setup](automation/email/agentmail/setup.md) detects existing access first, lists inboxes and accepts your choice. A manual task needs no inbox. Website passwords stay in the board's private configuration.
5. It maps the selected boards' vacancy and application routes, records observed Playwright methods and identifies unvisited branches. Progress is visible per step and per board. It submits no practice application.
6. A final [readiness check](automation/onboarding/README.md) explains what is prepared, any explicit deferrals and how to start. Request periodic check-ins separately when wanted.

```text
Adopt https://github.com/Aniekanetim/AI-Agent-Job-Applications as my
job-application workflow. Read AGENTS.md, SETUP.md,
unified_project_context.md, Job Context/README.md, Task Board/README.md and
Application Workflow/application-workflow.md. Preserve existing project files.
On first use, follow Application Workflow/onboarding-workflow.md. Establish the scope
and show a progress roadmap before setup. For application mode, reuse or ask for one
to three primary boards. Prepare the pinned CLI and browser using
automation/browser/README.md before account connection and discovery. Ask for my CV
for each selected role (PDF, DOCX or TXT) unless already supplied. Save and hash
its unchanged original in that role's private Documents folder, check extraction,
reuse existing profile answers, and ask only relevant missing questions in
small batches and save my replies into the private candidate files automatically.
Resume unfinished onboarding without repeating unchanged questions. Include initial
site mapping for selected boards and encountered destinations, with Markdown and
observed Playwright methods. Keep unvisited branches explicit and submit no practice
application. Use automation/onboarding/README.md for progress and final readiness.
Explain prepared boards, remaining dependencies and the first task at handoff. Respect a
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
| [Candidate onboarding](Application%20Workflow/onboarding-workflow.md) | Visible, resumable setup: tools, role profiles, selected boards, mapping and readiness |
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

This repository supplies conversational onboarding with saved step/board progress, the pinned Playwright CLI and browser setup/check utility, readiness helpers, the application workflow, an empty board, role/context templates, completion rules, an AgentMail HTTP helper and TypeScript website scaffolds. An AI agent runs onboarding in its conversation and writes the files; there is no separate onboarding web app or background service. Portal-specific selectors and application routines are learned from actual access; the initial routines deliberately report that discovery is required.

The agent installs local tooling with `npm ci`, then prepares and verifies the browser using [browser setup](automation/browser/README.md). `npm run check` checks types; `npm test` checks policies and utilities with synthetic data and mocked HTTP. Browser readiness is established separately by actual CLI interaction with a local page. These checks log in to no websites and submit no applications.

## Reuse and privacy

Fork or use this repository as a template, then create a private working copy for real candidate information. The public edition contains blank `.md` templates. Give your CV and answers to the agent; it writes ignored `*.local.md` counterparts and records the designated private CV. Direct file editing remains optional. The agent reads a local counterpart instead of its blank template, never both as competing sources. See [setup](SETUP.md#private-working-information).

Credentials, inbox progress, task tickets, application evidence, CVs and reusable browser state are excluded from Git by default. When moving machines, transfer the private working information separately and reconnect authentication. [Moving to another machine](SETUP.md#7-move-the-same-setup-to-another-machine) explains resumption.

For browser passwords, keep actual values in each board's ignored `.env`; the repository publishes only commented `.env.example` files. [Authentication setup](Job%20Context/Job%20Boards/README.md) explains the keys and runtime loading. Creating the file does not log in or establish a working site integration.

## License

[MIT license](LICENSE).
