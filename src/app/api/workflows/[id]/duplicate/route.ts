import { handle, ok, requireScope } from "@/lib/api";
import { duplicateWorkflow } from "@/lib/workflow/library";
import { describeWorkflow } from "@/lib/workflow/store";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * Duplicate a workflow on the server — Phase 32. `editor`, because it creates one. 201 with
 * the copy, which has its own webhook token and starts switched off if its trigger would run it
 * by itself (D147).
 */
export async function POST(_request: Request, { params }: Context) {
  return handle(async () => {
    const scope = await requireScope("editor");
    const { id } = await params;
    return ok(describeWorkflow(await duplicateWorkflow(scope, id)), 201);
  });
}
