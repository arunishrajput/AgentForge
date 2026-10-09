import { createHash, randomBytes } from "node:crypto";

import { z } from "zod";

import { atLeast, type WorkspaceRole } from "@/lib/workspace/roles";

/**
 * Personal access tokens, and every rule about one that needs no database — Phase 41, D192.
 *
 * A token is what a script presents as `Authorization: Bearer` where a person's browser presents a
 * cookie. It is a credential in the plainest sense, so it is treated like the invitation link
 * (D95) and not like the webhook token (D41): 256 bits of CSPRNG, **only a hash stored**, shown to
 * the person once. And it carries a **role ceiling that is re-checked on every request** against
 * what its creator holds in that workspace now (`effectiveRole`) — a token is never a way to keep
 * a power its creator has lost.
 *
 * Nothing in this file touches the database or a request, which is what makes the rules testable
 * clause by clause (D18). `./store.ts` holds the queries and `lib/api.ts` the one funnel.
 */

/** A recognisable prefix, so a leaked token is found by a secret scanner or a `grep`. */
export const TOKEN_PREFIX = "afp_";

/** `afp_` and 32 bytes as base64url — 43 characters. */
export const ACCESS_TOKEN_PATTERN = /^afp_[A-Za-z0-9_-]{43}$/;

export function mintAccessToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** Plain SHA-256: the secret is 256 bits of entropy, so there is nothing for a slow hash to slow down. */
export function hashAccessToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** What a list shows to tell tokens apart: `afp_` and four more characters. */
export function tokenHint(token: string): string {
  return token.slice(0, TOKEN_PREFIX.length + 4);
}

/**
 * The roles a token may be given. **Never `admin` or `owner`**: the routes that accept a token need
 * `editor` at most (`lib/api.ts` → `requireApiScope`), so a higher ceiling would be power with no
 * use — and one more thing to lose if a token leaks.
 */
export const TOKEN_ROLES = ["viewer", "editor"] as const satisfies readonly WorkspaceRole[];
export type TokenRole = (typeof TOKEN_ROLES)[number];

/** A token must expire (the phase's rule), and not in the far future. */
export const MAX_EXPIRY_DAYS = 365;
export const DEFAULT_EXPIRY_DAYS = 30;

/** Live tokens one person may hold in one workspace — the list stays a list, and a loop cannot fill the table. */
export const MAX_LIVE_TOKENS = 20;

export const createTokenSchema = z.object({
  name: z.string().trim().min(1, "Give the token a name.").max(60),
  role: z.enum(TOKEN_ROLES),
  expiresInDays: z.number().int().min(1).max(MAX_EXPIRY_DAYS),
});

/** The least of two roles — the one that carries less. */
export function lesserRole(a: WorkspaceRole, b: WorkspaceRole): WorkspaceRole {
  return atLeast(a, b) ? b : a;
}

/**
 * **What a request made with this token may do** — the ceiling it was given, capped by what its
 * creator holds in the workspace right now. `null` when the creator is no longer a member, which
 * is the token dying with the membership.
 */
export function effectiveRole(ceiling: WorkspaceRole, held: WorkspaceRole | null): WorkspaceRole | null {
  return held === null ? null : lesserRole(ceiling, held);
}

/** May `creator` create a token with this ceiling? A token never outranks the person making it. */
export function mayMint(creator: WorkspaceRole, ceiling: TokenRole): boolean {
  return atLeast(creator, ceiling);
}

export type TokenState = "live" | "expired" | "revoked";

export function tokenState(
  token: { expiresAt: Date; revokedAt: Date | null },
  now: number = Date.now(),
): TokenState {
  if (token.revokedAt) return "revoked";
  return token.expiresAt.getTime() <= now ? "expired" : "live";
}

/**
 * Reads the credential out of an `Authorization` header.
 *
 *   `none`       no `Bearer` header at all — the request is the session's business
 *   `malformed`  a `Bearer` header that is not shaped like one of ours — refused before any lookup
 *   `token`      a candidate worth hashing
 *
 * A header that names another scheme (`Basic …`) is `none`: it is not ours to refuse.
 */
export type BearerRead = { kind: "none" } | { kind: "malformed" } | { kind: "token"; token: string };

export function readBearer(header: string | null | undefined): BearerRead {
  if (!header) return { kind: "none" };
  const match = /^bearer(?:\s+(.*))?$/i.exec(header.trim());
  if (!match) return { kind: "none" };
  const candidate = (match[1] ?? "").trim();
  return ACCESS_TOKEN_PATTERN.test(candidate) ? { kind: "token", token: candidate } : { kind: "malformed" };
}

/**
 * **`lastUsedAt` is written at most once per interval per token** — a database write on every
 * request would be a new reason to keep Neon awake, and the figure is for a person asking "is this
 * token still in use", where five minutes is exact enough. Two layers: this in-memory check spares
 * the statement entirely while an instance is busy, and the store's `update … where` repeats the
 * rule in SQL so that three instances still write no more than once each per interval.
 */
export const LAST_USED_INTERVAL_MS = 5 * 60_000;

export function createUseTracker(intervalMs: number = LAST_USED_INTERVAL_MS, maxKeys = 5_000) {
  const seen = new Map<string, number>();
  return {
    /** True when this token's use should be written now. */
    due(id: string, now: number = Date.now()): boolean {
      const last = seen.get(id);
      if (last !== undefined && now - last < intervalMs) return false;
      if (seen.size >= maxKeys) seen.delete(seen.keys().next().value as string);
      seen.delete(id);
      seen.set(id, now);
      return true;
    },
    size: () => seen.size,
  };
}

/** Requests a token may make a minute, per instance (`lib/ratelimit.ts` says what per instance means). */
export const TOKEN_LIMIT = 120;
export const TOKEN_LIMIT_WINDOW_MS = 60_000;
