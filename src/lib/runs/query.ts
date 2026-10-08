import { ApiError } from "@/lib/api-error";
import { RUN_STATUSES, TRIGGER_KINDS, type RunStatus, type TriggerKind } from "@/lib/engine/types";

/**
 * **What `/runs` is showing, as a value — Phase 33, D150.**
 *
 * The run history is paginated **on the server**, unlike the workflow list (D69): a workspace's
 * workflows are a short list the browser can hold whole, and its runs grow without bound. So the
 * page's URL *is* its query — the filters and a keyset cursor — and this module is the one place
 * that turns a URL into a query and a query back into a URL.
 *
 * Pure and free of the database and the registry, because the filter form is a client component
 * and builds its links from here.
 *
 * Parsed forgivingly, as D149 parses the list's view: a value that does not belong falls back to
 * "any", so an old or mangled link still opens the history rather than an error page. The API is
 * stricter about the one thing that could silently mislead — a cursor it cannot read is refused,
 * not ignored, because ignoring it would answer the first page to a client asking for the tenth.
 */

/** Runs per page. Small enough that a page of step-free summaries is a few kilobytes. */
export const RUN_PAGE_SIZE = 25;
/** The most a caller of the API may ask for in one page. */
export const MAX_RUN_PAGE_SIZE = 100;

/**
 * A position in the history: a run's start time **to the microsecond**, and its id.
 *
 * Microseconds, not milliseconds, and that is not pedantry. Postgres stores `timestamptz` to the
 * microsecond and a JavaScript `Date` holds milliseconds, so a cursor made from a `Date` would
 * truncate — and the next page's `(startedAt, id) < cursor` would then **skip** every run started
 * within the same millisecond as the last one shown but later in it. The database formats the
 * cursor itself (`history-sql.ts`), so the value here is never a `Date` at all.
 */
export interface RunKey {
  at: string;
  id: string;
}

export interface RunQuery {
  status: RunStatus | null;
  trigger: TriggerKind | null;
  workflowId: string | null;
  /** The first UTC day shown, `YYYY-MM-DD`, inclusive. */
  from: string | null;
  /** The last UTC day shown, `YYYY-MM-DD`, inclusive. */
  to: string | null;
  /** Older than this — the next page. */
  before: RunKey | null;
  /** Newer than this — the previous page. */
  after: RunKey | null;
}

export const EMPTY_RUN_QUERY: RunQuery = {
  status: null,
  trigger: null,
  workflowId: null,
  from: null,
  to: null,
  before: null,
  after: null,
};

const KEY = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)_([A-Za-z0-9-]{1,64})$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9-]{1,64}$/;

export function encodeRunKey(key: RunKey): string {
  return `${key.at}_${key.id}`;
}

/** A cursor as written in a URL, or null when it is not one. */
export function decodeRunKey(value: string | null | undefined): RunKey | null {
  if (!value) return null;
  const match = KEY.exec(value);
  if (!match || Number.isNaN(Date.parse(match[1]))) return null;
  return { at: match[1], id: match[2] };
}

/** A real calendar day, `YYYY-MM-DD` — `2026-02-30` is not one. */
export function isDay(value: string | null | undefined): value is string {
  if (!value || !DAY.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** The instant a `from` day begins and the instant after a `to` day ends — `[from, to)`. */
export function dayBounds(query: Pick<RunQuery, "from" | "to">): { from: Date | null; to: Date | null } {
  return {
    from: query.from ? new Date(`${query.from}T00:00:00Z`) : null,
    to: query.to ? new Date(Date.parse(`${query.to}T00:00:00Z`) + 86_400_000) : null,
  };
}

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function read(params: Params, name: string): string | null {
  if (params instanceof URLSearchParams) return params.get(name);
  const value = params[name];
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

/** The query a URL describes. Anything unrecognised reads as "any". */
export function parseRunQuery(params: Params): RunQuery {
  const status = read(params, "status");
  const trigger = read(params, "trigger");
  const workflow = read(params, "workflow");
  const from = read(params, "from");
  const to = read(params, "to");
  const before = decodeRunKey(read(params, "before"));
  return {
    status: (RUN_STATUSES as readonly string[]).includes(status ?? "") ? (status as RunStatus) : null,
    trigger: (TRIGGER_KINDS as readonly string[]).includes(trigger ?? "") ? (trigger as TriggerKind) : null,
    workflowId: workflow && ID.test(workflow) ? workflow : null,
    from: isDay(from) ? from : null,
    to: isDay(to) ? to : null,
    before,
    // One direction at a time: a URL carrying both is read as the older page.
    after: before ? null : decodeRunKey(read(params, "after")),
  };
}

/**
 * The URL for a query, defaults omitted, so the plain history is `/runs` and a link never carries
 * noise. `page` replaces the cursor; leaving it out starts from the newest run.
 */
export function runQuerySearch(
  query: RunQuery,
  page: { before?: RunKey | null; after?: RunKey | null } = {},
): string {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.trigger) params.set("trigger", query.trigger);
  if (query.workflowId) params.set("workflow", query.workflowId);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (page.before) params.set("before", encodeRunKey(page.before));
  else if (page.after) params.set("after", encodeRunKey(page.after));
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** Whether any filter is set — the page says "no runs match" rather than "no runs yet". */
export function isFiltered(query: RunQuery): boolean {
  return Boolean(query.status || query.trigger || query.workflowId || query.from || query.to);
}

/**
 * Which way a page reads: rows newest first, and a cursor for each neighbour that exists.
 *
 * `rows` is what the database answered for `limit + 1`, in the order it was asked for — newest
 * first for the first page or an older one, **oldest first** for a newer one (`after`), which is
 * the only way a keyset can step backwards. Turned back to newest first here, so every caller
 * renders one order.
 */
export function shapePage<T extends { key: RunKey }>(
  rows: readonly T[],
  query: Pick<RunQuery, "before" | "after">,
  limit: number,
): { rows: T[]; next: RunKey | null; prev: RunKey | null } {
  const more = rows.length > limit;
  const page = rows.slice(0, limit);

  if (query.after) {
    page.reverse();
    return {
      rows: page,
      // Stepping back from an older page: there is always something older — the page it came from.
      next: page.at(-1)?.key ?? null,
      prev: more ? (page[0]?.key ?? null) : null,
    };
  }

  return {
    rows: page,
    next: more ? (page.at(-1)?.key ?? null) : null,
    // A page reached by `before` has newer runs behind it; the first page has none.
    prev: query.before ? (page[0]?.key ?? null) : null,
  };
}

/**
 * **A run list request, read strictly — the API's half of `parseRunQuery`.** The page reads its
 * URL forgivingly, because a person pasted it; a program that sends `status=faild` or a cursor
 * from another format must be told, not answered with an unfiltered first page it would take
 * for the filtered one. Every parameter that is present must parse. `workflowId` is accepted as
 * the route always has, and `workflow` as the page writes it.
 */
export function readRunRequest(url: URL, fixed: { workflowId?: string } = {}): { query: RunQuery; limit: number } {
  const params = url.searchParams;
  const workflow = params.get("workflowId") ?? params.get("workflow");
  const named = new URLSearchParams(params);
  named.delete("workflowId");
  if (workflow !== null) named.set("workflow", workflow);
  const query = parseRunQuery(named);

  const problems: { path: string; message: string }[] = [];
  const unread = (name: string, value: unknown) => {
    if (named.get(name) !== null && value === null) problems.push({ path: name, message: `"${named.get(name)}" is not a valid ${name}.` });
  };
  unread("status", query.status);
  unread("trigger", query.trigger);
  unread("workflow", query.workflowId);
  unread("from", query.from);
  unread("to", query.to);
  unread("before", query.before);
  if (named.get("after") !== null && named.get("before") === null) unread("after", query.after);

  const limitText = params.get("limit");
  const limit = limitText === null ? RUN_PAGE_SIZE : Number(limitText);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RUN_PAGE_SIZE) {
    problems.push({ path: "limit", message: `limit is a whole number from 1 to ${MAX_RUN_PAGE_SIZE}.` });
  }

  if (problems.length > 0) {
    throw new ApiError("invalid_request", "The run list request did not parse.", problems);
  }
  return { query: fixed.workflowId ? { ...query, workflowId: fixed.workflowId } : query, limit };
}

/** A page as the API answers it: summaries, and the cursors as the URL would carry them. */
export function pageCursors(page: { next: RunKey | null; prev: RunKey | null }): {
  next: string | null;
  prev: string | null;
} {
  return {
    next: page.next ? encodeRunKey(page.next) : null,
    prev: page.prev ? encodeRunKey(page.prev) : null,
  };
}
