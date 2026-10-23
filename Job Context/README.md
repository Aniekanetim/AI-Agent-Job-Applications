# Job Context

Humans maintain candidate facts and application instructions here. The agent reads this information and maintains its observations separately in [Site Architecture Context](../Site%20Architecture%20Context/README.md). Observed website behavior cannot invent a candidate answer or change a preference.

**State:** templates only. No candidate identity, CV, enabled role or platform access has been supplied.

| Location | Use |
| --- | --- |
| [Candidate](Candidate/README.md) | Independent role profiles and the routing rules that select one |
| [LinkedIn access](Job%20Boards/LinkedIn/access-and-instructions.md) | Account/session and application-channel instructions |
| [Indeed access](Job%20Boards/Indeed/access-and-instructions.md) | Account/session and application-channel instructions |
| [Glassdoor access](Job%20Boards/Glassdoor/access-and-instructions.md) | Account/session and application-channel instructions |
| [CryptoJobsList access](Job%20Boards/CryptoJobsList/access-and-instructions.md) | Account/session and application-channel instructions |

For each human template, use an adjacent ignored `*.local.md` for actual private values. The local counterpart replaces the template; the agent reads only that version. This is a private-file convention, not a duplicated Shared context. See [private setup](../SETUP.md#private-working-information).

The selected role supplies all candidate-specific information. Platform files describe access and platform restrictions; they do not maintain another CV or candidate biography. New portals and external destinations can be added when required by a real assignment.

For a blocker, update the precise file named on its ticket. The agent verifies that the missing answer/access is actually resolved and resumes the existing task. An unchanged file or incomplete answer does not restart an application.
