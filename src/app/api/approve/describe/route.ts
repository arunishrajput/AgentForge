import { ApiError, handle, ok } from "@/lib/api";
import { linkDescribeSchema, readLinkBody } from "@/lib/approvals/schema";
import { approvalForLink } from "@/lib/approvals/store";

export const dynamic = "force-dynamic";

/**
 * **What an approval link is asking — Phase 38, no session** (`SECURITY.md` → *The unauthenticated
 * surfaces*, D178). The decision page reads its token out of the URL's fragment, which no browser
 * sends, and POSTs it here in the body — so the token is in no request line, no Cloud Run request log
 * and no `Referer`. A POST that changes nothing, because a GET would have to carry the token in its URL.
 *
 * Guarded like the invitation preview:
 *
 *   - the token is checked against its pattern **before the database is asked anything**
 *   - an unknown token is a 404 with one message
 *   - a known one that can no longer be decided answers `{ state: "closed" }` and **nothing else** — not
 *     who decided or how, which would tell whoever holds a link in a busy channel a colleague's address
 *   - an open one answers its workflow's name, the message, and when it closes. Nothing else of the
 *     workspace: the message is what the author chose to send with the link
 */
export async function POST(request: Request) {
  return handle(async () => {
    const { token } = await readLinkBody(request, linkDescribeSchema);
    const view = await approvalForLink(token);
    if (!view) throw new ApiError("not_found", "This approval link is not valid.");
    if (!view.open) return ok({ state: "closed" as const });
    return ok({
      state: "open" as const,
      workflowName: view.workflowName,
      message: view.message,
      expiresAt: view.expiresAt,
    });
  });
}
