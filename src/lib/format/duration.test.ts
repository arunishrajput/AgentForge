import assert from "node:assert/strict";
import { test } from "node:test";

import { elapsedMs, formatDuration, formatOffset } from "./duration";

test("a step's duration is the gap between its two timestamps", () => {
  assert.equal(
    elapsedMs("2026-09-27T10:00:00.000Z", "2026-09-27T10:00:04.250Z"),
    4250,
  );
});

test("an unfinished step has no duration, which is not zero", () => {
  assert.equal(elapsedMs("2026-09-27T10:00:00.000Z", null), null);
  assert.equal(elapsedMs(null, "2026-09-27T10:00:00.000Z"), null);
  assert.equal(elapsedMs(undefined, undefined), null);
});

test("an unparseable timestamp is no duration rather than NaN", () => {
  assert.equal(elapsedMs("not a date", "2026-09-27T10:00:00.000Z"), null);
});

test("a backwards pair clamps to zero rather than reporting negative time", () => {
  assert.equal(elapsedMs("2026-09-27T10:00:05.000Z", "2026-09-27T10:00:00.000Z"), 0);
});

test("milliseconds below a second, seconds above it", () => {
  assert.equal(formatDuration(0), "0 ms");
  assert.equal(formatDuration(845), "845 ms");
  assert.equal(formatDuration(999.4), "999 ms");
  assert.equal(formatDuration(1000), "1.0 s");
  assert.equal(formatDuration(4240), "4.2 s");
  assert.equal(formatDuration(4250), "4.3 s");
  assert.equal(formatDuration(59_900), "59.9 s");
});

test("minutes once a run is long, zero-padded so a column lines up", () => {
  assert.equal(formatDuration(60_000), "1m 00s");
  assert.equal(formatDuration(72_000), "1m 12s");
  assert.equal(formatDuration(605_000), "10m 05s");
});

test("a rounding second carries into the minute rather than printing 60s", () => {
  assert.equal(formatDuration(119_600), "2m 00s");
});

test("a nonsensical duration says so rather than printing NaN", () => {
  assert.equal(formatDuration(Number.NaN), "—");
  assert.equal(formatDuration(-5), "—");
  assert.equal(formatDuration(Number.POSITIVE_INFINITY), "—");
});

test("a log offset is short, signed, and empty when it cannot be known", () => {
  const start = "2026-09-27T10:00:00.000Z";
  assert.equal(formatOffset(start, "2026-09-27T10:00:00.120Z"), "+120ms");
  assert.equal(formatOffset(start, "2026-09-27T10:00:03.400Z"), "+3.4s");
  assert.equal(formatOffset(start, null), "");
  assert.equal(formatOffset(null, start), "");
});
