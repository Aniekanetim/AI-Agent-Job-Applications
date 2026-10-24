# Onboarding progress and readiness

The agent follows [the onboarding workflow](../../Application%20Workflow/onboarding-workflow.md), shows its roadmap before setup and updates the user after meaningful progress. These helpers preserve its checkpoint and check completion. They are not a separate application, scheduler or approval system.

## Working state

Use ignored `.local/onboarding-state.json`. The [empty example](onboarding-state.example.json) is public and contains no configured candidate, account or completed check. Schema 2 records scope, selected board paths, steps, per-board access/mapping checks, question references and evidence hashes. Candidate answers remain solely in the role's private files; credentials never belong in progress.

| Status | Meaning |
| --- | --- |
| `pending` | Work has not started |
| `inProgress` | Work has a saved checkpoint and next action |
| `complete` | The agent inspected the referenced evidence under the recorded conditions |
| `blocked` | A concrete dependency prevents this step; record the needed action |
| `skipped` | Outside scope or a documented observation boundary; never silently hide required work |

The seven top-level steps are board selection, browser tools, candidate profiles, instructions, connections, site mapping and final readiness. Connections and mapping are derived from the selected boards and, when enabled, the email check. Status folders on the application board do not change.

## Agent commands

Run these from the working root after dependencies are installed. The agent runs them; users can stay in the conversation.

```shell
npm run onboarding:status
npm run onboarding:start -- --scope bothApplications --board "LinkedIn|https://www.linkedin.com/|Site Architecture Context/LinkedIn"
npm run onboarding:record -- --step candidateProfiles --reference "Job Context/Candidate/role-routing.local.md" --reference "Job Context/Candidate/Role Profiles/Software QA Engineer/Documents/README.local.md"
npm run onboarding:record -- --board LinkedIn --area navigation --reference "Site Architecture Context/LinkedIn/architecture.local.md"
npm run onboarding:check
npm run onboarding:help
```

The names are examples, not enabled profiles or observed mappings. Record candidate identity/contact and all chosen profiles' actual document/context references too. Use `--step applicationInstructions` for the relevant private preference/answer/instruction files; `--step browserTools` for the successful local browser report; `--email` for an actually verified selected-inbox reference; and `--board NAME --area access` for verified website access. Never infer completion from an example, file existence or successful compilation.

`status` and `check` leave saved progress and candidate records unchanged. Their npm wrappers compile helpers under ignored `.local/build/`. `check` exits 0 only after verified preparation and the completed handoff; 2 means work remains. `record`, `start` and `finish` save atomically with an expected-file-revision check. Storage must be ignored and untracked. A concurrently changed or malformed state is preserved for investigation.

Use `record --status inProgress --next-action TEXT`, `--status blocked --reason TEXT --next-action TEXT`, or `--status skipped --reason TEXT --reference PATH` for agent-managed checkpoints, concrete dependencies and evidenced observation boundaries. The same step/board selectors apply. Completion still requires actual evidence. For structured updates to role/question references, use `progress.ts` and `state-store.ts`: load, update only the affected check's status/evidence/next action, refresh the derived progress and save using the loaded revision. Do not clear pending questions to make the counter green; save the answer or a legitimate optional deferral in its canonical context first.

## Mapping completion

Each selected board has `access` plus five mapping checks:

- `navigation`: observed search/results and a vacancy-detail route.
- `applicationRoute`: observed built-in or external application entry and its host conditions.
- `accessibleForms`: fields, uploads and review navigation observed before submission.
- `reusableCode`: linked, type-checked methods for the branches actually learned; untouched branches still require discovery.
- `limits`: explicit unvisited branches, final-submission boundary, encountered destination limits and refresh triggers.

Mapping checks reference the actual knowledge/code files and private observation evidence. An inaccessible form or code branch can be `skipped` only with a timestamp, evidence and a specific observed boundary; this is surfaced in progress and the final handoff. A failed attempt to map an accessible core route is `blocked` or `inProgress`, not a skip. Navigation, application routing and documented limits require completion. No practice application is submitted to satisfy mapping.

The helper checks evidence shape, existence and saved hashes; the agent must establish that its content supports the claimed observation. It cannot determine whether a screenshot or a human statement is true. The final handoff must state any unverified forms or destinations even when the initial board preparation is usable.

## Deferrals and completion

Use `npm run onboarding:defer -- --board NAME --reason TEXT --source REFERENCE` only for the user's explicit decision to postpone that selected board. `npm run onboarding:resume -- --board NAME` restores it. All selected boards deferred is not application-ready; at least one must be prepared. One prepared board plus an explicitly deferred board produces partial preparation with the deferred name visible. The agent must not decide a user's deferral silently.

Before finishing, run the readiness check, resolve stale evidence and write a private handoff with the configured roles, CV versions, intake sources, prepared boards, observation boundaries, deferrals and next action. Then run:

```shell
npm run onboarding:finish -- --reference .local/onboarding-handoff.md
```

This records a handoff, not a job submission or schedule activation. The overall phase can be complete for its stated scope with explicit partial preparation. Missing scope-required work keeps setup in progress or waiting for the user's answer. Changes to referenced files invalidate only the affected preparation and must be investigated before claiming readiness again.

## Existing setup and relocation

`npm run onboarding:migrate` converts schema 1 while preserving selected roles, pending/deferred questions, context revisions and extra checkpoint metadata. An earlier `complete` phase becomes `inProgress`: browser and mapping checks did not exist then. Read the saved context and previous observations, verify their applicable content and record the relevant checks instead of repeating the questionnaire. Select primary boards from already supplied instructions; ask only if that choice is missing or ambiguous. Reconcile the scope with existing intake instructions, including both intake sources when already selected.

Do not create a fake application ticket for an onboarding dependency. Save it here until a real assignment exists. A private state transferred to another machine is a checkpoint, not proof that tools or access work there. Recheck the local runtime, paths and account conditions. Keep actual progress/evidence private; public docs describe operation, not individual users' verification history.
