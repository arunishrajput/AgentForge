import { handle, requireApiScope } from "@/lib/api";
import { retryRun } from "@/lib/engine/recover";
import { readRestartMode, restartResponse } from "@/lib/runs/restart-route";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * **Retry from the failed step** — a new run that carries over every step this one finished, as
 * `reused`, and starts at the step it failed at, on the workflow as saved now. Phase 33,
 * `CONTRACT.md` → *Re-runs and retries*. `editor`. Only a failed run; 409 with the reason
 * otherwise, and when its history cannot be replayed or the failed step is gone.
 */
export async function POST(request: Request, { params }: Context) {
  return handle(async () => {
    const scope = await requireApiScope("editor");
    const { id } = await params;
    const mode = await readRestartMode(request);
    // A graph that cannot run answers 422 from `startRun`, as `POST /runs` does.
    return restartResponse(await retryRun({ scope, runId: id, mode, signal: request.signal }));
  });
}
