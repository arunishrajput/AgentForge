import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { credentialEvents } from "@/db/schema";
import { rootKeyProvider } from "@/lib/crypto";
import type { WorkspaceScope } from "@/lib/workspace/scope";

import {
  type CredentialEventSummary,
  EVENT_RETENTION_DAYS,
  listCredentialEvents,
} from "./audit";
import { listCredentials, type CredentialSummary } from "./index";
import { CREDENTIAL_KINDS, rotationRule, type RotationMode } from "./rotation";

/**
 * **The vault's read model — Phase 21.**
 *
 * One request answers the whole question the settings tab asks: *what secrets does this
 * workspace hold, when was each one last replaced, when was each one last used, how is it
 * encrypted, and can I rotate it from here.* The alternative — a route per credential kind,
 * which is what the product had — is what made "is anything stale" a question nobody could
 * answer, because it was spread across three tabs and none of them said when anything was
 * last used.
 *
 * **Nothing here reads a secret.** Every field is either metadata, a timestamp, a count, or
 * a key *version* label, and the whole projection goes through `describeCredential`, which
 * never reads the envelope columns into its result.
 *
 * ### `lastUsedAt` is derived, not stored
 *
 * The obvious shape is a `lastUsedAt` column on the credential row, and it is the wrong one:
 * it would mean a **second write on every secret read**, on the hot path of every run, to
 * denormalise something one `GROUP BY` answers when somebody actually opens this page. The
 * aggregate costs one query per page view; the column would cost one write per node
 * execution for ever. It is also one fewer thing that can disagree with the log.
 */

export interface VaultEntry extends CredentialSummary {
  /** What the vault calls this — `ROTATION_RULES`, so the UI holds no copy. */
  title: string;
  mode: RotationMode;
  help: string;
  secretLabel: string | null;
  reconnectHref: string | null;
  /** Newest `used` event for this credential, or null if it has not been used in 30 days. */
  lastUsedAt: string | null;
  /** How many times it has been used inside the retention window. */
  usesInWindow: number;
}

export interface Vault {
  /** Every kind the product knows about, whether or not this workspace holds one. */
  entries: VaultEntry[];
  /**
   * Kinds with no credential stored, so the vault can say "Discord is not connected" rather
   * than silently listing two things and leaving the third to be inferred from absence.
   */
  missing: { kind: string; title: string; connectHref: string }[];
  events: CredentialEventSummary[];
  /**
   * How the root key is held. **Surfaced deliberately**: a deployment with no
   * `ROOT_KEY_SECRET` is encrypting under the environment variable, where re-keying can move
   * rows between shapes but cannot move between *versions* — and an operator who thinks they
   * have a rotatable root key when they do not has the Chapter 1 problem back without the
   * Chapter 1 warning.
   */
  rootKey: { provider: "secret-manager" | "environment"; versions: string[] };
  /** How many stored credentials are still in the Chapter 1 single-layer shape. */
  legacyCount: number;
  retentionDays: number;
}

export async function readVault(scope: WorkspaceScope): Promise<Vault> {
  const [stored, events, usage] = await Promise.all([
    listCredentials(scope),
    listCredentialEvents(scope, { limit: 40 }),
    usageByCredential(scope),
  ]);

  const byKind = new Map(stored.map((credential) => [credential.kind, credential]));

  const entries: VaultEntry[] = stored.map((credential) => {
    const rule = rotationRule(credential.kind);
    const used = usage.get(`${credential.kind}::${credential.label}`);
    return {
      ...credential,
      title: rule?.title ?? credential.kind,
      mode: rule?.mode ?? "reconnect",
      help: rule?.help ?? "This credential has no rotation path yet.",
      secretLabel: rule?.secretLabel ?? null,
      reconnectHref: rule?.reconnectHref ?? null,
      lastUsedAt: used?.at ?? null,
      usesInWindow: used?.count ?? 0,
    };
  });

  const missing = CREDENTIAL_KINDS.filter((kind) => !byKind.has(kind)).map((kind) => {
    const rule = rotationRule(kind);
    return {
      kind,
      title: rule?.title ?? kind,
      // Every rule has one, so this list can never name something missing without saying
      // where to get it — which is what it did for two of the three kinds until a browser
      // walk opened an empty workspace.
      connectHref: rule?.connectHref ?? "/settings",
    };
  });

  return {
    entries,
    missing,
    events,
    rootKey: {
      provider: rootKeyProvider(),
      // The distinct versions actually in use, from the rows themselves rather than from
      // Secret Manager: what matters operationally is which keys the database still depends
      // on, and that is a fact about the data, not about the key store.
      versions: [...new Set(entries.map((entry) => entry.keyVersion ?? "legacy"))].sort(),
    },
    legacyCount: entries.filter((entry) => entry.legacy).length,
    retentionDays: EVENT_RETENTION_DAYS,
  };
}

/**
 * Last use and use count per credential, in one aggregate.
 *
 * Keyed on `kind::label` rather than on `credentialId` on purpose: a credential that was
 * revoked and stored again is a *new* row with a new id, and the question the vault is
 * answering — "when did anything last use this workspace's Discord webhook" — is about the
 * slot, not about the row that happens to occupy it now.
 */
async function usageByCredential(
  scope: WorkspaceScope,
): Promise<Map<string, { at: string; count: number }>> {
  const rows = await db()
    .select({
      kind: credentialEvents.kind,
      label: credentialEvents.label,
      at: sql<string>`max(${credentialEvents.at})`.as("at"),
      count: sql<number>`count(*)::int`.as("count"),
    })
    .from(credentialEvents)
    // `used` alone. Counting every event would make `usesInWindow` include the rotation
    // that produced the credential, so a key stored and never used would report one use —
    // the one number on this page somebody might act on.
    .where(
      and(
        eq(credentialEvents.workspaceId, scope.workspaceId),
        eq(credentialEvents.event, "used"),
      ),
    )
    .groupBy(credentialEvents.kind, credentialEvents.label)
    .orderBy(desc(sql`max(${credentialEvents.at})`));

  const usage = new Map<string, { at: string; count: number }>();
  for (const row of rows) {
    usage.set(`${row.kind}::${row.label}`, {
      at: new Date(row.at).toISOString(),
      count: row.count,
    });
  }
  return usage;
}
