import { handle, ok, requireScope } from "@/lib/api";
import { describeWorkflow, shareWorkflowPublicly, unshareWorkflow } from "@/lib/workflow/store";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * Publish a read-only link to this workflow's graph — **Phase 20**.
 *
 * **`admin`, not `editor`, and that is the one judgement call in this route.** An editor
 * may already run a workflow, which sends mail and posts to Discord — writes to the outside
 * world far less reversible than this. So the bar is not about power; it is about *kind*.
 * Every other thing an editor does happens inside the workspace and is undone by editing.
 * This one takes the workspace's content and makes it readable by anybody who is handed a
 * URL, which is the sort of decision the person accountable for the workspace should be
 * the one to take. The same reasoning put `list provider models` behind `admin` in Phase
 * 19B: what a role gates is the class of act, not the size of it.
 *
 * Idempotent — an already-shared workflow answers with the link it already has rather than
 * minting a second one. `shareWorkflowPublicly` says why rotation is deliberately two
 * requests instead.
 *
 * 201 when a link was created, 200 when one already existed, so a client can tell "this is
 * new, copy it" from "this was already live" without comparing strings.
 */
export async function POST(_request: Request, { params }: Context) {
  return handle(async () => {
    const { id } = await params;
    const scope = await requireScope("admin");
    const { workflow, minted } = await shareWorkflowPublicly(scope, id);
    return ok(describeWorkflow(workflow), minted ? 201 : 200);
  });
}

/**
 * Stop sharing. The token is discarded, so the URL is dead the moment this returns and
 * cannot be brought back — which is the only thing that makes the button worth pressing.
 *
 * Idempotent, so two tabs both unsharing both succeed.
 */
export async function DELETE(_request: Request, { params }: Context) {
  return handle(async () => {
    const { id } = await params;
    const scope = await requireScope("admin");
    return ok(describeWorkflow(await unshareWorkflow(scope, id)));
  });
}
