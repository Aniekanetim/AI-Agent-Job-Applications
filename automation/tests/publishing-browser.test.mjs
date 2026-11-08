import test from "node:test";
import assert from "node:assert/strict";
import { workingRoot } from "../browser/runtime.mjs";
import { exerciseComposer } from "../../.local/check/automation/publishing/rehearsal.js";

test("the pinned browser rehearses a local composer with text, a photo and a video", async () => {
  const result = await exerciseComposer(workingRoot);
  assert.deepEqual(result.verified, ["text", "image", "video"]);
});
