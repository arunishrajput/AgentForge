/**
 * Reading a Postgres error code through drizzle's wrapping — Phase 32.
 *
 * drizzle wraps a driver's error in a `DrizzleQueryError` whose `cause` is the original, and
 * the original carries the SQLSTATE in `code`. Walking the chain is what lets a caller react to
 * one specific refusal without matching on message text.
 *
 * Kept apart from the store modules so it can be tested: they import `@/lib/api`, which
 * imports `@/auth`, which the test runner cannot load.
 */

/** `unique_violation`. */
const UNIQUE_VIOLATION = "23505";

/**
 * Whether this error, or anything it was caused by, is a unique violation. Catching it rather
 * than reading first is what makes a "that name is taken" answer race-free: the unique index
 * decides, once, and the loser is told — there is no transaction to read inside (D6).
 */
export function isUniqueViolation(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== "object" || current === null) return false;
    if ((current as { code?: unknown }).code === UNIQUE_VIOLATION) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
