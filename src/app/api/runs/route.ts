import { describeRun, listRuns } from "@/lib/engine/run";
import { handle, ok, requireOwnerId } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handle(async () => {
    const ownerId = await requireOwnerId();
    const workflowId = new URL(request.url).searchParams.get("workflowId") ?? undefined;
    const runs = await listRuns(ownerId, { workflowId });
    return ok(runs.map((run) => describeRun(run)));
  });
}
