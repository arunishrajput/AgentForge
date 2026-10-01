import { sql } from "drizzle-orm";

import { db } from "@/db";
import { rootKeyProvider } from "@/lib/crypto";
import { queueConfig } from "@/lib/engine/queue";
import { listNodes } from "@/lib/nodes";

export const dynamic = "force-dynamic";

/** Strips anything that could carry credentials out of a driver error. */
function safeMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/[a-z]+:\/\/[^\s]*@[^\s]*/gi, "[redacted-connection-string]");
}

/** One dependency's verdict. `detail` says what to do, never what the value is. */
interface Check {
  name: string;
  status: "ok" | "degraded" | "error";
  latencyMs?: number;
  detail?: string;
}

/**
 * **Dependency status, not a bare `ok` — Phase 22 rewrote this route.**
 *
 * It was already the place this product records "a silent misconfiguration should be
 * visible from outside the container": Phase 17 added `queue` because an unconfigured
 * Cloud Tasks degrades to in-process execution that works and says nothing, and Phase 21
 * added `rootKey` because an unset `ROOT_KEY_SECRET` falls back to `ENCRYPTION_KEY` and
 * also works and also says nothing. Both are the same failure — *correct behaviour that
 * quietly lost a guarantee* — and neither is visible in a 200.
 *
 * Phase 22 generalises that into checks with verdicts, and adds the two remaining pieces
 * of a deployment that can be wrong while the process is healthy:
 *
 *   database   a real round trip. 503 when it cannot be reached
 *   schema     **how many migrations the database has applied.** A container serving code
 *              that expects a column the database does not have is the single failure
 *              mode a deploy can introduce that every other check here reports as fine —
 *              and it was a live risk in four of the last five phases, each of which
 *              shipped a migration. It is a number, not a plan: `/api/health` says what
 *              is applied, and `verify-schema.mjs` says whether that is the right number
 *   registry   the node count, which is what a run's dispatch resolves against
 *
 * **`status` is a rollup with three values**, so an uptime check can distinguish "down"
 * from "up, with a guarantee missing":
 *
 *   ok         everything a production deployment should have
 *   degraded   serving correctly, with something that will bite later — 200, deliberately,
 *              because failing a health check would take a working revision out of service
 *              over a configuration warning
 *   error      the database is unreachable. 503
 *
 * **What it still may not say.** It names a queue, a provider and a count — never a
 * credential, never a key, never a connection string. It is unauthenticated, so every
 * field added here is a field added to the public internet; the test for a new one is
 * whether it would help an operator more than it would help somebody mapping the system.
 *
 * **Phase 25 applied that test to the fields already here, and one failed it.** The queue
 * block published `project` as well as `location` and `queue`. The last two earn their
 * place: `TASKS_QUEUE` and `TASKS_LOCATION` are copied environment variables, so they
 * *can* point at the wrong queue while `configured` is perfectly true, and that is the
 * silent misconfiguration this route exists to expose. `project` cannot — it comes from
 * the metadata server, which is the documented reason `TASKS_PROJECT` is deliberately
 * left unset (`PROGRESS.md` → *Env vars set*). A value that cannot be wrong has no
 * diagnostic value, so all it did was publish the GCP project id — which, unlike the
 * project *number* in this service's hostname, was not otherwise public. Removed.
 *
 * This route is itself one of the unauthenticated surfaces and is now listed as one in
 * `SECURITY.md`; `scripts/verify-security.mjs` enumerates every route and fails if that
 * table and reality disagree in either direction.
 */
export async function GET() {
  const startedAt = Date.now();
  const checks: Check[] = [];

  let databaseLatencyMs: number;
  let migrations: number | null = null;

  try {
    await db().execute(sql`select 1`);
    databaseLatencyMs = Date.now() - startedAt;
    checks.push({ name: "database", status: "ok", latencyMs: databaseLatencyMs });
  } catch (error) {
    // The only condition that is a 503. Everything below it needs the database, so the
    // response stops here rather than reporting a cascade of derived failures.
    return Response.json(
      {
        status: "error",
        database: "unreachable",
        checks: [{ name: "database", status: "error", detail: safeMessage(error) }],
        error: safeMessage(error),
        revision: process.env.K_REVISION ?? "local",
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }

  /**
   * Drizzle records every applied migration in its own table. Read in the same request
   * that has just woken the database, so it costs a statement and not a wake — which is
   * the distinction Neon's free plan actually meters (`DEPLOYMENT.md`).
   *
   * A missing table is not an error: it is what a database looks like before the first
   * migration, and on a developer machine that is an ordinary state rather than a fault.
   */
  try {
    const result = await db().execute(
      sql`select count(*)::int as applied from drizzle.__drizzle_migrations`,
    );
    const rows = (result as unknown as { rows?: Array<{ applied: number }> }).rows ?? [];
    migrations = rows[0] ? Number(rows[0].applied) : null;
    checks.push({
      name: "schema",
      status: migrations === null ? "degraded" : "ok",
      detail: migrations === null ? "No migration history — has db:migrate been run?" : undefined,
    });
  } catch {
    checks.push({
      name: "schema",
      status: "degraded",
      detail: "The migration history could not be read.",
    });
  }

  const queue = await queueConfig();
  checks.push(
    queue
      ? { name: "queue", status: "ok" }
      : {
          name: "queue",
          status: "degraded",
          detail: "TASKS_QUEUE is unset — runs execute in-process and do not survive a redeploy.",
        },
  );

  const provider = rootKeyProvider();
  checks.push(
    provider === "secret-manager"
      ? { name: "rootKey", status: "ok" }
      : {
          name: "rootKey",
          status: "degraded",
          detail: "ROOT_KEY_SECRET is unset — the root key cannot be rotated without re-encrypting.",
        },
  );

  const registry = listNodes().length;
  checks.push({ name: "registry", status: registry > 0 ? "ok" : "error" });

  const status = checks.some((check) => check.status === "error")
    ? "error"
    : checks.some((check) => check.status === "degraded")
      ? "degraded"
      : "ok";

  return Response.json({
    status,
    /**
     * The Phase 17 and Phase 21 fields, kept at the top level and unchanged. Phase 13's
     * `verify-api.mjs`, `verify-durable.mjs` and `verify-vault.mjs` all assert on them,
     * and so does `DEPLOYMENT.md`'s verification — this route is a contract with the
     * scripts that check deployments, so Phase 22 added to it and moved nothing.
     */
    database: "reachable",
    databaseLatencyMs,
    queue: queue
      ? // `project` is deliberately dropped: see the note above. Spelled out field by field
        // rather than spread-and-delete, so a field added to `QueueConfig` later has to be
        // named here before it reaches the public internet.
        { configured: true, location: queue.location, queue: queue.queue }
      : { configured: false, reason: "TASKS_QUEUE is not set, or its location is unknown" },
    rootKey: { provider },
    checks,
    migrations,
    registry,
    revision: process.env.K_REVISION ?? "local",
    timestamp: new Date().toISOString(),
  });
}
