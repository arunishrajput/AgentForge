import { z } from "zod";

import { ApiError } from "@/lib/api-error";

import { COMMENT_MAX } from "./rules";
import { APPROVAL_TOKEN_PATTERN } from "./token";

/**
 * **What the approval routes accept — Phase 38.** A decision is a verb, `approve` or `reject`, with an
 * optional comment; through a link it carries the token **in the body** (D178), never in a URL.
 */

const comment = z
  .string()
  .trim()
  .max(COMMENT_MAX)
  .optional()
  .transform((text) => (text ? text : null));

/** `POST /api/approvals/[id]` — a member deciding, in the inbox or on the canvas. */
export const memberDecisionSchema = z
  .object({ decision: z.enum(["approve", "reject"]), comment })
  .strict();

const token = z.string().regex(APPROVAL_TOKEN_PATTERN, "That is not an approval link's token.");

/** `POST /api/approve/describe` — what the link is asking. */
export const linkDescribeSchema = z.object({ token }).strict();

/** `POST /api/approve/decide` — whoever holds the link, deciding. */
export const linkDecisionSchema = z
  .object({ token, decision: z.enum(["approve", "reject"]), comment })
  .strict();

export const decisionStatus = (decision: "approve" | "reject") => (decision === "approve" ? "approved" : "rejected") as "approved" | "rejected";

/**
 * The largest body a public approval route reads. A token, a verb and a 1,000-character comment fit
 * in well under this; anything bigger is not a decision, and is refused before it is parsed.
 */
export const MAX_LINK_BODY_BYTES = 8 * 1024;

/**
 * **Read a public route's body — bounded first, parsed second.** The two link routes have no session,
 * so they read nothing larger than a decision can be, and answer a malformed one the way every route
 * does: `invalid_request`, saying what was wrong with the shape and never echoing the token back.
 */
export async function readLinkBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_LINK_BODY_BYTES) throw new ApiError("invalid_request", "The request body is too large.");
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_LINK_BODY_BYTES) throw new ApiError("invalid_request", "The request body is too large.");

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new ApiError("invalid_request", "Request body must be valid JSON.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(
      "invalid_request",
      "Request body did not match the expected shape.",
      parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  }
  return parsed.data;
}
