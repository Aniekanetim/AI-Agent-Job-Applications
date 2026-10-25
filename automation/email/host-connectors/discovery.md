# Discover email providers before asking for a connection

Use this procedure during the **Connect your email** onboarding step. The agent performs discovery; the person chooses a provider and account in conversation. The repository supplies metadata helpers, not a universal connector installer or OAuth client.

## 1. Identify the current agent environment

Use the harness's actual tool descriptions and runtime information. An installed `codex` or `claude` executable does not establish which harness owns this conversation. Read the saved email selection first. Resume that setup unless the person explicitly chooses a different source.

Inspect the provider catalog and account metadata separately:

| Information | What it establishes |
| --- | --- |
| Provider catalog | An integration can be offered, or needs an access check |
| Authenticated account metadata | A particular account is connected, expired, denied or still unverified |
| Actual scoped capability checks | That selected account can perform the required work in this execution environment |

Do not read email bodies to discover account addresses. Do not inspect credential stores or copy tokens to determine whether an account is connected. Missing tools can mean the integration has not been loaded; search the host's supported directory before declaring it unavailable.

## 2. Discover providers using the current harness

### Codex

Prefer the available plugin-management search/directory tools. Search for Gmail and Outlook Email; inspect other email integrations as relevant. These results can describe available, uninstalled plugins. They do not prove account authentication. Do not offer a calendar integration as email access.

Where the current Codex CLI supports it, `codex plugin list --available --json` supplies installed and marketplace metadata. Use `--help` or the current official reference if the installed command differs. The CLI's configured marketplaces and the desktop directory can differ; a missing entry does not establish global non-support. Retain the discovery scope as partial when coverage is incomplete.

The agent can save an actual response under ignored `.local/` and normalize its metadata:

```shell
npm run email:catalog -- --file .local/codex-email-directory.json --format codexDirectory --reference .local/codex-email-directory.json
npm run email:options
```

`codexDirectory` expects the actual response's `plugins` object; unwrap a tool envelope without fabricating entries. `codexCli` expects the documented `installed` and `available` arrays. The normalizer recognizes exact Gmail and Outlook Email service names, strips unrelated fields and does not infer accounts. Record any other verified email providers through the shared catalog format. Keep raw captures private and exclude credential-bearing output entirely.

For a new connection, guide the person through the host's actual plugin connection screen. Use a native connection/suggestion tool when available and appropriate to the person's chosen provider. Respect account and organization restrictions. A catalog entry is not permission to install or connect every listed integration. Reinspect account metadata and exposed tools after authentication.

References: [Codex plugin documentation](https://learn.chatgpt.com/docs/plugins) and [CLI plugin commands](https://learn.chatgpt.com/docs/cli/reference).

### Claude Code

Use the current session's exposed MCP tools and server/account metadata. `/mcp` shows connections and their status; `claude mcp list` inspects configured servers where the CLI is available. These lists are not a complete directory of every provider that could be connected. Consult Claude's connector directory for unconnected options.

For Anthropic-hosted Gmail, guide the person to [Claude connector settings](https://claude.ai/customize/connectors). Complete authentication there, then verify its availability through `/mcp` and actual tools. Do not create a second local OAuth configuration for that hosted connector. Claude account sign-in, organization policies, version and execution environment can affect availability. API-key or third-party-provider sessions do not necessarily inherit the person's Claude account connectors. Explain the actual dependency without changing their harness login or configuration automatically.

Claude Code does not need a Codex command. Translate observed server/directory metadata into [the shared catalog example](catalog.example.json), with `harness: "claudeCode"`, the actual working root, execution context, observation time and evidence references. Mark account authentication in the separate inventory only when actual account metadata supports it. Do not parse a human-readable server list by guessing provider names from arbitrary descriptions.

Reference: [Claude Code MCP and connected services](https://code.claude.com/docs/en/mcp#use-mcp-servers-from-claudeai).

### Other or unidentified harnesses

Use their actual integration directory and tools, if supplied, and write the same metadata format. If discovery is unavailable, record `discovery: "unavailable"`; leave Google as **Not yet verified**, offer optional AgentMail and **Set up email later**. Investigate a requested provider through the harness's official connection guidance. Do not claim universal non-support or send the person straight to AgentMail solely because a provider's tools are absent from the initial prompt.

## 3. Save only metadata and show the choices

Store observed providers in `.local/email-provider-catalog.json` using [catalog.example.json](catalog.example.json). Populate real root/time fields; the example is deliberately unconfigured. `complete` means the recorded discovery scope was fully inspected, not that every possible MCP service has been enumerated. A provider absent from a catalog remains unknown.

Store actual account records separately in `.local/email-host-connections.json`. Existing schema-1 account records remain valid. The optional `authentication` field accepts `connected`, `needsAuthentication`, `denied` or `unverified`; omitting it means unverified. `available: true` by itself does not prove authentication. Use stable real account/mailbox IDs and nonsecret tool references. Do not invent IDs for a provider with no connected account.

The options helper orders Google first, then discovered Outlook, other available email providers and AgentMail, followed by **Set up email later**. It keeps an existing source visibly selected even when that provider is absent from the new catalog. The saved source is preserved until the person explicitly changes it and existing work allows a safe switch.

Refresh discovery for a different harness, working root or execution context and after a connection change. A cached catalog guides setup; it never grants email capabilities. Account and capability evidence establish readiness through [shared email setup](../README.md#onboarding-and-account-selection).
