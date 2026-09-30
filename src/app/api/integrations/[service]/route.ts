import { z } from "zod";

import { ApiError, handle, ok, readJson, requireScope } from "@/lib/api";
import { integrationApiError } from "@/lib/integrations/errors";
import {
  clearTokenSecret,
  storeTokenSecret,
  tokenIntegrationStatus,
} from "@/lib/integrations/store";
import { tokenIntegrationBySlug } from "@/lib/integrations/tokens";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ service: string }> };

/**
 * The token integrations' credential route — **one file for all four, Phase 23B.**
 *
 * `/api/integrations/slack`, `/notion`, `/github`, `/airtable`. Discord and Google keep their
 * own files beside this one: a static segment takes precedence over a dynamic one, so
 * `/api/integrations/discord` still reaches `discord/route.ts` and this route never sees it.
 * **That precedence is asserted over HTTP by `verify-integrations.mjs`** rather than taken on
 * trust — it is documented for the Pages router and merely conventional for the App one, which
 * is exactly the sort of thing to check against the deployed service instead of believing.
 *
 * **Write-only over the wire**, the rule every credential surface in this product follows: no
 * method here returns a stored secret or any part of one. `configured` plus `detail` — the
 * Notion workspace, the GitHub login — is the whole answer to "is one connected, and whose".
 *
 * The role bar matches Discord's and Google's: reading status is `viewer`, because a viewer who
 * cannot see whether a credential exists cannot understand a failed run; changing one is
 * `admin`, because every member of the workspace can then act through it.
 */
const bodySchema = z.object({
  secret: z.string().trim().min(1).max(4000),
});

/** A slug that is not in the registry is a 404, not a 400: it names nothing that exists. */
async function integrationFor(params: Context["params"]) {
  const { service } = await params;
  const integration = tokenIntegrationBySlug(decodeURIComponent(service));
  if (!integration) {
    throw new ApiError("not_found", "This product does not store a credential for that service.");
  }
  return integration;
}

export async function GET(_request: Request, { params }: Context) {
  return handle(async () => {
    const integration = await integrationFor(params);
    const scope = await requireScope();
    return ok(await tokenIntegrationStatus(scope, integration));
  });
}

export async function PUT(request: Request, { params }: Context) {
  return handle(async () => {
    const integration = await integrationFor(params);
    const scope = await requireScope("admin");
    const body = await readJson(request, bodySchema);
    try {
      return ok(await storeTokenSecret(scope, integration, body.secret));
    } catch (error) {
      // Scoped to the one call that can fail this way. Phase 21's lesson (D109): a route that
      // wraps its whole body in an error mapper turns every deliberate refusal underneath it
      // — the 404 above, the 403 from `requireScope` — into one indistinguishable 500.
      throw integrationApiError(integration.service, error);
    }
  });
}

export async function DELETE(_request: Request, { params }: Context) {
  return handle(async () => {
    const integration = await integrationFor(params);
    const scope = await requireScope("admin");
    return ok(await clearTokenSecret(scope, integration));
  });
}
