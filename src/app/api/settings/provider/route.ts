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
    const scope = await requireScope("admin");
    const body = await readJson(request, providerSettingsSchema);
    return ok(await writeSettings(scope, body));
  });
}

/**
 * Delete one provider's key. **`?provider=` names which** — Phase 23D. Without it, the
 * active one, which is what the single-provider version always did.
 *
 * The workspace's *choice* of provider is deliberately not cleared: see `clearSettings`.
 */
export async function DELETE(request: Request) {
  return handle(async () => {
    const scope = await requireScope("admin");
    const provider = new URL(request.url).searchParams.get("provider");
    return ok(await clearSettings(scope, provider ?? undefined));
  });
}
