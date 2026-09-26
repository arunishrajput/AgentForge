import { timingSafeEqual } from "node:crypto";

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
