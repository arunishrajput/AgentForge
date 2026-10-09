import { handle, requireApiScope } from "@/lib/api";
import { rerunRun } from "@/lib/engine/recover";
import { readRestartMode, restartResponse } from "@/lib/runs/restart-route";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * **Re-run** — a new run with this one's input, from the trigger, on the workflow as saved now.
 * Phase 33, `CONTRACT.md` → *Re-runs and retries*. `editor`, like starting any run. Any finished
 * run may be re-run; a test of one node, or of the way to it, is re-run as that test.
 */
export async function POST(request: Request, { params }: Context) {
  return handle(async () => {
    const scope = await requireApiScope("editor");
    const { id } = await params;
    const mode = await readRestartMode(request);
    // A graph that cannot run answers 422 from `startRun`, as `POST /runs` does.
    return restartResponse(await rerunRun({ scope, runId: id, mode, signal: request.signal }));
  });
}
