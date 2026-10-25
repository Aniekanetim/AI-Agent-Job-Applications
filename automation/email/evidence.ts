import { readFileSync, realpathSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";

export interface FileEvidence { path: string; sha256: string }
export const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export function readEvidence(root: string, ref: FileEvidence): Buffer {
  if (!ref || typeof ref.path !== "string" || !ref.path || !/^[a-f0-9]{64}$/.test(ref.sha256)) throw new Error("Record the actual evidence file and its SHA-256.");
  const path = realpathSync(resolve(root, ref.path)), part = relative(realpathSync(root), path);
  if (!part || part.startsWith("..") || isAbsolute(part)) throw new Error("Email evidence must stay inside the private working copy.");
  const bytes = readFileSync(path);
  if (digest(bytes) !== ref.sha256) throw new Error("Saved email or application evidence changed; reconcile it before cleanup.");
  return bytes;
}
export function evidenceFile(root: string, path: string): FileEvidence {
  const ref = { path, sha256: digest(readFileSync(resolve(root, path))) }; readEvidence(root, ref); return ref;
}
