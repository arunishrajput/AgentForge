import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { credentials } from "@/db/schema";
import type { WorkspaceScope } from "@/lib/workspace/scope";

import { decryptSecret, encryptSecret, type SecretEnvelope } from "./crypto";

/**
 * The credential store — CONTRACT.md → "Credential storage shape".
 *
 * **The API over this is write-only.** `describeCredential` is the only projection
 * that may cross to a client, and it carries no part of the secret: not the value, not
 * a prefix, not a masked tail. A four-character hint is still key material, and the
 * phase's rule is that none of it leaves the server, not even truncated.
 *
 * One row per `(workspaceId, kind, label)`. `neon-http` has no transactions (D6), so a
 * write is a single upsert rather than a delete-then-insert that could lose a
 * credential halfway.
 *
 * **Phase 19A made credentials belong to a workspace, and that widens a security
 * surface on purpose.** It is necessary: a workflow shared with a teammate that cannot
 * reach its Google credential fails at the first integration node, at runtime, with an
 * error about a connection the teammate never made. The consequence has to be said out
 * loud rather than discovered — **connecting Google to a workspace lets every member of
 * that workspace act as you within the scopes you granted**, sending mail as you and
 * writing to your sheets. `CONTRACT.md` → *Credential storage shape* records it, the
 * settings UI says it, and Phase 20's roles are what will decide who may add or remove
 * one.
 *
 * `ownerId` is still written and still means who connected it — which is exactly the
 * name the UI needs when a workspace member asks whose account a workflow is sending
 * mail from.
 */

/** The user's own LLM provider key. One per user at MVP. */
export const LLM_CREDENTIAL_KIND = "llm.google";
export const DEFAULT_CREDENTIAL_LABEL = "default";

/**
 * The non-secret half of a credential — whatever the UI needs in order to show that
 * a credential exists and what it points at, without reading any of it.
 *
 * One shape across every `kind` rather than a discriminated union per kind: it is
 * stored as `jsonb`, so a union would be a type-level claim the database does not
 * enforce, and every consumer already knows which kind it asked for.
 */
export interface CredentialMetadata {
  /** `llm.google` — the model chosen in the settings UI. */
  model?: string;
  /** `integration.discord` — what the stored webhook is attached to. */
  webhookName?: string | null;
  channelId?: string | null;
  guildId?: string | null;
  /** `google.oauth` — which account connected, and what it actually granted. */
  email?: string | null;
  scopes?: string[];
}

export interface CredentialSummary {
  kind: string;
  label: string;
  metadata: CredentialMetadata;
  createdAt: string;
  updatedAt: string;
}

export async function putCredential(options: {
  scope: WorkspaceScope;
  kind: string;
  label?: string;
  secret: string;
  metadata?: CredentialMetadata;
}): Promise<CredentialSummary> {
  const label = options.label ?? DEFAULT_CREDENTIAL_LABEL;
  const envelope = encryptSecret(options.secret);

  const [row] = await db()
    .insert(credentials)
    .values({
      workspaceId: options.scope.workspaceId,
      ownerId: options.scope.userId,
      kind: options.kind,
      label,
      ciphertext: envelope.ciphertext,
      iv: envelope.iv,
      authTag: envelope.authTag,
      metadata: options.metadata ?? {},
    })
    .onConflictDoUpdate({
      // **This names an index, and Postgres refuses to plan the statement without a
      // matching one.** Phase 19A found `credential_owner_kind_label_idx` missing from
      // the deployed database, which made the previous version of this upsert answer
      // 42P10 on every credential write — a 500 on saving a key, connecting Google, or
      // storing a webhook. `scripts/verify-schema.mjs` exists to catch that class.
      target: [credentials.workspaceId, credentials.kind, credentials.label],
      set: {
        ciphertext: envelope.ciphertext,
        iv: envelope.iv,
        authTag: envelope.authTag,
        // Who connected it last is who it now belongs to, which is the honest record
        // when one member replaces another's credential.
        ownerId: options.scope.userId,
        ...(options.metadata ? { metadata: options.metadata } : {}),
        updatedAt: new Date(),
      },
    })
    .returning();

  return describeCredential(row);
}

/** Changes the stored metadata without touching the secret. */
export async function updateCredentialMetadata(options: {
  scope: WorkspaceScope;
  kind: string;
  label?: string;
  metadata: CredentialMetadata;
}): Promise<CredentialSummary | null> {
  const label = options.label ?? DEFAULT_CREDENTIAL_LABEL;
  const [row] = await db()
    .update(credentials)
    .set({ metadata: options.metadata, updatedAt: new Date() })
    .where(
      and(
        eq(credentials.workspaceId, options.scope.workspaceId),
        eq(credentials.kind, options.kind),
        eq(credentials.label, label),
      ),
    )
    .returning();

  return row ? describeCredential(row) : null;
}

export async function getCredential(options: {
  scope: WorkspaceScope;
  kind: string;
  label?: string;
}): Promise<CredentialSummary | null> {
  const row = await readRow(options);
  return row ? describeCredential(row) : null;
}

/**
 * The plaintext secret. **Server-side only** — every caller is a node's `execute` or a
 * route that immediately hands it to a provider. Nothing that returns it to a client
 * may call this.
 */
export async function readSecret(options: {
  scope: WorkspaceScope;
  kind: string;
  label?: string;
}): Promise<string | null> {
  const row = await readRow(options);
  if (!row) return null;
  return decryptSecret(row as SecretEnvelope);
}

export async function deleteCredential(options: {
  scope: WorkspaceScope;
  kind: string;
  label?: string;
}): Promise<boolean> {
  const label = options.label ?? DEFAULT_CREDENTIAL_LABEL;
  const deleted = await db()
    .delete(credentials)
    .where(
      and(
        eq(credentials.workspaceId, options.scope.workspaceId),
        eq(credentials.kind, options.kind),
        eq(credentials.label, label),
      ),
    )
    .returning({ id: credentials.id });

  return deleted.length > 0;
}

async function readRow(options: { scope: WorkspaceScope; kind: string; label?: string }) {
  const label = options.label ?? DEFAULT_CREDENTIAL_LABEL;
  const [row] = await db()
    .select()
    .from(credentials)
    .where(
      and(
        eq(credentials.workspaceId, options.scope.workspaceId),
        eq(credentials.kind, options.kind),
        eq(credentials.label, label),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * The only shape that may reach a client. `ciphertext`, `iv` and `authTag` are not
 * merely omitted from the type — they are never read into the returned object, so a
 * future spread cannot leak them by accident.
 */
export function describeCredential(row: {
  kind: string;
  label: string;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): CredentialSummary {
  return {
    kind: row.kind,
    label: row.label,
    metadata: (row.metadata ?? {}) as CredentialMetadata,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
