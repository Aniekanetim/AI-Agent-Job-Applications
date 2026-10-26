import { readFileSync } from "node:fs";
import { areas, settings, settingById } from "./catalog.js";
import { currentSetting, roles, boardNames, containedFile, type CurrentSetting } from "./context.js";
import { loadMenu, menuFile, type MenuState } from "./state.js";
import { savePrivateJson } from "../workflow/private-json.js";
import { withWriteOwnership } from "../workflow/ownership.js";
import { applyResponse, readConversationInput, reconcileStagedResponse, type ResponseBundle } from "../onboarding/conversation.js";
import { readPrivateJson } from "../workflow/private-json.js";
import { digest, inspectReadiness, loadProgress } from "../onboarding/state-store.js";

export interface MenuView {
  phase: MenuState["phase"]; title: string; question: string;
  options: { id: string; label: string; current?: string }[];
  input: "choice" | "answer" | "none"; current?: CurrentSetting;
  procedure?: string; field?: string; roleId?: string | null; notice?: string;
}
export const isSettingsEntry = (text: string) => /^(open settings|change my settings)[.!?]?$/i.test(text.trim());
const areaLabel = (s: MenuState) => areas.find(a => a.id === s.area)?.label ?? "Settings";
function update(root: string, action: (state: MenuState, persist: () => void) => void) {
  return withWriteOwnership(root, "settings-menu", () => {
    let loaded = loadMenu(root); const s = structuredClone(loaded.state);
    const persist = () => {
      if (JSON.stringify(s) !== JSON.stringify(loaded.state)) {
        savePrivateJson(root, menuFile, s, loaded.revision); loaded = loadMenu(root);
      }
    };
    action(s, persist); persist();
    return settingsView(root, s);
  });
}
function enteredEdit(root: string, s: MenuState) {
  s.clarification = null;
  const setting = settingById(s.settingId!);
  if (setting.scope === "role") {
    const available = roles(root).filter(r => r.enabled);
    if (!available.some(r => r.id === s.roleId)) s.roleId = available.length === 1 ? available[0].id : null;
    if (available.length > 1 && !s.roleId) { s.phase = "role"; return; }
  }
  if (setting.scope === "board") {
    const available = boardNames(root);
    if (!available.includes(s.board ?? "")) s.board = available.length === 1 ? available[0] : null;
    if (available.length > 1 && !s.board) { s.phase = "board"; return; }
  }
  s.phase = "edit";
  s.editFingerprint = currentSetting(root, setting, s.roleId, s.board).fingerprint;
}
function returnToArea(s: MenuState) { s.phase = "area"; s.settingId = null; s.editFingerprint = null; s.clarification = null; }
function hasSelectedAnswer(bundle: ResponseBundle, path: string, s: MenuState) {
  const setting = settingById(s.settingId!);
  return bundle.answers?.some(a => a.decision.contextPath === path && a.decision.roleId === (setting.scope === "role" ? s.roleId : null) &&
    (!setting.field || a.decision.field === setting.field));
}
export function openSettings(root: string, sourceReference = "settings-command") {
  if (!sourceReference.trim()) throw new Error("Reference the request to open settings.");
  return update(root, s => {
    if (s.phase !== "closed") return;
    Object.assign(s, { phase: "root", area: null, settingId: null, roleId: null, board: null,
      editFingerprint: null, sourceReference, lastSave: null });
  });
}
export function settingsView(root: string, s = loadMenu(root).state): MenuView {
  let view: MenuView = { phase: s.phase, title: "Settings", question: "Which settings would you like to open?", input: "choice", options: [] };
  if (s.phase === "closed") return { ...view, question: "Settings closed. Your previous work remains saved.", input: "none" };
  if (s.pendingSave) return { ...view, title: "Finish saving settings", question: "Recover the interrupted save before editing or leaving this menu.",
    options: [{ id: "recover", label: "Recover saved answer" }] };
  if (s.phase === "root") view.options = [...areas.map(a => ({ ...a })), { id: "close", label: "Close settings" }];
  else if (s.phase === "role") view = { ...view, title: areaLabel(s), question: "Which role profile should this change apply to?",
    options: roles(root).filter(r => r.enabled).map(r => ({ id: r.id, label: r.label })) };
  else if (s.phase === "board") view = { ...view, title: areaLabel(s), question: "Which job board should this change apply to?",
    options: boardNames(root).map(name => ({ id: name, label: name })) };
  else if (s.phase === "area") view = { ...view, title: areaLabel(s), question: "Which setting would you like to change?",
    options: settings.filter(v => v.area === s.area).map(v => {
      const current = currentSetting(root, v, s.roleId, s.board);
      const caption = current.path === null ? "Select a role or board to view" : v.path.endsWith(".md") && current.status === "saved" ? "Saved — select to view" : current.text.replace(/\s+/g, " ").slice(0, 160);
      return { id: v.id, label: v.label, current: caption };
    }) };
  else {
    const setting = settingById(s.settingId!), current = currentSetting(root, setting, s.roleId, s.board);
    view = { ...view, title: `${areaLabel(s)} / ${setting.label}`, question: s.clarification?.prompt ?? setting.prompt, input: "answer", current,
      procedure: setting.procedure, field: setting.field, roleId: setting.scope === "role" ? s.roleId : null };
    if (current.path === null) view = { ...view, question: setting.scope === "role" ? "Configure a role profile before changing this setting." : "Choose your primary job boards before changing account access.",
      input: "choice", options: [{ id: "configure", label: setting.scope === "role" ? "Configure role profiles" : "Choose primary job boards" }] };
    view.options.push({ id: "cancel", label: "Cancel this edit" });
  }
  if (s.phase !== "root") view.options.push({ id: "back", label: "Back" }, { id: "close", label: "Close settings" });
  if (s.lastSave) {
    const ready = inspectReadiness(root, loadProgress(root).state);
    view.notice = `${s.lastSave.changed ? "Change saved" : "Current value retained"}. ${ready.ready && ready.state.phase === "complete" ? "Ready for the configured scope." : "Recheck affected preparation before claiming the updated setup is ready."}`;
  }
  return view;
}
export function chooseSetting(root: string, selection: string) {
  selection = selection.trim();
  const waiting = loadMenu(root).state;
  if (waiting.pendingSave) {
    if (["1", "recover", "recover saved answer"].includes(selection.toLowerCase())) return recoverSettingsSave(root);
    throw new Error("Recover the retained settings save before navigating away.");
  }
  return update(root, s => {
    if (s.phase === "closed") throw new Error("Open settings before choosing an option.");
    if (s.pendingSave) throw new Error("Recover the retained settings save before navigating away.");
    const view = settingsView(root, s);
    const option = /^\d+$/.test(selection) ? view.options[Number(selection) - 1] : view.options.find(o => o.id === selection || o.label.toLowerCase() === selection.toLowerCase());
    if (!option) throw new Error("Choose a displayed option, or give the agent the new value for the current setting.");
    const id = option.id;
    if (id === "close") { Object.assign(s, { phase: "closed", area: null, settingId: null, roleId: null, board: null, editFingerprint: null, clarification: null }); return; }
    if (id === "cancel" || id === "back") {
      if (s.phase === "area") Object.assign(s, { phase: "root", area: null, settingId: null, roleId: null, board: null });
      else returnToArea(s);
      return;
    }
    s.lastSave = null;
    if (s.phase === "root") { s.area = id as MenuState["area"]; s.phase = "area"; }
    else if (s.phase === "area") { s.settingId = id; enteredEdit(root, s); }
    else if (s.phase === "role") { s.roleId = id; enteredEdit(root, s); }
    else if (s.phase === "board") { s.board = id; enteredEdit(root, s); }
    else if (id === "configure") { s.area = settingById(s.settingId!).scope === "role" ? "profiles" : "connections";
      s.settingId = s.area === "profiles" ? "roles" : "boards"; enteredEdit(root, s); }
  });
}
export function clarifySetting(root: string, prompt: string, sourceReference: string) {
  return update(root, s => {
    if (s.phase !== "edit" || s.pendingSave || !prompt.trim() || prompt.length > 500 || !sourceReference.trim()) throw new Error("Clarify the one current setting with its actual reply reference.");
    s.clarification = { prompt, sourceReference };
  });
}
function finishSave(root: string, s: MenuState) {
  const pending = s.pendingSave!;
  const file = containedFile(root, pending.proposalPath);
  if (digest(readFileSync(file)) !== pending.sha256) throw new Error("The retained settings proposal changed; reconcile it before recovery.");
  const bundle = readConversationInput(root, pending.proposalPath) as ResponseBundle;
  if (bundle.id !== pending.responseId) throw new Error("Recover the same settings response.");
  const setting = settingById(s.settingId!), before = currentSetting(root, setting, s.roleId, s.board);
  if (!before.path || before.path === ".local/onboarding-state.json" || !hasSelectedAnswer(bundle, before.path, s)) throw new Error("Bind this response to the selected setting and role. Scope/board changes use their existing setup procedure.");
  applyResponse(root, bundle);
  const after = currentSetting(root, setting, s.roleId, s.board);
  const expected = bundle.writes.find(w => w.path === after.path)?.content;
  const expectedHash = expected === undefined ? bundle.references.find(r => r.path === after.path)?.sha256 : digest(expected);
  if (after.sha256 !== expectedHash) throw new Error("The saved response is historical and canonical context has changed. Preserve both records and investigate before reporting the current value as saved.");
  s.lastSave = { settingId: setting.id, responseId: bundle.id, sourceReference: bundle.sourceReference, changed: after.fingerprint !== s.editFingerprint };
  s.pendingSave = null; returnToArea(s);
}
export function saveSettingsReply(root: string, proposalPath: string) {
  return update(root, (s, persist) => {
    if (s.phase !== "edit") throw new Error("Select the setting to change before saving an answer.");
    const bundle = readConversationInput(root, proposalPath) as ResponseBundle;
    if (!bundle?.id || !bundle.sourceReference) throw new Error("Use the actual focused-response proposal and source.");
    const setting = settingById(s.settingId!), target = currentSetting(root, setting, s.roleId, s.board);
    if (!target.path || target.path === ".local/onboarding-state.json" || !hasSelectedAnswer(bundle, target.path, s)) throw new Error("Save the selected setting in its canonical file, field and role, or use complete for scope/board changes.");
    const sha256 = digest(readFileSync(containedFile(root, proposalPath)));
    if (s.pendingSave && (s.pendingSave.proposalPath !== proposalPath || s.pendingSave.sha256 !== sha256)) throw new Error("Recover the existing settings response before accepting another.");
    s.pendingSave = { proposalPath, sha256, responseId: bundle.id }; persist();
    finishSave(root, s);
  });
}
export function recoverSettingsSave(root: string) {
  return update(root, s => { if (!s.pendingSave) throw new Error("There is no retained settings save to recover."); finishSave(root, s); });
}
export function reconcileSettingsSave(root: string, proposalPath: string, reviewReference: string) {
  return update(root, (s, persist) => {
    if (!s.pendingSave || !reviewReference.trim()) throw new Error("Reconcile a retained settings reply using the actual conflict review.");
    const old = readConversationInput(root, s.pendingSave.proposalPath) as ResponseBundle;
    if (digest(readFileSync(containedFile(root, s.pendingSave.proposalPath))) !== s.pendingSave.sha256) throw new Error("Preserve the original proposal file; prepare the merged response at a new private path.");
    const next = readConversationInput(root, proposalPath) as ResponseBundle;
    if (old.id !== next.id || old.sourceReference !== next.sourceReference || old.observedAt !== next.observedAt ||
      JSON.stringify(old.answers) !== JSON.stringify(next.answers)) throw new Error("Reconcile the same reply and selected fields; a new answer cannot replace pending work.");
    if (readPrivateJson(root, ".local/onboarding-pending-response.json").data !== null) reconcileStagedResponse(root, next, reviewReference);
    else {
      const conflicts = old.writes.filter(w => {
        const file = containedFile(root, w.path);
        let hash: string | null = null; try { hash = digest(readFileSync(file)); } catch { /* Missing file is an actual conflict too. */ }
        return hash !== w.expectedSha256 && hash !== digest(w.content);
      });
      if (!conflicts.length || old.writes.length !== next.writes.length || JSON.stringify(old.references) !== JSON.stringify(next.references) ||
        old.writes.some(w => !next.writes.some(n => n.path === w.path)) || old.writes.some(w => !conflicts.includes(w) && JSON.stringify(next.writes.find(n => n.path === w.path)) !== JSON.stringify(w)))
        throw new Error("Reconcile only an actual newer-file conflict; preserve unconflicted answers and files.");
    }
    s.reconciliations ??= [];
    s.reconciliations.push({ ...s.pendingSave, reviewReference });
    s.pendingSave = { proposalPath, sha256: digest(readFileSync(containedFile(root, proposalPath))), responseId: next.id };
    persist(); finishSave(root, s);
  });
}
/** Boards and scope are owned by onboarding, never rewritten as an answer file. */
export function completeSetupChange(root: string, sourceReference: string) {
  return update(root, s => {
    if (s.phase !== "edit" || s.pendingSave || !["boards", "intake"].includes(s.settingId ?? "") || !sourceReference.trim()) throw new Error("Complete only a selected scope/board change with its actual user source.");
    const current = currentSetting(root, settingById(s.settingId!), s.roleId, s.board);
    if (current.status !== "saved" || !current.sha256) throw new Error("Save the actual scope/board choice through onboarding first.");
    s.lastSave = { settingId: s.settingId!, responseId: null, sourceReference, changed: current.fingerprint !== s.editFingerprint };
    returnToArea(s);
  });
}
export function renderMenu(view: MenuView) {
  const lines = [view.title, "", view.question];
  if (view.current) lines.push("", `Current setting${view.current.status === "default" ? " (default)" : ""}:`, view.current.text);
  if (view.notice) lines.push("", view.notice);
  if (view.options.length) lines.push("", ...view.options.map((o, i) => `${i + 1}. ${o.label}${o.current ? ` — ${o.current}` : ""}`));
  return lines.join("\n");
}
