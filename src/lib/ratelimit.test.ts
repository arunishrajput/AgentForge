import assert from "node:assert/strict";
import { test } from "node:test";

import { clientAddress, createRateLimiter } from "./ratelimit";

/** **The in-memory limiter — Phase 40.** Per instance by design; these pin what it does within one. */

test("allows the limit, refuses the next, and says how long until the window closes", () => {
  const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 });
  assert.equal(limiter.take("a", 0).allowed, true);
  assert.equal(limiter.take("a", 1_000).allowed, true);
  assert.equal(limiter.take("a", 2_000).allowed, true);
  const refused = limiter.take("a", 10_000);
  assert.equal(refused.allowed, false);
  assert.equal(refused.retryAfterSeconds, 50);
});

test("a window reopens when it closes, and keys are independent", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 1_000 });
  assert.equal(limiter.take("a", 0).allowed, true);
  assert.equal(limiter.take("a", 500).allowed, false);
  assert.equal(limiter.take("b", 500).allowed, true);
  assert.equal(limiter.take("a", 1_000).allowed, true);
});

test("a refused call does not push the window out — hammering is let back in on schedule", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 1_000 });
  limiter.take("a", 0);
  for (let t = 100; t < 1_000; t += 100) assert.equal(limiter.take("a", t).allowed, false);
  assert.equal(limiter.take("a", 1_000).allowed, true);
});

test("the table is bounded: a scan that never repeats a key cannot grow it without limit", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 50 });
  for (let i = 0; i < 5_000; i += 1) limiter.take(`key-${i}`, i);
  assert.ok(limiter.size() <= 50, `held ${limiter.size()} windows`);
});

test("a full table drops expired windows before live ones", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, maxKeys: 3 });
  limiter.take("old-1", 0);
  limiter.take("old-2", 0);
  limiter.take("live", 5_000);
  limiter.take("new", 5_001);
  // `live` was still inside its window when the table filled, so it survives and is still limited.
  assert.equal(limiter.take("live", 5_002).allowed, false);
});

test("the address is the last entry of X-Forwarded-For, which the client cannot choose", () => {
  const request = (value: string | null) =>
    new Request("https://example.test/", { headers: value === null ? {} : { "x-forwarded-for": value } });
  // Cloud Run appends the address it saw; anything before it is what the caller claimed.
  assert.equal(clientAddress(request("1.2.3.4, 203.0.113.9")), "203.0.113.9");
  assert.equal(clientAddress(request("203.0.113.9")), "203.0.113.9");
  assert.equal(clientAddress(request(null)), "unknown");
});
