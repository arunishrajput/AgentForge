import assert from "node:assert/strict";
import { test } from "node:test";

import { NodeError } from "@/lib/nodes/types";

import {
  attemptDelayMs,
  DEFAULT_POLICY,
  MAX_BACKOFF_MS,
  MAX_RETRIES,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  nodePolicySchema,
  readPolicy,
  retryable,
} from "./policy";

/**
 * Every bound here is a safety property rather than a preference, and the reason is in
 * `PROGRESS.md`: a generated graph is written by a model, and a model given a numeric
 * bound will reach for its edge. `maxIterations: 1` on an agent node was schema-valid,
 * graph-valid and fatal. So the schema is asserted, not trusted.
 */

test("the default policy is one attempt and no timeout of its own", () => {
  assert.deepEqual(DEFAULT_POLICY, { retries: 0, backoffMs: 500 });
  assert.equal(DEFAULT_POLICY.timeoutMs, undefined);
});

test("an absent policy is the default", () => {
  assert.deepEqual(readPolicy(undefined), DEFAULT_POLICY);
  assert.deepEqual(readPolicy(null), DEFAULT_POLICY);
});

test("an unreadable policy is the default, never something permissive", () => {
  // The failure direction matters: "could not read 'retry twice'" must land on "run
  // once", never on "retry for ever".
  assert.deepEqual(readPolicy("nonsense"), DEFAULT_POLICY);
  assert.deepEqual(readPolicy({ retries: "lots" }), DEFAULT_POLICY);
  assert.deepEqual(readPolicy({ retries: 99 }), DEFAULT_POLICY);
  assert.deepEqual(readPolicy({ retries: -1 }), DEFAULT_POLICY);
});

test("retries cannot exceed the ceiling, whatever the graph asks for", () => {
  assert.equal(nodePolicySchema.safeParse({ retries: MAX_RETRIES }).success, true);
  assert.equal(nodePolicySchema.safeParse({ retries: MAX_RETRIES + 1 }).success, false);
  assert.equal(nodePolicySchema.safeParse({ retries: 1.5 }).success, false);
});

test("a timeout must be inside the range every real node can use", () => {
  assert.equal(nodePolicySchema.safeParse({ timeoutMs: MIN_TIMEOUT_MS }).success, true);
  assert.equal(nodePolicySchema.safeParse({ timeoutMs: MAX_TIMEOUT_MS }).success, true);
  // Below the floor every node fails; above the ceiling a single attempt could outlive
  // the engine's own 120 s deadline and the lease that protects the run.
  assert.equal(nodePolicySchema.safeParse({ timeoutMs: MIN_TIMEOUT_MS - 1 }).success, false);
  assert.equal(nodePolicySchema.safeParse({ timeoutMs: MAX_TIMEOUT_MS + 1 }).success, false);
});

test("backoff is bounded too", () => {
  assert.equal(nodePolicySchema.safeParse({ backoffMs: 0 }).success, true);
  assert.equal(nodePolicySchema.safeParse({ backoffMs: MAX_BACKOFF_MS }).success, true);
  assert.equal(nodePolicySchema.safeParse({ backoffMs: MAX_BACKOFF_MS + 1 }).success, false);
});

test("the worst legal policy still fits inside the engine's deadline", () => {
  // The property that makes the ceilings above defensible rather than arbitrary: three
  // retries at the longest timeout plus the longest backoffs must not be able to be
  // configured into something the run's own 120 s deadline cannot contain. It cannot
  // *fit*, and that is the point — the run deadline cuts it off, so the policy can
  // never extend a run beyond it.
  const worst = nodePolicySchema.parse({
    retries: MAX_RETRIES,
    backoffMs: MAX_BACKOFF_MS,
    timeoutMs: MAX_TIMEOUT_MS,
  });
  const attempts = worst.retries + 1;
  const backoff = [1, 2, 3].reduce((total, n) => total + attemptDelayMs(worst, n), 0);
  assert.equal(attempts * MAX_TIMEOUT_MS + backoff > 120_000, true);
});

test("backoff doubles per retry and then stops doubling", () => {
  const policy = nodePolicySchema.parse({ backoffMs: 1000 });
  assert.equal(attemptDelayMs(policy, 1), 1000);
  assert.equal(attemptDelayMs(policy, 2), 2000);
  assert.equal(attemptDelayMs(policy, 3), 4000);
  assert.equal(attemptDelayMs(policy, 20), MAX_BACKOFF_MS);
});

test("there is no pause before the first attempt", () => {
  assert.equal(attemptDelayMs(nodePolicySchema.parse({ backoffMs: 1000 }), 0), 0);
});

test("a zero backoff retries immediately", () => {
  assert.equal(attemptDelayMs(nodePolicySchema.parse({ backoffMs: 0 }), 1), 0);
  assert.equal(attemptDelayMs(nodePolicySchema.parse({ backoffMs: 0 }), 5), 0);
});

test("a config failure is never retried", () => {
  // Retrying it burns the run's deadline three times over to reach the same answer: the
  // config came from the graph, and the graph has not changed between attempts.
  assert.equal(retryable(new NodeError("Invalid config: ms Too small")), false);
});

test("an abort is never retried", () => {
  // The run's own deadline or a cancellation aborted it. Another attempt cannot succeed
  // and would only delay the run reaching its terminal state.
  const aborted = new Error("aborted");
  aborted.name = "AbortError";
  const timedOut = new Error("timed out");
  timedOut.name = "TimeoutError";
  assert.equal(retryable(aborted), false);
  assert.equal(retryable(timedOut), false);
});

test("an integration failure is retried", () => {
  // The default direction, deliberately: the engine cannot reliably tell a transient
  // 503 from a permanent one without a taxonomy every node author would have to
  // maintain, and retrying a permanent failure costs only the backoff.
  assert.equal(retryable(new NodeError("Discord returned 503.")), true);
  assert.equal(retryable(new Error("fetch failed")), true);
  assert.equal(retryable("a thrown string"), true);
});
