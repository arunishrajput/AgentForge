import { handle, ok, requireScope } from "@/lib/api";
import { starWorkflow, unstarWorkflow } from "@/lib/workflow/library";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * Star a workflow for yourself — Phase 32. **`viewer`**: a star is the asker's own preference
 * and changes nothing anybody else sees, like finishing the first-run guide. Both directions
 * are idempotent.
 */
export async function PUT(_request: Request, { params }: Context) {
  return handle(async () => {
    const scope = await requireScope();
    const { id } = await params;
    await starWorkflow(scope, id);
    return ok({ starred: true });
  });
}

export async function DELETE(_request: Request, { params }: Context) {
  return handle(async () => {
    const scope = await requireScope();
    const { id } = await params;
    await unstarWorkflow(scope, id);
    return ok({ starred: false });
  });
}
