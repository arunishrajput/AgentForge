import { eq } from "drizzle-orm";

import { db } from "@/db";
import { workflows } from "@/db/schema";
import { ApiError, fail, handle, ok } from "@/lib/api";
import { describeRun, startRun } from "@/lib/engine/run";
import {
  readWebhookPayload,
  WEBHOOK_TOKEN_PATTERN,
  webhookRequiredFields,
  webhookTriggerNode,
} from "@/lib/triggers/webhook";

export const dynamic = "force-dynamic";

/**
 * The webhook receiver — CONTRACT.md → "Trigger shapes".
 *
 * **The one route with no session.** It cannot have one: the caller is another
 * system, and there is no user at the keyboard. The token in the path is therefore
 * the entire access control, which is why it is 192 bits of CSPRNG on the workflow
 * row and never anything derived from a workflow id.
 *
 * Two consequences this route is built around:
 *
 *  - The lookup is by token alone, the only query in the codebase not scoped by
 *    `ownerId`. The owner comes *out* of the row and is what the run is attributed
 *    to, so a webhook cannot run a workflow on anyone else's behalf.
 *  - The payload is validated before a run row exists. A malformed call costs one
 *    indexed select and no writes — this endpoint can spend a user's model quota,
 *    so cheap rejection is a cost property, not tidiness.
 *
 * The response waits for the run: execution is in-process (ARCHITECTURE.md → "Queue
 * — deliberately none") and the same synchronous shape as `POST /runs`. A browser
 * watching this run does not need the response, because it follows the workflow, not
 * a run id it could not have known (D28).
 */
type Context = { params: Promise<{ token: string }> };

export async function POST(request: Request, { params }: Context) {
  return handle(async () => {
    const { token } = await params;

    // Shape-checked before the database is touched, so a scan cannot turn this into
    // a stream of queries. Every answer below is the same 404 either way.
    if (!WEBHOOK_TOKEN_PATTERN.test(token)) {
      throw new ApiError("not_found", "No webhook is registered at this URL.");
    }

    const [workflow] = await db()
      .select()
      .from(workflows)
      .where(eq(workflows.webhookToken, token))
      .limit(1);

    // A wrong token and a workflow whose graph has no webhook trigger answer alike:
    // whoever holds the token learns nothing from the difference, and the owner has
    // the canvas to tell them the trigger is missing.
    if (!workflow || !webhookTriggerNode(workflow.graph)) {
      throw new ApiError("not_found", "No webhook is registered at this URL.");
    }

    const triggerNode = webhookTriggerNode(workflow.graph)!;
    const payload = readWebhookPayload(
      await request.text(),
      webhookRequiredFields(triggerNode),
    );

    if (!payload.ok) {
      return fail(
        "invalid_request",
        payload.message,
        payload.missing ? { missing: payload.missing } : undefined,
      );
    }

    const { run, steps } = await startRun({
      ownerId: workflow.ownerId,
      workflow,
      trigger: "webhook",
      input: payload.body,
      signal: request.signal,
    });

    return ok(describeRun(run, steps), 201);
  });
}
