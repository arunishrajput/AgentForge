import assert from "node:assert/strict";
import { test } from "node:test";

import { describeNodes } from "@/lib/nodes";

import { decodeValue, defaultConfig, describeFields, encodeValue, humanise } from "./schema";

/**
 * These run against the *real* registry projection rather than fixtures, so a node
 * added in Phase 8 or 9 whose schema this mapping cannot render fails here instead
 * of silently rendering an unusable config panel.
 */
const byType = new Map(describeNodes().map((node) => [node.type, node]));

function fieldsFor(type: string) {
  const summary = byType.get(type);
  assert.ok(summary, `${type} is not in the registry`);
  return new Map(describeFields(summary.configSchema).map((field) => [field.key, field]));
}

test("every registered node's schema maps to renderable fields", () => {
  for (const summary of describeNodes()) {
    for (const field of describeFields(summary.configSchema)) {
      assert.notEqual(
        field.kind,
        undefined,
        `${summary.type}.${field.key} has no field kind`,
      );
    }
  }
});

test("a string with an enum becomes a select carrying its options", () => {
  const level = fieldsFor("core.log").get("level");
  assert.equal(level?.kind, "enum");
  assert.deepEqual(level?.options, ["info", "warn", "error"]);
  assert.equal(level?.defaultValue, "info");
});

test("a long string becomes a textarea, a short one a single-line input", () => {
  assert.equal(fieldsFor("core.log").get("message")?.kind, "text"); // maxLength 2000
  assert.equal(fieldsFor("core.assert").get("message")?.kind, "text"); // maxLength 500
});

test("z.unknown() becomes the value editor, where templates are typed", () => {
  const left = fieldsFor("core.branch").get("left");
  assert.equal(left?.kind, "value");
  assert.equal(left?.required, true, "branch cannot run without a left value");
  assert.equal(fieldsFor("core.branch").get("right")?.required, false);
});

test("numbers carry their bounds, so the loop cap is visible in the form", () => {
  const max = fieldsFor("core.loop").get("maxIterations");
  assert.equal(max?.kind, "number");
  assert.equal(max?.min, 1);
  assert.equal(max?.max, 25); // HARD_MAX_ITERATIONS
});

test("an open record becomes the key/value editor, not a JSON box", () => {
  assert.equal(fieldsFor("core.set").get("fields")?.kind, "record");
  assert.equal(fieldsFor("core.set").get("merge")?.kind, "boolean");
});

test("a new node starts with schema defaults, and nothing else", () => {
  assert.deepEqual(defaultConfig(byType.get("core.log")?.configSchema), {
    message: "",
    level: "info",
  });
  // `left` is required but has no default: the node is saveable and not runnable.
  assert.deepEqual(defaultConfig(byType.get("core.branch")?.configSchema), {
    operator: "equals",
  });
});

test("a template reference is never reinterpreted as JSON", () => {
  assert.equal(decodeValue("{{input.topic}}"), "{{input.topic}}");
  assert.equal(decodeValue("{{steps.shape.output.count}}"), "{{steps.shape.output.count}}");
});

test("unambiguous JSON literals decode to their type; everything else stays text", () => {
  assert.equal(decodeValue("3"), 3);
  assert.equal(decodeValue("true"), true);
  assert.equal(decodeValue("null"), null);
  assert.deepEqual(decodeValue("[1,2]"), [1, 2]);
  assert.equal(decodeValue("ok"), "ok");
  assert.equal(decodeValue("3 items"), "3 items");
  assert.equal(decodeValue("{not json"), "{not json");
  assert.equal(decodeValue("   "), undefined);
});

test("encode and decode round-trip the values a config actually holds", () => {
  for (const value of ["ok", "{{input.x}}", 3, true, [1, 2], { a: 1 }]) {
    assert.deepEqual(decodeValue(encodeValue(value)), value);
  }
});

test("config keys are humanised for display", () => {
  assert.equal(humanise("maxIterations"), "Max iterations");
  assert.equal(humanise("message"), "Message");
});
