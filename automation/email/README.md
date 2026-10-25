# Email intake and completed-alert handling

Use an existing authorized email connection when it can perform the chosen work. Gmail, Outlook or another connection exposed by the agent's harness can supply alerts without an AgentMail account or key. [AgentMail](agentmail/setup.md) remains available when no suitable connection exists or the user prefers a dedicated inbox. Manual tasks and profile-only setup need no alert inbox.

## Onboarding and account selection

1. Read `.local/email-connection.json` when present. Reuse its confirmed account and scope. An unavailable selected connection needs repair; it is not permission to switch accounts.
2. On first setup, inspect the actual harness tool inventory and accessible account metadata. Show the account addresses, available operations and any limitations. Ask which account to use even if only one exists; accept an address already supplied and verify it without asking again. Do not open message bodies to guess a preferred account.
3. Offer an optional folder, label or alert filter. Save the candidate's job-alert instructions and reference them from the selection. Include read messages; an email being marked Read does not mean its application was completed. Do not change account addresses or create mailbox labels without applicable instructions.
4. Check listing/search, message-content access and pagination. Check whether cleanup operations act on one message, their exact effects and any required host confirmation. A search index/snippet alone does not establish complete alert-body access. Keep verified, unsupported, denied and unverified states distinct.
5. Ask how to handle fully completed alerts: delete, archive, label or retain. Offer only supported actions, explain Trash versus permanent deletion, and save the actual user choice. Read-only connections can use retain mode. Do not silently change cleanup policy or evade a denied operation through another transport.
6. Verify the selected connection in the actual scheduled environment if recurring checks were chosen. Interactive evidence does not establish scheduled access. Setup sends no mail, modifies no messages and activates no schedule merely because a connection is found.

The agent manages the private files and commands. Users choose the account, scope, cleanup mode and check-in interval in conversation; they do not need provider IDs or OAuth tokens. A valid existing AgentMail choice is retained during migration. The existing deletion instruction can be imported with its source reference; a new user needs an actual cleanup choice.

## Email processing and cleanup

1. List all pages within the selected scope. Use the provider's real message IDs, not thread IDs or temporary search-result positions. Never use a last-completed timestamp or unread-only filter to discard older unfinished work.
2. Consult the compact `.local/inbox-state.json` record for that exact provider/account/mailbox/message. A connector session or label change does not create another assignment. This is recovery of one email, not cross-source vacancy duplicate screening.
3. Classify a new message using the candidate's actual alert rules and observed content. The AI performs classification; the helper records its result and source evidence. Categories are job alert, OTP, receipt, recruiter correspondence, unrelated and unknown. Uncertain or mixed protected correspondence stays preserved; do not fabricate a job alert to make it eligible for cleanup.
4. For a job alert, enumerate every vacancy once, save its task association before acting and keep extraction incomplete until all vacancy content is accounted for. Reuse those associations on resumption. Partial or blocked applications keep the email unresolved.
5. Save confirmed applications durably in Applied before marking the corresponding vacancy applied. A permitted nonapplication needs its actual reason and candidate-instruction reference. No nonapplication is presented as a successful submission.
6. After every vacancy has a permitted persisted disposition, run the selected cleanup mode. [cleanup.ts](cleanup.ts) checks source identity, classification, completion records, actual selected policy and capability evidence, then saves a pending checkpoint before any external action. The agent must inspect actual task files and receipts through its persistence callback; a supplied Boolean cannot prove them true.
7. Retain mode saves the completed-message marker without modifying email. Delete/archive/label require a matching message-level operation. Store the actual result and chosen effect. Preserve lightweight completed markers while the message can still be encountered; do not expire them by an arbitrary time limit and risk applying again. Keep only IDs, classifications, task pointers, rule/evidence references and cleanup outcomes—not email bodies or a second CV/history archive.
8. On a cleanup timeout, retry cleanup only. First establish whether that same action already happened. If its outcome is unknown, leave the cleanup pending. Confirmed applications remain Applied; do not submit them again or substitute another cleanup mode. A 404 is not automatically deletion proof: corroborate account access and exact-message absence.

Use revision-checked private writes and coordinate one worker for the selected intake. Preserve source associations and history when tickets move. The four board folders remain Email Alerts, To Do, Blocked and Applied.

## Messages that are not job alerts

Unrelated mail, recruiter replies, interview invitations, rejections, OTPs and receipts are preserved. Alert intake creates no application task or cleanup action for them. A private classification marker avoids repeatedly reading an unchanged body. Revisit classification when the provider's available content revision, relevant headers or configured rules change; labels/read state alone do not restart it. Some providers expose no content revision, so hidden changes cannot be inferred from metadata.

This cache applies to alert intake only. An OTP or receipt can still be read for an authorized current sign-in/application under [verification access](verification/README.md). Recruiter reply handling, interview scheduling and unrelated outgoing email need separate user instructions; this package does not invent that workflow. A changed completed alert is inspected against its existing task history, never converted into a new assignment automatically.

## Working files and commands

| Private file | Purpose |
| --- | --- |
| `.local/email-host-connections.json` | Account/tool metadata supplied by the harness agent; no credentials or email bodies |
| `.local/email-connection.json` | Confirmed source, scope/rule revision and selected cleanup mode |
| `.local/email-capabilities.json` | Actual interactive source/tool capability evidence |
| `.local/email-capabilities-scheduled.json` | Separate evidence for the actual scheduled environment |
| `.local/inbox-state.json` | Schema-2 message classifications, vacancy associations, completed markers and cleanup checkpoints |

The public [connection example](connection.example.json), [capability example](capabilities.example.json), [inventory example](host-connectors/inventory.example.json) and [empty progress](inbox-state.example.json) are templates, not live configuration. Existing candidate information, credentials and browser sessions stay where they are.

```shell
npm run email:discover
npm run email:select -- --candidate ACTUAL_ID --source-reference PRIVATE_USER_REPLY --rule-reference PRIVATE_ALERT_RULES --rules-revision ACTUAL_VERSION
npm run email:cleanup -- --mode retain --effect retain --source-reference PRIVATE_USER_REPLY
npm run email:capabilities -- --file .local/actual-email-capabilities.json
npm run email:status
npm run email:help
```

`discover` reads metadata and bounded existing AgentMail configuration; it does not discover every host's tools itself. The agent supplies the actual host inventory first. `select` preserves an existing choice unless a new user choice is explicitly recorded, and refuses a source switch with unresolved existing alert work. `classify` records observed classification from a private header file. These CLI commands perform no provider network operation or cleanup. Run native tools or the injected transport with the shared policy when doing authorized application work. After a newly selected AgentMail backend is bound, record its actual source as a candidate and reuse that original user choice; choose cleanup through shared onboarding. Use migration only when an existing cleanup instruction is actually available. A backend binding alone does not authorize a new cleanup effect.

## Existing setup and relocation

Run `npm run email:migrate -- --policy-reference ACTUAL_LEGACY_POLICY_REFERENCE` for an existing AgentMail setup. The helper keeps the old binding/credential files untouched, imports the selected mailbox and existing cleanup instruction, and converts schema-1 progress without dropping task pointers, conversations or extra metadata. It performs no API request. Old deleted checkpoints retain legacy provenance; migration is not a new live verification and invents no historical observation date. A malformed or mismatched ledger is preserved for investigation.

On another machine, transfer private selections/progress securely and reconnect the actual source. A reference does not transfer OAuth credentials or prove tool availability. Revalidate the affected access, root and scheduled conditions; preserve candidate answers and completed-message markers. See [host connectors](host-connectors/README.md) and the [AgentMail adapter](agentmail/adapter.ts).
