import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dayBounds,
  decodeRunKey,
  EMPTY_RUN_QUERY,
  encodeRunKey,
  isDay,
  isFiltered,
  parseRunQuery,
  runQuerySearch,
  shapePage,
  type RunKey,
} from "./query";

/**
 * **What `/runs` shows, as a URL — Phase 33, D150.** The page's address is its query, so the two
 * conversions here are what a pasted link and a filter change both go through.
 */

const KEY: RunKey = { at: "2026-10-08T09:00:09.155123Z", id: "0bcf25b7-0849-400f-82b9-05049265b713" };

test("a cursor round-trips through the URL exactly, microseconds and all", () => {
  const text = encodeRunKey(KEY);
  assert.equal(text, "2026-10-08T09:00:09.155123Z_0bcf25b7-0849-400f-82b9-05049265b713");
  assert.deepEqual(decodeRunKey(text), KEY);
  // And through URLSearchParams, which is how it actually travels.
  const params = new URLSearchParams(runQuerySearch(EMPTY_RUN_QUERY, { before: KEY }));
  assert.deepEqual(decodeRunKey(params.get("before")), KEY);
});

test("a cursor with millisecond precision is not one — it would skip runs on the next page", () => {
  assert.equal(decodeRunKey("2026-10-08T09:00:09.155Z_abc"), null);
  assert.equal(decodeRunKey("2026-10-08T09:00:09.155123Z"), null);
  assert.equal(decodeRunKey("2026-13-45T99:00:09.155123Z_abc"), null);
  assert.equal(decodeRunKey("2026-10-08T09:00:09.155123Z_abc;drop"), null);
  assert.equal(decodeRunKey(""), null);
  assert.equal(decodeRunKey(null), null);
});

test("a day is a real calendar day", () => {
  assert.equal(isDay("2026-10-08"), true);
  assert.equal(isDay("2026-02-30"), false);
  assert.equal(isDay("2026-10-8"), false);
  assert.equal(isDay("yesterday"), false);
});

test("a date range covers whole UTC days, the last one included", () => {
  const { from, to } = dayBounds({ from: "2026-10-01", to: "2026-10-08" });
  assert.equal(from?.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(to?.toISOString(), "2026-10-09T00:00:00.000Z");
  assert.deepEqual(dayBounds({ from: null, to: null }), { from: null, to: null });
});

test("a URL is read forgivingly: a value that does not belong reads as any", () => {
  const query = parseRunQuery({
    status: "exploded",
    trigger: "carrier-pigeon",
    workflow: "../../etc",
    from: "2026-02-30",
    to: "not-a-day",
    before: "nope",
  });
  assert.deepEqual(query, EMPTY_RUN_QUERY);
});

test("a URL that names real values is read exactly", () => {
  const query = parseRunQuery(
    new URLSearchParams("status=failed&trigger=webhook&workflow=wf-1&from=2026-10-01&to=2026-10-08&before=" + encodeRunKey(KEY)),
  );
  assert.deepEqual(query, {
    status: "failed",
    trigger: "webhook",
    workflowId: "wf-1",
    from: "2026-10-01",
    to: "2026-10-08",
    before: KEY,
    after: null,
  });
});

test("one direction at a time: before wins over after", () => {
  const query = parseRunQuery({ before: encodeRunKey(KEY), after: encodeRunKey(KEY) });
  assert.deepEqual(query.before, KEY);
  assert.equal(query.after, null);
});

test("a query writes back to the URL it came from, defaults omitted", () => {
  assert.equal(runQuerySearch(EMPTY_RUN_QUERY), "");
  const query = { ...EMPTY_RUN_QUERY, status: "failed" as const, workflowId: "wf-1", from: "2026-10-01" };
  assert.equal(runQuerySearch(query), "?status=failed&workflow=wf-1&from=2026-10-01");
  assert.deepEqual(parseRunQuery(new URLSearchParams(runQuerySearch(query))), query);
  // A filter change starts from the newest run again: no cursor unless one is given.
  assert.equal(runQuerySearch({ ...query, before: KEY }), "?status=failed&workflow=wf-1&from=2026-10-01");
});

test("filtered means a filter, not a page", () => {
  assert.equal(isFiltered(EMPTY_RUN_QUERY), false);
  assert.equal(isFiltered({ ...EMPTY_RUN_QUERY, before: KEY }), false);
  assert.equal(isFiltered({ ...EMPTY_RUN_QUERY, trigger: "schedule" }), true);
});

const rows = (...ids: string[]) => ids.map((id, index) => ({ id, key: { at: `2026-10-08T09:00:0${index}.000000Z`, id } }));

test("the first page: an older page follows when one more row came back, and none precedes it", () => {
  const page = shapePage(rows("e", "d", "c"), { before: null, after: null }, 2);
  assert.deepEqual(page.rows.map((row) => row.id), ["e", "d"]);
  assert.equal(page.next?.id, "d");
  assert.equal(page.prev, null);

  const last = shapePage(rows("b", "a"), { before: null, after: null }, 2);
  assert.equal(last.next, null);
});

test("an older page has newer runs behind it", () => {
  const page = shapePage(rows("c", "b"), { before: KEY, after: null }, 2);
  assert.deepEqual(page.rows.map((row) => row.id), ["c", "b"]);
  assert.equal(page.prev?.id, "c");
  assert.equal(page.next, null);
});

test("stepping back to a newer page reads oldest first and turns it round", () => {
  // Asked for `after`, the database answers oldest first: c, d, then e as the extra row.
  const page = shapePage(rows("c", "d", "e"), { before: null, after: KEY }, 2);
  assert.deepEqual(page.rows.map((row) => row.id), ["d", "c"]);
  assert.equal(page.prev?.id, "d", "e is newer still, so there is a page before this one");
  assert.equal(page.next?.id, "c", "and the page this came from is after it");

  const first = shapePage(rows("c", "d"), { before: null, after: KEY }, 2);
  assert.equal(first.prev, null, "nothing newer: this is the first page again");
});
