# Reusable application answers

A factual reply can serve later applications across roles when the answer applies to them. The agent uses the same lookup for an active application, an explicitly selected blocked review, and a relevant onboarding question. Candidate details stay in the private working copy.

## Resolve a question

Read the selected task, its actual form question, and the applicable role context first. Apply any explicit vacancy instruction. Prepare a private request and run `npm run answers -- resolve --file .local/REQUEST.json`. Supply the actual application date in the user's timezone. The values below are synthetic.

```json
{
  "question": "How much notice do you need to give?",
  "context": { "roleId": "qa", "country": "NG", "taskId": "APP-example" },
  "questionScope": {},
  "onDate": "2026-11-07"
}
```

Use a stable `fieldId` when interpreting other wording. A few exact common phrases map to the same notice-period or start-date field. The agent verifies meaning for other questions, including the answer type, units and any conditions. Keep `notice_period` distinct from `available_start_date`, and distinguish `work_authorization`, `sponsorship_now` and `sponsorship_future` by meaning and country. Never coerce a missing answer into a negative response. For a value in the existing selected profile, supply `existing: { value, scope, evidence: { path, sha256 } }` after reviewing the actual field and its conditions. Include the selected role in that scope. The resolver checks its current evidence alongside reusable records. Keep other existing candidate instructions in their canonical role files.

- **match** supplies the applicable value and file revision. A task-specific answer takes precedence. Otherwise a scope that adds conditions takes precedence over its broader default. Record the field and source revision in the selected task's evidence, and recheck it before submission if context changed.
- **pending** supplies the existing decision. Link that decision to the selected task, leave the existing prompt in focus, and continue independent eligible work.
- **missing**, **stale**, and **conflict** need a focused question when the field is required. Use the returned canonical decision with the focused conversation or selected attention review. For a known stale saved question, use the existing focused revision procedure. For a conflict, clarify the applicable value or scope before filling the form. When registering a new focused conflict question, set `scopeClarification: true` so an existing broader answer cannot close it.
- **unmapped** calls for interpretation of the current question. For unknown or conditional cases, use the existing role or task-specific procedure until scope is established. **recoverResponse** calls for recovery of the retained reply before using its values.

`context` contains the actual role, country, employer ID and task ID when known. `questionScope` defines where a reply can apply. An empty scope can be used for a clearly general fact. Include all material qualifiers. Bind a vacancy-specific reply to its actual task ID. Use an exact verified employer identity for employer restrictions, including on a shared ATS. Keep answers with conditions outside this schema in the applicable role or task context until those conditions are established. One-time access information and declarations belong to their respective access or application workflows.

## Save the reply

`npm run answers -- prepare --file .local/REPLY.json` takes `{ response, changes }`. The response is the usual focused response bundle, including any other clear canonical edits from that reply. For a reply containing only reusable facts, start its `answers`, `writes` and `references` arrays empty. Each change contains `fieldId`, `scope`, `value`, and `kind` (`answer` or `correction`). Add `validThrough` as YYYY-MM-DD only when the actual reply establishes that date. Preserve amounts with currency and period and durations with units.

Commit the returned private proposal through `onboarding:conversation reply`, `attention reply` for the selected review, or `settings save` under **Reusable answers**. The same journal verifies revisions and recovers an interrupted save. Use the existing reconciliation procedure if a newer edit conflicts. A scope change pairs a `correction` with `value: null` at the old scope and a value at the newly authorized scope in the same reply. Correct the applicable field only and preserve other scope-specific values.

The optional, ignored `Job Context/Candidate/reusable-answers.local.md` holds the values, scope, source, and update dates. It is created on the first saved answer. Existing role files are read as before. Adopt an older value for wider reuse only when its original source supports that wider scope. Use the original reply and date for that adoption. The conversation and attention checkpoints retain only decision and evidence references. Remove temporary private proposals after verified completion using the existing response procedure.

## Blocked review

Only inspect the selected task under an explicit review. Preserve its real evidence file and checkpoint. For a new reusable answer blocker, record the canonical decision from the lookup as its `attention.binding`. Pass the verified request as `answerLookup` when verifying the selected review, with its actual role and task IDs. The same lookup can satisfy an older role-bound factual blocker after the agent verifies its field and scope. A saved answer is available to later applications immediately. Each already blocked task stays under its existing user move and dependency verification procedure.
