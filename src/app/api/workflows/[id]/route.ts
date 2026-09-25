import { handle, ok, readJson, requireOwnerId } from "@/lib/api";
import {
  deleteWorkflow,
  describeWorkflow,
  getWorkflow,
  updateWorkflow,
  updateWorkflowSchema,
} from "@/lib/workflow/store";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  return handle(async () => {
    const ownerId = await requireOwnerId();
    const { id } = await params;
    return ok(describeWorkflow(await getWorkflow(ownerId, id)));
  });
}

export async function PATCH(request: Request, { params }: Context) {
  return handle(async () => {
    const ownerId = await requireOwnerId();
    const { id } = await params;
    const body = await readJson(request, updateWorkflowSchema);
    return ok(describeWorkflow(await updateWorkflow(ownerId, id, body)));
  });
}

export async function DELETE(_request: Request, { params }: Context) {
  return handle(async () => {
    const ownerId = await requireOwnerId();
    const { id } = await params;
    await deleteWorkflow(ownerId, id);
    return ok({ deleted: id });
  });
}
