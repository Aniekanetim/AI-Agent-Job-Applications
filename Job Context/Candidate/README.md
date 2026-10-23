# Candidate role profiles

Each role profile is a complete application context: identity, experience, preferences, answers, instructions and a designated CV. There is no Shared candidate folder. Website navigation is independent of the candidate role.

Tell the agent which roles you want and provide their CVs. [Conversational onboarding](../../Application%20Workflow/onboarding-workflow.md) fills these files, asks only for missing details and saves your replies automatically. You can correct an answer in conversation later; direct file editing is optional. Existing profiles are reused when setup resumes.

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
