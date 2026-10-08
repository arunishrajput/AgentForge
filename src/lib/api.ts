import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/auth";
import { ApiError, STATUS, recoveryOf, type ApiErrorCode, type Recovery } from "@/lib/api-error";
import { addLogContext, logError, traceFromHeaders, withLogContext } from "@/lib/logging";
import { readActiveWorkspaceId } from "@/lib/workspace/active";
import { assertRole, type WorkspaceRole } from "@/lib/workspace/roles";
import { listMemberships, resolveScope } from "@/lib/workspace/store";
import type { WorkspaceScope } from "@/lib/workspace/scope";

/**
 * Shared shapes for every API route — CONTRACT.md → "API request/response shapes".
 *
 * Success is `{ data: ... }`, failure is `{ error: { code, message, details? } }`.
 * One envelope means a client can tell the two apart without inspecting the status
 * code, and one place to make sure an internal error never reaches a client.
 */
export { ApiError, recoveryOf, type ApiErrorCode, type Recovery };

export function ok<T>(data: T, status = 200): Response {
  return Response.json({ data }, { status });
}

/**
 * **A page of a list that is paginated on the server — Phase 33, D150.** `data` stays the array
 * it always was, so a client that reads `data` as a list is unchanged; the cursors ride beside it
 * in `page`, the one place the envelope grew. Null where there is no neighbouring page.
 */
export function okPage<T>(data: T[], page: { next: string | null; prev: string | null }): Response {
  return Response.json({ data, page });
}

export function fail(
  code: ApiErrorCode,
  message: string,
  details?: unknown,
): Response {
  return Response.json(
    { error: { code, message, ...(details === undefined ? {} : { details }) } },
    { status: STATUS[code] },
  );
}

/**
 * Every route except the three with no session requires one, scopes its queries to the
 * caller's active **workspace**, and — since Phase 19B — refuses the request if their
 * role in that workspace does not carry it. All three server-side
 * (ARCHITECTURE.md → "API surface").
 *
 * **This replaced `requireOwnerId` in Phase 19A**, and the change is not cosmetic: what
 * a route is allowed to see stopped being "rows with your user id on them" and became
 * "rows in your workspace". Returning a `WorkspaceScope` rather than a string is what
 * makes that sweep safe — every store function takes the object, so a call site left on
 * the old signature does not compile. See `lib/workspace/scope.ts`.
 *
 * **Phase 19B added the argument, and it is the phase's load-bearing line.** 19A wrote
 * `role` and enforced nothing, which was inert while every member was the owner of their
 * own workspace; an invitation that can hand somebody `viewer` ends that. The default is
 * `viewer` — the least privilege — so **a route that says nothing gets read access and
 * not write access**, and a new mutating route that forgets the argument fails closed
 * rather than open. The matrix is in `CONTRACT.md` → *What each role may do*.
 *
 * It costs one query on top of the session read. That is affordable for the reason
 * `lib/workspace/store.ts` sets out: Neon's free tier meters time awake, not
 * statements, and this adds no new reason to wake an idle database.
 */
export async function requireScope(minimumRole: WorkspaceRole = "viewer"): Promise<WorkspaceScope> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) throw new ApiError("unauthenticated", "Sign in to use this endpoint.");

  const scope = await resolveScope(
    { id: user.id, name: user.name, email: user.email },
    await readActiveWorkspaceId(),
  );
  assertRole(scope.role, minimumRole);
  // Phase 22. Learned here and nowhere earlier — the log context is already open by the
  // time a route knows whose request this is — so every later line from this request
  // names its user and its workspace without the route saying so.
  addLogContext({ userId: scope.userId, workspaceId: scope.workspaceId });
  return scope;
}

/**
 * A scope for **a named workspace** rather than the active one — the workspace
 * management routes, Phase 19B.
 *
 * Those routes carry the workspace in the path, so that they read as what they are and
 * so that managing a workspace does not depend on which one a cookie happens to name.
 * The id in the URL is therefore an input from the caller, and this is the one function
 * that turns it into an authority: **a workspace the caller is not a member of answers
 * 404**, exactly as another tenant's workflow does (D20), because 403 would confirm that
 * the id exists. Insufficient role inside a workspace they *are* in answers 403 — see
 * `assertRole`.
 *
 * It reads the same membership list `requireScope` does, so there is one query and one
 * source of truth about who is in what.
 */
export async function requireScopeFor(
  workspaceId: string,
  minimumRole: WorkspaceRole = "viewer",
): Promise<WorkspaceScope> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) throw new ApiError("unauthenticated", "Sign in to use this endpoint.");

  const membership = (await listMemberships(user.id)).find(
    (m) => m.workspace.id === workspaceId,
  );
  if (!membership) throw new ApiError("not_found", "No such workspace.");

  const scope: WorkspaceScope = {
    workspaceId: membership.workspace.id,
    userId: user.id,
    role: membership.role,
  };
  assertRole(scope.role, minimumRole);
  addLogContext({ userId: scope.userId, workspaceId: scope.workspaceId });
  return scope;
}

/**
 * For the one route that needs to know somebody is signed in and nothing else: the node
 * registry, which serves the same static list to everybody and reads no row.
 *
 * Kept separate so it does not resolve a workspace it will not use. The model list looks
 * like it belongs here and does not — it resolves a provider key, and a key is a
 * workspace credential.
 */
export async function requireUserId(): Promise<string> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new ApiError("unauthenticated", "Sign in to use this endpoint.");
  return userId;
}

export async function readJson<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError("invalid_request", "Request body must be valid JSON.");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(
      "invalid_request",
      "Request body did not match the expected shape.",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

/**
 * Wraps a handler so an unexpected throw becomes a clean 500 with the detail in
 * the server log, never in the response. An `ApiError` passes through with its own
 * code.
 *
 * **Phase 22 made it the correlation boundary as well**, and that is why it reads the
 * headers it does not otherwise need. Every route in the product except four already
 * goes through here, so opening the log context here covers the whole API surface
 * without a single call site changing — and, critically, without `handle` growing a
 * `Request` parameter that 49 routes would have had to start passing.
 *
 * **The trace id comes from Cloud Run, not from here.** Cloud Run already writes a
 * request log for every request — method, path, status, latency — and charges nothing
 * for it. Emitting its trace id on our entries joins ours to that one, so the method and
 * the path are recoverable from the join instead of being logged a second time at our
 * expense. `OPERATIONS.md` → *Following one request* has the query.
 *
 * `headers()` throws outside a request context, which is exactly what a unit test is, so
 * it is guarded: no context is worse than a failed request.
 */
export async function handle(run: () => Promise<Response>): Promise<Response> {
  let trace: string;
  try {
    trace = traceFromHeaders(await headers());
  } catch {
    trace = traceFromHeaders(null);
  }

  return withLogContext({ trace }, async () => {
    try {
      return await run();
    } catch (error) {
      // An `ApiError` is a decision this product made about a request, not a fault: a
      // 404 for another workspace's workflow is the authorisation layer working. Logging
      // them at ERROR would bury the faults among thousands of correct refusals, so they
      // are not logged at all — the response says everything there is to say.
      if (error instanceof ApiError) return fail(error.code, error.message, error.details);
      logError("api.error", "An API request failed unexpectedly.", error);
      return fail("internal", "Something went wrong handling this request.");
    }
  });
}
