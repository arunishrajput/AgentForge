import assert from "node:assert/strict";
import { test } from "node:test";

import { DISPATCH_TOKEN_PATTERN, mintDispatchToken, mintLeaseOwner } from "./lease";
import {
  buildFireTask,
  buildTask,
  describeDelivery,
  DISPATCH_DEADLINE_SECONDS,
  enqueueFire,
  enqueueRun,
  queueConfig,
  queueNamed,
  scheduleTimeFor,
  TASK_HORIZON_MS,
} from "./queue";

/**
 * The queue adapter, asserted without a network.
 *
 * Everything below is either pure or short-circuits before any `fetch`, which is the
 * reason `buildTask` was pulled out of `enqueueRun` at all: a task is created
 * successfully by Cloud Tasks whether or not it can ever be *delivered*, so a wrong URL
 * or an unencoded body is a bug that only shows up as runs that silently never happen.
 *
 * What is not covered here — the actual `CreateTask` call, and the compare-and-set in
 * `lease.ts` — is verified against the deployed service and the deployed database, and
 * `PROGRESS.md` says so.
 */

/** Restores whatever the environment had, so tests cannot leak into each other. */
function withEnv<T>(vars: Record<string, string | undefined>, body: () => T): T {
  const before = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return body();
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("no queue configured is a clean absence, not a throw", async () => {
  // A developer machine and CI both land here. Throwing would make every run fail
  // locally; the caller falls back to executing in-process instead.
  await withEnv({ TASKS_QUEUE: undefined }, async () => {
    assert.equal(await queueConfig(), null);
  });
});

test("an unconfigured enqueue says so without touching the network", async () => {
  await withEnv({ TASKS_QUEUE: undefined }, async () => {
    const result = await enqueueRun({
      runId: "run_1",
      token: mintDispatchToken(),
      baseUrl: "https://example.invalid",
      secret: "s".repeat(16),
    });
    assert.deepEqual(result, { enqueued: false, reason: "unconfigured" });
  });
});

test("the location falls back to the Cloud Run region rather than being asked for twice", async () => {
  await withEnv(
    { TASKS_QUEUE: "agentforge-runs", TASKS_PROJECT: "proj", TASKS_LOCATION: undefined, GCP_REGION: "asia-southeast1" },
    async () => {
      assert.deepEqual(await queueConfig(), {
        project: "proj",
        location: "asia-southeast1",
        queue: "agentforge-runs",
      });
    },
  );
});

test("an explicit location wins over the region", async () => {
  await withEnv(
    { TASKS_QUEUE: "q", TASKS_PROJECT: "proj", TASKS_LOCATION: "europe-west1", GCP_REGION: "asia-southeast1" },
    async () => {
      assert.equal((await queueConfig())?.location, "europe-west1");
    },
  );
});

test("a queue with no discoverable location is not configured", async () => {
  // Better to fall back to in-process execution than to build a task URL against a
  // location that does not exist and have every enqueue rejected.
  await withEnv(
    { TASKS_QUEUE: "q", TASKS_PROJECT: "proj", TASKS_LOCATION: undefined, GCP_REGION: undefined },
    async () => {
      assert.equal(await queueConfig(), null);
    },
  );
});

test("a task targets the dispatch route on the configured base URL", async () => {
  const task = buildTask({
    runId: "run_1",
    token: "a".repeat(48),
    baseUrl: "https://agentforge.example.run.app",
    secret: "secret-value",
  });
  assert.equal(task.httpRequest.url, "https://agentforge.example.run.app/api/runs/dispatch");
  assert.equal(task.httpRequest.httpMethod, "POST");
});

test("a trailing slash on the base URL does not become a double slash", async () => {
  // `APP_BASE_URL` is hand-entered on the service, so both spellings occur.
  for (const base of ["https://x.run.app/", "https://x.run.app//", "https://x.run.app"]) {
    assert.equal(buildTask({ runId: "r", token: "t", baseUrl: base, secret: "s" }).httpRequest.url,
      "https://x.run.app/api/runs/dispatch");
  }
});

test("the body is base64, which is what the REST API requires", async () => {
  const task = buildTask({
    runId: "run_42",
    token: "b".repeat(48),
    baseUrl: "https://x.run.app",
    secret: "s",
  });
  const decoded = JSON.parse(Buffer.from(task.httpRequest.body, "base64").toString("utf8"));
  assert.deepEqual(decoded, { runId: "run_42", token: "b".repeat(48) });
});

test("a task carries the run id and its token, and nothing else", async () => {
  // Cloud Tasks bills per 32 KB chunk, so the payload staying this small is a cost
  // property. It is also why the graph is read from Postgres by the worker instead.
  const task = buildTask({ runId: "r", token: "t", baseUrl: "https://x", secret: "s" });
  const decoded = JSON.parse(Buffer.from(task.httpRequest.body, "base64").toString("utf8"));
  assert.deepEqual(Object.keys(decoded).sort(), ["runId", "token"]);
  assert.equal(task.httpRequest.body.length < 32 * 1024, true);
});

test("the shared secret travels in a header, never in the body", async () => {
  const task = buildTask({ runId: "r", token: "t", baseUrl: "https://x", secret: "the-secret" });
  assert.equal(task.httpRequest.headers["x-cron-secret"], "the-secret");
  assert.equal(Buffer.from(task.httpRequest.body, "base64").toString("utf8").includes("the-secret"), false);
});

test("the dispatch deadline is above the engine's own", async () => {
  // Below it, Cloud Tasks would abandon and redeliver a run that was still legitimately
  // executing — turning the durability mechanism into a duplicate-execution mechanism.
  assert.equal(DISPATCH_DEADLINE_SECONDS > 120, true);
  assert.equal(
    buildTask({ runId: "r", token: "t", baseUrl: "https://x", secret: "s" }).dispatchDeadline,
    `${DISPATCH_DEADLINE_SECONDS}s`,
  );
});

test("a dispatch token is 192 bits of hex and matches the pattern the route demands", async () => {
  for (let i = 0; i < 50; i += 1) {
    const token = mintDispatchToken();
    assert.equal(token.length, 48);
    assert.match(token, DISPATCH_TOKEN_PATTERN);
  }
});

test("dispatch tokens do not repeat", async () => {
  const seen = new Set(Array.from({ length: 200 }, () => mintDispatchToken()));
  assert.equal(seen.size, 200);
});

test("the token pattern rejects anything that is not exactly the token shape", async () => {
  // It is the whole of the authorisation on a route with no session, so the shape check
  // in front of the database lookup matters — a scan must not become a stream of queries.
  assert.equal(DISPATCH_TOKEN_PATTERN.test(""), false);
  assert.equal(DISPATCH_TOKEN_PATTERN.test("a".repeat(47)), false);
  assert.equal(DISPATCH_TOKEN_PATTERN.test("a".repeat(49)), false);
  assert.equal(DISPATCH_TOKEN_PATTERN.test("A".repeat(48)), false);
  assert.equal(DISPATCH_TOKEN_PATTERN.test(`${"a".repeat(47)}-`), false);
  assert.equal(DISPATCH_TOKEN_PATTERN.test(` ${"a".repeat(48)}`), false);
});

test("a lease owner names its revision, so a log line says which container held a run", async () => {
  const owner = mintLeaseOwner();
  assert.equal(owner.includes(":"), true);
  assert.notEqual(mintLeaseOwner(), owner);
});

test("delivery headers are read when present and absent alike", async () => {
  const withHeaders = describeDelivery(
    new Headers({
      "x-cloudtasks-queuename": "agentforge-runs",
      "x-cloudtasks-taskname": "task-1",
      "x-cloudtasks-taskretrycount": "3",
    }),
  );
  assert.deepEqual(withHeaders, { queue: "agentforge-runs", taskName: "task-1", retryCount: 3 });

  // A delivery that is not from Cloud Tasks — a hand-run `curl` during verification —
  // must not make the handler throw on a missing header.
  assert.deepEqual(describeDelivery(new Headers()), {
    queue: null,
    taskName: null,
    retryCount: null,
  });
});

test("a first delivery is retry count zero, which is not the same as absent", async () => {
  // `0` is falsy, so reading this with `||` would report a first delivery as unknown.
  assert.equal(
    describeDelivery(new Headers({ "x-cloudtasks-taskretrycount": "0" })).retryCount,
    0,
  );
});

/* --- timers: tasks scheduled for a time — Phase 26 ------------------------- */

test("a task for now carries no scheduleTime, and one for later carries that time", () => {
  const now = new Date("2026-10-06T12:00:00.000Z");
  assert.equal(scheduleTimeFor(undefined, now), undefined);
  // A time already past is delivered now rather than sent as a past timestamp.
  assert.equal(scheduleTimeFor(new Date("2026-10-06T11:59:00.000Z"), now), undefined);
  assert.equal(scheduleTimeFor(now, now), undefined);
  assert.equal(
    scheduleTimeFor(new Date("2026-10-06T14:00:00.000Z"), now),
    "2026-10-06T14:00:00.000Z",
  );
});

test("a time beyond the queue's horizon is capped to it, never sent as it is", () => {
  // Cloud Tasks refuses a scheduleTime more than 30 days ahead. The task is armed at the
  // horizon instead, arrives early, and the receiving route arms it again.
  const now = new Date("2026-10-06T12:00:00.000Z");
  const farAway = new Date("2027-01-01T00:00:00.000Z");
  const capped = scheduleTimeFor(farAway, now)!;
  assert.equal(Date.parse(capped) - now.getTime(), TASK_HORIZON_MS);
  assert.ok(TASK_HORIZON_MS < 30 * 24 * 60 * 60 * 1000, "inside the documented 30-day limit");
});

test("a waiting run's wake is an ordinary dispatch, scheduled for its time", () => {
  const now = new Date("2026-10-06T12:00:00.000Z");
  const task = buildTask({
    runId: "run_1",
    token: "a".repeat(48),
    baseUrl: "https://agentforge.example.run.app",
    secret: "secret-value",
    at: new Date("2026-10-06T14:00:00.000Z"),
    now,
  });
  assert.equal(task.httpRequest.url, "https://agentforge.example.run.app/api/runs/dispatch");
  assert.equal(task.scheduleTime, "2026-10-06T14:00:00.000Z");

  // And without a time, nothing about the Phase 17 task changed.
  const immediate = buildTask({ runId: "run_1", token: "a".repeat(48), baseUrl: "https://x.app", secret: "s" });
  assert.ok(!("scheduleTime" in immediate));
});

test("a schedule timer goes to the fire route with ids and a token, never the graph", () => {
  const now = new Date("2026-10-06T12:00:00.000Z");
  const task = buildFireTask({
    workflowId: "wf_1",
    scheduledFor: "2026-10-07T09:00:00.000Z",
    token: "t".repeat(43),
    baseUrl: "https://agentforge.example.run.app/",
    secret: "secret-value",
    now,
  });

  assert.equal(task.httpRequest.url, "https://agentforge.example.run.app/api/cron/fire");
  assert.equal(task.httpRequest.headers["x-cron-secret"], "secret-value");
  assert.equal(task.scheduleTime, "2026-10-07T09:00:00.000Z", "scheduled for the slot itself");
  assert.deepEqual(JSON.parse(Buffer.from(task.httpRequest.body, "base64").toString("utf8")), {
    workflowId: "wf_1",
    scheduledFor: "2026-10-07T09:00:00.000Z",
    token: "t".repeat(43),
  });
});

test("an unconfigured queue arms no timer, without touching the network", async () => {
  await withEnv({ TASKS_QUEUE: undefined }, async () => {
    const result = await enqueueFire({
      workflowId: "wf_1",
      scheduledFor: "2026-10-07T09:00:00.000Z",
      token: "t".repeat(43),
      baseUrl: "https://example.invalid",
      secret: "s".repeat(16),
    });
    assert.deepEqual(result, { enqueued: false, reason: "unconfigured" });
    assert.equal(queueNamed(), false);
  });
});
