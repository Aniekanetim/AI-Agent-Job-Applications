import { lstatSync } from "node:fs";
import { resolve } from "node:path";
import { readPrivateJson } from "../workflow/private-json.js";

const names = new Set([".local/attention-state.json", ".local/attention-health.json", ".local/attention-preferences.json", ".local/attention-session.json",
  ".local/attention-capability.json", ".local/operation-preferences.json", ".local/settings-menu.json", ".local/onboarding-state.json", ".local/onboarding-pending-response.json"]);
/** Exact metadata paths only. Reject aliases before they can traverse an inactive ticket or candidate file. */
export function attentionMetadataExists(root: string, name: string) {
  if (!names.has(name)) throw new Error("Routine attention work reads only its dedicated metadata and conversation focus.");
  for (const part of [".local", name]) {
    try {
      const info = lstatSync(resolve(root, part));
      if (info.isSymbolicLink() || part === name && !info.isFile()) throw new Error("Attention metadata cannot link to task or candidate files.");
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  }
  return true;
}
export function readAttentionMetadata(root: string, name: string) {
  return attentionMetadataExists(root, name) ? readPrivateJson(root, name) : { data: null, revision: null };
}
