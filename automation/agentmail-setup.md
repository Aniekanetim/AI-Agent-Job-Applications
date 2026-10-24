# Set up AgentMail email-alert intake

Use this setup when the user selects email alerts. A manual To Do task and candidate-profile setup need no email account. The agent gathers the missing settings, saves nonsecret references privately and checks actual read access before calling intake ready.

## 1. Choose the inbox and integration

Ask which AgentMail inbox should receive job alerts and whether the user already has a connected AgentMail skill or connector. Reuse supplied settings; do not ask again or choose an unrelated inbox from another project. The alert inbox does not replace the candidate's CV/contact email unless the user explicitly requests that change.

If an AgentMail skill is available, read its actual SKILL.md and check its capabilities and account restrictions. An installed skill is not proof of access to the selected inbox. Keep existing skill configuration intact; never copy another skill's private `.env` or credentials into this project.

If no suitable skill is installed and the user wants one, follow [AgentMail's official skill installation](https://www.agentmail.to/docs/integrations/skills):

```shell
npx skills add agentmail-to/agentmail-skills
```

Select the intended agent environment during installation and follow its reload instructions. Installing a skill does not connect this working copy, create an inbox or activate a schedule. A compatible authenticated connector can also be used. If no skill/connector is available, the included [HTTP client](agentmail.ts) provides the operations this workflow needs without a separate AgentMail SDK.

Respect tool and skill restrictions. A permission denial remains a dependency; changing transport is not a workaround. This intake needs paginated message headers, individual-message reads and eventual completed-message deletion. Do not substitute thread/inbox deletion for a missing operation.

## 2. Supply this project's access

For the included client, the agent creates ignored `automation/.env` from [.env.example](.env.example) only if the local file is absent. The user enters their actual values locally and uncomments the two assignments:

| Key | Value supplied by the user |
| --- | --- |
| `AGENTMAIL_INBOX_ID` | The exact inbox ID/address that will receive their job alerts |
| `AGENTMAIL_API_KEY` | An API key authorized for that inbox, obtained through their [AgentMail Console](https://console.agentmail.to/) |

Keep the API key out of chat, Markdown, tickets, command arguments and logs. The client loads only this working copy's file, without inheriting a globally configured account. An authenticated connector may use its own authorized secret mechanism; the local-file check below applies to the included client, not every connector.

If the user has no account/inbox, explain that requirement and help them use AgentMail's official setup when requested. Do not silently create a disposable test inbox or rotate an existing account's API key. Preserve existing files and values. Job-board passwords remain in their separate per-board `.env` files.

## 3. Check read access without sending or deleting

For the included client, run from the repository root after the values are supplied:

```shell
npm ci
npm run inbox:check
```

The [setup checker](agentmail-setup.ts) loads the project file, paginates message headers and prints only a count and the verification scope. It performs GET requests only: no message-body reads, test emails, deletions, task creation or scheduling. Empty inboxes can still be reachable.

| Result | Meaning / next action |
| --- | --- |
| Exit `0`, `inboxReachable: true` | Header listing worked for this configuration; record actual date/method privately |
| Exit `2` | The project file or required values are missing; ask the user to complete the local setup |
| Exit `1` | Access could not be verified; resolve the reported HTTP/network/response dependency |

For a connected skill/connector, perform the equivalent read-only list operation on the explicitly selected inbox and record that method. Do not run its send/receive smoke test. Reading message bodies and deleting completed alerts remain separately unverified until those authorized operations actually occur. The offline tests use mocked HTTP and do not establish live access.

## 4. Select the alerts and preserve progress

Ask which subscribed job-alert senders/subjects to process. Save the supplied selection rules, chosen inbox, integration/skill reference, credential-file/key reference and actual access status in `unified_project_context.local.md`. Never save the key itself. Scheduling cadence/timezone is collected only when scheduling is requested.

The user arranges for their job alerts to reach the selected inbox; the agent can assist with the relevant board settings under supplied instructions. Do not change the candidate's account email or send a test message just to populate the inbox. If no alerts have arrived, report “inbox reachable; alert intake awaiting its first matching message,” not a completed application.

On the first actual matching alert, follow [email processing and cleanup](README.md#email-processing-and-cleanup): enumerate every vacancy, create its Email Alerts tasks and save active associations in ignored `.local/inbox-state.json`. Preserve incomplete/blocked alerts. Delete only an individual fully handled source message after the existing persistence checks. Keep OTPs, receipts and recruiter replies outside alert cleanup.

If setup is incomplete before there is any application task, retain the exact pending setup question in onboarding progress; do not invent a job ticket. Resume from the real answer or access change. An unchanged check-in repeats neither the question nor a failed access check without a relevant change.
