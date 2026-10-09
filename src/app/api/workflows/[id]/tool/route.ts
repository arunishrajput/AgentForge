import { handle, ok, readJson, requireScope } from "@/lib/api";
import { clearAgentTool, setAgentTool } from "@/lib/workflow/agent-tool";
import { describeWorkflow } from "@/lib/workflow/store";
import { workflowAgentToolSchema } from "@/lib/workflow/tool";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * Let agents call this workflow — **Phase 39** (D186). `editor`.
 *
 * The body is the tool as a model will see it: a name, a description and the inputs it takes.
 * Marking is half of the opt-in: an agent node still has to list the workflow by id, so this alone
 * hands it to no agent. Idempotent — the same body twice is the same marking — and answers the whole
 * workflow projection, whose `agentTool` is now the stored one.
 *
 * `409` when another workflow in the workspace already uses the name.
 */
export async function PUT(request: Request, { params }: Context) {
  return handle(async () => {
    const { id } = await params;
    const scope = await requireScope("editor");
    const tool = await readJson(request, workflowAgentToolSchema);
    return ok(describeWorkflow(await setAgentTool(scope, id, tool)));
  });
}

/** Stop offering it. Agents that list it find it unavailable (and say so in their log); nothing else changes. */
export async function DELETE(_request: Request, { params }: Context) {
  return handle(async () => {
    const { id } = await params;
    const scope = await requireScope("editor");
    return ok(describeWorkflow(await clearAgentTool(scope, id)));
  });
}
