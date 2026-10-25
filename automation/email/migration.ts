import { readPrivateJson } from "../workflow/private-json.js";
import { loadEmailConnection, saveEmailConnection, type EmailConnection } from "./connection.js";
import { migrateStoredInbox } from "./state-store.js";

/** Preserve legacy files and selection; importing metadata performs no provider request. */
export function migrateLegacyEmail(root: string, policyReference: string, now: string) {
  const current = loadEmailConnection(root);
  let connection = current.connection;
  if (!connection) {
    const old = readPrivateJson(root, ".local/agentmail-intake.json").data as { inboxId?: string; selectionMethod?: string } | null;
    if (!old) return { migrated: false, nextAction: "Discover available host email tools or existing AgentMail access, then obtain the user's mailbox choice." };
    if (!old.inboxId?.trim() || !["user", "created"].includes(old.selectionMethod ?? "")) return { migrated: false, nextAction: "Preserve the legacy binding and confirm its mailbox selection provenance." };
    connection = { schemaVersion: 1, source: { provider: "agentmail", accountId: `agentmail-inbox:${old.inboxId}`,
      mailboxId: old.inboxId, address: old.inboxId.includes("@") ? old.inboxId : null, transport: "agentmail", connectionReference: ".local/agentmail-connection.json" },
      selection: { method: "legacy", sourceReference: ".local/agentmail-intake.json" },
      scope: { folderOrLabel: null, query: null, ruleReference: policyReference, revision: "legacy-instructions" },
      cleanup: { mode: "delete", effect: "permanentDelete", labelId: null, sourceReference: policyReference } };
    saveEmailConnection(root, connection, current.revision);
  }
  migrateStoredInbox(root, connection.source, policyReference, now);
  return { migrated: true, nextAction: "The existing mailbox and cleanup instruction were retained. Verify current read/cleanup capabilities and intake scope; do not repeat mailbox selection or infer live access." };
}
