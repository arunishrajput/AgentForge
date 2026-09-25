import { z } from "zod";

import { describeRun, listRuns, startRun } from "@/lib/engine/run";
import { handle, ok, readJson, requireOwnerId } from "@/lib/api";
import { getWorkflow } from "@/lib/workflow/store";

export const dynamic = "force-dynamic";

/**
 * Trigger a run. The engine is in-process, so this request stays open until the
 * run finishes and returns the completed run with every step record. Phase 5 adds
 * the SSE stream for watching it live; this remains the way a run is started.
 */
const triggerSchema = z.object({
  input: z.unknown().optional(),
});

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  return handle(async () => {
    const ownerId = await requireOwnerId();
    const { id } = await params;
    const workflow = await getWorkflow(ownerId, id);

    const body =
      request.headers.get("content-length") === "0"
        ? { input: undefined }
        : await readJson(request, triggerSchema).catch(() => ({ input: undefined }));

    const { run, steps } = await startRun({
      ownerId,
      workflow,
      trigger: "manual",
      input: body.input ?? null,
      signal: request.signal,
    });

    return ok(describeRun(run, steps), 201);
  });
}

export async function GET(_request: Request, { params }: Context) {
  return handle(async () => {
    const ownerId = await requireOwnerId();
    const { id } = await params;
    await getWorkflow(ownerId, id);
    const runs = await listRuns(ownerId, { workflowId: id });
    return ok(runs.map((run) => describeRun(run)));
  });
}
