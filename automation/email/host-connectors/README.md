# Use email tools supplied by the agent's harness

First inspect the tools actually available in this chat and execution environment. A Gmail or Outlook account connected elsewhere is not automatically available here. This directory supplies a transport contract and guidance; it does not install a Gmail plugin, implement another OAuth service or copy the harness's tokens.

## Bind an available connection

List accessible accounts through the provider's real metadata tools when available. Save nonsecret metadata in `.local/email-host-connections.json` using [the empty example](inventory.example.json). Include the actual provider, stable account/mailbox IDs, address, connection/tool reference and evidence of availability. Labels and search filters describe scope; they are not account identity. Do not treat a manifest entry as proof of authenticated access.

After the user's account and cleanup selection, map actual tools to [adapter.ts](adapter.ts): page listing, exact-message reading, selected cleanup and exact-message cleanup-outcome inspection. Normalize provider responses to the shared types, retain real cursor semantics and confirm response identity. Do not confuse thread IDs with message IDs. The adapter strips bodies from metadata listings and sanitizes tool errors.

An in-process agent runtime can inject callbacks directly. When the harness tools cannot be invoked from the repository's Node process, the AI calls the native tools itself and uses the shared state helpers/CLI around those calls. Do not pretend importing the adapter gives a terminal process access to authenticated host tools. Preserve the same ordered checks and save the pending cleanup checkpoint before a native mutation; afterward save only the actual message-specific result through revision-checked state updates. `cleanupCompletedAlert` is the coordinated implementation for callback-capable runtimes.

## Capability evidence

Use [the report template](../capabilities.example.json). Record the actual source key, connection reference, working root, execution context, time and file/hash evidence. Verify listing/pagination and exact-message content access with legitimate in-scope reads. For write capabilities, inspect the actual tool contract and authorized scope without deleting or altering a message merely to test setup. Distinguish operation availability from a live cleanup outcome, which is recorded only after real authorized work.

If only reading is supported, offer retain mode and local completion markers. Thread-wide deletion/archive/label is unsuitable for this workflow because other messages may be recruiter correspondence or verification. Explain Trash versus permanent deletion. Do not invent an unsupported action, silently fall back or evade a permission denial. Respect native tool confirmations even though this workflow has no routine application review gates.

Verify access separately for scheduled runs. Tool availability, account identity or an approval requirement can differ from the interactive chat. A host report from another root, connection or execution context cannot establish readiness. Available but untested integrations remain unverified; mocked tests are not a live Gmail or Outlook connection.

For Codex, consult the current [official plugin guidance](https://learn.chatgpt.com/docs/plugins), [connection permissions](https://learn.chatgpt.com/docs/enterprise/apps-and-connectors) and [scheduled-task guidance](https://learn.chatgpt.com/docs/automations). The user's existing connection stays managed by its host.
