import { handle, ok, readJson, requireScope } from "@/lib/api";
import { deleteTag, renameTag, renameTagSchema } from "@/lib/workflow/library";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** Rename a tag — one row, whatever wears it. `editor`. A tag in another workspace is 404. */
export async function PATCH(request: Request, { params }: Context) {
  return handle(async () => {
    const scope = await requireScope("editor");
    const { id } = await params;
    const { name } = await readJson(request, renameTagSchema);
    return ok(await renameTag(scope, id, name));
  });
}

/** Delete a tag. It comes off every workflow wearing it. `editor`. */
export async function DELETE(_request: Request, { params }: Context) {
  return handle(async () => {
    const scope = await requireScope("editor");
    const { id } = await params;
    await deleteTag(scope, id);
    return ok({ deleted: id });
  });
}
