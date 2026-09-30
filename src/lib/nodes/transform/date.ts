import { z } from "zod";

import { defineNode, NodeError } from "../types";

/** Ten years either way. A shift beyond that is a units mistake, not an intention. */
const MAX_SHIFT_MINUTES = 5_256_000;

/**
 * A point in time, in every representation something downstream might want.
 *
 * It emits all of them at once rather than taking a format string. A format string is
 * a small language, and every one of them disagrees about whether `D` is the day of the
 * month or the day of the year — asking a user, or a model, to get that right to put a
 * date in an email subject is a bad trade for what it buys.
 *
 * **Time zone is explicit and defaults to UTC.** A scheduled workflow runs on Cloud Run,
 * whose clock is UTC, so a "daily digest" node that used the server's local time would
 * silently be a different hour from the one the author tested — and the author would
 * never see it, because their browser is not where the run happens.
 */
export const dateNode = defineNode({
  type: "transform.date",
  label: "Date and time",
  description:
    "Produces a point in time in several formats at once — ISO, date only, time only, Unix seconds, and the parts. Defaults to now. Set value to read an existing date, and shiftMinutes to move it forward or back.",
  kind: "action",
  category: "transform",
  outputs: [{ key: null, label: "Out" }],
  outputShape:
    "{ iso, date: 'YYYY-MM-DD', time: 'HH:MM:SS', unix: seconds, year, month, day, hour, minute, weekday: 'Monday', monthName: 'January', timeZone }. Pick the one you need, e.g. output.date.",
  docs: {
    summary:
      "Gives you the current time, or reformats one you already have, in every shape a downstream node is likely to want. Time zone is explicit and defaults to UTC, because the server this runs on is not in your time zone.",
    accepts: "The previous node's output as a date string, when `value` is not configured.",
    examples: [
      { title: "Today's date for a report title", body: "→ {{steps.date.output.date}}" },
      { title: "Yesterday, in Singapore", body: "shiftMinutes: -1440 · timeZone: Asia/Singapore" },
      { title: "A timestamp for a spreadsheet row", body: "→ {{steps.date.output.iso}}" },
    ],
  },
  agentCallable: true,
  configSchema: z.object({
    /** An ISO date, a date string, or Unix seconds. Defaults to now. */
    value: z.union([z.string(), z.number()]).optional(),
    /** Move the result forward (positive) or back (negative). */
    shiftMinutes: z.number().int().min(-MAX_SHIFT_MINUTES).max(MAX_SHIFT_MINUTES).default(0),
    /** An IANA zone such as `Europe/London`. */
    timeZone: z.string().trim().default("UTC"),
  }),
  async execute({ config, input, context }) {
    const source = config.value ?? pickInput(input);
    const base = source === undefined ? new Date() : parse(source);
    const at = new Date(base.getTime() + config.shiftMinutes * 60_000);

    const parts = formatParts(at, config.timeZone);

    context.log(`${parts.iso} (${config.timeZone}).`);

    return { output: parts };
  },
});

/** Only a string or a number could be a date; an object from a previous node is not one. */
function pickInput(input: unknown): string | number | undefined {
  return typeof input === "string" || typeof input === "number" ? input : undefined;
}

function parse(value: string | number): Date {
  // A bare number is Unix seconds, which is what every API that sends one means. It is
  // multiplied rather than passed to `new Date(n)`, which would read it as milliseconds
  // and land in 1970.
  const at = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(at.getTime())) {
    throw new NodeError(
      `"${String(value).slice(0, 80)}" is not a date this node can read. Use an ISO timestamp such as 2026-09-30T12:00:00Z, or Unix seconds.`,
    );
  }
  return at;
}

interface DateParts {
  iso: string;
  date: string;
  time: string;
  unix: number;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
  monthName: string;
  timeZone: string;
}

/**
 * The wall-clock parts in the requested zone.
 *
 * `formatToParts` with an explicit zone rather than the `getFullYear()` family, which
 * would read the *server's* zone — the bug this node exists partly to prevent.
 */
function formatParts(at: Date, timeZone: string): DateParts {
  let parts: Intl.DateTimeFormatPart[];
  let weekday: string;
  let monthName: string;
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
    weekday = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long" }).format(at);
    monthName = new Intl.DateTimeFormat("en-GB", { timeZone, month: "long" }).format(at);
  } catch {
    // `Intl` throws `RangeError` on an unknown zone. The user's mistake is a typo in a
    // config field, so it gets a message naming the field rather than a stack.
    throw new NodeError(
      `"${timeZone}" is not a time zone this node recognises. Use an IANA name such as UTC, Europe/London or Asia/Singapore.`,
    );
  }

  const find = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";

  const year = find("year");
  const month = find("month");
  const day = find("day");
  const hour = find("hour");
  const minute = find("minute");
  const second = find("second");

  return {
    // The instant, unambiguously. Always UTC regardless of the display zone, because an
    // ISO string that silently meant a local time would be the exact ambiguity this node
    // is trying to remove.
    iso: at.toISOString(),
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}:${second}`,
    unix: Math.floor(at.getTime() / 1000),
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    weekday,
    monthName,
    timeZone,
  };
}
