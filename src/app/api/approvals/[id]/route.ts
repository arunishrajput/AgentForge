import { ApiError, handle, ok, readJson, requireScope } from "@/lib/api";
import { decisionStatus, memberDecisionSchema } from "@/lib/approvals/schema";
import { approvalForMember, decide } from "@/lib/approvals/store";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * **One approval request, for a member — Phase 38** (`CONTRACT.md` → *Approvals*). What it asks, its
 * state, who decided, and whether **this** member may decide it now (`canDecide`). Read by the canvas
 * and the run page when a run is waiting on one — when the page is opened, never polled.
 *
 * Any role may read it: a viewer can read the run it belongs to. A request in another workspace, or on
 * a private workflow the reader cannot see, is the same 404 as one that does not exist (D20, D101).
 */
export async function GET(_request: Request, { params }: Context) {
  return handle(async () => {
    const scope = await requireScope();
    const { id } = await params;
    const view = await approvalForMember(scope, id);
    if (!view) throw new ApiError("not_found", "No such approval.");
    return ok(view);
  });
}

/**
 * **Decide it, as a member** — `{ decision: "approve" | "reject", comment? }` — from the inbox or the
 * canvas. **Who may is the node's rule, not a role floor**: anybody named in it, whatever their role, or
 * with nobody named, an editor and above (`mayDecide`). So the route asks for no minimum role and
 * answers 403 to a member it does not name; 409 once the request is no longer open — decided, timed
 * out, or its run finished — because a second decision must not look like the first one landing.
 *
 * Answers the request as it now stands. The run is woken by the decision itself (`store.ts`).
 */
export async function POST(request: Request, { params }: Context) {
  return handle(async () => {
    const scope = await requireScope();
    const { id } = await params;
    const body = await readJson(request, memberDecisionSchema);

    const view = await approvalForMember(scope, id);
    if (!view) throw new ApiError("not_found", "No such approval.");
    if (!view.open) throw new ApiError("conflict", "This approval is no longer open — it was decided, it timed out, or its run stopped.");
    if (!view.canDecide) {
      throw new ApiError(
        "forbidden",
        view.approvers === null
          ? "Only an editor, an admin or an owner can decide this approval."
          : "Only the people this approval names can decide it.",
      );
    }

    const outcome = await decide({
      key: { id },
      decision: decisionStatus(body.decision),
      via: "member",
      decidedBy: scope.userId,
      comment: body.comment,
    });
    // Somebody else's decision, or the timeout, landed between the read and this write.
    if (!outcome.decided) throw new ApiError("conflict", "This approval was decided a moment ago by someone else.");

    return ok(await approvalForMember(scope, id));
  });
}
