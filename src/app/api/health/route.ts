import { sql } from "drizzle-orm";

import { db } from "@/db";

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
 */
export async function GET() {
  const startedAt = Date.now();

  try {
    await db().execute(sql`select 1`);
    return Response.json({
      status: "ok",
      database: "reachable",
      databaseLatencyMs: Date.now() - startedAt,
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
