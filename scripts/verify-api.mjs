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

/** For the rendered pages, where the assertion is about status and markup. */
async function page(path, cookie) {
  const response = await fetch(`${base}${path}`, {
    redirect: "manual",
    headers: cookie ? { cookie: `${cookieName}=${cookie}` } : {},
  });
  return { status: response.status, html: await response.text() };
}

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
  check(
    "registry serves the seeded node types",
    nodes.status === 200 &&
      ["core.manual_trigger", "core.set", "core.log", "core.branch", "core.loop", "core.assert"].every(
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

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
