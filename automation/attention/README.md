# Blocked-task attention

Give the user one manageable interaction: a grouped summary with one task preview and **Review next**, **Browse waiting tasks**, **Remind me later**. Browse returns ten short rows per page. Review opens one selected task and presents one verified question or human action. After their reply, offer **Continue** or **Stop for now**. A backlog of 125 tasks never becomes 125 notifications or a questionnaire.

The host agent presents these choices conversationally or through supported native controls. CLI JSON is not a delivered notification or an interactive presentation. No new task status, application worker, browser session, inbox poll or application quota is introduced.

## Default and coverage

Automatic reminders start off. `attention next` and `browse` are manual metadata views. Existing one-time human handoffs remain valid. Installations without attention files retain their behavior; reads do not create those files.

All counts cover **recorded items**, with partial coverage. Installation never scans or imports the existing Blocked folder. The agent registers a legacy task only under an actual explicit selected review request, using `register-selected`; repeat bounded registration one selected ticket at a time only if that bounded work was requested. Retain the actual request reference. Never call an absent index an empty Blocked backlog.

## Minimal private projection

`.local/attention-state.json` holds task IDs, generation identities, safe short labels, blocker types, exact canonical field bindings when applicable, selected ticket references/hashes, known priority/deadline, lifecycle events and delivery metadata. It contains no answers, CVs, form contents, email bodies, signed URLs, credentials, OTPs or session state. Keep proposal files and all runtime evidence ignored.

Generic human blockers opt in with optional `blocker.attention`:

```ts
{
  humanRequired: true,
  generation: "stable-missing-field-generation",
  kind: "answer", // answer | document | decision | login | captcha | access
  label: "Provide the missing application answer",
  // Optional actual priority/deadline and exact existing canonical Decision binding.
}
```

Do not classify every tool error as human-required. Rewording, a timestamp/context edit or a human reply does not create a new blocker generation. Pending CAPTCHA/site-access handoffs supply their existing handoff identity and a generic safe label automatically. Pure `pauseForCaptcha` / `pauseForSiteAccess` returns never register a committed attention item or send a notification.

Bind the existing active task before execution. After actually persisting a selected Blocked ticket, use `tasks refresh` with the existing task and prior ticket hash to commit its reviewed state and emit the minimal event. Use this same boundary for renewed blockers and reviewed To Do/Applied changes. Unbound legacy tickets require explicit selected registration. Supported cancel/defer/resume/restore moves and protected email pointer updates suppress/retire old items. This preserves all original IDs, source associations, CVs, checkpoints, claims and cleanup rules.

`stageAttentionChange` runs before supported lifecycle changes; staged items cannot be delivered. Promotion follows the actual core commit. Tombstones and event order prevent old blocks resurrecting after a newer decision. An index write failure retains suppression or a separate `.local/attention-health.json` quarantine. If neither can be saved before a mutation, stop that mutation and preserve its checkpoint. A post-commit reminder error never undoes the application result or triggers another submission. `status` shows pending events; `repair-selected` reconciles one explicitly selected, committed task through its actual task control. A corrupt index needs private metadata recovery before this command can run; do not discard it or scan Blocked to rebuild it.

These are separate file commits, not an atomic transaction with email/tickets. An arbitrary external rename/edit/delete can bypass event hooks. Routine queue generation can list To Do filenames to suppress matching/ambiguous moved names, without reading the old Blocked file, hashing the new file, or executing it. Explicit selected review rechecks current ownership, ticket and required context. Never add an inactive-folder watcher, execution-mirror sweep or linked-context scan to improve the count.

## One selected review

1. Under the actual user Review request, choose one indexed key. `review-next --source REF` selects the next eligible metadata row; `review --file` binds a selected key. Claim and inspect only that task. A changed file requires actual review; a requeued pointer returns selected To Do reconciliation instead of another question.
2. Inspect the actual task, its required canonical context and the current blocker/session applicability. Use `verify --file` with `{task,ticketHash,observedAt,reference,context,outcome,prompt?,decision?}`. `context` is the actual current file evidence. The agent interprets evidence; a helper cannot establish whether a natural-language answer is missing. Use `alreadySupplied` when the fact is present. Never ask from cached notification wording.
3. Present the returned one question/action in the host, then `asked --source ACTUAL_PRESENTATION_REFERENCE`. A presentation pending after interruption needs actual presentation inspection before repeating. An unchanged already presented question stays quiet. No digest rewrites every CAPTCHA/site handoff's reported flag; task-specific legacy request recording must use the existing selected task workflow only after a real presentation.
4. For a factual answer, use the [reusable answer procedure](../answers/README.md) where its field and scope can be verified. Pass the selected task's current request as `answerLookup` in `verify`. An applicable match satisfies the request and an existing pending decision keeps its original prompt. If a reply is needed, prepare the bound `ResponseBundle` and use `reply --file`. Existing revision checks save all clear additional answers and preserve onboarding history. Use `recover-response` or `reconcile-response --file .local/MERGED.json --source ACTUAL_COMPARISON_REFERENCE` for interrupted saves. Keep values in canonical private context.
5. For a human browser/access action, `human-action --source` records only that the person responded. It does not clear CAPTCHA/MFA, establish session access or confirm a submission. Use the existing exact-session and uncertain-submission procedures during authorized selected work. Do not generalize one handoff/answer to other roles, vacancies or sessions.
6. Offer Continue/Stop. `continue --source` opens one next item only after that actual choice; `stop --source` preserves the checkpoint. Saved input is muted from further missing-input reminders until selected revalidation or a genuinely renewed blocker. Keep incomplete dependencies in Blocked. After verifying every dependency for the selected ticket, use the guarded resolution move to To Do for applications or Content Creation for content. A manually moved email ticket uses `automation/email/requeue.ts`.

Settings, onboarding and attention share conversational focus. A pending settings/onboarding question suppresses automatic reminders and blocks attention questions; the user may explicitly finish/pause that flow first. Opening settings suspends attention while retaining its checkpoint. A staged canonical save must recover before focus transfer. Review never resets onboarding, changes its pause state, replaces a pending answer, or asks an already saved canonical field again. Browse/filter groups are navigation only; reuse answers only through exact canonical role/scope bindings, never heuristic bulk resolution.

## Notification controls

`.local/attention-preferences.json` is separate from `.local/operation-preferences.json`. Defaults: manual, Africa/Lagos (reuse an existing saved timezone), no queue snooze/mute. `preferences --file` merges an actual sourced choice; `snooze --until ISO_WITH_OFFSET --source REF` applies to the **whole digest**, with no replacement-task notification. `pause --source` stops reminders. Manual review remains available. Item-specific muting uses exact indexed keys in the private preference proposal. These controls never move a task to Deferred or change application limits/reporting/check-in cadence.

Settings exposes **Blocked-task reminders** within **Application limits and reporting**. The six root areas plus Close remain unchanged. The agent saves preferences with the dedicated helper, then records a focused-response reference to the canonical preference hash using the setting's `mode` field and the existing settings save flow. The user never edits JSON.

## Optional native timer and honest delivery

Do not create a timer merely to deploy this feature. Enable only after an actual user interval/timezone choice and discovery of the host's supported native automation/notification tools. Preserve host confirmations. Use a distinct notification-only schedule reference, never the application check-in reference. Run a harmless synthetic rehearsal in the actual scheduled environment before claiming timed readiness. Record `.local/attention-capability.json` with `schemaVersion:1`, exact `workingRoot`, `executionContext:"scheduled"`, `notificationOnly:true`, native `channel`, `scheduleReference`, actual `checkedAt`, `rehearsalReference` and private hashed `evidence` under `.local/attention-capability-evidence/`. Evidence and metadata cannot be links to task/context files. Interactive/offline tests do not establish readiness. No email/SMS or recruiter-correspondence fallback is configured.

The repository supplies interval windows in whole minutes and the [notification-only prompt](reminder-prompt.md); the host supplies supported timing and dispatch. Save `mode:"recurring"`, the actual `everyMinutes`, named `timezone`, separate `scheduleReference` and source only after that verification. Reconcile/disable the native timer as well when changing to manual mode; a stray callback remains quiet because manual mode cannot authorize delivery. Removing a capability or changing its evidence stops dispatch; snooze/pause remain available when that dependency fails. A timer cannot bypass snooze/pause/conversation suppression.

`delivery-prepare` coalesces the eligible queue into one notification per interval window, recording an identity before dispatch. `delivery-authorize --id` immediately rechecks the queue, lifecycle, preference and focus snapshot, then marks that one invocation dispatched. Call the actual native tool once, preserving its idempotency key if supported. `delivery-observe --file` records the actual `delivered`, `notDelivered` or `unknown` observation and reference. A pending local record is not success. Dispatched/unknown attempts suppress further sends across windows until the actual outcome is inspected. Only an uninvoked preparation may use `delivery-cancel-prepared`. An already dispatched notification cannot be retracted by a later task move; Review always revalidates the task. Do not promise exactly-once delivery without host receipts/idempotency.

Run `npm run attention -- help` for the agent-managed CLI. `npm test`, `npm run check` and `npm run build` cover synthetic behavior and regression checks without touching live tasks, sending a notification or changing a mailbox. The existing isolated browser rehearsal opens a local synthetic form with its explicit test-only headless override; it runs separately from the resource-heavy fixtures.
