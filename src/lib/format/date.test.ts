import assert from "node:assert/strict";
import { test } from "node:test";

import { formatDayUtc, formatUtc } from "./date";

const INSTANT = "2026-09-26T09:05:00.000Z";

test("formatUtc renders the instant in UTC and says so", () => {
  const formatted = formatUtc(INSTANT);
  assert.match(formatted, /26 Sep\S* 2026/);
  assert.match(formatted, /09:05 UTC$/);
});

test("formatUtc does not follow the machine's timezone", () => {
  // The whole point of the module. `TZ` is read at process start, so this asserts
  // the property that survives it: an explicit `timeZone` in the formatter.
  const midnightInLondonSummer = formatUtc("2026-07-01T23:30:00.000Z");
  assert.match(midnightInLondonSummer, /1 Jul\S* 2026/);
  assert.match(midnightInLondonSummer, /23:30 UTC$/);
});

test("formatUtc takes a Date as well as an ISO string", () => {
  assert.equal(formatUtc(new Date(INSTANT)), formatUtc(INSTANT));
});

test("formatDayUtc drops the time and the zone suffix", () => {
  const day = formatDayUtc(INSTANT);
  assert.match(day, /26 Sep\S* 2026/);
  assert.doesNotMatch(day, /09:05/);
  assert.doesNotMatch(day, /UTC/);
});
