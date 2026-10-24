# Set up AgentMail email-alert intake

For email alerts, the user supplies only their AgentMail API key in private `automation/.env`. The agent discovers the inbox, saves its identity and configures intake. Do not ask the user to find, copy or enter an inbox ID. Manual To Do tasks and candidate-profile setup need no email account.

## 1. Collect the API key privately

The agent creates ignored `automation/.env` from [.env.example](.env.example) only if the file is absent. The user enters their key locally and uncomments `AGENTMAIL_API_KEY`. Keep the key out of chat, Markdown, tickets, command arguments and logs. The client reads only this working copy's file; never copy credentials from a global skill or another project.

The included [HTTP client](agentmail.ts) and [inbox discovery client](agentmail-inboxes.ts) make a separate skill installation unnecessary for this path. If an authorized AgentMail skill/connector is already available, the agent can use equivalent operations under its actual permissions. Check its capabilities without making the user choose a technical integration. [Official skill installation](https://www.agentmail.to/docs/integrations/skills) remains an optional agent-managed alternative:

```shell
npx skills add agentmail-to/agentmail-skills
```

A missing API key is a user input. Inbox IDs, discovery, routing and the integration method are agent work. Account signup, a permission denial or a provider quota still needs its actual resolution; a key cannot grant permissions it does not have. Do not rotate keys, upgrade plans, delete other inboxes or borrow another account to get around an error.

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

With the key supplied, the agent runs from the repository root:

```shell
npm ci
npm run inbox:setup
```

This builds the [setup runner](agentmail-setup.ts), discovers the mailbox, provisions one only when needed, stores its binding and checks paginated message-header access. It sends no emails, deletes no mail, reads no message bodies and starts no schedule. An empty inbox can be reachable while still awaiting its first alert.

`npm run inbox:check` is the read-only alternative: it lists inboxes and checks headers without provisioning or writing binding state. A first setup with no mailbox uses `inbox:setup` instead. For an ambiguous candidate list, the agent can use the runner's `--select` option with an ID it has obtained from the provider; this is internal routing, not a user onboarding field.

| Result | Agent action |
| --- | --- |
| Exit `0`, `inboxReachable: true` | Save the discovered address, actual date/method and header-access status privately |
| Exit `2` | Ask the user to supply the API key in the local file; do not ask for an inbox ID |
| Exit `3`, `needsAgentSelection` | Resolve the returned candidates using context/header evidence, then save the selection |
| Other exit `3` | Investigate the saved binding/state while preserving existing work |
| Exit `1` | Resolve the actual HTTP/network/response problem; do not fabricate readiness |

Connected skills/connectors perform equivalent discovery and header checks. Respect their restrictions; changing transport is not a workaround for a denial. Header access does not verify message-body access or completed-alert deletion. Offline tests use mocks and establish no live inbox access.

## 4. Arrange alerts and retain progress

The agent records nonsecret setup in `unified_project_context.local.md`: discovered inbox, binding reference, relevant alert-selection rules, integration method, secret-file/key reference and actual access status. It derives rules from supplied target boards and application instructions, asking only for missing intent. Scheduling cadence/timezone is collected only when scheduling is requested.

Using the supplied job-board access and candidate preferences, the agent helps arrange job alerts to reach the discovered address through supported board settings. Missing sign-in/MFA or a board restriction is a specific dependency; the user is not asked to supply technical inbox IDs. Do not change the candidate's primary account email or send a practice email just to populate the inbox.

On the first matching alert, follow [email processing and cleanup](README.md#email-processing-and-cleanup): enumerate every vacancy, create its Email Alerts tasks and retain source associations in `.local/inbox-state.json`. Keep unresolved alerts. Delete only an individual fully handled source message after the existing persistence checks. Exclude OTPs, receipts and recruiter replies from alert cleanup.

Before any application task exists, retain incomplete setup as its exact onboarding question or access dependency, without inventing a job ticket. Resume after a relevant change. An unchanged check-in repeats neither unanswered questions nor failed access checks.
