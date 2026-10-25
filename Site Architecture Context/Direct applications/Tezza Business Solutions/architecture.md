# Tezza Business Solutions — CATS application boundary

## OBS-TEZZA-001: Manual / Functional Test Engineer application form

- **State:** public form and hCaptcha boundary observed on 26 October 2026. Submission, confirmation and saved-draft recovery remain unlearned.
- **Origin:** a directly supplied URL; no originating job board was observed.
- **Listing:** <https://tezzasolutions.catsone.com/careers/23509/jobs/16843859-Manual-Functional-Test-Engineer>.
- **Application:** <https://tezzasolutions.catsone.com/careers/23509/jobs/16843859-Manual-Functional-Test-Engineer/apply>.
- **Session:** fresh public Playwright browser; no candidate account, field entry or document upload.

The page identifies Tezza Business Solutions LLC and the role. Its description states Contract and fully onsite. Evaluate a real assignment against the candidate's actual preferences before completing any form. This observation is not an instruction to apply or an exception to remote-only preferences.

The accessible form shows a required resume upload, name, email, government ID, desired annual pay and screening questions. Near the bottom, the hCaptcha checkbox appears above **Submit Application**. Its iframe title is `Widget containing checkbox for hCaptcha security challenge`; the visible checkbox is labelled “I am human”. Initial form rendering can precede widget loading. A missing checkbox on an early snapshot does not establish that the application has no challenge.

Use [the read-only inspector](../../../automation/browser/captcha-inspection.ts) after confirming this host, form and widget. If human completion is needed, follow [CAPTCHA handoff](../../../automation/browser/captcha-handoff.md). Leave the challenge to the person; never probe the puzzle or invoke Submit to discover the next screen.

Only this vacancy's public form was inspected. Required field acceptance, resume restrictions, draft persistence, challenge expiry behavior, post-submit navigation and confirmation signals have not been established. Do not generalize these observations to other CATS employers or invent hidden endpoints. Revisit affected knowledge when this host, vacancy, widget title or visible form changes. Private evidence belongs in the working copy, not this reusable map.
