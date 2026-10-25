# AgentMail email adapter

AgentMail is one supported source. Start with [shared email onboarding](../README.md#onboarding-and-account-selection): an existing usable Gmail, Outlook or other harness connection does not require AgentMail setup. Use [this provider's setup](setup.md) when AgentMail is selected or needed.

## Inbox access

The existing commands remain compatible. `npm run inbox:detect` checks bounded local AgentMail references without network access. `npm run inbox:list` lists accessible AgentMail inbox metadata. `npm run inbox:setup -- --select-address CHOSEN_ADDRESS` binds the user's chosen inbox and checks header access. Reuse an already confirmed choice and keep the key at its original source. Users do not need internal inbox IDs or a separate AgentMail skill.

AgentMail setup does not establish full message-body access, cleanup or scheduled readiness. Record those actual capabilities through [the shared procedure](../README.md). No setup command sends/deletes mail or activates a schedule. The public package contains no actual key or selected inbox.

## Email processing and cleanup

Use [the common email procedure](../README.md#email-processing-and-cleanup) and schema-2 `.local/inbox-state.json`. [adapter.ts](adapter.ts) normalizes AgentMail listing/reading and preserves the existing client's guarded individual-message deletion. The client accepts only the coordinated single-use authorization after actual inventory/task/evidence verification; a legacy persistence Boolean cannot authorize DELETE. Use [the completion procedure](../alert-completion.md). Its deletion operation is permanent; do not describe it as Gmail Trash or archive. Retain mode is implemented in the shared layer without an external mutation. Unsupported AgentMail archive/label operations must not be invented.

For a timeout, the adapter can inspect the exact message. A 404 is corroborated by a successful full selected-inbox listing before it is treated as absence; access errors remain unknown. Recovery never starts another application.

The legacy [schema-1 example](inbox-state.example.json) is retained only to explain migration of existing setups. New setup uses [the shared empty progress example](../inbox-state.example.json). Do not maintain two live ledgers or remove handled-message markers while those emails can still be encountered.

## Client and provider reference

The [HTTP client](client.ts) supports paginated metadata, exact-message reading and guarded completed-alert deletion. It has no send, thread-delete or inbox-delete method. Its [transport adapter](adapter.ts) takes credentials privately through that existing client; it does not copy them into the shared connection file. Offline checks inject HTTP and perform no real mailbox operation.

| Operation | Provider endpoint |
| --- | --- |
| List messages | GET `https://api.agentmail.to/v0/inboxes/{inbox_id}/messages` |
| Read one message | GET `https://api.agentmail.to/v0/inboxes/{inbox_id}/messages/{message_id}` |
| Delete completed alert | DELETE `https://api.agentmail.to/v0/inboxes/{inbox_id}/messages/{message_id}` |

See the official [list](https://docs.agentmail.to/api-reference/inboxes/messages/list), [read](https://docs.agentmail.to/api-reference/inboxes/messages/get) and [delete](https://docs.agentmail.to/api-reference/inboxes/messages/delete) documentation. Recheck the actual provider contract when responses differ. Keep authorization headers, bodies and credentials out of errors and reusable records.
