# Pause for human CAPTCHA completion, then resume the same application

A CAPTCHA is a human-access dependency. Preserve the application and move its existing ticket to **Blocked** immediately, including when the user is away. Continue independent eligible work. Complete this procedure within the user's application instructions; it adds no routine application approval gate.

## Recognize the boundary

Inspect the current rendered form and its frames before final submission. The read-only [hCaptcha inspector](captcha-inspection.ts) recognizes the observed checkbox-widget title and reads its checked state. It never clicks a CAPTCHA, examines a puzzle, or reads, stores or injects a response token. Other challenge types need observed site-specific recognition and this same handoff procedure; this helper does not claim universal CAPTCHA detection.

`humanRequired` means pause. `unknown` means investigate the current page and retain the dependency if clearance cannot be established. `notObserved` is not clearance when the site map or this task already records a CAPTCHA requirement: the widget may still be loading or may have failed. Recheck the live page immediately before the final action; a historical checked state can expire.

## 1. Save and block

Save a private checkpoint with the existing task ID, original intake, vacancy and destination, selected role/CV version and hash, last completed step, draft reference when available, logical browser/session reference, observed challenge evidence and access instructions. Reference private candidate files rather than copying form answers. Do not store CAPTCHA tokens, signed URLs or browser credentials.

Use `pauseForCaptcha` from [captcha.ts](captcha.ts). Keep `submissionAttempted` if the challenge appeared after a submit action; investigate that application's outcome before any retry. Preserve another unresolved dependency instead of overwriting it. Retain previous handoff and attempt history.

Persist the returned task in its existing Markdown ticket, then move that ticket to Blocked using [board transitions](../../Task%20Board/README.md#blocking-and-resumption). The helpers validate and return task data; they do not move files, run a background agent or send notifications. For email-derived work, update the task-path association before writing the moved ticket through `email:work artifact`, then update its hash and blocked vacancy disposition through the [protected alert store](../email/alert-completion.md). Respect the cleanup owner; never bypass an owned pending operation with a direct file write.

Report through the configured, available reporting route or the current conversation:

> This application needs CAPTCHA verification and is now Blocked. When you are available, ask me to resume this task so you can complete the challenge in its browser. I can continue other eligible applications. The source alert will remain until its remaining jobs are resolved.

Name the employer and task so the user can find it. For a headless, closed or inaccessible session, state that browser recovery is needed before presenting a usable challenge. A ticket comment is a recorded request; it is not proof that an external notification was delivered. Call `recordCaptchaRequest` only with the actual comment/message reference.

## 2. Wait without repeated prompts

The user does not need to respond during that check-in. `captchaNextAction` returns `wait` after the recorded request while there is no relevant response. Preserve the ticket, checkpoint and source email without rewriting timestamps or repeating the unanswered request. A scheduled check-in can continue other work and finish normally; it does not keep a process alive indefinitely waiting for a person.

Respect the task claim while checkpointing. Release or transfer execution ownership through the normal board procedure after the current worker has stopped; another worker must not race the same browser or form. Waiting does not authorize stealing another active worker's session. Browser availability is best effort: time, system restart and site policy can expire the session, draft or challenge. Never promise that an open tab will survive indefinitely.

## 3. Let the user complete the challenge

On an explicit user request, open the named saved task and establish execution ownership. Routine check-ins do not inspect Blocked. Their readiness message starts the handoff; it is not evidence that CAPTCHA is cleared. Prefer the same visible browser session and draft. Pause agent interaction while the person uses it. Do not switch Playwright to an in-app browser for automated CAPTCHA solving, use a solver service, transfer challenge tokens, or circumvent site/tool restrictions.

If the session expired or cannot be shown, establish an authorized accessible session in the same browser backend. Check that no submission already occurred before restoring this same vacancy's draft. Reauthenticate through the existing access instructions when required. Reinspect restored answers and the uploaded CV; a local upload often needs selecting again. Preserve the same task and original document references. An uncertain result, missing draft, tool denial or unavailable visible browser stays Blocked with that exact recovery action. Do not claim a headless session became visible without actually establishing access. The user may need to complete a newly presented challenge.

## 4. Verify, return to intake and submit once

Use `resolveCaptcha` only after actual same-vacancy/session checks and current submission-outcome evidence. For an unsubmitted application, require human-completion evidence, current challenge clearance, inspected fields/CV and either the same session/draft or documented safe restoration. A changed role/CV requires reconciling the original checkpoint explicitly, not silently substituting documents. Resolution returns the task to `working` for a fresh form review.

Save the actual resolution. The user moves the same ticket to To Do to requeue it; reconcile that selected ticket’s email pointer through the protected store without scanning other Blocked tasks. Recheck required fields, candidate identity, document and challenge immediately before submission. Call `assertCaptchaInspection(inspection, true)` for a known hCaptcha requirement, then `markSubmissionAttempted(task, root, currentPage)` with registered site/access evidence after preparing the task. Persist that checkpoint before clicking Submit once. Only an actual matching confirmation permits Applied.

For a prior uncertain submit, inspect the original result first. If a matching application confirmation already exists, `resolveCaptcha` can record `outcome: confirmed` and preserve the receipt without another human challenge or submission. Use the user-requeued To Do ticket before Applied. If the outcome is unknown, retain Blocked. Only an evidenced not-submitted outcome permits normal restoration, human completion and fresh review.

Resolved handoffs stay on the ticket. A new or expired challenge gets a new handoff ID; a previous clearance cannot resolve it. `canMarkApplied`, board resumption and browser-routing helpers reject an unresolved handoff even when a caller supplies a confirmation flag.

## Email alerts and setup-only discovery

One CAPTCHA-blocked vacancy keeps a multi-job alert unresolved. Siblings can reach Applied; their identities and confirmations remain unchanged. Cleanup is eligible only after the existing [whole-alert verification](../email/alert-completion.md) checks every source posting and actual outcome. An email cleanup failure never triggers another job submission.

During setup or read-only mapping, record a challenge boundary in onboarding/site knowledge instead of creating a fake application ticket. No real employer form is submitted just to test this handoff. The [Tezza example](../../Site%20Architecture%20Context/Direct%20applications/Tezza%20Business%20Solutions/architecture.md) records a public observed boundary; its post-CAPTCHA submission journey remains unlearned.
