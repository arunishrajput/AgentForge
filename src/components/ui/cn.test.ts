import assert from "node:assert/strict";
import { test } from "node:test";

import { cn } from "./cn";

test("joins the parts it is given", () => {
  assert.equal(cn("btn", "btn-primary"), "btn btn-primary");
});

test("drops every falsy part, so a conditional class needs no ternary", () => {
  assert.equal(cn("btn", false, null, undefined, "w-full"), "btn w-full");
  assert.equal(cn(), "");
});

test("preserves order, which is what makes a caller's class win", () => {
  // The primitives rely on this instead of a Tailwind-aware merge: the caller's
  // class is appended last, and equal-specificity CSS resolves on source order.
  assert.equal(cn("rounded-lg", "rounded-full"), "rounded-lg rounded-full");
});
