# Job Context

You supply candidate facts and application instructions through your CVs and conversation. [Onboarding](../Application%20Workflow/onboarding-workflow.md) lets the agent record and maintain those answers here without manual file editing. The agent maintains website observations separately in [Site Architecture Context](../Site%20Architecture%20Context/README.md). Observed website behavior cannot invent a candidate answer or change a preference.

**State:** templates only. No candidate identity, CV, enabled role or platform access has been supplied.

| Location | Use |
| --- | --- |
| [Candidate](Candidate/README.md) | Independent role profiles and the routing rules that select one |
| [LinkedIn access](Job%20Boards/LinkedIn/access-and-instructions.md) | Account/session and application-channel instructions |
| [Indeed access](Job%20Boards/Indeed/access-and-instructions.md) | Account/session and application-channel instructions |
| [Glassdoor access](Job%20Boards/Glassdoor/access-and-instructions.md) | Account/session and application-channel instructions |
| [CryptoJobsList access](Job%20Boards/CryptoJobsList/access-and-instructions.md) | Account/session and application-channel instructions |

For each human template, use an adjacent ignored `*.local.md` for actual private values. The local counterpart replaces the template; the agent reads only that version. This is a private-file convention, not a duplicated Shared context. See [private setup](../SETUP.md#private-working-information).

The selected role supplies all candidate-specific information. Platform files describe access and platform restrictions; they do not maintain another CV or candidate biography. Application onboarding records one to three primary boards and maps their observed navigation. New portals and external destinations can also be added when required by a real assignment. Account access and initial site-mapping completion are separate checks.

[Job-board credential setup](Job%20Boards/README.md) supports an ignored `.env` in each board folder. The public `.env.example` files contain commented email/password placeholders. Store actual login values only in private `.env` files or a secure store; private access Markdown records their paths/key names rather than passwords. The agent explicitly loads the selected file when authenticating in the browser.

For a blocker, reply with the missing answer or provide the requested access action. The agent updates the precise private file named on the ticket, verifies the dependency is resolved and resumes the existing task. An unchanged file or incomplete answer does not restart an application.

Browser selection and operating choices are recorded privately during onboarding, not inferred from installed tools. Role profiles retain their own facts, answers, document versions and verification-email access references. The alert-inbox configuration is separate. The agent asks for relevant missing information and saves the response; users do not need to fill these templates manually.
