import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { credentials } from "@/db/schema";
import { isLegacyEnvelope, openSecret, sealSecret, type Envelope } from "@/lib/crypto";
import type { WorkspaceScope } from "@/lib/workspace/scope";

import { type CredentialUse, recordCredentialEvent } from "./audit";

/**
 * The credential store — CONTRACT.md → "Credential storage shape".
 *
 * **The API over this is write-only.** `describeCredential` is the only projection that may
 * cross to a client, and it carries no part of the secret: not the value, not a prefix, not
 * a masked tail. A four-character hint is still key material, and the rule is that none of
 * it leaves the server, not even truncated.
 *
 * One row per `(workspaceId, kind, label)`. `neon-http` has no transactions (D6), so a
 * write is a single upsert rather than a delete-then-insert that could lose a credential
 * halfway.
 *
 * **Phase 19A made credentials belong to a workspace, and that widens a security surface
 * on purpose.** It is necessary: a workflow shared with a teammate that cannot reach its
 * Google credential fails at the first integration node, at runtime, with an error about a
 * connection the teammate never made. The consequence has to be said out loud rather than
 * discovered — **connecting Google to a workspace lets every member of that workspace act
 * as you within the scopes you granted**, sending mail as you and writing to your sheets.
 * `CONTRACT.md` → *Credential storage shape* records it, the settings UI says it, and Phase
 * 20's roles decide who may add or remove one.
 *
 * `ownerId` is still written and still means who connected it — which is exactly the name
 * the UI needs when a workspace member asks whose account a workflow is sending mail from.
 *
 * ### What Phase 21 changed
 *
 * **Two things, and neither is visible to a caller.** A secret is now sealed under a
 * per-credential data key wrapped by a versioned root key (`lib/crypto/envelope.ts`), so
 * the key an operator rotates is no longer the key the data is under. And every write and
 * every read appends to the audit log (`./audit.ts`) — which is why `readSecret` takes a
 * `use`: it is the single funnel every plaintext passes through, so it is the one place
 * that cannot miss a use.
 */

/** The user's own LLM provider key. One per workspace. */
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
  /**
   * Phase 23B's token integrations. Each one is whatever the service will say about the
   * credential *without* revealing any of it, so the settings card can show which account is
   * wired up: Notion's workspace, GitHub's login, Airtable's user id.
   *
   * `integration.slack` deliberately contributes none of these. Every identifying part of a
   * Slack incoming webhook lives inside the URL, which is the secret, and Slack has no
   * endpoint that describes one — so there is nothing here that would not be a fragment of
   * key material, and the card says "Connected" and stops.
   */
  botName?: string | null;
  workspaceName?: string | null;
  login?: string | null;
  userId?: string | null;
}

export interface CredentialSummary {
  kind: string;
  label: string;
  metadata: CredentialMetadata;
  createdAt: string;
  updatedAt: string;
  /**
   * Phase 21. When the **secret value** last changed, and how many times — distinct from
   * `updatedAt`, which also moves when only the metadata does.
   */
  rotatedAt: string | null;
  rotationCount: number;
  /**
   * Which root key version wraps this credential's data key, or `null` for a row still in
   * the Chapter 1 single-layer shape.
   *
   * **A version label is not key material** — it names immutable bytes held in Secret
   * Manager and reveals nothing about them — and it is the only way an operator can tell
   * whether a re-key actually moved anything, which is the one claim in this phase that
   * would otherwise have to be taken on trust. So it crosses to the client, and the
   * write-only rule is unbroken.
   */
  keyVersion: string | null;
  /** True while this row is still encrypted directly under `ENCRYPTION_KEY`. */
  legacy: boolean;
}

export async function putCredential(options: {
  scope: WorkspaceScope;
  kind: string;
  label?: string;
  secret: string;
  metadata?: CredentialMetadata;
  /** What to call this in the audit log. `stored` unless the caller knows it replaced one. */
  event?: "stored" | "rotated";
}): Promise<CredentialSummary> {
  const label = options.label ?? DEFAULT_CREDENTIAL_LABEL;
  const envelope = await sealSecret(options.secret);

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
      wrappedKey: envelope.wrappedKey,
      wrapIv: envelope.wrapIv,
      wrapAuthTag: envelope.wrapAuthTag,
      keyVersion: envelope.keyVersion,
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
        wrappedKey: envelope.wrappedKey,
        wrapIv: envelope.wrapIv,
        wrapAuthTag: envelope.wrapAuthTag,
        keyVersion: envelope.keyVersion,
        // Who connected it last is who it now belongs to, which is the honest record
        // when one member replaces another's credential.
        ownerId: options.scope.userId,
        ...(options.metadata ? { metadata: options.metadata } : {}),
        updatedAt: new Date(),
        /**
         * **Phase 21, and the reason these two live in the `set` clause.** Postgres runs
         * `DO UPDATE SET` only when the insert conflicted — so this branch *is* the
         * definition of "a secret was replaced", with no read-then-write to race and no
         * way for two concurrent writes to lose a count (D6 — no transactions).
         */
        rotatedAt: new Date(),
        rotationCount: sql`${credentials.rotationCount} + 1`,
      },
    })
    .returning();

  const summary = describeCredential(row);
  await recordCredentialEvent({
    // An insert leaves `rotationCount` at 0, so the row itself says which this was. The
    // caller may override, because `writeSettings` knows it is replacing a key before the
    // write happens and the distinction is worth keeping honest either way.
    event: options.event ?? (summary.rotationCount > 0 ? "rotated" : "stored"),
    workspaceId: options.scope.workspaceId,
    kind: options.kind,
    label,
    credentialId: row.id,
    actorId: options.scope.userId,
    detail: summary.keyVersion,
  });

  return summary;
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

/** Every credential in the workspace, non-secret halves only. The vault's inventory. */
export async function listCredentials(scope: WorkspaceScope): Promise<CredentialSummary[]> {
  const rows = await db()
    .select()
    .from(credentials)
    .where(eq(credentials.workspaceId, scope.workspaceId))
    .orderBy(credentials.kind, credentials.label);
  return rows.map(describeCredential);
}

/**
 * The plaintext secret. **Server-side only** — every caller is a node's `execute` or a
 * route that immediately hands it to a provider. Nothing that returns it to a client
 * may call this.
 *
 * **It is also the audit log's only writer for `used`**, which is why `use` is a parameter
 * rather than something the caller records afterwards. Recording at the call sites would
 * mean four places to keep in step and a fifth added later without one, and a use this log
 * missed is worse than no log, because a log is trusted.
 *
 * `use` is optional and its absence is meaningful rather than lazy: a read with no context
 * is recorded as a use with no run, which is the truth for the two routes that resolve a
 * provider key to fill a picker.
 */
export async function readSecret(options: {
  scope: WorkspaceScope;
  kind: string;
  label?: string;
  use?: CredentialUse;
}): Promise<string | null> {
  const row = await readRow(options);
  if (!row) return null;

  const plaintext = await openSecret(row as Envelope);

  await recordCredentialEvent({
    event: "used",
    workspaceId: options.scope.workspaceId,
    kind: row.kind,
    label: row.label,
    credentialId: row.id,
    // No actor, deliberately. A use happens inside a run, which may have been started by a
    // schedule or by an unauthenticated webhook — naming the workflow's owner here would
    // invent a person who did not act. `runId`/`nodeId` are the attribution for a use.
    ...(options.use ? { use: options.use } : {}),
  });

  return plaintext;
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

  if (deleted.length > 0) {
    // `credentialId` is deliberately left null: the row it would reference is gone, and
    // `ON DELETE SET NULL` would null it a moment later anyway. The denormalised `kind`
    // and `label` are what keep this event meaningful after the credential it describes
    // no longer exists — which is exactly when a revocation is the event you want.
    await recordCredentialEvent({
      event: "revoked",
      workspaceId: options.scope.workspaceId,
      kind: options.kind,
      label,
      actorId: options.scope.userId,
    });
  }

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
 * The only shape that may reach a client. `ciphertext`, `iv`, `authTag` and the three
 * envelope columns are not merely omitted from the type — they are never read into the
 * returned object, so a future spread cannot leak them by accident.
 */
export function describeCredential(row: {
  kind: string;
  label: string;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
  rotatedAt: Date | null;
  rotationCount: number;
  keyVersion: string | null;
  wrappedKey: string | null;
}): CredentialSummary {
  return {
    kind: row.kind,
    label: row.label,
    metadata: (row.metadata ?? {}) as CredentialMetadata,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    rotatedAt: row.rotatedAt?.toISOString() ?? null,
    rotationCount: row.rotationCount,
    keyVersion: row.keyVersion,
    legacy: isLegacyEnvelope(row),
  };
}
