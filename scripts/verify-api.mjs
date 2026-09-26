/**
 * End-to-end verification of the API and the canvas against a running instance.
 *
 *   node --env-file=.env scripts/verify-api.mjs http://localhost:3000
 *   node --env-file=.env scripts/verify-api.mjs https://<the deployed url>
 *
 * Auth is a database session, so there is no API token to mint. Instead this
 * inserts a real session row for an existing user, drives the API with that
 * cookie exactly as a browser would, and deletes the row afterwards — the same
 * code path `auth()` takes, with no browser and no test-only bypass in the app.
 *
 * Every check prints PASS or FAIL and the script exits non-zero if any failed, so
 * "it deployed" and "it works" stay different claims (CLAUDE.md → deployment).
 */
import { isDeepStrictEqual } from "node:util";

import { neon } from "@neondatabase/serverless";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const secure = base.startsWith("https://");
const cookieName = secure ? "__Secure-authjs.session-token" : "authjs.session-token";

const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);

let failures = 0;
function check(label, condition, detail) {
  const passed = Boolean(condition);
  if (!passed) failures += 1;
  console.log(`${passed ? "PASS" : "FAIL"}  ${label}${passed || detail === undefined ? "" : `\n        ${detail}`}`);
}

let skipped = 0;
/** A check that could not run. Printed, counted, and never mistaken for a pass. */
function skip(label, why) {
  skipped += 1;
  console.log(`SKIP  ${label}\n        ${why}`);
}

/** For the rendered pages, where the assertion is about status and markup. */
async function page(path, cookie) {
  const response = await fetch(`${base}${path}`, {
    redirect: "manual",
    headers: cookie ? { cookie: `${cookieName}=${cookie}` } : {},
  });
  return { status: response.status, html: await response.text() };
}

/**
 * Opens an SSE stream and records both the parsed frames and the raw chunk
 * boundaries. The chunk timing is the point: it is the only way to tell "streaming"
 * from "one buffered response that happened to contain every event".
 */
async function openStream(path, cookie) {
  const controller = new AbortController();
  const response = await fetch(`${base}${path}`, {
    headers: {
      accept: "text/event-stream",
      ...(cookie ? { cookie: `${cookieName}=${cookie}` } : {}),
    },
    signal: controller.signal,
  });

  const frames = [];
  const chunks = [];

  const drained = (async () => {
    if (!response.body || !response.headers.get("content-type")?.includes("event-stream")) return;
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for await (const chunk of response.body) {
        chunks.push({ at: Date.now(), bytes: chunk.length });
        buffer += decoder.decode(chunk, { stream: true });
        let cut;
        while ((cut = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const lines = raw.split("\n");
          const name = lines.find((line) => line.startsWith("event: "))?.slice(7);
          const payload = lines.find((line) => line.startsWith("data: "))?.slice(6);
          frames.push({
            at: Date.now(),
            event: name ?? "comment",
            data: name && payload ? JSON.parse(payload) : raw,
          });
        }
      }
    } catch (error) {
      if (error?.name !== "AbortError") throw error;
    }
  })();

  return { response, frames, chunks, drained, close: () => controller.abort() };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(method, path, body, cookie) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie: `${cookieName}=${cookie}` } : {}),
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
  return { status: response.status, json };
}

const graph = {
  version: 1,
  nodes: [
    { id: "trigger", type: "core.manual_trigger", position: { x: 0, y: 0 }, config: {} },
    {
      id: "shape",
      type: "core.set",
      position: { x: 240, y: 0 },
      config: { fields: { subject: "{{input.topic}}", attempts: 2 } },
    },
    {
      id: "check",
      type: "core.branch",
      position: { x: 480, y: 0 },
      config: { left: "{{input.subject}}", operator: "is_not_empty" },
    },
    {
      id: "each",
      type: "core.loop",
      position: { x: 720, y: -80 },
      config: { maxIterations: 3 },
    },
    {
      id: "body",
      type: "core.log",
      position: { x: 960, y: -80 },
      config: { message: "pass {{input.index}} of {{input.total}}" },
    },
    {
      id: "done",
      type: "core.log",
      position: { x: 960, y: 80 },
      config: { message: "finished {{input.iterations}} iteration(s)" },
    },
    {
      id: "empty",
      type: "core.log",
      position: { x: 720, y: 200 },
      config: { message: "nothing to do" },
    },
  ],
  edges: [
    { id: "e1", source: "trigger", target: "shape", sourceHandle: null },
    { id: "e2", source: "shape", target: "check", sourceHandle: null },
    { id: "e3", source: "check", target: "each", sourceHandle: "true" },
    { id: "e4", source: "check", target: "empty", sourceHandle: "false" },
    { id: "e5", source: "each", target: "body", sourceHandle: "loop" },
    { id: "e6", source: "body", target: "each", sourceHandle: null },
    { id: "e7", source: "each", target: "done", sourceHandle: "done" },
  ],
};

const token = crypto.randomUUID() + crypto.randomUUID();
let workflowId = null;

try {
  console.log(`\nVerifying ${base}\n`);

  const [user] = await sql.query('select id, email from "user" order by "id" limit 1');
  if (!user) throw new Error('No user row exists — sign in once before running this.');
  console.log(`Using existing user ${user.email}\n`);

  await sql.query(
    'insert into "session" ("sessionToken", "userId", "expires") values ($1, $2, $3)',
    [token, user.id, new Date(Date.now() + 60 * 60 * 1000)],
  );

  // --- ownership boundary ---------------------------------------------------
  const anonymous = await api("GET", "/api/workflows");
  check(
    "unauthenticated request is rejected",
    anonymous.status === 401 && anonymous.json?.error?.code === "unauthenticated",
    `got ${anonymous.status} ${JSON.stringify(anonymous.json).slice(0, 200)}`,
  );

  const anonymousRun = await api("POST", "/api/workflows/anything/runs", {});
  check("unauthenticated run trigger is rejected", anonymousRun.status === 401);

  // --- registry -------------------------------------------------------------
  const nodes = await api("GET", "/api/nodes", undefined, token);
  const types = (nodes.json?.data ?? []).map((node) => node.type);
  // Phase 7 checks generated graphs against the registry the server actually serves,
  // rather than against a list written here that could drift from it.
  const registryTypes = new Set(types);
  const triggerTypes = new Set(
    (nodes.json?.data ?? []).filter((node) => node.kind === "trigger").map((node) => node.type),
  );
  check(
    "registry serves the seeded node types",
    nodes.status === 200 &&
      ["core.manual_trigger", "core.webhook_trigger", "core.schedule_trigger", "core.set", "core.log", "core.branch", "core.loop", "core.assert"].every(
        (type) => types.includes(type),
      ),
    JSON.stringify(types),
  );
  check(
    "registry exposes an agent-callable subset, not everything",
    (nodes.json?.data ?? []).some((node) => node.agentCallable) &&
      (nodes.json?.data ?? []).some((node) => !node.agentCallable),
  );

  // --- create + round-trip --------------------------------------------------
  const created = await api(
    "POST",
    "/api/workflows",
    { name: "Phase 3 verification", description: "Created by scripts/verify-api.mjs", graph },
    token,
  );
  check(
    "workflow created",
    created.status === 201 && typeof created.json?.data?.id === "string",
    JSON.stringify(created.json).slice(0, 300),
  );
  workflowId = created.json?.data?.id;
  check("created workflow reports itself runnable", created.json?.data?.runnable === true,
    JSON.stringify(created.json?.data?.problems));

  const fetched = await api("GET", `/api/workflows/${workflowId}`, undefined, token);
  // Compared structurally, not as strings: Postgres `jsonb` normalises object key
  // order on write, so a byte comparison fails on a graph that is in fact intact.
  check(
    "graph round-trips losslessly, positions included",
    isDeepStrictEqual(fetched.json?.data?.graph, graph),
    JSON.stringify(fetched.json?.data?.graph).slice(0, 300),
  );

  const renamed = await api("PATCH", `/api/workflows/${workflowId}`, { name: "Renamed" }, token);
  check("workflow updates", renamed.status === 200 && renamed.json?.data?.name === "Renamed");
  check(
    "update leaves the graph untouched",
    isDeepStrictEqual(renamed.json?.data?.graph, graph),
  );

  // --- run: branch true, loop runs, output threads ---------------------------
  const run = await api("POST", `/api/workflows/${workflowId}/runs`, { input: { topic: "agents" } }, token);
  const data = run.json?.data;
  check("run completes", run.status === 201 && data?.status === "succeeded",
    JSON.stringify(run.json).slice(0, 400));

  const step = (nodeId) => (data?.steps ?? []).filter((candidate) => candidate.nodeId === nodeId);

  check("trigger payload reached the first node",
    step("shape")[0]?.output?.subject === "agents",
    JSON.stringify(step("shape")[0]?.output));
  check("branch took the true path", step("check")[0]?.branch === "true");
  check("untaken branch is recorded as skipped", step("empty")[0]?.status === "skipped");
  check("loop body ran exactly 3 times",
    step("body").filter((candidate) => candidate.status === "succeeded").length === 3,
    `ran ${step("body").length}`);
  check("loop exited through done", step("each").at(-1)?.branch === "done");
  check("templates resolved inside the loop",
    step("body")[0]?.logs?.[0]?.message === "pass 0 of 3",
    JSON.stringify(step("body")[0]?.logs));
  check("each step snapshots its resolved config",
    step("body")[0]?.config?.message === "pass 0 of 3",
    JSON.stringify(step("body")[0]?.config));
  check("run has a duration", typeof data?.durationMs === "number");

  // --- run: branch false ----------------------------------------------------
  const other = await api("POST", `/api/workflows/${workflowId}/runs`, { input: {} }, token);
  const otherSteps = other.json?.data?.steps ?? [];
  const at = (nodeId) => otherSteps.find((candidate) => candidate.nodeId === nodeId);
  check("empty input takes the false path",
    other.json?.data?.status === "succeeded" && at("check")?.branch === "false" && at("empty")?.status === "succeeded",
    JSON.stringify(other.json).slice(0, 300));
  check("loop nodes are skipped on the untaken side",
    at("each")?.status === "skipped" && at("body")?.status === "skipped");

  // --- failure is recorded --------------------------------------------------
  const failing = await api(
    "POST",
    "/api/workflows",
    {
      name: "Phase 3 failure path",
      graph: {
        version: 1,
        nodes: [
          { id: "trigger", type: "core.manual_trigger", position: { x: 0, y: 0 }, config: {} },
          {
            id: "guard",
            type: "core.assert",
            position: { x: 240, y: 0 },
            config: { left: "{{input.missing}}", operator: "is_not_empty", message: "Expected a value and found none." },
          },
        ],
        edges: [{ id: "e1", source: "trigger", target: "guard", sourceHandle: null }],
      },
    },
    token,
  );
  const failingRun = await api("POST", `/api/workflows/${failing.json?.data?.id}/runs`, { input: {} }, token);
  const guard = (failingRun.json?.data?.steps ?? []).find((candidate) => candidate.nodeId === "guard");
  check("a failing node fails the run",
    failingRun.json?.data?.status === "failed" && guard?.status === "failed",
    JSON.stringify(failingRun.json).slice(0, 300));
  check("the failure message is recorded on the step",
    guard?.error === "Expected a value and found none.");
  await api("DELETE", `/api/workflows/${failing.json?.data?.id}`, undefined, token);

  // --- invalid graph is rejected, not persisted as runnable -----------------
  const invalid = await api(
    "POST",
    "/api/workflows",
    {
      name: "Phase 3 invalid",
      graph: {
        version: 1,
        nodes: [{ id: "a", type: "core.log", position: { x: 0, y: 0 }, config: { message: "x" } }],
        edges: [],
      },
    },
    token,
  );
  check("a graph with no trigger saves but is reported unrunnable",
    invalid.status === 201 && invalid.json?.data?.runnable === false &&
      invalid.json.data.problems.some((problem) => problem.code === "no_trigger"));
  const invalidRun = await api("POST", `/api/workflows/${invalid.json?.data?.id}/runs`, {}, token);
  check("running an invalid graph returns 422 and does not execute",
    invalidRun.status === 422 && invalidRun.json?.error?.code === "invalid_graph",
    JSON.stringify(invalidRun.json).slice(0, 300));
  await api("DELETE", `/api/workflows/${invalid.json?.data?.id}`, undefined, token);

  // --- run history ----------------------------------------------------------
  const history = await api("GET", `/api/workflows/${workflowId}/runs`, undefined, token);
  check("run history lists both runs of this workflow",
    history.status === 200 && history.json?.data?.length === 2,
    `got ${history.json?.data?.length}`);
  check("run history is newest first",
    history.json?.data?.[0]?.startedAt >= history.json?.data?.[1]?.startedAt);

  const single = await api("GET", `/api/runs/${data?.id}`, undefined, token);
  check("a single run reads back with its steps",
    single.status === 200 && single.json?.data?.steps?.length === data?.steps?.length);

  // --- an interrupted run must not stay `running` for ever -------------------
  // Execution is in-process, so a redeploy kills a run mid-flight and nothing
  // would ever move it out of `running`. Simulated here by writing the row a dead
  // engine would have left behind (ARCHITECTURE.md → Execution engine design).
  const orphan = crypto.randomUUID();
  await sql.query(
    'insert into "run" ("id", "workflowId", "ownerId", "status", "trigger", "startedAt", "heartbeatAt") values ($1, $2, $3, $4, $5, $6, $6)',
    [orphan, workflowId, user.id, "running", "manual", new Date(Date.now() - 30 * 60 * 1000)],
  );
  await api("GET", "/api/runs", undefined, token);
  const [reaped] = await sql.query('select status, error from "run" where id = $1', [orphan]);
  check("an interrupted run is reaped into failed, never left running",
    reaped?.status === "failed" && typeof reaped?.error === "string",
    JSON.stringify(reaped));

  // --- owner scoping --------------------------------------------------------
  const stranger = crypto.randomUUID();
  const [other2] = await sql.query(
    'insert into "user" ("id", "email") values ($1, $2) returning id',
    [stranger, `verify-${stranger.slice(0, 8)}@example.invalid`],
  );
  const strangerToken = crypto.randomUUID() + crypto.randomUUID();
  await sql.query(
    'insert into "session" ("sessionToken", "userId", "expires") values ($1, $2, $3)',
    [strangerToken, other2.id, new Date(Date.now() + 60 * 60 * 1000)],
  );
  const poached = await api("GET", `/api/workflows/${workflowId}`, undefined, strangerToken);
  check("another user cannot read this workflow", poached.status === 404,
    `got ${poached.status}`);
  const poachedRun = await api("POST", `/api/workflows/${workflowId}/runs`, {}, strangerToken);
  check("another user cannot run this workflow", poachedRun.status === 404);
  await sql.query('delete from "user" where id = $1', [other2.id]);

  // --- phase 4: the canvas --------------------------------------------------
  // The canvas is a browser surface, so these check the things it depends on
  // that a headless run can actually prove: that the registry projection carries
  // everything a palette and a config form are built from, that the pages are
  // reachable and owner-scoped, and that a canvas-shaped graph survives a save.
  const palette = nodes.json?.data ?? [];
  check(
    "every registry entry carries what the palette and config form need",
    palette.length > 0 &&
      palette.every(
        (node) =>
          typeof node.label === "string" &&
          typeof node.description === "string" &&
          typeof node.kind === "string" &&
          typeof node.category === "string" &&
          Array.isArray(node.outputs) &&
          node.outputs.length > 0 &&
          node.configSchema?.type === "object",
      ),
    JSON.stringify(palette.map((node) => node.type)),
  );
  check(
    "output keys are the handle ids the canvas draws and the engine follows",
    isDeepStrictEqual(
      palette.find((node) => node.type === "core.branch")?.outputs.map((o) => o.key),
      ["true", "false"],
    ) &&
      isDeepStrictEqual(
        palette.find((node) => node.type === "core.loop")?.outputs.map((o) => o.key),
        ["loop", "done"],
      ) &&
      palette.find((node) => node.type === "core.set")?.outputs[0]?.key === null,
  );
  check(
    "the registry projection is plain JSON, as a server component must hand it over",
    JSON.parse(JSON.stringify(palette)) && palette.every((node) => node.configSchema !== null),
  );

  const listPage = await page("/workflows", token);
  check("the workflow list renders for its owner", listPage.status === 200,
    `got ${listPage.status}`);
  const anonymousList = await page("/workflows");
  check("the workflow list redirects when signed out", anonymousList.status === 307,
    `got ${anonymousList.status}`);

  const canvasPage = await page(`/workflows/${workflowId}`, token);
  check("the canvas renders for its owner", canvasPage.status === 200,
    `got ${canvasPage.status}`);
  check(
    "the canvas is server-rendered with the graph already in it",
    canvasPage.html.includes("manual_trigger") && canvasPage.html.includes("core.branch"),
  );
  const anonymousCanvas = await page(`/workflows/${workflowId}`);
  check("the canvas redirects when signed out", anonymousCanvas.status === 307,
    `got ${anonymousCanvas.status}`);

  // What the canvas actually writes: readable ids, a fractional position from a
  // drag, a named handle and a default one.
  const canvasGraph = {
    version: 1,
    nodes: [
      { id: "manual_trigger", type: "core.manual_trigger", position: { x: 140, y: 423 }, config: {} },
      {
        id: "set",
        type: "core.set",
        label: "Build the payload",
        position: { x: 420, y: 423 },
        config: { fields: { topic: "{{input.subject}}" }, merge: false },
      },
      {
        id: "branch",
        type: "core.branch",
        position: { x: 700, y: 423 },
        config: { left: "{{input.topic}}", operator: "is_not_empty" },
      },
      {
        id: "log",
        type: "core.log",
        position: { x: 833.7, y: 598.56 },
        config: { message: "Branch matched: {{input.matched}}", level: "info" },
      },
    ],
    edges: [
      { id: "e1", source: "manual_trigger", target: "set", sourceHandle: null },
      { id: "e2", source: "set", target: "branch", sourceHandle: null },
      { id: "e3", source: "branch", target: "log", sourceHandle: "true" },
    ],
  };

  const savedCanvas = await api("PATCH", `/api/workflows/${workflowId}`, { graph: canvasGraph }, token);
  check(
    "a canvas-shaped graph saves and reads back identically",
    savedCanvas.status === 200 && isDeepStrictEqual(savedCanvas.json?.data?.graph, canvasGraph),
    JSON.stringify(savedCanvas.json?.data?.graph).slice(0, 300),
  );
  check("the canvas graph is runnable", savedCanvas.json?.data?.runnable === true,
    JSON.stringify(savedCanvas.json?.data?.problems));

  const canvasRun = await api(
    "POST",
    `/api/workflows/${workflowId}/runs`,
    { input: { subject: "launch day" } },
    token,
  );
  const canvasSteps = canvasRun.json?.data?.steps ?? [];
  const byNode = (id) => canvasSteps.find((step) => step.nodeId === id);
  check(
    "the canvas graph runs, threading templates the whole way",
    canvasRun.json?.data?.status === "succeeded" &&
      byNode("set")?.output?.topic === "launch day" &&
      byNode("branch")?.branch === "true" &&
      byNode("log")?.status === "succeeded",
    JSON.stringify(canvasRun.json?.data).slice(0, 300),
  );
  check(
    "the log line the canvas shows is the resolved one",
    byNode("log")?.logs?.[0]?.message === "Branch matched: true",
    JSON.stringify(byNode("log")?.logs),
  );

  // --- live execution streaming (Phase 5) -----------------------------------
  // A run of only core nodes finishes in ~100 ms, which proves nothing about
  // *incremental* delivery. This graph spends ~1.4 s in two delay nodes, so status
  // transitions and log lines have to arrive spread out over several chunks.
  const streamGraph = {
    version: 1,
    nodes: [
      { id: "manual_trigger", type: "core.manual_trigger", position: { x: 0, y: 0 }, config: {} },
      { id: "hold_1", type: "core.delay", position: { x: 260, y: 0 }, config: { ms: 700 } },
      { id: "note_1", type: "core.log", position: { x: 520, y: 0 }, config: { message: "halfway", level: "info" } },
      { id: "hold_2", type: "core.delay", position: { x: 780, y: 0 }, config: { ms: 700 } },
      { id: "note_2", type: "core.log", position: { x: 1040, y: 0 }, config: { message: "done", level: "info" } },
    ],
    edges: [
      { id: "e1", source: "manual_trigger", target: "hold_1", sourceHandle: null },
      { id: "e2", source: "hold_1", target: "note_1", sourceHandle: null },
      { id: "e3", source: "note_1", target: "hold_2", sourceHandle: null },
      { id: "e4", source: "hold_2", target: "note_2", sourceHandle: null },
    ],
  };

  const savedStream = await api("PATCH", `/api/workflows/${workflowId}`, { graph: streamGraph }, token);
  check(
    "the delay node is registered and a graph using it is runnable",
    savedStream.status === 200 && savedStream.json?.data?.runnable === true,
    JSON.stringify(savedStream.json?.data?.problems),
  );

  const anonymousStream = await fetch(`${base}/api/workflows/${workflowId}/stream`, {
    headers: { accept: "text/event-stream" },
  });
  check(
    "the stream refuses an unauthenticated request, as JSON rather than as a stream",
    anonymousStream.status === 401 &&
      !anonymousStream.headers.get("content-type")?.includes("event-stream"),
    `got ${anonymousStream.status} ${anonymousStream.headers.get("content-type")}`,
  );
  await anonymousStream.body?.cancel();

  const missingStream = await fetch(`${base}/api/workflows/does-not-exist/stream`, {
    headers: { accept: "text/event-stream", cookie: `${cookieName}=${token}` },
  });
  check("the stream 404s for a workflow that is not yours", missingStream.status === 404,
    `got ${missingStream.status}`);
  await missingStream.body?.cancel();

  const watcher = await openStream(`/api/workflows/${workflowId}/stream`, token);
  check(
    "the stream answers as text/event-stream",
    watcher.response.status === 200 &&
      watcher.response.headers.get("content-type")?.includes("text/event-stream"),
    `${watcher.response.status} ${watcher.response.headers.get("content-type")}`,
  );
  check(
    "the stream is marked no-transform, so nothing in the path may buffer it",
    (watcher.response.headers.get("cache-control") ?? "").includes("no-transform"),
    watcher.response.headers.get("cache-control"),
  );

  // Trigger the run without awaiting it: POST /runs is synchronous, so the whole
  // point is that the stream reports progress while that request is still open.
  const running = api("POST", `/api/workflows/${workflowId}/runs`, { input: { subject: "live" } }, token);

  // Mid-run, a second client connects — a reload, or a judge opening a second tab.
  await sleep(700);
  const rejoined = await openStream(`/api/workflows/${workflowId}/stream`, token);

  const streamedRun = await running;
  await watcher.drained;
  rejoined.close();
  await rejoined.drained;

  const runId = streamedRun.json?.data?.id;
  check("the streamed run succeeded", streamedRun.json?.data?.status === "succeeded",
    JSON.stringify(streamedRun.json?.data?.error));

  const snapshots = watcher.frames.filter((frame) => frame.event === "snapshot");
  check(
    "the stream opens with a snapshot of the run it picked up by itself",
    snapshots.length >= 1 && snapshots[0].data?.id === runId,
    JSON.stringify(watcher.frames.map((frame) => frame.event)),
  );

  const stepFrames = watcher.frames.filter((frame) => frame.event === "step");
  const runFrames = watcher.frames.filter((frame) => frame.event === "run");
  const doneFrame = watcher.frames.find((frame) => frame.event === "done");

  check(
    "per-node status arrives while the run is still going, not in one batch at the end",
    stepFrames.some((frame) => frame.data?.step?.status === "running") &&
      stepFrames.some((frame) => frame.data?.step?.status === "succeeded"),
    JSON.stringify(stepFrames.map((frame) => [frame.data?.step?.nodeId, frame.data?.step?.status])),
  );

  check(
    "a log line written mid-node is streamed while that node is still running",
    stepFrames.some(
      (frame) =>
        frame.data?.step?.status === "running" &&
        (frame.data?.step?.logs ?? []).some((log) => log.message === "Waiting 700 ms."),
    ),
    JSON.stringify(
      stepFrames.map((frame) => [frame.data?.step?.status, (frame.data?.step?.logs ?? []).length]),
    ),
  );

  check(
    "the run's own completion is streamed too",
    runFrames.some((frame) => frame.data?.status === "succeeded"),
    JSON.stringify(runFrames.map((frame) => frame.data?.status)),
  );

  check("the stream closes itself when the run ends", doneFrame?.data?.reason === "finished",
    JSON.stringify(doneFrame));

  const spread = watcher.chunks.length > 1
    ? watcher.chunks.at(-1).at - watcher.chunks[0].at
    : 0;
  check(
    "events cross the wire in separate chunks over time — genuinely not buffered",
    watcher.chunks.length >= 3 && spread >= 400,
    `${watcher.chunks.length} chunks over ${spread} ms`,
  );

  const rejoinSnapshot = rejoined.frames.find((frame) => frame.event === "snapshot");
  check(
    "a client joining mid-run recovers correct state from a snapshot",
    rejoinSnapshot?.data?.id === runId &&
      rejoinSnapshot?.data?.status === "running" &&
      (rejoinSnapshot?.data?.steps ?? []).length >= 1,
    JSON.stringify({
      status: rejoinSnapshot?.data?.status,
      steps: (rejoinSnapshot?.data?.steps ?? []).map((step) => [step.nodeId, step.status]),
    }),
  );

  const pinned = await openStream(`/api/workflows/${workflowId}/stream?runId=${runId}`, token);
  await pinned.drained;
  check(
    "a stream pinned to a finished run replays it once and closes",
    pinned.frames.find((frame) => frame.event === "snapshot")?.data?.id === runId &&
      pinned.frames.find((frame) => frame.event === "done")?.data?.reason === "finished",
    JSON.stringify(pinned.frames.map((frame) => frame.event)),
  );

  // Cost, not correctness: a stream with nothing to watch must not stay open and
  // bill Cloud Run CPU for ever. This is the only slow check in the script.
  const idleWorkflow = await api("POST", "/api/workflows", { name: "verify: idle stream" }, token);
  const idleId = idleWorkflow.json?.data?.id;
  console.log("        (waiting ~21 s for the idle stream to close itself)");
  const idle = await openStream(`/api/workflows/${idleId}/stream`, token);
  await idle.drained;
  check(
    "a stream with no run to watch closes itself instead of idling",
    idle.frames.find((frame) => frame.event === "done")?.data?.reason === "idle",
    JSON.stringify(idle.frames.map((frame) => [frame.event, frame.data?.reason])),
  );
  await api("DELETE", `/api/workflows/${idleId}`, undefined, token);

  // Deleting the trigger is what a half-built canvas looks like: it must save.
  const halfBuilt = {
    ...canvasGraph,
    nodes: canvasGraph.nodes.filter((node) => node.id !== "manual_trigger"),
    edges: canvasGraph.edges.filter((edge) => edge.source !== "manual_trigger"),
  };
  const savedHalfBuilt = await api("PATCH", `/api/workflows/${workflowId}`, { graph: halfBuilt }, token);
  check(
    "a half-built canvas still saves, and says why it cannot run",
    savedHalfBuilt.status === 200 &&
      savedHalfBuilt.json?.data?.runnable === false &&
      savedHalfBuilt.json?.data?.problems?.[0]?.code === "no_trigger",
    JSON.stringify(savedHalfBuilt.json?.data?.problems),
  );


  // --- phase 6: provider settings, LLM node, agent node -----------------------
  //
  // The key never appears in this file or in any response. It is read from
  // VERIFY_GEMINI_KEY, which can be piped in without it being printed:
  //
  //   VERIFY_GEMINI_KEY=$(gcloud services api-keys get-key-string … ) \
  //     node --env-file=.env scripts/verify-api.mjs <url>
  const providedKey = process.env.VERIFY_GEMINI_KEY ?? null;

  const settingsBefore = await api("GET", "/api/settings/provider", undefined, token);
  check(
    "provider settings read back with no key material in them",
    settingsBefore.status === 200 &&
      settingsBefore.json?.data?.provider === "google" &&
      typeof settingsBefore.json.data.configured === "boolean" &&
      typeof settingsBefore.json.data.model === "string" &&
      ["user", "environment", "none"].includes(settingsBefore.json.data.source) &&
      !("apiKey" in settingsBefore.json.data) &&
      !("ciphertext" in settingsBefore.json.data),
    JSON.stringify(settingsBefore.json?.data),
  );

  const alreadyConfigured = settingsBefore.json?.data?.configured === true;

  const rejected = await api(
    "PUT",
    "/api/settings/provider",
    { apiKey: "AIzaNotARealKeyAtAll_000000000000000000" },
    token,
  );
  check(
    "a bad key is refused at save time, not at run time",
    rejected.status === 400 &&
      rejected.json?.error?.code === "invalid_request" &&
      /rejected this key/i.test(rejected.json.error.message ?? ""),
    JSON.stringify(rejected.json),
  );

  const stillThere = await api("GET", "/api/settings/provider", undefined, token);
  check(
    "a refused key does not overwrite what was already stored",
    stillThere.json?.data?.configured === alreadyConfigured,
    JSON.stringify(stillThere.json?.data),
  );

  // Storing a key is destructive if one is already there: the API is write-only, so a
  // stored key cannot be read back and put where it was. So this only writes when
  // there is nothing to lose.
  let wroteKey = false;
  if (providedKey && !alreadyConfigured) {
    const saved = await api("PUT", "/api/settings/provider", { apiKey: providedKey }, token);
    wroteKey = saved.status === 200;
    check(
      "a real key verifies against the provider and is stored",
      saved.status === 200 && saved.json?.data?.configured === true,
      JSON.stringify(saved.json),
    );

    const bodies = JSON.stringify([saved.json, (await api("GET", "/api/settings/provider", undefined, token)).json]);
    check(
      "the stored key appears in no response body",
      !bodies.includes(providedKey) && !bodies.includes(providedKey.slice(0, 12)),
      "a response contained key material",
    );

    const [row] = await sql.query(
      'select "ciphertext", "iv", "authTag" from "credential" where "ownerId" = $1 and "kind" = $2',
      [user.id, "llm.google"],
    );
    check(
      "the key is encrypted at rest, not stored as text",
      Boolean(row) &&
        !row.ciphertext.includes(providedKey) &&
        Buffer.from(row.ciphertext, "base64").toString("utf8") !== providedKey &&
        row.iv.length > 0 &&
        row.authTag.length > 0,
      JSON.stringify({ hasRow: Boolean(row) }),
    );
  } else if (providedKey) {
    skip(
      "storing a key end to end",
      "a key is already stored for this user; the API is write-only so it cannot be restored afterwards",
    );
  } else {
    skip("storing a key end to end", "VERIFY_GEMINI_KEY is not set");
  }

  const settingsNow = await api("GET", "/api/settings/provider", undefined, token);
  const canCallModel =
    settingsNow.json?.data?.source === "user" || settingsNow.json?.data?.source === "environment";

  if (canCallModel) {
    const models = await api("GET", "/api/settings/provider/models", undefined, token);
    const list = models.json?.data?.models ?? [];
    check(
      "the model list is live from the provider and non-empty",
      models.status === 200 && list.length > 0 && list.every((model) => typeof model.id === "string"),
      JSON.stringify({ status: models.status, count: list.length, first: list[0]?.id }),
    );
    const badModel = await api("PUT", "/api/settings/provider", { model: "gemini-does-not-exist" }, token);
    const afterBad = await api("GET", "/api/settings/provider", undefined, token);
    check(
      "a model name the provider does not know is refused, and nothing is stored",
      badModel.status === 400 &&
        badModel.json?.error?.code === "invalid_request" &&
        afterBad.json?.data?.model !== "gemini-does-not-exist",
      JSON.stringify({ save: badModel.json, stored: afterBad.json?.data?.model }),
    );

    // The catalogue is not the same as what a key may call: models.list returns
    // gemini-2.5-flash, and calling it answers 404 "no longer available to new users".
    // A model choice is therefore validated with a real call, which is what this proves.
    const listedButDead = list.find((model) => model.id === "gemini-2.5-flash");
    if (listedButDead) {
      const dead = await api("PUT", "/api/settings/provider", { model: "gemini-2.5-flash" }, token);
      check(
        "a model the catalogue lists but the key cannot serve is refused",
        dead.status === 400 && /cannot use/.test(dead.json?.error?.message ?? ""),
        JSON.stringify(dead.json),
      );
    } else {
      skip(
        "a model the catalogue lists but the key cannot serve is refused",
        "this key's catalogue no longer lists gemini-2.5-flash",
      );
    }

    const good = afterBad.json?.data?.model;
    const reselect = await api("PUT", "/api/settings/provider", { model: good }, token);
    // A 409 here is the free tier throttling the probe, not a broken model — the
    // allowance on the current default is 20 requests a minute and this suite makes
    // plenty. Treat it as inconclusive rather than red, but never treat a 400 that way:
    // that one really does mean the key cannot run the model (Phase 13).
    if (reselect.status === 409) {
      skip(
        "a model that works is accepted, proved by a real call",
        `free-tier rate limit hit while probing "${good}" — re-run in a minute`,
      );
    } else {
      check(
        "a model that works is accepted, proved by a real call",
        reselect.status === 200 && reselect.json?.data?.model === good,
        JSON.stringify({ status: reselect.status, model: reselect.json?.data?.model, error: reselect.json?.error }),
      );
    }
  } else {
    skip("listing models", "no key available to this user or to the server");
  }

  if (canCallModel) {
    // --- the LLM node, on the deployed engine --------------------------------
    const llmWorkflow = await api("POST", "/api/workflows", {
      name: "verify: llm node",
      graph: {
        version: 1,
        nodes: [
          { id: "trigger", type: "core.manual_trigger", position: { x: 0, y: 0 }, config: {} },
          {
            id: "ask",
            type: "ai.llm",
            position: { x: 240, y: 0 },
            config: {
              prompt: "Reply with exactly one word, lowercase, no punctuation: the colour of {{input.thing}}.",
              system: "You answer in one word.",
              temperature: 0,
            },
          },
        ],
        edges: [{ id: "e1", source: "trigger", target: "ask", sourceHandle: null }],
      },
    }, token);
    const llmId = llmWorkflow.json?.data?.id;

    const llmRun = await api("POST", `/api/workflows/${llmId}/runs`, { input: { thing: "grass" } }, token);
    const llmStep = (llmRun.json?.data?.steps ?? []).find((step) => step.nodeType === "ai.llm");
    check(
      "an LLM node runs on the deployed engine and returns text",
      llmRun.status === 201 &&
        llmRun.json?.data?.status === "succeeded" &&
        llmStep?.status === "succeeded" &&
        typeof llmStep.output?.text === "string" &&
        llmStep.output.text.length > 0,
      JSON.stringify({ run: llmRun.json?.data?.status, step: llmStep?.status, error: llmStep?.error, text: llmStep?.output?.text }),
    );
    check(
      "the LLM step names the model that answered and logs the call",
      typeof llmStep?.output?.model === "string" &&
        llmStep.output.model.length > 0 &&
        (llmStep.logs ?? []).some((log) => /Asking /.test(log.message)),
      JSON.stringify({ model: llmStep?.output?.model, logs: (llmStep?.logs ?? []).map((log) => log.message) }),
    );
    check(
      "no step config or output carries key material",
      !JSON.stringify(llmRun.json).includes("AIza"),
      "a run record contained something that looks like a key",
    );
    await api("DELETE", `/api/workflows/${llmId}`, undefined, token);

    // --- the agent node: tools, a runtime decision, and the branch it drives --
    const agentWorkflow = await api("POST", "/api/workflows", {
      name: "verify: agent node",
      graph: {
        version: 1,
        nodes: [
          { id: "trigger", type: "core.manual_trigger", position: { x: 0, y: 0 }, config: {} },
          {
            id: "agent",
            type: "ai.agent",
            position: { x: 240, y: 0 },
            config: {
              objective:
                "Read the customer message. Decide whether it needs urgent attention. Use the core_log tool once to record your reasoning in one short sentence, then give your decision.",
              choices: ["urgent", "normal"],
              tools: ["core.log"],
              maxIterations: 4,
              temperature: 0,
            },
          },
          {
            id: "route",
            type: "core.branch",
            position: { x: 480, y: 0 },
            config: { left: "{{input.decision}}", operator: "equals", right: "urgent" },
          },
          { id: "escalate", type: "core.log", position: { x: 720, y: -80 }, config: { message: "escalated" } },
          { id: "queue", type: "core.log", position: { x: 720, y: 80 }, config: { message: "queued" } },
        ],
        edges: [
          { id: "e1", source: "trigger", target: "agent", sourceHandle: null },
          { id: "e2", source: "agent", target: "route", sourceHandle: null },
          { id: "e3", source: "route", target: "escalate", sourceHandle: "true" },
          { id: "e4", source: "route", target: "queue", sourceHandle: "false" },
        ],
      },
    }, token);
    const agentId = agentWorkflow.json?.data?.id;

    const agentRun = await api("POST", `/api/workflows/${agentId}/runs`, {
      input: {
        name: "Priya",
        message: "Our production checkout has been down for 40 minutes and we are losing orders.",
      },
    }, token);
    const steps = agentRun.json?.data?.steps ?? [];
    const agentStep = steps.find((step) => step.nodeType === "ai.agent");
    const routeStep = steps.find((step) => step.nodeId === "route");
    const escalateStep = steps.find((step) => step.nodeId === "escalate");

    check(
      "an agent node runs on the deployed engine and reaches a decision",
      agentRun.json?.data?.status === "succeeded" &&
        agentStep?.status === "succeeded" &&
        agentStep.output?.decision === "urgent",
      JSON.stringify({
        run: agentRun.json?.data?.status,
        step: agentStep?.status,
        error: agentStep?.error,
        decision: agentStep?.output?.decision,
        text: agentStep?.output?.text,
      }),
    );
    check(
      "the agent called a tool from the registry, and it executed",
      Array.isArray(agentStep?.output?.toolCalls) &&
        agentStep.output.toolCalls.length > 0 &&
        agentStep.output.toolCalls.every((call) => call.name === "core_log" && call.ok === true),
      JSON.stringify(agentStep?.output?.toolCalls),
    );
    check(
      "the agent's reasoning is on the step as log lines",
      (agentStep?.logs ?? []).some((log) => /Calling tool core_log/.test(log.message)) &&
        (agentStep?.logs ?? []).some((log) => /^\[core_log\]/.test(log.message)) &&
        (agentStep?.logs ?? []).some((log) => /Decision: urgent/.test(log.message)),
      JSON.stringify((agentStep?.logs ?? []).map((log) => log.message)),
    );
    check(
      "the agent's decision drives the branch, with no keyword rule anywhere",
      routeStep?.branch === "true" && escalateStep?.status === "succeeded",
      JSON.stringify({ branch: routeStep?.branch, escalate: escalateStep?.status }),
    );

    // The same graph, the opposite message. Nothing in the workflow changed.
    const calmRun = await api("POST", `/api/workflows/${agentId}/runs`, {
      input: {
        name: "Sam",
        message: "Whenever you get a chance, it would be nice to have a dark mode. No rush at all.",
      },
    }, token);
    const calmSteps = calmRun.json?.data?.steps ?? [];
    const calmAgent = calmSteps.find((step) => step.nodeType === "ai.agent");
    check(
      "the same graph takes the other branch for a calm message",
      calmRun.json?.data?.status === "succeeded" &&
        calmAgent?.output?.decision === "normal" &&
        calmSteps.find((step) => step.nodeId === "route")?.branch === "false" &&
        calmSteps.find((step) => step.nodeId === "queue")?.status === "succeeded",
      JSON.stringify({ decision: calmAgent?.output?.decision, text: calmAgent?.output?.text }),
    );
    await api("DELETE", `/api/workflows/${agentId}`, undefined, token);

    // --- the iteration cap, against a deliberately non-converging prompt -----
    const capWorkflow = await api("POST", "/api/workflows", {
      name: "verify: agent cap",
      graph: {
        version: 1,
        nodes: [
          { id: "trigger", type: "core.manual_trigger", position: { x: 0, y: 0 }, config: {} },
          {
            id: "agent",
            type: "ai.agent",
            position: { x: 240, y: 0 },
            config: {
              objective:
                "Call the core_log tool with an increasing counter, over and over, for ever. Never answer with text. Always call a tool.",
              tools: ["core.log"],
              maxIterations: 2,
              temperature: 0,
            },
          },
        ],
        edges: [{ id: "e1", source: "trigger", target: "agent", sourceHandle: null }],
      },
    }, token);
    const capId = capWorkflow.json?.data?.id;
    const capRun = await api("POST", `/api/workflows/${capId}/runs`, {}, token);
    const capStep = (capRun.json?.data?.steps ?? []).find((step) => step.nodeType === "ai.agent");
    check(
      "an agent that will not converge fails at its cap instead of burning quota",
      capRun.json?.data?.status === "failed" &&
        capStep?.status === "failed" &&
        /still calling tools after 2 model calls/.test(capStep.error ?? ""),
      JSON.stringify({ run: capRun.json?.data?.status, error: capStep?.error }),
    );
    await api("DELETE", `/api/workflows/${capId}`, undefined, token);

    // --- phase 7: natural language -> workflow generation --------------------
    //
    // The headline feature. What a script can prove that a unit test cannot: a real
    // model, reached through the deployed route, with the caller's own stored key,
    // produces a workflow that is persisted, runnable and editable.
    const demoPrompt =
      "When I run this, summarise the support message I give it, decide whether it is urgent, and log urgent ones as a warning.";

    const generated = await api("POST", "/api/workflows/generate", { prompt: demoPrompt }, token);
    const madeWorkflow = generated.json?.data?.workflow;
    const madeGraph = madeWorkflow?.graph;
    check(
      "a plain-language request generates a real, runnable, persisted workflow",
      generated.status === 201 &&
        madeWorkflow?.runnable === true &&
        madeGraph?.version === 1 &&
        madeGraph.nodes.length >= 3 &&
        madeGraph.edges.length >= 2 &&
        (madeWorkflow.problems ?? []).length === 0,
      JSON.stringify({
        status: generated.status,
        runnable: madeWorkflow?.runnable,
        nodes: madeGraph?.nodes?.length,
        edges: madeGraph?.edges?.length,
        problems: madeWorkflow?.problems,
        error: generated.json?.error,
      }),
    );

    const madeId = madeWorkflow?.id;

    check(
      "every generated node names a registry type and carries a position",
      Array.isArray(madeGraph?.nodes) &&
        madeGraph.nodes.every(
          (node) =>
            registryTypes.has(node.type) &&
            Number.isFinite(node.position?.x) &&
            Number.isFinite(node.position?.y),
        ),
      JSON.stringify(madeGraph?.nodes?.map((node) => [node.type, node.position])),
    );

    // An overlapping graph reads as broken on stage, so this is a demo property, not
    // a cosmetic one. A canvas node is 224 px wide and about 100 px tall.
    let overlapping = null;
    for (const a of madeGraph?.nodes ?? []) {
      for (const b of madeGraph?.nodes ?? []) {
        if (a.id >= b.id) continue;
        if (Math.abs(a.position.x - b.position.x) < 224 && Math.abs(a.position.y - b.position.y) < 100) {
          overlapping = [a.id, b.id];
        }
      }
    }
    check("no two generated nodes overlap on the canvas", overlapping === null, JSON.stringify(overlapping));

    const triggerIds = new Set(
      (madeGraph?.nodes ?? []).filter((node) => triggerTypes.has(node.type)).map((node) => node.id),
    );
    check(
      "exactly one trigger, and nothing edges into it",
      triggerIds.size === 1 && !(madeGraph?.edges ?? []).some((edge) => triggerIds.has(edge.target)),
      JSON.stringify({ triggers: [...triggerIds], edges: madeGraph?.edges?.length }),
    );

    const generationMeta = generated.json?.data?.generation;
    check(
      "the generation reports which model answered, on the caller's own key",
      typeof generationMeta?.model === "string" &&
        generationMeta.model.length > 0 &&
        ["user", "environment"].includes(generationMeta.source) &&
        Array.isArray(generationMeta.unsupported) &&
        Array.isArray(generationMeta.attempts) &&
        generationMeta.attempts.length <= 2,
      JSON.stringify({
        model: generationMeta?.model,
        source: generationMeta?.source,
        attempts: generationMeta?.attempts?.length,
        unsupported: generationMeta?.unsupported,
      }),
    );

    if (madeId) {
      // Immediately runnable — BUILD_PLAN.md Phase 7, task 5. The whole point of
      // generating a real workflow rather than a picture of one.
      const generatedRun = await api(
        "POST",
        `/api/workflows/${madeId}/runs`,
        { input: { message: "Our production checkout has been down for 40 minutes." } },
        token,
      );
      check(
        "a generated workflow runs end to end with no edit first",
        generatedRun.status === 201 &&
          generatedRun.json?.data?.status === "succeeded" &&
          (generatedRun.json?.data?.steps ?? []).length >= 3,
        JSON.stringify({
          status: generatedRun.json?.data?.status,
          steps: (generatedRun.json?.data?.steps ?? []).map((step) => [step.nodeId, step.status]),
          // The error too: a generated run that fails is nearly always the free tier
          // rate-limiting a burst of calls, and a status alone cannot tell you that.
          errors: (generatedRun.json?.data?.steps ?? [])
            .filter((step) => step.error)
            .map((step) => [step.nodeId, step.error]),
        }),
      );

      // Immediately editable, and the edit round-trips through jsonb unchanged.
      const edited = structuredClone(madeGraph);
      edited.nodes[edited.nodes.length - 1].label = "Edited by verify";
      const patched = await api("PATCH", `/api/workflows/${madeId}`, { graph: edited }, token);
      const reread = await api("GET", `/api/workflows/${madeId}`, undefined, token);
      check(
        "a generated workflow is editable and the edit round-trips",
        patched.status === 200 &&
          reread.json?.data?.graph?.nodes?.at(-1)?.label === "Edited by verify" &&
          reread.json?.data?.runnable === true,
        JSON.stringify({ patch: patched.status, label: reread.json?.data?.graph?.nodes?.at(-1)?.label }),
      );

      await api("DELETE", `/api/workflows/${madeId}`, undefined, token);
    }

    const emptyPrompt = await api("POST", "/api/workflows/generate", { prompt: "   " }, token);
    check(
      "an empty prompt is refused before any model is called",
      emptyPrompt.status === 400 && emptyPrompt.json?.error?.code === "invalid_request",
      JSON.stringify(emptyPrompt.json),
    );

    // A request for things no node can do must be told so, not quietly given a
    // workflow that does less than it was asked. Nothing dangerous can be generated
    // either way: the registry is the entire vocabulary.
    const [{ n: beforeImpossible }] = await sql.query(
      'select count(*)::int as n from "workflow" where "ownerId" = $1',
      [user.id],
    );
    const impossible = await api(
      "POST",
      "/api/workflows/generate",
      {
        prompt:
          "SSH into my production server, delete the database, mine bitcoin on my laptop, and text my mother about it.",
      },
      token,
    );
    const impossibleWorkflow = impossible.json?.data?.workflow;
    check(
      "a request no node can satisfy is reported as unsupported, and nothing dangerous is built",
      impossible.status === 201 &&
        (impossible.json?.data?.generation?.unsupported ?? []).length > 0 &&
        (impossibleWorkflow?.graph?.nodes ?? []).every((node) => registryTypes.has(node.type)),
      JSON.stringify({
        status: impossible.status,
        unsupported: impossible.json?.data?.generation?.unsupported,
        nodes: impossibleWorkflow?.graph?.nodes?.map((node) => node.type),
      }),
    );
    if (impossibleWorkflow?.id) {
      await api("DELETE", `/api/workflows/${impossibleWorkflow.id}`, undefined, token);
      const [{ n: afterImpossible }] = await sql.query(
        'select count(*)::int as n from "workflow" where "ownerId" = $1',
        [user.id],
      );
      check(
        "generation leaves no extra rows behind",
        afterImpossible === beforeImpossible,
        `${beforeImpossible} before, ${afterImpossible} after`,
      );
    }
  } else {
    skip("the LLM node, the agent node and the iteration cap", "no key available");
    skip("natural language workflow generation", "no key available");
  }

  if (wroteKey) {
    const cleared = await api("DELETE", "/api/settings/provider", undefined, token);
    check(
      "the stored key can be deleted",
      cleared.status === 200 && cleared.json?.data?.configured === false,
      JSON.stringify(cleared.json?.data),
    );
    const [{ n: creds }] = await sql.query(
      'select count(*)::int as n from "credential" where "ownerId" = $1 and "kind" = $2',
      [user.id, "llm.google"],
    );
    check("deleting the key removes the row", creds === 0, `${creds} credential rows remain`);
  }

  // --- phase 8: webhook and schedule triggers -------------------------------
  //
  // The two routes with no session. Everything here runs WITHOUT the cookie except
  // where a workflow is being set up, because "unauthenticated by design" is the
  // property under test.

  // The cron tick's guard comes first: it is the only endpoint that acts across every
  // owner, so it is the one whose rejection matters most.
  const tickNoSecret = await api("POST", "/api/cron/tick");
  check(
    "cron tick rejects a request with no secret",
    tickNoSecret.status === 401 && tickNoSecret.json?.error?.code === "unauthenticated",
    `got ${tickNoSecret.status} ${JSON.stringify(tickNoSecret.json).slice(0, 200)}`,
  );

  const tickWrongSecret = await fetch(`${base}/api/cron/tick`, {
    method: "POST",
    headers: { "x-cron-secret": "not-the-secret-at-all" },
  });
  check("cron tick rejects a wrong secret", tickWrongSecret.status === 401);

  // A session cookie must not substitute for the secret: this is a machine endpoint.
  const tickWithCookie = await api("POST", "/api/cron/tick", undefined, token);
  check("cron tick is not satisfied by a signed-in session", tickWithCookie.status === 401);

  const tickGet = await fetch(`${base}/api/cron/tick`, { method: "GET" });
  check("cron tick refuses GET", tickGet.status === 405, `got ${tickGet.status}`);

  const cronSecret = process.env.CRON_SECRET;
  async function tick() {
    const response = await fetch(`${base}/api/cron/tick`, {
      method: "POST",
      headers: { "x-cron-secret": cronSecret },
    });
    return { status: response.status, json: await response.json().catch(() => null) };
  }

  if (!cronSecret) {
    skip("cron tick accepts the real secret and fires due schedules", "CRON_SECRET not in env");
  } else {
    const accepted = await tick();
    check(
      "cron tick accepts the real secret",
      accepted.status === 200 && typeof accepted.json?.data?.checkedAt === "string",
      `got ${accepted.status} ${JSON.stringify(accepted.json).slice(0, 200)}`,
    );
  }

  // --- the webhook trigger --------------------------------------------------
  const hookGraph = {
    version: 1,
    nodes: [
      {
        id: "hook",
        type: "core.webhook_trigger",
        position: { x: 0, y: 0 },
        config: { requiredFields: ["message"] },
      },
      {
        id: "record",
        type: "core.log",
        position: { x: 240, y: 0 },
        config: { message: "from {{trigger.name}}: {{trigger.message}}" },
      },
    ],
    edges: [{ id: "e1", source: "hook", target: "record", sourceHandle: null }],
  };

  const hookCreated = await api(
    "POST",
    "/api/workflows",
    { name: "Phase 8 webhook verification", graph: hookGraph },
    token,
  );
  const hookId = hookCreated.json?.data?.id;
  const hookUrl = hookCreated.json?.data?.webhookUrl;
  check(
    "a workflow with a webhook trigger exposes its URL",
    hookCreated.status === 201 && typeof hookUrl === "string" && hookUrl.includes("/api/webhook/"),
    JSON.stringify(hookCreated.json?.data?.webhookUrl),
  );
  check(
    "the webhook URL is built on the canonical base, not a hashed host",
    typeof hookUrl === "string" && hookUrl.startsWith(base),
    `${hookUrl} does not start with ${base}`,
  );
  check(
    "the token is unguessable, not the workflow id",
    typeof hookUrl === "string" && !hookUrl.includes(hookId) && hookUrl.split("/").pop().length >= 32,
    hookUrl,
  );
  check(
    "a workflow with no webhook trigger exposes no URL",
    (await api("GET", `/api/workflows/${workflowId}`, undefined, token)).json?.data?.webhookUrl === null,
  );

  // Every call below is deliberately made with NO cookie.
  async function postHook(url, body, raw = false) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ? body : JSON.stringify(body),
    });
    return { status: response.status, json: await response.json().catch(() => null) };
  }

  const badToken = await postHook(`${base}/api/webhook/${"z".repeat(32)}`, { message: "x" });
  check("an unknown webhook token is 404", badToken.status === 404, `got ${badToken.status}`);

  const malformedToken = await postHook(`${base}/api/webhook/..%2Fetc`, { message: "x" });
  check(
    "a malformed webhook token never reaches a query",
    malformedToken.status === 404,
    `got ${malformedToken.status}`,
  );

  // A real token on a workflow whose graph has no webhook trigger must not run it.
  const [manualRow] = await sql.query('select "webhookToken" from "workflow" where "id" = $1', [workflowId]);
  const wrongTrigger = await postHook(`${base}/api/webhook/${manualRow.webhookToken}`, { message: "x" });
  check(
    "a token whose workflow has no webhook trigger is 404, not a run",
    wrongTrigger.status === 404,
    `got ${wrongTrigger.status} ${JSON.stringify(wrongTrigger.json).slice(0, 200)}`,
  );

  const missingField = await postHook(hookUrl, { name: "Priya" });
  check(
    "a body missing a required field is 400 and names the field",
    missingField.status === 400 && missingField.json?.error?.details?.missing?.includes("message"),
    JSON.stringify(missingField.json).slice(0, 250),
  );

  const notJson = await postHook(hookUrl, "{not json", true);
  check("a malformed body is 400", notJson.status === 400, `got ${notJson.status}`);

  const notObject = await postHook(hookUrl, "[1,2]", true);
  check("a non-object body is 400", notObject.status === 400, `got ${notObject.status}`);

  // A rejected call must cost nothing: no run row, so no history and no model spend.
  const [{ n: runsAfterRejections }] = await sql.query(
    'select count(*)::int as n from "run" where "workflowId" = $1',
    [hookId],
  );
  check(
    "a rejected webhook call creates no run",
    runsAfterRejections === 0,
    `${runsAfterRejections} runs exist`,
  );

  const fired = await postHook(hookUrl, {
    name: "Priya",
    message: "Our production checkout has been down for 40 minutes.",
  });
  check(
    "a valid webhook call runs the workflow with no session at all",
    fired.status === 201 && fired.json?.data?.status === "succeeded",
    `got ${fired.status} ${JSON.stringify(fired.json).slice(0, 300)}`,
  );
  check(
    "the run is attributed to the webhook trigger",
    fired.json?.data?.trigger === "webhook",
    JSON.stringify(fired.json?.data?.trigger),
  );
  check(
    "the posted body is the trigger's output",
    fired.json?.data?.steps?.[0]?.output?.message ===
      "Our production checkout has been down for 40 minutes.",
    JSON.stringify(fired.json?.data?.steps?.[0]?.output),
  );
  check(
    "{{trigger.field}} resolves to the posted body downstream",
    fired.json?.data?.steps?.[1]?.config?.message ===
      "from Priya: Our production checkout has been down for 40 minutes.",
    JSON.stringify(fired.json?.data?.steps?.[1]?.config),
  );
  check(
    "the run is owned by the workflow's owner, not by nobody",
    (await api("GET", `/api/runs/${fired.json?.data?.id}`, undefined, token)).status === 200,
  );

  // An empty body is legitimate — a webhook that only says "something happened".
  const noRequirement = await api(
    "PATCH",
    `/api/workflows/${hookId}`,
    { graph: { ...hookGraph, nodes: [{ ...hookGraph.nodes[0], config: { requiredFields: [] } }, hookGraph.nodes[1]] } },
    token,
  );
  check("required fields can be cleared", noRequirement.status === 200);
  const emptyBody = await fetch(hookUrl, { method: "POST" });
  check("an empty body is accepted as {}", emptyBody.status === 201, `got ${emptyBody.status}`);

  // --- the schedule trigger -------------------------------------------------
  const scheduleGraph = {
    version: 1,
    nodes: [
      {
        id: "every_morning",
        type: "core.schedule_trigger",
        position: { x: 0, y: 0 },
        config: { cron: "0 9 * * *" },
      },
      {
        id: "note",
        type: "core.log",
        position: { x: 240, y: 0 },
        config: { message: "scheduled run for {{trigger.scheduledFor}}" },
      },
    ],
    edges: [{ id: "e1", source: "every_morning", target: "note", sourceHandle: null }],
  };

  const scheduled = await api(
    "POST",
    "/api/workflows",
    { name: "Phase 8 schedule verification", graph: scheduleGraph },
    token,
  );
  const scheduleId = scheduled.json?.data?.id;
  check(
    "saving a schedule trigger sets the next due time",
    scheduled.status === 201 &&
      typeof scheduled.json?.data?.scheduleNextAt === "string" &&
      new Date(scheduled.json.data.scheduleNextAt) > new Date(),
    JSON.stringify(scheduled.json?.data?.scheduleNextAt),
  );
  check(
    "the cron expression is reported back",
    scheduled.json?.data?.scheduleCron === "0 9 * * *",
    JSON.stringify(scheduled.json?.data?.scheduleCron),
  );
  check(
    "the due time is on the minute, in UTC",
    scheduled.json?.data?.scheduleNextAt?.endsWith("T09:00:00.000Z"),
    scheduled.json?.data?.scheduleNextAt,
  );

  const badCron = await api(
    "PATCH",
    `/api/workflows/${scheduleId}`,
    {
      graph: {
        ...scheduleGraph,
        nodes: [{ ...scheduleGraph.nodes[0], config: { cron: "0 9 * * MON" } }, scheduleGraph.nodes[1]],
      },
    },
    token,
  );
  check(
    "an unsupported cron expression is saved but reported as not runnable",
    badCron.status === 200 &&
      badCron.json?.data?.runnable === false &&
      badCron.json.data.problems.some((problem) => problem.code === "invalid_config"),
    JSON.stringify(badCron.json?.data?.problems).slice(0, 250),
  );
  check(
    "an unsupported expression leaves no schedule behind",
    badCron.json?.data?.scheduleNextAt === null,
    JSON.stringify(badCron.json?.data?.scheduleNextAt),
  );

  // Restore a good expression, then make it due by moving the stored time into the
  // past — which is exactly the state Cloud Scheduler finds at 09:00.
  await api("PATCH", `/api/workflows/${scheduleId}`, { graph: scheduleGraph }, token);
  const dueAt = new Date(Date.now() - 60_000);
  dueAt.setUTCSeconds(0, 0);

  if (!cronSecret) {
    skip("a due schedule is fired by the cron tick", "CRON_SECRET not in env");
  } else {
    await sql.query('update "workflow" set "scheduleNextAt" = $1 where "id" = $2', [dueAt, scheduleId]);

    const firedTick = await tick();
    const firedIds = (firedTick.json?.data?.fired ?? []).map((entry) => entry.workflowId);
    check(
      "a due schedule is fired by the cron tick",
      firedTick.status === 200 && firedIds.includes(scheduleId),
      JSON.stringify(firedTick.json?.data).slice(0, 300),
    );

    const scheduleRuns = await api("GET", `/api/workflows/${scheduleId}/runs`, undefined, token);
    const scheduleRun = (scheduleRuns.json?.data ?? [])[0];
    check(
      "the run it created is attributed to the schedule trigger and succeeded",
      scheduleRun?.trigger === "schedule" && scheduleRun?.status === "succeeded",
      JSON.stringify(scheduleRun).slice(0, 250),
    );

    const after = await api("GET", `/api/workflows/${scheduleId}`, undefined, token);
    check(
      "firing advances the due time into the future",
      new Date(after.json?.data?.scheduleNextAt) > new Date(),
      JSON.stringify(after.json?.data?.scheduleNextAt),
    );
    check(
      "firing records when it last fired",
      typeof after.json?.data?.scheduleLastFiredAt === "string",
      JSON.stringify(after.json?.data?.scheduleLastFiredAt),
    );

    // The idempotency property. A Scheduler retry, an overlapping manual run of the
    // job, or two containers must not produce two runs for one slot.
    const secondTick = await tick();
    check(
      "an immediate second tick fires nothing",
      (secondTick.json?.data?.fired ?? []).length === 0,
      JSON.stringify(secondTick.json?.data).slice(0, 250),
    );
    const [{ n: scheduleRunCount }] = await sql.query(
      'select count(*)::int as n from "run" where "workflowId" = $1',
      [scheduleId],
    );
    check(
      "one due slot produced exactly one run",
      scheduleRunCount === 1,
      `${scheduleRunCount} runs for one slot`,
    );

    // A due schedule whose trigger has been removed must stop being selected rather
    // than being retried on every tick for ever.
    await sql.query('update "workflow" set "scheduleNextAt" = $1 where "id" = $2', [dueAt, scheduleId]);
    await api(
      "PATCH",
      `/api/workflows/${scheduleId}`,
      { graph: { version: 1, nodes: [{ id: "t", type: "core.manual_trigger", position: { x: 0, y: 0 }, config: {} }], edges: [] } },
      token,
    );
    await sql.query('update "workflow" set "scheduleNextAt" = $1 where "id" = $2', [dueAt, scheduleId]);
    const clearedTick = await tick();
    check(
      "a due workflow whose schedule trigger is gone is cleared, not run",
      (clearedTick.json?.data?.cleared ?? []).includes(scheduleId) &&
        (clearedTick.json?.data?.fired ?? []).every((entry) => entry.workflowId !== scheduleId),
      JSON.stringify(clearedTick.json?.data).slice(0, 250),
    );
    const [{ scheduleNextAt: clearedAt }] = await sql.query(
      'select "scheduleNextAt" from "workflow" where "id" = $1',
      [scheduleId],
    );
    check("the cleared workflow has no due time left", clearedAt === null, String(clearedAt));
  }

  // Deleting a schedule trigger from the graph clears the due time through the API.
  const rescheduled = await api("PATCH", `/api/workflows/${scheduleId}`, { graph: scheduleGraph }, token);
  check("a schedule can be set again", typeof rescheduled.json?.data?.scheduleNextAt === "string");
  const unscheduled = await api(
    "PATCH",
    `/api/workflows/${scheduleId}`,
    { graph: { version: 1, nodes: [{ id: "t", type: "core.manual_trigger", position: { x: 0, y: 0 }, config: {} }], edges: [] } },
    token,
  );
  check(
    "removing the schedule trigger clears the due time",
    unscheduled.json?.data?.scheduleNextAt === null,
    JSON.stringify(unscheduled.json?.data?.scheduleNextAt),
  );

  // Clean up Phase 8's own workflows.
  for (const id of [hookId, scheduleId]) {
    if (id) await api("DELETE", `/api/workflows/${id}`, undefined, token);
  }


  // --- Phase 9: integration nodes -------------------------------------------
  // Four integrations, each a registry entry and therefore each also an agent tool.
  // The Google-backed ones need a browser to consent, so what is provable over HTTP
  // is: the registry projection, the credential API's write-only contract, the
  // consent URL's parameters, the CSRF guard on the callback, and — the part that
  // matters most — the outbound guard on `integration.http`, driven through the real
  // engine on the deployed container.

  check(
    "registry serves all four integration node types",
    ["integration.http", "integration.discord", "integration.sheets", "integration.gmail"].every(
      (type) => registryTypes.has(type),
    ),
    JSON.stringify(types),
  );

  const integrationNodes = (nodes.json?.data ?? []).filter(
    (node) => node.category === "integration",
  );
  check(
    "every integration declares an output shape for the generator to read",
    integrationNodes.length === 4 &&
      integrationNodes.every(
        (node) => typeof node.outputShape === "string" && node.outputShape.length > 20,
      ),
    JSON.stringify(integrationNodes.map((node) => [node.type, node.outputShape])).slice(0, 300),
  );

  const callableTypes = new Set(
    (nodes.json?.data ?? []).filter((node) => node.agentCallable).map((node) => node.type),
  );
  check(
    "HTTP, Discord and Sheets are reachable by the agent",
    ["integration.http", "integration.discord", "integration.sheets"].every((type) =>
      callableTypes.has(type),
    ),
    JSON.stringify([...callableTypes]),
  );
  check(
    "Gmail is deliberately NOT reachable by the agent",
    !callableTypes.has("integration.gmail"),
    "a model choosing both recipient and body is the one effect here that leaves the user's account",
  );

  // --- the credential API is write-only -------------------------------------
  for (const [method, path] of [
    ["GET", "/api/integrations/discord"],
    ["PUT", "/api/integrations/discord"],
    ["DELETE", "/api/integrations/discord"],
    ["GET", "/api/integrations/google"],
    ["DELETE", "/api/integrations/google"],
  ]) {
    const anon = await api(method, path, method === "PUT" ? { webhookUrl: "x" } : undefined);
    check(`${method} ${path} requires a session`, anon.status === 401, `got ${anon.status}`);
  }

  const discordBefore = await api("GET", "/api/integrations/discord", undefined, token);
  check(
    "Discord status returns no part of the stored URL",
    discordBefore.status === 200 &&
      typeof discordBefore.json?.data?.configured === "boolean" &&
      !JSON.stringify(discordBefore.json).includes("discord.com/api/webhooks"),
    JSON.stringify(discordBefore.json).slice(0, 200),
  );

  const googleBefore = await api("GET", "/api/integrations/google", undefined, token);
  check(
    "Google status returns scopes and no token",
    googleBefore.status === 200 &&
      Array.isArray(googleBefore.json?.data?.scopes) &&
      typeof googleBefore.json?.data?.canAppendSheets === "boolean" &&
      !JSON.stringify(googleBefore.json).toLowerCase().includes("refresh"),
    JSON.stringify(googleBefore.json).slice(0, 200),
  );

  // A credential is proved against the service before it is stored, so the things a
  // user pastes by mistake fail in the form rather than halfway through a run.
  for (const [label, url] of [
    ["a Discord channel link", "https://discord.com/channels/123/456"],
    ["an invite link", "https://discord.gg/abc"],
    ["a non-Discord host", "https://evil.test/api/webhooks/1/tok"],
    ["plain http", "http://discord.com/api/webhooks/1/tok"],
    ["not a URL at all", "webhook please"],
  ]) {
    const rejected = await api("PUT", "/api/integrations/discord", { webhookUrl: url }, token);
    check(
      `a webhook URL that is ${label} is rejected`,
      rejected.status === 400 && /webhook|valid url/i.test(rejected.json?.error?.message ?? ""),
      `${rejected.status} ${JSON.stringify(rejected.json?.error?.message)}`,
    );
  }

  const unknownWebhook = await api(
    "PUT",
    "/api/integrations/discord",
    { webhookUrl: "https://discord.com/api/webhooks/1234567890/thisTokenDoesNotExist-abcdef" },
    token,
  );
  check(
    "a well-formed but non-existent webhook is refused by Discord, not stored",
    unknownWebhook.status === 400 && /discord/i.test(unknownWebhook.json?.error?.message ?? ""),
    `${unknownWebhook.status} ${JSON.stringify(unknownWebhook.json?.error?.message)}`,
  );
  const stillUnset = await api("GET", "/api/integrations/discord", undefined, token);
  check(
    "a rejected webhook stored nothing",
    stillUnset.json?.data?.configured === discordBefore.json?.data?.configured,
    `was ${discordBefore.json?.data?.configured}, now ${stillUnset.json?.data?.configured}`,
  );

  // --- the Google consent URL, without a browser ----------------------------
  const connect = await fetch(`${base}/api/integrations/google/connect`, {
    redirect: "manual",
    headers: { cookie: `${cookieName}=${token}` },
  });
  const consent = connect.headers.get("location");
  check(
    "connect redirects to Google",
    connect.status === 302 && typeof consent === "string",
    `${connect.status} ${consent}`,
  );

  if (consent) {
    const consentUrl = new URL(consent);
    const params = consentUrl.searchParams;
    check(
      "the consent URL asks Google for offline access with a forced prompt",
      consentUrl.origin + consentUrl.pathname === "https://accounts.google.com/o/oauth2/v2/auth" &&
        params.get("access_type") === "offline" &&
        params.get("prompt") === "consent" &&
        params.get("include_granted_scopes") === "true",
      consent.slice(0, 200),
    );
    check(
      "it asks for exactly the Sheets and Gmail-send scopes",
      params.get("scope") ===
        "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/gmail.send",
      String(params.get("scope")),
    );
    check(
      "the redirect_uri is this deployment's own callback",
      params.get("redirect_uri") === `${base}/api/integrations/google/callback`,
      String(params.get("redirect_uri")),
    );
    check(
      "a CSRF state is minted and set as an http-only cookie",
      (params.get("state") ?? "").length >= 20 &&
        (connect.headers.get("set-cookie") ?? "").includes("agentforge-google-oauth=") &&
        /httponly/i.test(connect.headers.get("set-cookie") ?? ""),
      connect.headers.get("set-cookie") ?? "none",
    );
    const secret = process.env.GOOGLE_CLIENT_SECRET;
    if (secret) {
      check("the client secret is not in a URL the browser follows", !consent.includes(secret));
    } else {
      skip("the client secret is not in the consent URL", "GOOGLE_CLIENT_SECRET is not in this environment");
    }
  }

  const anonConnect = await fetch(`${base}/api/integrations/google/connect`, { redirect: "manual" });
  check(
    "connect signed out redirects home rather than answering JSON",
    anonConnect.status === 302 && (anonConnect.headers.get("location") ?? "").endsWith("/"),
    `${anonConnect.status} ${anonConnect.headers.get("location")}`,
  );

  // The callback is a GET a third party can cause a signed-in browser to make. Without
  // the state check, an attacker's code would store *their* refresh token on this
  // user's account, and every later Sheets row would go to the attacker's document.
  const forged = await fetch(`${base}/api/integrations/google/callback?code=stolen&state=whatever`, {
    redirect: "manual",
    headers: { cookie: `${cookieName}=${token}` },
  });
  check(
    "a callback with no state cookie is refused",
    forged.status === 302 && (forged.headers.get("location") ?? "").includes("google=state"),
    `${forged.status} ${forged.headers.get("location")}`,
  );

  const mismatched = await fetch(
    `${base}/api/integrations/google/callback?code=stolen&state=wrong-value-here`,
    {
      redirect: "manual",
      headers: { cookie: `${cookieName}=${token}; agentforge-google-oauth=a-different-value` },
    },
  );
  check(
    "a callback whose state does not match the cookie is refused",
    mismatched.status === 302 && (mismatched.headers.get("location") ?? "").includes("google=state"),
    `${mismatched.status} ${mismatched.headers.get("location")}`,
  );

  const anonCallback = await fetch(`${base}/api/integrations/google/callback?code=x&state=y`, {
    redirect: "manual",
  });
  check(
    "a callback with no session redirects home",
    anonCallback.status === 302 && (anonCallback.headers.get("location") ?? "").endsWith("/"),
    `${anonCallback.status} ${anonCallback.headers.get("location")}`,
  );

  const googleAfterForgery = await api("GET", "/api/integrations/google", undefined, token);
  check(
    "no forged callback connected anything",
    googleAfterForgery.json?.data?.connected === googleBefore.json?.data?.connected,
    `was ${googleBefore.json?.data?.connected}, now ${googleAfterForgery.json?.data?.connected}`,
  );

  // --- the outbound guard, through the real engine ---------------------------
  // This is the phase's most important check. `integration.http` is agent-callable, so
  // its URL can be chosen by a model reading webhook text. These are the requests that
  // must never leave the container.
  const httpGraph = (url, extra = {}) => ({
    version: 1,
    nodes: [
      { id: "start", type: "core.manual_trigger", position: { x: 0, y: 0 }, config: {} },
      {
        id: "call",
        type: "integration.http",
        position: { x: 240, y: 0 },
        config: { method: "GET", url, timeoutMs: 20000, ...extra },
      },
    ],
    edges: [{ id: "e1", source: "start", target: "call", sourceHandle: null }],
  });

  const httpWorkflow = await api(
    "POST",
    "/api/workflows",
    { name: "Phase 9 HTTP verification", graph: httpGraph("https://api.github.com/zen") },
    token,
  );
  const httpId = httpWorkflow.json?.data?.id;
  check(
    "the HTTP workflow saved and is runnable",
    httpWorkflow.status === 201 && httpWorkflow.json?.data?.runnable === true,
    JSON.stringify(httpWorkflow.json?.data?.problems),
  );

  const callStepOf = (run) => (run.json?.data?.steps ?? []).find((step) => step.nodeId === "call");
  const retarget = (url, extra) =>
    api("PATCH", `/api/workflows/${httpId}`, { graph: httpGraph(url, extra) }, token);

  if (httpId) {
    for (const [label, url, expected] of [
      [
        "the GCP metadata server over http",
        "http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token",
        /only https/i,
      ],
      ["the metadata server by name", "https://metadata.google.internal/computeMetadata/v1/", /not a public host/i],
      ["localhost", "https://localhost:8080/", /not a public host/i],
      ["a loopback literal", "https://127.0.0.1/", /not a public address/i],
      ["an RFC 1918 literal", "https://10.0.0.1/", /not a public address/i],
      ["a link-local literal", "https://169.254.169.254/", /not a public address/i],
      ["an IPv6 loopback literal", "https://[::1]/", /not a public address/i],
      ["a private-zone name", "https://db.internal/", /not a public host/i],
      ["a URL with credentials in it", "https://user:pass@example.com/", /credentials in the url/i],
    ]) {
      await retarget(url);
      const blockedRun = await api("POST", `/api/workflows/${httpId}/runs`, {}, token);
      const step = callStepOf(blockedRun);
      check(
        `the HTTP node refuses ${label}`,
        blockedRun.json?.data?.status === "failed" &&
          step?.status === "failed" &&
          expected.test(step?.error ?? ""),
        `${blockedRun.json?.data?.status} / ${JSON.stringify(step?.error)}`,
      );
    }

    // And the positive case: a real public HTTPS API, which also proves the
    // User-Agent is sent — api.github.com answers 403 without one.
    await retarget("https://api.github.com/zen");
    const zen = await api("POST", `/api/workflows/${httpId}/runs`, {}, token);
    const zenStep = callStepOf(zen);
    check(
      "the HTTP node calls a real public HTTPS API and sends a User-Agent",
      zen.json?.data?.status === "succeeded" &&
        zenStep?.output?.status === 200 &&
        zenStep?.output?.ok === true &&
        typeof zenStep?.output?.text === "string" &&
        zenStep.output.text.length > 0,
      `${zen.json?.data?.status} / ${JSON.stringify(zenStep?.output).slice(0, 200)}`,
    );

    await retarget("https://api.github.com/rate_limit");
    const jsonRun = await api("POST", `/api/workflows/${httpId}/runs`, {}, token);
    const jsonStep = callStepOf(jsonRun);
    check(
      "a JSON response is parsed into output.json for a template reference to reach",
      jsonStep?.output?.json?.resources?.core?.limit !== undefined,
      JSON.stringify(jsonStep?.output?.json).slice(0, 160),
    );

    // failOnError is the honest default: an author who wrote an explicit API call
    // wants a 404 to stop the run, not to succeed carrying an error page as data.
    const missing = "https://api.github.com/this-endpoint-does-not-exist-agentforge";
    await retarget(missing);
    const notFound = await api("POST", `/api/workflows/${httpId}/runs`, {}, token);
    const notFoundStep = callStepOf(notFound);
    check(
      "a 404 fails the step by default, with the API's own message",
      notFound.json?.data?.status === "failed" && /404/.test(notFoundStep?.error ?? ""),
      `${notFound.json?.data?.status} / ${JSON.stringify(notFoundStep?.error)}`,
    );

    await retarget(missing, { failOnError: false });
    const tolerated = await api("POST", `/api/workflows/${httpId}/runs`, {}, token);
    const toleratedStep = callStepOf(tolerated);
    check(
      "failOnError false reports the status instead of failing, so a branch can route on it",
      tolerated.json?.data?.status === "succeeded" &&
        toleratedStep?.output?.status === 404 &&
        toleratedStep?.output?.ok === false,
      `${tolerated.json?.data?.status} / ${JSON.stringify(toleratedStep?.output?.status)}`,
    );
  }

  // --- a node with no credential fails legibly ------------------------------
  const sheetGraph = (spreadsheetId) => ({
    version: 1,
    nodes: [
      { id: "start", type: "core.manual_trigger", position: { x: 0, y: 0 }, config: {} },
      {
        id: "sheet",
        type: "integration.sheets",
        position: { x: 240, y: 0 },
        config: { spreadsheetId, sheet: "Sheet1", values: ["x"] },
      },
    ],
    edges: [{ id: "e1", source: "start", target: "sheet", sourceHandle: null }],
  });

  const missingCreds = await api(
    "POST",
    "/api/workflows",
    { name: "Phase 9 credential verification", graph: sheetGraph("") },
    token,
  );
  const credsId = missingCreds.json?.data?.id;
  check(
    "a Sheets node with no spreadsheet chosen still saves and is runnable",
    missingCreds.status === 201 && missingCreds.json?.data?.runnable === true,
    JSON.stringify(missingCreds.json?.data?.problems),
  );

  if (credsId) {
    const sheetStepOf = (run) =>
      (run.json?.data?.steps ?? []).find((step) => step.nodeId === "sheet");

    const blank = await api("POST", `/api/workflows/${credsId}/runs`, {}, token);
    check(
      "running it says the spreadsheet is missing, in words a user can act on",
      blank.json?.data?.status === "failed" &&
        /no spreadsheet yet/i.test(sheetStepOf(blank)?.error ?? ""),
      JSON.stringify(sheetStepOf(blank)?.error),
    );

    const googleNow = await api("GET", "/api/integrations/google", undefined, token);
    if (googleNow.json?.data?.connected !== true) {
      await api(
        "PATCH",
        `/api/workflows/${credsId}`,
        { graph: sheetGraph("1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms") },
        token,
      );
      const unconnected = await api("POST", `/api/workflows/${credsId}/runs`, {}, token);
      check(
        "a Sheets node with Google not connected says so, rather than throwing",
        unconnected.json?.data?.status === "failed" &&
          /not connected/i.test(sheetStepOf(unconnected)?.error ?? ""),
        JSON.stringify(sheetStepOf(unconnected)?.error),
      );
    } else {
      skip(
        "a Sheets node with Google not connected says so",
        "Google is connected on this account, which is the state the demo needs",
      );
    }
  }

  // --- Discord, for real, when a webhook is supplied ------------------------
  // Piped in the same way as the Gemini key so it is never printed:
  //   VERIFY_DISCORD_WEBHOOK="$DISCORD_WEBHOOK_URL" node ... scripts/verify-api.mjs
  const discordWebhook = process.env.VERIFY_DISCORD_WEBHOOK ?? null;
  let discordId = null;

  if (!discordWebhook) {
    skip(
      "posting to Discord end to end",
      "VERIFY_DISCORD_WEBHOOK is not set; the node's no-credential path was still checked",
    );
  } else {
    const storedHook = await api(
      "PUT",
      "/api/integrations/discord",
      { webhookUrl: discordWebhook },
      token,
    );
    check(
      "a real webhook is verified against Discord and stored",
      storedHook.status === 200 && storedHook.json?.data?.configured === true,
      JSON.stringify(storedHook.json).slice(0, 250),
    );
    check(
      "storing it returns the channel it is attached to and no part of the URL",
      typeof storedHook.json?.data?.channelId === "string" &&
        !JSON.stringify(storedHook.json).includes("/webhooks/"),
      JSON.stringify(storedHook.json?.data),
    );

    const marker = `AgentForge Phase 9 verification ${new Date().toISOString()}`;
    const discordWorkflow = await api(
      "POST",
      "/api/workflows",
      {
        name: "Phase 9 Discord verification",
        graph: {
          version: 1,
          nodes: [
            { id: "start", type: "core.manual_trigger", position: { x: 0, y: 0 }, config: {} },
            {
              id: "post",
              type: "integration.discord",
              position: { x: 240, y: 0 },
              config: { content: `${marker} - {{trigger.note}}` },
            },
          ],
          edges: [{ id: "e1", source: "start", target: "post", sourceHandle: null }],
        },
      },
      token,
    );
    discordId = discordWorkflow.json?.data?.id;

    const posted = await api(
      "POST",
      `/api/workflows/${discordId}/runs`,
      { input: { note: "posted by the verify script" } },
      token,
    );
    const postStep = (posted.json?.data?.steps ?? []).find((step) => step.nodeId === "post");
    check(
      "a workflow posts a real message to Discord",
      posted.json?.data?.status === "succeeded" &&
        postStep?.status === "succeeded" &&
        typeof postStep?.output?.messageId === "string",
      `${posted.json?.data?.status} / ${JSON.stringify(postStep?.error ?? postStep?.output).slice(0, 250)}`,
    );
    check(
      "the message carried a resolved template reference from the trigger",
      (postStep?.output?.content ?? "").includes("posted by the verify script"),
      JSON.stringify(postStep?.output?.content),
    );

    const removed = await api("DELETE", "/api/integrations/discord", undefined, token);
    check("the webhook can be deleted", removed.json?.data?.configured === false);
    const afterRemoval = await api("POST", `/api/workflows/${discordId}/runs`, {}, token);
    const afterStep = (afterRemoval.json?.data?.steps ?? []).find((step) => step.nodeId === "post");
    check(
      "with no webhook stored the node says to add one, rather than failing obscurely",
      afterRemoval.json?.data?.status === "failed" &&
        /no discord webhook is connected/i.test(afterStep?.error ?? ""),
      JSON.stringify(afterStep?.error),
    );
  }

  // Clean up Phase 9's own workflows.
  for (const id of [httpId, credsId, discordId]) {
    if (id) await api("DELETE", `/api/workflows/${id}`, undefined, token);
  }

  // --- delete ---------------------------------------------------------------
  const deleted = await api("DELETE", `/api/workflows/${workflowId}`, undefined, token);
  check("workflow deletes", deleted.status === 200);
  const gone = await api("GET", `/api/workflows/${workflowId}`, undefined, token);
  check("deleted workflow is gone", gone.status === 404);
  const [{ n }] = await sql.query('select count(*)::int as n from "run" where "workflowId" = $1', [workflowId]);
  check("deleting a workflow cascades to its runs", n === 0, `${n} runs remain`);
  workflowId = null;
} catch (error) {
  failures += 1;
  console.error("\nVerification threw:", error);
} finally {
  await sql.query('delete from "session" where "sessionToken" = $1', [token]).catch(() => {});
}

console.log(
  `\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}` +
    `${skipped > 0 ? ` (${skipped} skipped)` : ""}\n`,
);
process.exit(failures === 0 ? 0 : 1);
