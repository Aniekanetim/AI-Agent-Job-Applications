# Candidate role profiles

Each role profile is a complete application context: identity, experience, preferences, answers, instructions and a designated CV. There is no Shared candidate folder. Website navigation is independent of the candidate role.

Tell the agent which roles you want. [Conversational onboarding](../../Application%20Workflow/onboarding-workflow.md) asks for each role's PDF, DOCX or TXT CV, saves an unchanged private copy in its Documents folder, checks extraction and fills these files. It asks one focused missing decision at a time and saves every clear extra answer you volunteer. The [conversation checkpoint](../../automation/onboarding/focused-conversation.md) preserves pause/resume, clarification and corrections without repeating supplied information. You can correct an answer in conversation later; direct file editing is optional. Existing CVs and profiles are reused when setup resumes. Profile-only setup finishes after its scoped readiness handoff. Application setup also prepares browser tooling, connects and maps one to three selected job boards, and verifies readiness under [the full roadmap](../../Application%20Workflow/onboarding-workflow.md#1-agree-the-scope-and-show-the-roadmap).

Start with [role routing](role-routing.md). It lists enabled profile paths, vacancy-matching criteria and tie-breaking rules. Read that small index first, then the selected profile's documents. Do not load every CV and answer file for each job.

Two blank examples are provided:

- [Software QA Engineer](Role%20Profiles/Software%20QA%20Engineer/role-profile.md).
- [Application Technical Support Engineer](Role%20Profiles/Application%20Technical%20Support%20Engineer/role-profile.md).

Neither is enabled or a record of an actual person's experience. The agent creates private local counterparts from your CV and answers as described in [SETUP](../../SETUP.md#private-working-information).

## Profile contents

| File | Purpose |
| --- | --- |
| role-profile.md | Candidate identity/contact details, role identity and professional summary |
| experience-and-qualifications.md | Factual employment, responsibilities, skills, qualifications and supporting sources |
| job-preferences.md | Eligibility and selection rules for this role |
| application-answers.md | Factual reusable answers, including mandatory screening information |
| application-instructions.md | Tailoring/submission instructions and allowed handling of nonapplications |
| Documents/README.md | Exact CV filename/path, version and hash; optional supporting-document references |

For a third role, tell the agent its name and designated CV. It creates the same structure, supplies the private facts and adds the routing entry. Do not enable an empty example. Identity or employment inconsistencies must be resolved from supplied facts, not reconciled by inventing history or silently borrowing another profile.

Each task records the chosen role ID, paths and versions, CV hash and selection reason. If its destination is already populated from a different profile, inspect and correct the fields before proceeding. Use one selected role context throughout a given application unless the user's task explicitly supplies a different instruction.

## Verification and upload readiness

Each role also has `verification-access.md`, with actual private access references and OTP/MFA resumption in `verification-access.local.md`. It points to the contact-email source without copying candidate identity. Reuse the selected email connection when it also receives verification messages; another address or challenge may need its own access or human handoff. Keep original and designated upload CV versions in the existing Documents index, with hashes and inspection references; no separate Shared candidate baseline is introduced.
