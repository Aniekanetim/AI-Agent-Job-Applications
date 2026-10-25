import { readFileSync, realpathSync, statSync } from "node:fs";
import { resolve, relative, isAbsolute, extname } from "node:path";
import { createHash } from "node:crypto";

export interface UploadDocument {
  roleId: string;
  path: string;
  version: string;
  sha256: string;
  originalPath: string;
  originalSha256: string;
  derivation: "original" | "formatConversion" | "factualTailoring";
  inspectedEvidenceReference: string;
}
/** Check the selected actual bytes, not a filename or a claim that conversion succeeded. */
export function inspectUploadDocument(root: string, document: UploadDocument,
  requirements?: { extensions: string[]; maximumBytes?: number }, options: { allowExternalStorage?: boolean } = {}) {
  if (!document.roleId?.trim() || !document.version?.trim() || !document.inspectedEvidenceReference?.trim() ||
    !["original", "formatConversion", "factualTailoring"].includes(document.derivation)) throw new Error("Select a versioned, inspected upload document for this role.");
  const checked = (name: string, expected: string) => {
    const path = realpathSync(resolve(root, name));
    const rel = relative(realpathSync(root), path);
    if (!options.allowExternalStorage && (rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || isAbsolute(rel))) throw new Error("An external secure document path needs the user's existing storage instruction.");
    if (!/^[a-f0-9]{64}$/.test(expected) || createHash("sha256").update(readFileSync(path)).digest("hex") !== expected) throw new Error("Document bytes differ from the saved version; preserve and investigate them.");
    return path;
  };
  const original = checked(document.originalPath, document.originalSha256);
  const path = checked(document.path, document.sha256);
  if (document.derivation === "original" && document.sha256 !== document.originalSha256) throw new Error("A changed CV needs a recorded derivation; it is not the original document.");
  if (document.derivation !== "original" && path === original) throw new Error("A derived CV must preserve the original at a different path.");
  const extension = extname(path).toLowerCase();
  if (![".pdf", ".docx", ".txt"].includes(extension)) throw new Error("The designated upload format needs an explicit supported document procedure.");
  if (requirements && !requirements.extensions.map(value => value.toLowerCase()).includes(extension)) throw new Error("The observed portal does not accept this document format.");
  const bytes = statSync(path).size;
  const content = readFileSync(path);
  if ((extension === ".pdf" && content.subarray(0, 5).toString() !== "%PDF-") ||
    (extension === ".docx" && (content.subarray(0, 2).toString() !== "PK" || !content.includes(Buffer.from("[Content_Types].xml"))))) throw new Error("The document's bytes do not match its filename format; inspect the actual conversion.");
  if (!bytes || (requirements?.maximumBytes !== undefined && bytes > requirements.maximumBytes)) throw new Error("Document size does not satisfy the observed portal requirements.");
  return { roleId: document.roleId, path: document.path, version: document.version, sha256: document.sha256,
    format: extension, bytes, portalCompatibility: requirements ? "checkedAgainstObservedRequirements" : "requiresPortalCheck" };
}
