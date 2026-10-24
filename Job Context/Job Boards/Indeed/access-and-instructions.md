# Indeed: access and application instructions

**State:** template; no account or site access verified. Tell the agent the relevant access instructions during onboarding; it records nonsecret account/session references in access-and-instructions.local.md. Navigation knowledge belongs in Site Architecture Context, not here.

| Field | Actual value |
| --- | --- |
| Portal URL / regional version | Not supplied |
| Candidate account / secure credential reference | Not supplied |
| Optional local credential file / keys | `.env`: `INDEED_EMAIL`, `INDEED_PASSWORD`; values not supplied |
| Session setup / MFA / human sign-in procedure | Not supplied |
| Permitted application channels / registration | Not supplied |
| Relevant employer destinations and their account references | Not supplied |
| Platform restrictions / known access limits | Not supplied |
| Access owner / last verified date | Not supplied |

For password sign-in, use the commented [.env.example](.env.example) to create an ignored `.env`, or use an authorized session/secure store. Follow [runtime loading](../README.md#load-credentials-for-browser-authentication). Keep passwords, OTPs, signed links and session tokens out of this file and tickets; access Markdown holds only nonsecret references. A platform restriction or challenge becomes a specific access blocker, not permission to bypass controls. Discovery learns ordinary allowed navigation under the candidate's instructions.
