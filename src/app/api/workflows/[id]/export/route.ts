import { handle, ok, requireScope } from "@/lib/api";
import { getWorkflow } from "@/lib/workflow/store";
import { exportWorkflow } from "@/lib/workflow/transfer";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * A workflow as an export envelope — Phase 32, `CONTRACT.md` → *The workflow export*.
 *
 * **`viewer`**: it is a read of exactly what `GET /api/workflows/:id` already answers that
 * reader, minus every token and id, so it discloses nothing new. A workflow the reader cannot
 * see is a 404 through `getWorkflow` (D101).
 *
 * **Pinned outputs are left out unless `?pinned=include`** (D146). The answer is the ordinary
 * `{ data }` envelope rather than a file download, so a failure reads like every other one; the
 * browser saves `data` as the file.
 */
export async function GET(request: Request, { params }: Context) {
  return handle(async () => {
    const scope = await requireScope();
    const { id } = await params;
    const includePinned = new URL(request.url).searchParams.get("pinned") === "include";
    return ok(exportWorkflow(await getWorkflow(scope, id), { includePinned }));
  });
}
