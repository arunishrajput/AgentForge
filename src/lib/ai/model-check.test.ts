import assert from "node:assert/strict";
import { test } from "node:test";

import { describeModelCheckFailure, ProviderError } from "./types";

/**
 * Phase 13. Choosing a model runs one real call against the provider before the choice
 * is stored, and what the user is told when that call fails has to distinguish two very
 * different things:
 *
 *   • "this key cannot run that model"  — change the setting
 *   • "the provider is busy right now"  — change nothing, try again
 *
 * The old code said the first for both. Measured against the live API on 2026-09-26:
 * `gemini-3-flash-preview` allows 20 free-tier requests a minute, and going over it
 * produced `This key cannot use "gemini-3-flash-preview"` — advice to change a setting
 * that was correct. It cost a red check in the deployed verification suite before it
 * cost a user anything.
 */

const provider = (status: number, message: string, retryable: boolean) =>
  new ProviderError(message, { status, retryable });

test("a rate limit is reported as temporary, and says the key was not changed", () => {
  const verdict = describeModelCheckFailure(
    "gemini-3-flash-preview",
    provider(429, "You exceeded your current quota. Please retry in 5s.", true),
  );

  assert.equal(verdict.kind, "temporary");
  assert.match(verdict.message!, /temporarily unavailable/);
  assert.match(verdict.message!, /your key was not changed/);
  // The one thing it must not say.
  assert.doesNotMatch(verdict.message!, /cannot use/);
  // The provider's own words survive — they carry the retry delay, the actionable part.
  assert.match(verdict.message!, /Please retry in 5s/);
});

test("a model under load is temporary too, for the same reason", () => {
  const verdict = describeModelCheckFailure("m", provider(503, "high demand", true));
  assert.equal(verdict.kind, "temporary");
  assert.doesNotMatch(verdict.message!, /cannot use/);
});

test("a model the key genuinely cannot run is reported as a bad choice", () => {
  for (const [status, message] of [
    [404, "no longer available to new users"],
    [400, "not found for API version v1beta"],
  ] as const) {
    const verdict = describeModelCheckFailure("gemini-2.5-flash", provider(status, message, false));
    assert.equal(verdict.kind, "rejected", `status ${status}`);
    assert.match(verdict.message!, /cannot use "gemini-2\.5-flash"/);
    assert.match(verdict.message!, new RegExp(message.slice(0, 20)));
  }
});

test("a rejected key is a bad choice, not a temporary condition", () => {
  const verdict = describeModelCheckFailure("m", provider(403, "API key not valid", false));
  assert.equal(verdict.kind, "rejected");
  assert.match(verdict.message!, /API key not valid/);
});

test("anything that is not a provider failure is not diagnosed at all", () => {
  // A driver error must never be dressed up as a verdict about the user's model choice,
  // and must never reach them: the caller turns `unknown` into a generic 500.
  const verdict = describeModelCheckFailure("m", new Error("connect ECONNREFUSED 10.0.0.1:5432"));
  assert.equal(verdict.kind, "unknown");
  assert.equal("message" in verdict, false);
});
