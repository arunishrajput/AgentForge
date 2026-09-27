import { describeRun, listRuns } from "@/lib/engine/run";
import { handle, ok, requireScope } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handle(async () => {
    const scope = await requireScope();
    const workflowId = new URL(request.url).searchParams.get("workflowId") ?? undefined;
    const runs = await listRuns(scope, { workflowId });
    return ok(runs.map((run) => describeRun(run)));
  });
}
