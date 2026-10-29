import { existsSync, realpathSync, readFileSync, mkdirSync, openSync, closeSync, writeFileSync, fsyncSync } from "node:fs";
import { resolve, relative, dirname, isAbsolute } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

export interface SiteEvidence { path: string; sha256: string }
export const siteDigest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export function privateSitePaths(root: string, names: string[]) {
  if (!names.length) return;
  names.forEach(name => siteFile(root, name, false));
  if (execFileSync("git", ["-C", root, "ls-files", "--", ...names], { encoding: "utf8", windowsHide: true }).trim()) throw new Error("Runtime site records must be untracked.");
  const ignored = execFileSync("git", ["-C", root, "-c", "core.quotePath=false", "check-ignore", "--no-index", "--stdin"], { input: names.join("\n") + "\n", encoding: "utf8", windowsHide: true }).trim().split(/\r?\n/);
  if (names.some(name => !ignored.includes(name))) throw new Error("Runtime site records must be ignored by Git.");
}
/** Check the nearest existing ancestor too: a missing child must not bypass a junction check. */
export function siteFile(root: string, name: string, privateOnly = true) {
  if (isAbsolute(name) || /[\\:\x00-\x1f]/.test(name) || name.split("/").some(p => !p || p === "." || p === ".." || /[. ]$/.test(p))) throw new Error("Use a contained site-context path.");
  const path = resolve(root, name); let ancestor = path;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  const part = relative(realpathSync(root), realpathSync(ancestor));
  if (part === ".." || part.startsWith("../") || part.startsWith("..\\") || isAbsolute(part)) throw new Error("Site context resolves outside this working copy.");
  if (privateOnly) {
    if (execFileSync("git", ["-C", root, "ls-files", "--", name], { encoding: "utf8", windowsHide: true }).trim()) throw new Error("Runtime site records must be untracked.");
    try { execFileSync("git", ["-C", root, "check-ignore", "--no-index", "--quiet", name], { windowsHide: true }); }
    catch { throw new Error("Runtime site records must be ignored by Git."); }
  }
  return path;
}
export function siteEvidence(root: string, path: string): SiteEvidence {
  return { path, sha256: siteDigest(readFileSync(siteFile(root, path))) };
}
export function checkSiteEvidence(root: string, evidence: SiteEvidence) {
  if (!evidence || !/^[a-f0-9]{64}$/.test(evidence.sha256) || siteEvidence(root, evidence.path).sha256 !== evidence.sha256) throw new Error("Site evidence is missing or changed; inspect the actual dependency before continuing.");
}
/** Exclusive create, never truncate existing answers, credentials or learned methods. */
export function createSiteFile(root: string, path: string, contents: string) {
  const file = siteFile(root, path); mkdirSync(dirname(file), { recursive: true }); siteFile(root, path);
  let fd: number;
  try { fd = openSync(file, "wx", 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; throw error; }
  try { writeFileSync(fd, contents); fsyncSync(fd); } finally { closeSync(fd); }
  return true;
}
