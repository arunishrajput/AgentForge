import { handle, ok, requireScope } from "@/lib/api";
import { listCallable } from "@/lib/workflow/agent-tool";

export const dynamic = "force-dynamic";

/**
 * The workflows a node's picker may offer — **Phase 39**. Id, name and the agent-tool marking, never
 * a graph: the Call workflow node and an agent's tool list ask for it when a node is opened, and a
 * list that carried every graph would cost a workspace's worth of JSON for a dropdown. Visibility
 * applies (D101); `?exclude=<id>` leaves out the workflow being edited. Any role — a viewer reads the
 * pickers too.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const scope = await requireScope();
    const exclude = new URL(request.url).searchParams.get("exclude") ?? undefined;
    return ok(await listCallable(scope, exclude || undefined));
  });
}
