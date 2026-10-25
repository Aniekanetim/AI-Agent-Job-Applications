# Continue an upload application in Playwright

The in-app preference applies to each new task. Any application requiring a file upload uses Playwright, even when the selected host can upload files. This is the configured application rule, not a change to the user's default.

## Upload known before starting

Check the observed site map and designated CV requirements. Start the same task in Playwright, establish its authorized account/session, and verify the employer, vacancy and draft before entering data. Record the saved default and active browser on the ticket. Do not start an unnecessary in-app draft first.

## Upload discovered during in-app work

1. Stop before any final submission. Save the existing task ID, source vacancy identity, clean destination URL, selected role/CV version, completed fields and draft ID when visible. Keep personal field values in private context; the handoff references those files rather than duplicating them.
2. Record the last completed action, current page/step, evidence and next action on that same ticket. Use `saveUploadHandoff` in [fallback.ts](fallback.ts) when using the state helpers. No new ticket or board folder is created.
3. Open the authorized destination in Playwright. Authenticate through its own permitted session or credential reference. Do not assume cookies, tabs or drafts transfer between browsers, and do not bypass a denial or challenge.
4. Verify the same employer, vacancy and existing draft. If the draft is recoverable, inspect the retained values. If it is not, establish that no submission occurred and safely restore the prepared values under the same task; do not blindly create a second application. Missing access or an unresolved draft/outcome becomes a specific Blocked dependency.
5. Record actual session, vacancy, draft and submission-state checks, then call `resumeUploadHandoff` with their evidence. The pure helper validates recorded inputs; it does not authenticate a browser or prove that the evidence is true.
6. Upload the selected file, inspect its preview and finish that application in Playwright. Preserve the original checkpoint and handoff history. The next task returns to the saved default.

A CAPTCHA encountered in either browser follows [human handoff](captcha-handoff.md); it does not authorize another browser switch. Preserve the task and current browser, move to Blocked and wait for verified human completion.

If Submission attempted was already saved, investigate that same application's outcome first. Never switch browsers to click Submit again while the result is uncertain. Confirmed applications require no further browser work.

## Data retained on the task

Record default browser, active browser, upload requirement, and each handoff's task/vacancy identity, checkpoint reference, time, state and resume evidence. Keep signed links, cookies and credentials out of these records. `beginBrowserExecution`, `decideBrowser`, `saveUploadHandoff` and `resumeUploadHandoff` are policy/state helpers, not a browser driver or automatic ticket writer.
