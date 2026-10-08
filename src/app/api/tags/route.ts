import { handle, ok, readJson, requireScope } from "@/lib/api";
import { createTag, createTagSchema, listTags } from "@/lib/workflow/library";

export const dynamic = "force-dynamic";

/**
 * A workspace's tags — Phase 32. Every member may read them, because the list filters by them;
 * creating one is `editor`, because a tag is part of how the workspace is organised.
 */
export async function GET() {
  return handle(async () => {
    const scope = await requireScope();
    return ok(await listTags(scope));
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const scope = await requireScope("editor");
    const { name } = await readJson(request, createTagSchema);
    return ok(await createTag(scope, name), 201);
  });
}
