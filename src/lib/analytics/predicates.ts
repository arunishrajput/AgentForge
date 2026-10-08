import { and, eq, sql, type SQL } from "drizzle-orm";

import { runSteps } from "@/db/schema";

/**
 * **Which steps are a model call — Phase 33.** Kept apart from `queries.ts`, which talks to the
 * database, so the rule is asserted on its rendered SQL (`analytics.test.ts`).
 *
 * A step is counted when it **ran and succeeded** and its output names the model that answered.
 * Until Phase 33 the status was not asked, and two kinds of step carry an agent's output without
 * having called anything: a node **switched off** downstream of an agent passes the agent's output
 * through as its own (Phase 30), and a **retry** carries the agent's step over as `reused` (Phase
 * 33). Both would have counted the same call — and its tokens — twice.
 */
export function modelCallSteps(): SQL {
  return and(
    eq(runSteps.status, "succeeded"),
    sql`${runSteps.output} ? 'model' and jsonb_typeof(${runSteps.output}->'model') = 'string'`,
  )!;
}
