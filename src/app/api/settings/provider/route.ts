import { handle, ok, readJson, requireOwnerId } from "@/lib/api";
import {
  clearSettings,
  providerSettingsSchema,
  readSettings,
  writeSettings,
} from "@/lib/ai/settings";

export const dynamic = "force-dynamic";

/**
 * Provider settings. **Write-only over the wire**: no response from any method here
 * contains the stored key, or any part of it.
 */
export async function GET() {
  return handle(async () => {
    const ownerId = await requireOwnerId();
    return ok(await readSettings(ownerId));
  });
}

export async function PUT(request: Request) {
  return handle(async () => {
    const ownerId = await requireOwnerId();
    const body = await readJson(request, providerSettingsSchema);
    return ok(await writeSettings(ownerId, body));
  });
}

export async function DELETE() {
  return handle(async () => {
    const ownerId = await requireOwnerId();
    return ok(await clearSettings(ownerId));
  });
}
