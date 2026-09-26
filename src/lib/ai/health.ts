/**
 * Model health and the circuit breaker — Phase 13.
 *
 * ## Why this exists
 *
 * Phase 12 measured two demo runs at ~95 s, of which **one step was 91.9 s**: an
 * `ai.agent` node whose model, `gemini-3.5-flash-lite`, accepted the request and then
 * never answered. The adapter behaved exactly as written — two attempts per model, each
 * bounded by a 45 s request timeout — so one wedged model cost 90 s before the fallback
 * was even tried. `ai.llm` answered on that same model in 1.4 s in the same run.
 *
 * Phase 13's probe (`scripts/probe-models.mjs`) reproduced it. Across three passes:
 *
 * | model                   | text                | tool-call            |
 * |-------------------------|---------------------|----------------------|
 * | `gemini-3-flash-preview`| 1.6 / 1.8 / 1.9 s   | 1.1 / 1.4 / 1.1 s    |
 * | `gemini-3.6-flash`      | 2.3 / 6.2 s / 503   | 1.7 / 1.9 / 2.0 s    |
 * | `gemini-3.5-flash-lite` | 4.2 s / **timeout** | 0.9 s / **timeout**  |
 * | `gemini-3.1-flash-lite` | 10.2 / 5.1 / 9.3 s  | **timeout** / 7.1 s  |
 *
 * Two facts fall out, and both shape this file:
 *
 * 1. **A model's health flips on a timescale of minutes**, not days. So health is
 *    observed continuously from real traffic, never configured.
 * 2. **The text path and the tool-calling path fail independently.** A model can answer
 *    prose and hang on function calls, which is precisely the Phase 12 incident.
 *
 * ## What it does
 *
 * A breaker per model. Two consecutive *retryable* failures open it; while open, that
 * model is moved to the **back** of the fallback chain instead of the front.
 *
 * **It never removes a model from the chain.** The breaker only ever reorders, so the
 * worst case of a wrong health reading is a suboptimal order — never a refusal to call
 * a model that would have worked. That matters because health is keyed on the model
 * name alone: two users on different quota tiers share these records, and a reordering
 * is a safe thing to get wrong where a refusal would not be.
 *
 * ## What counts as a failure
 *
 * Only what is actually a fact about the *model*:
 *
 *   • timeouts and transport errors, 429, 5xx → count, and open the breaker
 *   • 404 → opens it immediately, at the long cooldown: "no longer available to new
 *     users" is permanent, and three names in the Chapter 1 chain have gone that way
 *   • 400 / 401 / 403 → **ignored.** A malformed request or a rejected key is a fact
 *     about the caller, and marking every model unhealthy because one key is bad would
 *     be exactly wrong
 *
 * State is per process, deliberately. It costs no storage, no query budget against
 * Neon's 100 CU-hours/month, and a Cloud Run instance lives long enough to be useful.
 * A cold instance simply starts optimistic and learns within one request.
 */

/** Consecutive retryable failures before a model is taken out of the front of the chain. */
export const OPEN_AFTER_FAILURES = 2;

/** First cooldown. Doubles per consecutive opening, up to {@link MAX_COOLDOWN_MS}. */
export const BASE_COOLDOWN_MS = 30_000;
export const MAX_COOLDOWN_MS = 300_000;

/** A 404 is not a blip. Skip the ladder and sit it out for the maximum. */
export const GONE_COOLDOWN_MS = MAX_COOLDOWN_MS;

export type ModelState = "healthy" | "degraded" | "unavailable" | "unknown";

export interface ModelHealth {
  model: string;
  state: ModelState;
  /** Consecutive failures since the last success. Reset to 0 by any success. */
  failures: number;
  /** Epoch ms the breaker closes again, or null when it is not open. */
  openUntil: number | null;
  /** How many times this model's breaker has opened without an intervening success. */
  openings: number;
  lastStatus: number | null;
  lastError: string | null;
  lastLatencyMs: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  successes: number;
  totalFailures: number;
}

const records = new Map<string, ModelHealth>();

function blank(model: string): ModelHealth {
  return {
    model,
    state: "unknown",
    failures: 0,
    openUntil: null,
    openings: 0,
    lastStatus: null,
    lastError: null,
    lastLatencyMs: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    successes: 0,
    totalFailures: 0,
  };
}

function record(model: string): ModelHealth {
  const existing = records.get(model);
  if (existing) return existing;
  const fresh = blank(model);
  records.set(model, fresh);
  return fresh;
}

/**
 * Whether a failure with this status says anything about the model.
 *
 * Exported because the adapter has to make the same judgement when deciding whether a
 * failure is worth another attempt, and the two must not drift apart.
 */
export function countsAgainstModel(status: number): boolean {
  if (status === 404) return true;
  if (status === 429 || status === 408) return true;
  if (status >= 500) return true;
  // status 0 is a timeout or a transport failure — the wedged case this file exists for.
  if (status === 0) return true;
  return false;
}

export function recordSuccess(model: string, latencyMs: number, now = Date.now()): void {
  const entry = record(model);
  entry.state = "healthy";
  entry.failures = 0;
  entry.openUntil = null;
  entry.openings = 0;
  entry.lastStatus = 200;
  entry.lastError = null;
  entry.lastLatencyMs = latencyMs;
  entry.lastSuccessAt = now;
  entry.successes += 1;
}

export function recordFailure(
  model: string,
  failure: { status: number; error: string; latencyMs: number },
  now = Date.now(),
): void {
  if (!countsAgainstModel(failure.status)) return;

  const entry = record(model);
  entry.failures += 1;
  entry.totalFailures += 1;
  entry.lastStatus = failure.status;
  entry.lastError = failure.error;
  entry.lastLatencyMs = failure.latencyMs;
  entry.lastFailureAt = now;

  const gone = failure.status === 404;
  if (gone || entry.failures >= OPEN_AFTER_FAILURES) {
    entry.openings += 1;
    const cooldown = gone
      ? GONE_COOLDOWN_MS
      : Math.min(BASE_COOLDOWN_MS * 2 ** (entry.openings - 1), MAX_COOLDOWN_MS);
    entry.openUntil = now + cooldown;
    entry.state = "unavailable";
    return;
  }

  entry.state = "degraded";
}

/** True while this model's breaker is open. */
export function isOpen(model: string, now = Date.now()): boolean {
  const entry = records.get(model);
  if (!entry || entry.openUntil === null) return false;
  if (entry.openUntil > now) return true;

  // The cooldown elapsed. Half-open: let the next call through, but keep the failure
  // count so a single further failure re-opens it immediately rather than spending
  // another OPEN_AFTER_FAILURES attempts rediscovering the same thing.
  entry.openUntil = null;
  entry.state = "degraded";
  entry.failures = OPEN_AFTER_FAILURES - 1;
  return false;
}

/**
 * The order to try models in: closed breakers first in the caller's own order, then the
 * open ones, soonest-to-recover first.
 *
 * The caller's order is preserved among healthy models because it encodes the user's
 * explicit choice and the measured latency ranking, neither of which this file knows
 * better than the caller does.
 */
export function orderChain(models: string[], now = Date.now()): string[] {
  const open: string[] = [];
  const ready: string[] = [];

  for (const model of models) {
    if (isOpen(model, now)) open.push(model);
    else ready.push(model);
  }

  open.sort((a, b) => (records.get(a)?.openUntil ?? 0) - (records.get(b)?.openUntil ?? 0));

  // Everything is open: honour the caller's order rather than inventing one. Some model
  // has to be tried, and the caller's first choice is as good a guess as any.
  return ready.length === 0 ? models.slice() : [...ready, ...open];
}

/**
 * Health as of now, for surfacing. Ordered healthiest first so the top of the list is
 * the answer to "what should I be using?".
 */
export function modelHealthSnapshot(now = Date.now()): ModelHealth[] {
  const rank: Record<ModelState, number> = {
    healthy: 0,
    unknown: 1,
    degraded: 2,
    unavailable: 3,
  };

  return [...records.values()]
    .map((entry) => ({
      ...entry,
      // A stale `openUntil` would read as unavailable long after it recovered.
      state:
        entry.openUntil !== null && entry.openUntil <= now
          ? ("degraded" as ModelState)
          : entry.state,
      openUntil: entry.openUntil !== null && entry.openUntil > now ? entry.openUntil : null,
    }))
    .sort((a, b) => rank[a.state] - rank[b.state] || a.model.localeCompare(b.model));
}

/** Test seam. Nothing in the application should call this. */
export function resetModelHealth(): void {
  records.clear();
}
