import { ApiError, handle, ok } from "@/lib/api";
import { decisionStatus, linkDecisionSchema, readLinkBody } from "@/lib/approvals/schema";
import { approvalForLink, decide } from "@/lib/approvals/store";
import { hashApprovalToken } from "@/lib/approvals/token";

export const dynamic = "force-dynamic";

/**
 * **Decide an approval through its link — Phase 38, no session** (`SECURITY.md` → *The
 * unauthenticated surfaces*, D178). `{ token, decision: "approve" | "reject", comment? }`.
 *
 * **Holding the link is the authority**: the author sent it to the people they meant, through a channel
 * they chose, and whoever opens it may decide — once. That is why it is a bearer secret with every
 * guard the invitation link has: 256 bits, hashed at rest, expiring with the request, dead the moment
 * anything decides it, and refused once its run has finished. And why **only a POST decides**: a chat
 * app fetching the link for a preview fetches a page that knows nothing (the token is in the fragment),
 * and this route has no GET at all.
 *
 * One compare-and-set (`decideSql`); a request that cannot be decided answers 404 if it never existed
 * and 409 if it did — a link already used, timed out, or whose run stopped. Answers the decision.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const body = await readLinkBody(request, linkDecisionSchema);
    const outcome = await decide({
      key: { tokenHash: hashApprovalToken(body.token) },
      decision: decisionStatus(body.decision),
      via: "link",
      decidedBy: null,
      comment: body.comment,
    });
    if (!outcome.decided) {
      const known = await approvalForLink(body.token);
      if (!known) throw new ApiError("not_found", "This approval link is not valid.");
      throw new ApiError("conflict", "This approval is no longer open — it was decided, it timed out, or its run stopped.");
    }
    return ok({ status: outcome.status });
  });
}
