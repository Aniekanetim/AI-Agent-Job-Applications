import fs from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { digest, readEvidence, type FileEvidence } from "../email/evidence.js";
import { readPrivateJson, savePrivateJson } from "../workflow/private-json.js";
import { validateOperatingPreferences } from "../scheduling/preferences.js";
import type { PublicProfile, Preferences } from "./store.js";
import { validInstant } from "./schedule.js";

export const boardConfigFile = ".local/publishing/board.json";
export const profilePath = "Content Creation Context/profile.local.md";
export type ContentMode = "off" | "autonomous" | "onDemand";
export type ContentProfile = PublicProfile & { audience: string; rules: string; mediaPreferences: string };
type BoardConfig = {
  schemaVersion: 1; mode: ContentMode; sourceReference: string; adopted: true;
  account: Preferences["account"];
  scheduledCheck?: FileEvidence;
};
export const contentReference = (value: unknown): value is string => typeof value === "string" &&
  !!value.trim() && value.length <= 300 && !/[\u0000\r\n]/.test(value);

export function readBoardConfig(root: string) {
  const loaded = readPrivateJson(root, boardConfigFile);
  const data = loaded.data as BoardConfig | null;
  if (data && (data.schemaVersion !== 1 || data.adopted !== true || !["off", "autonomous", "onDemand"].includes(data.mode) ||
    !contentReference(data.sourceReference))) throw new Error("Preserve unreadable content settings for investigation.");
  return { data, revision: loaded.revision };
}

export function readContentProfile(root: string) {
  const file = resolve(root, profilePath), folder = resolve(root, "Content Creation Context");
  if (fs.lstatSync(folder).isSymbolicLink() || !fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) {
    throw new Error("Use the private content profile in the configured working copy.");
  }
  if (execFileSync("git", ["-C", root, "ls-files", "--", profilePath], { encoding: "utf8", windowsHide: true }).trim()) {
    throw new Error("The content creation profile must be private.");
  }
  execFileSync("git", ["-C", root, "check-ignore", "--no-index", "--quiet", profilePath], { windowsHide: true });
  const bytes = fs.readFileSync(file);
  const match = /\x60\x60\x60json\s*\r?\n([\s\S]*?)\r?\n\x60\x60\x60\s*$/.exec(bytes.toString("utf8"));
  if (!match) throw new Error("Read the content profile template and save the user's actual choices.");
  const profile = JSON.parse(match[1]) as ContentProfile;
  if (!profile || !contentReference(profile.voice) || !contentReference(profile.audience) ||
    typeof profile.rules !== "string" || !profile.rules.trim() || profile.rules.length > 4000 ||
    typeof profile.mediaPreferences !== "string" || !Array.isArray(profile.topics) || !profile.topics.length || !profile.topics.every(contentReference) ||
    !Array.isArray(profile.facts) || !profile.facts.every(fact => fact && /^[a-zA-Z0-9_-]{1,100}$/.test(fact.id) &&
      typeof fact.text === "string" && !!fact.text.trim() && fact.text.length <= 2000) ||
    new Set(profile.facts.map(fact => fact.id)).size !== profile.facts.length) throw new Error("Save the user's content voice, audience, topics, facts and editorial rules.");
  return { profile, sha256: digest(bytes) };
}

export function saveBoardConfig(root: string, mode: ContentMode, sourceReference: string, account?: Preferences["account"]) {
  if (!["off", "autonomous", "onDemand"].includes(mode) || !contentReference(sourceReference)) throw new Error("Use the user's actual content mode choice.");
  if (mode !== "off") readContentProfile(root);
  const previous = readBoardConfig(root);
  const next: BoardConfig = { ...previous.data, schemaVersion: 1, adopted: true, mode, sourceReference,
    account: account === undefined ? previous.data?.account ?? null : account };
  if (JSON.stringify(previous.data?.account) !== JSON.stringify(next.account)) delete next.scheduledCheck;
  savePrivateJson(root, boardConfigFile, next, previous.revision);
  return next;
}

export function verifySharedPublishing(root: string, ref: FileEvidence, scheduleReference: string, account: NonNullable<Preferences["account"]>) {
  const preferences = readPrivateJson(root, ".local/operation-preferences.json").data;
  validateOperatingPreferences(preferences);
  if (preferences.mode !== "recurring" || !scheduleReference || preferences.scheduleReference !== scheduleReference ||
    !ref?.path.startsWith(".local/publishing/evidence/")) throw new Error("Verify publishing from the actual shared check-in.");
  const report = JSON.parse(readEvidence(root, ref).toString("utf8")) as {
    workingRoot: string; executionContext: string; scheduleReference: string; runReference: string; profileUrl: string; accountRevision: string;
    checkedAt: string; composerOpened: boolean; synthetic: FileEvidence;
  };
  if (report.workingRoot !== resolve(root) || report.executionContext !== "scheduled" || report.scheduleReference !== scheduleReference ||
    !contentReference(report.runReference) || report.profileUrl !== account.profileUrl || report.accountRevision !== digest(JSON.stringify(account)) ||
    !validInstant(report.checkedAt) || report.composerOpened !== true ||
    !report.synthetic?.path.startsWith(".local/publishing/evidence/")) throw new Error("Record a successful rehearsal in this actual scheduled environment.");
  const synthetic = JSON.parse(readEvidence(root, report.synthetic).toString("utf8")) as { synthetic: boolean; verified: string[]; checkedAt: string };
  if (!synthetic.synthetic || !validInstant(synthetic.checkedAt) || synthetic.checkedAt > report.checkedAt ||
    !Array.isArray(synthetic.verified) || !["text", "image", "video"].every(format => synthetic.verified.includes(format))) {
    throw new Error("Verify the synthetic text, image and video composer rehearsal first.");
  }
}

export function saveSharedPublishingCheck(root: string, evidence: FileEvidence, scheduleReference: string, account: NonNullable<Preferences["account"]>) {
  verifySharedPublishing(root, evidence, scheduleReference, account);
  const previous = readBoardConfig(root);
  if (!previous.data || JSON.stringify(previous.data.account) !== JSON.stringify(account)) {
    throw new Error("Verify the current publishing account and completed board cutover.");
  }
  savePrivateJson(root, boardConfigFile, { ...previous.data, scheduledCheck: evidence }, previous.revision);
}
