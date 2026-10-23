# Implementation and verification

**Edition:** 1.0.0, prepared 23 October 2026.

## Source and adaptation

Source: [AI-Agent-Software-QA](https://github.com/Aniekanetim/AI-Agent-Software-QA), version 1.2.0 at revision `8771364309e9e236fd5bb3020ba72da093e52f79`.

Reused: separation of assignments and execution procedure, human context versus agent discoveries, claims/checkpoints, narrow refresh, explicit unknowns, retained history, truthful outcomes, no-op check-ins and portability. The discovery procedure is adapted rather than duplicated with QA approval requests.

Replaced: QA's five status folders and testing/retest/release gates. This package has Email Alerts, To Do, Blocked and Applied, no review gates, self-contained candidate role profiles and a job-application completion procedure. No Candidate/Shared layer. No source-project app, test evidence, private files or scheduler configuration was imported. The MIT notice is retained.

## Included components and operational limits

Markdown supplies the agent's workflow and empty human/site templates. TypeScript supplies a pure completion-policy module, a portable AgentMail list/read/delete helper and deliberately unlearned Playwright page/flow stubs. The AI agent still supplies reasoning and browser operation; this is not a standalone scheduled bot.

No candidate values, CV, enabled role, inbox key, logged-in browser, job submission or actual schedule is included. Public source directories describe the extensible shape, not complete knowledge of LinkedIn, Indeed, Glassdoor, CryptoJobsList, Workday or any employer. A routine becomes usable only through observed discovery and code updates.

The private *.local.md convention keeps personal context beside its approved template without publishing it. Only one version is read. Operational task and inbox metadata are ignored. This avoids a second shared candidate baseline.

## Verification record

On 23 October 2026, TypeScript checking and all 27 offline tests passed. The tests cover submission evidence, role/CV identity, blocked/resume routing, multi-vacancy completion, missing persistence, pagination, exact message deletion, URL encoding, sanitized errors and all six unlearned browser scaffolds. Synthetic values and mocked HTTP are used throughout. No browser login, job-alert inbox or live application was accessed.

All 79 relative documentation links/anchors resolved across 39 Markdown files. The board contains exactly four status folders and zero live tickets; Candidate/Shared is absent. Ignore-rule checks confirmed that local role values, CVs, all four folders' live tickets, inbox progress, credentials and sessions are excluded while public templates remain distributable. A scan of the 69 distributable files found no credential-pattern matches or machine-specific user paths.

Copied the distributable package to a separate temporary directory with spaces. All 78 links in that snapshot resolved; npm ci, TypeScript checking and all 27 offline tests passed there with a fresh dependency installation. One additional README setup link was subsequently added and checked in the final package. These are package and relocation checks, not proof that a live job portal permits or accepts automated submissions. The source QA projects and the existing hourly QA-board schedule were preserved.
