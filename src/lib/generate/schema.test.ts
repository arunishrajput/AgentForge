import assert from "node:assert/strict";
import { test } from "node:test";

import { generateRequestSchema } from "./schema";

/**
 * The trim-before-min ordering is easy to write the wrong way round and the
 * consequence is invisible in review: a whitespace-only prompt reaching the provider
 * and spending a real call. So it is asserted.
 */
test("a whitespace-only prompt is refused before any model is called", () => {
  assert.equal(generateRequestSchema.safeParse({ prompt: "   " }).success, false);
  assert.equal(generateRequestSchema.safeParse({ prompt: "\n\t " }).success, false);
  assert.equal(generateRequestSchema.safeParse({ prompt: "" }).success, false);
});

test("a prompt is trimmed before it reaches the model", () => {
  const parsed = generateRequestSchema.parse({ prompt: "  build me a thing  " });
  assert.equal(parsed.prompt, "build me a thing");
});

test("an all-whitespace name is refused rather than stored as a blank title", () => {
  assert.equal(generateRequestSchema.safeParse({ prompt: "ok", name: "  " }).success, false);
  assert.equal(generateRequestSchema.parse({ prompt: "ok", name: " Fine " }).name, "Fine");
});
