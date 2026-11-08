# LinkedIn publishing

LinkedIn publishing is an optional workflow for personal-profile posts. It uses the app's pinned Playwright runtime and the authorized LinkedIn browser-state reference. Its drafts, preferences, evidence, ownership and native schedule are separate from job applications and blocked-task reminders. Existing workspaces start with publishing off.

## Configure and draft

Open Settings and choose **LinkedIn publishing**. Save the user's actual changes with `npm run publishing -- configure --file .local/publishing/requests/settings.json` and finish the menu edit with `npm run settings -- complete --source ACTUAL_REPLY_REF`. The agent prepares private proposal files. Credentials and cookies remain in their authorized browser-state file. Configure the exact profile URL from the authenticated member's profile menu, the visible audience, and the reference permitting that browser route.

```json
{
  "sourceReference": "actual-settings-reply",
  "timezone": "Africa/Lagos",
  "schedule": {
    "kind": "weekly",
    "everyWeeks": 1,
    "anchor": "2026-11-08",
    "slots": [{ "day": 2, "time": "09:00" }, { "day": 4, "time": "09:00" }]
  },
  "profile": {
    "voice": "Practical and conversational",
    "topics": ["Regression testing"],
    "facts": [{ "id": "example", "text": "A synthetic public-safe fact for this example." }]
  }
}
```

The schedule uses Sunday = 0 and a local anchor date for the first eligible week. One slot weekly, several slots weekly, every two weeks and other weekly intervals use the same rule. Monthly rules use `{"kind":"monthly","day":15,"time":"09:00"}`; use `"last"` for the last calendar day. On-demand uses `{"kind":"onDemand"}`. Preview the next times with `publishing -- brief`. An absent calendar day or a skipped clock minute has no slot. A repeated clock minute runs once at its first occurrence.

Use `brief` to choose a useful topic grounded in the public profile and avoid repeating recent posts. Draft in the user's voice, with specific claims grounded in the selected facts. The job board, reusable application answers, private CVs and inbox are outside this content context. A user-provided image or video can be the starting point for a post. The agent can search for online media relevant to the topic and stage a suitable licensed asset. Verify publication rights against the source, preserve attribution in the post and keep any private data or nonpublic material in the draft workflow.

Copy the selected file to `.local/publishing/media/` with a simple filename and record its actual SHA-256. The initial format set covers JPEG, PNG, WebP and MP4. The private proposal for `publishing -- draft --file …` contains `{ draft: { text, topic, facts, media? }, id? }`. The facts are IDs from the saved public profile. Media contains `{ path, sha256, kind, origin, rightsReference, url?, credit? }`. Online media uses a source HTTPS URL, a rights reference and a credit line in the post. User-supplied media uses its actual publication permission reference. Use `preview --id ID` for an existing draft and the same `id` when editing it.

Queue with `publishing -- queue --file …` and `{ id, at, recurring }`, using the exact UTC instant from the user choice or calendar preview. Queue the same ID to reschedule it. Use `skip --id ID` for a queued post. Save `paused: true` or `false` through configure. Missed posts stay available to reschedule. Schedule and timezone changes require rechecking recurring posts before dispatch. User-selected one-off dates stay explicit. Switching to on-demand cancels the recurring host timer through its native tool. A specific one-off future post can use a separately authorized one-off timer.

## Verify and enable publishing

1. Run `npm run publishing -- rehearse`. The loopback composer checks text, photo and video chooser handling and visible confirmation using synthetic content.
2. Use the permitted LinkedIn browser route and bind the exact account with `account: { profileUrl, storageState, audience, routeReference }`. Select a dedicated browser instance so the application browser and its drafts are independent. The composer stops for account mismatches, challenges, existing drafts and unrecognized controls.
3. After an actual user request to publish a selected pilot, run `publishing -- pilot --file …` with `{ id, sourceReference }`. A recorded LinkedIn confirmation qualifies the exact account and the tested format for live use. Verify the real observed media preview and confirmation separately for images and video.
4. For a timed choice, use the host's native scheduler with the [publishing prompt](check-in-prompt.md) and this working root. Set the saved `scheduleReference` to that dedicated timer. Run `publishing -- rehearse --schedule ACTUAL_REF --scheduled-run ACTUAL_RUN_REF` from that actual scheduled environment. It exercises the synthetic composer and opens the real empty composer, then records separate private scheduled evidence. Interactive results establish interactive capability.
5. After the user's standing authorization, run `publishing -- enable --file …` with `{ formats: ["text"], scheduled: true, sourceReference }`, using only confirmed formats. Use `scheduled: false` for on-demand publishing. On-demand requests use `publish-now --id ID --source ACTUAL_REQUEST_REF`. The dedicated timer calls `tick --schedule ACTUAL_REF`. The worker checks the account, consent, clock, current draft and media before acting.

An attempt is recorded before clicking **Post**. A visible confirmation marks it published and retains an exact link when available. For `verifyAttempt`, inspect the original account and post outcome before any repeat. Save private evidence under `.local/publishing/evidence/` and submit `reconcile --file …` with `{ id, attemptId, status, receipt: { reference, observedAt, url? }, evidence: { path, sha256 } }`. Use `published` or `notPublished` only for an established outcome. A verified unposted draft can be explicitly queued again. If the result remains uncertain, retain the attempt.

For rollback, run `disable --source ACTUAL_STOP_REF` and pause the dedicated timer through the native scheduler. Drafts, media and attempt history remain available for recovery. `npm run test:publishing` runs the focused tests and browser rehearsal. `npm test` also covers the existing job workflows.
