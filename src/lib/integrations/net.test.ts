import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { postMessage } from "./discord";
import { IntegrationError, request, RETRY_STATUSES, retryAfterMs } from "./net";

/**
 * The retry policy — `BUILD_PLAN.md` Phase 11, task 3.
 *
 * This is a critical-path test in the phase's sense: every assertion below is a way
 * `DEMO.md` Beat 8 can end with nothing posted and nothing appended. The half that
 * matters most is the *negative* half — the calls that must **not** be repeated,
 * because a retry that double-posts is a worse stage failure than the blip it was
 * meant to absorb.
 *
 * `fetch` is replaced rather than module-mocked: `request` calls the global directly,
 * so a fake global is the whole seam (the same reason the provider adapter takes a
 * `fetchImpl` — D32).
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answers each queued entry in turn, and records what it was asked. */
function fakeFetch(queue: Array<Response | Error>) {
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET" });
    const next = queue.shift();
    if (next === undefined) throw new Error("fake fetch ran out of answers");
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return calls;
}

/** `retry-after: 0` keeps the pause honest and the test fast. */
const busy = (status = 503) =>
  new Response("{}", { status, headers: { "retry-after": "0" } });

/* ------------------------------------------------------------------ *
 * What is retried
 * ------------------------------------------------------------------ */

test("a 503 is retried once and the second answer is returned", async () => {
  const calls = fakeFetch([busy(), new Response("{}", { status: 200 })]);

  const response = await request("https://example.test/x", {
    timeoutMs: 1000,
    retry: { attempts: 2 },
  });

  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
});

test("every status in the retry set means 'nothing happened, ask again'", async () => {
  assert.deepEqual(RETRY_STATUSES, [429, 502, 503, 504]);

  for (const status of RETRY_STATUSES) {
    const calls = fakeFetch([busy(status), new Response("{}", { status: 200 })]);
    const response = await request("https://example.test/x", {
      timeoutMs: 1000,
      retry: { attempts: 2 },
    });
    assert.equal(response.status, 200, `status ${status} should have been retried`);
    assert.equal(calls.length, 2);
  }
});

test("retrying stops at the attempt count rather than looping", async () => {
  const calls = fakeFetch([busy(), busy(), busy()]);

  const response = await request("https://example.test/x", {
    timeoutMs: 1000,
    retry: { attempts: 2 },
  });

  // The caller gets the last failure to report, not an exception it did not ask for.
  assert.equal(response.status, 503);
  assert.equal(calls.length, 2);
});

/* ------------------------------------------------------------------ *
 * What is deliberately NOT retried
 * ------------------------------------------------------------------ */

test("a call with no retry policy is made exactly once", async () => {
  const calls = fakeFetch([busy()]);

  const response = await request("https://example.test/x", { timeoutMs: 1000 });

  assert.equal(response.status, 503);
  assert.equal(calls.length, 1);
});

test("a 500 is not retried, because for a create it is ambiguous", async () => {
  // The failure this prevents: Discord accepts the message, its edge answers 500,
  // and the retry posts Beat 8's message to the channel a second time.
  const calls = fakeFetch([new Response("{}", { status: 500 })]);

  const response = await request("https://example.test/x", {
    timeoutMs: 1000,
    retry: { attempts: 2 },
  });

  assert.equal(response.status, 500);
  assert.equal(calls.length, 1);
});

test("a transport failure is not retried unless the caller declared it idempotent", async () => {
  const calls = fakeFetch([new TypeError("fetch failed")]);

  await assert.rejects(
    request("https://example.test/x", { timeoutMs: 1000, retry: { attempts: 2 } }),
    IntegrationError,
  );
  assert.equal(calls.length, 1);
});

test("a transport failure IS retried when it is", async () => {
  const calls = fakeFetch([new TypeError("fetch failed"), new Response("{}", { status: 200 })]);

  const response = await request("https://example.test/x", {
    timeoutMs: 1000,
    retry: { attempts: 2, onTransportError: true },
  });

  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
});

test("a spent timeout is never retried, even on an idempotent call", async () => {
  // The deadline is already gone. A second attempt only spends the next one, and the
  // engine's 120 s budget is not a thing to burn twice on the same wedged host.
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET" });
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      );
    });
  }) as typeof fetch;

  await assert.rejects(
    request("https://example.test/x", {
      timeoutMs: 10,
      retry: { attempts: 2, onTransportError: true },
    }),
    (error: unknown) => {
      assert.ok(error instanceof IntegrationError);
      assert.match(error.message, /timed out after 10 ms/);
      assert.equal(error.retryable, false);
      return true;
    },
  );
  assert.equal(calls.length, 1);
});

test("a cancelled run is not retried", async () => {
  const controller = new AbortController();
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET" });
    controller.abort();
    throw new DOMException("aborted", "AbortError");
  }) as typeof fetch;

  await assert.rejects(
    request("https://example.test/x", {
      timeoutMs: 1000,
      signal: controller.signal,
      retry: { attempts: 2, onTransportError: true },
    }),
    (error: unknown) => {
      assert.ok(error instanceof IntegrationError);
      assert.match(error.message, /cancelled/);
      return true;
    },
  );
  assert.equal(calls.length, 1);
});

/* ------------------------------------------------------------------ *
 * Retry-After
 * ------------------------------------------------------------------ */

test("Retry-After is read as seconds or as an HTTP date", () => {
  const now = Date.parse("2026-09-26T10:00:00Z");
  assert.equal(retryAfterMs("2"), 2000);
  assert.equal(retryAfterMs("0"), 0);
  assert.equal(retryAfterMs("Sat, 26 Sep 2026 10:00:03 GMT", now), 3000);
  // A date in the past is zero, not negative: the wait is already over.
  assert.equal(retryAfterMs("Sat, 26 Sep 2026 09:59:00 GMT", now), 0);
  assert.equal(retryAfterMs(null), null);
  assert.equal(retryAfterMs("soon"), null);
});

test("a Retry-After longer than the cap fails fast instead of sleeping", async () => {
  // Discord can ask for 30 s. Waiting that long inside a node is worse on stage than
  // a failed step naming the rate limit, and the caller still gets the 429 to report.
  const calls = fakeFetch([new Response("{}", { status: 429, headers: { "retry-after": "30" } })]);

  const started = Date.now();
  const response = await request("https://example.test/x", {
    timeoutMs: 1000,
    retry: { attempts: 2 },
  });

  assert.equal(response.status, 429);
  assert.equal(calls.length, 1);
  assert.ok(Date.now() - started < 1000, "it slept instead of giving up");
});

/* ------------------------------------------------------------------ *
 * The call sites that opted in — DEMO.md Beat 8
 * ------------------------------------------------------------------ */

test("a rate-limited Discord post is retried and the message still lands", async () => {
  const calls = fakeFetch([
    busy(429),
    new Response(JSON.stringify({ id: "m1", channel_id: "c1" }), { status: 200 }),
  ]);

  const result = await postMessage("https://discord.com/api/webhooks/1/tok", {
    content: "urgent",
  });

  assert.equal(result.messageId, "m1");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, "POST");
  // `?wait=true` is what makes the created message readable back (see discord.ts).
  assert.match(calls[0].url, /\?wait=true$/);
});

test("a Discord post that dies in transit is NOT repeated", async () => {
  // The whole point of `onTransportError` being off for a create: the message may
  // already be in the channel.
  const calls = fakeFetch([new TypeError("fetch failed")]);

  await assert.rejects(
    postMessage("https://discord.com/api/webhooks/1/tok", { content: "urgent" }),
    IntegrationError,
  );
  assert.equal(calls.length, 1);
});
