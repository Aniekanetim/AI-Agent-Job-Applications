import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync, renameSync, unlinkSync, openSync, closeSync, fsyncSync } from "node:fs";
import { resolve, relative, isAbsolute, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { acquireOwnership } from "../workflow/ownership.js";
import { loadInboxState, alertOwnershipKey } from "./state-store.js";
import { messageKey, type EmailIdentity } from "./intake.js";
import { digest, evidenceFile } from "./evidence.js";

/** Commit staged alert artifacts through the same ownership boundary as progress. */
export function saveAlertArtifact(root: string, identity: EmailIdentity, name: string, bytes: Buffer, expectedSha256: string | null) {
  const key = messageKey(identity), task = /^Task Board\/(Email Alerts|To Do|Applied|Blocked)\/[^/\\]+\.md$/.test(name);
  if (isAbsolute(name) || name.split(/[\\/]/).includes("..") || !(name.startsWith(`.local/alerts/${key}/`) || task)) throw new Error("Use this exact alert's private evidence namespace or its associated task path.");
  const owner = acquireOwnership(root, alertOwnershipKey(identity));
  try {
    const record = loadInboxState(root).state.messages.find(r => messageKey(r.identity) === messageKey(identity));
    if (!record || record.cleanupState === "cleanupPending") throw new Error("Keep pending cleanup evidence unchanged; preserve the proposed artifact separately until recovery.");
    if (task && !record.vacancies.some(v => v.taskPath === name || v.taskEvidence?.path === name)) throw new Error("Save this alert's task-path association before writing its ticket.");
    const path = resolve(root, name); mkdirSync(dirname(path), { recursive: true });
    const part = relative(realpathSync(root), realpathSync(dirname(path)));
    if (!part || part.startsWith("..") || isAbsolute(part)) throw new Error("Alert artifacts must stay inside this private working copy.");
    if (execFileSync("git", ["-C", root, "ls-files", "--", name], { encoding: "utf8", windowsHide: true }).trim()) throw new Error("Actual alert artifacts must be untracked.");
    try { execFileSync("git", ["-C", root, "check-ignore", "--no-index", "--quiet", name], { windowsHide: true }); } catch { throw new Error("Actual alert artifacts must be ignored by Git."); }
    const currentHash = () => existsSync(path) ? digest(readFileSync(path)) : null;
    if (currentHash() !== expectedSha256) throw new Error("The alert artifact changed; reload it before applying this proposal.");
    const temp = resolve(dirname(path), `artifact-${randomUUID()}.tmp`);
    try {
      writeFileSync(temp, bytes, { flag: "wx", mode: 0o600, flush: true }); owner.assertOwned();
      if (currentHash() !== expectedSha256) throw new Error("The alert artifact changed during its guarded save.");
      renameSync(temp, path); const fd = openSync(path, "r+"); try { fsyncSync(fd); } finally { closeSync(fd); }
      if (process.platform !== "win32") { const fd = openSync(dirname(path), "r"); try { fsyncSync(fd); } finally { closeSync(fd); } }
    } finally { if (existsSync(temp)) unlinkSync(temp); }
    return evidenceFile(root, name);
  } finally { owner.release(); }
}
