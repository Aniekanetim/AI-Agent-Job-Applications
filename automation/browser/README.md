# Browser selection and preparation

Choose the default before installing tools, signing in or mapping websites. The agent asks once, saves the actual reply in private context and records the choice in `.local/browser-preferences.json`. Profile-only setup skips browsers.

| Choice | Default behavior |
| --- | --- |
| Choose for me (`automatic`) | Compare the host's actual capabilities, explain the selection and save the resolved default |
| In-app browser (`inApp`) | Use the host application's browser; prepare Playwright for applications requiring file upload |
| Playwright (`playwright`) | Use the bundled CLI and learned TypeScript methods |

An installed CLI does not establish a preference. An unavailable chosen browser remains a setup dependency; it does not authorize silently changing the default. Record the user's choice with `npm run onboarding:browser -- --browser inApp --source REFERENCE`, substituting the actual choice and private response reference. For automatic selection, verify the available tools first, then use `npm run onboarding:resolve-browser -- --reference .local/browser-selection.md` with the actual capability comparison.

## Visible browser by default

Playwright runs headed by default, including the setup rehearsal. You can watch navigation and form filling on the computer running the agent. A remote machine needs an accessible desktop; headed mode does not stream its window to your computer. If the selected mode cannot launch, report that dependency and preserve progress rather than silently switching to headless.

The launcher applies the selected visibility to every new `open`, including a supplied `--config`. It preserves the original configuration and authentication references. Older generated `headless: true` settings no longer hide normal launches. Existing sessions retain their launch mode: checkpoint the application and recover its draft/session before restarting visibly. Never interrupt an uncertain submission or close unrelated sessions.

For an explicit later choice, the agent uses `npm run browser -- visibility --mode headed --source ACTUAL_REQUEST_REFERENCE` (or `headless` only when requested). A deliberate `--headless` or `--headed` on one `open` overrides visibility for that session only. Recheck actual readiness after changing modes; an old headless report does not prove visible operation.

## Prepare the selected browser and upload fallback

1. For in-app use, follow [the host-browser procedure](in-app/README.md). Check the actual provider, navigation, form filling and outcome inspection. Do not claim a browser works from its presence in a tool list. Keep its session separate from Playwright.
2. For Playwright use, including the in-app upload fallback, check Node.js 22+ and npm. Reuse a supported installation; prepare missing components through the host's permitted installation method. If installation is prevented, record the exact dependency and required action.
3. Run `npm ci` from this working root when dependencies are missing or the lockfile changed. Run `npm run browser:setup` to install only missing compatible Chromium runtimes and perform the safe rehearsal. `npm run browser:check` repeats verification without downloads.
4. Inspect `.local/browser-readiness.json`. Success requires real CLI navigation, form entry, saving a synthetic draft, recovery of that same draft in an isolated second session, file upload and outcome inspection. This establishes Playwright operation; it does not establish in-app operation, website authentication or an application submission.
5. Record actual reports under `browserTools` using [onboarding progress](../onboarding/README.md). An in-app default requires both its own verified report and a working Playwright upload fallback. Prepare access for both where the selected journey needs it; one browser's login does not authenticate the other.

No CV, password or authenticated session is used by the synthetic rehearsal. It visits only a temporary loopback page, writes artifacts under ignored `output/playwright/`, and closes only its own named sessions. Do not use a practice job application as a tool test.

## Route each application

If file upload is known to be required, start that application in Playwright. If the requirement appears during in-app work, follow [the upload handoff](upload-fallback.md). The default stays in-app, the existing task keeps its identity, and the rest of that application stays in Playwright. The next task uses the saved default.

Capability absence and permission denial are different. A documented unsupported upload can use the configured fallback. An access or tool denial remains a blocker; changing tools must not evade it. A submission with an uncertain outcome must be investigated before any switch or retry.

## CAPTCHA and unattended work

Follow [human CAPTCHA handoff](captcha-handoff.md). Preserve the same application, move its task to Blocked and report the actual human step once. An absent user does not stall the check-in: independent work can continue and the source email stays retained. Resume after verified human completion and same-vacancy/session/form checks, recovering an expired draft or inaccessible/headless browser when necessary. A CAPTCHA is not a reason to switch Playwright to in-app automation or bypass site controls.

The [checkpoint helpers](captcha.ts) preserve task/role/CV identity, request references and handoff history. [Read-only hCaptcha inspection](captcha-inspection.ts) reports the observed checkbox state and gates known-challenge submission. The agent must perform the actual checks and save/move the Markdown ticket through the existing guarded paths; these helpers do not operate a background notification service, persist a browser indefinitely or implement every website adapter.

## Use the bundled CLI

The launcher resolves the pinned local package without silently downloading a different CLI:

```shell
npm run browser -- --help
npm run browser -- -s=job-discovery open https://example.com --headed
npm run browser -- -s=job-discovery snapshot
npm run browser -- -s=job-discovery close
```

Inspect a fresh snapshot before using its element references. Refresh after navigation or a significant page change. Temporary snapshot IDs are not permanent selectors. Save observed locators and checks in the site's Playwright methods; use [discovery](../../Application%20Workflow/discovery-workflow.md) for unfamiliar branches.

Private `.local/browser/cli.config.json` controls output. Keep authentication in `.auth/` or a secure store. Load credentials privately through [board access](../../Job%20Context/Job%20Boards/README.md); never put passwords in CLI arguments, snapshots or code. Do not close unrelated sessions or copy a person's main browser profile.

The CLI and library can require different Chromium revisions. Setup reuses matching revisions in the working copy or standard cache, downloads missing revisions to `.local/browsers`, and respects `PLAYWRIGHT_BROWSERS_PATH`. Linux may also need permitted system-library installation. Reverify after relocation or runtime changes. See the upstream [Playwright CLI guide](https://github.com/microsoft/playwright-cli#readme) and the installed `--help` for commands.
