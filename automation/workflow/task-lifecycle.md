# Application task lifecycle

[Blocked-task attention](../attention/README.md) is private notification metadata alongside this lifecycle. Commit new human-required blocks with the bound `refreshTaskTicket` boundary after saving the actual ticket. Move/requeue/completion helpers suppress or retire its row; interrupted projection work stays pending/quarantined. Repair one explicitly selected committed task with `attention repair-selected`; never retry an application to repair reminders. After answer recording, verify each dependency before calling the guarded unblock transition. Preserve uncertain ownership, CAPTCHA and cleanup checks.

The board has seven status folders. Email Alerts and To Do are application queues. Content Creation uses the shared lifecycle folders and its own active pickup. The containing folder is the task's status. Low priority is not a status.

Cancelled means stop pursuing the application. Deferred means set it aside until the user requeues the same ticket in To Do. Blocked still means an actual dependency prevents otherwise desired work. Applied still requires a confirmed submission. Do not automatically move legacy concluded tasks or migrate inactive ticket folders.

## Agent-managed actions

The user can say “Cancel this application”, “Defer this application”, “Resume this deferred application”, or “Restore this cancelled application”. Select only the named existing ticket. Save the actual instruction in private evidence and use `npm run tasks -- transition --file .local/decision.json`; the user does not need to edit JSON or complete a template. An applicable saved candidate rule can authorize cancellation within its actual scope. Do not fabricate a reason or add a routine approval question: an explicit request itself can supply the reason. Do not infer either decision from an email or vacancy page.

The private proposal contains:

```json
{
  "path": "Task Board/To Do/APP-example.md",
  "task": { "taskId": "APP-example", "originalIntake": "To Do", "checkpoint": "working" },
  "action": "cancel",
  "reason": "User explicitly stopped this application.",
  "actor": "user",
  "observedAt": "2026-11-06T12:00:00+01:00",
  "authority": { "path": ".local/actual-user-instruction.md", "sha256": "ACTUAL_SHA256" }
}
```

This is a synthetic shape, not a supplied instruction or evidence. Use the selected task's actual saved state and hash. Application actions are `cancel`, `defer`, `resume` (Deferred to To Do), `restore` (Cancelled to To Do) and `unblock` (verified Blocked to To Do). For unblock, save the actual selected resolved task checkpoint, then supply an authority JSON evidence reference for `{taskId,ticketSha256,resolvedAt,dependencies:[{id,evidence}]}`. Use the saved dependency IDs or `blocker` for a legacy single blocker. The same task transition reconciles protected email pointers and attention. Original source, ID, filename, role/CV references, blocker/handoff history and submission checkpoint survive. A task that never reached role/CV selection can be cancelled or deferred without invented candidate fields.

The helper owns this task's move and, for an email task, the same protected source alert. It journals source bytes, destination bytes and decision before moving. Never overwrite a destination or directly edit the inbox ledger. If another worker owns a browser action, a stop instruction becomes `requested`; it is not yet a completed move. If source cleanup is owned/pending, preserve it and reconcile that operation before recovering the move. This is distinct from `email:work native-cancel`, which cancels an email-cleanup attempt, not a job task.

`npm run tasks -- recover --task-id APP-example` resumes one interrupted move. It never scans queues. Inspect `npm run tasks -- status --task-id APP-example` for compact state. Preserve a conflicting proposal for selected-task reconciliation. A failed move is not permission to discard a source or reset an attempt.

## Pickup and execution

1. Routine intake uses `listIntakeTickets`: list Email Alerts and To Do only. Do not enumerate/read/hash Blocked, Deferred, Cancelled or Applied to look for changes. Compact alert metadata may identify waiting work without opening its inactive tickets or context. An incomplete alert with no pending vacancies returns `waiting`; retain it without repeated body reads or notifications.
2. A user-moved Deferred ticket in To Do is the pickup signal. For an email task, use `requeueMovedEmailTicket`; for a manual task, use `resumeMovedDeferredTask` or `tasks pickup --file` with `{task,path,observedAt}`. It checks the selected file against its saved hash without opening the old folder. A moved-and-edited or ambiguous ticket needs explicit reconciliation of only that selected assignment. Never create a replacement assignment.
3. Cancelled requires an explicit `restore`; a bare file move alone cannot undo cancellation. A date, human reply, timer or context edit cannot automatically resume either status.
4. Bind the selected active ticket with `bindTaskTicket(root, task, path)` or `tasks bind --file` before new browser work. Private task control is indexed by stable task ID; it stores the current path, evidence, decision history and execution checkpoint, not another independent status.
5. Save runtime changes through `recordTaskCheckpoint` / `tasks checkpoint`. Use `saveTaskTicket(root, taskId, bytes, previousHash)` / `tasks write --file` with `{taskId,content,expectedHash}` to save reviewed active-ticket text; it preserves a private prior-text snapshot and the email evidence pointer, including restored cycles whose old source is immutable. If a reviewed ticket was edited externally, or follows an existing Blocked/Applied transition, use `refreshTaskTicket(root, task, previousTicketHash, currentPath)` / `tasks refresh` after durable source-pointer reconciliation. Supply the known previous hash and only the selected current file; never use refresh to bypass Cancelled/Deferred, stop requests, active actions or uncertainty. Existing Applied artifacts remain readable without new mandatory metadata.
6. Returning to To Do queues inspection, not clearance. Verify actual vacancy availability, current candidate/CV fields, session/draft and all existing dependencies before execution. Preserve CAPTCHA/access handoffs and do not bypass them.

## Sensitive native browser actions

The agent calls browser tools; these helpers do not intercept arbitrary browser calls. Use the existing site guard together with the task protocol for credentials, upload and submission:

1. Inspect the actual current site/page/session and role/CV. `authorizeTaskAction(root, task, kind, ownerId, currentPage)` checks `assertSiteAction` and takes a native task claim across tool calls. CLI: `tasks action-authorize --file` with `{task,kind,ownerId,page}`. Preserve the private returned token.
2. For submission, call `markSubmissionAttempted(task, root, currentPage)` and persist its returned state before dispatch. It also records the attempted checkpoint for a bound task. A cached prepared object cannot override a stopped or previously attempted task.
3. Immediately before the tool invocation call `assertAuthorizedTaskAction(root, taskId, token)` / `tasks action-invoke`. It consumes the single invocation and refuses a stop request, changed ticket, unfinished move or uncertain prior action. Repeated invocation is refused.
4. Call the actual tool once, then `observeTaskAction` / `tasks action-observe --file` with `{taskId,token,result,evidence,confirmed?}`. For credentials/upload use `completed` or `unknown`; for submission use `confirmed`, `notSubmitted` or `unknown`. Evidence is the actual same-action observation. `confirmed` requires the complete matching ApplicationTask confirmation. Only actual `notSubmitted` evidence allows subsequent submission recovery.
5. `unknown` keeps the native claim and attempt. Inspect the same action and record its actual outcome with the same token; never repeat a click or release uncertainty by timeout. A safe observation releases the claim; a pending stop can then be completed with `transition`.

If cancellation arrives after final authorization/dispatch, it cannot retract an employer request. Record the stop intent, establish the real outcome and report it accurately. A confirmed application stays Applied, with the late stop preserved in history. An uncertain submission stays unresolved/Blocked with its attempt and allowance reserved. Employer withdrawal is a separate explicitly authorized operation outside this feature.

## Email completion and restoration

Cancelled and Deferred are distinct vacancy dispositions in inbox schema 3. Existing schema 2 records remain readable, and unaffected outcomes/cleanup controls are preserved when a selected transition upgrades the container. Older code must not be used to process new lifecycle records. Existing schema-1 applied/excluded outcome artifacts remain valid; cancellation outcomes use schema 2 and explicit verification.

- Deferred keeps its source unresolved. Pending/Blocked/Deferred siblings and incomplete inventories prevent cleanup.
- A Cancelled vacancy can count as concluded only with its source-bound decision, durable immutable ticket snapshot and outcome, known submission state, and `cleanupAuthority: {path,sha256}` covering cancellation under the existing selected cleanup policy. Omit that authority if unsupported/unclear: retain the alert and report the actual policy question once. Cancelling a task does not silently broaden deletion permission.
- Cancellation proof is not an application receipt, and cancelled/deferred counts never increase successful application totals. A permitted lightweight exclusion with no materialized ticket still uses `notApplicable`; existing exclusions are not relabeled.
- Source-directed completion verification may read the exact terminal evidence snapshots for the owned alert. This does not authorize scanning inactive folders or reading Blocked/Deferred tickets for changes.
- Restore before cleanup reconciles that same vacancy back to pending. Restore after completed cleanup keeps the original handled message record and cleanup receipt unchanged. The private task control records the new decision cycle and retains original provenance; immutable prior cancellation proof remains valid. Finish the restored task using its same ID/current task-control history and actual confirmation. Do not rewrite the completed source outcome, recreate its message, run cleanup again or manufacture a new manual assignment. Guarded ticket/evidence updates for this restored cycle must preserve the source's completed snapshot.

All live tickets in the six folders, task-control journals, authority evidence, sessions and source records remain private. Tests use isolated synthetic roots. No operation here schedules a run, opens a website, sends email or changes an external inbox by itself.
