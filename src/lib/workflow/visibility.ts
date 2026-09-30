import { randomBytes } from "node:crypto";
import { eq, or, type SQL } from "drizzle-orm";
import { z } from "zod";

import { workflows } from "@/db/schema";
import { atLeast, type WorkspaceRole } from "@/lib/workspace/roles";
import type { WorkspaceScope } from "@/lib/workspace/scope";

/**
 * **Per-workflow sharing inside a workspace — Phase 20.**
 *
 * Phase 19A made the workspace the tenant, and every member of one sees everything in
 * it. That is the right default and it is the wrong *only* option: a half-built workflow
 * is not something you want your colleagues reading as a finished statement of intent,
 * and a workspace is a place people work rather than a place they publish.
 *
 * So a workflow has one of two visibilities, and the default is the behaviour that
 * already existed — which is what makes the migration a no-op for every row in the
 * database today.
 *
 *   `workspace`  every member of the workspace can see it. The default, and what every
 *                pre-Phase-20 workflow is backfilled to by the column's own default
 *   `private`    its creator can see it, and so can the workspace's admins and owners
 *
 * **Why admins see private workflows, which looks like a hole and is a decision.** A
 * private workflow still runs with the *workspace's* credentials: it can send mail from
 * the workspace's Gmail connection and post to its Discord channel. An admin who cannot
 * see it cannot account for what those credentials are being used for, and "you may hide
 * what you do with the team's secrets from the person responsible for them" is not a
 * property worth having. `private` means *not yet shared with my colleagues*; it has
 * never meant *hidden from the workspace itself*, and the UI says so in those words.
 *
 * **An invisible workflow answers 404, not 403** — D20's rule, applied one level in.
 * Another workspace's workflow is 404 because 403 would confirm the id exists; a
 * colleague's private workflow is 404 for exactly the same reason, and the fact that it
 * exists is the thing `private` is hiding.
 */

export const WORKFLOW_VISIBILITIES = ["workspace", "private"] as const;

export type WorkflowVisibility = (typeof WORKFLOW_VISIBILITIES)[number];

export const workflowVisibilitySchema = z.enum(WORKFLOW_VISIBILITIES);

export function isWorkflowVisibility(value: unknown): value is WorkflowVisibility {
  return typeof value === "string" && (WORKFLOW_VISIBILITIES as readonly string[]).includes(value);
}

/**
 * The decision itself, as a pure function over the two rows involved — so it can be
 * asserted without a database, and so the SQL below and anything that has already loaded
 * a row cannot answer it differently.
 *
 * It says nothing about the workspace boundary. That is deliberate: `workspaceId` is
 * filtered in the same `where` by every caller, and folding the two together here would
 * make a function that returns `true` for a row from another tenant if you forgot to
 * pass the tenant. Two filters, each doing one thing.
 */
export function canSeeWorkflow(
  viewer: { role: WorkspaceRole; userId: string },
  workflow: { visibility: string; ownerId: string },
): boolean {
  if (workflow.visibility !== "private") return true;
  return workflow.ownerId === viewer.userId || atLeast(viewer.role, "admin");
}

/**
 * The same decision as a `where` fragment, for the queries that must not read the row
 * first — the list, and the two run queries that reach a workflow only by join.
 *
 * **`undefined` for an admin is not a shortcut, it is how `and()` composes.** Drizzle
 * drops `undefined` operands, so a caller writes `and(eq(workspaceId, …), visible(scope))`
 * once and gets the unfiltered query for a privileged reader and the filtered one for
 * everybody else, with no branch at the call site to get wrong.
 */
export function visibleWorkflows(scope: WorkspaceScope): SQL | undefined {
  if (atLeast(scope.role, "admin")) return undefined;
  return or(eq(workflows.visibility, "workspace"), eq(workflows.ownerId, scope.userId));
}

/**
 * Who may change a workflow's visibility: **its creator, or an admin.**
 *
 * Not "any editor", although an editor may change everything else about it. Visibility
 * is the one property that is about the *author's* relationship to their colleagues
 * rather than about what the workflow does, and an editor flipping a colleague's
 * workflow to `private` would hide it from the people it was shared with — a
 * destructive act dressed as an edit. An admin may, because an admin is who you ask
 * when the author has left.
 *
 * The other direction needs no rule: an editor cannot reveal somebody's private
 * workflow because they cannot see it, so the request they would make is already a 404.
 */
export function mayChangeVisibility(input: {
  actorRole: WorkspaceRole;
  actorUserId: string;
  workflowOwnerId: string;
}): boolean {
  return input.actorUserId === input.workflowOwnerId || atLeast(input.actorRole, "admin");
}

/**
 * The public share link's token.
 *
 * 24 bytes of CSPRNG, base64url — the same 192 bits as the webhook token
 * (`lib/triggers/webhook.ts`), and for the same reason: this is a third
 * unauthenticated surface and the token is the whole of its access control. It is
 * **not** as wide as an invitation's 256 bits, because what it grants is narrower than
 * either of the others — a read of one redacted graph, no write and no workspace.
 *
 * Unlike an invitation's, it is stored in plaintext: the URL has to be displayable
 * again for as long as the link is live, exactly as the webhook URL is. Revoking it is
 * therefore the only way to make it stop working, which is why `DELETE` exists and why
 * the panel calls it "Stop sharing" rather than "Hide".
 */
export function mintShareToken(): string {
  return randomBytes(24).toString("base64url");
}

/** What a token must look like before the database is asked about it. */
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export function shareUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, "")}/s/${token}`;
}
