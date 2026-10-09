/**
 * **An in-memory rate limiter — Phase 40**, written to be reused (Phase 41's tokens).
 *
 * A fixed window per key: the first call opens a window, the next `limit - 1` inside it are
 * allowed, the one after is refused until the window closes.
 *
 * **It is per instance, and that is a stated limit, not an oversight.** The service runs at
 * `max-instances 3` with no shared store (a Redis would be a paid, always-on resource — the zero-cost
 * ceiling), so a caller spread across three instances can get up to three times `limit`. What it is
 * for is the cheap, common case — one script, one spammer, one stuck retry loop — not a determined
 * attacker with a botnet, and `SECURITY.md` says so rather than imply more. A new instance also starts
 * empty, so a scale-up resets the count.
 *
 * Bounded in memory: at most `maxKeys` windows are held, and a full table drops expired windows first
 * and the oldest after — so a scan that never repeats a key cannot grow the process without limit.
 * Refused calls do **not** extend a window: a client that keeps hammering is let back in when the
 * window it started closes, not pushed further out.
 */
export interface RateLimit {
  allowed: boolean;
  /** Whole seconds until the window closes; 0 when allowed. */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  take: (key: string, now?: number) => RateLimit;
  /** How many windows are held — for the bound's test. */
  size: () => number;
}

export function createRateLimiter(options: { limit: number; windowMs: number; maxKeys?: number }): RateLimiter {
  const { limit, windowMs, maxKeys = 10_000 } = options;
  const windows = new Map<string, { start: number; count: number }>();

  const make = (now: number) => {
    for (const [key, window] of windows) if (now - window.start >= windowMs) windows.delete(key);
    // A Map iterates in insertion order, so the first key is the oldest window opened.
    while (windows.size >= maxKeys) {
      const oldest = windows.keys().next();
      if (oldest.done) break;
      windows.delete(oldest.value);
    }
  };

  return {
    take(key, now = Date.now()) {
      let window = windows.get(key);
      if (!window || now - window.start >= windowMs) {
        if (!window && windows.size >= maxKeys) make(now);
        window = { start: now, count: 0 };
        windows.delete(key);
        windows.set(key, window);
      }
      if (window.count >= limit) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((window.start + windowMs - now) / 1000)) };
      }
      window.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    },
    size: () => windows.size,
  };
}

/**
 * The address a request came from, for a rate limit's key. Cloud Run's front end **appends** the
 * client's address to `X-Forwarded-For`, so the last entry is the one Google saw and anything before
 * it is whatever the client claimed — taken from the right, a caller cannot choose which bucket they
 * fall in. `unknown` when the header is absent (a local run), which is one shared bucket.
 */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded) return "unknown";
  const entries = forwarded.split(",").map((entry) => entry.trim()).filter(Boolean);
  return (entries.at(-1) ?? "unknown").slice(0, 64);
}
