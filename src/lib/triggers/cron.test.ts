import assert from "node:assert/strict";
import { test } from "node:test";

import { CronError, cronError, formatUtc, nextTimeFor, parseCron } from "./cron";

const at = (iso: string) => new Date(iso);
const next = (expression: string, from: string) => nextTimeFor(expression, at(from));
const iso = (date: Date | null) => date?.toISOString() ?? null;

test("every minute advances to the next whole minute", () => {
  assert.equal(iso(next("* * * * *", "2026-09-26T05:10:30Z")), "2026-09-26T05:11:00.000Z");
});

test("a fired time is never returned again", () => {
  // The tick advances `scheduleNextAt` from the time it just fired. If nextCronTime
  // returned that same instant the schedule would fire in a loop, every tick.
  const fired = "2026-09-26T09:00:00Z";
  assert.equal(iso(next("0 9 * * *", fired)), "2026-09-27T09:00:00.000Z");
});

test("a step lands on each multiple, not on each minute", () => {
  assert.equal(iso(next("*/15 * * * *", "2026-09-26T05:01:00Z")), "2026-09-26T05:15:00.000Z");
  assert.equal(iso(next("*/15 * * * *", "2026-09-26T05:46:00Z")), "2026-09-26T06:00:00.000Z");
});

test("a bare number with a step runs to the end of the field", () => {
  // `5/20` is 5, 25, 45 — the same rule that makes `0/15` and `*/15` agree.
  assert.equal(iso(next("5/20 * * * *", "2026-09-26T05:06:00Z")), "2026-09-26T05:25:00.000Z");
  assert.equal(iso(next("5/20 * * * *", "2026-09-26T05:46:00Z")), "2026-09-26T06:05:00.000Z");
});

test("a list and a range both enumerate", () => {
  assert.equal(iso(next("0 9,17 * * *", "2026-09-26T10:00:00Z")), "2026-09-26T17:00:00.000Z");
  assert.equal(iso(next("30 8-10 * * *", "2026-09-26T09:31:00Z")), "2026-09-26T10:30:00.000Z");
});

test("a weekday range skips the weekend", () => {
  // 2026-09-26 is a Saturday, so the next weekday 09:00 is Monday the 28th.
  assert.equal(iso(next("0 9 * * 1-5", "2026-09-26T05:00:00Z")), "2026-09-28T09:00:00.000Z");
});

test("day 7 is Sunday", () => {
  assert.equal(iso(next("0 0 * * 7", "2026-09-26T05:00:00Z")), "2026-09-27T00:00:00.000Z");
  assert.equal(iso(next("0 0 * * 0", "2026-09-26T05:00:00Z")), "2026-09-27T00:00:00.000Z");
});

test("day-of-month and day-of-week are OR-ed when both are restricted", () => {
  // Standard cron's one real oddity. `1 * 1` is the 1st OR any Monday: from
  // Saturday the 26th that is Monday the 28th, not October the 1st.
  assert.equal(iso(next("0 0 1 * 1", "2026-09-26T05:00:00Z")), "2026-09-28T00:00:00.000Z");
  // With day-of-week unrestricted, only the 1st matches.
  assert.equal(iso(next("0 0 1 * *", "2026-09-26T05:00:00Z")), "2026-10-01T00:00:00.000Z");
});

test("it crosses a month and a year boundary", () => {
  assert.equal(iso(next("0 0 1 1 *", "2026-09-26T05:00:00Z")), "2027-01-01T00:00:00.000Z");
  assert.equal(iso(next("0 0 31 * *", "2026-09-26T05:00:00Z")), "2026-10-31T00:00:00.000Z");
});

test("29 February resolves to the next leap year", () => {
  assert.equal(iso(next("0 0 29 2 *", "2026-09-26T05:00:00Z")), "2028-02-29T00:00:00.000Z");
});

test("an expression that can never match returns null rather than spinning", () => {
  // 30 February is legal to write and matches nothing. The bounded search is what
  // keeps this a null instead of a hung request inside the cron tick.
  assert.equal(next("0 0 30 2 *", "2026-09-26T05:00:00Z"), null);
});

test("aliases are accepted", () => {
  assert.equal(iso(next("@daily", "2026-09-26T05:00:00Z")), "2026-09-27T00:00:00.000Z");
  assert.equal(iso(next("@hourly", "2026-09-26T05:10:00Z")), "2026-09-26T06:00:00.000Z");
  assert.equal(iso(next("@WEEKLY", "2026-09-26T05:00:00Z")), "2026-09-27T00:00:00.000Z");
});

test("seconds are discarded, never carried into the result", () => {
  const result = next("* * * * *", "2026-09-26T05:10:59Z");
  assert.equal(result?.getUTCSeconds(), 0);
  assert.equal(result?.getUTCMilliseconds(), 0);
});

test("evaluation is UTC regardless of the host zone", () => {
  // The suite must give the same answer on a laptop in IST and on Cloud Run in UTC.
  const fired = at("2026-09-26T05:00:00Z");
  assert.equal(iso(nextTimeFor("0 9 * * *", fired)), "2026-09-26T09:00:00.000Z");
});

test("unsupported and malformed expressions are rejected with a reason", () => {
  for (const expression of [
    "",
    "* * * *",
    "* * * * * *",
    "* * * * * 2026",
    "mon * * * *",
    "0 9 * * MON",
    "0 0 ? * *",
    "0 0 L * *",
    "0 0 * * 5#2",
    "60 * * * *",
    "* 24 * * *",
    "0 0 0 * *",
    "0 0 * 13 *",
    "5-1 * * * *",
    "*/0 * * * *",
    "*/a * * * *",
    "1,,2 * * * *",
    "*/2/3 * * * *",
  ]) {
    assert.throws(() => parseCron(expression), CronError, `accepted "${expression}"`);
    assert.ok(cronError(expression), `no message for "${expression}"`);
  }
});

test("a valid expression reports no error", () => {
  for (const expression of ["* * * * *", "0 9 * * 1-5", "*/15 * * * *", "@daily", "0 0 1 1 *"]) {
    assert.equal(cronError(expression), null, expression);
  }
});

test("parse keeps the expression as written, not as expanded", () => {
  assert.equal(parseCron("  @daily  ").expression, "@daily");
});

test("formatUtc is locale- and zone-pinned", () => {
  // A client component rendering a date with the browser's defaults is React #418.
  assert.equal(formatUtc("2026-09-26T09:05:00Z"), "26 Sept 2026, 09:05 UTC");
});
