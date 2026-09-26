/**
 * A five-field cron evaluator — CONTRACT.md → "Trigger shapes".
 *
 * Written rather than installed, for the same reason as the rest of the stack: one
 * file of arithmetic against a dependency, its transitive tree and its own opinion
 * about timezones. Eight phases in, the dependency list is still the Phase 4 one.
 *
 * **Everything here is UTC.** A cron expression has no timezone of its own, and the
 * only two alternatives are worse: reading the server's zone makes a schedule mean
 * different things on a laptop and on Cloud Run, and carrying a per-workflow zone
 * means implementing DST arithmetic, where "02:30 daily" legitimately happens zero
 * times or twice a year. UTC is stated in the node's own description so the model
 * writing an expression and the user reading one are told, not left to assume.
 *
 * Supported per field: `*`, a number, a list `a,b`, a range `a-b`, and a step on
 * either (`*​/n`, `a-b/n`). Plus the five `@` aliases, because a model reaches for
 * `@daily` and rejecting it would cost a generation retry for nothing.
 *
 * Deliberately NOT supported: month and weekday names, `?`, `L`, `W`, `#`, seconds,
 * and a sixth year field. Each is rejected with a message naming what is wrong —
 * an unsupported expression has to fail at config-validation time, because the
 * alternative is a schedule that is saved, shown in the UI, and silently never fires.
 */

export class CronError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CronError";
  }
}

/** Each set holds every value the field admits, so matching is one lookup. */
export interface CronSchedule {
  expression: string;
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  /**
   * Standard cron's one genuine oddity: when day-of-month and day-of-week are BOTH
   * restricted they are OR-ed, not AND-ed — `0 0 1 * 1` is the 1st *or* any Monday.
   * When either is `*` the other simply applies. Recorded at parse time so the
   * matcher does not have to re-derive it on every candidate day.
   */
  domRestricted: boolean;
  dowRestricted: boolean;
}

const ALIASES: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

interface FieldSpec {
  name: string;
  min: number;
  max: number;
}

const FIELDS: FieldSpec[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  // 7 is accepted as Sunday and folded onto 0, which is what every cron does.
  { name: "day of week", min: 0, max: 7 },
];

function parseField(raw: string, spec: FieldSpec): Set<number> {
  const values = new Set<number>();

  for (const part of raw.split(",")) {
    if (part === "") {
      throw new CronError(`The ${spec.name} field has an empty item in "${raw}".`);
    }

    const [rangePart, stepPart, ...extra] = part.split("/");
    if (extra.length > 0) {
      throw new CronError(`The ${spec.name} field has more than one step in "${part}".`);
    }

    let step = 1;
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart)) {
        throw new CronError(`The ${spec.name} step in "${part}" must be a whole number.`);
      }
      step = Number(stepPart);
      if (step < 1) {
        throw new CronError(`The ${spec.name} step in "${part}" must be at least 1.`);
      }
    }

    let from: number;
    let to: number;

    if (rangePart === "*") {
      from = spec.min;
      to = spec.max;
    } else if (/^\d+$/.test(rangePart)) {
      from = Number(rangePart);
      // A bare number with a step means "from here to the end of the field", which
      // is how `0/15` and `*​/15` come to mean the same thing in the minute field.
      to = stepPart === undefined ? from : spec.max;
    } else {
      const match = /^(\d+)-(\d+)$/.exec(rangePart);
      if (!match) {
        throw new CronError(
          `The ${spec.name} field does not understand "${part}". Use a number, a list (1,2), ` +
            `a range (1-5), a step (*/5) or *. Names like "mon" and the ? L W # syntax are not supported.`,
        );
      }
      from = Number(match[1]);
      to = Number(match[2]);
      if (from > to) {
        throw new CronError(`The ${spec.name} range "${rangePart}" runs backwards.`);
      }
    }

    for (const bound of [from, to]) {
      if (bound < spec.min || bound > spec.max) {
        throw new CronError(
          `The ${spec.name} value ${bound} is outside ${spec.min}-${spec.max}.`,
        );
      }
    }

    for (let value = from; value <= to; value += step) values.add(value);
  }

  if (values.size === 0) {
    throw new CronError(`The ${spec.name} field "${raw}" matches nothing.`);
  }
  return values;
}

export function parseCron(expression: string): CronSchedule {
  const trimmed = expression.trim();
  if (trimmed === "") throw new CronError("A cron expression is required.");

  const normalised = ALIASES[trimmed.toLowerCase()] ?? trimmed;
  const parts = normalised.split(/\s+/);

  if (parts.length !== 5) {
    throw new CronError(
      `A cron expression needs exactly 5 fields (minute hour day-of-month month day-of-week); ` +
        `this has ${parts.length}. Seconds and a year field are not supported.`,
    );
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts.map((part, index) =>
    parseField(part, FIELDS[index]),
  );

  // 7 means Sunday. Folded here so the matcher only ever tests getUTCDay()'s 0-6.
  if (dayOfWeek.has(7)) {
    dayOfWeek.delete(7);
    dayOfWeek.add(0);
  }

  return {
    expression: trimmed,
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek,
    domRestricted: parts[2] !== "*",
    dowRestricted: parts[4] !== "*",
  };
}

export function cronError(expression: string): string | null {
  try {
    parseCron(expression);
    return null;
  } catch (error) {
    return error instanceof CronError ? error.message : "That cron expression is not valid.";
  }
}

function dayMatches(schedule: CronSchedule, date: Date): boolean {
  if (!schedule.month.has(date.getUTCMonth() + 1)) return false;

  const dom = schedule.dayOfMonth.has(date.getUTCDate());
  const dow = schedule.dayOfWeek.has(date.getUTCDay());

  if (schedule.domRestricted && schedule.dowRestricted) return dom || dow;
  if (schedule.domRestricted) return dom;
  if (schedule.dowRestricted) return dow;
  return true;
}

/**
 * How far ahead to look before declaring an expression unreachable. Four years
 * clears any leap-year case (29 February is the only one that can be more than a
 * year out); `0 0 30 2 *` is legal to write and matches nothing, and must return
 * null rather than spin.
 */
const SEARCH_DAYS = 366 * 4;

/**
 * The first time at or after `after` that the expression matches, or null if it
 * never does. Second- and millisecond-resolution is discarded: cron's unit is the
 * minute, and keeping a stray 30 s on a stored `scheduleNextAt` would make the
 * claim check in the tick compare unequal values.
 */
export function nextCronTime(
  schedule: CronSchedule,
  after: Date = new Date(),
): Date | null {
  const minutes = [...schedule.minute].sort((a, b) => a - b);
  const hours = [...schedule.hour].sort((a, b) => a - b);

  // Start from the next whole minute: a run fired for 09:00 must not immediately
  // match 09:00 again when the schedule is advanced.
  const start = new Date(after);
  start.setUTCSeconds(0, 0);
  start.setUTCMinutes(start.getUTCMinutes() + 1);

  const cursor = new Date(start);

  for (let day = 0; day <= SEARCH_DAYS; day += 1) {
    if (dayMatches(schedule, cursor)) {
      for (const hour of hours) {
        if (day === 0 && hour < start.getUTCHours()) continue;
        for (const minute of minutes) {
          if (day === 0 && hour === start.getUTCHours() && minute < start.getUTCMinutes()) {
            continue;
          }
          return new Date(
            Date.UTC(
              cursor.getUTCFullYear(),
              cursor.getUTCMonth(),
              cursor.getUTCDate(),
              hour,
              minute,
            ),
          );
        }
      }
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
    cursor.setUTCHours(0, 0, 0, 0);
  }

  return null;
}

/** Parse and advance in one step, for callers holding only the raw expression. */
export function nextTimeFor(expression: string, after: Date = new Date()): Date | null {
  return nextCronTime(parseCron(expression), after);
}

/**
 * A fixed-locale UTC rendering, for the canvas. A client component must never call
 * `toLocaleString()` with the browser's defaults — server and browser disagree on
 * locale and zone and React reports a hydration error (PROGRESS.md, Phase 6).
 */
export function formatUtc(date: Date | string): string {
  return `${new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(date))} UTC`;
}
