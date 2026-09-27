import { ApiError, handle, ok, requireOwnerId } from "@/lib/api";
import { describeWorkflow, restoreVersion } from "@/lib/workflow/store";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; number: string }> };

/**
 * `POST /api/workflows/:id/versions/:number/restore`
 *
 * Writes that version's graph and name as a **new** version on top of the history.
 * Nothing is renumbered and nothing between is deleted — see `restoreVersion`.
 *
 * It answers with the workflow rather than the version, because that is what the
 * caller now has to render: the canvas reloads from it, and its `version` field is
 * the number the restore produced.
 */
export async function POST(_request: Request, { params }: Context) {
  return handle(async () => {
    const ownerId = await requireOwnerId();
    const { id, number } = await params;

    const parsed = Number(number);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new ApiError("not_found", "No such version of this workflow.");
    }

    return ok(describeWorkflow(await restoreVersion(ownerId, id, parsed)));
  });
}
