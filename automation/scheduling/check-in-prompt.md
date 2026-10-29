# Agent check-in prompt

Replace WORKING_ROOT with the actual private copy location when configuring a scheduler. The user-selected task-board check-in interval and timezone are configured in the native scheduler. Each default run covers Email Alerts and To Do only, including existing tickets the user requeued in To Do. This prompt alone activates nothing.

~~~text
Work in WORKING_ROOT.
Before using an assigned website, follow automation/sites/README.md: distinguish
tracking/provider hops from boards and employer tenants, adopt/create missing private
context, and bind the task to observed site/browser/session. Keep encountered sites
separate from primary onboarding boards. Use existing details to exclude clearly
unsuitable work before mapping/login. Validate actual access before credentials,
upload and submission with the shared site-action helpers. A new context file or
hash change does not clear a saved challenge. Early pre-profile access handoffs
remain Blocked without invented role/CV. Preserve all claims and protected alert
artifacts; native browser tools follow the same prepare/observe/validate contract.
Read AGENTS.md, SETUP.md, the local shared-progress counterpart when present,
Job Context/README.md, Task Board/README.md, automation/README.md and
Application Workflow/application-workflow.md. Follow the candidate's supplied
application instructions without routine review gates.

For missing candidate setup, follow Application Workflow/onboarding-workflow.md.
Reuse supplied CVs and populated private profiles. Ask only relevant missing
one focused missing decision per turn. Follow automation/onboarding/focused-conversation.md:
read the whole reply, save every clear extra answer in its correct canonical file,
and recover retained responses before asking again. Keep one active question across
subflows. Respect pause/resume and optional deferrals; a paused or already presented
unanswered question stays quiet. Save actual replies into canonical *.local.md files.
Use onboarding:resume only for an actual user request to continue, and act on its
question or saved preparation action. Do not invent that request in an unattended
run. Later changes follow automation/onboarding/settings.md. Playwright is headed
by default; report an inaccessible desktop rather than silently choosing headless.
If a role has no CV, request its PDF, DOCX or TXT file, save the unchanged original
in that role's private Documents folder and verify the hash and extraction.
Read .local/onboarding-state.json and automation/onboarding/README.md when present.
Resume schema-3 steps, preparation and per-board mapping; migrate schema 1/2 without losing any
supplied context or questions. Show the remaining roadmap during interactive setup,
not an unchanged notification every check-in. Application setup requires one to
three user-selected primary boards; accept an existing choice. Prepare and verify
the selected default browser and Playwright upload fallback under
automation/browser/README.md before website work. Never infer a browser preference
from installed tools. Read actual operating limits and reporting choices.
Initial discovery records navigation, application entry, accessible forms, code and
limits without practice submission. Do not treat login as complete mapping or invent
observations. Verify changed evidence/runtime before claiming readiness and provide
the scoped handoff. Keep setup-only blockers in onboarding progress, with no fake ticket.
Do not repeat unchanged pending
questions or reset existing profiles. Keep progress references separate from answers.
Profile setup or a manual task does not require inbox configuration. Onboarding
does not itself authorize a live application or activate a schedule.
For email mode, follow automation/email/README.md. Detect actual available host email
tools and saved selections first. Use the user's selected Gmail, Outlook, AgentMail
or other account; a suitable existing connection needs no new AgentMail setup.
Present addresses and accept a supplied or saved confirmed choice without asking
again. Save references, not copied credentials. Establish scope and supported
delete/archive/label/retain handling. Preserve native permissions and confirmations.
Verify full message access/pagination and the actual scheduled connection before
claiming recurring readiness. Setup sends or modifies no mail.
Resume unchanged setup dependencies only after a relevant change.
For a new interactive email setup, follow automation/email/host-connectors/discovery.md
and show Connect your email with Google first. Provider catalog availability is not
authentication or readiness. Preserve .local/email-onboarding.json checkpoints.
If email is explicitly deferred, do not read alerts or repeat the provider question;
continue authorized eligible To Do tasks. Keep email
readiness unfinished and preserve the selected mailbox and its pending work.

Resume eligible claimed work in Email Alerts and To Do only. Do not list, read,
hash or inspect linked context for Blocked tasks in routine check-ins. Review
Blocked only when the human explicitly asks; review or a context edit does not
automatically requeue a task. The user moves the existing ticket to To Do after
resolving the blocker. That move is the pickup signal. Read only that selected
task's required context, preserve its checkpoint and original source, and verify
actual dependency resolution before sensitive actions. For a selected email-derived
To Do ticket, use automation/email/requeue.ts to reconcile the existing source
pointer. Never create a second manual assignment or clear a CAPTCHA/uncertain
submission merely because a ticket moved. Reconcile edited moved tickets within
that selected task; do not scan other Blocked files.
Check To Do and the configured job-alert inbox, paginating metadata and preserving
active message-to-vacancy/task associations. Do not compare unrelated email/manual
tasks or scan historical Applied files. Do not reread a previously parsed body
when its active progress record supplies the unfinished tasks.

Select an enabled role using role routing, then read only that self-contained
profile, designated upload CV and verification-access instructions. Reuse the saved
email connection and mailbox selection when they are also the verification
destination; do not repeat mailbox setup. A different address or non-email MFA
may need its own existing access or a specific human handoff. Reuse relevant
Site Architecture Context and methods for the active browser. Keep an in-app default;
start required-upload applications in Playwright. For uploads discovered midway,
follow automation/browser/upload-fallback.md on the same task and verify its
authorized session and draft before resuming. Never switch or retry an uncertain
submission, and never evade an access denial. Discover unfamiliar/changed application steps within the configured
instructions; maintain Markdown and TypeScript knowledge from actual observation.
Never invent candidate facts or claim an unlearned flow works.

For CAPTCHA, follow automation/browser/captcha-handoff.md. Preserve the same task,
role/CV, browser/session and draft checkpoint; move the task to Blocked immediately
and record the actual human request once through the configured reporting route.
If the user is away, wait without repeated prompts or unchanged writes and continue
independent eligible work. Retain the source alert. Human readiness is not clearance.
After the user returns, verify actual challenge completion, current fields/CV,
session/vacancy and submission outcome; recover expired or headless/inaccessible
sessions explicitly. Do not solve CAPTCHA automatically, change browsers to evade
it or steal an active worker's browser. Recheck any known challenge immediately
before submitting and use markSubmissionAttempted(task, root, currentPage). Preserve uncertainty after an
attempted submit and investigate its result before another action. Helpers do not
send notifications or keep a browser alive indefinitely.

Save checkpoints before submission. Confirm the actual outcome before moving a
task to Applied. For an uncertain submit, establish this same vacancy's result
rather than submitting again. Move concrete dependencies to Blocked with the
last completed step, exact context path/question and resumption action. Do not
require the user to edit files: save their conversational reply, verify the
dependency and resume. Do not repeat unchanged questions or ask for per-application approval.

Follow automation/email/alert-completion.md. Capture the full source privately,
reconcile all links/postings and save distinct task/outcome/confirmation evidence
with hashes. Never trust an enumeration Boolean or callback alone. Use
cleanupCompletedAlert for callbacks, or email:work native-prepare/authorize/observe
for native tools. Hold the per-message claim through result persistence. All work/bulk/migration
writes use the protected alert store. Stage canonical artifact changes privately
and commit them with email:work artifact. Do not overwrite owned evidence or
reset cleanup controls through ordinary saves. Preserve refused proposals.
Unknown outcomes remain pending; use dedicated cancellation only before an
invocation or after actual current-round not-applied confirmation. Retain the
cancelled attempt history and existing confirmed application identities.
Selected connection/cleanup settings cannot change during pending work. Respect
active owners; never steal a native claim because a CLI exited or time passed.
Resume saved owned checkpoints and inspect an uncertain exact-message outcome
before cleanup-only retry. Independent machines require shared coordination or
one active deployment. Perform only the selected supported message-level action,
or retain with a local handled marker. Preserve non-alert correspondence and cached classifications. Incomplete extraction, active or
blocked vacancies keep the alert. Retry failed cleanup without reapplying.
Keep credentials, personal data, browser state, tickets and inbox progress private.
Respect other workers' claims and preserve task history through moves.

Update shared progress only for material changes. With no actionable or changed
work, leave files unchanged. Apply saved operating limits and reporting mode. Report meaningful confirmed
applications, new blockers or required actions; do not invent execution or create empty-run updates.
~~~

While an interactive settings menu is open, preserve its checkpoint and leave its unchanged question quiet. Do not open or answer it on the user's behalf. Its saved settings still use the existing eligibility, active-task and pending-cleanup rules.
