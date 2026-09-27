import { handle, ok, readJson, requireUserId } from "@/lib/api";
import { setActiveWorkspace } from "@/lib/workspace/active";
import {
  createWorkspace,
  createWorkspaceSchema,
  describeWorkspace,
  listMemberships,
} from "@/lib/workspace/store";

export const dynamic = "force-dynamic";

/**
 * Every workspace this account is in — what the switcher lists, oldest first.
 *
 * **`requireUserId` and not `requireScope`, deliberately.** This is the one authenticated
 * route whose subject is the *person* rather than a workspace: asking it to resolve an
 * active workspace first would mean the list of workspaces depended on which one you were
 * currently in, which is backwards.
 */
export async function GET() {
  return handle(async () => {
    const userId = await requireUserId();
    const memberships = await listMemberships(userId);
    return ok(memberships.map((membership) => describeWorkspace(membership, userId)));
  });
}

/**
 * A new, shared workspace. The creator is its owner.
 *
 * **It also switches to it**, by setting the active-workspace cookie on this response —
 * which a route handler may do and a server component may not
 * (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`).
 * Creating a workspace and then not being in it would be a strange thing to ship, and
 * the alternative is a second round trip that can fail on its own.
 *
 * Any signed-in account may create one. There is nothing to authorise against — the
 * workspace does not exist yet, and its first member is whoever made it.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const userId = await requireUserId();
    const body = await readJson(request, createWorkspaceSchema);
    const membership = await createWorkspace(userId, body);
    await setActiveWorkspace(membership.workspace.id);
    return ok(describeWorkspace(membership, userId), 201);
  });
}
