import { z } from "zod";

import { auth } from "@/auth";
import { ApiError, STATUS, type ApiErrorCode } from "@/lib/api-error";
import { resolveScope } from "@/lib/workspace/store";
import type { WorkspaceScope } from "@/lib/workspace/scope";

/**
 * Shared shapes for every API route — CONTRACT.md → "API request/response shapes".
 *
 * Success is `{ data: ... }`, failure is `{ error: { code, message, details? } }`.
 * One envelope means a client can tell the two apart without inspecting the status
 * code, and one place to make sure an internal error never reaches a client.
 */
export { ApiError, type ApiErrorCode };

export function ok<T>(data: T, status = 200): Response {
  return Response.json({ data }, { status });
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
 * Every route except the three with no session requires one, and scopes its queries to
 * the caller's active **workspace**, server-side (ARCHITECTURE.md → "API surface").
 *
 * **This replaced `requireOwnerId` in Phase 19A**, and the change is not cosmetic: what
 * a route is allowed to see stopped being "rows with your user id on them" and became
 * "rows in your workspace". Returning a `WorkspaceScope` rather than a string is what
 * makes that sweep safe — every store function takes the object, so a call site left on
 * the old signature does not compile. See `lib/workspace/scope.ts`.
 *
 * It costs one query on top of the session read. That is affordable for the reason
 * `lib/workspace/store.ts` sets out: Neon's free tier meters time awake, not
 * statements, and this adds no new reason to wake an idle database.
 */
export async function requireScope(): Promise<WorkspaceScope> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) throw new ApiError("unauthenticated", "Sign in to use this endpoint.");
  return resolveScope({ id: user.id, name: user.name, email: user.email });
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
 */
export async function handle(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiError) return fail(error.code, error.message, error.details);
    console.error("Unhandled API error:", error);
    return fail("internal", "Something went wrong handling this request.");
  }
}
