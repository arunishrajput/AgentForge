import { handle, ok, requireOwnerId } from "@/lib/api";
import { getWorkflow } from "@/lib/workflow/store";
import { describeHistory, listVersions } from "@/lib/workflow/versions";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * `GET /api/workflows/:id/versions` — the history, newest first.
 *
 * `getWorkflow` first, and not only to read `version`: it is the owner check, and it
 * is what makes another account's workflow answer 404 here exactly as it does
 * everywhere else (D20).
 *
 * No graphs in the response. Each row carries what it *changed* — computed on the
 * server from snapshots it had to read anyway — which is the part a person scrolling a
 * history reads, at a fraction of the bytes.
 */
export async function GET(_request: Request, { params }: Context) {
  return handle(async () => {
    const ownerId = await requireOwnerId();
    const { id } = await params;
    const workflow = await getWorkflow(ownerId, id);
    const versions = await listVersions(ownerId, id);
    return ok(describeHistory(versions, workflow));
  });
}
