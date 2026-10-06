import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The cron tick's shared-secret comparison.
 *
 * Its own module, rather than sitting beside the tick logic, for the reason behind
 * D18: `tick.ts` reaches the engine, which reaches `next-auth`, which the test runner
 * cannot load. A guard on an endpoint reachable by anyone is precisely the thing that
 * must be asserted in a millisecond with no database and no network.
 *
 * Constant-time, because a plain `===` on a secret leaks its length and its matching
 * prefix through timing.
 */
export function cronSecretMatches(presented: string | null, expected: string): boolean {
  if (!presented) return false;

  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");

  // timingSafeEqual throws on a length mismatch, which would itself be the leak, so
  // the lengths are compared first and a same-length comparison is still performed.
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * **A schedule timer's own token — Phase 26, the "per-task token" D82 asks for.**
 *
 * `POST /api/cron/fire` sits behind `CRON_SECRET` like every machine endpoint here, and
 * that is the outer gate. This is the narrow one: an HMAC over the workflow id and the
 * exact slot the timer was armed for. A token therefore authorises firing **one slot of
 * one workflow** and nothing else — a token lifted from one task cannot fire another
 * workflow, or this workflow at another time — and the compare-and-set on the slot makes
 * even a replay of the right one a no-op once it has fired (D42).
 *
 * Derived rather than stored, so arming a timer costs no write beyond the one that
 * records it is armed, and there is no column of live tokens to leak. Keyed with
 * `AUTH_SECRET` rather than `CRON_SECRET`, so somebody holding only the outer secret
 * cannot mint one — the two gates are independent, which is the point of having two.
 * The label separates this use of the key from Auth.js's. **Rotating `AUTH_SECRET`
 * therefore disarms every armed timer**: their deliveries are declined as forged, and the
 * daily sweep re-arms each schedule under the new key within a day (`SECURITY.md`).
 */
const FIRE_TOKEN_LABEL = "agentforge.schedule-fire.v1";

/** A base64url SHA-256 HMAC: always 43 characters. Checked before any query. */
export const FIRE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function fireToken(workflowId: string, scheduledFor: string, key: string): string {
  return createHmac("sha256", key)
    .update(`${FIRE_TOKEN_LABEL}\n${workflowId}\n${scheduledFor}`)
    .digest("base64url");
}

export function fireTokenMatches(
  presented: string,
  workflowId: string,
  scheduledFor: string,
  key: string,
): boolean {
  if (!FIRE_TOKEN_PATTERN.test(presented)) return false;
  // Same length by construction once the pattern holds, so `timingSafeEqual` cannot throw.
  return timingSafeEqual(
    Buffer.from(presented, "utf8"),
    Buffer.from(fireToken(workflowId, scheduledFor, key), "utf8"),
  );
}
