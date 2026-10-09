import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { accessTokens, workspaceMembers } from "@/db/schema";
import { ApiError } from "@/lib/api-error";
import { logWarn } from "@/lib/logging";
import { isWorkspaceRole, type WorkspaceRole } from "@/lib/workspace/roles";
import type { WorkspaceScope } from "@/lib/workspace/scope";

import {
  createUseTracker,
  effectiveRole,
  hashAccessToken,
  LAST_USED_INTERVAL_MS,
  MAX_LIVE_TOKENS,
  mayMint,
  mintAccessToken,
  tokenHint,
  tokenState,
  type TokenRole,
  type TokenState,
} from "./token";

/**
 * Personal access tokens against the database — Phase 41, D192. The rules are in `./token.ts`.
 */

export interface TokenSummary {
  id: string;
  name: string;
  /** The ceiling it was given. What it can do right now is lower if its creator was demoted. */
  role: WorkspaceRole;
  hint: string;
  state: TokenState;
  expiresAt: string;
  lastUsedAt: string | null;
  createdAt: string;
}

type Row = typeof accessTokens.$inferSelect;

export function describeToken(row: Row, now: number = Date.now()): TokenSummary {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    hint: row.hint,
    state: tokenState(row, now),
    expiresAt: row.expiresAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** One person's tokens in one workspace, newest first. Everyone sees only their own. */
export async function listTokens(scope: WorkspaceScope): Promise<TokenSummary[]> {
  const rows = await db()
    .select()
    .from(accessTokens)
    .where(and(eq(accessTokens.workspaceId, scope.workspaceId), eq(accessTokens.userId, scope.userId)))
    .orderBy(desc(accessTokens.createdAt));
  const now = Date.now();
  return rows.map((row) => describeToken(row, now));
}

/**
 * Mints a token and stores its hash. **The plaintext is returned here and nowhere else, ever.**
 *
 * Refused: a ceiling above the creator's own role (403, the same message every role refusal
 * carries), and a twenty-first live token (409). The count is read, then the row written — a race
 * can overshoot by a request or two, which the cap's purpose (a tidy list) tolerates.
 */
export async function createToken(
  scope: WorkspaceScope,
  input: { name: string; role: TokenRole; expiresInDays: number },
): Promise<{ token: string; summary: TokenSummary }> {
  if (!mayMint(scope.role, input.role)) {
    throw new ApiError("forbidden", `A token cannot hold a role above your own (${scope.role}).`);
  }

  const [{ live }] = await db()
    .select({ live: sql<number>`count(*)::int` })
    .from(accessTokens)
    .where(
      and(
        eq(accessTokens.workspaceId, scope.workspaceId),
        eq(accessTokens.userId, scope.userId),
        isNull(accessTokens.revokedAt),
        sql`${accessTokens.expiresAt} > now()`,
      ),
    );
  if (live >= MAX_LIVE_TOKENS) {
    throw new ApiError("conflict", `You already hold ${MAX_LIVE_TOKENS} live tokens here. Revoke one first.`);
  }

  const token = mintAccessToken();
  const [row] = await db()
    .insert(accessTokens)
    .values({
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      name: input.name,
      role: input.role,
      tokenHash: hashAccessToken(token),
      hint: tokenHint(token),
      expiresAt: new Date(Date.now() + input.expiresInDays * 86_400_000),
    })
    .returning();
  return { token, summary: describeToken(row) };
}

/**
 * Revokes one of the caller's own tokens. Another person's, another workspace's and a missing id
 * all answer 404 (D20). Idempotent: revoking a revoked token keeps its first revocation time.
 */
export async function revokeToken(scope: WorkspaceScope, id: string): Promise<TokenSummary> {
  const [row] = await db()
    .update(accessTokens)
    .set({ revokedAt: sql`coalesce(${accessTokens.revokedAt}, now())` })
    .where(
      and(
        eq(accessTokens.id, id),
        eq(accessTokens.workspaceId, scope.workspaceId),
        eq(accessTokens.userId, scope.userId),
      ),
    )
    .returning();
  if (!row) throw new ApiError("not_found", "No such token.");
  return describeToken(row);
}

export type TokenAuth =
  | { ok: true; scope: WorkspaceScope; tokenId: string }
  | { ok: false; reason: "unknown" | "expired" | "revoked" | "member_gone" };

const uses = createUseTracker();

/**
 * **Turns a token into a scope, or says why not.** One statement: the token's row joined to its
 * creator's membership in the token's workspace, so the role it carries is the one held *now*
 * (`effectiveRole`) and a removed member's token fails here without anyone having to revoke it.
 *
 * Then `lastUsedAt`, at most once per interval: skipped outright while this instance has written it
 * recently, and the `update … where` repeats the interval in SQL for the sake of the other
 * instances. A failure to write it is logged and swallowed — a timestamp is not a reason to refuse
 * a request.
 */
export async function authenticateToken(token: string): Promise<TokenAuth> {
  const [row] = await db()
    .select({ token: accessTokens, held: workspaceMembers.role })
    .from(accessTokens)
    .leftJoin(
      workspaceMembers,
      and(eq(workspaceMembers.workspaceId, accessTokens.workspaceId), eq(workspaceMembers.userId, accessTokens.userId)),
    )
    .where(eq(accessTokens.tokenHash, hashAccessToken(token)))
    .limit(1);
  if (!row) return { ok: false, reason: "unknown" };

  const state = tokenState(row.token);
  if (state !== "live") return { ok: false, reason: state };

  const held: WorkspaceRole | null = row.held && isWorkspaceRole(row.held) ? row.held : row.held ? "viewer" : null;
  const role = effectiveRole(row.token.role, held);
  if (!role) return { ok: false, reason: "member_gone" };

  if (uses.due(row.token.id)) {
    try {
      await db()
        .update(accessTokens)
        .set({ lastUsedAt: sql`now()` })
        .where(
          and(
            eq(accessTokens.id, row.token.id),
            sql`(${accessTokens.lastUsedAt} is null or ${accessTokens.lastUsedAt} < now() - make_interval(secs => ${LAST_USED_INTERVAL_MS / 1000}))`,
          ),
        );
    } catch (error) {
      logWarn("system.warning", "Could not record a token's last use.", { error: String(error) });
    }
  }

  return {
    ok: true,
    tokenId: row.token.id,
    scope: { workspaceId: row.token.workspaceId, userId: row.token.userId, role },
  };
}
