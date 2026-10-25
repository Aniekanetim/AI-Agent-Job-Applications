# Job-application task board

The board says what to do. [The application workflow](../Application%20Workflow/application-workflow.md) says how to do it. [Job Context](../Job%20Context/README.md) supplies human-maintained facts and instructions.

## Folders and transitions

| Folder | Meaning | Agent action |
| --- | --- | --- |
| Email Alerts | Active vacancy tasks derived from configured job-alert messages | Claim and execute/resume |
| To Do | User-authored application tasks | Claim and execute/resume |
| Blocked | A concrete dependency prevents completion | Read linked changes/responses and resume only when resolved |
| Applied | Confirmed successful submissions | Retain outcome; do not routinely scan as an intake step |

Exactly four status folders. New work has two sources: the configured inbox and To Do. Blocked is interrupted work, not a third intake channel.

Move a confirmed submission from its intake to Applied. Move an unresolved dependency to Blocked; after resolution, return it to its recorded original intake and resume. The containing folder is status; do not maintain a conflicting second status field. A task can have a checkpoint/disposition without creating another folder.

Keep one stable descriptive ID/filename, full history and original email association through every move. For agent-created tickets, use `APP-<unique ID>-<short employer-role>` filenames; a UUID or collision-checked sequence is acceptable. A manual ticket can simply be named `task.md` and contain a job URL and instructions. The agent supplies missing operational metadata from actual context; the user need not complete every template field. Preserve a supplied filename or record an intentional descriptive rename. Check the destination and never overwrite it. Update incoming links and active message pointers after a move.

## Check-in procedure

1. Read AGENTS, private shared progress when present, the human context index and application workflow. Check the configured onboarding scope and current readiness. For a relevant setup gap, follow [onboarding](../Application%20Workflow/onboarding-workflow.md), show the remaining roadmap and preserve existing profiles, selected-board maps and unanswered questions. Keep setup-only dependencies in progress; an unrelated deferred board does not block a task on a prepared one. Check configured inbox access separately; its absence does not prevent a valid manual task.
2. Resume eligible work claimed by this worker first. Respect another worker's claim; never assume silence means its final-submit action did not occur.
3. Read each Blocked task's exact question and named source change/response. Recheck only affected dependencies, not every CV. If resolved, append the actual resolution and return it to original intake. An unchanged blocker causes no rewrite or repeated question.
4. If email intake is enabled and not explicitly deferred, verify the selected connection and paginate configured alert headers. An email deferral in `.local/email-onboarding.json` pauses intake while eligible manual/Blocked work can continue; preserve the mailbox and checkpoint. Use the private active-message map to find an existing task for this exact message/vacancy. Capture and reconcile each new alert through [its full source inventory](../automation/email/alert-completion.md), then record all distinct vacancy dispositions; do not compare across unrelated email/manual tasks or historical Applied records.
5. Select one actionable task using explicit priority, creation time, then ID. Read its complete ticket, claim and checkpoint before acting.
6. Perform the workflow autonomously. Learn missing website steps where possible; move a genuine dependency to Blocked. Save confirmation and move only actual successful submissions to Applied.
7. Update the relevant message disposition after durable task persistence. Clean up a fully handled source only through the guarded callback or native ownership procedure after verifying all source, task and confirmation files. Cleanup is independent of whether another vacancy is currently actionable.
8. Summarize meaningful applications, blockers or changes. With no actionable work or changed dependency, leave files unchanged. Do not invent a task or empty-run update.

The initial live board is empty. Directory placeholders and the template below are not tasks. Actual ticket files are ignored by Git to keep application data private.

## Blocking and resumption

A blocker states the observed issue, last completed action, exact required input/access, canonical role/platform context path, source version checked, resume checkpoint and original intake. A role mismatch points to role-routing; a mandatory missing answer points to the selected profile's application-answers; a missing CV points to its document index. A login challenge can name the platform's access-and-instructions with the human sign-in action.

The user can provide the answer in conversation or supply the required access action. The agent saves the answer in the named local context file and preserves the response source and actual resolution check on the existing ticket. Direct file editing remains optional. A context-file timestamp change alone is not resolution. If an attempted submission has an uncertain outcome, establish the result for that same vacancy before resuming any submission action.

A discoverable changed form is not automatically a user blocker. The agent investigates it through the discovery workflow. If knowledge cannot be obtained because access/tools are unavailable, state that actual dependency.

## CAPTCHA while the user is away

Follow [CAPTCHA handoff](../automation/browser/captcha-handoff.md). Save the existing task's `captchaHandoffs` and blocker, including the vacancy, role/CV identity, logical browser/session, draft and evidence references. Move it to Blocked immediately, report the actual human action once and retain its source alert. Preserve previous attempts and original intake; no new ticket or status folder is needed. Unchanged waiting tasks cause no repeated prompts, rewrites or browser interaction. Other eligible work can continue.

When the user is ready, establish ownership and let them complete the challenge in an accessible browser for this application. Readiness is not clearance. If the browser/draft expired or was headless, recover and verify the same application before presenting a fresh challenge; never promise an automatic session transfer. Verify actual human completion, challenge clearance, fields/CV and not-submitted evidence before resolving the blocker and returning to original intake. Re-review before final submission. A prior uncertain submit requires outcome investigation first; an actual matching receipt can finish the task without submitting again. Preserve the resolved handoff in Applied history. These checks use [captcha.ts](../automation/browser/captcha.ts) and the existing move guards; helpers do not move Markdown files themselves.

## Nonapplications

An email vacancy excluded under an explicit user preference, or an observed closed vacancy handled under supplied instructions, gets a compact reason and source-rule reference in that message's progress record. It does not get an Applied ticket. If it already has a ticket, preserve it in original intake with its concluded disposition and mark it nonactionable; no additional folder is introduced.

For a manual task, preserve the concluded nonapplication reason on the original ticket when user instructions permit it. If a decision is missing, move to Blocked. Do not repeatedly process a concluded task or claim it was submitted.

## Ticket template

Copy this inline format into a real To Do ticket, or create it from an alert's individual vacancy. Do not put example tickets into the live queues.

~~~markdown
# APP-<id>: <employer — role>

| Field | Actual value |
| --- | --- |
| Created / updated | <ISO date/time with timezone> |
| Original intake | Email Alerts / To Do |
| Source | <user task, or provider/account/mailbox/message/vacancy IDs; no raw body> |
| Job title / employer / listing URL | <actual details> |
| Application destination | <actual discovered URL/host; initially Unknown> |
| Priority / owner / claimed at | <actual values or Unassigned> |
| Selected role / context versions | <profile ID/path and read versions> |
| Designated CV / version / SHA-256 | <actual local reference> |
| Checkpoint / next action | <actual progress> |
| Disposition | Active / Confirmed submission / permitted nonapplication / Uncertain |
| Website knowledge / routine version | <actual map/code references> |

## Application details
<Essential job criteria, selected-profile rationale and actual permitted actions.
Link sources; do not copy the complete CV or email.>

## Progress and attempts
<Append dates, actor, actions, current page, prepared/submission-attempted checkpoints
and actual responses. Do not claim a final result from a click alone.>

## Blocker and response
<None, or issue; last completed step; required input; exact local context path;
checked version; question; resume checkpoint. Append actual user response,
resolution check and cleared dependency without deleting prior history.>

## Submission evidence
<Not submitted, uncertain, or actual candidate/vacancy confirmation, reference,
submission time and retained evidence location. Include the Applied task path
once saved.>

## Source-alert cleanup
<Not applicable for manual tasks, or source message, enumeration/disposition
reference, cleanup state/date. Do not delete while sibling vacancies are unresolved.>
~~~

## Browser checkpoint fields

Extend the existing ticket's private execution checkpoint with the saved default browser, active browser and whether upload is required. For a midway upload handoff, retain the same task ID, source/vacancy identity, selected role/CV versions, draft identity when visible, last completed step, checkpoint evidence, handoff time/state and actual resume checks. Keep signed URLs, credentials and OTPs out of the ticket.

Follow [the handoff procedure](../automation/browser/upload-fallback.md): establish the authorized Playwright session and same draft before resuming. Keep that application in Playwright; a new task returns to the saved default. Never switch or retry while a prior submission is uncertain. Preserve handoff history through Blocked and Applied. The board still has exactly four status folders.

Use the selected role's verification-access reference when a challenge needs help, and preserve the same checkpoint while waiting. Apply saved operating limits and reporting preferences during each check-in. Neither a missing in-app capability nor a document-format issue creates a new intake source or routine approval gate.

## Email source and cleanup references

Email-derived tasks retain the provider, stable account/mailbox identity, native message ID, vacancy key and shared message-record reference. Labels, thread IDs and connector sessions are not substitutes for that identity. The user-selected source may be Gmail, Outlook, AgentMail or another available harness connection. Never switch it silently.

An email-derived Applied ticket includes the structured binding described in [alert completion](../automation/email/alert-completion.md#3-persist-a-job-specific-outcome), alongside its readable history. Save the distinct task, job-specific confirmation and outcome file hashes in its source-message record. Do not reuse another posting's task/receipt or infer completeness from a counter.

A confirmed application stays Applied even when source-email cleanup is pending. Work saves and artifact commits respect the cleanup owner. Keep a rejected work proposal private for later reconciliation; do not reset cleanup state or move a confirmed application back into intake. Message recovery belongs to its existing progress record, with no additional board folder. Delete/archive/label/retain handling is recorded on the source message after all vacancies are resolved. Retain mode keeps a compact handled marker without changing the inbox. Non-alert messages get no application ticket or Applied outcome; verification/receipt use remains possible under the current task's authorized scope. See [shared email processing](../automation/email/README.md#email-processing-and-cleanup).
