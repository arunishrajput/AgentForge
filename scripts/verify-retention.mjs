/**
 * **Run retention, verified against the real database — Phase 33.**
 *
 *   node --import ./scripts/test-register.mjs --env-file=.env scripts/verify-retention.mjs
 *
 * `BUILD_PLAN.md` → *Phase 33* → *Validation*: "a retention dry run reports what it would delete,
 * then deletes in a throwaway workspace." This calls the application's own `pruneRuns` — the one
 * statement the daily sweep runs (`src/lib/runs/retention.ts`) — narrowed to a workspace made here
 * and filled with runs on every edge of the rule, then deleted with everything in it:
 *
 *   old       finished 40 days ago                          → goes
 *   long      started 40 days ago, finished yesterday        → kept: age is from when it finished
 *   waiting   started 40 days ago, still waiting             → kept: never a run that is not finished
 *   running   started 40 days ago, still running             → kept, likewise
 *   busy      202 finished today, in one workflow            → the 2 oldest go: 200 a workflow
 *
 * It also asks, as a dry run, what the next sweep would delete across every workspace — and
 * deletes nothing there. It needs no deployed service: the rule is a statement on the database,
 * and the deployed sweep's own outcome (`prunedRuns`) is read by `verify-timers`/the tick.
 */
import { neon } from "@neondatabase/serverless";

import { MAX_PRUNED_PER_SWEEP, pruneRuns, RUN_RETENTION_DAYS, RUNS_KEPT_PER_WORKFLOW } from "../src/lib/runs/retention.ts";
import { verificationUser } from "./verify-user.mjs";

const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);

let failures = 0;
function check(label, condition, detail) {
  const passed = Boolean(condition);
  if (!passed) failures += 1;
  console.log(`${passed ? "PASS" : "FAIL"}  ${label}${passed || detail === undefined ? "" : `\n        ${detail}`}`);
}

const DAY = 86_400_000;
const ago = (days) => new Date(Date.now() - days * DAY);
let arena = null;

try {
  console.log(`\nRun retention — ${RUN_RETENTION_DAYS} days, ${RUNS_KEPT_PER_WORKFLOW} a workflow, ${MAX_PRUNED_PER_SWEEP} a sweep\n`);

  const user = await verificationUser(sql);
  if (!user) throw new Error("No user row exists — sign in once before running this.");

  [{ id: arena }] = await sql.query(
    `insert into "workspace" ("id", "name", "createdBy", "personal") values (gen_random_uuid()::text, 'zzzz-retention arena', $1, false) returning "id"`,
    [user.id],
  );
  await sql.query('insert into "workspace_member" ("workspaceId", "userId", "role") values ($1, $2, $3)', [arena, user.id, "owner"]);

  const workflow = async (name) =>
    (
      await sql.query(
        `insert into "workflow" ("id", "name", "ownerId", "workspaceId", "graph", "webhookToken")
         values (gen_random_uuid()::text, $1, $2, $3, '{"version":1,"nodes":[],"edges":[]}'::jsonb, $4) returning "id"`,
        [name, user.id, arena, crypto.randomUUID().replaceAll("-", "")],
      )
    )[0].id;
  const quiet = await workflow("zzzz-retention quiet");
  const busy = await workflow("zzzz-retention busy");

  /** One run with two steps, so the cascade is counted too. */
  const run = async (workflowId, status, startedAt, finishedAt) => {
    const [{ id }] = await sql.query(
      `insert into "run" ("id", "workflowId", "ownerId", "workspaceId", "status", "trigger", "startedAt", "finishedAt", "heartbeatAt")
       values (gen_random_uuid()::text, $1, $2, $3, $4, 'manual', $5, $6, $5) returning "id"`,
      [workflowId, user.id, arena, status, startedAt, finishedAt],
    );
    await sql.query(
      `insert into "run_step" ("id", "runId", "seq", "nodeId", "nodeType", "status")
       values (gen_random_uuid()::text, $1, 0, 'trigger', 'core.manual_trigger', 'succeeded'),
              (gen_random_uuid()::text, $1, 1, 'say', 'core.log', 'succeeded')`,
      [id],
    );
    return id;
  };

  const old = [
    await run(quiet, "succeeded", ago(41), ago(40)),
    await run(quiet, "failed", ago(41), ago(40)),
    await run(quiet, "cancelled", ago(35), ago(35)),
  ];
  const kept = [
    await run(quiet, "succeeded", ago(40), ago(1)), // a long wait, finished yesterday
    await run(quiet, "waiting", ago(40), null),
    await run(quiet, "running", ago(40), null),
    await run(quiet, "succeeded", ago(2), ago(2)),
  ];
  // 202 finished runs today in one workflow, a minute apart; the two oldest are past the count.
  const busyRuns = await sql.query(
    `insert into "run" ("id", "workflowId", "ownerId", "workspaceId", "status", "trigger", "startedAt", "finishedAt", "heartbeatAt")
     select gen_random_uuid()::text, $1, $2, $3, 'succeeded', 'webhook',
            now() - make_interval(mins => g), now() - make_interval(mins => g) + interval '2 seconds', now()
     from generate_series(1, $4) g
     returning "id", "startedAt"`,
    [busy, user.id, arena, RUNS_KEPT_PER_WORKFLOW + 2],
  );
  const overflow = [...busyRuns]
    .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt))
    .slice(0, 2)
    .map((row) => row.id);
  const expected = new Set([...old, ...overflow]);

  const count = async () =>
    (await sql.query('select count(*)::int as n from "run" where "workspaceId" = $1', [arena]))[0].n;
  const before = await count();
  check("the throwaway workspace holds every edge of the rule", before === old.length + kept.length + busyRuns.length, `${before}`);

  // --- the dry run: what would go, and nothing gone ---
  const dry = await pruneRuns({ dryRun: true, workspaceId: arena, withIds: true });
  console.log(`        dry run: ${dry.runs} runs and ${dry.steps} steps would be deleted`);
  check(
    "the dry run names exactly the runs past retention — the old ones and the two past the count",
    dry.runs === expected.size && dry.ids.length === expected.size && dry.ids.every((id) => expected.has(id)),
    `would delete ${JSON.stringify(dry.ids)}, expected ${JSON.stringify([...expected])}`,
  );
  check("and counts their steps, which go with them", dry.steps === old.length * 2, `${dry.steps} steps`);
  check("and deleted nothing", (await count()) === before);
  check(
    "it never names a run that is not finished, however old",
    !dry.ids.includes(kept[1]) && !dry.ids.includes(kept[2]),
  );
  check("age is counted from when a run finished, not when it started", !dry.ids.includes(kept[0]));

  // --- the real one, in the throwaway workspace only ---
  const pruned = await pruneRuns({ workspaceId: arena, withIds: true });
  check(
    "pruning deletes exactly what the dry run said",
    pruned.runs === dry.runs && pruned.ids.length === dry.ids.length && pruned.ids.every((id) => expected.has(id)),
    JSON.stringify(pruned),
  );
  const left = await sql.query('select "id" from "run" where "id" = any($1)', [[...expected]]);
  check("they are gone from the database", left.length === 0, `${left.length} left`);
  const steps = await sql.query('select count(*)::int as n from "run_step" where "runId" = any($1)', [[...expected]]);
  check("and their steps with them", steps[0].n === 0, `${steps[0].n} steps left`);
  const survivors = await sql.query('select count(*)::int as n from "run" where "workflowId" = $1', [busy]);
  check(`the busy workflow keeps exactly its newest ${RUNS_KEPT_PER_WORKFLOW}`, survivors[0].n === RUNS_KEPT_PER_WORKFLOW, `${survivors[0].n}`);
  const stillHere = await sql.query('select count(*)::int as n from "run" where "id" = any($1)', [kept]);
  check("every run the rule keeps is still there", stillHere[0].n === kept.length);

  const again = await pruneRuns({ workspaceId: arena });
  check("a second prune finds nothing — it is idempotent", again.runs === 0, JSON.stringify(again));

  // --- the real data, read and not touched ---
  const everywhere = await pruneRuns({ dryRun: true });
  console.log(`        across every workspace, the next sweep would delete ${everywhere.runs} runs and ${everywhere.steps} steps`);
  check("a dry run across every workspace answers, and deletes nothing", Number.isInteger(everywhere.runs));
} catch (error) {
  failures += 1;
  console.error("Verification threw:", error);
} finally {
  if (arena) await sql.query('delete from "workspace" where "id" = $1', [arena]).catch(() => {});
}

console.log(failures === 0 ? "\nRetention verified.\n" : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
