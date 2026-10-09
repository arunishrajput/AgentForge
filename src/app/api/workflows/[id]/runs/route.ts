import { z } from "zod";

import { describeRun, startDurableRun, startRun, sweepRuns } from "@/lib/engine/run";
import { RUN_MODES } from "@/lib/engine/types";
import { ApiError, handle, ok, okPage, requireApiScope } from "@/lib/api";
import { listRunPage } from "@/lib/runs/history";
import { pageCursors, readRunRequest } from "@/lib/runs/query";
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
  /**
   * **Phase 31 — test part of the workflow.** `node` runs that node alone, fed from pins and
   * from what ran before; `path` runs the way from the trigger to it. Synchronous only, and
   * labelled a test on the run (`CONTRACT.md` → *Partial runs*).
   */
  target: z
    .object({ scope: z.enum(["node", "path"]), nodeId: z.string().min(1).max(128) })
    .optional(),
});

type Context = { params: Promise<{ id: string }> };

/**
 * The body, leniently, as it always was: one that is empty, not JSON or the wrong shape starts
 * a plain run — every script and the canvas's first Run relied on that. **Except a test**
 * (Phase 31): a body that asks for a `target` and does not describe one properly is refused,
 * because falling back to a whole run would execute every node somebody meant to test one of.
 */
async function readTrigger(request: Request): Promise<z.infer<typeof triggerSchema>> {
  const text = await request.text();
  let json: unknown = {};
  try {
    if (text.trim() !== "") json = JSON.parse(text);
  } catch {
    // Not JSON: a plain run, as before.
  }

  const parsed = triggerSchema.safeParse(json);
  if (parsed.success) return parsed.data;
  if (json !== null && typeof json === "object" && "target" in json) {
    throw new ApiError(
      "invalid_request",
      "Request body did not match the expected shape.",
      parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  }
  return { input: undefined, mode: "sync" };
}

export async function POST(request: Request, { params }: Context) {
  return handle(async () => {
    const scope = await requireApiScope("editor");
    const { id } = await params;
    const workflow = await getWorkflow(scope, id);

    const body = await readTrigger(request);

    if (body.mode === "durable") {
      const outcome = await startDurableRun({
        scope,
        workflow,
        trigger: "manual",
        input: body.input ?? null,
        signal: request.signal,
        target: body.target,
      });

      // 202 when the queue took it: accepted, not complete. A fallback that executed the
      // run in-process is complete, so it answers 201 with the finished run — the shape
      // tells the client which it got without a flag to interpret.
      return outcome.queued
        ? ok(describeRun(outcome.run), 202)
        : ok(describeRun(outcome.run, undefined), 201);
    }

    const { run, steps } = await startRun({
      scope,
      workflow,
      trigger: "manual",
      input: body.input ?? null,
      signal: request.signal,
      target: body.target,
    });

    return ok(describeRun(run, steps), 201);
  });
}

/**
 * This workflow's runs, a page at a time — `GET /api/runs` with the workflow fixed (Phase 33).
 * `getWorkflow` first, so a workflow the asker cannot see is 404 here exactly as it is everywhere
 * else, rather than an empty list that confirms nothing and hides nothing.
 */
export async function GET(request: Request, { params }: Context) {
  return handle(async () => {
    const scope = await requireApiScope();
    const { id } = await params;
    await getWorkflow(scope, id);
    const { query, limit } = readRunRequest(new URL(request.url), { workflowId: id });
    await sweepRuns(scope);
    const page = await listRunPage(scope, query, { limit });
    return okPage(page.runs, pageCursors(page));
  });
}
