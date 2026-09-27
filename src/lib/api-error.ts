/**
 * The API error type and its HTTP mapping — split out of `lib/api.ts` in Phase 19A.
 *
 * **It is its own module because an error class has no business depending on the auth
 * stack.** `lib/api.ts` imports `@/auth`, which imports `next-auth`, which the test
 * runner cannot load (D18) — so every function that merely *returns* an `ApiError` was
 * untestable by association, including the error mapping that reported a database
 * failure as "Could not reach Discord." The rule in `CLAUDE.md` is that every bug fixed
 * gets a test that fails without the fix; this is what made that possible for that one.
 *
 * `lib/api.ts` re-exports everything here, so nothing that already imported these from
 * there had to change.
 */

export type ApiErrorCode =
  | "unauthenticated"
  | "not_found"
  | "invalid_request"
  | "invalid_graph"
  | "conflict"
  | "internal";

export const STATUS: Record<ApiErrorCode, number> = {
  unauthenticated: 401,
  not_found: 404,
  invalid_request: 400,
  invalid_graph: 422,
  conflict: 409,
  internal: 500,
};

/**
 * Thrown to unwind out of a handler with a specific API error.
 *
 * Fields are declared and assigned rather than written as constructor parameter
 * properties: Node runs the TypeScript sources directly for `npm test`, and its
 * strip-only mode rejects that syntax.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly details?: unknown;

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }
}
