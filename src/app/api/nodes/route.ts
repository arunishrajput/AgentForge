import { describeNodes } from "@/lib/nodes";
import { handle, ok, requireOwnerId } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * The registry, projected for the canvas palette. Phase 4 builds the palette from
 * this; Phase 6 derives the agent's tool set from the same registry in-process.
 */
export async function GET() {
  return handle(async () => {
    await requireOwnerId();
    return ok(describeNodes());
  });
}
