# AI Agent Job Applications

A portable, autonomous job-application workflow. Job-alert emails and manual tickets supply work. Self-contained candidate role profiles supply the facts and instructions. The agent reuses learned website navigation, discovers unfamiliar steps, submits applications and records confirmed outcomes.

An alert may contain several jobs. The agent [accounts for every posting](automation/email/alert-completion.md), saves each outcome and keeps the email while any job is unresolved. Verified completion permits only the selected email-handling action. The same protected store guards progress updates and cleanup attempts, so an ordinary save cannot erase pending recovery.

Onboarding uses [one focused question at a time](automation/onboarding/focused-conversation.md), automatically saving any additional answers you volunteer. Say “Continue onboarding” after an interruption, or “Change my settings” at any time. The agent [continues the saved step or updates the requested setting](automation/onboarding/settings.md), preserving the rest of your setup. Playwright opens a visible browser by default so you can watch it work.

A CAPTCHA pauses the existing application in **Blocked** for [human completion](automation/browser/captcha-handoff.md). If you are away, the agent saves the checkpoint, reports the blocker once and continues other eligible work. When you return, it verifies the same application and resumes; browser sessions and drafts may need recovery. It does not solve CAPTCHAs automatically.

**Version:** 1.15.0 — 26 October 2026. **State:** unconfigured reusable package. No inbox connected, role enabled, live application submitted or schedule activated. Job-board maps start as unlearned templates. The Tezza example records a limited public form/CAPTCHA boundary; no complete employer integration is claimed.

[Use this template](https://github.com/Aniekanetim/AI-Agent-Job-Applications/generate) · [Fork](https://github.com/Aniekanetim/AI-Agent-Job-Applications/fork) · [Setup](SETUP.md)

## Start here

1. Give a file- and browser-capable agent the adoption prompt below. It opens or creates a private working copy and shows the onboarding roadmap before starting.
2. Choose profile setup, manual applications, email-alert applications or both sources. For application setup, choose one to three primary job boards: one required and two optional. Another website can still be used later for an assigned task.
3. Choose automatic, in-app or Playwright browser use. The agent respects that default and prepares Playwright for applications requiring file upload. It imports each selected role's PDF, DOCX or TXT CV, saves its unchanged original and asks one focused follow-up at a time, saving extra details you volunteer without asking you to repeat them. It saves answers privately; you do not need to edit Markdown.
4. It connects the selected websites and asks you to **Connect your email** when email intake is selected. [Email setup](automation/email/README.md) shows **Google — Gmail / Google Workspace** first, followed by available Outlook and other discovered services, optional AgentMail and **Set up email later**. It reuses existing connections or guides sign-in, then lets you choose the account. A manual task needs no alert inbox. Website passwords stay in the board's private configuration.
5. It maps the selected boards' vacancy and application routes, records shared journey knowledge and observed methods for the selected browser and upload fallback and identifies unvisited branches. Progress is visible per step and per board. It submits no practice application.
6. A final [readiness check](automation/onboarding/README.md) covers actual browser capabilities, upload-ready CVs, application-email verification access and operating preferences. Choose how often to check for work—such as hourly, daily or a custom supported interval—or use on-demand checks; the agent reports what is ready and how to start.

```text
Adopt https://github.com/Aniekanetim/AI-Agent-Job-Applications as my
job-application workflow. Read AGENTS.md, SETUP.md,
unified_project_context.md, Job Context/README.md, Task Board/README.md and
Application Workflow/application-workflow.md. Preserve existing project files.
On first use, follow Application Workflow/onboarding-workflow.md. Establish the scope
and show a progress roadmap before setup. For application mode, reuse or ask for one
to three primary boards and my default browser: automatic, in-app or Playwright.
Respect an in-app choice; prepare Playwright for every application requiring a file
upload without changing that default. Prepare the selected tools using
automation/browser/README.md before account connection and discovery. Ask for my CV
for each selected role (PDF, DOCX or TXT) unless already supplied. Save and hash
its unchanged original in that role's private Documents folder, check extraction,
reuse existing profile answers, and follow automation/onboarding/focused-conversation.md.
Ask one focused missing decision per turn. Save every clear additional answer I
volunteer, including later stages, before asking the next question. Keep one active
question across subflows; preserve clarification history and recover interrupted
saves. Show brief stage/substep progress, respect pause/resume and optional
deferrals, and save my replies into private candidate files automatically.
On an explicit request to continue onboarding, use onboarding:resume with the actual
request reference and act on its returned question or preparation checkpoint.
Otherwise keep unchanged scheduled questions quiet. Support later settings changes
under automation/onboarding/settings.md, preserving unrelated setup. Use visible
headed Playwright by default; headless requires an explicit choice. Include initial
site mapping for selected boards and encountered destinations, with Markdown and
tool-specific observed methods. Establish application-email verification access
by reusing the selected email connection when it receives those codes; ask about
other access only when needed. Check upload-ready CV formats while preserving
originals. Ask for my task-board check-in interval or on-demand choice, then offer
optional application limits and reporting choices.
Keep unvisited branches explicit and submit no practice application.
Use automation/onboarding/README.md for progress and final readiness.
Explain prepared boards, remaining dependencies and the first task at handoff. Respect a
profile-setup-only request. Use my supplied application instructions for live work.
Process job-alert emails and To Do tickets autonomously, without review gates. Reuse relevant
Site Architecture Context and the selected browser methods; discover missing or changed
steps using Application Workflow/discovery-workflow.md. Move unresolved tasks to
Blocked with the exact context file and action needed. Follow
automation/browser/captcha-handoff.md for CAPTCHA: save the same application,
report the human step once and wait without repeated prompts if I am away.
Preserve the source email. Verify actual clearance and same-vacancy draft/session
before resuming; never solve a CAPTCHA automatically or change tools to evade it.
Move only confirmed
submissions to Applied. Handle a fully completed alert using my selected supported
delete, archive, label or retain mode only after automation/email/alert-completion.md
reconciles every posting, saved task and confirmation. Hold exclusive per-alert
ownership through cleanup, including native email-tool execution.
Read automation/README.md for component requirements,
supporting utilities and scheduling.
For email-alert mode, follow automation/email/README.md. Detect actual available
providers through this harness's directory and actual tools; follow
automation/email/host-connectors/discovery.md. Preserve saved choices. For a new
setup, show Connect your email with Google first, available Outlook/other services,
optional AgentMail and Set up email later. Distinguish provider availability,
account authentication and actual readiness. Guide native connection when needed;
save the checkpoint before a sign-in handoff. Show accessible addresses and ask
which to use, or verify my supplied choice. Reuse an existing authorized connection;
do not require AgentMail when Gmail or another suitable connection is available.
Offer AgentMail only when needed or preferred. Save connection references, not copied
keys/tokens. Establish alert scope, read/pagination access and my completed-alert
handling choice. Verify the actual scheduled environment for recurring checks.
Preserve non-alert correspondence and keep lightweight handled/classification
markers so retained messages do not create another application. Never use thread-wide
cleanup, bypass tool denials or claim live access from mocked tests.
An explicit email deferral pauses email intake and preserves its checkpoint;
continue eligible manual work without claiming both-source readiness. Do not
switch a saved account merely because a new provider is available.

Setup sends no mail and deletes no messages.
Do not invent candidate facts, claim unobserved submissions or activate a schedule
without my explicit recurring choice and its readiness checks.
Keep candidate data, tickets, credentials and sessions private.
```

For URL-only adoption, forks and integration, see [use with another agent or project](SETUP.md#6-use-with-another-agent-or-project).

## What supplies work, and what explains execution

| Component | Purpose |
| --- | --- |
| [Task Board](Task%20Board/README.md) | Email Alerts and To Do are the two intake sources; Blocked and Applied retain outcomes and progress |
| [Job Context](Job%20Context/README.md) | Candidate-supplied profiles, CV references, platform access and application instructions, saved by the agent |
| [Candidate onboarding](Application%20Workflow/onboarding-workflow.md) | Visible, resumable setup: tools, role profiles, selected boards, mapping and readiness |
| [Site Architecture Context](Site%20Architecture%20Context/README.md) | Agent-maintained shared navigation maps, host-browser actions and Playwright TypeScript routines, including external application destinations |
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

A source email can contain several vacancies. The agent keeps one small progress record for that email, including vacancies excluded by an explicit candidate rule. It performs only the selected completed-alert action after all relevant vacancies have permitted persisted outcomes. Retain mode keeps the message and a local handled marker. An unfinished or blocked application keeps its alert available. No routine comparison across email tasks, manual tasks and historical applications is required.

## Available now and learned later

This repository supplies conversational onboarding with saved step/board progress, the pinned Playwright CLI and browser setup/check utility, readiness helpers, the application workflow, an empty board, role/context templates, completion rules, shared email policies, a host-connector adapter contract and an AgentMail HTTP helper, and TypeScript website scaffolds. An AI agent runs onboarding in its conversation and writes the files; there is no separate onboarding web app or background service. Portal-specific selectors and application routines are learned from actual access; the initial routines deliberately report that discovery is required.

The agent installs local tooling with `npm ci`, then prepares and verifies the browser using [browser setup](automation/browser/README.md). `npm run check` checks types; `npm test` checks policies and utilities with synthetic data and mocked HTTP. Browser readiness is established separately through actual tool interaction: a synthetic Playwright form/upload/recovery rehearsal and, when selected, a distinct host-browser capability check. These checks log in to no websites and submit no applications.

## Reuse and privacy

Fork or use this repository as a template, then create a private working copy for real candidate information. The public edition contains blank `.md` templates. Give your CV and answers to the agent; it writes ignored `*.local.md` counterparts and records the designated private CV. Direct file editing remains optional. The agent reads a local counterpart instead of its blank template, never both as competing sources. See [setup](SETUP.md#private-working-information).

Credentials, inbox progress, task tickets, application evidence, CVs and reusable browser state are excluded from Git by default. When moving machines, transfer the private working information separately and reconnect authentication. [Moving to another machine](SETUP.md#7-move-the-same-setup-to-another-machine) explains resumption.

For browser passwords, keep actual values in each board's ignored `.env`; the repository publishes only commented `.env.example` files. [Authentication setup](Job%20Context/Job%20Boards/README.md) explains the keys and runtime loading. Creating the file does not log in or establish a working site integration.

## Browser preference and upload handling

An in-app default stays in-app for tasks without uploads. A known upload requirement starts that application in Playwright. A requirement discovered midway triggers a [saved handoff](automation/browser/upload-fallback.md) of the same task and draft, followed by separate authentication and draft checks. That application finishes in Playwright; the next uses the saved default. An uncertain submission is investigated before a switch or retry.

Selected-site mapping covers observed routes and recorded boundaries. It does not claim every employer form is known. Unsupported features, access denials and unverified capabilities are reported distinctly. See [browser setup](automation/browser/README.md), [verification-email access](automation/email/verification/README.md) and [optional scheduling](automation/scheduling/README.md).

## License

[MIT license](LICENSE).
