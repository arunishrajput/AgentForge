import { eq } from "drizzle-orm";

import { db } from "@/db";
import { workflows } from "@/db/schema";
import { ApiError, fail, handle, ok } from "@/lib/api";
import { startRun } from "@/lib/engine/run";
import { logInfo } from "@/lib/logging";
import { clientAddress, createRateLimiter } from "@/lib/ratelimit";
import {
  checkSubmission,
  FORM_LIMIT_PER_ADDRESS,
  FORM_LIMIT_PER_FORM,
  FORM_LIMIT_WINDOW_MS,
  formTriggerNode,
  HONEYPOT_FIELD,
  MAX_FORM_BODY_BYTES,
  readFormConfig,
} from "@/lib/triggers/form";
import { answerFromSteps, responseFor } from "@/lib/triggers/respond";
import { WEBHOOK_TOKEN_PATTERN } from "@/lib/triggers/webhook";
import { systemScope } from "@/lib/workspace/scope";

export const dynamic = "force-dynamic";

/**
 * The form receiver — Phase 40, and the fifth route that answers with no session (`SECURITY.md` →
 * *The unauthenticated surfaces*, D189). `POST` only: the page at `/f/<token>` is what a person
 * opens, and nothing a link preview or a crawler can GET starts anything.
 *
 * Its guards, in the order they act, each cheaper than the one after:
 *
 *   1. the token's **shape**, before anything is looked up — a scan costs no query
 *   2. a **rate limit** per form and per address, in memory and per instance (`lib/ratelimit.ts`)
 *   3. a **size cap**, from the declared length first and the real text second
 *   4. one indexed select, then the **active switch** — 409 for a form switched off
 *   5. the **honeypot** — answered exactly like success, and starts nothing
 *   6. **server-side validation** against the declared fields (`triggers/form.ts`), a message per field
 *
 * Only then does a run exist. A submission that fails any guard writes nothing to the database.
 *
 * The run is waited for, like a webhook's: the visitor is told whether it worked, and a `core.respond`
 * step may say what to tell them. Nothing of the run itself — its steps, its output, its error — is
 * ever returned: a stranger is told the author's `failureMessage` and no more.
 */
type Context = { params: Promise<{ token: string }> };

const perForm = createRateLimiter({ limit: FORM_LIMIT_PER_FORM, windowMs: FORM_LIMIT_WINDOW_MS });
const perAddress = createRateLimiter({ limit: FORM_LIMIT_PER_ADDRESS, windowMs: FORM_LIMIT_WINDOW_MS });

function limited(retryAfterSeconds: number): Response {
  const response = fail("rate_limited", "Too many submissions just now. Please wait a little and try again.");
  response.headers.set("retry-after", String(retryAfterSeconds));
  return response;
}

export async function POST(request: Request, { params }: Context) {
  return handle(async () => {
    const { token } = await params;

    if (!WEBHOOK_TOKEN_PATTERN.test(token)) {
      throw new ApiError("not_found", "No form is registered at this address.");
    }

    // The address first: a caller already over its own limit should not also spend the form's.
    const address = perAddress.take(`${token}:${clientAddress(request)}`);
    const form = address.allowed ? perForm.take(token) : null;
    if (!address.allowed || !form?.allowed) {
      logInfo("form.submitted", "A form submission was refused by the rate limit.", { outcome: "limited" });
      return limited(address.allowed ? form!.retryAfterSeconds : address.retryAfterSeconds);
    }

    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_FORM_BODY_BYTES) {
      return fail("invalid_request", `The submission is larger than the ${MAX_FORM_BODY_BYTES / 1024} KB limit.`);
    }

    const [workflow] = await db().select().from(workflows).where(eq(workflows.webhookToken, token)).limit(1);
    const node = workflow ? formTriggerNode(workflow.graph) : undefined;
    const config = node ? readFormConfig(node) : null;
    // A wrong token, a workflow with no form, and a form that cannot be read all answer alike.
    if (!workflow || !node || !config) {
      throw new ApiError("not_found", "No form is registered at this address.");
    }

    if (!workflow.active) {
      logInfo("form.submitted", "A submission reached a form that is switched off.", {
        outcome: "off",
        workflowId: workflow.id,
      });
      return fail("conflict", "This form is not accepting responses right now.");
    }

    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_FORM_BODY_BYTES) {
      return fail("invalid_request", `The submission is larger than the ${MAX_FORM_BODY_BYTES / 1024} KB limit.`);
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return fail("invalid_request", "The submission must be JSON.");
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return fail("invalid_request", "The submission must be a JSON object.");
    }
    const answers = body as Record<string, unknown>;

    // A filled trap is a script. It is told the submission worked, and nothing starts.
    const trap = answers[HONEYPOT_FIELD];
    if (typeof trap === "string" ? trap.trim() !== "" : trap !== undefined && trap !== null && trap !== false) {
      logInfo("form.submitted", "A submission filled the honeypot and was dropped.", {
        outcome: "honeypot",
        workflowId: workflow.id,
      });
      return ok({ accepted: true, message: config.successMessage });
    }

    const checked = checkSubmission(config.fields, answers);
    if (!checked.ok) {
      logInfo("form.submitted", "A submission was refused by validation.", {
        outcome: "invalid",
        workflowId: workflow.id,
      });
      return fail("invalid_request", "Some answers need another look.", { fields: checked.errors });
    }

    let started;
    try {
      started = await startRun({
        // From the workflow the token resolved to — never from the request (the webhook's rule).
        scope: systemScope(workflow),
        workflow,
        trigger: "form",
        input: checked.values,
        // No `signal`: a visitor who closes the tab has not cancelled the workflow.
      });
    } catch (error) {
      // A graph that cannot run says why in its problem list, which is the author's to read and not a
      // stranger's. Anything else is the ordinary mapper's.
      if (error instanceof ApiError && error.code === "invalid_graph") {
        logInfo("form.submitted", "A submission reached a workflow that cannot run.", {
          outcome: "unrunnable",
          workflowId: workflow.id,
        });
        return fail("internal", config.failureMessage);
      }
      throw error;
    }

    const { run, steps } = started;
    logInfo("form.submitted", "A form was submitted.", {
      outcome: "accepted",
      workflowId: workflow.id,
      runId: run.id,
      status: run.status,
    });

    // The workflow's own answer, when it gave one (`core.respond`), whatever else happened after.
    const answer = answerFromSteps(steps);
    if (answer) return responseFor(answer);

    // `waiting` is a run put down for a person or a timer: received, and not finished. Not a failure.
    if (run.status === "failed" || run.status === "cancelled") return fail("internal", config.failureMessage);
    return ok({ accepted: true, message: config.successMessage });
  });
}
