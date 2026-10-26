# Email intake and completed-alert handling

**Connect your email** is an explicit onboarding step. Show Google — Gmail / Google Workspace first, followed by available Outlook and other discovered email services, optional AgentMail and Set up email later. Reuse an authorized connection when it can perform the chosen work. [AgentMail](agentmail/setup.md) remains an optional dedicated inbox; manual tasks and profile-only setup need no alert inbox.

## Onboarding and account selection

Follow the shared [focused conversation checkpoint](../onboarding/focused-conversation.md). Provider choice, account choice, authentication action, optional alert scope and completed-alert handling are separate focused substeps. Save clear choices volunteered early; do not ask again or start a parallel questionnaire while another decision is active. A paused onboarding conversation stays paused; existing authorized application work is a separate scope.

1. Read `.local/email-connection.json` when present. Reuse its confirmed account and scope. An unavailable selected connection needs repair; it is not permission to switch accounts.
2. On first setup, follow [provider discovery](host-connectors/discovery.md). Inspect the host's available integrations and tools before presenting Google first. Distinguish provider availability, authenticated accounts and actual readiness. Use the actions Connect, Use existing connection, Reconnect or Not yet verified as supported by observations. Offer discovered Outlook and other email services, optional AgentMail and Set up email later. A missing tool is not proof that the harness cannot support the provider.
3. Guide the selected provider's supported connection screen, then list accessible account addresses through metadata tools. Ask which account to use even if only one exists; accept an address already supplied and verify it without asking again. Keep authentication in the harness. Do not ask for an email password in chat or require a separate Gmail API key. An expired connection needs the actual reconnect action; never silently switch providers.
4. Offer an optional folder, label or alert filter. Save the candidate's job-alert instructions and reference them from the selection. Include read messages; an email being marked Read does not mean its application was completed. Do not change account addresses or create mailbox labels without applicable instructions.
5. Check listing/search, message-content access and pagination. Check whether cleanup operations act on one message, their exact effects and any required host confirmation. A search index/snippet alone does not establish complete alert-body access. Keep verified, unsupported, denied and unverified states distinct.
6. Ask how to handle fully completed alerts: delete, archive, label or retain. Offer only supported actions, explain Trash versus permanent deletion, and save the actual user choice. Read-only connections can use retain mode. Do not silently change cleanup policy or evade a denied operation through another transport.
7. Verify the selected connection in the actual scheduled environment if recurring checks were chosen. Interactive evidence does not establish scheduled access. Setup sends no mail, modifies no messages and activates no schedule merely because a connection is found.

The agent manages the private files and commands. Users choose the account, scope, cleanup mode and check-in interval in conversation; they do not need provider IDs or OAuth tokens. A valid existing AgentMail choice is retained during migration. The existing deletion instruction can be imported with its source reference; a new user needs an actual cleanup choice.

## Save progress and resume

Before an authentication handoff or interruption, save the provider choice and exact next action in `.local/email-onboarding.json` using [the empty example](onboarding.example.json). The setup stages are discovery, provider choice, authentication, account choice, preferences and access verification. This file holds no candidate answers, tokens or false ready flag. `email:onboarding status` and the main onboarding status show the current checkpoint; actual readiness still comes from the selected mailbox and capability evidence.

For **Set up email later**, record the person's explicit deferral and retain the checkpoint, mailbox binding and alert history. Pause email intake. Eligible manual tasks can continue under existing application instructions. Do not call email or both-source onboarding complete while email is deferred. If the person wants to finish manual-only setup now, record that explicit scope change through `onboarding:start`; do not silently change the selected scope. On resumption, reuse the checkpoint and supplied answers. Do not prompt again during every unchanged scheduled check-in.

Choosing a different provider records setup intent, not a source switch. Keep the previous mailbox and its active work until the person has selected the new account and the existing switch checks permit the change. Existing installations need no new provider question: their confirmed source remains selected and new metadata files are created only for a real setup change.

## Email processing and cleanup

1. List all pages within the selected scope. Use the provider's real message IDs, not thread IDs or temporary search-result positions. Never use a last-completed timestamp or unread-only filter to discard older unfinished work.
2. Consult the compact `.local/inbox-state.json` record for that exact provider/account/mailbox/message. A connector session or label change does not create another assignment. This is recovery of one email, not cross-source vacancy duplicate screening.
3. Classify a new message using the candidate's actual alert rules and observed content. The AI performs classification; the helper records its result and source evidence. Categories are job alert, OTP, receipt, recruiter correspondence, unrelated and unknown. Uncertain or mixed protected correspondence stays preserved; do not fabricate a job alert to make it eligible for cleanup.
4. For a job alert, follow [source inventory and completion](alert-completion.md). Capture the actual full message, extract all source links, resolve duplicate/navigation/posting links with evidence and reconcile every distinct posting. A completion flag alone is insufficient. Save task associations before acting and reuse them on resumption. Truncated/unknown content and unresolved applications keep the email.
5. Save confirmed applications durably in Applied before marking the corresponding vacancy applied. A permitted nonapplication needs its actual reason and candidate-instruction reference. No nonapplication is presented as a successful submission.
6. After every vacancy has a permitted persisted disposition, run the selected cleanup mode. [cleanup.ts](cleanup.ts) checks source identity, classification, completion records, actual selected policy and capability evidence, then saves a pending checkpoint before any external action. The built-in verifier opens and hashes the actual source, outcomes, Applied tickets and job-specific confirmation evidence; an optional callback can veto but cannot authorize missing or inconsistent work.
7. Retain mode saves the completed-message marker without modifying email. Delete/archive/label require a matching message-level operation. Store the actual result and chosen effect. Preserve lightweight completed markers while the message can still be encountered; do not expire them by an arbitrary time limit and risk applying again. Keep only IDs, classifications, task pointers, rule/evidence references and cleanup outcomes—not email bodies or a second CV/history archive.
8. On a cleanup timeout, retry cleanup only. First establish whether that same action already happened. If its outcome is unknown, leave the cleanup pending. Confirmed applications remain Applied; do not submit them again or substitute another cleanup mode. A 404 is not automatically deletion proof: corroborate account access and exact-message absence.

Use the coordinated cleanup implementation for callback transports and the [native ownership protocol](alert-completion.md#4-perform-the-selected-cleanup-under-ownership) for external harness tools. Per-alert ownership spans verification, mutation and final persistence and is enforced for work updates, canonical artifact writes and bulk saves too. Cleanup controls have dedicated transitions; an ordinary save cannot reset pending work. Preserve rejected proposals and use explicit, recorded cancellation only before invocation or after actual not-applied confirmation. Selected connection/cleanup settings remain protected while pending; shared JSON writes are serialized and revision checked. Independent deployments need shared coordination or a single active worker deployment for that mailbox. Preserve source associations and history when tickets move. The four board folders remain Email Alerts, To Do, Blocked and Applied.

## Messages that are not job alerts

Unrelated mail, recruiter replies, interview invitations, rejections, OTPs and receipts are preserved. Alert intake creates no application task or cleanup action for them. A private classification marker avoids repeatedly reading an unchanged body. Revisit classification when the provider's available content revision, relevant headers or configured rules change; labels/read state alone do not restart it. Some providers expose no content revision, so hidden changes cannot be inferred from metadata.

This cache applies to alert intake only. An OTP or receipt can still be read for an authorized current sign-in/application under [verification access](verification/README.md). Recruiter reply handling, interview scheduling and unrelated outgoing email need separate user instructions; this package does not invent that workflow. A changed completed alert is inspected against its existing task history, never converted into a new assignment automatically.

## Working files and commands

| Private file | Purpose |
| --- | --- |
| `.local/email-provider-catalog.json` | Observed provider availability, harness, root, execution context and discovery scope; no invented account IDs |
| `.local/email-host-connections.json` | Account/tool metadata supplied by the harness agent; no credentials or email bodies |
| `.local/email-onboarding.json` | Chosen provider, optional explicit deferral and resumption checkpoint |
| `.local/email-connection.json` | Confirmed source, scope/rule revision and selected cleanup mode |
| `.local/email-capabilities.json` | Actual interactive source/tool capability evidence |
| `.local/email-capabilities-scheduled.json` | Separate evidence for the actual scheduled environment |
| `.local/inbox-state.json` | Schema-2 classifications, source-inventory references, distinct vacancy/task/evidence bindings and cleanup checkpoints |
| `.local/alerts/` | Private full source captures, link-resolution observations and per-vacancy outcome/confirmation evidence |
| `.local/ownership/` | Per-message operation claims and short-lived private-write claims |
| `.local/proposals/` | Staged work/artifact corrections; retain them when a guarded update is refused |

The public [connection example](connection.example.json), [capability example](capabilities.example.json), [inventory example](host-connectors/inventory.example.json) and [empty progress](inbox-state.example.json) are templates, not live configuration. Existing candidate information, credentials and browser sessions stay where they are.

```shell
npm run email:discover
npm run email:options
npm run email:onboarding -- status
npm run email:select -- --candidate ACTUAL_ID --source-reference PRIVATE_USER_REPLY --rule-reference PRIVATE_ALERT_RULES --rules-revision ACTUAL_VERSION
npm run email:cleanup -- --mode retain --effect retain --source-reference PRIVATE_USER_REPLY
npm run email:capabilities -- --file .local/actual-email-capabilities.json
npm run email:status
npm run email:help
```

`discover` reads metadata and bounded existing AgentMail configuration; it does not discover every host's tools itself. The agent follows the harness discovery procedure and supplies actual catalog/account observations first. `options` displays the ordered connection choices. `catalog --file PATH` validates/saves a normalized observed catalog; `--format codexCli|codexDirectory --reference REF` normalizes actual Codex metadata. Claude Code and other harnesses use the shared format, without requiring Codex.

`onboarding choose --provider ID --source-reference REF` records the actual provider choice. `checkpoint --stage STAGE --next-action TEXT` saves the interruption point; `defer --reason TEXT --source-reference REF` and `resume --source-reference REF` follow the person's actual instruction. These are actions after `email:onboarding --`, not separate background workers. Readiness cannot be set manually through a checkpoint.

`select` preserves an existing choice unless a new user choice is explicitly recorded, and refuses a source switch with unresolved existing alert work. It rejects an account explicitly reported as expired or denied. `classify` records observed classification from a private header file. These setup CLI commands perform no provider network operation or cleanup. Use `email:work` for inventory, reconciliation, verification and durable native cleanup authorization/result recording. The native tool itself performs the authorized external action; callback runtimes use `cleanupCompletedAlert`. See [the execution procedure](alert-completion.md). After a newly selected AgentMail backend is bound, record its actual source as a candidate and reuse that original user choice; choose cleanup through shared onboarding. Use migration only when an existing cleanup instruction is actually available. A backend binding alone does not authorize a new cleanup effect.

## Existing setup and relocation

Run `npm run email:migrate -- --policy-reference ACTUAL_LEGACY_POLICY_REFERENCE` for an existing AgentMail setup. The helper keeps the old binding/credential files untouched, imports the selected mailbox and existing cleanup instruction, and converts schema-1 progress without dropping task pointers, conversations or extra metadata. It performs no API request. Old deleted checkpoints retain legacy provenance; migration is not a new live verification and invents no historical observation date. A malformed or mismatched ledger is preserved for investigation.

Active legacy records lacking inventories or artifact hashes must be reconciled against their existing tasks before new cleanup; completed markers are preserved. See [record compatibility](alert-completion.md#existing-records-and-private-storage).

On another machine, stop the old worker, transfer private selections/progress and evidence securely, and reconnect the actual source. A reference does not transfer OAuth credentials or prove tool availability. Revalidate the affected access, root and scheduled conditions; preserve candidate answers and completed-message markers. See [host connectors](host-connectors/README.md) and the [AgentMail adapter](agentmail/adapter.ts).
