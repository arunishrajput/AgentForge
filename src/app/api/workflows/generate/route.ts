import { NoProviderKeyError, PROVIDER_KEY_RECOVERY, resolveProvider } from "@/lib/ai/provider";
import { ProviderError } from "@/lib/ai/types";
import { ApiError, handle, ok, readJson, requireApiScope } from "@/lib/api";
import type { WorkspaceScope } from "@/lib/workspace/scope";
import { generateWorkflow, generationLogFields } from "@/lib/generate/generate";
import { logInfo, logWarn } from "@/lib/logging";
import { generateRequestSchema } from "@/lib/generate/schema";
import { createWorkflow, describeWorkflow } from "@/lib/workflow/store";

export const dynamic = "force-dynamic";

/**
 * `POST /api/workflows/generate` — CONTRACT.md → "Generation request/response".
 *
 * A plain-language request in, a real persisted workflow out. The order is the whole
 * point: generate, validate, and only then insert. A workflow that could not run is
 * never written (PRD.md → Generation), so a user cannot end up with a broken row and
 * no idea how it got there.
 *
 * Synchronous, like `POST /runs`: generation is one or two model calls, and the
 * response is the created workflow, so the client can navigate straight to it.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const scope = await requireApiScope("editor");
    const body = await readJson(request, generateRequestSchema);

    const provider = await resolveProviderOr422(scope);

    let result;
    const started = Date.now();
    try {
      result = await generateWorkflow({
        model: provider.model,
        modelId: provider.selectedModel,
        prompt: body.prompt,
        name: body.name,
      });
    } catch (error) {
      // The provider's own words reach the user — a bad key or a busy model is
      // something they can act on, and hiding it behind "something went wrong"
      // wasted time in Phase 6.
      if (error instanceof ProviderError) {
        throw new ApiError("invalid_graph", error.message, {
          issues: [],
          attempts: error.attempts,
        });
      }
      throw error;
    }

    // Phase 34: which attempt produced the graph, counted by `agentforge_generations`. A provider
    // failure above is not a generation outcome — nothing was produced to judge — and
    // `model.call` already records it.
    // `mode` since Phase 35, when the copilot began logging the same event (D165).
    const fields = { ...generationLogFields(result, Date.now() - started), mode: "create" };
    if (result.ok) logInfo("generation.finished", `Generated a workflow on attempt ${fields.attempts}.`, fields);
    else logWarn("generation.finished", "Generation produced no valid workflow in two attempts.", fields);

    if (!result.ok) {
      // 422 `invalid_graph`: the request was well formed and the model answered, but
      // what it produced cannot run. `details` carries the issue list so the UI can
      // show exactly what was wrong.
      throw new ApiError("invalid_graph", result.message, {
        issues: result.issues,
        attempts: result.attempts,
      });
    }

    const workflow = await createWorkflow(
      scope,
      {
        name: result.name,
        description: result.description,
        graph: result.graph,
      },
      // Names version 1 in the history, and thereby exempts it from the retention
      // cap. The model's first draft is the one thing a user edits away from and
      // then wants back, so it is the version worth keeping for ever.
      { versionLabel: "Generated" },
    );

    return ok(
      {
        workflow: describeWorkflow(workflow),
        generation: {
          model: result.model,
          source: provider.source,
          unsupported: result.unsupported,
          usage: result.usage,
          attempts: result.attempts,
        },
      },
      201,
    );
  });
}

/**
 * No key is a 404 on the settings route because the caller asked for a thing that is
 * not there. Here the caller asked to generate, and the fix is a different page, so
 * it is reported as an actionable failure with the message the provider module wrote.
 *
 * **Phase 25 attaches the door as well as the explanation.** This is the failure a
 * brand-new account hits on the product's primary call to action, and naming Settings in
 * prose left the user to go and find it. `details.recovery` carries an in-app link the
 * prompt box renders as a button — `lib/api-error.ts` → `Recovery`.
 */
async function resolveProviderOr422(scope: WorkspaceScope) {
  try {
    return await resolveProvider(scope);
  } catch (error) {
    if (error instanceof NoProviderKeyError) {
      throw new ApiError("invalid_request", error.message, {
        recovery: PROVIDER_KEY_RECOVERY,
      });
    }
    throw error;
  }
}
