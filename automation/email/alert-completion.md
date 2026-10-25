# Complete every vacancy before handling its source email

One alert is a container; each distinct posting is an assignment. An alert with four postings needs four recorded outcomes before its selected delete, archive, label or retain action is eligible. A successful first application never closes its siblings.

This procedure is for the agent. The user supplies application instructions through onboarding; they do not prepare JSON or inspect receipt hashes.

## 1. Capture the actual complete message

Read the exact selected account/mailbox/message through its authorized tool. Stage the returned HTML and/or text in an ignored proposal file, then commit the source capture to `.local/alerts/<message-key>/source.json` through the guarded artifact command below. Use this shape:

```json
{
  "schemaVersion": 1,
  "messageKey": "<messageKey(identity), a SHA-256 value>",
  "completeness": "full",
  "observedAt": "<actual ISO time>",
  "toolReference": "<actual message-content tool observation>",
  "html": "<unaltered full returned HTML>",
  "text": "<unaltered full returned text, when available>"
}
```

Use `full` only after checking the tool's response and any content pagination. A snippet, clipped tool output or incomplete body is `truncated` or `unknown`; retrieve the missing content before continuing. Preserve the underlying tool observation privately. Do not reconstruct an email from its headline or copy only the jobs already processed. The source hash detects later changes; it cannot prove that a provider returned untruncated content or that a human/agent interpretation is correct.

Classify/save the source message before committing its artifacts. Stage the source as `.local/proposals/MESSAGE_KEY-source.json`, then commit it without replacing an unexpected existing file:

```shell
npm run email:work -- artifact --message-key MESSAGE_KEY --file .local/proposals/MESSAGE_KEY-source.json --destination .local/alerts/MESSAGE_KEY/source.json --expected-sha absent
```

For an intentional revision, supply the current SHA-256 instead of `absent`. A rejected proposal remains intact. Use this command for canonical source, outcome, confirmation and ticket files; do not overwrite bound artifacts directly. A task path must be associated with this alert before its ticket is written. Evidence paths stay within this message's namespace. These are file-ownership checks, not historical vacancy duplicate screening.

Create a link inventory from the saved content:

```shell
npm run email:work -- inventory --source .local/alerts/MESSAGE_KEY/source.json
```

Save the returned inventory as `.local/proposals/MESSAGE_KEY-inventory.json`. The parser includes HTML link attributes and plaintext URLs, including duplicate title/Apply links and navigation links. It does not follow URLs or declare them to be vacancies automatically.

## 2. Account for every source link

Inspect the inventory against the rendered full email. For each candidate, record one decision:

| Kind | Required information |
| --- | --- |
| `posting` | Stable vacancy key, observed HTTPS posting URL and evidence file/hash |
| `navigation` | Observed reason the link is not a vacancy, plus evidence file/hash |
| `unresolved` | Leave unresolved until its purpose/destination can be established |

Two links leading to the same posting use the same vacancy key and observed posting URL. Different posting IDs remain different jobs. Do not remove query parameters or fragments indiscriminately: they may identify the vacancy. A tracking/relative link needs a saved destination observation containing its exact `sourceHref`, resolved `postingUrl` and actual `observedAt`. Reference that file's SHA-256. For a direct posting link, the source capture can supply the link evidence.

Do not call a link navigation merely because it has not been explored. “View all jobs” or another ambiguous listing route stays unresolved until the alert's assigned postings are accounted for. A headline such as “22 jobs” is a useful discrepancy signal; it is not the authoritative posting inventory. If the rendered content and extracted links disagree, preserve the alert and resolve the discrepancy. Do not broaden an alert into an unlimited search of the entire website.

Save/reconcile the completed inventory:

```shell
npm run email:work -- reconcile --message-key MESSAGE_KEY --inventory .local/proposals/MESSAGE_KEY-inventory.json
```

This re-parses the hashed full source, rejects omitted or unresolved candidates and creates a pending progress entry for each distinct posting. Existing task IDs and confirmed outcomes are preserved. Save each task association before working on that application. After an interruption, resume these same associations instead of extracting new tasks.

## 3. Persist a job-specific outcome

Follow the application workflow for each posting. Save the intended ticket-path association before creating or moving the ticket. Commit staged confirmation, outcome and ticket files through the guarded artifact command, complete the move, then mark the vacancy applied. Keep its disposition pending until the actual confirmation and Applied ticket are durably saved. The existing Markdown ticket includes one structured record, emitted by `taskRecordBlock` in [verification.ts](verification.ts):

~~~markdown
<!-- job-application-record -->
```json
{
  "schemaVersion": 1,
  "messageKey": "<source message key>",
  "vacancyKey": "<this posting's key>",
  "postingUrl": "<this posting's observed URL>",
  "task": {
    "taskId": "<this ticket's stable ID>",
    "originalIntake": "Email Alerts",
    "selectedRoleId": "<actual selected profile>",
    "cvVersion": "<actual uploaded version>",
    "cvSha256": "<actual document SHA-256>",
    "checkpoint": "confirmed",
    "confirmation": {
      "reference": "<job-specific observed confirmation reference>",
      "observedAt": "<actual confirmation time>"
    }
  },
  "confirmationEvidence": {
    "path": ".local/alerts/MESSAGE_KEY/<job-specific proof file>",
    "sha256": "<actual proof SHA-256>"
  }
}
```
~~~

Keep the readable ticket and its history. The block binds its machine-readable checkpoint to the same source and vacancy; it does not replace actual observation. Retain a job-specific confirmation record or inspection containing the employer/posting identity and actual tool/portal evidence. A generic “Submitted” screenshot alone cannot distinguish two applications. Never invent a receipt number; where the portal has none, reference the actual job-specific saved confirmation observation.

Save one private outcome JSON per posting with `schemaVersion: 1`, `messageKey`, `vacancyKey`, `postingUrl`, `kind: "applied"`, `observedAt`, `taskId`, `confirmationReference` and `evidence: {path, sha256}` matching the ticket. On that vacancy's progress entry, save `postingUrl`, the existing task ID/path, `applicationRecordSaved: true`, confirmation reference, `taskEvidence: {path, sha256}` for the actual Markdown ticket and `outcomeEvidence: {path, sha256}` for the outcome JSON. Hash files after their final save/move. Refresh hashes after legitimate ticket edits; investigate unexpected changes.

For a permitted nonapplication, use `kind: "notApplicable"`, the actual `reason` and `instruction: {path, sha256}` pointing to the saved user instruction. Its progress entry has the matching reason, `instructionReference` path and outcome evidence. A closed or unsuitable vacancy requiring the user's decision stays Blocked. No instruction means no automatic exclusion. Nonapplications never move to Applied.

Write revised work with `saveEmailRecord`, or save its proposal to an ignored `.local/record.json` and run the commands below. Ordinary saves cannot set/reset cleanup controls, attempts, receipts or cancellation history. Do not use the generic JSON writer or direct file edits for the inbox ledger or selected email connection:

```shell
npm run email:work -- record --file .local/record.json
npm run email:work -- verify --message-key MESSAGE_KEY
```

Verification opens the real source, outcomes, tickets, instructions and confirmation files. It checks their hashes and identities, exact posting coverage and distinct task/confirmation evidence. Missing files, reused task IDs/paths, copied confirmation bytes, changed bindings and pending/Blocked/uncertain work stop cleanup. An optional application callback can reject further work; returning `true` cannot bypass these checks. The agent still must interpret real evidence truthfully; these checks do not understand every portal's success page.

## 4. Perform the selected cleanup under ownership

Callback-capable runtimes call `cleanupCompletedAlert` with the selected connection, actual capability report and transport. It holds an exclusive per-message claim through final verification, provider action and saved result. All supported work writers and artifact commits respect that same claim. The protected store rechecks ownership, current state and permitted transitions inside the serialized commit. A frozen digest binds the pending attempt to the exact work and connection. Other alerts can still progress; the whole-inbox write lock is never held across a provider call. The supplied host and AgentMail adapters require its single-use authorization. Direct client deletion with a persistence Boolean is refused. Retain mode records local completion without a provider mutation.

For a harness whose tools cannot be called from Node, use the native protocol:

```shell
npm run email:work -- native-prepare --message-key MESSAGE_KEY --owner-id ACTUAL_WORKER_ID
npm run email:work -- native-authorize --message-key MESSAGE_KEY --owner-id ACTUAL_WORKER_ID --token RETURNED_TOKEN
```

Keep the private token and operation ID on this worker's checkpoint. Preparation checks the saved work and saves its sealed pending checkpoint before returning. Authorization persists the invocation round before any tool action. The native claim survives CLI exits. If preparation acknowledgement fails after a replacement, a matching claim remains recoverable; inspect private status rather than starting a new owner. Authorization rechecks it and returns the exact account/mailbox/message, selected action, operation ID and invocation round. Call only that native message-level operation, once, then save the actual tool observation privately:

```json
{
  "schemaVersion": 1,
  "operationId": "<returned operation ID>",
  "round": 1,
  "messageKey": "<this exact source key>",
  "action": { "mode": "delete", "effect": "trash", "labelId": null, "sourceReference": "<actual saved choice>" },
  "state": "applied",
  "observedAt": "<actual observation time>",
  "toolReference": "<actual exact-message tool result>",
  "toolEvidence": { "path": ".local/proposals/OPERATION_ROUND-raw-tool-result.json", "sha256": "<actual SHA-256>" }
}
```

The action above is an example, not a new cleanup instruction. Use the exact returned action and round; other selected modes/effects stay unchanged. `state` describes email cleanup, not job submission. Cleanup observations are new operation evidence, not revisions to the frozen application work. Save the raw tool result and normalized observation to fresh, uniquely named ignored `.local/proposals/OPERATION_ROUND-*` files while retaining their actual tool references. Do not overwrite a source, application receipt or ticket to record a cleanup result, and do not reuse a previously recorded observation file. After recording, preserve these observation files unchanged. The guarded native-observe command verifies their hashes and owner before updating cleanup controls. Then record it:

```shell
npm run email:work -- native-observe --message-key MESSAGE_KEY --owner-id ACTUAL_WORKER_ID --token RETURNED_TOKEN --evidence .local/proposals/OPERATION_ROUND-cleanup-result.json
```

A confirmed cleanup saves its receipt and releases the claim. The claim and single-use round prevent another normal check-in from independently authorizing that same operation. These are repository coordination controls; they cannot intercept arbitrary native tools invoked outside this procedure. All agents using this working state must follow the protocol.

## 5. Recover without applying again

The schema-2 ledger keeps a protocol-2 cleanup attempt with a stable reference, sealed work/connection digests, phase, invocation round and append-only invocation/observation history. Pending cleanup never becomes ordinary editable work through a save. Its phases are prepared, invoked, inspection required and complete; they are internal checkpoints, not new board folders.

```shell
npm run email:work -- status --message-key MESSAGE_KEY
```

Status reports counts, for example three applied and one blocked, separately from cleanup state. Stage all such input/proposal files in private storage and never publish them. Native ownership details in this output are private resumption data; they are not authentication credentials or evidence that another worker stopped. An older work proposal cannot overwrite these controls even with a fresh ledger revision. Bulk saves, CLI commands and migration use the same protected boundary.

Callback cleanup saves a pending attempt before mutation. After a timeout or stopped process, the next owner inspects that exact message/action first: `applied` finalizes without another mutation, `notApplied` permits cleanup-only retry, and `unknown` stays pending. A 404 alone is insufficient; establish current account access and corroborate message absence.

Native claims never expire because a CLI exits or time passes. The same worker can use `native-resume` with its saved owner ID/token. If the earlier worker is no longer available, establish from the harness that it and any tool operation have stopped before recovering its saved ownership checkpoint. Do not copy another active worker's token or delete its claim. `native-resume` reports whether to inspect or authorize; an invoked/uncertain round must be inspected before a new mutation. Record the exact-message observation through `native-observe`. A stale round cannot authorize a retry. If worker termination or cleanup outcome cannot be established, preserve the pending record and report that specific dependency. No application is resubmitted to resolve an email cleanup problem.

If work needs correction while cleanup is pending, preserve the proposal separately; do not alter the sealed work or evidence. The owning agent first establishes the cleanup outcome. Unknown remains pending. Applied cleanup preserves its receipt and requires reconciliation of any inconsistent evidence; it cannot be undone by resetting a flag.

For an uninvoked preparation, or a current-round observation confirming the action was not applied, use explicit cancellation before editing work:

```shell
npm run email:work -- native-cancel --message-key MESSAGE_KEY --owner-id ACTUAL_WORKER_ID --token RETURNED_TOKEN
```

Callback runtimes use `cancelPendingCleanup`; it inspects an invoked/uncertain attempt before permitting cancellation. Cancellation retains the entire attempt, action and actual cancellation time in `cleanupHistory`, releases ownership and reopens work updates. It never reopens a confirmed application. Reconcile the preserved proposal against current state, keep existing task/confirmation identities and prepare a new attempt only when all source postings are resolved. No extra approval gate is introduced.

Selected email settings cannot change while cleanup is pending. Resolve the operation or safely cancel it before applying a new connection/cleanup choice. A failed artifact/progress save does not discard the submitted proposal or authorize a provider action.

Local process claims can recover only after the operating system establishes that the recorded same-host process is gone. Incomplete lock metadata or an interrupted recovery guard needs investigation; never delete it based on age. JSON writes are serialized, revision checked and explicitly file-flushed. A failed checkpoint write or flush cannot authorize an external action. Temporary-file replacement preserves the previous readable version when replacement fails; malformed state is retained for investigation rather than replaced with an empty ledger. Directory syncing is used where supported outside Windows. This does not establish universal power-loss durability across operating systems, filesystems or hardware. Finishing one message merges into current state without replacing another message's progress.

Claims coordinate workers sharing this working copy on one local filesystem. Two independent clones/machines have independent state. Use one active deployment for a mailbox, or provide genuinely shared coordination before running them concurrently; copying this package does not create distributed locking.

## Existing records and private storage

Schema-2 ledgers remain readable. Existing completed markers and receipts are retained, including legacy provenance. Active records without source inventories or file bindings need reconciliation before new cleanup. Legacy pending records retain their original identity, unknown fields and timestamps; protocol metadata is adopted under ownership and their previous outcome is inspected before any new invocation. Missing information stays unresolved. If an old record has conflicting attempt/state/action metadata, preserve it for investigation rather than treating it as a fresh operation. Attach evidence to their existing task IDs and outcomes; do not create replacement applications. Missing old source/evidence is a dependency, not permission to guess or delete.

Full bodies and detailed evidence stay in ignored `.local/alerts/`; the compact inbox ledger holds references and hashes. Claims are ignored `.local/ownership/` files. Preserve these with unfinished work when relocating, stop the old worker and revalidate access on the destination. Keep candidate documents, credentials and browser sessions private and unchanged.
