/**
 * Timers, verified end to end against the deployed service — Phase 26.
 *
 *   APP_BASE_URL=https://… node --env-file=.env scripts/verify-timers.mjs
 *
 * **What this proves that the unit suites cannot.** `wait.test.ts` and `triggers.test.ts`
 * assert the engine pauses and resumes and that a slot's token binds one slot. None of
 * them can show that Cloud Tasks actually delivers a task at the time it was scheduled
 * for, that the compare-and-set on `scheduleNextAt` actually refuses a stale timer in
 * Postgres, or that a waiting run actually holds no lease while it waits. That is this
 * script, and it is the whole of `BUILD_PLAN.md` → *Phase 26* → *Validation steps*:
 *
 *   1. a schedule a few minutes ahead **fires**, from its timer, on time
 *   2. a schedule edited after arming: the old timer arrives and starts **zero** runs
 *   3. a switched-off workflow: its webhook refuses with 409 and its schedule does not
 *      fire; switched back on, both work again
 *   4. a `core.delay` of 2 minutes: the run is `waiting` with **no lease** in between,
 *      then finishes on its own
 *   5. a timer deliberately **deleted** from the queue is re-armed by the daily sweep, and
 *      the slot still fires
 *   6. a waiting run can be cancelled, and its paused step does not stay `running`
 *   7. a burst of schedules all due at the same minute all fire, and how spread out they
 *      are against the queue's `maxConcurrentDispatches` of 3
 *
 * Every product action goes through the product's own API with a real `session` row — the
 * mechanism `verify-durable.mjs` and `verify-api.mjs` use, with no test-only bypass. Two
 * things go around it, both on purpose: the database is read directly to see the lease
 * columns (the API rightly never exposes them), and step 5 deletes a Cloud Tasks task with
 * the operator's own `gcloud` credentials, because "a task was lost" is not something the
 * product can be asked to do to itself.
 *
 * It takes about seven minutes, almost all of it waiting for wall-clock time to pass. It
 * cleans up every workflow it created (runs cascade) and revokes its session.
 */
import { execFileSync } from "node:child_process";

import { neon } from "@neondatabase/serverless";

const BASE = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
if (!BASE) throw new Error("APP_BASE_URL is required.");
const CRON_SECRET = process.env.CRON_SECRET;
if (!CRON_SECRET) throw new Error("CRON_SECRET is required (it is in .env).");

const PROJECT = process.env.GCP_PROJECT_ID ?? "agentforge-hackathon-2026";
const LOCATION = process.env.GCP_REGION ?? "asia-southeast1";
const QUEUE = process.env.TASKS_QUEUE ?? "agentforge-runs";
const PREFIX = "PHASE 26 VERIFY — ";
const BURST = 8;

const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);
const COOKIE = new URL(BASE).protocol === "https:"
  ? "__Secure-authjs.session-token"
  : "authjs.session-token";

let passed = 0;
let failed = 0;
const pass = (text) => {
  passed += 1;
  console.log(`  ✓ ${text}`);
};
const fail = (text) => {
  failed += 1;
  console.log(`  ✗ ${text}`);
};
const check = (ok, good, bad) => (ok ? pass(good) : fail(bad ?? good));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const minutes = (n) => n * 60_000;

/* ------------------------------------------------------------------ *
 * Plumbing
 * ------------------------------------------------------------------ */

let cookie = null;
let sessionToken = null;
const created = [];

async function mintSession() {
  const [user] = await sql.query('select id from "user" order by "id" limit 1');
  if (!user) throw new Error("No user row — sign in through the browser once first.");
  sessionToken = crypto.randomUUID() + crypto.randomUUID();
  await sql.query('insert into "session" ("sessionToken", "userId", "expires") values ($1, $2, $3)', [
    sessionToken,
    user.id,
    new Date(Date.now() + 60 * 60 * 1000),
  ]);
  cookie = `${COOKIE}=${sessionToken}`;
}

async function api(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

const node = (id, type, config = {}, x = 0) => ({ id, type, position: { x, y: 0 }, config });
const edge = (source, target) => ({ id: `${source}-${target}`, source, target, sourceHandle: null });

/** trigger → log. The smallest workflow a schedule can fire. */
const scheduled = (cron) => ({
  version: 1,
  nodes: [
    node("trigger", "core.schedule_trigger", { cron }),
    node("log", "core.log", { message: "fired for {{trigger.scheduledFor}}" }, 260),
  ],
  edges: [edge("trigger", "log")],
});

async function createWorkflow(name, graph) {
  const { status, body } = await api("/api/workflows", {
    method: "POST",
    body: JSON.stringify({ name: `${PREFIX}${name}`, graph }),
  });
  if (status !== 201) throw new Error(`creating "${name}" answered ${status}: ${JSON.stringify(body)}`);
  created.push(body.data.id);
  return body.data;
}

const runsOf = async (workflowId) =>
  (await api(`/api/workflows/${workflowId}/runs`)).body?.data ?? [];

/** The next whole minute at least `leadMs` from now, as `{ at, cron }` for that one slot. */
function slotAhead(leadMs) {
  const at = new Date(Math.ceil((Date.now() + leadMs) / 60_000) * 60_000);
  return { at, cron: `${at.getUTCMinutes()} ${at.getUTCHours()} * * *` };
}

async function waitUntil(time, label) {
  const ms = time.getTime() - Date.now();
  if (ms > 0) {
    console.log(`  … waiting ${Math.round(ms / 1000)} s for ${label}`);
    await sleep(ms);
  }
}

/** Poll until `probe` returns something truthy, or give up after `ms`. */
async function eventually(probe, ms, every = 5_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await sleep(every);
  }
}

/* ------------------------------------------------------------------ *
 * Cloud Tasks, read with the operator's credentials — step 5 only
 * ------------------------------------------------------------------ */

function gcloudToken() {
  return execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim();
}

async function tasksFor(workflowId) {
  const parent = `projects/${PROJECT}/locations/${LOCATION}/queues/${QUEUE}`;
  const token = gcloudToken();
  const found = [];
  let pageToken = "";
  do {
    const url = `https://cloudtasks.googleapis.com/v2/${parent}/tasks?responseView=FULL&pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`listing tasks answered ${response.status}: ${await response.text()}`);
    const page = await response.json();
    for (const task of page.tasks ?? []) {
      const body = task.httpRequest?.body ? Buffer.from(task.httpRequest.body, "base64").toString("utf8") : "";
      if (body.includes(workflowId)) found.push(task);
    }
    pageToken = page.nextPageToken ?? "";
  } while (pageToken);
  return found;
}

async function deleteTask(name) {
  const response = await fetch(`https://cloudtasks.googleapis.com/v2/${name}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${gcloudToken()}` },
  });
  return response.ok;
}

/* ------------------------------------------------------------------ *
 * The checks
 * ------------------------------------------------------------------ */

async function main() {
  console.log(`\nPhase 26 — timers\n${BASE}\n`);

  const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
  check(health.queue?.configured === true, "the queue is configured on the service", "the queue is NOT configured — every check below would be meaningless");
  await mintSession();

  // Everything is created first and asserted after, so the waits overlap.
  const fireSlot = slotAhead(minutes(3));
  const fires = await createWorkflow("fires", scheduled(fireSlot.cron));
  check(fires.scheduleArmed === true, "1. a new schedule is armed at once", `1. a new schedule is not armed: ${JSON.stringify(fires)}`);
  check(fires.scheduleNextAt === fireSlot.at.toISOString(), `1. due at ${fireSlot.at.toISOString()}`);

  const edited = await createWorkflow("edited after arming", scheduled(fireSlot.cron));
  const farSlot = (fireSlot.at.getUTCHours() + 12) % 24;
  const editedGraph = scheduled(`${fireSlot.at.getUTCMinutes()} ${farSlot} * * *`);
  const afterEdit = await api(`/api/workflows/${edited.id}`, { method: "PATCH", body: JSON.stringify({ graph: editedGraph }) });
  check(
    afterEdit.body?.data?.scheduleNextAt !== fireSlot.at.toISOString() && afterEdit.body?.data?.scheduleArmed === true,
    "2. editing the expression moves the due time and arms the new one",
  );

  const switchable = await createWorkflow("switched off", scheduled("*/2 * * * *"));
  const off = await api(`/api/workflows/${switchable.id}`, { method: "PATCH", body: JSON.stringify({ active: false }) });
  check(
    off.body?.data?.active === false && off.body?.data?.scheduleNextAt === null,
    "3. switching off clears the schedule",
  );

  const hook = await createWorkflow("webhook switch", {
    version: 1,
    nodes: [node("trigger", "core.webhook_trigger"), node("log", "core.log", { message: "hooked" }, 260)],
    edges: [edge("trigger", "log")],
  });
  await api(`/api/workflows/${hook.id}`, { method: "PATCH", body: JSON.stringify({ active: false }) });
  const refused = await fetch(hook.webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const refusedBody = await refused.json().catch(() => null);
  check(refused.status === 409 && refusedBody?.error?.code === "conflict", "3. a switched-off webhook answers 409 conflict", `3. a switched-off webhook answered ${refused.status}`);
  check((await runsOf(hook.id)).length === 0, "3. … and the refusal wrote no run");
  await api(`/api/workflows/${hook.id}`, { method: "PATCH", body: JSON.stringify({ active: true }) });
  const accepted = await fetch(hook.webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  check(accepted.status === 201, "3. switched back on, the webhook runs again", `3. switched back on, the webhook answered ${accepted.status}`);

  const delayed = await createWorkflow("two-minute delay", {
    version: 1,
    nodes: [
      node("trigger", "core.manual_trigger"),
      node("hold", "core.delay", { amount: 2, unit: "minutes" }, 260),
      node("after", "core.log", { message: "woke" }, 520),
    ],
    edges: [edge("trigger", "hold"), edge("hold", "after")],
  });
  const started = await api(`/api/workflows/${delayed.id}/runs`, { method: "POST", body: JSON.stringify({ input: {} }) });
  const waitingRun = started.body?.data;
  check(waitingRun?.status === "waiting", "4. a 2-minute delay leaves the run waiting", `4. the run came back ${waitingRun?.status}: ${JSON.stringify(started.body)}`);
  const wakeAt = waitingRun?.wakeAt ? new Date(waitingRun.wakeAt) : null;
  check(wakeAt !== null && Math.abs(wakeAt.getTime() - Date.now() - minutes(2)) < 30_000, "4. … with a wake time two minutes out");
  const [row] = await sql.query('select status, "leaseOwner", "leaseExpiresAt", mode, "wakeAt" from "run" where id = $1', [waitingRun?.id]);
  check(row?.status === "waiting" && row.leaseOwner === null && row.leaseExpiresAt === null, "4. … holding no lease (read from the run row)", `4. lease columns: ${JSON.stringify(row)}`);
  check(row?.mode === "durable", "4. … and durable, so the sweeper leaves it alone");

  const cancellable = await createWorkflow("cancel while waiting", {
    version: 1,
    nodes: [node("trigger", "core.manual_trigger"), node("hold", "core.delay", { amount: 10, unit: "minutes" }, 260)],
    edges: [edge("trigger", "hold")],
  });
  const toCancel = (await api(`/api/workflows/${cancellable.id}/runs`, { method: "POST", body: JSON.stringify({ input: {} }) })).body?.data;
  const cancelled = (await api(`/api/runs/${toCancel?.id}/cancel`, { method: "POST" })).body?.data;
  check(cancelled?.status === "cancelled", "6. a waiting run is cancelled at once", `6. cancelling a waiting run answered ${cancelled?.status}`);
  const pausedStep = cancelled?.steps?.find((step) => step.nodeId === "hold");
  check(pausedStep?.status === "failed" && /cancelled while it was waiting/.test(pausedStep.error ?? ""), "6. … and its paused step is closed, not left running");

  const lostSlot = slotAhead(minutes(4));
  const lost = await createWorkflow("timer deleted", scheduled(lostSlot.cron));
  check(lost.scheduleArmed === true, "5. armed before its task is deleted");
  const tasks = await eventually(async () => {
    const found = await tasksFor(lost.id);
    return found.length > 0 ? found : null;
  }, 30_000, 3_000);
  check(Boolean(tasks?.length), `5. its timer is in the queue (${tasks?.length ?? 0} task)`);
  let deleted = 0;
  for (const task of tasks ?? []) if (await deleteTask(task.name)) deleted += 1;
  check(deleted > 0 && (await tasksFor(lost.id)).length === 0, "5. the timer was deleted from the queue");
  const sweep = await fetch(`${BASE}/api/cron/tick`, { method: "POST", headers: { "x-cron-secret": CRON_SECRET } }).then((r) => r.json());
  check((sweep.data?.armed ?? 0) >= 1, `5. the sweep re-armed timers (armed ${sweep.data?.armed})`);
  check((await tasksFor(lost.id)).length > 0, "5. … and the deleted one is back in the queue");

  const burstSlot = slotAhead(minutes(4));
  const burst = [];
  for (let i = 0; i < BURST; i += 1) burst.push(await createWorkflow(`burst ${i + 1}`, scheduled(burstSlot.cron)));
  check(burst.every((w) => w.scheduleArmed), `7. ${BURST} schedules due at the same minute, all armed`);

  // --- now the waits ------------------------------------------------------

  await waitUntil(new Date(fireSlot.at.getTime() + 5_000), "the first slot");
  const firedRun = await eventually(async () => (await runsOf(fires.id)).find((run) => run.trigger === "schedule" && run.status === "succeeded"), 90_000);
  check(Boolean(firedRun), "1. the schedule fired from its timer, and the run succeeded");
  if (firedRun) {
    const lateness = Date.parse(firedRun.startedAt) - fireSlot.at.getTime();
    check(lateness >= 0 && lateness < 60_000, `1. … ${(lateness / 1000).toFixed(1)} s after its slot`);
    const [after] = await sql.query('select "scheduleNextAt", "scheduleArmedFor" from "workflow" where id = $1', [fires.id]);
    check(
      after?.scheduleNextAt?.getTime() === after?.scheduleArmedFor?.getTime() && after.scheduleNextAt > fireSlot.at,
      "1. … and the next slot was armed by the firing",
    );
  }

  // The edited workflow's old timer has been delivered by now too.
  await sleep(30_000);
  check((await runsOf(edited.id)).length === 0, "2. the old timer arrived and started zero runs");
  const [editedRow] = await sql.query('select "scheduleLastFiredAt" from "workflow" where id = $1', [edited.id]);
  check(editedRow?.scheduleLastFiredAt === null, "2. … and the workflow never recorded a firing");

  check((await runsOf(switchable.id)).length === 0, "3. the switched-off schedule did not fire");
  const on = await api(`/api/workflows/${switchable.id}`, { method: "PATCH", body: JSON.stringify({ active: true }) });
  check(on.body?.data?.scheduleArmed === true && Date.parse(on.body.data.scheduleNextAt) > Date.now(), "3. switched back on, it schedules from now and is armed");

  if (wakeAt) await waitUntil(new Date(wakeAt.getTime() + 5_000), "the delay to end");
  const woken = await eventually(async () => {
    const { body } = await api(`/api/runs/${waitingRun?.id}`);
    return body?.data?.status === "succeeded" ? body.data : null;
  }, 90_000);
  check(Boolean(woken), "4. the waiting run woke and succeeded on its own");
  if (woken) {
    const hold = woken.steps.find((step) => step.nodeId === "hold");
    const held = Date.parse(hold.finishedAt) - Date.parse(hold.startedAt);
    check(hold.status === "succeeded" && held >= minutes(2) - 5_000, `4. … the delay step lasted ${(held / 1000).toFixed(0)} s`);
    check(woken.steps.find((step) => step.nodeId === "after")?.status === "succeeded", "4. … and the step after it ran");
  }

  const switchedOnRun = await eventually(async () => (await runsOf(switchable.id)).find((run) => run.trigger === "schedule"), minutes(3));
  check(Boolean(switchedOnRun), "3. switched back on, the schedule fires again");

  await waitUntil(new Date(lostSlot.at.getTime() + 5_000), "the re-armed slot");
  const lostRun = await eventually(async () => (await runsOf(lost.id)).find((run) => run.trigger === "schedule"), 90_000);
  check(Boolean(lostRun), "5. the slot whose timer was deleted still fired");
  check((await runsOf(lost.id)).filter((run) => run.trigger === "schedule").length === 1, "5. … exactly once, though two timers may have been armed for it");

  const burstRuns = await eventually(async () => {
    const all = await Promise.all(burst.map((w) => runsOf(w.id)));
    return all.every((runs) => runs.some((run) => run.trigger === "schedule")) ? all.flat() : null;
  }, 120_000);
  check(Boolean(burstRuns), `7. all ${BURST} schedules due at the same minute fired`);
  if (burstRuns) {
    const starts = burstRuns.map((run) => Date.parse(run.startedAt)).sort((a, b) => a - b);
    console.log(`  · burst: first ${((starts[0] - burstSlot.at.getTime()) / 1000).toFixed(1)} s after the slot, last ${((starts.at(-1) - burstSlot.at.getTime()) / 1000).toFixed(1)} s, against maxConcurrentDispatches 3`);
  }
}

async function cleanup() {
  for (const id of created) await api(`/api/workflows/${id}`, { method: "DELETE" }).catch(() => {});
  // Anything an interrupted earlier run left behind, by name.
  await sql.query('delete from "workflow" where name like $1', [`${PREFIX}%`]);
  if (sessionToken) await sql.query('delete from "session" where "sessionToken" = $1', [sessionToken]);
}

try {
  await main();
} catch (error) {
  fail(`the script itself failed: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await cleanup();
  console.log(`\n${failed === 0 ? "ALL PASSED" : "FAILED"} — ${passed} passed, ${failed} failed\n`);
  process.exitCode = failed === 0 ? 0 : 1;
}
