import { NoProviderKeyError, PROVIDER_KEY_RECOVERY, resolveProvider } from "@/lib/ai/provider";
import { ProviderError } from "@/lib/ai/types";
import { ApiError, handle, ok, readJson, requireScope, type Recovery } from "@/lib/api";
import { getRun, toStepRecord } from "@/lib/engine/run";
import { validateGraph } from "@/lib/engine/validate";
import { editWorkflow } from "@/lib/generate/edit";
import { runEvidence, runFacts } from "@/lib/generate/evidence";
import { answerLogFields, diagnoseRun, explainWorkflow } from "@/lib/generate/explain";
import { generationLogFields } from "@/lib/generate/generate";
import { copilotRequestSchema } from "@/lib/generate/schema";
import { logInfo, logWarn } from "@/lib/logging";
import { diffGraphs } from "@/lib/workflow/diff";
import type { WorkflowGraph } from "@/lib/workflow/graph";
import { getWorkflow } from "@/lib/workflow/store";
import type { WorkspaceScope } from "@/lib/workspace/scope";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * The way forward from a provider's refusal — a bad key, a spent quota, a model that is gone. Each
 * is fixed in the same place: the provider settings, where the key and the model are chosen
 * (`BUILD_PLAN.md` → *Phase 35*: "a quota or key failure reaches the user with a
 * `details.recovery` door").
 */
const PROVIDER_RECOVERY: Recovery = { href: "/settings?tab=provider", label: "Open provider settings" };

/**
 * `POST /api/workflows/:id/copilot` — **the copilot**, `CONTRACT.md` → *Copilot request/response*.
 * Three asks, by `kind`, and **none of them writes anything**:
 *
 *   edit      (Phase 35, the default) the canvas's graph and a change in plain language in; a
 *             validated **proposed** graph out (`lib/generate/edit.ts`). A proposal reaches the
 *             canvas as a diff, and only a person pressing Accept puts it there — unsaved
 *   explain   (Phase 36) a walkthrough of the canvas's graph, sentence by sentence, each citing
 *             the steps it is about (`lib/generate/explain.ts`)
 *   diagnose  (Phase 36) why one failed run of this workflow failed, and — where the fix is a
 *             change to the workflow — that change in words. The client then asks for it as an
 *             edit, so a fix is a proposal like any other (D167). **The run is read here**, not
 *             sent: its record is bounded and scrubbed (`evidence.ts`) and reaches the model as
 *             data. It is the only one of the three that sees run data
 *
 * `editor`, for all three: the copilot is for changing a workflow, and every ask spends the
 * workspace's model key. A viewer is refused with the role named, before a model is called. The
 * path's workflow must be one this person can see — another workspace's, or a colleague's private
 * one, is 404 (D20, D101) — but the graph read is the one the request carries, because that is
 * what is on the person's screen, saved or not.
 */
export async function POST(request: Request, { params }: Context) {
  return handle(async () => {
    const scope = await requireScope("editor");
    const { id } = await params;
    const body = await readJson(request, copilotRequestSchema);
    const workflow = await getWorkflow(scope, id);
    const subject = { name: workflow.name, description: workflow.description, graph: body.graph };

    // A run that cannot be diagnosed is refused before a key is even looked up, so it costs nothing.
    const failedRun = body.kind === "diagnose" ? await readFailedRun(scope, id, body.runId, body.graph) : null;

    const provider = await resolveProviderOr400(scope);
    const generation = (result: { model: string; usage: unknown; attempts: unknown }) => ({
      model: result.model,
      source: provider.source,
      usage: result.usage,
      attempts: result.attempts,
    });
    const started = Date.now();

    if (body.kind === "explain") {
      const result = await asking(() =>
        explainWorkflow({ model: provider.model, modelId: provider.selectedModel, subject }),
      );
      logAnswer(result, Date.now() - started, "explain");
      if (!result.ok) throw new ApiError("invalid_graph", result.message, { issues: result.issues, attempts: result.attempts });
      return ok({ explanation: result.answer, generation: generation(result) });
    }

    if (body.kind === "diagnose" && failedRun) {
      const result = await asking(() =>
        diagnoseRun({ model: provider.model, modelId: provider.selectedModel, subject, evidence: failedRun.evidence }),
      );
      logAnswer(result, Date.now() - started, "diagnose");
      if (!result.ok) throw new ApiError("invalid_graph", result.message, { issues: result.issues, attempts: result.attempts });
      return ok({ diagnosis: result.answer, run: failedRun.facts, generation: generation(result) });
    }

    const edit = body.kind === "edit" ? body : null;
    if (!edit) throw new ApiError("invalid_request", "Unknown copilot request.");
    const result = await asking(() =>
      editWorkflow({
        model: provider.model,
        modelId: provider.selectedModel,
        instruction: edit.instruction,
        subject,
        earlier: edit.earlier,
      }),
    );

    // The same event generation logs, with `mode` (D165): one quality metric, several kinds of ask.
    const fields = { ...generationLogFields(result, Date.now() - started), mode: "edit" };
    if (result.ok) logInfo("generation.finished", `Proposed an edit on attempt ${fields.attempts}.`, fields);
    else logWarn("generation.finished", "The copilot produced no valid proposal in two attempts.", fields);

    if (!result.ok) {
      throw new ApiError("invalid_graph", result.message, {
        issues: result.issues,
        attempts: result.attempts,
      });
    }

    return ok({
      proposal: {
        graph: result.graph,
        unsupported: result.unsupported,
        /** Against the graph sent. `any: false` is a proposal of no change — said, not hidden. */
        changes: diffGraphs(edit.graph, result.graph).summary,
        /** Problems the proposal still has — only ever ones the graph sent already had (D162). */
        problems: validateGraph(result.graph).problems,
      },
      generation: generation(result),
    });
  });
}

/**
 * A provider's refusal — a bad key, a spent quota — is not a bad answer: nothing was produced to
 * judge. It reaches the person in the provider's own words with the door to fix it (Phase 25).
 */
async function asking<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof ProviderError) {
      throw new ApiError("invalid_graph", error.message, {
        issues: [],
        attempts: error.attempts,
        recovery: PROVIDER_RECOVERY,
      });
    }
    throw error;
  }
}

function logAnswer(result: Parameters<typeof answerLogFields>[0], durationMs: number, mode: "explain" | "diagnose") {
  const fields = answerLogFields(result, durationMs, mode);
  const noun = mode === "explain" ? "explanation" : "diagnosis";
  if (result.ok) logInfo("generation.finished", `Answered with a ${noun} on attempt ${fields.attempts}.`, fields);
  else logWarn("generation.finished", `The copilot produced no readable ${noun} in two attempts.`, fields);
}

/**
 * The run a diagnosis is about: one of **this** workflow's, visible to the asker (D101), and failed.
 * Its record becomes the evidence; its facts are what the client needs to offer the right way to run
 * it again once a fix is accepted (D171) — which step failed, and which steps already ran.
 */
async function readFailedRun(scope: WorkspaceScope, workflowId: string, runId: string, graph: WorkflowGraph) {
  const { run, steps } = await getRun(scope, runId);
  // Another workflow's run is not this copilot's to read, and saying so would confirm it exists.
  if (run.workflowId !== workflowId) throw new ApiError("not_found", "No such run.");
  if (run.status !== "failed") {
    throw new ApiError("conflict", `Only a failed run can be diagnosed, and this one is ${run.status}.`);
  }

  const labels = new Map(
    graph.nodes.filter((node) => node.label !== undefined && node.label !== "").map((node) => [node.id, node.label!]),
  );
  const records = steps.map(toStepRecord);
  return { evidence: runEvidence({ run, steps: records, labels }), facts: runFacts({ run, steps: records }) };
}

/** No key is the same refusal generation gives, with the same door (Phase 25). */
async function resolveProviderOr400(scope: WorkspaceScope) {
  try {
    return await resolveProvider(scope);
  } catch (error) {
    if (error instanceof NoProviderKeyError) {
      throw new ApiError("invalid_request", error.message, { recovery: PROVIDER_KEY_RECOVERY });
    }
    throw error;
  }
}
