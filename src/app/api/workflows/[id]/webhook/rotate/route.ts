import { handle, ok, requireScope } from "@/lib/api";
import { describeWorkflow, rotateWebhookToken } from "@/lib/workflow/store";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * Rotate this workflow's webhook URL — **Phase 21**.
 *
 * `admin`, and the reasoning is `rotateWebhookToken`'s. The response is the whole workflow
 * projection, whose `webhookUrl` is now the new one: a response carrying only the token would
 * make the client build the URL, and `APP_BASE_URL` is the one place the public origin is
 * decided (D53).
 *
 * **The old URL answers 404 from the moment this returns.** The deployed verification asserts
 * exactly that, because "the new one works" is the half of this that would pass on its own
 * while the interesting half quietly did not.
 */
export async function POST(_request: Request, { params }: Context) {
  return handle(async () => {
    const { id } = await params;
    const scope = await requireScope("admin");
    const { workflow } = await rotateWebhookToken(scope, id);
    return ok(describeWorkflow(workflow));
  });
}
