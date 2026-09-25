import { handle, ok, readJson, requireOwnerId } from "@/lib/api";
import {
  createWorkflow,
  createWorkflowSchema,
  describeWorkflow,
  listWorkflows,
} from "@/lib/workflow/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const ownerId = await requireOwnerId();
    const workflows = await listWorkflows(ownerId);
    return ok(workflows.map(describeWorkflow));
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const ownerId = await requireOwnerId();
    const body = await readJson(request, createWorkflowSchema);
    const workflow = await createWorkflow(ownerId, body);
    return ok(describeWorkflow(workflow), 201);
  });
}
