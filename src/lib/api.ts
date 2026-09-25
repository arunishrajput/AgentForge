import { z } from "zod";

import { auth } from "@/auth";

/**
 * Shared shapes for every API route — CONTRACT.md → "API request/response shapes".
 *
 * Success is `{ data: ... }`, failure is `{ error: { code, message, details? } }`.
 * One envelope means a client can tell the two apart without inspecting the status
 * code, and one place to make sure an internal error never reaches a client.
 */
export type ApiErrorCode =
  | "unauthenticated"
  | "not_found"
  | "invalid_request"
  | "invalid_graph"
  | "conflict"
  | "internal";

const STATUS: Record<ApiErrorCode, number> = {
  unauthenticated: 401,
  not_found: 404,
  invalid_request: 400,
  invalid_graph: 422,
  conflict: 409,
  internal: 500,
};

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

/**
 * Every route except the webhook receiver and the cron tick requires a session and
 * scopes its query to the owner, server-side (ARCHITECTURE.md → "API surface").
 * Returning the id rather than the session keeps callers from reaching for
 * anything wider.
 */
export async function requireOwnerId(): Promise<string> {
  const session = await auth();
  const ownerId = session?.user?.id;
  if (!ownerId) throw new ApiError("unauthenticated", "Sign in to use this endpoint.");
  return ownerId;
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
