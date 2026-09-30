import { eq } from "drizzle-orm";

import { db } from "@/db";
import { credentials, type Credential } from "@/db/schema";
import {
  currentRootKey,
  ENV_KEY_VERSION,
  type Envelope,
  openSecret,
  rewrap,
  rootKey,
} from "@/lib/crypto";
import type { WorkspaceScope } from "@/lib/workspace/scope";

import { recordCredentialEvent } from "./audit";

/**
 * **Re-keying — the path Chapter 1 said did not exist.**
 *
 * The Chapter 1 note was blunt and accurate: *never rotate `ENCRYPTION_KEY`, it destroys
 * all stored credentials.* This file is what makes that sentence obsolete, and it is short
 * because envelope encryption did the actual work — a re-key unwraps a 32-byte data key and
 * wraps it again, so the secret is **never decrypted and never rewritten** except for a
 * legacy row that has no data key yet.
 *
 * ### Four properties, each one deliberate
 *
 * **It is resumable, because it is per-row.** Every credential is a single independent
 * `UPDATE` with its own `keyVersion`, so a re-key that dies halfway leaves a database where
 * some rows are on the new version and some on the old — and *every one of them still
 * decrypts*, because a row names the key that wraps it. Running it again finishes the job.
 * There is no window in which the database is inconsistent, which is what makes this safe
 * to run against production without a maintenance mode. (D6: `neon-http` has no
 * transactions, so a re-key that needed to be atomic could not have been written at all.)
 *
 * **The root key is resolved once**, not once per row. On Secret Manager that is the
 * difference between one access operation and one per credential, against a free tier of
 * 10,000 a month.
 *
 * **`legacy: true` goes backwards**, converting enveloped rows back to the Chapter 1 single
 * layer under `ENCRYPTION_KEY`. That is not a curiosity: once the deployed rows are
 * enveloped, rolling Cloud Run back to a revision that predates Phase 21 would make every
 * credential unreadable. A rollback you cannot perform is not a rollback, so the reverse
 * exists, is tested, and is the first step in `SECURITY.md` → *Rolling back past Phase 21*.
 *
 * **Every row is verified after it is written.** The re-key re-opens what it just stored and
 * checks the plaintext is byte-identical to what came out before. That doubles the work and
 * it is worth it: the failure this catches — a row that was written wrong and now decrypts
 * to rubbish — is silent, unrecoverable, and would be discovered by a workflow failing in
 * production days later.
 */

export interface RekeyOutcome {
  /** The version every row now names, or `legacy` when moving backwards. */
  target: string;
  examined: number;
  /** Rows that were already on the target. */
  unchanged: number;
  rewrapped: number;
  /** Rows converted from the Chapter 1 single-layer shape. */
  converted: number;
  failures: { kind: string; label: string; reason: string }[];
}

export interface RekeyOptions {
  /** Restrict to one workspace. Omitted means every credential in the database. */
  scope?: WorkspaceScope;
  /** Convert *back* to the Chapter 1 shape under `ENCRYPTION_KEY`. */
  legacy?: boolean;
  /** Read and verify without writing. */
  dryRun?: boolean;
}

export async function rekeyCredentials(options: RekeyOptions = {}): Promise<RekeyOutcome> {
  const target = options.legacy
    ? { version: ENV_KEY_VERSION, key: await rootKey(ENV_KEY_VERSION), legacy: true }
    : await currentRootKey();

  const rows = await db()
    .select()
    .from(credentials)
    .where(options.scope ? eq(credentials.workspaceId, options.scope.workspaceId) : undefined)
    .orderBy(credentials.createdAt);

  const outcome: RekeyOutcome = {
    target: options.legacy ? "legacy" : target.version,
    examined: rows.length,
    unchanged: 0,
    rewrapped: 0,
    converted: 0,
    failures: [],
  };

  for (const row of rows) {
    try {
      const result = await rekeyOne(row, target, options.dryRun ?? false);
      if (!result.changed) {
        outcome.unchanged += 1;
        continue;
      }
      if (result.converted) outcome.converted += 1;
      else outcome.rewrapped += 1;

      if (!options.dryRun) {
        await recordCredentialEvent({
          event: "rekeyed",
          workspaceId: row.workspaceId,
          kind: row.kind,
          label: row.label,
          credentialId: row.id,
          ...(options.scope ? { actorId: options.scope.userId } : {}),
          detail: outcome.target,
        });
      }
    } catch (error) {
      // One bad row must not stop the others. A re-key that aborts on the first failure
      // leaves the rest on the old key with nothing having said which ones, and the
      // operator's next move — run it again — would silently skip the same row for ever.
      outcome.failures.push({
        kind: row.kind,
        label: row.label,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return outcome;
}

async function rekeyOne(
  row: Credential,
  target: { version: string; key: Buffer; legacy?: boolean },
  dryRun: boolean,
): Promise<{ changed: boolean; converted: boolean }> {
  const before = row as Envelope;

  // Read the plaintext *first*, so a row that already does not decrypt is reported as such
  // rather than being rewritten into a second broken shape.
  const plaintext = await openSecret(before);

  const { envelope, changed } = await rewrap(before, target);
  if (!changed) return { changed: false, converted: false };
  if (dryRun) return { changed: true, converted: before.wrappedKey === null };

  const [updated] = await db()
    .update(credentials)
    .set({
      ciphertext: envelope.ciphertext,
      iv: envelope.iv,
      authTag: envelope.authTag,
      wrappedKey: envelope.wrappedKey,
      wrapIv: envelope.wrapIv,
      wrapAuthTag: envelope.wrapAuthTag,
      keyVersion: envelope.keyVersion,
      // `updatedAt` is deliberately not touched. A re-key changes how a secret is stored
      // and not what it is, and moving `updatedAt` would make the vault report every
      // credential as freshly saved — which is exactly the wrong thing to tell somebody
      // trying to work out when a key was last replaced.
    })
    .where(eq(credentials.id, row.id))
    .returning();

  if (!updated) throw new Error("The credential disappeared while it was being re-keyed.");

  // The verification the doc comment promises: what was stored must open to what was read.
  const after = await openSecret(updated as Envelope);
  if (after !== plaintext) {
    throw new Error(
      "The re-wrapped credential does not decrypt to its original value. It has not been left readable.",
    );
  }

  return { changed: true, converted: before.wrappedKey === null };
}
