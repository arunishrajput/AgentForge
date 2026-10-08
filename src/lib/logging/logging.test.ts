import assert from "node:assert/strict";
import { test } from "node:test";

import { EVENTS, type EventName } from "./events";
import { errorGroup, normaliseError } from "./fingerprint";
import { addLogContext, logContext, traceFromHeaders, withLogContext } from "./context";
import { buildEntry } from "./logger";

/* ------------------------------------------------------------------ *
 * fingerprint.ts — error grouping
 * ------------------------------------------------------------------ */

test("two failures differing only in their ids are one group", () => {
  const a = errorGroup('Node "http_1" (integration.http) failed: 503 from https://api.example.com/v2/items/9931');
  const b = errorGroup('Node "http_7" (integration.http) failed: 503 from https://api.example.com/v2/items/4402');
  assert.equal(a.id, b.id);
  assert.equal(a.template, b.template);
});

test("two genuinely different failures are different groups", () => {
  const a = errorGroup('Node "x" (integration.http) failed: the remote returned 503');
  const b = errorGroup('Node "x" (integration.http) failed: no answer within 12000 ms');
  assert.notEqual(a.id, b.id);
});

test("a group id is eight stable hex characters", () => {
  const group = errorGroup("anything at all");
  assert.match(group.id, /^[0-9a-f]{8}$/);
  assert.equal(group.id, errorGroup("anything at all").id);
});

test("an absent message is its own group rather than a throw", () => {
  for (const value of [null, undefined, "", "   "]) {
    const group = errorGroup(value);
    assert.equal(group.template, "(no message)");
    assert.match(group.id, /^[0-9a-f]{8}$/);
  }
});

test("a uuid is replaced whole, not digit by digit", () => {
  const template = normaliseError("run 3f2504e0-4f89-11d3-9a0c-0305e82c3301 was abandoned");
  assert.equal(template, "run <uuid> was abandoned");
});

/**
 * The ordering rules in `fingerprint.ts`, pinned. Each of these passes only because the
 * more specific rule runs before the greedier one — reorder the table and one of them
 * shreds into `<n>` fragments and stops grouping with its own kind.
 */
test("a url survives as one token rather than being shredded by the number rule", () => {
  assert.equal(
    normaliseError("could not reach https://example.com:8443/v2/items?page=3"),
    "could not reach <url>",
  );
});

test("a timestamp survives as one token", () => {
  assert.equal(
    normaliseError("lease expired at 2026-09-30T10:51:22.118Z"),
    "lease expired at <time>",
  );
});

test("a duration keeps its unit, because a timeout and a refusal are different problems", () => {
  assert.equal(normaliseError("no answer within 12000 ms"), "no answer within <n>ms");
  assert.notEqual(normaliseError("no answer within 12000 ms"), normaliseError("the remote returned 503"));
});

test("an email address is replaced whole", () => {
  assert.equal(normaliseError("no member for someone@example.com"), "no member for <email>");
});

test("a long hex run is replaced, a short word is not", () => {
  assert.equal(normaliseError("token deadbeefdeadbeef rejected"), "token <hex> rejected");
  assert.equal(normaliseError("cafe rejected"), "cafe rejected");
});

/**
 * Every decimal digit is also a hex digit, so without the `[a-f]` lookahead the hex rule
 * swallows a thirteen-digit `Date.now()` and labels a number as an id. Found by
 * `verify-observability.mjs`, whose probe marker carries a timestamp.
 */
test("a long run of digits is a number, not a hex id", () => {
  assert.equal(normaliseError("probe 1759233123456 failed"), "probe <n> failed");
  assert.equal(normaliseError("id 1759233123abc failed"), "id <hex> failed");
});

test("a template is capped so a payload in a message cannot become a group of its own", () => {
  const group = errorGroup("x".repeat(5000));
  assert.ok(group.template.length <= 200, `template was ${group.template.length} characters`);
  assert.ok(group.template.endsWith("…"));
});

/* ------------------------------------------------------------------ *
 * context.ts — correlation
 * ------------------------------------------------------------------ */

test("the ambient context is empty outside a request and never throws", () => {
  assert.deepEqual(logContext(), {});
});

test("a nested context merges onto the one around it rather than replacing it", () => {
  withLogContext({ trace: "t1", userId: "u1" }, () => {
    withLogContext({ runId: "r1" }, () => {
      assert.deepEqual(logContext(), { trace: "t1", userId: "u1", runId: "r1" });
    });
    // The inner context does not leak back out.
    assert.deepEqual(logContext(), { trace: "t1", userId: "u1" });
  });
});

test("the context survives an await, which is the whole reason it exists", async () => {
  await withLogContext({ trace: "t2", runId: "r2" }, async () => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    assert.equal(logContext().runId, "r2");
  });
});

test("addLogContext fills in an id learned part-way through, and is a no-op outside one", () => {
  addLogContext({ workspaceId: "w0" });
  assert.deepEqual(logContext(), {});

  withLogContext({ trace: "t3" }, () => {
    addLogContext({ workspaceId: "w1" });
    assert.equal(logContext().workspaceId, "w1");
  });
});

test("a real Cloud Run trace header is used as-is", () => {
  const headers = new Headers({ "x-cloud-trace-context": "105445AA7843BC8BF206B12000100000/1;o=1" });
  assert.equal(traceFromHeaders(headers), "105445aa7843bc8bf206b12000100000");
});

/**
 * A header is caller-controlled. An unvalidated value written into a log field is how a
 * log gets forged entries, so anything that is not 32 hex characters is discarded and a
 * fresh id minted — including the empty case off Cloud Run.
 */
test("a forged or absent trace header is replaced rather than trusted", () => {
  for (const raw of ['not-a-trace/1;o=1', '" injected "', "", "abc"]) {
    const trace = traceFromHeaders(new Headers(raw ? { "x-cloud-trace-context": raw } : {}));
    assert.match(trace, /^[0-9a-f]{32}$/);
    assert.notEqual(trace, raw);
  }
  assert.match(traceFromHeaders(null), /^[0-9a-f]{32}$/);
});

/* ------------------------------------------------------------------ *
 * logger.ts — the entry shape Cloud Logging actually reads
 * ------------------------------------------------------------------ */

test("an entry carries Cloud Logging's reserved field names exactly", () => {
  withLogContext({ trace: "abc", runId: "r9", workspaceId: "w9" }, () => {
    const entry = buildEntry("INFO", "run.finished", "A run finished.", { status: "succeeded" });
    assert.equal(entry.severity, "INFO");
    assert.equal(entry.message, "A run finished.");
    assert.equal(entry.event, "run.finished");
    assert.equal(entry["logging.googleapis.com/trace"], "abc");
    assert.deepEqual(entry["logging.googleapis.com/labels"], { event: "run.finished" });
    assert.equal(entry.runId, "r9");
    assert.equal(entry.workspaceId, "w9");
    assert.equal(entry.status, "succeeded");
  });
});

test("the event is duplicated into labels, because a filter on a label stays fast", () => {
  for (const event of EVENTS) {
    const entry = buildEntry("INFO", event, "x");
    assert.deepEqual(entry["logging.googleapis.com/labels"], { event });
  }
});

test("no trace field is written when there is no context, rather than a null one", () => {
  const entry = buildEntry("INFO", "cron.tick", "tick");
  assert.ok(!("logging.googleapis.com/trace" in entry));
  assert.ok(!("runId" in entry));
});

test("an undefined field is dropped and an explicit null is kept", () => {
  const entry = buildEntry("INFO", "run.finished", "x", { a: undefined, b: null, c: 0, d: false });
  assert.ok(!("a" in entry));
  assert.equal(entry.b, null);
  assert.equal(entry.c, 0);
  assert.equal(entry.d, false);
});

/**
 * The backstop in `redact`. A driver puts the connection string in its own error message,
 * which is how a password reaches a log without anybody deciding to put it there — the
 * same defect `/api/health` was given a stripper for in Phase 2.
 */
test("a connection string in a field is stripped, not logged", () => {
  const entry = buildEntry("ERROR", "api.error", "connect failed", {
    detail: "could not connect to postgresql://user:hunter2@db.example.com/main",
  });
  assert.ok(!String(entry.detail).includes("hunter2"));
  assert.match(String(entry.detail), /\[redacted-connection-string\]/);
});

test("a very long field is truncated so one node cannot write a kilobyte per line", () => {
  const entry = buildEntry("ERROR", "api.error", "x", { detail: "y".repeat(5000) });
  assert.ok(String(entry.detail).length <= 512);
});

/* ------------------------------------------------------------------ *
 * events.ts — the names the log-based metrics in OPERATIONS.md depend on
 * ------------------------------------------------------------------ */

test("every event name is unique and dotted", () => {
  assert.equal(new Set(EVENTS).size, EVENTS.length);
  for (const event of EVENTS) assert.match(event, /^[a-z]+\.[a-z.]+$/);
});

/**
 * **The point of the catalogue.** A log-based metric is a filter string living in a GCP
 * resource, and nothing connects it to this repository: rename an event and the metric
 * reports zero forever, which looks exactly like a healthy system. These names are the ones
 * `OPERATIONS.md` builds metrics on, so renaming one has to fail here first. Phase 34 added the
 * fifth, `generation.finished`, for `agentforge_generations`.
 */
test("the five events the log-based metrics filter on still exist", () => {
  const metered: EventName[] = ["run.finished", "node.finished", "model.call", "api.error", "generation.finished"];
  for (const event of metered) assert.ok(EVENTS.includes(event), `${event} is no longer emitted`);
});
