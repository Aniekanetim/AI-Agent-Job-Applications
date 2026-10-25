import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { inspectUploadDocument, type UploadDocument } from "../onboarding/documents.js";

test("upload inspection preserves originals, validates version hashes and observed portal constraints", t => {
  const root = mkdtempSync(join(tmpdir(), "application-documents-"));
  t.after(() => { const part = relative(tmpdir(), resolve(root)); assert.ok(part && !part.startsWith("..") && !isAbsolute(part)); rmSync(root, { recursive: true }); });
  writeFileSync(join(root, "original.txt"), "Synthetic qualification facts only.");
  writeFileSync(join(root, "rendition.pdf"), "%PDF-1.7\nSynthetic signature fixture; document rendering is verified separately by the agent.");
  const sha = (name: string) => createHash("sha256").update(readFileSync(join(root, name))).digest("hex");
  const original = readFileSync(join(root, "original.txt"));
  const document: UploadDocument = { roleId: "synthetic-role", path: "rendition.pdf", version: "synthetic-v1", sha256: sha("rendition.pdf"),
    originalPath: "original.txt", originalSha256: sha("original.txt"), derivation: "formatConversion", inspectedEvidenceReference: "synthetic-inspection" };
  assert.equal(inspectUploadDocument(root, document, { extensions: [".pdf"] }).portalCompatibility, "checkedAgainstObservedRequirements");
  assert.equal(inspectUploadDocument(root, document).portalCompatibility, "requiresPortalCheck");
  assert.throws(() => inspectUploadDocument(root, { ...document, derivation: "original" }), /recorded derivation/);
  assert.throws(() => inspectUploadDocument(root, { ...document, path: "original.txt", sha256: sha("original.txt") }));
  assert.throws(() => inspectUploadDocument(root, document, { extensions: [".docx"] }));
  assert.throws(() => inspectUploadDocument(root, document, { extensions: [".pdf"], maximumBytes: 1 }));
  assert.throws(() => inspectUploadDocument(root, { ...document, sha256: "0".repeat(64) }));
  writeFileSync(join(root, "wrong.pdf"), "A renamed TXT is not a PDF.");
  assert.throws(() => inspectUploadDocument(root, { ...document, path: "wrong.pdf", sha256: sha("wrong.pdf") }));
  assert.deepEqual(readFileSync(join(root, "original.txt")), original);
});
