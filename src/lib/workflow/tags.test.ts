import assert from "node:assert/strict";
import { test } from "node:test";

import { TAG_NAME_MAX, findTag, sameTagName, sortTags, tagNameSchema } from "./tags";

const parse = (value: unknown) => tagNameSchema.safeParse(value);

test("a tag name is trimmed and its inner whitespace collapsed", () => {
  assert.deepEqual(parse("  needs   review \t").data, "needs review");
});

test("a blank name is refused — trimmed before the minimum is checked", () => {
  for (const blank of ["", "   ", "\t\n"]) {
    const result = parse(blank);
    assert.equal(result.success, false, JSON.stringify(blank));
    assert.match(result.error?.issues[0]?.message ?? "", /needs a name/);
  }
});

test("a name is at most 32 characters, counted after trimming", () => {
  assert.equal(parse("x".repeat(TAG_NAME_MAX)).success, true);
  assert.equal(parse(`  ${"x".repeat(TAG_NAME_MAX)}  `).success, true);
  assert.equal(parse("x".repeat(TAG_NAME_MAX + 1)).success, false);
});

test("a control character is refused, so the missing-tag sentinel can never be a real tag", () => {
  assert.equal(parse("bill\u0000ing").success, false);
  assert.equal(parse("bill\u007fing").success, false);
  // The list's `<select>` marks a URL's unknown tag with this value (`workflow-list.tsx`).
  assert.equal(parse("\u0000missing").success, false);
});

test("an ordinary name with punctuation, digits and accents is a tag", () => {
  for (const name of ["billing", "Q4 2026", "needs-review", "café", "ops/oncall", "#urgent"]) {
    assert.equal(parse(name).success, true, name);
  }
});

test("two names are one tag ignoring case and surrounding space — the unique index's rule", () => {
  assert.equal(sameTagName("Billing", "billing"), true);
  assert.equal(sameTagName(" billing ", "BILLING"), true);
  assert.equal(sameTagName("billing", "billings"), false);
});

test("findTag finds by name ignoring case, and nothing for a name it does not hold", () => {
  const tags = [
    { id: "t1", name: "Billing" },
    { id: "t2", name: "ops" },
  ];
  assert.equal(findTag(tags, "billing")?.id, "t1");
  assert.equal(findTag(tags, "OPS")?.id, "t2");
  assert.equal(findTag(tags, "weekly"), undefined);
});

test("tags sort by name, ignoring case, with numbers in numeric order, without mutating", () => {
  const tags = [
    { id: "a", name: "zebra" },
    { id: "b", name: "Q10" },
    { id: "c", name: "apple" },
    { id: "d", name: "Q2" },
  ];
  const before = tags.map((tag) => tag.id);
  assert.deepEqual(
    sortTags(tags).map((tag) => tag.name),
    ["apple", "Q2", "Q10", "zebra"],
  );
  assert.deepEqual(tags.map((tag) => tag.id), before);
});
