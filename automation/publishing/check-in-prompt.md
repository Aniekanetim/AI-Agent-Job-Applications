# LinkedIn publishing check-in

Use the private working root and the exact native schedule reference selected for LinkedIn publishing. Read [the publishing workflow](README.md) and use `npm run publishing`. This worker handles private post drafts and the authorized LinkedIn member profile.

During the first scheduled rehearsal, run `publishing -- rehearse --schedule ACTUAL_REF --scheduled-run ACTUAL_RUN_REF` from this environment and record the resulting evidence. Begin live dispatch only under the saved authorization for this schedule and format.

At each authorized wake-up, call `publishing -- tick --schedule ACTUAL_REF` for a due post before generating future content. Dispatch applies to the scheduled minute. A missed slot stays available to reschedule. If the post is confirmed, report its link when available. Report a new browser or evidence dependency once. For `verifyAttempt`, inspect the same post and account before reconciliation. Keep uncertain outcomes in the queue.

Use `publishing -- brief` to prepare the next unfilled recurring slot ahead of its due time when enabled and unpaused. Choose a fresh topic grounded in the selected public profile, write in the user's voice, and stage any supplied or permitted online media using the workflow. Save the draft and queue the exact next occurrence. Prepare the first scheduled draft during setup. One-off schedules operate on the exact selected post. Keep all proposals, evidence and files private.
