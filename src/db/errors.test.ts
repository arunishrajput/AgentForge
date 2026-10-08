import assert from "node:assert/strict";
import { test } from "node:test";

import { isUniqueViolation } from "./errors";

test("a unique violation is recognised on the driver's error itself", () => {
  assert.equal(isUniqueViolation({ code: "23505" }), true);
});

test("and through drizzle's wrapping, which puts the driver's error on `cause`", () => {
  const driver = Object.assign(new Error('duplicate key value violates unique constraint "tag_workspace_name_idx"'), {
    code: "23505",
  });
  const wrapped = new Error("Failed query: insert into \"tag\" …", { cause: driver });
  assert.equal(isUniqueViolation(wrapped), true);
  assert.equal(isUniqueViolation(new Error("outer", { cause: wrapped })), true);
});

test("any other error is not one — a foreign-key or a not-null violation included", () => {
  assert.equal(isUniqueViolation({ code: "23503" }), false);
  assert.equal(isUniqueViolation({ code: "23502" }), false);
  assert.equal(isUniqueViolation(new Error("network")), false);
  assert.equal(isUniqueViolation(null), false);
  assert.equal(isUniqueViolation(undefined), false);
  assert.equal(isUniqueViolation("23505"), false);
});

test("a cause chain that loops ends rather than spinning", () => {
  const a: { code: string; cause?: unknown } = { code: "XX000" };
  a.cause = a;
  assert.equal(isUniqueViolation(a), false);
});
