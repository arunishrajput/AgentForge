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
  /**
   * **Signed in, a member of this workspace, and not allowed to do this** — Phase 19B.
   *
   * It is a genuinely different answer from `not_found`, and the difference is the
   * contract. D20 answers 404 for a resource in another workspace, because 403 there
   * would confirm the id exists. This code is for the other case: the resource is in
   * your own workspace and you can already see it, so the honest answer is that your
   * role does not carry the action.
   */
  | "forbidden"
  | "not_found"
  | "invalid_request"
  | "invalid_graph"
  | "conflict"
  | "internal";

export const STATUS: Record<ApiErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid_request: 400,
  invalid_graph: 422,
  conflict: 409,
  internal: 500,
};

/**
 * **A way forward out of an error — Phase 25.**
 *
 * `BUILD_PLAN.md` → *Phase 25* asks that "every failure the user can hit has a clear
 * message and a way forward". The message was already the rule in this project; this is
 * the way forward, and it exists because some failures cannot be fixed where they are
 * raised. A new user pressing *Generate workflow* with no provider key stored gets a
 * perfectly clear 400 that names Settings — and then has to go and find Settings, which
 * is a dead end dressed as an explanation.
 *
 * It rides inside `details`, so it **extends the API surface and not the envelope**, which
 * is the rule in `CONTRACT.md` → *API request/response shapes*. A client that does not know
 * about it ignores one extra key, exactly as it always did.
 *
 * Two rules keep it honest:
 *
 *   • **`href` is always an in-app path**, never an external URL. A recovery link is
 *     rendered as a button by whatever caught the error, and a button in a product's own
 *     error state that leaves for somebody else's website is not a recovery.
 *   • **It is only attached where the fix is genuinely somewhere else.** A validation
 *     message about the field the user is looking at does not need a link to the field
 *     they are looking at, and attaching one everywhere would make the ones that matter
 *     invisible.
 */
export interface Recovery {
  /** An in-app path. Must start with `/`. */
  href: string;
  /** The button's words. Imperative, and it names where it goes. */
  label: string;
}

/** Narrows the `details` of a caught error to a recovery hint, if it carries one. */
export function recoveryOf(details: unknown): Recovery | null {
  if (typeof details !== "object" || details === null) return null;
  const recovery = (details as { recovery?: unknown }).recovery;
  if (typeof recovery !== "object" || recovery === null) return null;
  const { href, label } = recovery as { href?: unknown; label?: unknown };
  // An `href` that is not an in-app path is dropped rather than trusted: this value is
  // read from a response body and turned into something the user can click.
  //
  // **`//host` is rejected as well as `https://host`**, and that second check is not
  // redundant: a protocol-relative URL starts with `/` and is a *different origin* to a
  // browser, so a lone `startsWith("/")` would have let `//evil.example` through. The test
  // for it in `api-error.test.ts` failed before this line said `//`.
  if (typeof href !== "string" || !href.startsWith("/") || href.startsWith("//")) return null;
  if (typeof label !== "string" || label.length === 0) return null;
  return { href, label };
}

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
