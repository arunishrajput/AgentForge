import { and, desc, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { workflowVersions, type Workflow, type WorkflowVersion } from "@/db/schema";
import { ApiError } from "@/lib/api";

import { diffGraphs, type DiffSummary } from "./diff";
import type { WorkflowGraph } from "./graph";

/**
 * Workflow version history — CONTRACT.md → "Workflow versions".
 *
 * Owner-scoped like everything else: every query here filters on `ownerId`, and a
 * version belonging to somebody else answers 404 rather than 403 (D20).
 *
 * **History is append-only.** Restoring version 3 does not rewind to 3; it writes 3's
 * graph as a *new* version on top. Nothing in this file deletes a version except the
 * retention cap below, and nothing renumbers one. That is what makes a run's recorded
 * version number mean something a week later.
 */

/**
 * How many versions a workflow keeps.
 *
 * Unbounded history is a slow leak on a metered free tier, and this project has one
 * hard number to respect: **Neon's free tier is 0.5 GB of storage** (DEPLOYMENT.md →
 * *Free-tier headroom*). A snapshot of the six-node demo workflow measures ~1.9 KB of
 * JSON, so 50 versions is ~95 KB per workflow — a thousand heavily-edited workflows
 * would be under 100 MB, which is the headroom this is sized against.
 *
 * **A labelled version is never pruned.** A label is the only signal a user gives that
 * a particular version matters, and silently deleting the one they named is the worst
 * thing this cap could do. So the cap bounds the *unlabelled* tail, and the way to
 * keep something for ever is to name it.
 */
export const VERSION_LIMIT = 50;

export const versionLabelSchema = z.object({
  label: z.string().max(80).nullable(),
});

/**
 * Write a snapshot. Called by `createWorkflow` and `updateWorkflow` and nowhere else,
 * so there is exactly one place a version comes into existence.
 *
 * `number` is supplied by the caller, from the `RETURNING` of the single-row UPDATE
 * that bumped `workflow.version`. It is never computed here, because computing it
 * would mean reading `max(number)` and inserting afterwards — two statements with no
 * transaction between them, which is the race the column exists to avoid.
 *
 * **A failure here does not fail the save.** The workflow row is already written and
 * correct; losing a snapshot costs history, and refusing the user's save because the
 * *history* could not be written would be a worse product and a stranger bug report.
 * The gap in the numbering is the record that it happened, and it is logged.
 */
export async function recordVersion(options: {
  workflowId: string;
  ownerId: string;
  number: number;
  name: string;
  graph: WorkflowGraph;
  label?: string | null;
}): Promise<void> {
  try {
    await db().insert(workflowVersions).values({
      workflowId: options.workflowId,
      ownerId: options.ownerId,
      number: options.number,
      name: options.name,
      graph: options.graph,
      label: options.label ?? null,
    });
  } catch (error) {
    console.error(
      `[versions] could not record version ${options.number} of workflow ${options.workflowId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return;
  }

  await pruneVersions(options.workflowId);
}

/**
 * Drop the oldest unlabelled versions beyond the cap.
 *
 * One statement, and only on a save that actually produced a version — which is a
 * click of Save, not a keystroke. The subquery finds the cut-off by offset rather than
 * counting and deleting by id, so the whole decision happens in the database and the
 * statement is a no-op until there is something to remove.
 */
async function pruneVersions(workflowId: string): Promise<void> {
  try {
    const keep = db()
      .select({ number: workflowVersions.number })
      .from(workflowVersions)
      .where(eq(workflowVersions.workflowId, workflowId))
      .orderBy(desc(workflowVersions.number))
      .limit(1)
      .offset(VERSION_LIMIT - 1);

    await db()
      .delete(workflowVersions)
      .where(
        and(
          eq(workflowVersions.workflowId, workflowId),
          sql`${workflowVersions.label} is null`,
          lt(workflowVersions.number, keep),
        ),
      );
  } catch (error) {
    // Retention is housekeeping. It must never turn a successful save into a failure.
    console.error(
      `[versions] could not prune workflow ${workflowId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * The history, newest first, with the graphs.
 *
 * It reads the graphs because the summary each row prints — "+2 nodes, 1 changed" — is
 * computed against the row below it, and a list of bare timestamps is not a history
 * anybody can navigate. That is one query returning at most `VERSION_LIMIT` snapshots
 * (~95 KB at the measured size), paid only when a user opens the history panel.
 */
export async function listVersions(
  ownerId: string,
  workflowId: string,
): Promise<WorkflowVersion[]> {
  return db()
    .select()
    .from(workflowVersions)
    .where(
      and(eq(workflowVersions.workflowId, workflowId), eq(workflowVersions.ownerId, ownerId)),
    )
    .orderBy(desc(workflowVersions.number))
    .limit(VERSION_LIMIT);
}

export async function getVersion(
  ownerId: string,
  workflowId: string,
  number: number,
): Promise<WorkflowVersion> {
  const [version] = await db()
    .select()
    .from(workflowVersions)
    .where(
      and(
        eq(workflowVersions.workflowId, workflowId),
        eq(workflowVersions.ownerId, ownerId),
        eq(workflowVersions.number, number),
      ),
    )
    .limit(1);

  if (!version) throw new ApiError("not_found", "No such version of this workflow.");
  return version;
}

/**
 * The snapshot a durable run should resume against, or null when there is none.
 *
 * Deliberately **not** owner-scoped and deliberately not throwing: the caller is the
 * dispatch route, which has already authorised itself by `CRON_SECRET` and the run's
 * own `dispatchToken` and has a run row in hand. A missing snapshot is a normal
 * outcome — a pre-Phase-18 run, or a pruned version — and the caller falls back to the
 * live graph rather than failing the delivery.
 */
export async function versionGraph(
  workflowId: string,
  number: number | null,
): Promise<WorkflowGraph | null> {
  if (number === null) return null;

  const [version] = await db()
    .select({ graph: workflowVersions.graph })
    .from(workflowVersions)
    .where(
      and(eq(workflowVersions.workflowId, workflowId), eq(workflowVersions.number, number)),
    )
    .limit(1);

  return version?.graph ?? null;
}

export async function labelVersion(
  ownerId: string,
  workflowId: string,
  number: number,
  label: string | null,
): Promise<WorkflowVersion> {
  await getVersion(ownerId, workflowId, number);

  const [updated] = await db()
    .update(workflowVersions)
    .set({ label: label === null || label.trim() === "" ? null : label.trim() })
    .where(
      and(
        eq(workflowVersions.workflowId, workflowId),
        eq(workflowVersions.ownerId, ownerId),
        eq(workflowVersions.number, number),
      ),
    )
    .returning();

  return updated;
}

/** The wire shape of one version. The graph is included only where it was asked for. */
export function describeVersion(
  version: WorkflowVersion,
  options: { graph?: boolean; summary?: DiffSummary | null; current?: boolean } = {},
) {
  return {
    number: version.number,
    label: version.label,
    name: version.name,
    createdAt: version.createdAt.toISOString(),
    /** True for the version the workflow is at right now — the one on the canvas. */
    current: options.current ?? false,
    /**
     * What this version changed relative to the one before it. Null on the oldest
     * version in the list, which has nothing below it to be compared against — not
     * "nothing changed", which is why it is null rather than a zeroed summary.
     */
    changes: options.summary ?? null,
    ...(options.graph ? { graph: version.graph } : {}),
  };
}

/**
 * The history as the client reads it: every version, each with what it changed
 * relative to its predecessor.
 *
 * The oldest row in the window gets `changes: null` rather than a diff against an
 * empty graph. It may well have a predecessor that the retention cap removed, and
 * claiming "12 nodes added" for a version that added one would be a confident lie.
 */
export function describeHistory(versions: WorkflowVersion[], workflow: Workflow) {
  const ascending = [...versions].sort((a, b) => a.number - b.number);
  const summaries = new Map<number, DiffSummary>();

  for (let i = 1; i < ascending.length; i += 1) {
    summaries.set(
      ascending[i].number,
      diffGraphs(ascending[i - 1].graph, ascending[i].graph).summary,
    );
  }

  return versions.map((version) =>
    describeVersion(version, {
      summary: summaries.get(version.number) ?? null,
      current: version.number === workflow.version,
    }),
  );
}

/** Both sides of a comparison, and what differs. `from` and `to` are version numbers. */
export async function compareVersions(
  ownerId: string,
  workflowId: string,
  from: number,
  to: number,
) {
  const [base, target] = await Promise.all([
    getVersion(ownerId, workflowId, from),
    getVersion(ownerId, workflowId, to),
  ]);

  return {
    from: describeVersion(base, { graph: true }),
    to: describeVersion(target, { graph: true }),
    diff: diffGraphs(base.graph, target.graph),
  };
}
