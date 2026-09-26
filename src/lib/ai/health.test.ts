import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  BASE_COOLDOWN_MS,
  countsAgainstModel,
  GONE_COOLDOWN_MS,
  isOpen,
  MAX_COOLDOWN_MS,
  modelHealthSnapshot,
  OPEN_AFTER_FAILURES,
  orderChain,
  recordFailure,
  recordSuccess,
  resetModelHealth,
} from "./health";

/**
 * The circuit breaker, tested against the incident that produced it: Phase 12's
 * `ai.agent` step that spent 91.9 s on a model which had accepted the request and gone
 * quiet. The behaviour that matters is not "does it track failures" but "does a model
 * known to be failing stop being tried first".
 */

beforeEach(() => resetModelHealth());

const fail = { status: 0, error: "no answer within 12000 ms", latencyMs: 12_000 };

test("one failure degrades a model; the breaker opens on the second", () => {
  recordFailure("m", fail, 1_000);
  assert.equal(isOpen("m", 1_000), false);
  assert.equal(modelHealthSnapshot(1_000)[0].state, "degraded");

  recordFailure("m", fail, 2_000);
  assert.equal(isOpen("m", 2_000), true);
  assert.equal(modelHealthSnapshot(2_000)[0].state, "unavailable");
  assert.equal(OPEN_AFTER_FAILURES, 2);
});

test("an open breaker moves its model to the back of the chain, never off it", () => {
  const chain = ["primary", "second", "third"];
  recordFailure("primary", fail, 1_000);
  recordFailure("primary", fail, 1_000);

  const ordered = orderChain(chain, 1_000);
  assert.deepEqual(ordered, ["second", "third", "primary"]);
  // Never removed: a wrong health reading must cost order, not availability.
  assert.equal(ordered.length, chain.length);
});

test("the caller's order is preserved among models that are not failing", () => {
  assert.deepEqual(orderChain(["a", "b", "c"], 1_000), ["a", "b", "c"]);
});

test("when every breaker is open the caller's own order is honoured", () => {
  for (const model of ["a", "b"]) {
    recordFailure(model, fail, 1_000);
    recordFailure(model, fail, 1_000);
  }
  // Some model has to be tried. Inventing an order here would be worse than the
  // caller's, which at least encodes the measured latency ranking.
  assert.deepEqual(orderChain(["a", "b"], 1_000), ["a", "b"]);
});

test("the breaker closes after its cooldown and re-opens on a single further failure", () => {
  recordFailure("m", fail, 0);
  recordFailure("m", fail, 0);
  assert.equal(isOpen("m", BASE_COOLDOWN_MS - 1), true);

  // Half-open: the next call is let through.
  assert.equal(isOpen("m", BASE_COOLDOWN_MS + 1), false);

  // ...but the failure count is kept, so one more failure re-opens immediately rather
  // than spending another two attempts rediscovering the same thing.
  recordFailure("m", fail, BASE_COOLDOWN_MS + 2);
  assert.equal(isOpen("m", BASE_COOLDOWN_MS + 3), true);
});

test("consecutive openings back off exponentially, to a ceiling", () => {
  let now = 0;
  const openUntil = () => modelHealthSnapshot(now)[0].openUntil! - now;

  recordFailure("m", fail, now);
  recordFailure("m", fail, now);
  assert.equal(openUntil(), BASE_COOLDOWN_MS);

  now = BASE_COOLDOWN_MS + 1;
  isOpen("m", now);
  recordFailure("m", fail, now);
  assert.equal(openUntil(), BASE_COOLDOWN_MS * 2);

  for (let i = 0; i < 10; i += 1) {
    now += MAX_COOLDOWN_MS + 1;
    isOpen("m", now);
    recordFailure("m", fail, now);
  }
  assert.equal(openUntil(), MAX_COOLDOWN_MS);
});

test("a success closes the breaker and clears the backoff ladder", () => {
  recordFailure("m", fail, 0);
  recordFailure("m", fail, 0);
  recordSuccess("m", 900, 1_000);

  assert.equal(isOpen("m", 1_000), false);
  const [health] = modelHealthSnapshot(1_000);
  assert.equal(health.state, "healthy");
  assert.equal(health.failures, 0);
  assert.equal(health.lastLatencyMs, 900);

  // The ladder reset too: two fresh failures open it at the BASE cooldown, not at 2×.
  recordFailure("m", fail, 2_000);
  recordFailure("m", fail, 2_000);
  assert.equal(modelHealthSnapshot(2_000)[0].openUntil! - 2_000, BASE_COOLDOWN_MS);
});

test("a 404 opens the breaker at once, and for the maximum", () => {
  // "no longer available to new users" is permanent. Three model names in the Chapter 1
  // fallback chain went that way mid-project, so this is not a hypothetical.
  recordFailure("gone", { status: 404, error: "no longer available", latencyMs: 300 }, 0);
  assert.equal(isOpen("gone", 0), true);
  assert.equal(modelHealthSnapshot(0)[0].openUntil, GONE_COOLDOWN_MS);
});

test("a bad key or a malformed request never counts against a model", () => {
  // Marking every model unhealthy because one key is bad would be exactly backwards.
  for (const status of [400, 401, 403]) {
    assert.equal(countsAgainstModel(status), false, `${status} should not count`);
    recordFailure("m", { status, error: "API key not valid", latencyMs: 40 }, 0);
  }
  assert.deepEqual(modelHealthSnapshot(0), []);
  assert.equal(isOpen("m", 0), false);

  for (const status of [0, 408, 429, 404, 500, 503]) {
    assert.equal(countsAgainstModel(status), true, `${status} should count`);
  }
});

test("the snapshot reports healthiest first and does not report a lapsed cooldown as open", () => {
  recordSuccess("good", 100, 0);
  recordFailure("bad", fail, 0);
  recordFailure("bad", fail, 0);

  const now = BASE_COOLDOWN_MS + 5_000;
  const snapshot = modelHealthSnapshot(now);
  assert.deepEqual(snapshot.map((entry) => entry.model), ["good", "bad"]);
  assert.equal(snapshot[0].state, "healthy");
  // The cooldown elapsed, so it is degraded-and-worth-a-try, not unavailable.
  assert.equal(snapshot[1].state, "degraded");
  assert.equal(snapshot[1].openUntil, null);
});
