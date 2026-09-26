import { z } from "zod";

import { ApiError, handle, ok, readJson, requireOwnerId } from "@/lib/api";
import { IntegrationError } from "@/lib/integrations/net";
import {
  clearDiscordWebhook,
  discordStatus,
  storeDiscordWebhook,
} from "@/lib/integrations/store";

export const dynamic = "force-dynamic";

/**
 * The Discord webhook credential. **Write-only over the wire** — the stored URL is a
 * bearer secret (anyone holding it can post to the channel), so no method here
 * returns it, or any part of it. `configured` plus the channel's name is the whole
 * answer to "is one connected", exactly as `configured` is for the provider key.
 */
const bodySchema = z.object({
  webhookUrl: z.string().trim().min(1).max(500),
});

export async function GET() {
  return handle(async () => {
    const ownerId = await requireOwnerId();
    return ok(await discordStatus(ownerId));
  });
}

export async function PUT(request: Request) {
  return handle(async () => {
    const ownerId = await requireOwnerId();
    const body = await readJson(request, bodySchema);
    try {
      return ok(await storeDiscordWebhook(ownerId, body.webhookUrl));
    } catch (error) {
      throw asApiError(error);
    }
  });
}

export async function DELETE() {
  return handle(async () => {
    const ownerId = await requireOwnerId();
    return ok(await clearDiscordWebhook(ownerId));
  });
}

/**
 * Discord's own words reach the user — "Unknown Webhook" tells them the webhook was
 * deleted, which is what they need to act on. The URL is never echoed back.
 */
function asApiError(error: unknown): ApiError {
  if (error instanceof IntegrationError) {
    return new ApiError("invalid_request", error.message);
  }
  return new ApiError("internal", "Could not reach Discord.");
}
