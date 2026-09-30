import { sql } from "drizzle-orm";

import { db } from "@/db";
import { rootKeyProvider } from "@/lib/crypto";
import { queueConfig } from "@/lib/engine/queue";

export const dynamic = "force-dynamic";

/** Strips anything that could carry credentials out of a driver error. */
function safeMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/[a-z]+:\/\/[^\s]*@[^\s]*/gi, "[redacted-connection-string]");
}

/**
 * Liveness plus a real database round trip. Used by the deployment verification
 * steps in DEPLOYMENT.md, so it must reflect actual reachability — not just that
 * the process is up. 503 when the database cannot be reached.
 *
 * **`queue` is here because of how Phase 17 can fail.** `enqueueRun` degrades to
 * in-process execution when Cloud Tasks is not configured, which is right on a
 * developer machine and is a silent no-op in production: durable runs would still work,
 * still be leased and still be checkpointed, and would simply stop surviving a redeploy
 * with nothing to say so. Reporting the configuration makes that observable from
 * outside, which is what a deployed verification can actually assert.
 *
 * **`rootKey` is here for exactly the same reason — Phase 21.** A deployment with no
 * `ROOT_KEY_SECRET` falls back to `ENCRYPTION_KEY`, which is correct locally and, in
 * production, is the Chapter 1 problem back without the Chapter 1 warning: it works, so
 * nothing reports it, and the root key silently cannot be rotated. Naming the *provider*
 * makes that assertable from outside the container.
 *
 * It names the queue and the provider, never a credential and never a key. The access token
 * is minted per instance from the metadata server, the root key is never serialised, and the
 * version label names immutable bytes rather than revealing any of them.
 */
export async function GET() {
  const startedAt = Date.now();

  try {
    await db().execute(sql`select 1`);
    const queue = await queueConfig();
    return Response.json({
      status: "ok",
      database: "reachable",
      databaseLatencyMs: Date.now() - startedAt,
      queue: queue
        ? { configured: true, ...queue }
        : { configured: false, reason: "TASKS_QUEUE is not set, or its location is unknown" },
      rootKey: { provider: rootKeyProvider() },
      revision: process.env.K_REVISION ?? "local",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json(
      {
        status: "error",
        database: "unreachable",
        error: safeMessage(error),
        revision: process.env.K_REVISION ?? "local",
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
