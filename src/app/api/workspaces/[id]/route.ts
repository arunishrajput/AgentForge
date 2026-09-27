import { handle, ok, readJson, requireScopeFor } from "@/lib/api";
import { describeWorkspace, renameWorkspace, renameWorkspaceSchema } from "@/lib/workspace/store";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * Rename a workspace. `admin`, because the name is what every member sees in the header
 * and on every page that says where their work is going.
 *
 * There is no DELETE. Deleting a workspace would cascade to its workflows, runs, versions
 * and credentials — every row in the product — and it belongs beside the "are you sure"
 * that Phase 20's role management brings, not beside a rename field.
 */
export async function PATCH(request: Request, { params }: Context) {
  return handle(async () => {
    const { id } = await params;
    const scope = await requireScopeFor(id, "admin");
    const body = await readJson(request, renameWorkspaceSchema);
    const workspace = await renameWorkspace(scope, body);
    return ok(describeWorkspace({ workspace, role: scope.role }, scope.userId));
  });
}
