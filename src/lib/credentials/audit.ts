import { and, desc, eq, lt } from "drizzle-orm";

import { db } from "@/db";
import { credentialEvents } from "@/db/schema";
import type { WorkspaceScope } from "@/lib/workspace/scope";

/**
 * **The credential audit log — Phase 21.** *Which* credential, *what happened*, in which
 * run, at which node, when. **Never what it contains.**
 *
 * `BUILD_PLAN.md` states the rule for this file in five words — *record use, not content*
 * — and it is worth spelling out what that rules out, because each one is a tempting thing
 * to log while debugging: no secret, no prefix of one, no length, no hash, and no request
 * or response body from the service the secret authenticated to. The only free text on an
 * event row is `detail`, and the union below is the complete set of values it may hold.
 *
 * ### Why the log is written from `readSecret` and nowhere else
 *
 * `readSecret` is the single funnel through which a plaintext credential reaches any
 * caller in the product (`./index.ts`). Recording at the call sites instead would mean
 * four places to keep in step and a fifth that gets added later without one — and "the
 * audit log missed this use" is the one failure mode that makes an audit log worse than no
 * audit log, because it is trusted. One funnel, one insert.
 *
 * ### What it costs
 *
 * One insert per credential read. A run that posts to Discord and appends to a sheet
 * writes three rows. Neon's free tier meters *time awake* rather than statements
 * (`lib/workspace/store.ts`), and the database is necessarily awake during a run, so this
 * adds no new reason to wake it — which is the only cost that would have mattered.
 */

export const CREDENTIAL_EVENTS = ["stored", "rotated", "revoked", "used", "rekeyed"] as const;

export type CredentialEventName = (typeof CREDENTIAL_EVENTS)[number];

/**
 * What each event means. Exported as a table rather than left to the UI, because the vault
 * renders it and so does the verification script, and two descriptions of the same event
 * drift.
 *
 * `stored` and `rotated` are deliberately separate although both are a write to the same
 * three columns. The distinction is whether a secret *existed* here before: the first time
 * a workspace connects Discord is not a rotation, and a log that called it one would make
 * every credential look as though it had been replaced once.
 */
export const CREDENTIAL_EVENT_LABELS: Record<CredentialEventName, string> = {
  stored: "Stored for the first time",
  rotated: "Secret replaced",
  revoked: "Deleted",
  used: "Used by a run",
  rekeyed: "Re-wrapped under a new root key",
};

/**
 * How long an event is kept. **30 days**, and the number is a judgement rather than a
 * standard.
 *
 * Long enough to answer the question this log exists for — *what used this credential
 * before I rotated it, and did anything break after* — which is asked in the days after an
 * incident, not the months. Short enough that the table cannot become the largest thing in
 * a 0.5 GB free-tier database: at ~150 bytes a row, 30 days of the busiest plausible use of
 * this product is under a megabyte.
 *
 * A longer retention is a real thing to want and it is a `PRD.md` conversation, not a
 * constant to raise quietly — so the number is here, with this paragraph, rather than
 * inline in the prune.
 */
export const EVENT_RETENTION_DAYS = 30;

/**
 * The oldest instant an event may still exist at. A pure function because it is the only
 * arithmetic here, and an off-by-a-factor-of-1000 in it would either delete the whole log on
 * the next tick or never delete anything — and both of those look like nothing happening.
 */
export function retentionCutoff(now: Date): Date {
  return new Date(now.getTime() - EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

/** Where a use happened. Everything a node knows about itself, and nothing more. */
export interface CredentialUse {
  runId?: string;
  nodeId?: string;
  nodeType?: string;
  /**
   * One machine-readable word for *why*: the capability a node wanted (`send-mail`,
   * `append-row`, `post-message`), or the surface a route read it for (`model-list`).
   * Never a value and never part of one.
   */
  purpose?: string;
}

interface RecordInput {
  event: CredentialEventName;
  workspaceId: string;
  kind: string;
  label: string;
  credentialId?: string | null;
  actorId?: string | null;
  use?: CredentialUse;
  detail?: string | null;
}

/**
 * Append one event.
 *
 * **It never throws.** An audit insert that fails must not fail the thing it was auditing:
 * a Neon hiccup while a workflow is mid-run would otherwise turn a successful Discord post
 * into a failed step, which is a worse outcome than a gap in the log. The failure is logged
 * to stderr, where Cloud Logging picks it up, so the gap is not silent either.
 *
 * That trade is only acceptable because this log is **operational**, not a compliance
 * record. If it ever becomes the latter, the choice has to be revisited deliberately and
 * `SECURITY.md` is where it is written down.
 */
export async function recordCredentialEvent(input: RecordInput): Promise<void> {
  try {
    await db()
      .insert(credentialEvents)
      .values({
        event: input.event,
        workspaceId: input.workspaceId,
        kind: input.kind,
        label: input.label,
        credentialId: input.credentialId ?? null,
        actorId: input.actorId ?? null,
        runId: input.use?.runId ?? null,
        nodeId: input.use?.nodeId ?? null,
        nodeType: input.use?.nodeType ?? null,
        detail: input.detail ?? input.use?.purpose ?? null,
      });
  } catch (error) {
    console.error("Could not record a credential event:", error);
  }
}

export interface CredentialEventSummary {
  /** The row's own id — a random UUID, so a list has a stable key that is not its index. */
  id: string;
  event: CredentialEventName;
  label: string;
  kind: string;
  credentialLabel: string;
  runId: string | null;
  nodeId: string | null;
  nodeType: string | null;
  detail: string | null;
  at: string;
  /** Whether the credential this describes still exists. */
  orphaned: boolean;
}

/**
 * The only shape an event may take on its way to a client.
 *
 * **`actorId` is deliberately not projected**, and it is the one field here worth a paragraph.
 * Who rotated a credential is recorded in the database, and a workspace member reading the
 * vault cannot act on it — while a user id in a response is one more identifier on a page
 * whose entire subject is secrets. An admin who genuinely needs attribution has the database;
 * a support answer does not. Pulled out as a pure function so that rule is asserted rather
 * than maintained by whoever edits the `map` below.
 *
 * `detail` is projected, and the union in `CredentialUse` plus the call sites in `./index.ts`
 * are what keep it free of anything derived from a secret.
 */
export function describeEvent(row: {
  id: string;
  event: CredentialEventName;
  kind: string;
  label: string;
  runId: string | null;
  nodeId: string | null;
  nodeType: string | null;
  detail: string | null;
  at: Date;
  credentialId: string | null;
}): CredentialEventSummary {
  return {
    id: row.id,
    event: row.event,
    label: CREDENTIAL_EVENT_LABELS[row.event] ?? row.event,
    kind: row.kind,
    credentialLabel: row.label,
    runId: row.runId,
    nodeId: row.nodeId,
    nodeType: row.nodeType,
    detail: row.detail,
    at: row.at.toISOString(),
    orphaned: row.credentialId === null,
  };
}

/** The workspace's recent events, newest first. */
export async function listCredentialEvents(
  scope: WorkspaceScope,
  options: { limit?: number; credentialId?: string } = {},
): Promise<CredentialEventSummary[]> {
  const rows = await db()
    .select()
    .from(credentialEvents)
    .where(
      options.credentialId
        ? and(
            eq(credentialEvents.workspaceId, scope.workspaceId),
            eq(credentialEvents.credentialId, options.credentialId),
          )
        : eq(credentialEvents.workspaceId, scope.workspaceId),
    )
    .orderBy(desc(credentialEvents.at))
    .limit(Math.min(options.limit ?? 40, 200));

  return rows.map(describeEvent);
}

/**
 * Drop events past the retention window. Returns how many went.
 *
 * **Called from the cron tick**, which is the only thing in this system that runs on a
 * clock. Every tick rather than on an interval of its own: the statement is one indexed
 * delete that matches nothing on almost every tick, and a prune that runs rarely is a
 * prune nobody notices has stopped working. The tick has already woken the database
 * (`lib/triggers/tick.ts`), so this spends no CU-hours that were not already spent.
 */
export async function pruneCredentialEvents(now = new Date()): Promise<number> {
  const deleted = await db()
    .delete(credentialEvents)
    .where(lt(credentialEvents.at, retentionCutoff(now)))
    .returning({ id: credentialEvents.id });
  return deleted.length;
}
