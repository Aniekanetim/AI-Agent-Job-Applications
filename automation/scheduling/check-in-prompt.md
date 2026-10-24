# Agent check-in prompt

Replace WORKING_ROOT with the actual private copy location when configuring a scheduler. Cadence is configured separately. This prompt alone activates nothing.

~~~text
Work in WORKING_ROOT.
Read AGENTS.md, SETUP.md, the local shared-progress counterpart when present,
Job Context/README.md, Task Board/README.md, automation/README.md and
Application Workflow/application-workflow.md. Follow the candidate's supplied
application instructions without routine review gates.

For missing candidate setup, follow Application Workflow/onboarding-workflow.md.
Reuse supplied CVs and populated private profiles. Ask only relevant missing
questions in small batches and save actual replies into canonical *.local.md files.
If a role has no CV, request its PDF, DOCX or TXT file, save the unchanged original
in that role's private Documents folder and verify the hash and extraction.
Read .local/onboarding-state.json and automation/onboarding/README.md when present.
Resume schema-2 steps and per-board mapping; migrate schema 1 without losing any
supplied context or questions. Show the remaining roadmap during interactive setup,
not an unchanged notification every check-in. Application setup requires one to
three user-selected primary boards; accept an existing choice. Prepare and verify
the pinned local CLI/browser under automation/browser/README.md before website work.
Initial discovery records navigation, application entry, accessible forms, code and
limits without practice submission. Do not treat login as complete mapping or invent
observations. Verify changed evidence/runtime before claiming readiness and provide
the scoped handoff. Keep setup-only blockers in onboarding progress, with no fake ticket.
Do not repeat unchanged pending
questions or reset existing profiles. Keep progress references separate from answers.
Profile setup or a manual task does not require inbox configuration. Onboarding
does not itself authorize a live application or activate a schedule.
For email mode, use automation/email/agentmail/setup.md. Detect existing configured
AgentMail integrations and connected tools before asking for a key. Reuse suitable
authorized access through its existing source; save references, not copied secrets.
Respect actual access restrictions and verify access; detection alone is not readiness.
At first mailbox setup, list addresses and ask which inbox to use; accept a supplied
address and reuse a saved confirmed choice without asking again. Do not add a
blanket account-reuse approval question based on a skill's QA-oriented wording.
Only if no usable integration exists should onboarding request an API key. Discover
and bind the inbox without asking for its ID. Send/delete no mail during setup.
Resume unchanged setup dependencies only after a relevant change.

Resume eligible claimed work. Check Blocked tasks for actual answers/context
changes that resolve the named dependency; return resolved tasks to original intake.
Check To Do and the configured job-alert inbox, paginating metadata and preserving
active message-to-vacancy/task associations. Do not compare unrelated email/manual
tasks or scan historical Applied files. Do not reread a previously parsed body
when its active progress record supplies the unfinished tasks.

Select an enabled role using role routing, then read only that self-contained
profile and designated CV. Reuse relevant Site Architecture Context and Playwright
routines. Discover unfamiliar/changed application steps within the configured
instructions; maintain Markdown and TypeScript knowledge from actual observation.
Never invent candidate facts or claim an unlearned flow works.

Save checkpoints before submission. Confirm the actual outcome before moving a
task to Applied. For an uncertain submit, establish this same vacancy's result
rather than submitting again. Move concrete dependencies to Blocked with the
last completed step, exact context path/question and resumption action. Do not
require the user to edit files: save their conversational reply, verify the
dependency and resume. Do not repeat unchanged questions or ask for per-application approval.

After durable Applied records and all permitted vacancy dispositions exist,
delete only the fully handled source message. Incomplete extraction, active or
blocked vacancies keep the alert. Retry failed cleanup without reapplying.
Keep credentials, personal data, browser state, tickets and inbox progress private.
Respect other workers' claims and preserve task history through moves.

Update shared progress only for material changes. With no actionable or changed
work, leave files unchanged. Report meaningful confirmed applications, new blockers
or required actions; do not invent execution or create empty-run updates.
~~~
