# Set up AgentMail email-alert intake

Email onboarding checks existing access before requesting setup details. Reuse a suitable configured integration; ask for an API key only when no usable connection exists. The agent handles inbox IDs and discovery. Manual tasks and candidate-profile setup need no email account.

## 1. Detect existing access first

Before asking the user to install AgentMail or enter a key, the agent:

1. Reads the current private integration references and checks the agent environment's available authenticated connectors/tools and installed AgentMail skills. Inspect their actual instructions, account scope and supported operations. An installed skill alone is not a configured connection.
2. Runs `npm run inbox:detect` for the included client. [connection.ts](connection.ts) checks saved source references, project configuration, known user-level AgentMail skill locations and an available AgentMail environment key. It returns only configured/unconfigured status and nonsecret source references. It makes no network request, writes no files and performs no broad disk search.
3. Reuses a suitable authorized connection. Keep its key in its original secret source; do not copy it into the project. For a connected tool, use its actual supported operations. For an existing environment file, the agent can pass `--credential-file <detected-path>` to the included runner. An explicitly selected process environment uses `--use-environment`. These are agent-managed options, not user onboarding fields.
4. Checks the actual scope before using the account. A test-only skill, a restricted mailbox, an incompatible endpoint or a tool denial is not automatically suitable for job alerts. Do not bypass that restriction using another transport, repurpose another project's inbox or silently choose a different account. Resolve genuine account/purpose ambiguity in plain language; do not request technical IDs.
5. Verifies actual inbox/header access before reporting readiness. Detection means configuration was found, not that it is authenticated, suitable or reachable. A broken existing connection needs its actual repair or reconnection; do not restart the user's entire setup questionnaire.

Local detection covers `CODEX_HOME/skills/agentmail` (defaulting to the user's `.codex` directory), `.agents/skills/agentmail` and `.claude/skills/agentmail`. Other agent environments use their actual tool/skill inventory and explicit configured references; the CLI cannot enumerate every host's connected services. Do not search unrelated projects or dump configuration files.

If no suitable connection can be reused, create ignored `automation/.env` from [the blank example](../../.env.example) only when absent. Ask the user to enter `AGENTMAIL_API_KEY` locally and uncomment its assignment. Keep the key out of chat, Markdown, tickets, command arguments and logs. Preserve existing files and values.

The [HTTP client](client.ts) and [inbox discovery client](inboxes.ts) work without a separate skill installation. [Official skill installation](https://www.agentmail.to/docs/integrations/skills) is an optional alternative, not a prerequisite:

```shell
npx skills add agentmail-to/agentmail-skills
```

Account signup, a permission denial or a provider quota still needs its actual resolution. Do not rotate keys, upgrade plans or delete other inboxes to work around an error. A pending key question becomes redundant when existing usable access is established; update private onboarding progress instead of asking it again.

## 2. Discover or provision the intake inbox

The agent follows these rules:

1. List every page of inboxes accessible with this key. Reuse the binding in ignored `.local/agentmail-intake.json` when it remains accessible and active. A saved inbox that is unavailable is an access dependency; preserve existing application/message records instead of silently routing them elsewhere.
2. Without a binding, use the sole active inbox, or a unique existing inbox named `Job application alerts`.
3. If there are several plausible inboxes, resolve the choice from existing project context and relevant job-alert headers. The setup tool returns candidate metadata to the agent. The agent obtains and records the actual ID itself; it never asks the user to type one. If context cannot establish intent, ask a plain-language clarification about the mailbox, only for that genuine ambiguity.
4. If no active inbox exists, email-mode setup provisions one named `Job application alerts`. Persist a unique `client_id` before the first create request and reuse it on retry. [AgentMail documents this idempotent creation](https://docs.agentmail.to/knowledge-base/creating-first-inbox); restarts must not allocate duplicate inboxes.
5. Save the resolved inbox ID and creation identity, where applicable, in `.local/agentmail-intake.json`. The API key stays only in its secret source. Tell the user the discovered address when it is useful; do not replace the candidate's CV/contact email with it.

The normal public environment template contains no inbox-ID field. An existing advanced `AGENTMAIL_INBOX_ID` override is supported for compatibility, but onboarding does not request or require it.

Discovery uses [GET /v0/inboxes](https://docs.agentmail.to/api-reference/inboxes/list); provisioning uses [POST /v0/inboxes](https://docs.agentmail.to/api-reference/inboxes/create). These operations run under the supplied key's permissions. No existing inbox is deleted to make room.

## 3. Run setup and check access

From the repository root, the agent detects existing setup before configuring access:

```shell
npm ci
npm run inbox:detect
npm run inbox:setup
```

If detection found an existing skill/file, the agent first reads its scope and selects it with `npm run inbox:setup -- --credential-file <detected-path>`. Once header access succeeds, setup stores only its source reference in `.local/agentmail-connection.json`; future runs reuse that source. An authenticated connector follows equivalent operations and records its nonsecret tool reference in private shared progress.

This builds the [setup runner](setup.ts), discovers the mailbox, provisions one only when needed, stores its binding and checks paginated message-header access. It sends no emails, deletes no mail, reads no message bodies and starts no schedule. An empty inbox can be reachable while still awaiting its first alert.

`npm run inbox:check` accepts the same existing-source options and is the read-only alternative: it lists inboxes and checks headers without provisioning or writing binding state. A first setup with no mailbox uses `inbox:setup` instead. For an ambiguous candidate list, the agent can use the runner's `--select` option with an ID it has obtained from the provider; this is internal routing, not a user onboarding field.

| Result | Agent action |
| --- | --- |
| Exit `0`, `inboxReachable: true` | Save the discovered address, actual date/method and header-access status privately |
| Exit `2` | No local connection is selected/found; inspect available host connectors before requesting a new API key |
| Exit `4`, `needsAgentConnection` | Existing configuration was detected; inspect its scope and select the appropriate source without copying the key |
| Exit `3`, `needsAgentSelection` | Resolve the returned candidates using context/header evidence, then save the selection |
| Other exit `3` | Investigate the saved connection, source or inbox state while preserving existing work |
| Exit `1` | Resolve the actual HTTP/network/response problem; do not fabricate readiness |

Connected skills/connectors perform equivalent discovery and header checks. Respect their restrictions; changing transport is not a workaround for a denial. Header access does not verify message-body access or completed-alert deletion. Offline tests use mocks and establish no live inbox access.

## 4. Arrange alerts and retain progress

The agent records nonsecret setup in `unified_project_context.local.md`: discovered inbox, binding reference, relevant alert-selection rules, integration method, secret-file/key reference and actual access status. It derives rules from supplied target boards and application instructions, asking only for missing intent. Scheduling cadence/timezone is collected only when scheduling is requested.

Using the supplied job-board access and candidate preferences, the agent helps arrange job alerts to reach the discovered address through supported board settings. Missing sign-in/MFA or a board restriction is a specific dependency; the user is not asked to supply technical inbox IDs. Do not change the candidate's primary account email or send a practice email just to populate the inbox.

On the first matching alert, follow [email processing and cleanup](README.md#email-processing-and-cleanup): enumerate every vacancy, create its Email Alerts tasks and retain source associations in `.local/inbox-state.json`. Keep unresolved alerts. Delete only an individual fully handled source message after the existing persistence checks. Exclude OTPs, receipts and recruiter replies from alert cleanup.

Before any application task exists, retain incomplete setup as its exact onboarding question or access dependency, without inventing a job ticket. Resume after a relevant change. An unchanged check-in repeats neither unanswered questions nor failed access checks.
