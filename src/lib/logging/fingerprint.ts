import { createHash } from "node:crypto";

/**
 * **Error grouping — Phase 22.**
 *
 * Two failures are the same problem when they differ only in the values that were
 * flowing through at the time. `Node "http_1" (integration.http) failed: 503 from
 * https://api.example.com/v2/items/9931` and the same line with a different id are one
 * incident, and a failure list that shows them as two tells an operator to fix a thing
 * twice.
 *
 * So a message is normalised to a **template** — every varying token replaced by a
 * placeholder — and the template is hashed to a short, stable **group** id. The template
 * is what a person reads; the group id is what a count is keyed on and what a log line
 * carries so Cloud Logging can group the same way this page does.
 *
 * **The order of the rules is the whole design.** Each one removes a *more specific*
 * shape than the one after it, because a rule that runs early takes the token out of
 * reach of a greedier rule later: a URL contains digits and a UUID contains hex runs, so
 * replacing digits first would shred both into unrecognisable stubs and put two
 * unrelated failures in the same group. The tests pin that ordering with cases that only
 * pass in this sequence.
 *
 * **It over-groups rather than under-groups, deliberately.** Two distinct problems landing
 * in one group is a nuisance an operator notices immediately when they open it and read
 * two different samples; one problem scattered across forty groups is invisible, because
 * no single row is ever big enough to look at. The sample message is kept unredacted
 * alongside the template precisely so the first mistake is recoverable.
 */

/** Order matters — see the note above. Each entry is [pattern, placeholder]. */
const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  // A quoted run is almost always an identifier the engine interpolated — the node id in
  // `Node "http_1" (…) failed` is the case this product produces constantly. It runs
  // first because a quoted run can contain a URL, a number, or anything else below.
  [/"[^"]*"/g, '"<q>"'],
  [/'[^']*'/g, "'<q>'"],
  // Whole URLs before anything that would eat their digits or their host.
  [/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url>"],
  [/\b[\w.%+-]+@[\w.-]+\.[a-z]{2,}\b/gi, "<email>"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>"],
  // An ISO timestamp, before the plain-number rule turns it into `<n>-<n>-<n>T…`.
  [/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, "<time>"],
  /**
   * A long hex run: a token, a key id, a hash. 12 is above anything that occurs as an
   * ordinary word and below the shortest id this product mints.
   *
   * **The lookahead requiring at least one `a`–`f` is load-bearing.** Without it this rule
   * also matches a long *decimal* run, because every decimal digit is a valid hex digit —
   * so `Date.now()`, which is thirteen digits, normalised to `<hex>` instead of `<n>`.
   * Found by `verify-observability.mjs`, whose probe marker carries a timestamp. It did
   * not mis-group anything, but it labelled a number as an id, and the placeholder is
   * what a person reads to work out what varied.
   */
  [/\b(?=[0-9a-f]*[a-f])[0-9a-f]{12,}\b/gi, "<hex>"],
  // A duration keeps its unit, because "took too long" and "the remote said no" are
  // different problems and the unit is the only thing left that says which.
  [/\b\d+(?:\.\d+)?\s?(ms|s|m|h|kb|mb|gb|bytes?)\b/gi, "<n>$1"],
  [/\b\d+(?:\.\d+)?\b/g, "<n>"],
];

export interface ErrorGroup {
  /** Eight hex characters of SHA-256 over the template. Stable across processes. */
  id: string;
  /** The normalised message. What a failure list shows as the row's title. */
  template: string;
}

/** The longest template kept. Past this a message is a payload, not an error. */
const MAX_TEMPLATE = 200;

export function normaliseError(message: string): string {
  let text = String(message ?? "").trim();
  for (const [pattern, replacement] of RULES) text = text.replace(pattern, replacement);
  text = text.replace(/\s+/g, " ").trim();
  return text.length > MAX_TEMPLATE ? `${text.slice(0, MAX_TEMPLATE - 1)}…` : text;
}

/**
 * The group for one error message. An empty or absent message is its own group rather
 * than an exception — a run that failed with nothing written is a real thing that
 * happens, and it is worth seeing counted.
 */
export function errorGroup(message: string | null | undefined): ErrorGroup {
  const template = normaliseError(message ?? "") || "(no message)";
  const id = createHash("sha256").update(template).digest("hex").slice(0, 8);
  return { id, template };
}
