# Set up AgentMail email-alert intake

This page configures AgentMail only. Begin with [shared email onboarding](../README.md#onboarding-and-account-selection); a suitable existing Gmail, Outlook or other harness connection needs no AgentMail setup.

AgentMail onboarding checks existing access before requesting setup details. Reuse a suitable configured integration; ask for an API key only when no usable connection exists. The agent handles inbox IDs and discovery. Manual tasks and candidate-profile setup need no email account.

## 1. Detect existing access first

Before asking the user to install AgentMail or enter a key, the agent:

1. Reads the current private integration references and checks the agent environment's available authenticated connectors/tools and installed AgentMail skills. Inspect their actual instructions, account scope and supported operations. An installed skill alone is not a configured connection.
2. Runs `npm run inbox:detect` for the included client. [connection.ts](connection.ts) checks saved source references, project configuration, known user-level AgentMail skill locations and an available AgentMail environment key. It returns only configured/unconfigured status and nonsecret source references. It makes no network request, writes no files and performs no broad disk search.
3. Reuses a suitable authorized connection. Keep its key in its original secret source; do not copy it into the project. For a connected tool, use its actual supported operations. For an existing environment file, the agent can pass `--credential-file <detected-path>` to the included runner. An explicitly selected process environment uses `--use-environment`. These are agent-managed options, not user onboarding fields.
4. Respects actual provider/account permissions, incompatible endpoints and tool denials. A generic skill’s QA/test-oriented wording does not establish an account-wide restriction. Do not insert a blanket account-reuse approval question. List the inboxes and let the user choose the address for this workflow; an already supplied choice is sufficient. Do not use other inboxes for message access or bypass an actual denial.
5. Verifies actual inbox/header access before reporting readiness. Detection means configuration was found, not that it is authenticated, suitable or reachable. A broken existing connection needs its actual repair or reconnection; do not restart the user's entire setup questionnaire.

Local detection covers `CODEX_HOME/skills/agentmail` (defaulting to the user's `.codex` directory), `.agents/skills/agentmail` and `.claude/skills/agentmail`. Other agent environments use their actual tool/skill inventory and explicit configured references; the CLI cannot enumerate every host's connected services. Do not search unrelated projects or dump configuration files.

If no suitable connection can be reused, create ignored `automation/.env` from [the blank example](../../.env.example) only when absent. Ask the user to enter `AGENTMAIL_API_KEY` locally and uncomment its assignment. Keep the key out of chat, Markdown, tickets, command arguments and logs. Preserve existing files and values.

The [HTTP client](client.ts) and [inbox discovery client](inboxes.ts) work without a separate skill installation. [Official skill installation](https://www.agentmail.to/docs/integrations/skills) is an optional alternative, not a prerequisite:

```shell
npx skills add agentmail-to/agentmail-skills
```

Account signup, a permission denial or a provider quota still needs its actual resolution. Do not rotate keys, upgrade plans or delete other inboxes to work around an error. A pending key question becomes redundant when existing usable access is established; update private onboarding progress instead of asking it again.

## 2. List inboxes and use the user's choice

1. List every page of inbox metadata with the detected connection. Present each inbox's address and optional display name; label a paused inbox as unavailable. Do not inspect message headers or bodies to guess the user's preferred mailbox.
2. Reuse a saved confirmed choice on later runs. On first setup, ask “Which inbox would you like to use?” even if there is only one inbox or one is named `Job application alerts`. The user chooses an address from the displayed options; no provider-ID lookup is required.
3. If the user has already named an inbox, verify that address against the list and use it without asking again. Resolve its provider ID internally. An absent, paused or ambiguous requested address is a specific dependency; do not silently choose another inbox or create a replacement.
4. Save the selected inbox ID with `selectionMethod: "user"` in private `.local/agentmail-intake.json`. Old bindings without selection provenance are preserved while obtaining the user's first choice. A confirmed saved choice is not requested again.
5. Only when the account contains no inboxes, email setup may create a purpose-specific inbox using the persisted provider `client_id`. [AgentMail documents idempotent creation](https://docs.agentmail.to/knowledge-base/creating-first-inbox); retries reuse that identity and save `selectionMethod: "created"`. If the user requested an existing address that was not found, investigate that failure rather than creating an inbox. Paused inboxes do not make an account empty.
6. Verify header access only for the chosen inbox, then save the credential-source reference. The API key remains in its original source. Do not replace the candidate's CV/contact email with the alert address.

An existing advanced `AGENTMAIL_INBOX_ID` override is treated as an explicit choice for compatibility; ordinary onboarding does not request it. The user chooses an email address, and the agent handles its ID.

Listing uses [GET /v0/inboxes](https://docs.agentmail.to/api-reference/inboxes/list); empty-account creation uses [POST /v0/inboxes](https://docs.agentmail.to/api-reference/inboxes/create). No existing inbox is deleted or modified to configure this workflow.

## 3. Run setup and check access

From the repository root, the agent detects existing setup before configuring access:

```shell
npm ci
npm run inbox:detect
npm run inbox:list
```

For an existing skill/file, the agent lists inboxes using `npm run inbox:list -- --credential-file <detected-path>`. It asks for the address unless the user already supplied it, then runs `npm run inbox:setup -- --credential-file <detected-path> --select-address <chosen-address>`. Once the chosen inbox’s header access succeeds, setup stores only its source reference in `.local/agentmail-connection.json`; future runs reuse that source and confirmed mailbox choice. An authenticated connector follows equivalent operations and records its nonsecret tool reference in private shared progress.

This builds the [setup runner](setup.ts), resolves the chosen mailbox (or creates one only under the empty-account rule), stores its binding and checks paginated message-header access. It sends no emails, deletes no mail, reads no message bodies and starts no schedule. An empty inbox can be reachable while still awaiting its first alert.

`npm run inbox:check` accepts the same existing-source options and is the read-only alternative: it lists inboxes and checks headers without provisioning or writing binding state. A first setup with no mailbox uses `inbox:setup` instead. Use `--select-address` for the user’s supplied address. The legacy `--select` option accepts a provider ID resolved internally by the agent. Both selection options also work with the read-only check, without saving bindings. `inbox:list` reads inbox metadata only and never reads messages or creates/binds an inbox.

| Result | Agent action |
| --- | --- |
| Exit `0`, `inboxReachable: true` | Save the discovered address, actual date/method and header-access status privately |
| Exit `2` | No local connection is selected/found; inspect available host connectors before requesting a new API key |
| Exit `4`, `needsAgentConnection` | Existing configuration was detected; inspect its scope and select the appropriate source without copying the key |
| Exit `3`, `needsUserInboxChoice` | Present the returned inbox addresses and ask which to use; if already supplied, resolve that choice without repeating the question |
| Other exit `3` | Investigate the saved connection, source or inbox state while preserving existing work |
| Exit `1` | Resolve the actual HTTP/network/response problem; do not fabricate readiness |

Connected skills/connectors perform equivalent discovery and header checks. Respect their restrictions; changing transport is not a workaround for a denial. Header access does not verify message-body access or completed-alert deletion. Offline tests use mocks and establish no live inbox access.

## 4. Arrange alerts and retain progress

The agent records nonsecret setup in `unified_project_context.local.md`: discovered inbox, binding reference, relevant alert-selection rules, integration method, secret-file/key reference and actual access status. It derives rules from supplied target boards and application instructions, asking only for missing intent. Scheduling cadence/timezone is collected only when scheduling is requested.

Using the supplied job-board access and candidate preferences, the agent helps arrange job alerts to reach the discovered address through supported board settings. Missing sign-in/MFA or a board restriction is a specific dependency; the user is not asked to supply technical inbox IDs. Do not change the candidate's primary account email or send a practice email just to populate the inbox.

On the first matching alert, follow [email processing and cleanup](README.md#email-processing-and-cleanup): enumerate every vacancy, create its Email Alerts tasks and retain source associations in `.local/inbox-state.json`. Keep unresolved alerts. Delete only an individual fully handled source message after the existing persistence checks. Exclude OTPs, receipts and recruiter replies from alert cleanup.

Before any application task exists, retain incomplete setup as its exact onboarding question or access dependency, without inventing a job ticket. Resume after a relevant change. An unchanged check-in repeats neither unanswered questions nor failed access checks.

## Shared setup entry point

This page configures the AgentMail backend only. Start with [provider-independent onboarding](../README.md#onboarding-and-account-selection). A user who chooses a suitable existing Gmail, Outlook or other harness connection does not need these API-key/inbox commands. Existing AgentMail selections and original credential sources are retained by [shared migration](../README.md#existing-setup-and-relocation). Its header check remains useful evidence of that limited operation; record full body/cleanup/scheduled capabilities separately before marking broader email intake ready.
