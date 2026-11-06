import { realpathSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { execFileSync } from "node:child_process";
import { evidenceFile } from "../email/evidence.js";
import { ticketFolder } from "../workflow/board.js";

/** Explicit selected review only. Never call from queue/delivery code. Validate containment before reading. */
export function selectedTicketEvidence(root: string, path: string) {
  ticketFolder(path);
  const part = relative(realpathSync(root), realpathSync(resolve(root, path)));
  if (!part || part.startsWith("..") || isAbsolute(part)) throw new Error("The selected ticket must stay in the private copy.");
  if (execFileSync("git", ["-C", root, "ls-files", "--", path], { encoding: "utf8", windowsHide: true }).trim()) throw new Error("Actual task tickets must remain untracked.");
  try { execFileSync("git", ["-C", root, "check-ignore", "--no-index", "--quiet", path], { windowsHide: true }); }
  catch { throw new Error("Actual task tickets must remain ignored."); }
  return evidenceFile(root, path);
}
