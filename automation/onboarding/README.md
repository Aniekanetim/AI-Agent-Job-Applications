# Onboarding progress and readiness

The agent follows [the onboarding workflow](../../Application%20Workflow/onboarding-workflow.md), shows its roadmap before setup and updates the user after meaningful progress. The [focused conversation layer](focused-conversation.md) asks one missing decision at a time while saving all clear additional answers. These helpers preserve its checkpoint and check completion. They are not a separate application, scheduler or approval system.

For later changes and interrupted setup, follow [settings and resumption](settings.md). `onboarding:settings` identifies available areas. `onboarding:resume -- --source ACTUAL_REQUEST_REFERENCE` returns the pending question or a specific unfinished action. The agent performs that action instead of stopping at a status display. Neither command resets profiles or activates a schedule.

## Working state

Use ignored `.local/onboarding-state.json`. The [empty example](onboarding-state.example.json) is public and contains no configured candidate, account or completed check. Schema 3 records scope, selected board paths, steps, per-board access/mapping checks, question references and evidence hashes. Candidate answers remain solely in the role's private files; credentials never belong in progress. A version-1 `conversation` extension records one active question, clarification history, pause state and saved-answer references. Its addition preserves existing schema-3 completion; it does not introduce a new readiness requirement.

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

## Focused interaction

Use `npm run onboarding:conversation -- status` for the brief stage/substep view. Follow [the conversation procedure](focused-conversation.md) for question metadata, presentation references, response bundles, clarification, pause/resume, optional deferral and interrupted-save recovery. One actual reply can update many fields; unanswered or ambiguous fields remain pending. A saved setting does not verify access or perform an external account operation. Existing semantic utilities remain authoritative for browser/email/operating choices.

Supported progress writes are serialized and revision checked. A retained `.local/onboarding-pending-response.json` prevents another question or completion until recovery. Its proposed values are temporary private working data; successful processing keeps only canonical answer/source references in progress. Do not pass answers or secrets in command arguments.

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

Use `npm run onboarding:defer -- --board NAME --reason TEXT --source REFERENCE` only for the user's explicit decision to postpone that selected board. `npm run onboarding:resume-board -- --board NAME` restores it. All selected boards deferred is not application-ready; at least one must be prepared. One prepared board plus an explicitly deferred board produces partial preparation with the deferred name visible. The agent must not decide a user's deferral silently.

Before finishing, run the readiness check, resolve stale evidence and write a private handoff with the configured roles, CV versions, intake sources, prepared boards, observation boundaries, deferrals and next action. Then run:

```shell
npm run onboarding:finish -- --reference .local/onboarding-handoff.md
```

This records a handoff, not a job submission or schedule activation. The overall phase can be complete for its stated scope with explicit partial preparation. Missing scope-required work keeps setup in progress or waiting for the user's answer. Changes to referenced files invalidate only the affected preparation and must be investigated before claiming readiness again.

## Existing setup and relocation

`npm run onboarding:migrate` also adds the version-1 conversation checkpoint to older schema-3 files without resetting their questions, evidence or completion. It converts schema 1 or 2 while preserving selected roles, pending/deferred questions, context revisions and extra checkpoint metadata. An earlier `complete` phase becomes `inProgress`: the new browser-choice, upload, verification and operating checks were not established by that completion. Read the saved context and previous observations, verify their applicable content and record the relevant checks instead of repeating the questionnaire. Select primary boards from already supplied instructions; ask only if that choice is missing or ambiguous. Reconcile the scope with existing intake instructions, including both intake sources when already selected.

Do not create a fake application ticket for an onboarding dependency. Save it here until a real assignment exists. A private state transferred to another machine is a checkpoint, not proof that tools or access work there. Recheck the local runtime, paths and account conditions. Keep actual progress/evidence private; public docs describe operation, not individual users' verification history.

## Browser and preparation commands

Application setup retains seven top-level steps. Schema 3 adds visible preparation checks: `browserChoice`, `uploadDocuments`, `verificationAccess`, `operatingPreferences`, `scheduleChoice`, `scheduledAccess` and `rehearsal`. Profile-only setup does not require them. Keep detailed facts in canonical private context, not this state file.

```shell
npm run onboarding:browser -- --browser inApp --source .local/user-browser-choice.md
npm run onboarding:record -- --step browserTools --reference .local/browser-readiness.json --reference .local/browser-in-app.json
npm run onboarding:record -- --preparation uploadDocuments --reference "Job Context/Candidate/Role Profiles/Software QA Engineer/Documents/README.local.md"
npm run onboarding:record -- --preparation verificationAccess --reference "Job Context/Candidate/Role Profiles/Software QA Engineer/verification-access.local.md"
npm run onboarding:operation -- --mode onDemand --source .local/user-operating-choice.md --reporting summary
npm run onboarding:record -- --preparation rehearsal --reference .local/browser-readiness.json
```

These are agent examples, not preselected user choices or evidence. Save the actual user's responses before referencing them. Browser choices are `automatic`, `inApp` or `playwright`; automatic selection resolves only after actual capability comparison with `onboarding:resolve-browser -- --reference PATH`. An in-app choice requires both the host capability report and the Playwright upload rehearsal. A failed host initialization keeps the choice but reopens tools, avoiding a repeated preference question.

`onboarding:operation` records on-demand/recurring mode, optional numeric limits, reporting and the user-selected task-board check-in interval/timezone. The interval is stored in `cadence`; ask for it explicitly, using clear examples rather than the internal field name. The same check-in covers both enabled intake sources only. Blocked review requires an explicit user request; the user requeues resolved tasks in To Do. It does not activate an automation. On-demand records an evidenced skip of `scheduledAccess`. Recurring needs the actual schedule reference and scheduled-environment reports under [schedule setup](../scheduling/README.md); inspect an existing schedule before changing it. If a schedule reference already exists, the command refuses to replace it silently. The agent reconciles the native schedule first, then uses the revision-checked [private JSON helper](../workflow/private-json.ts) to update only the actual changed fields.

Private browser preferences live in `.local/browser-preferences.json`; operating settings in `.local/operation-preferences.json`. The public examples are shapes, not completed configurations. In-app reports use [the capability schema](../browser/capabilities.ts); each verified claim needs actual file/hash evidence. Readiness checks root, runtime, selected provider, nested evidence hashes and interactive versus scheduled scope. It also requires a Playwright report with an actual upload check. Helpers cannot establish that an agent's screenshot or written observation is truthful; inspect contents before recording completion.

Schema-1/2 migration preserves all existing roles, questions, context revisions, evidence and extra checkpoint metadata. New checks begin pending and prior completion is reopened. Reuse relevant earlier observations after inspection; never infer browser preference, verification-email access or a scheduling choice from installed packages or an existing alert connection.

## Email readiness across providers

Follow [shared email onboarding](../email/README.md) before any provider-specific setup. The existing `emailConnection` check now validates the selected provider/account, user scope and cleanup choice plus actual list/read/pagination evidence. A suitable host email connection needs no AgentMail key. Header-only legacy observations do not establish full content access. A new capability gap reopens only the email check; keep mailbox selection, candidate answers and other preparation.

The conversation explicitly presents **Connect your email**, using [harness discovery](../email/host-connectors/discovery.md) to show Google first, available Outlook/other services, optional AgentMail and Set up email later. Availability, account authentication and access readiness remain separate. Provider catalog metadata lives in `.local/email-provider-catalog.json`; the optional `.local/email-onboarding.json` saves provider intent, explicit deferral and the interruption stage. Existing installations need neither a new provider choice nor a schema-3 reset. Main onboarding status includes email subprogress when email is in scope.

`npm run email:onboarding -- checkpoint --stage authentication --next-action TEXT` saves a real sign-in handoff. `defer --reason TEXT --source-reference REF` pauses email intake; `resume --source-reference REF` restores the saved checkpoint. These actions do not authenticate, change the mailbox, activate a schedule or establish readiness. Eligible manual work remains possible, but deferred email cannot satisfy email/both-source completion. A manual-only scope change needs the person's actual instruction.

After inspecting actual evidence, record `.local/email-connection.json` and `.local/email-capabilities.json` under `onboarding:record -- --email --reference PATH` (repeat references). For recurring mode, scheduled email evidence is required separately in `.local/email-capabilities-scheduled.json`; interactive reports or confirmations needed on every call cannot establish unattended readiness. On-demand mode needs no scheduled email proof. The top-level seven steps and progress schema 3 remain unchanged; inbox progress separately migrates from schema 1 to 2.

## Interactive settings

An actual **Open settings** request opens [the settings menu](../settings/README.md). Its separate private navigation checkpoint preserves onboarding pause/focus and reuses the same canonical settings and response store. `next` returns `settings` while the menu is open instead of opening a competing interview; unattended runs remain quiet. Close an idle menu before an explicit onboarding resumption. Recover a pending settings save first.
