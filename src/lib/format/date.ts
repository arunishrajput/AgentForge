/**
 * The product's date formatting, in one place.
 *
 * Every one of these formats in **UTC with a fixed locale**, and that is not a
 * stylistic choice. A client component renders twice — on the server for the
 * initial HTML, then in the browser to hydrate — and `toLocaleString()` answers
 * with whatever locale and timezone the machine has. The two renders disagreed on
 * the settings page in Phase 6 and React threw hydration error #418, which was
 * found by reading the console on the deployed page and by nothing a test asserted.
 *
 * Three call sites had grown their own copy of this formatter by Phase 15 (the two
 * settings forms and `triggers/cron.ts`). One module now, so the next component to
 * need a date cannot get it subtly wrong.
 *
 * There is deliberately **no relative formatter** — no "3 minutes ago". A relative
 * label depends on the clock at render time, so the server's and the browser's
 * differ by exactly the network latency between them, which is the same hydration
 * bug wearing a friendlier face.
 */

const STAMP = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

const DAY = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "UTC",
});

/** A full timestamp: `26 Sep 2026, 09:05 UTC`. The zone is printed, never implied. */
export function formatUtc(value: Date | string): string {
  return `${STAMP.format(new Date(value))} UTC`;
}

/** The day alone: `26 Sep 2026`. For a list, where the minute is noise. */
export function formatDayUtc(value: Date | string): string {
  return DAY.format(new Date(value));
}
