import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTENT_SECURITY_POLICY, SECURITY_HEADERS } from "./headers";

const header = (name: string) => SECURITY_HEADERS.find((h) => h.key === name)?.value;

test("another site cannot frame the app, by CSP and by the older header", () => {
  assert.match(CONTENT_SECURITY_POLICY, /(^|; )frame-ancestors 'self'(;|$)/);
  assert.equal(header("X-Frame-Options"), "SAMEORIGIN");
});

test("the policy never weakens scripts: no unsafe-inline, no unsafe-eval, no wildcard", () => {
  assert.doesNotMatch(CONTENT_SECURITY_POLICY, /unsafe-|\*/);
});

test("the policy carries the directives that need no nonce", () => {
  for (const d of ["base-uri 'self'", "object-src 'none'"]) {
    assert.ok(CONTENT_SECURITY_POLICY.split("; ").includes(d), d);
  }
});

test("form-action is absent: Chrome applies it to sign-in's redirect to Google", () => {
  assert.doesNotMatch(CONTENT_SECURITY_POLICY, /form-action/);
});

test("each header appears once", () => {
  const keys = SECURITY_HEADERS.map((h) => h.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(header("X-Content-Type-Options"), "nosniff");
});
