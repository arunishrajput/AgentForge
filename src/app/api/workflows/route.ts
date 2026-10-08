import { handle, ok, readJson, requireScope } from "@/lib/api";
import {
  createWorkflow,
  createWorkflowSchema,
  describeListedWorkflow,
  describeWorkflow,
  listWorkflows,
} from "@/lib/workflow/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const scope = await requireScope();
    const workflows = await listWorkflows(scope);
    // Phase 32: each listed workflow carries its tags and the asker's star.
    return ok(workflows.map(describeListedWorkflow));
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const scope = await requireScope("editor");
    const body = await readJson(request, createWorkflowSchema);
    const workflow = await createWorkflow(scope, body);
    return ok(describeWorkflow(workflow), 201);
  });
}
