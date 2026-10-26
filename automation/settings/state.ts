import { readPrivateJson } from "../workflow/private-json.js";
import { areas, settings, type AreaId } from "./catalog.js";
export const menuFile = ".local/settings-menu.json";
export interface MenuState {
  schemaVersion: 1; phase: "closed" | "root" | "area" | "role" | "board" | "edit";
  area: AreaId | null; settingId: string | null; roleId: string | null; board: string | null;
  editFingerprint: string | null; sourceReference: string | null;
  pendingSave: { proposalPath: string; sha256: string; responseId: string } | null;
  lastSave: { settingId: string; responseId: string | null; sourceReference: string; changed: boolean } | null;
  clarification?: { prompt: string; sourceReference: string } | null;
  reconciliations?: { proposalPath: string; sha256: string; responseId: string; reviewReference: string }[];
}
export function emptyMenu(): MenuState {
  return { schemaVersion: 1, phase: "closed", area: null, settingId: null, roleId: null, board: null,
    editFingerprint: null, sourceReference: null, pendingSave: null, lastSave: null };
}
export function loadMenu(root: string) {
  const found = readPrivateJson(root, menuFile), s = found.data as MenuState;
  if (s === null) return { state: emptyMenu(), revision: found.revision };
  if (s.schemaVersion !== 1 || !["closed", "root", "area", "role", "board", "edit"].includes(s.phase) ||
    !(s.area === null || areas.some(a => a.id === s.area)) || !(s.settingId === null || settings.some(v => v.id === s.settingId && v.area === s.area)) ||
    ![s.roleId, s.board, s.editFingerprint, s.sourceReference].every(v => v === null || typeof v === "string") ||
    (s.phase !== "closed" && s.phase !== "root" && !s.area) || (["role", "board", "edit"].includes(s.phase) && !s.settingId) ||
    (s.phase === "edit" && !s.editFingerprint) || (s.pendingSave !== null && (s.phase !== "edit" || !s.pendingSave?.proposalPath?.startsWith(".local/") ||
      !/^[a-f0-9]{64}$/.test(s.pendingSave.sha256) || !s.pendingSave.responseId?.trim())) ||
    (s.lastSave !== null && (!settings.some(v => v.id === s.lastSave?.settingId) || !s.lastSave.sourceReference?.trim() || typeof s.lastSave.changed !== "boolean")) ||
    (s.reconciliations && (!Array.isArray(s.reconciliations) || s.reconciliations.some(v => !v.proposalPath?.startsWith(".local/") || !/^[a-f0-9]{64}$/.test(v.sha256) || !v.responseId?.trim() || !v.reviewReference?.trim()))) ||
    (s.clarification && (s.phase !== "edit" || !s.clarification.prompt?.trim() || s.clarification.prompt.length > 500 || !s.clarification.sourceReference?.trim()))) {
    throw new Error("Settings navigation needs investigation; preserve its checkpoint and candidate context.");
  }
  return { state: s, revision: found.revision };
}
