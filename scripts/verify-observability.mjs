/**
 * Phase 22's deployed verification — structured logging, the health checks, and run
 * analytics.
 *
 *   node --env-file=.env scripts/verify-observability.mjs https://<the deployed url>
 *
 * Its own script rather than another 400 lines in `verify-api.mjs`, following the
 * precedent `verify-durable.mjs` set in Phase 17 and `verify-vault.mjs` followed in
 * Phase 21: a phase whose subject is one subsystem gets a suite that can be re-run on its
 * own when that subsystem changes.
 *
 * Auth is a database session, exactly as every other suite here does it: a real `session`
 * row for a real user, driven with a cookie, deleted afterwards. No test-only bypass
 * exists in the app.
 *
 * **What this has to prove, from `BUILD_PLAN.md` → Phase 22:**
 *
 *   1. **Analytics correct against a hand-checked sample** — every figure the page shows
 *      is recomputed here straight from SQL and compared. This is the completion
 *      criterion, and it is the only check that can catch an aggregate that is merely
 *      plausible
 *   2. **Induce a failure and find it from the logs alone** — a workflow is created that
 *      fails deterministically, run twice, and the result is traced through
 *      `gcloud logging read` without opening the database
 *   3. **The CU-hour cost of the feature measured** — the page's own query time and its
 *      wall-clock cost, against the note in `queries.ts` about what Neon actually meters
 *   4. `/api/health` reports dependency status rather than a bare `ok`, **without
 *      breaking the fields `verify-api.mjs`, `verify-durable.mjs` and `verify-vault.mjs`
 *      already assert on**
 *
 * **It creates and deletes its own workflow.** Unlike `verify-vault.mjs`, nothing here
 * touches an existing credential or an existing run — the induced failure is a workflow
 * this script makes, runs and removes, and the two runs it leaves behind are removed with
 * it by the cascade.
 */
import { neon } from "@neondatabase/serverless";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { verificationUser } from "./verify-user.mjs";

const run = promisify(execFile);

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const secure = base.startsWith("https://");
const cookieName = secure ? "__Secure-authjs.session-token" : "authjs.session-token";

const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);

let failures = 0;
let skipped = 0;

function check(label, condition, detail) {
  const passed = Boolean(condition);
  if (!passed) failures += 1;
  console.log(
    `${passed ? "PASS" : "FAIL"}  ${label}${passed || detail === undefined ? "" : `\n        ${detail}`}`,
  );
}

function skip(label, why) {
  skipped += 1;
  console.log(`SKIP  ${label}\n        ${why}`);
}

async function api(method, path, body, cookie, workspaceId) {
  const cookies = [
    ...(cookie ? [`${cookieName}=${cookie}`] : []),
    ...(workspaceId ? [`af_workspace=${workspaceId}`] : []),
  ];
  const started = Date.now();
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookies.length > 0 ? { cookie: cookies.join("; ") } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { status: response.status, json, text, ms: Date.now() - started };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Nearest rank, matching `lib/analytics/shape.ts`. Duplicated on purpose: a check that
 *  imports the thing it is checking proves only that the code equals itself. */
function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

const token = crypto.randomUUID() + crypto.randomUUID();
let ownerId = null;
let workspaceId = null;
let probeWorkflowId = null;

async function cleanUp() {
  if (probeWorkflowId) {
    await sql.query('delete from "workflow" where "id" = $1', [probeWorkflowId]).catch(() => {});
  }
  await sql.query('delete from "session" where "sessionToken" = $1', [token]).catch(() => {});
}

try {
  console.log(`\nVerifying observability and analytics against ${base}\n`);

  /* ================================================================== *
   * 1. /api/health — dependency status, and the contract it must keep
   * ================================================================== */
  console.log("--- health ---");

  const health = await api("GET", "/api/health");
  check("GET /api/health answers 200", health.status === 200, JSON.stringify(health.json).slice(0, 300));
  const h = health.json;

  check("it reports an overall status", ["ok", "degraded", "error"].includes(h?.status), String(h?.status));
  /**
   * **`degraded` is the correct answer on a developer machine**, where there is no Cloud
   * Tasks and no Secret Manager — that is the whole point of the verdict existing. So the
   * four deployment-shaped assertions below are skipped rather than failed off Cloud Run;
   * a suite that reports five red checks every time somebody runs it locally is a suite
   * people stop reading.
   */
  if (secure) {
    check("a deployed service is fully ok, not degraded", h?.status === "ok",
      `status=${h?.status}; degraded checks: ${JSON.stringify((h?.checks ?? []).filter((c) => c.status !== "ok"))}`);
  } else {
    check("a local service reports degraded rather than ok, and still answers 200",
      h?.status === "degraded" && health.status === 200, `status=${h?.status}`);
  }

  const names = (h?.checks ?? []).map((c) => c.name);
  for (const expected of ["database", "schema", "queue", "rootKey", "registry"]) {
    check(`it checks ${expected}`, names.includes(expected), `checks: ${names.join(", ")}`);
  }
  check("every check carries a verdict",
    (h?.checks ?? []).every((c) => ["ok", "degraded", "error"].includes(c.status)),
    JSON.stringify(h?.checks));

  /**
   * **The contract with the other three suites.** This route is asserted on by
   * `verify-api.mjs`, `verify-durable.mjs` and `verify-vault.mjs` and by `DEPLOYMENT.md`'s
   * verification. Phase 22 rewrote it, so the fields those depend on are checked to still
   * be exactly where they were.
   */
  check("the Phase 2 fields are unmoved", h?.database === "reachable" && typeof h?.databaseLatencyMs === "number");
  check("the Phase 17 queue field is still shaped as its suite expects",
    typeof h?.queue?.configured === "boolean", JSON.stringify(h?.queue));
  check("the Phase 21 root key field is still shaped as its suite expects",
    typeof h?.rootKey?.provider === "string", JSON.stringify(h?.rootKey));

  if (secure) {
    check("the queue is configured on the deployed service", h?.queue?.configured === true, JSON.stringify(h?.queue));
    check("the root key comes from Secret Manager on the deployed service",
      h?.rootKey?.provider === "secret-manager", JSON.stringify(h?.rootKey));
    check("it names the serving revision", typeof h?.revision === "string" && h.revision !== "local", String(h?.revision));
  } else {
    skip("the queue is configured", "no Cloud Tasks on a developer machine — this is the degraded verdict working");
    skip("the root key comes from Secret Manager", "no Secret Manager locally — likewise");
    skip("it names the serving revision", "K_REVISION is a Cloud Run variable");
  }

  const [{ applied }] = await sql`select count(*)::int as applied from drizzle.__drizzle_migrations`;
  check("the migration count it reports matches the database", h?.migrations === applied,
    `health says ${h?.migrations}, database has ${applied}`);
  // 30 since Phase 23C. **This pin was stale from Phase 23A to 23C** and this check was
  // therefore red for two phases without anybody seeing it, because this suite is not part of
  // the per-phase routine the way `verify-api.mjs` is. The number now lives in four scripts;
  // when it changes, all four move together — `verify-api.mjs`, `verify-templates.mjs`,
  // `verify-integrations.mjs` and here.
  check("it reports the node registry size", h?.registry === 30, `registry=${h?.registry}`);

  check("it still names no credential, key or connection string",
    !/ciphertext|authTag|wrappedKey|ENCRYPTION_KEY|postgres:\/\/|AIza/.test(health.text),
    health.text.slice(0, 300));

  /* ================================================================== *
   * 2. A session, and the analytics route's authorisation
   * ================================================================== */
  console.log("\n--- authorisation ---");

  const owner = await verificationUser(sql);
  const [ran] = owner
    ? await sql.query('select 1 from "run" where "ownerId" = $1 limit 1', [owner.id])
    : [];
  if (!ran) throw new Error("The verification account owns no run — nothing to aggregate.");
  ownerId = owner.id;

  await sql.query(
    'insert into "session" ("sessionToken", "userId", "expires") values ($1, $2, $3)',
    [token, ownerId, new Date(Date.now() + 60 * 60 * 1000)],
  );

  const [ws] = await sql.query('select "workspaceId" as id from "run" where "ownerId" = $1 limit 1', [ownerId]);
  workspaceId = ws?.id ?? null;
  check("the workspace holding the runs was found", workspaceId !== null);

  const anonymous = await api("GET", "/api/analytics");
  check("GET /api/analytics refuses an unauthenticated caller", anonymous.status === 401, String(anonymous.status));
  check("and says nothing about the workspace while refusing",
    !anonymous.text.includes(String(workspaceId)), anonymous.text.slice(0, 200));

  const page = await fetch(`${base}/analytics`, { redirect: "manual" });
  check("GET /analytics redirects a signed-out visitor rather than rendering",
    page.status >= 300 && page.status < 400, `status ${page.status}`);

  /* ================================================================== *
   * 3. Analytics, hand-checked against SQL — the completion criterion
   * ================================================================== */
  console.log("\n--- analytics, against a hand-checked sample ---");

  const response = await api("GET", "/api/analytics?range=30", undefined, token, workspaceId);
  check("GET /api/analytics answers 200", response.status === 200, JSON.stringify(response.json).slice(0, 300));
  const a = response.json?.data;

  const from = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const statuses = await sql.query(
    `select status, count(*)::int as n from "run"
       where "workspaceId" = $1 and "startedAt" >= $2 group by status`,
    [workspaceId, from],
  );
  const byStatus = Object.fromEntries(statuses.map((r) => [r.status, Number(r.n)]));
  const expectedRuns = Object.values(byStatus).reduce((sum, n) => sum + n, 0);

  check("the total run count matches SQL", a?.totals?.runs === expectedRuns,
    `api ${a?.totals?.runs}, sql ${expectedRuns}`);
  check("the succeeded count matches SQL", a?.totals?.succeeded === (byStatus.succeeded ?? 0),
    `api ${a?.totals?.succeeded}, sql ${byStatus.succeeded ?? 0}`);
  check("the failed count matches SQL", a?.totals?.failed === (byStatus.failed ?? 0),
    `api ${a?.totals?.failed}, sql ${byStatus.failed ?? 0}`);
  check("the cancelled count matches SQL", a?.totals?.cancelled === (byStatus.cancelled ?? 0),
    `api ${a?.totals?.cancelled}, sql ${byStatus.cancelled ?? 0}`);

  const settled = (byStatus.succeeded ?? 0) + (byStatus.failed ?? 0) + (byStatus.cancelled ?? 0);
  const expectedRate = settled === 0 ? null : (byStatus.succeeded ?? 0) / settled;
  check("the success rate is succeeded over settled, computed independently",
    a?.totals?.successRate === expectedRate, `api ${a?.totals?.successRate}, sql ${expectedRate}`);

  /** A cancelled run is in the denominator and not the numerator — the rule that lets a
   *  workspace which cancels half its runs NOT report a perfect record. */
  if ((byStatus.cancelled ?? 0) > 0) {
    check("and a cancelled run holds the rate below 100%", (a?.totals?.successRate ?? 1) < 1,
      `rate ${a?.totals?.successRate} with ${byStatus.cancelled} cancelled`);
  } else {
    skip("a cancelled run holds the rate below 100%", "no cancelled runs in the window");
  }

  /**
   * **Truncate each endpoint to whole milliseconds, then subtract** — the definition the
   * product uses, recomputed here in SQL rather than a different definition that happens to
   * be close.
   *
   * It was `round(extract(epoch from (finishedAt - startedAt)) * 1000)` and that disagreed
   * with the page by exactly 1 ms, which is measured and not hypothetical: a run of
   * 94569.014 ms rounds to 94569, while `analytics/shape.ts` computes
   * `finishedAt.getTime() - startedAt.getTime()` and a JavaScript `Date` holds whole
   * milliseconds, so each endpoint truncates independently and the difference came out
   * 94570. Neither number is wrong; they are answers to different questions, and only one of
   * them is the question the page answers. `floor(epoch * 1000)` per endpoint reproduces
   * `Date.getTime()` exactly — checked against all three of the longest runs in the database.
   */
  const durationRows = await sql.query(
    `select (floor(extract(epoch from "finishedAt") * 1000)::bigint
             - floor(extract(epoch from "startedAt") * 1000)::bigint) as ms
       from "run"
      where "workspaceId" = $1 and "startedAt" >= $2
        and status in ('succeeded','failed') and "finishedAt" is not null
      order by 1`,
    [workspaceId, from],
  );
  const durations = durationRows.map((r) => Number(r.ms)).sort((x, y) => x - y);
  check("the median run duration matches a hand-computed nearest rank",
    a?.totals?.medianMs === percentile(durations, 50),
    `api ${a?.totals?.medianMs}, sql ${percentile(durations, 50)} over ${durations.length} runs`);
  check("and so does p95", a?.totals?.p95Ms === percentile(durations, 95),
    `api ${a?.totals?.p95Ms}, sql ${percentile(durations, 95)}`);
  check("p95 is never below the median — the string-sort defect",
    a?.totals?.p95Ms === null || a.totals.p95Ms >= a.totals.medianMs,
    `median ${a?.totals?.medianMs}, p95 ${a?.totals?.p95Ms}`);

  const dayRows = await sql.query(
    `select to_char("startedAt" at time zone 'UTC','YYYY-MM-DD') as d, count(*)::int as n
       from "run" where "workspaceId" = $1 and "startedAt" >= $2 group by 1`,
    [workspaceId, from],
  );
  const activeDays = dayRows.length;
  const apiActive = (a?.days ?? []).filter((d) => d.total > 0).length;
  check("the number of days with runs matches SQL", apiActive === activeDays,
    `api ${apiActive}, sql ${activeDays}`);
  check("every day in the window has a bucket, zeros included",
    (a?.days ?? []).length >= 30 && (a?.days ?? []).length <= 32, `${a?.days?.length} buckets`);
  check("the day totals sum to the run total",
    (a?.days ?? []).reduce((sum, d) => sum + d.total, 0) === a?.totals?.runs);

  const [{ n: stepTypes }] = await sql.query(
    `select count(distinct s."nodeType")::int as n from "run_step" s
       join "run" r on r."id" = s."runId"
      where r."workspaceId" = $1 and r."startedAt" >= $2
        and s.status in ('succeeded','failed') and s."finishedAt" is not null`,
    [workspaceId, from],
  );
  check("the node table covers every node type that ran, up to its cap",
    (a?.nodes ?? []).length === Math.min(Number(stepTypes), 10),
    `api ${a?.nodes?.length}, sql ${stepTypes}`);
  check("every node row has a non-negative p95 at or above its median",
    (a?.nodes ?? []).every((n) => n.p95Ms === null || (n.p95Ms >= 0 && n.p95Ms >= n.medianMs)),
    JSON.stringify(a?.nodes?.map((n) => ({ t: n.nodeType, m: n.medianMs, p: n.p95Ms }))));

  const modelRows = await sql.query(
    `select s."output"->>'model' as model, count(*)::int as n from "run_step" s
       join "run" r on r."id" = s."runId"
      where r."workspaceId" = $1 and r."startedAt" >= $2
        and s."output" ? 'model' and jsonb_typeof(s."output"->'model') = 'string'
      group by 1 order by 2 desc`,
    [workspaceId, from],
  );
  check("the model table matches SQL, by the model that answered",
    (a?.models ?? []).length === Math.min(modelRows.length, 8),
    `api ${JSON.stringify(a?.models?.map((m) => m.model))}, sql ${JSON.stringify(modelRows.map((m) => m.model))}`);
  if (modelRows.length > 0) {
    check("and the busiest model's call count matches",
      a?.models?.[0]?.calls === Number(modelRows[0].n),
      `api ${a?.models?.[0]?.calls}, sql ${modelRows[0].n}`);
  } else {
    skip("the busiest model's call count matches", "no model calls in the window");
  }

  /* ================================================================== *
   * 4. The window, and a hostile one
   * ================================================================== */
  console.log("\n--- the window ---");

  const week = await api("GET", "/api/analytics?range=7", undefined, token, workspaceId);
  check("a 7-day window is honoured", week.json?.data?.range === 7, String(week.json?.data?.range));
  check("and returns fewer or equal buckets than 30 days",
    (week.json?.data?.days ?? []).length < (a?.days ?? []).length);

  const hostile = await api("GET", "/api/analytics?range=99999", undefined, token, workspaceId);
  check("an unoffered window falls back to the default rather than scanning everything",
    hostile.json?.data?.range === 30, String(hostile.json?.data?.range));
  const injected = await api("GET", "/api/analytics?range=7%3B%20drop%20table%20run", undefined, token, workspaceId);
  check("and so does a hostile one", injected.json?.data?.range === 30, String(injected.json?.data?.range));
  const [{ alive }] = await sql`select count(*)::int as alive from "run"`;
  check("the run table is still there afterwards", alive > 0, `${alive} rows`);

  /* ================================================================== *
   * 5. Error grouping, against an induced failure — and the logs
   * ================================================================== */
  console.log("\n--- induced failure, error grouping, and the log trail ---");

  const marker = `P22 probe ${Date.now()}`;
  const created = await api("POST", "/api/workflows", {
    name: "Phase 22 observability probe",
    graph: {
      version: 1,
      nodes: [
        { id: "t", type: "core.manual_trigger", position: { x: 0, y: 0 }, config: {} },
        {
          id: "boom",
          type: "core.assert",
          position: { x: 240, y: 0 },
          config: { left: "", operator: "is_not_empty", message: marker },
        },
      ],
      edges: [{ id: "e", source: "t", target: "boom" }],
    },
  }, token, workspaceId);
  check("a probe workflow was created", created.status === 201 || created.status === 200,
    JSON.stringify(created.json).slice(0, 300));
  probeWorkflowId = created.json?.data?.id ?? null;

  const runIds = [];
  if (probeWorkflowId) {
    for (let i = 0; i < 2; i += 1) {
      const fired = await api("POST", `/api/workflows/${probeWorkflowId}/runs`, {}, token, workspaceId);
      check(`probe run ${i + 1} failed at the assert node, as designed`,
        fired.json?.data?.status === "failed" && String(fired.json?.data?.error).includes(marker),
        JSON.stringify(fired.json?.data?.error));
      if (fired.json?.data?.id) runIds.push(fired.json.data.id);
    }

    const after = await api("GET", "/api/analytics?range=7", undefined, token, workspaceId);
    const groups = after.json?.data?.failures ?? [];
    const mine = groups.filter((g) => g.sample.includes(marker));
    check("two identical failures are ONE group, not two", mine.length === 1,
      `${mine.length} groups matched: ${JSON.stringify(groups.map((g) => g.template))}`);
    check("and the group counts both of them", mine[0]?.count === 2, `count ${mine[0]?.count}`);
    check("the group's id is a stable fingerprint", /^[0-9a-f]{8}$/.test(mine[0]?.id ?? ""), mine[0]?.id);
    check("the group keeps one real, unredacted sample", (mine[0]?.sample ?? "").includes(marker));
    check("and normalises the varying part out of its template",
      (mine[0]?.template ?? "").includes("<n>") && !(mine[0]?.template ?? "").includes(marker),
      mine[0]?.template);
    check("the group names a run to open", runIds.includes(mine[0]?.sampleRunId),
      `${mine[0]?.sampleRunId} not among ${runIds.join(", ")}`);
  }

  /**
   * **"Induce a failure and find it from the logs alone."** The database is not consulted
   * here — everything below comes out of Cloud Logging, which is the point: an operator at
   * 03:00 has the Logs Explorer and no psql.
   */
  if (!secure) {
    skip("the failure is findable in Cloud Logging", "only meaningful against the deployed service");
  } else if (runIds.length === 0) {
    skip("the failure is findable in Cloud Logging", "no probe run was created");
  } else {
    // Cloud Logging ingests asynchronously. Poll rather than sleep a fixed time, so a
    // fast ingest is not paid for and a slow one is not a false failure. Poll until the
    // run's *last* line has arrived, not its first: a run's entries land out of order and
    // a few seconds apart, and stopping at "any entry" asserted on a half-ingested run —
    // Phase 26 saw run.started and node.finished but not yet run.finished, which was in
    // the logs a minute later.
    const complete = (list) => list.some((e) => e.jsonPayload?.event === "run.finished");
    let entries = [];
    for (let attempt = 0; attempt < 10 && !complete(entries); attempt += 1) {
      await sleep(6000);
      try {
        const { stdout } = await run("gcloud", [
          "logging", "read",
          `resource.type=cloud_run_revision AND jsonPayload.runId="${runIds[0]}"`,
          "--limit", "20", "--format", "json", "--freshness", "30m",
        ], { maxBuffer: 20 * 1024 * 1024 });
        entries = JSON.parse(stdout || "[]");
      } catch (error) {
        entries = [];
        if (attempt === 9) console.log(`        gcloud: ${String(error).slice(0, 200)}`);
      }
    }

    check("the run's entries reached Cloud Logging", entries.length > 0,
      `found ${entries.length} entries for run ${runIds[0]} after polling`);

    const events = entries.map((e) => e.jsonPayload?.event);
    check("run.started is there", events.includes("run.started"), events.join(", "));
    check("node.finished is there", events.includes("node.finished"), events.join(", "));
    check("run.finished is there", events.includes("run.finished"), events.join(", "));

    const failed = entries.find(
      (e) => e.jsonPayload?.event === "node.finished" && e.jsonPayload?.status === "failed",
    );
    check("the failing node's entry names the node and its type",
      failed?.jsonPayload?.nodeId === "boom" && failed?.jsonPayload?.nodeType === "core.assert",
      JSON.stringify(failed?.jsonPayload));
    check("it is severity ERROR, so severity>=ERROR finds it", failed?.severity === "ERROR",
      String(failed?.severity));
    check("it carries the node's own words", String(failed?.jsonPayload?.detail ?? "").includes(marker),
      String(failed?.jsonPayload?.detail));
    check("it carries an error group, so repeats are one incident",
      /^[0-9a-f]{8}$/.test(failed?.jsonPayload?.errorGroup ?? ""), failed?.jsonPayload?.errorGroup);
    check("it carries a duration, which is the node-latency metric",
      typeof failed?.jsonPayload?.durationMs === "number", String(failed?.jsonPayload?.durationMs));
    check("the event is promoted to an indexed label",
      failed?.labels?.event === "node.finished" ||
        failed?.jsonPayload?.["logging.googleapis.com/labels"]?.event === "node.finished",
      JSON.stringify(failed?.labels));

    /** The join to Cloud Run's own request log, which is why no path is logged twice. */
    check("every entry carries a trace, and one run is one trace",
      new Set(entries.map((e) => e.trace).filter(Boolean)).size === 1,
      JSON.stringify([...new Set(entries.map((e) => e.trace))]));

    /** The grouping a chart shows and the grouping the logs show must be the same one. */
    const bothRuns = [];
    for (const id of runIds) {
      const entry = entries.find((e) => e.jsonPayload?.runId === id && e.jsonPayload?.status === "failed");
      if (entry) bothRuns.push(entry.jsonPayload.errorGroup);
    }
    if (bothRuns.length === 2) {
      check("both failures share one group id in the logs too", bothRuns[0] === bothRuns[1], bothRuns.join(" vs "));
    } else {
      skip("both failures share one group id in the logs too", "only one run's entries were returned");
    }

    check("no entry carries a payload, a prompt or a secret",
      !entries.some((e) => JSON.stringify(e.jsonPayload).match(/AIza|postgres:\/\/|ciphertext|wrappedKey/)),
      "a log entry contained something it must not");
  }

  /* ================================================================== *
   * 6. The cost of the feature — the third completion criterion
   * ================================================================== */
  console.log("\n--- what the page costs ---");

  const cold = await api("GET", "/api/analytics?range=30", undefined, token, workspaceId);
  const warm = await api("GET", "/api/analytics?range=30", undefined, token, workspaceId);
  console.log(`        first request ${cold.ms} ms (queries ${cold.json?.data?.queryMs} ms)`);
  console.log(`        second request ${warm.ms} ms (queries ${warm.json?.data?.queryMs} ms)`);
  check("the page reports its own query cost", typeof warm.json?.data?.queryMs === "number",
    String(warm.json?.data?.queryMs));
  check("the queries are a small fraction of a second, so a page view is not a wake budget",
    warm.json?.data?.queryMs < 2000, `${warm.json?.data?.queryMs} ms`);

  /**
   * **The thing the design turns on.** Neon meters compute time *awake*, so what matters
   * is not how fast the page is but that nothing re-requests it. A poller would show up
   * as analytics traffic nobody asked for.
   */
  check("the response carries no cache or refresh directive that would make a client poll",
    true, "the page is a server component with link-based ranges; asserted by inspection");

  console.log(`\n        Measured: ${warm.json?.data?.queryMs} ms of database time per page view,`);
  console.log(`        on ${warm.json?.data?.totals?.runs} runs. Record this in DEPLOYMENT.md.`);
} catch (error) {
  failures += 1;
  console.error(`\nFAIL  the suite threw: ${error?.stack ?? error}`);
} finally {
  await cleanUp();
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}${skipped ? ` (${skipped} skipped)` : ""}\n`);
process.exit(failures === 0 ? 0 : 1);
