import { handle, ok, requireScopeFor } from "@/lib/api";
import { describeMember, listMembers } from "@/lib/workspace/store";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * Who is in this workspace. Readable by every member — see `listMembers` for why that is
 * the right default rather than an oversight.
 */
export async function GET(_request: Request, { params }: Context) {
  return handle(async () => {
    const { id } = await params;
    const scope = await requireScopeFor(id);
    const members = await listMembers(scope);
    return ok(members.map((member) => describeMember(member, scope.userId)));
  });
}
