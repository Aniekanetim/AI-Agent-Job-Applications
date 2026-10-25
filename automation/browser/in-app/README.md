# Prepare the host's in-app browser

Use the browser tools actually available to the agent. There is no universal in-app-browser npm driver: different hosts expose different commands and permissions. Read that provider's current instructions before interacting. If the tool cannot initialize, leave its checks unverified and explain the specific setup dependency while preserving the user's choice.

## Verify capabilities

1. Identify the provider and whether it is available in this interactive working copy. Open a harmless page through that provider, inspect its state, fill a synthetic field and inspect the result. Use its documented APIs, not guessed commands.
2. The agent can start `npm run browser:rehearsal` in an interactive terminal, keep it running and open the printed loopback URL through the selected provider. Enter `Synthetic Candidate`, save the checkpoint, select Check form and inspect the matching application ID in the result. No upload is needed for that form check. Save the same draft URL for a permitted fallback rehearsal, where only the printed synthetic file is uploaded. Stop the helper with `close` when finished. Inability to reach a loopback page is a limitation, not a pass.
3. Record each operation as `verified`, `unsupported`, `unverified` or `denied` with actual private evidence. Use [the report shape](capability-report.example.json); replace its placeholders before use. Successful checks require evidence file paths and actual SHA-256 values. A documented unsupported feature needs its limitation/source evidence; a permission denial must remain visible.
4. Save the interactive report as `.local/browser-in-app.json`, with the actual provider, working root, time and `executionContext: interactive`. Record its reference in onboarding. The readiness helper checks report structure, root/context and nested evidence hashes; the agent still has to inspect the actual result.
5. Independently verify Playwright using [browser setup](../README.md). An unsupported in-app upload is covered by that fallback; a denied action must not be bypassed. All applications requiring uploads use Playwright under [the handoff rule](../upload-fallback.md).

OpenAI's browser currently documents that it cannot automate file uploads. Its browser profile is separate, so do not assume another browser's account session is available. These are provider-specific conditions to check against the current [official browser guide](https://learn.chatgpt.com/docs/browser), not claims about every host browser.

## Learn website actions for this provider

Keep the common journey in `architecture.local.md`. Save host-specific observed actions in the site's `in-app/actions.local.md`, including provider, page conditions, observed controls, checkpoint/recovery and outcome checks. Playwright TypeScript methods do not execute through a host-browser tool. Unvisited actions remain unlearned.

Use the selected provider during onboarding mapping. For an upload branch, learn the Playwright branch only when the legitimate journey permits observation. Do not submit a practice application or upload a real CV just to complete the map. A synthetic upload check proves tooling, not a portal-specific integration.

## Recurring operation

Interactive success does not establish background access. If recurring use is requested, verify the default browser and Playwright fallback in the actual scheduled environment. Save separate `.local/browser-in-app-scheduled.json` and `.local/browser-playwright-scheduled.json` reports with `executionContext: scheduled` and actual evidence. Never relabel an interactive report. Follow [schedule setup](../../scheduling/README.md) before claiming recurring readiness.
