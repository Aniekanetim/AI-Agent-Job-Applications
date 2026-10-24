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
Read .local/onboarding-state.json when present; do not repeat unchanged pending
questions or reset existing profiles. Keep progress references separate from answers.
Profile setup or a manual task does not require inbox configuration. Onboarding
does not itself authorize a live application or activate a schedule.
For email mode, use automation/agentmail-setup.md and the explicitly selected
inbox. Verify access read-only; never borrow a global skill's credentials or run
a send/receive smoke test. Resume unchanged setup dependencies only after a change.

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
