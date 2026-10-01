import assert from "node:assert/strict";
import { test } from "node:test";

import { ApiError, STATUS, recoveryOf } from "./api-error";

/**
 * `api-error.ts` was split out of `lib/api.ts` precisely so it could be tested — that
 * module imports `@/auth`, which the test runner cannot load (D18). This is the first file
 * to take it up on the offer.
 */

test("every error code maps to a status, and to a plausible one", () => {
  assert.equal(STATUS.unauthenticated, 401);
  assert.equal(STATUS.forbidden, 403);
  assert.equal(STATUS.not_found, 404);
  assert.equal(STATUS.invalid_request, 400);
  assert.equal(STATUS.invalid_graph, 422);
  assert.equal(STATUS.conflict, 409);
  assert.equal(STATUS.internal, 500);
});

test("an ApiError carries its code, message and details", () => {
  const error = new ApiError("conflict", "Already spent.", { recovery: null });
  assert.equal(error.name, "ApiError");
  assert.equal(error.code, "conflict");
  assert.equal(error.message, "Already spent.");
  assert.deepEqual(error.details, { recovery: null });
  assert.ok(error instanceof Error);
});

/* ------------------------------------------------------------------ *
 * Phase 25 — `recoveryOf`, the "way forward" attached to an error
 * ------------------------------------------------------------------ */

test("recoveryOf reads a well-formed in-app recovery", () => {
  assert.deepEqual(
    recoveryOf({ recovery: { href: "/settings?tab=provider", label: "Add a provider key" } }),
    { href: "/settings?tab=provider", label: "Add a provider key" },
  );
});

test("recoveryOf ignores details that carry no recovery", () => {
  assert.equal(recoveryOf(undefined), null);
  assert.equal(recoveryOf(null), null);
  assert.equal(recoveryOf({}), null);
  assert.equal(recoveryOf({ issues: [] }), null);
  assert.equal(recoveryOf("a string"), null);
  assert.equal(recoveryOf(42), null);
  assert.equal(recoveryOf({ recovery: null }), null);
  assert.equal(recoveryOf({ recovery: "not an object" }), null);
});

/**
 * **This is the reason the narrowing exists rather than a cast.** The value arrives in a
 * response body and is turned into something the user can click, so an `href` that leaves
 * the app — or that is not navigation at all — is dropped rather than rendered. An in-app
 * path starts with `/`, and a protocol-relative `//host` does not qualify: `//evil.example`
 * is a different origin to a browser.
 */
test("recoveryOf refuses an href that is not an in-app path", () => {
  for (const href of [
    "https://evil.example/phish",
    "http://evil.example",
    "//evil.example",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "settings",
    "",
  ]) {
    assert.equal(recoveryOf({ recovery: { href, label: "Go" } }), null, `accepted ${href}`);
  }
});

test("recoveryOf refuses a recovery with no usable label", () => {
  assert.equal(recoveryOf({ recovery: { href: "/settings", label: "" } }), null);
  assert.equal(recoveryOf({ recovery: { href: "/settings" } }), null);
  assert.equal(recoveryOf({ recovery: { href: "/settings", label: 7 } }), null);
});

test("PROVIDER_KEY_RECOVERY is itself a recovery this narrowing accepts", async () => {
  // The constant and the guard are in different modules, and a constant the guard would
  // drop is the one failure that would make the whole mechanism silently do nothing.
  const { PROVIDER_KEY_RECOVERY } = await import("./ai/provider");
  assert.deepEqual(recoveryOf({ recovery: PROVIDER_KEY_RECOVERY }), PROVIDER_KEY_RECOVERY);
});
