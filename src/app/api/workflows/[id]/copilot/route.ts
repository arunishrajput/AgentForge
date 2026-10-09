import { NoProviderKeyError, PROVIDER_KEY_RECOVERY, resolveProvider } from "@/lib/ai/provider";
import { ProviderError } from "@/lib/ai/types";
import { ApiError, handle, ok, readJson, requireScope, type Recovery } from "@/lib/api";
import { validateGraph } from "@/lib/engine/validate";
import { editWorkflow } from "@/lib/generate/edit";
import { generationLogFields } from "@/lib/generate/generate";
import { copilotRequestSchema } from "@/lib/generate/schema";
import { logInfo, logWarn } from "@/lib/logging";
import { diffGraphs } from "@/lib/workflow/diff";
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
 * `POST /api/workflows/:id/copilot` — **propose an edit**, `CONTRACT.md` → *Copilot
 * request/response* (Phase 35).
 *
 * The workflow on the canvas and a change in plain language go in; a **proposed** graph comes out,
 * validated exactly as a generated one is (`lib/generate/edit.ts`). **It writes nothing** — not
 * the workflow, not a version, not the conversation. A proposal reaches the canvas as a diff, and
 * only a person pressing Accept puts it there; even then it is unsaved until they save. That is
 * the security boundary, and `SECURITY.md` states it.
 *
 * `editor`, because what it is for is changing a workflow: a viewer is refused with the role named,
 * before a model is called. The path's workflow must be one this person can see — another
 * workspace's, or a colleague's private one, is 404 (D20, D101) — but the graph edited is the one
 * the request carries, because that is what is on the person's screen, saved or not.
 */
export async function POST(request: Request, { params }: Context) {
  return handle(async () => {
    const scope = await requireScope("editor");
    const { id } = await params;
    const body = await readJson(request, copilotRequestSchema);
    const workflow = await getWorkflow(scope, id);

    const provider = await resolveProviderOr400(scope);

    let result;
    const started = Date.now();
    try {
      result = await editWorkflow({
        model: provider.model,
        modelId: provider.selectedModel,
        instruction: body.instruction,
        subject: { name: workflow.name, description: workflow.description, graph: body.graph },
        earlier: body.earlier,
      });
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

    // The same event generation logs, with `mode` (D165): one quality metric, two kinds of ask.
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
        changes: diffGraphs(body.graph, result.graph).summary,
        /** Problems the proposal still has — only ever ones the graph sent already had (D162). */
        problems: validateGraph(result.graph).problems,
      },
      generation: {
        model: result.model,
        source: provider.source,
        usage: result.usage,
        attempts: result.attempts,
      },
    });
  });
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
