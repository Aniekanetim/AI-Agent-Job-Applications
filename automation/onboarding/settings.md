# Change settings or continue setup

You can change setup choices later by telling your agent what to change. For example: “Use the in-app browser”, “Replace my QA CV”, “Check daily instead of hourly” or “Change my minimum salary”. You do not need to edit files or repeat onboarding.

If you say only “Change my settings”, the agent offers the areas below and asks which one you want to change. If you supplied the new value already, it saves that value without asking again.

| Area | Working location | What the agent rechecks |
| --- | --- | --- |
| Roles, CVs and candidate answers | Selected role's private files and Documents index under Job Context/Candidate | Changed facts, routing and document versions; preserve original CVs |
| Job preferences and instructions | Selected role's private preference/instruction files | Affected eligibility and required answers |
| Primary boards or intake sources | Onboarding scope, selected boards and access context | Added or changed access/mapping; reuse matching prepared boards |
| Browser and visibility | `.local/browser-preferences.json` and `.local/browser/visibility.json` | Chosen browser, visible operation and required upload fallback |
| Email account or completed-alert handling | Existing shared email procedures and protected connection store | Actual account/capabilities and unfinished alert recovery |
| Check-in interval, limits and reporting | `.local/operation-preferences.json` | Affected schedule/access checks and operating instructions |

The agent reads the saved value, applies only the requested change, preserves other settings and records the actual request. It saves clear additional answers from the same reply too. Active applications retain their original role/CV and submission checkpoint until the change is reconciled. An uncertain submission is investigated before any retry. Email connection changes retain protected-store and pending-cleanup checks.

## Agent procedure

1. Inspect canonical private context and recover any staged response before accepting another edit. Never write candidate values into public templates.
2. Use the existing semantic helper for browser, email, scope or operating changes. `operation-choice` merges supplied fields; omit a flag to keep its value. Use `--per-run-limit none` or `--per-day-limit none` only for an explicit removal. Changing reporting preserves limits and a schedule reference.
3. Save the correction through the [focused response procedure](focused-conversation.md) with `kind: correction`, preserving other file contents and prior answers. A setting with no previous answer uses `kind: answer`. If the replacement is missing, ask one focused question. Use `revise --file` with `{id, prompt, sourceReference}` for an answered question: its old prompt and answers remain in history. A new field uses `queue`. An explicit pause stays paused until the user resumes.
4. Revalidate affected preparation and refresh the scoped handoff. Reuse unaffected documents, sessions, mappings and answers. Identify any remaining dependency without restarting the questionnaire or claiming the updated setup is complete.

An existing recurring schedule must be changed or stopped through its actual scheduler. Verify that outcome and reconcile its private operating fields/reference using the revision-checked private JSON helper, then record updated checks. Do not clear a schedule reference to bypass this step. Ordinary reporting or limit changes preserve the schedule. No settings command activates scheduling automatically.

Agent shortcuts:

```shell
npm run onboarding:settings
npm run onboarding:operation -- --reporting summary --source ACTUAL_CHANGE_REFERENCE
npm run browser -- visibility --mode headed --source ACTUAL_CHANGE_REFERENCE
```

## Continue after an interruption

When you say “Continue onboarding”, the agent loads the existing working copy and runs:

```shell
npm run onboarding:resume -- --source ACTUAL_CONTINUE_REFERENCE
```

| Returned action | Agent's next action |
| --- | --- |
| `recoverResponse` | Recover the retained answer save and reconcile any conflict; do not request the answer again |
| `present` or `repeatOnRequest` | Present the one pending question or its latest clarification |
| `work` | Continue the named stage/substep and saved next action; ask only for a missing decision |
| `complete` | Confirm readiness for the saved scope; do not reopen setup without a requested change |

After each setup action, save the checkpoint and call `next` again. Continue until a real question, dependency, explicit pause or completed handoff requires yielding. Inspect an interrupted prompt's actual presentation before retrying it; an explicit request to continue permits re-presenting the pending question. Scheduled checks use ordinary `next`, keep unchanged questions quiet and never invent a user resume request.

Closing the agent stops execution. Saved progress permits continuation when it runs again; it does not create a background service.
