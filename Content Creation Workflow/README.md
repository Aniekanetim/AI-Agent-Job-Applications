# Content creation workflow

The Task Board provides intake for both work types. Use `npm run tasks -- work` for the two routes. Content enters **Content Creation** and applications enter **To Do** or **Email Alerts**. Use the existing native check-in for both, and keep content dispatch off until the selected LinkedIn account and browser capability are established.

## Set up and prepare a ticket

Open **Settings → LinkedIn publishing → Content creation mode and profile**. Follow [the content profile template](../Content%20Creation%20Context/profile.md). Use the user's actual mode, profile, account and route permission. Autonomous mode authorizes the agent to prepare and publish posts within the saved context. In On-demand mode the user supplies the text and media. Off pauses content work.

Use private JSON proposals below `.local/publishing/requests/` and `npm run publishing -- COMMAND --file PATH`:

| Command | Proposal |
| --- | --- |
| `board-configure` | `{mode,sourceReference,account?}`, using `autonomous`, `onDemand`, or `off`. An account contains the exact LinkedIn `profileUrl`, authorized `storageState` reference, `audience` and `routeReference`. |
| `board-create` | `{source,sourceReference,topic,angle}`, with the actual `user` or `agent` source and a unique request reference. |
| `board-draft` | `{id?,source,sourceReference,angle,draft}`, with the existing ID when editing and the actual prepared text, topic, public fact IDs and media. |
| `board-transition` | `{path,expected,action,authority,dependencies?}`, using the selected file's SHA-256 and actual private evidence. |

Use `board-brief` for the saved context and a bounded publication shortlist. `board-history` accepts `{text,topic,angle}` to check prior exact text, angle and topic matches. Supply the user's facts by ID and verify the complete draft against the context before staging it. For media, stage the exact bytes under `.local/publishing/media/` and bind the actual SHA-256, kind, source and rights. Save the source URL and attribution for online media. Use a ticket-owned filename beginning with `CONTENT-ID-` for sourced copies. The prepared draft shape is `{text,topic,facts,media?}`. The media shape is `{path,sha256,kind,origin,rightsReference,url?,credit?}`.

The agent can prepare ahead of check-in and leave the content ticket ready. A shared check-in picks up prepared tickets and eligible applications. At the end of a scheduled-only run the agent can prepare the next post. The shared cadence supplies publication timing. Actual approval of Autonomous mode and alignment with the saved scope supply the user's authorization for the post.

## Select a tool and publish

Use available tools that support the action, identity, media and outcome checks. `board-tool` accepts `{preferred,action,tools:[{id,status,actions,evidence?}]}` from current observations. Use a verified fallback if the default lacks capability or is unavailable. Resolve a denial through the existing access procedure. Preserve the same ticket, content and account.

For the bundled browser, use `board-work --id ID`, with `--schedule ACTUAL_REF` in a real scheduled check-in or `--source ACTUAL_CHECK_IN_REQUEST` for an on-demand check-in. For a host tool, prepare the exact composer first, then call `board-authorize-tool` with `{id,tool,scheduleReference?,evidence}`. The private JSON observation records `{tool,account,audience,draftSha256,mediaSha256?,controlsVerified}`. Proceed with the single final click only when the helper returns `invokeOnce`. Report the actual outcome using `board-observe` with `{path,attemptId,status,receipt,evidence}`. The evidence references a private JSON report with `{attemptId,profileUrl,draftSha256,status,receipt,observation:{kind,evidence}}`. Save the underlying observed result as a separate private evidence file. Use `linkedinConfirmation` for the observed success message, `matchingPublishedPost` for a verified post with its URL, or `verifiedNotPublished` for evidence that the attempt did not publish. Match the report to the same attempt, profile, draft and receipt. An uncertain outcome retains the attempt. Verify it before another click.

After confirmation, the app writes a compact account-scoped publication record and moves the same ticket to Applied with its receipt and attempt history. The full active draft and its unchanged ticket-owned sourced media copy are released after that commit. Exact fingerprints cover old posts, and the agent reads a bounded topic and angle shortlist. Keep the user's original files. Older imported state and other retained media follow the user's storage policy.

## Blocked, Deferred and cutover

Resolve only the selected Blocked ticket. Save the user's replies or actions and verify each dependency. The content resolution report is `{taskId,ticketSha256,dependencies:[{id,evidence}]}`. Call `board-transition` with `action:"unblock"` after every dependency is verified. That move returns the same ticket to Content Creation for pickup. Deferred work resumes through an explicit return to Content Creation. Use `board-recover --id ID` for an interrupted selected move or local completion.

For an existing independent publishing queue, use `board-cutover-preview`. Drain its worker and verify the old timer is stopped through the native scheduler. Use `board-adopt` with `{sourceReference,stoppedTimer?}`; timer evidence records the exact `scheduleReference` and observed `status:"stopped"`. Confirmed posts keep their history, uncertain posts enter Blocked, and unfinished old drafts enter Deferred. The import fences old callbacks as soon as it starts. A failed import keeps the content mode off. Use `board-cutover-preview` to inspect progress and retry `board-adopt` after resolving the reported issue. After import completes, the mode stays off until the user chooses it.

Run `board-rehearse --schedule ACTUAL_REF --scheduled-run ACTUAL_RUN_REF` in the actual shared scheduled environment before claiming timed readiness. The rehearsal opens the empty composer and verifies synthetic media flows. Application work can continue with its own verified dependencies when content is unavailable.
