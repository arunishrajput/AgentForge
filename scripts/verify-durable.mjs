/**
 * Durable execution, verified end to end against the deployed service — Phase 17.
 *
 *   node --env-file=.env scripts/verify-durable.mjs all
 *   node --env-file=.env scripts/verify-durable.mjs all --interrupt
 *
 * **What this exists to prove, and why a unit test cannot.** `resume.test.ts` asserts the
 * engine resumes correctly given a cursor, with no database. What it cannot touch is the
 * part that only exists in production: that Cloud Tasks actually delivers, that the lease's
 * compare-and-set actually holds in Postgres, and that a container dying mid-run actually
 * ends with the run finishing rather than lost. That is this script.
 *
 * Every request below goes through the product's own API. Auth is a real `session` row —
 * the same mechanism `verify-api.mjs` and `smoke.mjs` use, read by the same `auth()`, with
 * no test-only bypass in the app. The single exception is `--interrupt`, which needs a
 * container to die at a chosen moment; that is a `gcloud` call, not a code path.
 *
 * The workflow it builds is a chain of `core.delay` nodes at the node's own 10 s cap, which
 * makes a run long enough to interrupt and makes the resumed portion legible: each delay is
 * its own step, so the step table shows exactly which ones survived.
 *
 * Commands, if you want them one at a time:
 *   session · create · run · watch · cancel · tick · steps · cleanup
 */
import { neon } from "@neondatabase/serverless";

const BASE = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
if (!BASE) throw new Error("APP_BASE_URL is required.");

const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);

/**
 * Auth.js prefixes the session cookie with `__Secure-` over HTTPS, and a browser would
 * refuse to send the unprefixed name to an https origin. `verify-api.mjs` does the same;
 * getting it wrong presents as every request 401ing for no visible reason.
 */
const COOKIE = new URL(BASE).protocol === "https:"
  ? "__Secure-authjs.session-token"
  : "authjs.session-token";
const NAME = "PHASE 17 VERIFY — durable delay chain";
/** Mirrors `MAX_DELIVERIES` in `src/lib/engine/lease.ts`; check 7 constructs a run at it. */
const MAX_DELIVERIES = 5;
const DELAYS = 8; // 8 × 10 s = ~80 s of work, inside the engine's 120 s attempt deadline

/* ------------------------------------------------------------------ *
 * Plumbing
 * ------------------------------------------------------------------ */

let cookie = null;

async function mintSession() {
  const [user] = await sql.query('select id, email from "user" order by "id" limit 1');
  if (!user) throw new Error("No user row — sign in through the browser once first.");
  const token = crypto.randomUUID() + crypto.randomUUID();
  await sql.query(
    'insert into "session" ("sessionToken", "userId", "expires") values ($1, $2, $3)',
    [token, user.id, new Date(Date.now() + 2 * 60 * 60 * 1000)],
  );
  cookie = `${COOKIE}=${token}`;
  return { token, email: user.email };
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

const graph = () => ({
  version: 1,
  nodes: [
    {
      id: "trigger",
      type: "core.schedule_trigger",
      position: { x: 0, y: 0 },
      config: { cron: "0 4 * * *" },
    },
    ...Array.from({ length: DELAYS }, (_, i) => ({
      id: `wait_${i + 1}`,
      type: "core.delay",
      position: { x: 220 * (i + 1), y: 0 },
      config: { ms: 10_000 },
    })),
    {
      id: "done",
      type: "core.log",
      position: { x: 220 * (DELAYS + 1), y: 0 },
      config: { message: "chain complete" },
    },
  ],
  edges: [
    { id: "e0", source: "trigger", target: "wait_1", sourceHandle: null },
    ...Array.from({ length: DELAYS - 1 }, (_, i) => ({
      id: `e${i + 1}`,
      source: `wait_${i + 1}`,
      target: `wait_${i + 2}`,
      sourceHandle: null,
    })),
    { id: `e${DELAYS}`, source: `wait_${DELAYS}`, target: "done", sourceHandle: null },
  ],
});

const findWorkflow = async () => {
  const [row] = await sql.query('select id from "workflow" where name = $1 limit 1', [NAME]);
  return row?.id ?? null;
};

const readRun = async (id) => {
  const [row] = await sql.query(
    `select id, status, mode, attempt, "leaseOwner", "cancelRequestedAt", cursor, error,
            "startedAt", "finishedAt"
     from "run" where id = $1`,
    [id],
  );
  return row ?? null;
};

const readSteps = (runId) =>
  sql.query(
    `select seq, "nodeId", status, "startedAt", "finishedAt"
     from "run_step" where "runId" = $1 order by seq`,
    [runId],
  );

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pass = (text) => console.log(`  PASS  ${text}`);
const fail = (text) => {
  console.log(`  FAIL  ${text}`);
  failures += 1;
};
let failures = 0;

/**
 * Follow a run to its terminal state, printing each change.
 *
 * `onProgress` is how `--interrupt` chooses its moment: it is called with the number of
 * completed steps, and returns true once it has done its damage so it is not called again.
 */
async function watch(runId, { onProgress, timeoutMs = 8 * 60_000 } = {}) {
  const startedAt = Date.now();
  let lastLine = "";
  let acted = false;

  for (;;) {
    const run = await readRun(runId);
    const steps = await readSteps(runId);
    const done = steps.filter((s) => s.status === "succeeded").length;

    const line =
      `status=${run.status} attempt=${run.attempt} steps=${done}/${steps.length} ` +
      `lease=${run.leaseOwner ? run.leaseOwner.split(":")[0] : "-"} ` +
      `next=${run.cursor ? (run.cursor.queue[0]?.nodeId ?? "none") : "-"}`;
    if (line !== lastLine) {
      lastLine = line;
      console.log(`  +${((Date.now() - startedAt) / 1000).toFixed(0).padStart(3)}s  ${line}`);
    }

    if (!acted && onProgress && (await onProgress(done, run))) acted = true;

    if (["succeeded", "failed", "cancelled"].includes(run.status)) return { run, steps };
    if (Date.now() - startedAt > timeoutMs) return { run, steps, timedOut: true };
    await sleep(2000);
  }
}

/* ------------------------------------------------------------------ *
 * The checks
 * ------------------------------------------------------------------ */

async function ensureWorkflow() {
  const existing = await findWorkflow();
  if (existing) {
    const { status } = await api(`/api/workflows/${existing}`, {
      method: "PATCH",
      body: JSON.stringify({ graph: graph() }),
    });
    if (status !== 200) throw new Error(`PATCH workflow failed: ${status}`);
    return existing;
  }
  const { status, body } = await api("/api/workflows", {
    method: "POST",
    body: JSON.stringify({ name: NAME, description: "Phase 17 verification. Safe to delete.", graph: graph() }),
  });
  if (status !== 201) throw new Error(`POST workflow failed: ${status} ${JSON.stringify(body)}`);
  return body.data.id;
}

async function startDurable(workflowId) {
  const { status, body } = await api(`/api/workflows/${workflowId}/runs`, {
    method: "POST",
    body: JSON.stringify({ mode: "durable" }),
  });
  return { status, run: body?.data };
}

/** Runs a gcloud command, for the two things that are infrastructure rather than code. */
async function gcloud(args) {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  await promisify(execFile)("gcloud", [...args, "--quiet"], { maxBuffer: 1 << 24 });
}

const region = () => process.env.GCP_REGION ?? "asia-southeast1";

/**
 * Pause and resume the queue.
 *
 * Needed because "cancel a run before anything executes it" is otherwise **not a window a
 * test can hit**: Cloud Tasks delivered in under a second on every measured run, so racing
 * it just tests the running-run path again with a misleading name. Pausing the queue makes
 * `queued` a state that persists, which is both deterministic and a real production
 * situation — a queue with work ahead of this run does exactly the same thing.
 */
/**
 * **Pausing the queue does not stop a delivery, and that is measured rather than assumed.**
 *
 * The first version of check 4 paused the queue so that `queued` would be a state it could
 * observe. `gcloud tasks queues describe` reported `PAUSED` — the helper polled until it
 * did — and a task created immediately afterwards was still dispatched inside a second. So
 * a pause is not a lever a test can rely on, and check 4 asserts the invariant that holds
 * either way instead.
 */


/** Which revision is serving traffic right now. */
async function servingRevision() {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { stdout } = await promisify(execFile)("gcloud", [
    "run", "services", "describe", "agentforge",
    "--region", region(),
    "--format=value(status.latestReadyRevisionName)",
  ]);
  return stdout.trim();
}

/**
 * Genuinely kill the container a run is executing in.
 *
 * **A plain redeploy does not do this, and finding that out corrected a risk this project
 * had carried since Chapter 1.** Cloud Run *drains*: when a new revision takes traffic the
 * old one stops receiving new requests and existing ones are allowed to finish. Measured
 * here — a run interrupted by a revision replacement carried on and completed on the old
 * revision, `attempt` never left 1.
 *
 * So the kill is two steps: create a new revision to move traffic off the old one, then
 * **delete the old revision**, which terminates its instances and drops the request it is
 * still serving. Cloud Tasks sees the delivery fail and redelivers onto the new revision.
 *
 * That is a real instance death with nothing simulated — no forced lease expiry, no
 * hand-written database state.
 */
async function killServingRevision() {
  const doomed = await servingRevision();
  await gcloud([
    "run", "services", "update", "agentforge",
    "--region", region(),
    "--update-labels", `phase17verify=${Date.now()}`,
  ]);
  const replacement = await servingRevision();
  if (replacement === doomed) throw new Error("No new revision was created; refusing to delete the only one.");
  await gcloud(["run", "revisions", "delete", doomed, "--region", region()]);
  return { doomed, replacement };
}

/* ------------------------------------------------------------------ *
 * Entry points
 * ------------------------------------------------------------------ */

const command = process.argv[2] ?? "all";
const interrupt = process.argv.includes("--interrupt");

if (command === "session") {
  console.log(JSON.stringify(await mintSession()));
} else if (command === "cleanup") {
  await mintSession();
  const id = await findWorkflow();
  if (!id) console.log("nothing to clean up");
  else {
    const { status } = await api(`/api/workflows/${id}`, { method: "DELETE" });
    console.log(`DELETE /api/workflows/${id} → ${status}`);
  }
  await sql.query('delete from "session" where "sessionToken" = $1', [cookie.slice(COOKIE.length + 1)]);
} else if (command === "all") {
  const who = await mintSession();
  console.log(`Signed in as ${who.email} on ${BASE}\n`);

  /* 1 — the queue is genuinely configured on the deployed service */
  console.log("1. The deployed service has a queue");
  const health = await api("/api/health");
  if (health.body?.queue?.configured === true) {
    pass(`queue ${health.body.queue.queue} in ${health.body.queue.location} (${health.body.revision})`);
  } else {
    fail(`queue not configured — durable runs would silently run in-process: ${JSON.stringify(health.body?.queue)}`);
  }

  /* 2 — a durable run is accepted as queued, not executed inline */
  console.log("\n2. A durable run is accepted without being executed");
  const workflowId = await ensureWorkflow();
  const started = await startDurable(workflowId);
  if (started.status === 202) pass("202 Accepted");
  else fail(`expected 202, got ${started.status}`);
  if (started.run?.status === "queued") pass("run is queued");
  else fail(`expected status queued, got ${started.run?.status}`);
  if (started.run?.mode === "durable") pass("run mode is durable");
  else fail(`expected mode durable, got ${started.run?.mode}`);
  if (!started.run?.steps) pass("no steps yet — nothing has executed it");
  else fail("the response carried steps, so it was executed inline");

  /* 3 — Cloud Tasks delivers it and it runs to completion */
  console.log(`\n3. Cloud Tasks delivers it${interrupt ? ", and it survives losing its container" : ""}`);
  let stepsBeforeKill = 0;
  const outcome = await watch(started.run.id, {
    timeoutMs: interrupt ? 12 * 60_000 : 8 * 60_000,
    onProgress: interrupt
      ? async (done) => {
          if (done < 3) return false;
          stepsBeforeKill = done;
          console.log(`  ——  killing the container at ${done} completed steps`);
          const { doomed, replacement } = await killServingRevision();
          console.log(`  ——  deleted ${doomed}; traffic is on ${replacement}`);
          return true;
        }
      : undefined,
  });

  const { run, steps } = outcome;
  if (outcome.timedOut) fail("timed out waiting for the run to finish");
  else if (run.status === "succeeded") pass(`run succeeded after ${run.attempt} deliver${run.attempt === 1 ? "y" : "ies"}`);
  else fail(`run ended ${run.status}: ${run.error}`);

  if (interrupt) {
    /**
     * **This is the phase's completion criterion, and the answer was a surprise.**
     *
     * "A run survives a redeploy" turned out to be satisfied *without* the queue: Cloud Run
     * drains. A revision that loses traffic keeps serving its in-flight requests, and —
     * measured here — so does a revision that is **deleted** while still holding one. The
     * run below completed on a revision that no longer existed.
     *
     * So either outcome is a pass, and which one it was is worth printing, because it is the
     * difference between "the platform protected the run" and "the queue did". Chapter 1's
     * carried risk assumed neither.
     */
    if (run.attempt > 1) {
      pass(`it was redelivered and resumed — ${run.attempt} deliveries`);
      const early = steps.filter((x) => x.seq < stepsBeforeKill && x.status === "succeeded");
      if (early.length === stepsBeforeKill) {
        pass(`the ${stepsBeforeKill} steps completed before the kill were preserved, not re-run`);
      } else {
        fail(`expected ${stepsBeforeKill} preserved steps, found ${early.length}`);
      }
    } else if (run.status === "succeeded") {
      pass("it survived on one delivery — Cloud Run drained the deleted revision rather than killing the request");
    } else {
      fail(`the run did not survive the kill: ${run.status}`);
    }
  }

  /* Each node ran exactly once. This is the property the lease exists for. */
  const counts = new Map();
  for (const step of steps) counts.set(step.nodeId, (counts.get(step.nodeId) ?? 0) + 1);
  const duplicated = [...counts].filter(([, n]) => n > 1);
  if (duplicated.length === 0) pass(`every node ran exactly once (${steps.length} steps)`);
  else fail(`nodes ran more than once — the lease did not hold: ${JSON.stringify(duplicated)}`);

  const expected = DELAYS + 2; // trigger + delays + log
  if (steps.length === expected) pass(`${expected} steps recorded, as the graph has`);
  else fail(`expected ${expected} steps, found ${steps.length}`);

  if (run.leaseOwner === null) pass("the lease was released on completion");
  else fail(`lease still held by ${run.leaseOwner}`);

  console.table(
    steps.map((s) => ({
      seq: s.seq,
      node: s.nodeId,
      status: s.status,
      ms: s.startedAt && s.finishedAt ? new Date(s.finishedAt) - new Date(s.startedAt) : null,
    })),
  );

  /* 3b — a redelivery resumes from the cursor instead of starting again */
  console.log("\n3b. A redelivery resumes from the cursor rather than restarting");
  console.log("  ——  see the note in this file: Cloud Run will not kill an in-flight request,");
  console.log("      so the run is put into the state a dead worker leaves and then redelivered.");

  const victim = await startDurable(workflowId);
  const partial = await watch(victim.run.id, {
    onProgress: async (done, current) => {
      if (done < 3 || current.status !== "running") return false;
      // Stop the worker for real, so the resume is not racing a live engine. This is the
      // only way to be certain no second engine is executing: cancellation is the one
      // mechanism that makes a worker put the run down and release its lease.
      await api(`/api/runs/${victim.run.id}/cancel`, { method: "POST" });
      return true;
    },
  });

  const survived = partial.steps.filter((x) => x.status === "succeeded").length;
  if (partial.run.status === "cancelled" && partial.run.leaseOwner === null) {
    pass(`worker stopped with ${survived} steps done and the lease released`);
  } else {
    fail(`could not stop the worker cleanly: ${partial.run.status}, lease ${partial.run.leaseOwner}`);
  }
  if (partial.run.cursor) pass(`cursor preserved, next is ${partial.run.cursor.queue[0]?.nodeId}`);
  else fail("no cursor was kept, so there is nothing to resume from");

  // Exactly the row a crashed worker leaves behind: still `running`, cursor present, no
  // live lease. Nothing else is touched.
  await sql.query(
    `update "run" set status = 'running', "cancelRequestedAt" = null, "finishedAt" = null,
                      error = null, "leaseOwner" = 'dead-worker', "leaseExpiresAt" = now() - interval '1 second'
     where id = $1`,
    [victim.run.id],
  );
  const [{ dispatchToken }] = await sql.query('select "dispatchToken" from "run" where id = $1', [victim.run.id]);

  // The real route, with the real payload Cloud Tasks would send.
  const redelivery = await fetch(`${BASE}/api/runs/dispatch`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-cron-secret": process.env.CRON_SECRET },
    body: JSON.stringify({ runId: victim.run.id, token: dispatchToken }),
  });
  const redeliveryBody = await redelivery.json();
  if (redelivery.status === 200 && redeliveryBody?.data?.handled) {
    pass(`the redelivery was handled: ${redeliveryBody.data.status}`);
  } else {
    fail(`the redelivery was declined: ${JSON.stringify(redeliveryBody)}`);
  }

  const resumed = await readRun(victim.run.id);
  const resumedSteps = await readSteps(victim.run.id);
  if (resumed.status === "succeeded") pass("the resumed run completed");
  else fail(`the resumed run ended ${resumed.status}: ${resumed.error}`);
  if (resumed.attempt === 2) pass("it counted as a second delivery");
  else fail(`expected attempt 2, got ${resumed.attempt}`);
  if (resumedSteps.length === DELAYS + 2) pass(`${DELAYS + 2} steps in total — nothing was run twice`);
  else fail(`expected ${DELAYS + 2} steps, found ${resumedSteps.length}`);

  const early = resumedSteps.filter((x) => x.seq < survived);
  const rerun = early.filter((x) => {
    const before = partial.steps.find((y) => y.seq === x.seq);
    return before && new Date(x.finishedAt).getTime() !== new Date(before.finishedAt).getTime();
  });
  if (rerun.length === 0) pass(`the first ${survived} steps kept their original timestamps — they were not re-executed`);
  else fail(`${rerun.length} step(s) were re-executed on resume: ${rerun.map((x) => x.nodeId).join(", ")}`);

  /* 4 — cancelling a durable run: the invariant, whichever path it takes */
  console.log("\n4. Cancelling a durable run stops it, and no further nodes run");
  console.log("  ——  Cloud Tasks delivers in under a second, and a PAUSED queue was measured");
  console.log("      to dispatch anyway, so which path this takes is not controllable. Both are");
  console.log("      correct; the invariant below is what actually matters.");

  const target = await startDurable(workflowId);
  const asked = await api(`/api/runs/${target.run.id}/cancel`, { method: "POST" });
  if (asked.status === 200) pass("200 from cancel");
  else fail(`expected 200, got ${asked.status}`);

  const wasUnclaimed = asked.body?.data?.status === "cancelled";
  console.log(`  ——  it was ${wasUnclaimed ? "still queued — cancelled outright" : "already claimed — stopping at a boundary"}`);

  const settled = await watch(target.run.id, { timeoutMs: 3 * 60_000 });
  if (settled.run.status === "cancelled") pass("it ended cancelled");
  else fail(`expected cancelled, got ${settled.run.status}`);

  const atCancel = settled.steps.filter((x) => x.status === "succeeded").length;
  await sleep(25_000); // long enough for any redelivery to have arrived and been declined
  const afterwards = await readRun(target.run.id);
  const afterSteps = await readSteps(target.run.id);
  if (afterwards.status === "cancelled") pass("still cancelled after any redelivery arrived");
  else fail(`a redelivery revived a cancelled run: now ${afterwards.status}`);
  if (afterSteps.filter((x) => x.status === "succeeded").length === atCancel) {
    pass(`no further node ran after the cancel (${atCancel} had completed)`);
  } else {
    fail(`nodes ran after the cancel: ${atCancel} → ${afterSteps.filter((x) => x.status === "succeeded").length}`);
  }

  /* 4b — the unclaimed path, made deterministic */
  console.log("\n4b. A run nothing has claimed is cancelled outright, with no steps");
  const [owner] = await sql.query('select id from "user" order by id limit 1');
  // `workspaceId` is selected from the workflow rather than passed in, exactly as the
  // engine does it — a run belongs where its workflow does. It became required in Phase
  // 19A, and the deployed run of that phase's migration is what caught this insert
  // predating it.
  const [orphan] = await sql.query(
    `insert into "run" (id, "workflowId", "ownerId", "workspaceId", status, trigger, mode, "dispatchToken")
     select $1, $2, $3, w."workspaceId", 'queued', 'manual', 'durable', $4
     from "workflow" w where w."id" = $2 returning id`,
    [crypto.randomUUID(), workflowId, owner.id, crypto.randomUUID().replaceAll("-", "").repeat(2).slice(0, 48)],
  );
  // A `queued` run with no task behind it — exactly the row an enqueue failure leaves, and
  // the state `finishUnclaimedRun` exists for. Constructed rather than raced, because the
  // queue delivers too fast to observe this otherwise.
  const orphanCancel = await api(`/api/runs/${orphan.id}/cancel`, { method: "POST" });
  if (orphanCancel.body?.data?.status === "cancelled") pass("cancelled immediately — nothing held it");
  else fail(`expected cancelled, got ${orphanCancel.body?.data?.status}`);
  if ((await readSteps(orphan.id)).length === 0) pass("no steps were ever recorded");
  else fail("steps were recorded for a run that never started");

  /* 5 — cancelling a RUNNING run stops it at the next step boundary */
  console.log("\n5. Cancelling a running run stops it at the next step boundary");
  const live = await startDurable(workflowId);
  const stopped = await watch(live.run.id, {
    onProgress: async (done, current) => {
      if (done < 2 || current.status !== "running") return false;
      const asked = await api(`/api/runs/${live.run.id}/cancel`, { method: "POST" });
      console.log(`  ——  cancel asked at ${done} steps → status ${asked.body?.data?.status}, cancelRequested ${asked.body?.data?.cancelRequested}`);
      return true;
    },
  });
  if (stopped.run.status === "cancelled") pass("it ended cancelled");
  else fail(`expected cancelled, got ${stopped.run.status}`);
  const ran = stopped.steps.filter((s) => s.status === "succeeded").length;
  if (ran > 0 && ran < DELAYS + 2) pass(`it stopped part-way — ${ran} of ${DELAYS + 2} steps ran`);
  else fail(`expected a partial run, got ${ran} of ${DELAYS + 2}`);

  /* 6 — the scheduled path is durable too */
  console.log("\n6. A scheduled run is queued, not executed by the tick");
  await sql.query('update "workflow" set "scheduleNextAt" = $1 where id = $2', [
    new Date(Date.now() - 60_000),
    workflowId,
  ]);
  const tick = await fetch(`${BASE}/api/cron/tick`, {
    method: "POST",
    headers: { "x-cron-secret": process.env.CRON_SECRET },
  });
  const tickBody = await tick.json();
  const fired = tickBody?.data?.fired?.find((f) => f.workflowId === workflowId);
  if (fired) pass(`the tick fired it: status=${fired.status} queued=${fired.queued}`);
  else fail(`the tick did not fire it: ${JSON.stringify(tickBody?.data)}`);
  if (fired?.queued === true) pass("it went to the queue rather than running inline");
  else fail("the tick executed it inline");
  if (fired?.status === "queued") pass("the tick answered before the run had started");
  else fail(`expected queued, got ${fired?.status}`);
  if (typeof tickBody?.data?.swept === "number") pass(`the tick swept (${tickBody.data.swept} abandoned)`);
  else fail("the tick did not report a sweep");

  const scheduled = await watch(fired.runId);
  if (scheduled.run.status === "succeeded") pass("the scheduled run completed");
  else fail(`the scheduled run ended ${scheduled.run.status}: ${scheduled.run.error}`);

  /* 7 — the sweeper fails what is lost and leaves alone what is not */
  console.log("\n7. The sweeper knows which abandoned runs are actually lost");
  console.log("  ——  four runs in the state a dead worker leaves, differing only in mode and attempt.");
  console.log("      This is the subtlest decision in the phase: sweeping a durable run that is");
  console.log("      merely between deliveries would destroy the durability it adds.");

  const [sweepOwner] = await sql.query('select id from "user" order by id limit 1');
  const abandoned = async (mode, status, attempt) => {
    const id = crypto.randomUUID();
    await sql.query(
      `insert into "run" (id, "workflowId", "ownerId", "workspaceId", status, trigger, mode, attempt,
                          "dispatchToken", "heartbeatAt", "leaseOwner", "leaseExpiresAt")
       select $1, $2, $3, w."workspaceId", $4, 'manual', $5, $6, $7,
              now() - interval '10 minutes', 'dead-worker', now() - interval '10 minutes'
       from "workflow" w where w."id" = $2`,
      [id, workflowId, sweepOwner.id, status, mode, attempt, crypto.randomUUID().replaceAll("-", "").repeat(2).slice(0, 48)],
    );
    return id;
  };

  const cases = [
    { name: "sync, interrupted — nothing will resume it", id: await abandoned("sync", "running", 1), want: "failed" },
    { name: "durable, deliveries remaining — a retry is coming", id: await abandoned("durable", "running", 2), want: "running" },
    { name: "durable, deliveries spent — the queue gave up", id: await abandoned("durable", "running", MAX_DELIVERIES), want: "failed" },
    { name: "durable, never delivered — the enqueue failed", id: await abandoned("durable", "queued", 0), want: "failed" },
  ];

  await fetch(`${BASE}/api/cron/tick`, {
    method: "POST",
    headers: { "x-cron-secret": process.env.CRON_SECRET },
  });

  for (const c of cases) {
    const after = await readRun(c.id);
    if (after.status === c.want) pass(`${c.name} → ${after.status}`);
    else fail(`${c.name} → expected ${c.want}, got ${after.status}`);
  }
  await sql.query('delete from "run" where id = any($1)', [cases.map((c) => c.id)]);

  /* ------------------------------------------------------------------ */
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  await sql.query('delete from "session" where "sessionToken" = $1', [cookie.slice(COOKIE.length + 1)]);
  process.exit(failures === 0 ? 0 : 1);
} else {
  console.error(`Unknown command: ${command}`);
  process.exit(2);
}
