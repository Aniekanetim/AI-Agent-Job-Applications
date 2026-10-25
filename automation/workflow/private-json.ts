import { existsSync, readFileSync, realpathSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { resolve, relative, isAbsolute, dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { withWriteOwnership } from "./ownership.js";

const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
function pathInCopy(root: string, name: string) {
  if (!name.startsWith(".local/") || name.split(/[\\/]/).includes("..")) throw new Error("Private configuration must stay in .local inside this working copy.");
  const path = resolve(root, name);
  const parent = existsSync(path) ? realpathSync(path) : existsSync(dirname(path)) ? resolve(realpathSync(dirname(path)), name.split("/").at(-1)!) : path;
  const part = relative(realpathSync(root), parent);
  if (part === ".." || part.startsWith("../") || part.startsWith("..\\") || isAbsolute(part)) throw new Error("Private configuration resolves outside the working copy.");
  return path;
}
export function readPrivateJson(root: string, name: string): { data: unknown; revision: string | null } {
  const path = pathInCopy(root, name);
  if (!existsSync(path)) return { data: null, revision: null };
  const bytes = readFileSync(path);
  try { return { data: JSON.parse(bytes.toString("utf8")), revision: hash(bytes) }; }
  catch { throw new Error("Private configuration is unreadable; preserve it for investigation."); }
}
export function savePrivateJson(root: string, name: string, data: unknown, expectedRevision: string | null) {
  return withWriteOwnership(root, name, () => saveLocked(root, name, data, expectedRevision));
}
function saveLocked(root: string, name: string, data: unknown, expectedRevision: string | null) {
  const path = pathInCopy(root, name);
  mkdirSync(dirname(path), { recursive: true }); pathInCopy(root, name);
  const current = existsSync(path) ? readFileSync(path) : null;
  if ((current ? hash(current) : null) !== expectedRevision) throw new Error("Private configuration changed in another session; reload it before saving.");
  if (execFileSync("git", ["-C", root, "ls-files", "--", name], { encoding: "utf8", windowsHide: true }).trim()) throw new Error("Private configuration must be untracked.");
  try { execFileSync("git", ["-C", root, "check-ignore", "--no-index", "--quiet", name], { windowsHide: true }); }
  catch { throw new Error("Private configuration must be ignored by Git."); }
  const text = JSON.stringify(data, null, 2) + "\n";
  if (current?.toString("utf8") === text) return false;
  const temporary = resolve(dirname(path), `config-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, text, { flag: "wx", mode: 0o600 });
    const latest = existsSync(path) ? hash(readFileSync(path)) : null;
    if (latest !== expectedRevision) throw new Error("Private configuration changed in another session; reload it before saving.");
    renameSync(temporary, path);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  return true;
}
