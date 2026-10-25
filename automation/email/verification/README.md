# Application-email verification

Mailbox selection is already part of [email onboarding](../README.md#onboarding-and-account-selection). Reuse the user's saved selection; do not ask them to select it again or set up the same mailbox twice.

Check where the job-site account actually sends verification messages:

| Verification destination | Agent action |
| --- | --- |
| The selected email mailbox | Reuse its existing authorized connection and mailbox binding; reference them in the role's private verification instructions |
| A different email address | Reuse suitable existing access to that address, or establish a human code/link handoff only when needed |
| An authenticator app, SMS or another MFA method | Use that method's authorized handoff; mailbox access alone does not complete it |

Do not change the candidate's contact address or job-site account email to match the alert inbox without an applicable user instruction. Reusing a mailbox connection does not mean an OTP was already received or read: retain the actual access scope and label unexercised actions accurately.

During onboarding, read the selected role's contact-email source, relevant job-site account instructions and `verification-access.local.md` when present. First compare the verification destination with the saved email account/mailbox. For a different address only, detect suitable existing authorized tools and sessions before asking about missing access. Establish one usable method: scoped agent access to that mailbox, an existing authorized session, or a clear human handoff for a code/link. Keep only the connection/account reference and permitted scope in context. Do not request a password or recovery code in ordinary chat.

For a human handoff, save the current task or onboarding checkpoint and explain the exact sign-in/code action. The user can enter the code directly or provide it through an appropriate secure interface. Resume the same session after checking actual success. Keep OTP values, signed links and session secrets out of committed files and reusable site maps. Do not bypass MFA or CAPTCHA.

Verification readiness means a known, usable route and its limitations, not a guarantee that all future challenges are automatic. Human-assisted OTP is a valid documented method; it may require a later task to wait in Blocked. Recurring mode must disclose that dependency. If no challenge is encountered during legitimate setup, record it as not exercised rather than sending a test email or creating an account solely to generate one.

Read only the messages required for the current authorized verification. Recruiter replies, receipts and OTPs are not job alerts and must not be deleted by completed-alert cleanup. Mailbox selection for alert intake stays under [shared email setup](../README.md#onboarding-and-account-selection).
