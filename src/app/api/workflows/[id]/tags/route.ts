import { handle, ok, readJson, requireScope } from "@/lib/api";
import { setWorkflowTags, setWorkflowTagsSchema } from "@/lib/workflow/library";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * The tags a workflow wears, replaced as a set — Phase 32. `editor`. Not a version and not an
 * update: the workflow's `version` and `updatedAt` do not move (`lib/workflow/library.ts`).
 */
export async function PUT(request: Request, { params }: Context) {
  return handle(async () => {
    const scope = await requireScope("editor");
    const { id } = await params;
    const { tagIds } = await readJson(request, setWorkflowTagsSchema);
    return ok(await setWorkflowTags(scope, id, tagIds));
  });
}
