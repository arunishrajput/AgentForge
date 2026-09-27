import { z } from "zod";

import { describeRun, listRuns, startDurableRun, startRun } from "@/lib/engine/run";
import { RUN_MODES } from "@/lib/engine/types";
import { handle, ok, readJson, requireOwnerId } from "@/lib/api";
import { getWorkflow } from "@/lib/workflow/store";

export const dynamic = "force-dynamic";

/**
 * Trigger a run — CONTRACT.md → "API request/response shapes".
 *
 * **`mode` defaults to `sync`, and that default is a compatibility decision.** A
 * synchronous run holds this request open until it finishes and answers with the completed
 * run and every step, which is what the canvas's Run button, `DEMO.md` and every
 * verification script read. Phase 17 did not change that; it added a second mode beside
 * it.
 *
 * `mode: "durable"` answers **202** with a `queued` run and no steps. The run is executed
 * by a Cloud Tasks delivery, so it survives a redeploy — and the client watches it the
 * same way it watches a webhook-triggered run, over the SSE stream, which already had to
 * work for a run this browser did not start (D28). That is why durable mode needed no new
 * client protocol.
 */
const triggerSchema = z.object({
  input: z.unknown().optional(),
  mode: z.enum(RUN_MODES).default("sync"),
});

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  return handle(async () => {
    const ownerId = await requireOwnerId();
    const { id } = await params;
    const workflow = await getWorkflow(ownerId, id);

    const body =
      request.headers.get("content-length") === "0"
        ? { input: undefined, mode: "sync" as const }
        : await readJson(request, triggerSchema).catch(() => ({
            input: undefined,
            mode: "sync" as const,
          }));

    if (body.mode === "durable") {
      const outcome = await startDurableRun({
        ownerId,
        workflow,
        trigger: "manual",
        input: body.input ?? null,
        signal: request.signal,
      });

      // 202 when the queue took it: accepted, not complete. A fallback that executed the
      // run in-process is complete, so it answers 201 with the finished run — the shape
      // tells the client which it got without a flag to interpret.
      return outcome.queued
        ? ok(describeRun(outcome.run), 202)
        : ok(describeRun(outcome.run, undefined), 201);
    }

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
