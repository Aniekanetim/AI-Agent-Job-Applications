import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openSettings, settingsView, chooseSetting, saveSettingsReply, recoverSettingsSave, reconcileSettingsSave, clarifySetting, completeSetupChange, renderMenu } from "./menu.js";
import { readConversationInput } from "../onboarding/conversation.js";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const args = process.argv.slice(2), command = args.shift() ?? "open";
const value = (flag: string) => { const i = args.indexOf(flag); if (i < 0 || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Supply ${flag}.`); return args[i + 1]; };
try {
  if (command === "help") console.log(`Agent-managed interactive settings:
  open [--source REF]       Open or resume the existing menu
  show                     Read current menu and values without writing
  choose --id ID           Select a displayed stable ID or number
  back | cancel | close    Navigate without changing candidate settings
  save --file .local/FILE   Commit an actual focused response; never pass values as arguments
  recover                  Recover the same interrupted settings save
  reconcile --file FILE --source REF   Reconcile an actual conflict without replacing its reply
  clarify --file FILE      Retain one focused clarification and its reply source
  complete --source REF    Record an actual scope/board update made through onboarding
Add --json for the menu model. The agent renders choices through its harness or numbered chat,
accepts the user's answer and uses the existing semantic helpers before recording a save.
Opening settings does not start onboarding, change an account or activate a schedule.`);
  else {
    const clarification = command === "clarify" ? readConversationInput(root, value("--file")) as { prompt: string; sourceReference: string } : null;
    const view = command === "open" ? openSettings(root, args.includes("--source") ? value("--source") : "settings-command") :
      command === "show" ? settingsView(root) : command === "choose" ? chooseSetting(root, value("--id")) :
      ["back", "cancel", "close"].includes(command) ? chooseSetting(root, command) :
      command === "save" ? saveSettingsReply(root, value("--file")) : command === "recover" ? recoverSettingsSave(root) :
      command === "reconcile" ? reconcileSettingsSave(root, value("--file"), value("--source")) :
      command === "clarify" ? clarifySetting(root, clarification!.prompt, clarification!.sourceReference) :
      command === "complete" ? completeSetupChange(root, value("--source")) : null;
    if (!view) throw new Error("Unknown settings action. Use settings help.");
    console.log(args.includes("--json") ? JSON.stringify(view, null, 2) : renderMenu(view));
  }
} catch (error) {
  const message = error instanceof Error && !(error instanceof SyntaxError) && !/^(ENOENT|EACCES|EPERM|Command failed)/.test(error.message) ? error.message : "The saved settings context needs investigation.";
  console.error(`${message}\nPreserve the menu and proposal; recover or reconcile an interrupted save before continuing. No save success is implied.`);
  process.exitCode = 1;
}
