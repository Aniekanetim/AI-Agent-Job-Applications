# Browser setup

The agent prepares this tooling before connecting or mapping job websites. Users describe their goal and provide access when needed; they do not need to discover missing browser packages or run installation commands themselves. Profile-only onboarding skips this component.

## Agent procedure

1. Check for Node.js 22 or later and npm. Reuse an existing supported installation. If missing, prepare them through the host's supported installation method when permitted. If the environment prevents installation, explain the exact user action needed and mark only the affected setup step blocked. A repository cannot install tools before its agent has the host access needed to do so.
2. From the working root, run `npm ci` when dependencies are absent or the lockfile changed. This installs the pinned Playwright CLI and library locally. No global CLI or separate browser skill is required. Preserve the existing private configuration and sessions.
3. Run `npm run browser:setup`. It checks the selected cache and installs only missing Chromium runtimes for the CLI and library. The two packages may require different browser revisions. Browser downloads need network access; Linux may also need system libraries installed through its supported administrator/package-manager process.
4. Read the resulting private `.local/browser-readiness.json`. Success requires the actual CLI to open a local page, take a snapshot, click its button and inspect the result. A download or `--help` response alone is insufficient. Failures identify installation, launch, snapshot or interaction as the next investigation area.
5. Record the successful report with `npm run onboarding:record -- --step browserTools --reference .local/browser-readiness.json`. Recheck after changing machine, working root, Node major version or pinned tooling. This check establishes browser operation, not website login or successful applications.

`npm run browser:check` repeats the local operation check without installing browsers. Both commands use an isolated named session and close only that session. They read no CVs, account passwords or saved authentication and visit no job websites. Artifacts stay under ignored `output/playwright/`.

## Use the bundled CLI

The launcher resolves the installed pinned package directly, so it cannot silently download a different CLI:

```shell
npm run browser -- --help
npm run browser -- -s=job-discovery open https://example.com --headed
npm run browser -- -s=job-discovery snapshot
npm run browser -- -s=job-discovery close
```

Inspect a fresh snapshot before using its element references. Refresh after navigation or a significant page change. Store reusable observed locators in the relevant site's TypeScript routines; temporary snapshot IDs are not permanent selectors. Follow the [discovery procedure](../../Application%20Workflow/discovery-workflow.md) for initial board mapping and changed application steps.

The default configuration is created privately at `.local/browser/cli.config.json` and keeps output under `output/playwright/`. Sessions are isolated unless the agent deliberately selects the authorized board profile or loads its private storage state. Keep authentication in `.auth/` or a secure store. Never put passwords in CLI arguments, snapshots or source code; load them privately at runtime through the [credential procedure](../../Job%20Context/Job%20Boards/README.md). Do not use account-wide close/kill commands against unrelated sessions.

The agent reuses matching browser revisions from the working copy or standard Playwright cache. Missing revisions are downloaded to `.local/browsers`. An explicit `PLAYWRIGHT_BROWSERS_PATH` is respected. The CLI and library can reuse separate compatible caches; their selected paths are recorded privately. Browser files and authenticated sessions are separate. The setup utility preserves installed files and does not copy a person's main browser profile.

The upstream [Playwright CLI guide](https://github.com/microsoft/playwright-cli#readme) documents commands and session options. Package versions are pinned in this repository's lockfile; inspect local `--help` for the installed version.
