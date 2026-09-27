import { cookies } from "next/headers";

/**
 * Which workspace the user is currently in — Phase 19B.
 *
 * **The cookie is a preference, never a permission, and that is the whole design.** It
 * carries a workspace id and nothing else: no signature, no expiry check, no user id.
 * It does not need them, because `chooseMembership` in `./store.ts` only ever honours an
 * id that appears in the list of workspaces the database says this user is a member of.
 * A forged cookie, a stale one naming a workspace the user was removed from, or one
 * copied from somebody else's browser all fall back to the personal workspace. The
 * server asks the database who you are every request; the cookie only ever narrows an
 * answer it already has.
 *
 * That is why there is no `activeWorkspaceId` column on `user`. A column would be a
 * write on every switch, on a metered database, to store something a cookie holds for
 * free — and it would make the choice global across every browser and tab, which is
 * wrong: two tabs on two workspaces is a reasonable thing to want.
 *
 * **`next/headers` is imported here and nowhere else in `lib/workspace/`.** `./store.ts`
 * stays free of it so the test runner can load it (D18), which is why `chooseMembership`
 * takes the preferred id as an argument rather than reading it.
 */

/**
 * Not `__Secure-` prefixed, unlike the Auth.js session cookie.
 *
 * The prefix would be better, and it also makes the name differ between localhost and
 * production, which the session cookie pays for with a conditional in three places. For
 * a value that grants nothing on its own the trade is not worth it — and `secure` is set
 * from the scheme below regardless, which is the part that actually matters.
 */
export const ACTIVE_WORKSPACE_COOKIE = "af_workspace";

/** A year. It is a preference; expiring it would silently move somebody's workspace. */
const MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/**
 * The preferred workspace id from the request, or null.
 *
 * Readable from a server component, a route handler and a server function alike. It is
 * never trusted — see the note above — so there is nothing to validate here beyond
 * shape: an id that is not a member's is discarded downstream, and a hostile value is
 * only ever compared against real ids, never interpolated into anything.
 */
export async function readActiveWorkspaceId(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(ACTIVE_WORKSPACE_COOKIE)?.value;
  return value && value.length > 0 && value.length <= 64 ? value : null;
}

/**
 * Remember the active workspace. **Only callable from a route handler or a server
 * function** — HTTP does not allow a `Set-Cookie` once a response has started
 * streaming, so a server component cannot do this
 * (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`).
 *
 * `secure` comes from `APP_BASE_URL`'s scheme rather than from `NODE_ENV`: the
 * production container runs behind a TLS-terminating proxy and sees plain HTTP, so
 * anything derived from the request itself would be wrong in exactly the environment
 * that matters. Same argument as `appReturn` in the Google integration.
 */
export async function setActiveWorkspace(workspaceId: string): Promise<void> {
  const store = await cookies();
  store.set(ACTIVE_WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: (process.env.APP_BASE_URL ?? "").startsWith("https://"),
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

/**
 * Forget it — used when somebody leaves the workspace they were in, so the next request
 * resolves a workspace they are still a member of rather than falling back silently.
 *
 * The fallback would be correct either way. Clearing it means the cookie does not keep
 * naming a workspace the user can no longer reach, which is the difference between a
 * preference and a stale claim.
 */
export async function clearActiveWorkspace(): Promise<void> {
  const store = await cookies();
  store.delete(ACTIVE_WORKSPACE_COOKIE);
}
