# Application-email verification

The address receiving job alerts can differ from the candidate address used to register or apply. Access to an AgentMail alert inbox does not establish access to the application email, its OTPs or its magic links.

During onboarding, read the selected role's contact-email source and `verification-access.local.md` when present. Detect suitable existing authorized tools and sessions before asking the user to configure another connector. Establish one usable method: scoped agent access to that mailbox, an existing authorized session, or a clear human handoff for a code/link. Keep only the connection/account reference and permitted scope in context. Do not request a password or recovery code in ordinary chat.

For a human handoff, save the current task or onboarding checkpoint and explain the exact sign-in/code action. The user can enter the code directly or provide it through an appropriate secure interface. Resume the same session after checking actual success. Keep OTP values, signed links and session secrets out of committed files and reusable site maps. Do not bypass MFA or CAPTCHA.

Verification readiness means a known, usable route and its limitations, not a guarantee that all future challenges are automatic. Human-assisted OTP is a valid documented method; it may require a later task to wait in Blocked. Recurring mode must disclose that dependency. If no challenge is encountered during legitimate setup, record it as not exercised rather than sending a test email or creating an account solely to generate one.

Read only the messages required for the current authorized verification. Recruiter replies, receipts and OTPs are not job alerts and must not be deleted by completed-alert cleanup. Mailbox selection for alert intake stays under [AgentMail setup](../agentmail/setup.md).
