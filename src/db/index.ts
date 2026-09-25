import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";

import { required } from "@/lib/env";
import * as schema from "./schema";

/**
 * Neon's pooled endpoint over HTTP. Chosen over a WebSocket pool because every
 * query the MVP makes is a single statement — `@auth/drizzle-adapter` uses no
 * transactions, verified against the installed package. If Phase 3's engine needs
 * a real transaction, switch this module to `drizzle-orm/neon-serverless`; nothing
 * outside this file should have to change.
 *
 * Constructed lazily: `neon()` throws on a missing connection string, and
 * `next build` imports route modules without a populated environment.
 */
let instance: NeonHttpDatabase<typeof schema> | null = null;

export function db(): NeonHttpDatabase<typeof schema> {
  if (!instance) {
    instance = drizzle(neon(required("DATABASE_URL")), { schema });
  }
  return instance;
}

export { schema };
