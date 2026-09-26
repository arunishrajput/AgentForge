/**
 * Durations, for reading a run.
 *
 * `format/date.ts` refuses to write a *relative* formatter — no "3 minutes ago" —
 * because a relative label depends on the clock at render time, so the server's
 * initial HTML and the browser's hydration disagree by the network latency between
 * them, which is hydration error #418 wearing a friendly face.
 *
 * A duration is not that. It is the difference between two timestamps the database
 * already holds, so it renders identically wherever and whenever it is computed, and
 * it needs no `Intl` and no timezone. That distinction is the reason this is a
 * sibling module rather than a rule broken.
 */

/**
 * How long a step took, from the two timestamps on its record.
 *
 * `null` when it has not finished — which is a different fact from zero, and the
 * caller says "streaming" rather than "0 ms" for it. Clamped at zero because the
 * engine's two timestamps come from the same process but a clock is still a clock,
 * and a step reported as lasting -3 ms reads as a bug in the product.
 */
export function elapsedMs(
  from: string | null | undefined,
  to: string | null | undefined,
): number | null {
  if (!from || !to) return null;
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, end - start);
}

/**
 * A duration at the precision a person reading a run actually wants: milliseconds
 * while it is a machine's latency, seconds once it is a wait, minutes once it is a
 * coffee. One significant decimal in the middle band, because the difference between
 * a 4.2 s and a 7.5 s agent call is the interesting one.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;

  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  // 59.6 s into the minute rounds to 60, which must carry rather than print "1m 60s".
  return seconds === 60 ? `${minutes + 1}m 00s` : `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/**
 * A log line's offset from the start of its step: `+1.2s`.
 *
 * This is what makes a column of agent reasoning readable as a sequence rather than
 * a wall — it says which decisions were instant and which one took four seconds.
 * An empty string when either end is missing, so the caller can render nothing
 * without a conditional at the call site.
 */
export function formatOffset(
  from: string | null | undefined,
  at: string | null | undefined,
): string {
  const ms = elapsedMs(from, at);
  if (ms === null) return "";
  return ms < 1000 ? `+${ms}ms` : `+${(ms / 1000).toFixed(1)}s`;
}
