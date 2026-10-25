import { readPrivateJson, savePrivateJson } from "../workflow/private-json.js";
import { emptyBrowserPreferences, validateBrowserPreferences, type BrowserPreferences } from "./preferences.js";
export const preferencesFile = ".local/browser-preferences.json";
export function loadBrowserPreferences(root: string) {
  const loaded = readPrivateJson(root, preferencesFile);
  if (loaded.data === null) return { preferences: emptyBrowserPreferences(), revision: loaded.revision };
  validateBrowserPreferences(loaded.data);
  return { preferences: loaded.data, revision: loaded.revision };
}
export function saveBrowserPreferences(root: string, preferences: BrowserPreferences, revision: string | null) {
  validateBrowserPreferences(preferences);
  return savePrivateJson(root, preferencesFile, preferences, revision);
}
