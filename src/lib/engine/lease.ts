import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { runs, type Run } from "@/db/schema";

import type { RunCursor } from "./cursor";
import type { Checkpoint, RunStatus } from "./types";

/**
 * Leases — who is allowed to execute a run, and until when.
 *
 * This module exists because **Cloud Tasks delivers at least once.** A queue that
 * guarantees a task is delivered guarantees nothing about it being delivered only
 * once: a delivery whose HTTP request fails is retried, and "fails" includes a
 * container that completed the work and died before answering. Without an interlock,
 * the observable consequence of durable execution would be a workflow that posts two
 * Discord messages and appends two spreadsheet rows. That is worse than the problem
 * durability was added to solve.
 *
 * So execution is gated on a lease: a delivery may only run a run it successfully
 * claimed, and every claim is a **compare-and-set** `UPDATE ... RETURNING` against
 * `leaseExpiresAt`. `drizzle-orm/neon-http` has no transactions (D6), so a conditional
 * update is the only atomic primitive available — and it is enough, exactly as it was
 * for the cron tick's schedule claim (D42). Two containers racing the same task: one
 * update matches a row, the other matches none, and the loser does nothing.
 *
 * **Every time comparison uses the database's clock, never the container's.** `now()`
 * appears in the SQL rather than a JavaScript `Date` for the same reason the SSE
 * stream refuses to compare `startedAt` against a local clock (`CONTRACT.md` → *Which
 * run a stream follows*): under `max-instances 3` there are three clocks, and a lease
 * compared against the wrong one is a lease that does not hold.
 */

/**
 * How long a claim lasts. Must exceed the longest possible gap between checkpoints,
 * which is bounded by the engine's own deadline: a checkpoint happens after every
 * step, and no attempt may exceed `DEFAULT_DEADLINE_MS` (120 s). 180 s leaves 60 s of
 * margin for the finalising write.
 */
export const LEASE_MS = 180_000;

/**
 * How long after a lease lapses before a run is declared abandoned.
 *
 * A lapsed lease usually means a redelivery is on its way, not that the run is lost —
 * the queue's backoff is 5 s doubling to 60 s. Sweeping the instant a lease expires
 * would race the redelivery and fail runs that were about to resume. This is the
 * margin that makes the sweeper conservative.
 */
export const SWEEP_GRACE_MS = 120_000;

/**
 * How many deliveries a durable run may receive. Matches the queue's `maxAttempts`,
 * deliberately: the queue stops redelivering at 5, and the worker fails the run on
 * that last delivery rather than leaving it for the sweeper. Belt and braces — the
 * queue's setting is infrastructure and this one is in the repository, so a queue
 * recreated with the wrong flags cannot turn a poison run into an unbounded loop.
 */
export const MAX_DELIVERIES = 5;

/** SQL for "now, plus this many seconds", parameterised rather than interpolated. */
const inSeconds = (seconds: number) => sql`now() + make_interval(secs => ${seconds})`;
const agoSeconds = (seconds: number) => sql`now() - make_interval(secs => ${seconds})`;

const NON_TERMINAL: RunStatus[] = ["queued", "running"];

/**
 * The token a task carries to prove it is about a specific run.
 *
 * Same construction as the webhook token (D41) and for the same reason: it is the
 * whole of the authorisation on a route with no session. 192 bits of CSPRNG, so it
 * cannot be guessed, and scoped to one run, so holding one buys nothing but the
 * ability to resume work its owner already started.
 */
export function mintDispatchToken(): string {
  return crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "").slice(0, 16);
}

export const DISPATCH_TOKEN_PATTERN = /^[0-9a-f]{48}$/;

/** Identifies one execution attempt, so a lease can be checked against its holder. */
export function mintLeaseOwner(): string {
  return `${process.env.K_REVISION ?? "local"}:${crypto.randomUUID()}`;
}

/**
 * Take exclusive ownership of a run, or fail to.
 *
 * Claimable means: this token is genuinely this run's, the run has not finished, and
 * nobody holds a live lease on it. Anything else returns null, and the caller's only
 * correct response is to do nothing — the run is either already done or in somebody
 * else's hands.
 *
 * `attempt` is incremented by the claim rather than by the enqueue, so it counts
 * deliveries that actually reached a worker.
 */
export async function claimRun(options: {
  runId: string;
  token: string;
  owner: string;
}): Promise<Run | null> {
  const [claimed] = await db()
    .update(runs)
    .set({
      status: "running",
      leaseOwner: options.owner,
      leaseExpiresAt: inSeconds(LEASE_MS / 1000) as unknown as Date,
      heartbeatAt: sql`now()` as unknown as Date,
      attempt: sql`${runs.attempt} + 1`,
    })
    .where(
      and(
        eq(runs.id, options.runId),
        eq(runs.dispatchToken, options.token),
        inArray(runs.status, NON_TERMINAL),
        or(isNull(runs.leaseExpiresAt), lt(runs.leaseExpiresAt, sql`now()`)),
      ),
    )
    .returning();

  return claimed ?? null;
}

/**
 * Take the lease for a run this process created and is about to execute itself — the
 * `sync` path, where there is no queue and no token to present.
 *
 * Still a lease, and still a compare-and-set, for two reasons that are not about
 * duplicate delivery: it gives a synchronous run the same cancellation path as a
 * durable one, and it means the engine has exactly one checkpoint implementation
 * instead of one per mode.
 */
export async function claimOwnRun(runId: string, owner: string): Promise<Run | null> {
  const [claimed] = await db()
    .update(runs)
    .set({
      status: "running",
      leaseOwner: owner,
      leaseExpiresAt: inSeconds(LEASE_MS / 1000) as unknown as Date,
      heartbeatAt: sql`now()` as unknown as Date,
      attempt: sql`${runs.attempt} + 1`,
    })
    .where(
      and(
        eq(runs.id, runId),
        inArray(runs.status, NON_TERMINAL),
        or(isNull(runs.leaseExpiresAt), lt(runs.leaseExpiresAt, sql`now()`)),
      ),
    )
    .returning();

  return claimed ?? null;
}

/**
 * One statement per step: write the frontier, extend the lease, and read back whether
 * a cancellation was requested.
 *
 * The single statement is the design. On Neon's free tier the run's own writes are the
 * budget, so polling a second row to ask "was I cancelled" would double the per-step
 * cost of every run in the product. `RETURNING` makes the answer free.
 *
 * Nothing matching means the lease is gone — the run was swept, or a redelivery
 * claimed it after this worker went quiet. The engine must then stop without writing
 * a terminal status, because the run now belongs to somebody else.
 */
export async function checkpointRun(options: {
  runId: string;
  owner: string;
  cursor: RunCursor;
}): Promise<Checkpoint> {
  const [row] = await db()
    .update(runs)
    .set({
      cursor: options.cursor,
      heartbeatAt: sql`now()` as unknown as Date,
      leaseExpiresAt: inSeconds(LEASE_MS / 1000) as unknown as Date,
    })
    .where(and(eq(runs.id, options.runId), eq(runs.leaseOwner, options.owner)))
    .returning({ cancelRequestedAt: runs.cancelRequestedAt });

  if (!row) return { cancelRequested: false, leaseHeld: false };
  return { cancelRequested: row.cancelRequestedAt !== null, leaseHeld: true };
}

/**
 * Write a run's final state and give up the lease.
 *
 * Guarded on `leaseOwner` for the same reason `checkpointRun` is: a worker that lost
 * its lease mid-run must not be able to stamp `failed` over a run that another worker
 * is still successfully executing. Returns whether the write landed, so a caller can
 * tell "I finished this" from "this was taken from me".
 */
export async function finishRun(options: {
  runId: string;
  owner: string;
  status: Extract<RunStatus, "succeeded" | "failed" | "cancelled">;
  output?: unknown;
  error?: string | null;
  cursor?: RunCursor | null;
}): Promise<boolean> {
  const [row] = await db()
    .update(runs)
    .set({
      status: options.status,
      output: options.output ?? null,
      error: options.error ?? null,
      finishedAt: sql`now()` as unknown as Date,
      heartbeatAt: sql`now()` as unknown as Date,
      cursor: options.cursor ?? null,
      leaseOwner: null,
      leaseExpiresAt: null,
    })
    .where(and(eq(runs.id, options.runId), eq(runs.leaseOwner, options.owner)))
    .returning({ id: runs.id });

  return row !== undefined;
}

/**
 * Finish a run nobody holds — a `queued` run cancelled before any worker saw it, or
 * one whose enqueue failed outright. Guarded on the lease being *absent* so it can
 * never close a run that is genuinely executing.
 */
export async function finishUnclaimedRun(options: {
  runId: string;
  status: Extract<RunStatus, "failed" | "cancelled">;
  error: string;
}): Promise<boolean> {
  const [row] = await db()
    .update(runs)
    .set({
      status: options.status,
      error: options.error,
      finishedAt: sql`now()` as unknown as Date,
      heartbeatAt: sql`now()` as unknown as Date,
      leaseOwner: null,
      leaseExpiresAt: null,
    })
    .where(
      and(
        eq(runs.id, options.runId),
        inArray(runs.status, NON_TERMINAL),
        or(isNull(runs.leaseExpiresAt), lt(runs.leaseExpiresAt, sql`now()`)),
      ),
    )
    .returning({ id: runs.id });

  return row !== undefined;
}

/**
 * Ask a run to stop. Does not stop it — the engine reads this at its next checkpoint,
 * which is after the step it is currently running.
 *
 * Cancellation is therefore honest about its granularity: a node already talking to
 * Gmail is not interrupted, because there is no way to un-send a request that is in
 * flight, and pretending otherwise would be worse than saying so in the UI.
 */
export async function requestCancel(options: {
  runId: string;
  ownerId: string;
}): Promise<Run | null> {
  const [row] = await db()
    .update(runs)
    .set({ cancelRequestedAt: sql`now()` as unknown as Date })
    .where(
      and(
        eq(runs.id, options.runId),
        eq(runs.ownerId, options.ownerId),
        inArray(runs.status, NON_TERMINAL),
      ),
    )
    .returning();

  return row ?? null;
}

/**
 * Fail the runs that nothing is coming back for. This replaces Chapter 1's
 * `reapStaleRuns`, and the difference is the whole point of Phase 17.
 *
 * `reapStaleRuns` failed every `running` run whose heartbeat had gone quiet, because
 * a quiet run *was* a lost run. Now it depends on the mode, and sweeping
 * indiscriminately would destroy the durability this phase adds — a durable run
 * between deliveries looks exactly like an abandoned one:
 *
 *   sync                        nothing will ever resume it. Fail it.
 *   durable, deliveries spent   the queue has given up. Fail it.
 *   durable, never delivered    the enqueue itself failed, so no task exists. Fail it.
 *   durable, otherwise          a redelivery is expected. **Leave it alone.**
 *
 * Still called before listing runs rather than on a timer, because Cloud Run scales to
 * zero and a timer would not fire; the cron tick calls it across every owner too, so a
 * signed-out user's abandoned run is not left pending on nobody looking at it.
 */
export async function sweepAbandonedRuns(ownerId?: string): Promise<number> {
  const lapsed = or(
    isNull(runs.leaseExpiresAt),
    lt(runs.leaseExpiresAt, agoSeconds(SWEEP_GRACE_MS / 1000)),
  );

  const hopeless = or(
    eq(runs.mode, "sync"),
    sql`${runs.attempt} >= ${MAX_DELIVERIES}`,
    and(eq(runs.status, "queued"), eq(runs.attempt, 0)),
  );

  const swept = await db()
    .update(runs)
    .set({
      status: "failed",
      error:
        "Run was interrupted before it finished — the server restarted or the request was cut short.",
      finishedAt: sql`now()` as unknown as Date,
      leaseOwner: null,
      leaseExpiresAt: null,
    })
    .where(
      and(
        ...(ownerId ? [eq(runs.ownerId, ownerId)] : []),
        inArray(runs.status, NON_TERMINAL),
        lt(runs.heartbeatAt, agoSeconds(SWEEP_GRACE_MS / 1000)),
        lapsed,
        hopeless,
      ),
    )
    .returning({ id: runs.id });

  return swept.length;
}
