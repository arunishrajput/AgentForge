import { z } from "zod";

import { ApiError, ok } from "@/lib/api";
import { describeRun } from "@/lib/engine/run";
import type { RestartOutcome } from "@/lib/engine/recover";
import { RUN_MODES, type RunMode } from "@/lib/engine/types";

/**
 * What `POST /api/runs/:id/rerun` and `…/retry` share — Phase 33: the body, and the answer.
 *
 * **The body is `{ mode? }`, `sync` by default** — the default `POST /runs` has (a compatibility
 * decision there, a consistency one here). The run pages ask for `durable`: the new run is on the
 * queue in a moment, and the page that asked opens it and watches it stream.
 *
 * **The answer is `POST /runs`'s**, status code included: 201 with the finished run and its steps,
 * 202 with a queued run and none, 201 with a run executed here when the queue could not take it.
 */
const bodySchema = z.object({ mode: z.enum(RUN_MODES).default("sync") });

export async function readRestartMode(request: Request): Promise<RunMode> {
  const text = await request.text();
  if (text.trim() === "") return "sync";
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ApiError("invalid_request", "Request body was not valid JSON.");
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(
      "invalid_request",
      "Request body did not match the expected shape.",
      parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  }
  return parsed.data.mode;
}

export function restartResponse(outcome: RestartOutcome): Response {
  if (outcome.kind === "queued") return ok(describeRun(outcome.run), 202);
  if (outcome.kind === "ran_here") return ok(describeRun(outcome.run, undefined), 201);
  return ok(describeRun(outcome.run, outcome.steps), 201);
}
