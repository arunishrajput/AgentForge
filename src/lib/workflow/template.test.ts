import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveConfig, resolveValue } from "./template";

const scope = {
  input: { name: "Arunish", count: 7, tags: ["a", "b"], nested: { deep: true } },
  steps: { shape: { output: { id: "wf_1" } } },
};

test("a whole-string reference keeps the referenced value's type", () => {
  assert.equal(resolveValue("{{input.count}}", scope), 7);
  assert.deepEqual(resolveValue("{{input.tags}}", scope), ["a", "b"]);
  assert.equal(resolveValue("{{input.nested.deep}}", scope), true);
});

test("an embedded reference interpolates as a string", () => {
  assert.equal(resolveValue("hi {{input.name}}, {{input.count}} times", scope), "hi Arunish, 7 times");
});

test("array indexing and step output both resolve", () => {
  assert.equal(resolveValue("{{input.tags[1]}}", scope), "b");
  assert.equal(resolveValue("{{steps.shape.output.id}}", scope), "wf_1");
});

test("an unresolvable reference becomes empty rather than throwing", () => {
  assert.equal(resolveValue("{{input.nope.deeper}}", scope), undefined);
  assert.equal(resolveValue("value: {{input.nope}}", scope), "value: ");
});

test("resolution recurses through nested config without touching non-strings", () => {
  const resolved = resolveConfig(
    { fields: { who: "{{input.name}}", howMany: "{{input.count}}", keep: 42, flag: false } },
    scope,
  );
  assert.deepEqual(resolved, {
    fields: { who: "Arunish", howMany: 7, keep: 42, flag: false },
  });
});

test("there is no expression evaluation, only lookup", () => {
  // If this ever returned 2, a template engine would have crept in and with it a
  // way to execute user-authored code. CLAUDE.md forbids that in any form.
  assert.equal(resolveValue("{{1+1}}", scope), "{{1+1}}");
});
