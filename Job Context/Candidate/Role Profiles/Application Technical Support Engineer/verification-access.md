# Application Technical Support Engineer: application-email verification

**State:** Not configured. The contact email is defined in this role's profile; reference it here instead of duplicating it. Save actual values in `verification-access.local.md`.

| Item | Configured value |
| --- | --- |
| Contact-email source | role-profile.local.md; not supplied in this template |
| Authorized access method | Not supplied: existing connector/session or human handoff |
| Nonsecret account/connection reference | Not supplied |
| Permitted message scope | Only verification needed for the assigned application |
| OTP/MFA handoff and resume action | Not supplied |
| Interactive / recurring limitations | Not verified |
| Last access check / evidence | Not performed |

Follow [verification access](../../../../automation/email/verification/README.md). An AgentMail alert-inbox binding does not establish access to this address. Keep passwords, OTPs, signed links and recovery codes out of Markdown. A known human-assisted method can be recorded without pretending automated access was verified.
