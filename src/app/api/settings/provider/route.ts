import { handle, ok, readJson, requireScope } from "@/lib/api";
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
    const scope = await requireScope();
    return ok(await readSettings(scope));
  });
}

export async function PUT(request: Request) {
  return handle(async () => {
    const scope = await requireScope();
    const body = await readJson(request, providerSettingsSchema);
    return ok(await writeSettings(scope, body));
  });
}

export async function DELETE() {
  return handle(async () => {
    const scope = await requireScope();
    return ok(await clearSettings(scope));
  });
}
