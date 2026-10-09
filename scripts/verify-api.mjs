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
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { neon } from "@neondatabase/serverless";
import { verificationUser } from "./verify-user.mjs";

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

/**
 * Phase 39: the workflows its composition section leaves standing for the agent checks further
 * down, which need a stored model key; that section removes them. Null once they are gone.
 */
let phase39 = null;

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

/**
 * `workspaceId` sends an `af_workspace` cookie alongside the session — Phase 19B.
 *
 * **Set directly rather than by calling the switch endpoint first, on purpose.** This
 * script has no cookie jar, so a `Set-Cookie` from `/api/workspaces/active` would be
 * dropped and every later request would silently fall back to the personal workspace.
 * Setting it by hand is also the stronger test: the cookie is unsigned, so the only thing
 * keeping it honest is that the server re-validates it against membership on every
 * request — which is exactly what these calls exercise.
 */
async function api(method, path, body, cookie, workspaceId) {
  const cookies = [
    ...(cookie ? [`${cookieName}=${cookie}`] : []),
    ...(workspaceId ? [`af_workspace=${workspaceId}`] : []),
  ];
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
  return { status: response.status, json, setCookie: response.headers.getSetCookie?.() ?? [] };
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

/**
 * Remove every trace of the isolation probe — including one left behind by a run that
 * was killed before its `finally`.
 *
 * The workspace is deleted explicitly rather than relied upon to cascade: `workspace`
 * references the user with `on delete set null`, deliberately, so that deleting the
 * person who made a workspace does not delete the workspace out from under everybody
 * else in it. The consequence here is that deleting the probe user would otherwise
 * leave an ownerless workspace behind for ever.
 */
async function cleanUpProbe(userId) {
  await sql.query('delete from "workspace" where "createdBy" = $1', [userId]).catch(() => {});
  await sql.query('delete from "session" where "userId" = $1', [userId]).catch(() => {});
  await sql.query('delete from "user" where "id" = $1', [userId]).catch(() => {});
}

const token = crypto.randomUUID() + crypto.randomUUID();
let workflowId = null;

try {
  console.log(`\nVerifying ${base}\n`);

  const user = await verificationUser(sql);
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

  // --- Phase 30: switched-off nodes and sticky notes ------------------------
  // `CONTRACT.md` → *Disabled nodes*, clause by clause, on the deployed engine: a node with a
  // default output passes its input straight through, a branch stops its path, the trigger
  // cannot be switched off, and a note round-trips, versions, and never reaches a share link.
  {
    const NOTE_SECRET = "PHASE30-NOTE-SECRET for the night rota";
    const annotatedGraph = {
      version: 1,
      nodes: [
        { id: "trigger", type: "core.manual_trigger", position: { x: 0, y: 0 }, config: {} },
        {
          id: "shape",
          type: "core.set",
          position: { x: 240, y: 0 },
          config: { fields: { greeting: "never computed" } },
          disabled: true,
        },
        {
          id: "say",
          type: "core.log",
          position: { x: 480, y: 0 },
          config: { message: "name={{input.name}} greeting={{input.greeting}}" },
        },
        {
          id: "check",
          type: "core.branch",
          position: { x: 240, y: 200 },
          config: { left: "a", operator: "equals", right: "a" },
          disabled: true,
        },
        { id: "never", type: "core.log", position: { x: 480, y: 200 }, config: { message: "unreachable" } },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "shape", sourceHandle: null },
        { id: "e2", source: "shape", target: "say", sourceHandle: null },
        { id: "e3", source: "trigger", target: "check", sourceHandle: null },
        { id: "e4", source: "check", target: "never", sourceHandle: "true" },
      ],
      notes: [
        { id: "note_1", position: { x: 0, y: -200 }, size: { width: 240, height: 140 }, text: NOTE_SECRET, tone: "pink" },
      ],
    };
    const annotated = await api(
      "POST",
      "/api/workflows",
      { name: "zzzz-phase30 notes and switched-off nodes", graph: annotatedGraph },
      token,
    );
    const annotatedId = annotated.json?.data?.id;
    check(
      "a graph with a switched-off node and a note saves, runnable",
      annotated.status === 201 && annotated.json?.data?.runnable === true,
      JSON.stringify(annotated.json).slice(0, 300),
    );
    const reread = await api("GET", `/api/workflows/${annotatedId}`, undefined, token);
    check(
      "and comes back exactly as it was sent — notes and the off switch included",
      isDeepStrictEqual(reread.json?.data?.graph, annotatedGraph),
      JSON.stringify(reread.json?.data?.graph).slice(0, 300),
    );

    const offRun = await api("POST", `/api/workflows/${annotatedId}/runs`, { input: { name: "Ada" } }, token);
    const offSteps = offRun.json?.data?.steps ?? [];
    const offStep = (id) => offSteps.find((candidate) => candidate.nodeId === id);
    check(
      "a run through a switched-off node succeeds",
      offRun.json?.data?.status === "succeeded",
      JSON.stringify(offRun.json).slice(0, 300),
    );
    check(
      "the switched-off node is recorded `disabled`, never ran, and passed its input on unchanged",
      offStep("shape")?.status === "disabled" &&
        offStep("shape")?.startedAt === null &&
        isDeepStrictEqual(offStep("shape")?.output, offStep("trigger")?.output),
      JSON.stringify(offStep("shape")),
    );
    check(
      "the node after it read the trigger's output — not fields the switched-off node never computed",
      offStep("say")?.status === "succeeded" && offStep("say")?.logs?.[0]?.message === "name=Ada greeting=",
      JSON.stringify(offStep("say")?.logs),
    );
    check(
      "a switched-off branch stops its path: what follows it is skipped",
      offStep("check")?.status === "disabled" && offStep("never")?.status === "skipped",
      JSON.stringify([offStep("check"), offStep("never")]),
    );

    const offTrigger = await api(
      "PATCH",
      `/api/workflows/${annotatedId}`,
      {
        graph: {
          ...annotatedGraph,
          nodes: annotatedGraph.nodes.map((n) => (n.id === "trigger" ? { ...n, disabled: true } : n)),
        },
      },
      token,
    );
    check(
      "a switched-off trigger saves but is reported, naming the Active switch",
      offTrigger.status === 200 &&
        offTrigger.json?.data?.runnable === false &&
        offTrigger.json.data.problems.some((p) => p.code === "disabled_trigger" && /Active switch/.test(p.message)),
      JSON.stringify(offTrigger.json?.data?.problems),
    );
    const offTriggerRun = await api("POST", `/api/workflows/${annotatedId}/runs`, { input: {} }, token);
    check("and it does not run", offTriggerRun.status === 422, `got ${offTriggerRun.status}`);

    const falseFlag = await api(
      "PATCH",
      `/api/workflows/${annotatedId}`,
      { graph: { ...annotatedGraph, nodes: annotatedGraph.nodes.map((n) => ({ ...n, disabled: false })) } },
      token,
    );
    check("`disabled: false` is refused — a node that is on carries no key", falseFlag.status === 400, `got ${falseFlag.status}`);
    const clash = await api(
      "PATCH",
      `/api/workflows/${annotatedId}`,
      { graph: { ...annotatedGraph, notes: [{ ...annotatedGraph.notes[0], id: "say" }] } },
      token,
    );
    check("a note named like a node is refused — one id space on the canvas", clash.status === 400, `got ${clash.status}`);

    await api("PATCH", `/api/workflows/${annotatedId}`, { graph: annotatedGraph }, token);
    const noteEdit = await api(
      "PATCH",
      `/api/workflows/${annotatedId}`,
      { graph: { ...annotatedGraph, notes: [{ ...annotatedGraph.notes[0], text: `${NOTE_SECRET}, edited` }] } },
      token,
    );
    const noteHistory = await api("GET", `/api/workflows/${annotatedId}/versions`, undefined, token);
    const newest = noteHistory.json?.data?.[0];
    check(
      "editing only a note is a version, and its summary counts the note",
      noteEdit.status === 200 && newest?.changes?.notes === 1 && newest?.changes?.any === true,
      JSON.stringify(newest).slice(0, 300),
    );

    const noteShare = await api("POST", `/api/workflows/${annotatedId}/share`, undefined, token);
    const noteShareToken = (noteShare.json?.data?.shareUrl ?? "").split("/s/")[1] ?? "";
    const notePublic = await api("GET", `/api/share/${noteShareToken}`);
    const notePublicBody = JSON.stringify(notePublic.json);
    check(
      "a share link withholds a note's text — the words, not just the key",
      notePublic.status === 200 && !notePublicBody.includes("PHASE30-NOTE-SECRET") && !notePublicBody.includes("night rota"),
      notePublicBody.slice(0, 300),
    );
    check(
      "and keeps the note's place and tone, counting its text as hidden",
      isDeepStrictEqual(notePublic.json?.data?.graph?.notes?.[0]?.redacted, ["text"]) &&
        notePublic.json?.data?.graph?.notes?.[0]?.tone === "pink",
      JSON.stringify(notePublic.json?.data?.graph?.notes),
    );
    check(
      "and publishes the off switch, which is shape",
      notePublic.json?.data?.graph?.nodes?.find((n) => n.id === "shape")?.disabled === true,
      JSON.stringify(notePublic.json?.data?.graph?.nodes?.[1]),
    );
    const notePage = await page(`/s/${noteShareToken}`);
    check(
      "the share page never prints the note's text either, and says it is hidden",
      notePage.status === 200 && !notePage.html.includes("PHASE30-NOTE-SECRET") && /sticky note/i.test(notePage.html),
      `status ${notePage.status}`,
    );
    await api("DELETE", `/api/workflows/${annotatedId}/share`, undefined, token);
    await api("DELETE", `/api/workflows/${annotatedId}`, undefined, token);
  }

  // --- Phase 31: pinned output, partial runs, test runs, the manual form -----
  // `CONTRACT.md` → *Pinned output* and *Partial runs*, on the deployed engine. The pinned
  // node is an HTTP call to a host that cannot resolve, so any run that executes it for real
  // fails — which is what makes "the pin was used" and "the pin was ignored" observable.
  {
    const PIN_SECRET = "PHASE31-PIN-SECRET from the finance inbox";
    const pinnedOutput = { status: 200, body: { issues: [{ title: "first" }, { title: "second" }] }, note: PIN_SECRET };
    const pinGraph = (triggerType) => ({
      version: 1,
      nodes: [
        { id: "trigger", type: triggerType, position: { x: 0, y: 0 }, config: {} },
        {
          id: "fetch",
          type: "integration.http",
          position: { x: 240, y: 0 },
          config: { url: "https://agentforge-phase31.invalid/issues", method: "GET" },
          pinned: { output: pinnedOutput },
        },
        {
          id: "shape",
          type: "core.set",
          position: { x: 480, y: 0 },
          config: { fields: { first: "{{input.body.issues}}", count: "{{steps.fetch.output.status}}" } },
        },
        { id: "after", type: "core.log", position: { x: 720, y: 0 }, config: { message: "after {{input.count}}" } },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "fetch", sourceHandle: null },
        { id: "e2", source: "fetch", target: "shape", sourceHandle: null },
        { id: "e3", source: "shape", target: "after", sourceHandle: null },
      ],
    });

    const created = await api("POST", "/api/workflows", { name: "zzzz-phase31 pinned output", graph: pinGraph("core.manual_trigger") }, token);
    const pinId = created.json?.data?.id;
    const reread = await api("GET", `/api/workflows/${pinId}`, undefined, token);
    check(
      "a pinned output saves and reads back exactly",
      created.status === 201 && isDeepStrictEqual(reread.json?.data?.graph?.nodes?.[1]?.pinned, { output: pinnedOutput }),
      JSON.stringify(reread.json?.data?.graph?.nodes?.[1]).slice(0, 300),
    );

    const analyticsBefore = (await api("GET", "/api/analytics?range=7", undefined, token)).json?.data;

    const testRun = await api("POST", `/api/workflows/${pinId}/runs`, { input: {} }, token);
    const testSteps = testRun.json?.data?.steps ?? [];
    const testStep = (id) => testSteps.find((candidate) => candidate.nodeId === id);
    check(
      "a manual run of a graph holding a pin is a test run, labelled as one",
      testRun.status === 201 && testRun.json?.data?.status === "succeeded" &&
        isDeepStrictEqual(testRun.json?.data?.test, { scope: "workflow", nodeId: null }),
      JSON.stringify(testRun.json?.data).slice(0, 300),
    );
    check(
      "the pinned HTTP node was not called — its step is `pinned`, its output the pin",
      testStep("fetch")?.status === "pinned" && testStep("fetch")?.startedAt === null &&
        isDeepStrictEqual(testStep("fetch")?.output, pinnedOutput),
      JSON.stringify(testStep("fetch")).slice(0, 300),
    );
    check(
      "the node after it computed from the pin",
      isDeepStrictEqual(testStep("shape")?.output, { first: pinnedOutput.body.issues, count: 200 }),
      JSON.stringify(testStep("shape")?.output),
    );

    const alone = await api("POST", `/api/workflows/${pinId}/runs`, { target: { scope: "node", nodeId: "shape" } }, token);
    check(
      "test this node runs exactly that node, fed from the pin before it",
      alone.status === 201 && alone.json?.data?.steps?.length === 1 &&
        alone.json.data.steps[0].nodeId === "shape" &&
        isDeepStrictEqual(alone.json.data.steps[0].input, pinnedOutput) &&
        isDeepStrictEqual(alone.json.data.test, { scope: "node", nodeId: "shape" }),
      JSON.stringify(alone.json?.data).slice(0, 300),
    );
    check(
      "and its log says where its input came from",
      /pinned output of "fetch"|pinned output of "HTTP/i.test(alone.json?.data?.steps?.[0]?.logs?.[0]?.message ?? ""),
      JSON.stringify(alone.json?.data?.steps?.[0]?.logs),
    );

    const upTo = await api("POST", `/api/workflows/${pinId}/runs`, { input: {}, target: { scope: "path", nodeId: "shape" } }, token);
    check(
      "test up to here runs the way to the node and stops there — nothing after it has a step",
      upTo.status === 201 &&
        isDeepStrictEqual((upTo.json?.data?.steps ?? []).map((s) => [s.nodeId, s.status]), [
          ["trigger", "succeeded"],
          ["fetch", "pinned"],
          ["shape", "succeeded"],
        ]),
      JSON.stringify((upTo.json?.data?.steps ?? []).map((s) => [s.nodeId, s.status])),
    );

    const analyticsAfter = (await api("GET", "/api/analytics?range=7", undefined, token)).json?.data;
    check(
      "test runs are in no analytics figure, and are counted on their own",
      analyticsBefore && analyticsAfter &&
        analyticsAfter.totals.runs === analyticsBefore.totals.runs &&
        isDeepStrictEqual(analyticsAfter.nodes, analyticsBefore.nodes) &&
        analyticsAfter.testRuns === analyticsBefore.testRuns + 3,
      JSON.stringify({ before: analyticsBefore?.totals?.runs, after: analyticsAfter?.totals?.runs, tests: [analyticsBefore?.testRuns, analyticsAfter?.testRuns] }),
    );
    const [testRows] = await sql.query(
      `select count(*)::int as n from run where "workflowId" = $1 and test is not null`,
      [pinId],
    );
    check("and the database agrees: three test runs on the row", testRows?.n === 3, JSON.stringify(testRows));

    const durableTest = await api("POST", `/api/workflows/${pinId}/runs`, { mode: "durable", target: { scope: "node", nodeId: "shape" } }, token);
    check("a test of part of a workflow cannot be queued", durableTest.status === 400, `got ${durableTest.status}`);
    const badTarget = await api("POST", `/api/workflows/${pinId}/runs`, { target: { scope: "everything" } }, token);
    check(
      "a malformed test is refused, never run as the whole workflow",
      badTarget.status === 400 && (await sql.query(`select count(*)::int as n from run where "workflowId" = $1`, [pinId]))[0]?.n === 3,
      `got ${badTarget.status}`,
    );

    const tooBig = await api(
      "PATCH",
      `/api/workflows/${pinId}`,
      { graph: { ...pinGraph("core.manual_trigger"), nodes: pinGraph("core.manual_trigger").nodes.map((n) => (n.id === "fetch" ? { ...n, pinned: { output: "x".repeat(33 * 1024) } } : n)) } },
      token,
    );
    check("a pin over 32 KB is refused at save", tooBig.status === 400 && /32 KB/.test(JSON.stringify(tooBig.json)), `got ${tooBig.status}`);

    const share = await api("POST", `/api/workflows/${pinId}/share`, undefined, token);
    const shareToken = (share.json?.data?.shareUrl ?? "").split("/s/")[1] ?? "";
    const sharedJson = (await api("GET", `/api/share/${shareToken}`)).json;
    const shared = JSON.stringify(sharedJson);
    check(
      "a share link never publishes a pinned output — the words, not just the key",
      sharedJson?.data?.graph?.nodes?.length === 4 &&
        !shared.includes("PHASE31-PIN-SECRET") &&
        !shared.includes("finance inbox") &&
        sharedJson.data.graph.nodes.every((node) => !("pinned" in node)),
      shared.slice(0, 200),
    );
    await api("DELETE", `/api/workflows/${pinId}/share`, undefined, token);
    await api("DELETE", `/api/workflows/${pinId}`, undefined, token);

    // The safety property: a webhook run is never a test, so the pinned node runs for real.
    const hooked = await api("POST", "/api/workflows", { name: "zzzz-phase31 pinned webhook", graph: pinGraph("core.webhook_trigger") }, token);
    const hookToken = (hooked.json?.data?.webhookUrl ?? "").split("/api/webhook/")[1] ?? "";
    const hookResponse = await fetch(`${base}/api/webhook/${hookToken}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: "verify-api" }),
    });
    const hookRun = await hookResponse.json().catch(() => null);
    const hookFetch = (hookRun?.data?.steps ?? []).find((s) => s.nodeId === "fetch");
    check(
      "a webhook run ignores every pin: the pinned HTTP node was called for real, and the run is not a test",
      hookRun?.data?.test === null && hookFetch?.status === "failed" && hookFetch?.startedAt !== null,
      JSON.stringify({ test: hookRun?.data?.test, fetch: hookFetch }).slice(0, 300),
    );
    await api("DELETE", `/api/workflows/${hooked.json?.data?.id}`, undefined, token);

    // The manual trigger's declared fields, enforced by the trigger itself.
    const formGraph = {
      version: 1,
      nodes: [
        {
          id: "trigger",
          type: "core.manual_trigger",
          position: { x: 0, y: 0 },
          config: { fields: [{ name: "topic", type: "text", required: true }, { name: "count", type: "number", required: false }] },
        },
        { id: "say", type: "core.log", position: { x: 240, y: 0 }, config: { message: "topic {{trigger.topic}}" } },
      ],
      edges: [{ id: "e1", source: "trigger", target: "say", sourceHandle: null }],
    };
    const form = await api("POST", "/api/workflows", { name: "zzzz-phase31 manual form", graph: formGraph }, token);
    const formId = form.json?.data?.id;
    // Nothing has run in this workflow yet, so a node tested alone has nothing to be fed.
    const unfed = await api("POST", `/api/workflows/${formId}/runs`, { target: { scope: "node", nodeId: "say" } }, token);
    check(
      "test this node refuses a node with nothing on record before it — and says what to do",
      unfed.status === 400 && /Nothing to feed .*Test up to here instead/.test(unfed.json?.error?.message ?? ""),
      `got ${unfed.status}: ${unfed.json?.error?.message}`,
    );
    const missing = await api("POST", `/api/workflows/${formId}/runs`, { input: { count: 2 } }, token);
    check(
      "a manual run missing a required field fails at its trigger, naming the field, and runs nothing after it",
      missing.json?.data?.status === "failed" &&
        /needs the field "topic"/.test(missing.json?.data?.steps?.[0]?.error ?? "") &&
        missing.json?.data?.steps?.find((s) => s.nodeId === "say")?.status === "skipped",
      JSON.stringify(missing.json?.data?.steps).slice(0, 300),
    );
    const wrongType = await api("POST", `/api/workflows/${formId}/runs`, { input: { topic: "x", count: "two" } }, token);
    check("a field of the wrong type is refused too", /"count" should be a number/.test(wrongType.json?.data?.steps?.[0]?.error ?? ""), JSON.stringify(wrongType.json?.data?.steps?.[0]?.error));
    const given = await api("POST", `/api/workflows/${formId}/runs`, { input: { topic: "launch" } }, token);
    check(
      "and with it given, the run goes through",
      given.json?.data?.status === "succeeded" && given.json?.data?.steps?.[1]?.logs?.[0]?.message === "topic launch",
      JSON.stringify(given.json?.data?.steps?.[1]?.logs),
    );
    await api("DELETE", `/api/workflows/${formId}`, undefined, token);
  }

  // --- Phase 32: the library — tags, stars, duplicate, export and import -----
  // `CONTRACT.md` → *The library* and *The workflow export*, on the deployed service. Probe
  // rows are `zzzz-phase32` / `zzzz p32`; the second workspace an import lands in is created
  // here and deleted at the end, with everything in it.
  {
    const P32 = "zzzz-phase32";
    const PIN_WORDS = "PHASE32-PIN from somebody's inbox";
    const libGraph = {
      version: 1,
      nodes: [
        { id: "trigger", type: "core.manual_trigger", position: { x: 0, y: 0 }, config: {} },
        {
          id: "shape",
          type: "core.set",
          label: "Shape it",
          position: { x: 240, y: 0 },
          config: { fields: { greeting: "hello" } },
          pinned: { output: { greeting: PIN_WORDS } },
        },
        { id: "quiet", type: "core.log", position: { x: 480, y: 0 }, config: { message: "off" }, disabled: true },
        { id: "say", type: "core.log", position: { x: 720, y: 0 }, config: { message: "said {{input.greeting}}" } },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "shape", sourceHandle: null },
        { id: "e2", source: "shape", target: "quiet", sourceHandle: null },
        { id: "e3", source: "quiet", target: "say", sourceHandle: null },
      ],
      notes: [{ id: "note_1", position: { x: 0, y: -160 }, size: { width: 240, height: 120 }, text: "Phase 32 note", tone: "blue" }],
    };
    const hookGraph = {
      version: 1,
      nodes: [
        { id: "trigger", type: "core.webhook_trigger", position: { x: 0, y: 0 }, config: {} },
        { id: "say", type: "core.log", position: { x: 240, y: 0 }, config: { message: "hooked" } },
      ],
      edges: [{ id: "e1", source: "trigger", target: "say", sourceHandle: null }],
    };

    const made = [];
    let libArena = null;
    const wfRow = async (id) =>
      (await sql.query('select * from "workflow" where "id" = $1', [id]))[0];
    const listed = async (id, workspace) =>
      ((await api("GET", "/api/workflows", undefined, token, workspace)).json?.data ?? []).find((w) => w.id === id);

    try {
      const subject = await api("POST", "/api/workflows", { name: `${P32} library subject`, graph: libGraph }, token);
      const subjectId = subject.json?.data?.id;
      made.push(subjectId);
      const hook = await api("POST", "/api/workflows", { name: `${P32} webhook subject`, graph: hookGraph }, token);
      const hookId = hook.json?.data?.id;
      made.push(hookId);
      check("the library has two workflows to work on", subject.status === 201 && hook.status === 201);

      // --- tags ---
      const billing = await api("POST", "/api/tags", { name: "  zzzz p32   Billing " }, token);
      check(
        "a tag is created, its name trimmed and its inner space collapsed",
        billing.status === 201 && billing.json?.data?.name === "zzzz p32 Billing",
        JSON.stringify(billing.json).slice(0, 200),
      );
      const billingId = billing.json?.data?.id;
      const clash = await api("POST", "/api/tags", { name: "ZZZZ P32 billing" }, token);
      check(
        "a second tag of the same name, ignoring case, is a 409 naming it",
        clash.status === 409 && clash.json?.error?.code === "conflict" && /zzzz p32 Billing/.test(clash.json?.error?.message ?? ""),
        `got ${clash.status}: ${clash.json?.error?.message}`,
      );
      const blank = await api("POST", "/api/tags", { name: "    " }, token);
      check("a blank tag name is refused", blank.status === 400, `got ${blank.status}`);
      const ops = await api("POST", "/api/tags", { name: "zzzz p32 ops" }, token);
      const opsId = ops.json?.data?.id;
      const tagList = await api("GET", "/api/tags", undefined, token);
      check(
        "the workspace's tags list both",
        tagList.status === 200 && [billingId, opsId].every((id) => tagList.json?.data?.some((tag) => tag.id === id)),
      );
      const renamed = await api("PATCH", `/api/tags/${opsId}`, { name: "zzzz p32 oncall" }, token);
      check("a tag is renamed", renamed.status === 200 && renamed.json?.data?.name === "zzzz p32 oncall");
      const renameClash = await api("PATCH", `/api/tags/${opsId}`, { name: "zzzz P32 BILLING" }, token);
      check("renaming onto another tag's name is a 409", renameClash.status === 409, `got ${renameClash.status}`);

      // --- tagging a workflow is not an edit ---
      const before = await wfRow(subjectId);
      const tagged = await api("PUT", `/api/workflows/${subjectId}/tags`, { tagIds: [opsId, billingId] }, token);
      check(
        "a workflow is given two tags, answered by name",
        tagged.status === 200 && isDeepStrictEqual(tagged.json?.data?.map((tag) => tag.name), ["zzzz p32 Billing", "zzzz p32 oncall"]),
        JSON.stringify(tagged.json).slice(0, 200),
      );
      const after = await wfRow(subjectId);
      check(
        "tagging writes no version and does not move updatedAt",
        after.version === before.version && after.updatedAt.getTime() === before.updatedAt.getTime(),
        `version ${before.version}→${after.version}, updatedAt ${before.updatedAt.toISOString()}→${after.updatedAt.toISOString()}`,
      );
      const listedSubject = await listed(subjectId);
      check(
        "the list carries each workflow's tags and the asker's star, on the same read",
        listedSubject?.tags?.length === 2 && listedSubject?.starred === false && (await listed(hookId))?.tags?.length === 0,
        JSON.stringify({ tags: listedSubject?.tags, starred: listedSubject?.starred }),
      );
      const single = await api("GET", `/api/workflows/${subjectId}`, undefined, token);
      check("a single read does not carry them — only the list does", !("tags" in (single.json?.data ?? {})) && !("starred" in (single.json?.data ?? {})));

      // A tag from another workspace can never land here.
      const arenaMade = await api("POST", "/api/workspaces", { name: "zzzz library arena" }, token);
      libArena = arenaMade.json?.data?.id ?? null;
      check("a second workspace exists to import into", libArena !== null, JSON.stringify(arenaMade.json).slice(0, 200));
      const foreign = await api("POST", "/api/tags", { name: "zzzz p32 foreign" }, token, libArena);
      const foreignTag = await api("PUT", `/api/workflows/${subjectId}/tags`, { tagIds: [billingId, foreign.json?.data?.id] }, token);
      const [{ n: subjectTags }] = await sql.query('select count(*)::int as n from "workflow_tag" where "workflowId" = $1', [subjectId]);
      check(
        "a tag id from another workspace is a 404, and the workflow's tags are untouched",
        foreign.status === 201 && foreignTag.status === 404 && subjectTags === 2,
        `tag ${foreign.status}, put ${foreignTag.status}, ${subjectTags} rows`,
      );
      const tooMany = await api("PUT", `/api/workflows/${subjectId}/tags`, { tagIds: Array.from({ length: 11 }, (_, i) => `t${i}`) }, token);
      check("more than ten tags on a workflow is refused", tooMany.status === 400, `got ${tooMany.status}`);

      // --- stars ---
      const star = await api("PUT", `/api/workflows/${subjectId}/star`, undefined, token);
      const starAgain = await api("PUT", `/api/workflows/${subjectId}/star`, undefined, token);
      const [{ n: starRows }] = await sql.query('select count(*)::int as n from "workflow_star" where "workflowId" = $1', [subjectId]);
      check(
        "starring is idempotent — twice is one star — and the list says so",
        star.status === 200 && starAgain.status === 200 && starRows === 1 && (await listed(subjectId))?.starred === true,
        `${star.status} ${starAgain.status}, ${starRows} rows`,
      );
      const unstar = await api("DELETE", `/api/workflows/${subjectId}/star`, undefined, token);
      const unstarAgain = await api("DELETE", `/api/workflows/${subjectId}/star`, undefined, token);
      check(
        "unstarring is idempotent too",
        unstar.status === 200 && unstarAgain.status === 200 && (await listed(subjectId))?.starred === false,
      );
      await api("PUT", `/api/workflows/${subjectId}/star`, undefined, token);

      // --- duplicate ---
      const copy = await api("POST", `/api/workflows/${subjectId}/duplicate`, undefined, token);
      const copyId = copy.json?.data?.id;
      made.push(copyId);
      const [original, copied] = [await wfRow(subjectId), await wfRow(copyId)];
      check(
        "a duplicate is a new workflow with the same graph — pin, note and switched-off step included",
        copy.status === 201 && copyId !== subjectId && copy.json?.data?.name === `${P32} library subject (copy)` &&
          isDeepStrictEqual(copied?.graph, original.graph) && copy.json?.data?.version === 1,
        JSON.stringify(copy.json).slice(0, 300),
      );
      check("the duplicate mints its own webhook token (D41)", copied && copied.webhookToken !== original.webhookToken);
      const listedCopy = await listed(copyId);
      check(
        "it wears the original's tags, and none of anybody's stars",
        listedCopy?.tags?.length === 2 && listedCopy?.starred === false,
        JSON.stringify(listedCopy?.tags),
      );
      const [firstVersion] = await sql.query('select "label" from "workflow_version" where "workflowId" = $1 and "number" = 1', [copyId]);
      check(
        "its first version says where it came from",
        new RegExp(`^Duplicated from v${original.version} of “${P32} library subject”$`).test(firstVersion?.label ?? ""),
        firstVersion?.label,
      );
      const copyRun = await api("POST", `/api/workflows/${copyId}/runs`, { input: {} }, token);
      check(
        "the duplicate runs",
        copyRun.status === 201 && copyRun.json?.data?.status === "succeeded",
        JSON.stringify(copyRun.json?.data?.steps?.map((s) => [s.nodeId, s.status])),
      );

      await api("PATCH", `/api/workflows/${hookId}`, { visibility: "private" }, token);
      const hookCopy = await api("POST", `/api/workflows/${hookId}/duplicate`, undefined, token);
      const hookCopyId = hookCopy.json?.data?.id;
      made.push(hookCopyId);
      const hookCopyRow = await wfRow(hookCopyId);
      const refused = await api("POST", `/api/webhook/${hookCopyRow?.webhookToken}`, { any: "thing" });
      check(
        "a duplicate whose trigger runs by itself starts switched off — its webhook refuses — and the original stays on",
        hookCopy.json?.data?.active === false && refused.status === 409 && (await wfRow(hookId)).active === true,
        `active ${hookCopy.json?.data?.active}, webhook ${refused.status}`,
      );
      check("a duplicate keeps its original's visibility", hookCopy.json?.data?.visibility === "private", hookCopy.json?.data?.visibility);
      check("a manual workflow's duplicate has nothing to switch off, and stays on", copy.json?.data?.active === true);

      // --- export ---
      const exported = await api("GET", `/api/workflows/${subjectId}/export`, undefined, token);
      const envelope = exported.json?.data;
      const text = JSON.stringify(exported.json);
      check(
        "an export is the versioned envelope",
        exported.status === 200 && envelope?.format === "agentforge/workflow" && envelope?.version === 1 &&
          envelope?.workflow?.name === `${P32} library subject`,
        text.slice(0, 200),
      );
      check(
        "no token, id, owner or workspace is in it",
        ![original.webhookToken, original.id, original.ownerId, original.workspaceId].some((secret) => text.includes(secret)),
      );
      check(
        "its pinned output is left out by default; its note and its off switch travel",
        !text.includes(PIN_WORDS) && envelope?.workflow?.graph?.nodes?.every((node) => !("pinned" in node)) &&
          envelope?.workflow?.graph?.notes?.[0]?.text === "Phase 32 note" && envelope?.workflow?.graph?.nodes?.[2]?.disabled === true,
      );
      const withPins = (await api("GET", `/api/workflows/${subjectId}/export?pinned=include`, undefined, token)).json?.data;
      check(
        "and included on request",
        isDeepStrictEqual(withPins?.workflow?.graph?.nodes?.[1]?.pinned, { output: { greeting: PIN_WORDS } }),
      );

      // --- import into another workspace, and run ---
      const imported = await api("POST", "/api/workflows/import", withPins, token, libArena);
      const importedRow = imported.json?.data?.id ? await wfRow(imported.json.data.id) : null;
      check(
        "an export imports into another workspace as the same graph",
        imported.status === 201 && importedRow?.workspaceId === libArena && isDeepStrictEqual(importedRow?.graph, original.graph),
        JSON.stringify(imported.json).slice(0, 300),
      );
      const [importLabel] = await sql.query('select "label" from "workflow_version" where "workflowId" = $1', [importedRow?.id]);
      check("its first version is labelled as an import", importLabel?.label === "Imported from a file", importLabel?.label);
      const importedRun = await api("POST", `/api/workflows/${importedRow?.id}/runs`, { input: {} }, token, libArena);
      check(
        "the imported workflow runs in its new workspace",
        importedRun.status === 201 && importedRun.json?.data?.status === "succeeded" && importedRun.json?.data?.steps?.length === 4,
        JSON.stringify(importedRun.json?.data?.steps?.map((s) => [s.nodeId, s.status])),
      );
      const hookExport = (await api("GET", `/api/workflows/${hookId}/export`, undefined, token)).json?.data;
      const hookImport = await api("POST", "/api/workflows/import", hookExport, token, libArena);
      check("an imported webhook workflow starts switched off", hookImport.status === 201 && hookImport.json?.data?.active === false);

      // --- import refusals: nothing is created ---
      const [{ n: arenaBefore }] = await sql.query('select count(*)::int as n from "workflow" where "workspaceId" = $1', [libArena]);
      const newer = await api("POST", "/api/workflows/import", { ...envelope, version: 2 }, token, libArena);
      check(
        "a newer export format is refused, naming the version",
        newer.status === 400 && newer.json?.error?.details?.reason === "newer_version" && /version 2/.test(newer.json?.error?.message ?? ""),
        `got ${newer.status}: ${newer.json?.error?.message}`,
      );
      const alien = structuredClone(envelope);
      alien.workflow.graph.nodes.push({ id: "trello", type: "integration.zzzz_trello", position: { x: 960, y: 0 }, config: {} });
      const unknownType = await api("POST", "/api/workflows/import", alien, token, libArena);
      check(
        "an unknown node type refuses the whole file, by name (D39)",
        unknownType.status === 422 && unknownType.json?.error?.code === "invalid_graph" &&
          /“integration\.zzzz_trello”/.test(unknownType.json?.error?.message ?? ""),
        `got ${unknownType.status}: ${unknownType.json?.error?.message}`,
      );
      const notJson = await fetch(`${base}/api/workflows/import`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `${cookieName}=${token}; af_workspace=${libArena}` },
        body: "{ this is not json",
      });
      check("a body that is not JSON is refused", notJson.status === 400 && /not valid JSON/.test(await notJson.text()));
      const clipboard = await api("POST", "/api/workflows/import", { format: "agentforge/nodes", version: 1, nodes: [], edges: [] }, token, libArena);
      check("a copy of canvas nodes is recognised and pointed at the canvas", clipboard.json?.error?.details?.reason === "nodes_clipboard");
      const malformed = structuredClone(envelope);
      malformed.workflow.graph.nodes[0].position = "top left";
      const badShape = await api("POST", "/api/workflows/import", malformed, token, libArena);
      check(
        "a malformed export is refused with the path that failed",
        badShape.status === 400 && badShape.json?.error?.details?.issues?.some((issue) => issue.path === "workflow.graph.nodes.0.position"),
        JSON.stringify(badShape.json?.error).slice(0, 300),
      );
      const huge = await api("POST", "/api/workflows/import", { ...envelope, padding: "x".repeat(2_100_000) }, token, libArena);
      check("a body larger than any export is refused before it is parsed", huge.status === 400 && /larger than/.test(huge.json?.error?.message ?? ""), `got ${huge.status}`);
      const [{ n: arenaAfter }] = await sql.query('select count(*)::int as n from "workflow" where "workspaceId" = $1', [libArena]);
      check("not one refused import created a workflow", arenaAfter === arenaBefore, `${arenaBefore} → ${arenaAfter}`);

      // --- deleting a tag takes it off everything ---
      const deletedTag = await api("DELETE", `/api/tags/${opsId}`, undefined, token);
      check(
        "deleting a tag takes it off every workflow wearing it",
        deletedTag.status === 200 &&
          isDeepStrictEqual((await listed(subjectId))?.tags?.map((tag) => tag.name), ["zzzz p32 Billing"]) &&
          isDeepStrictEqual((await listed(copyId))?.tags?.map((tag) => tag.name), ["zzzz p32 Billing"]),
      );
      check("and deleting it again is a 404", (await api("DELETE", `/api/tags/${opsId}`, undefined, token)).status === 404);
      await api("DELETE", `/api/tags/${billingId}`, undefined, token);
    } finally {
      for (const id of made.filter(Boolean)) await api("DELETE", `/api/workflows/${id}`, undefined, token);
      await sql.query(`delete from "tag" where "name" like 'zzzz p32%'`).catch(() => {});
      if (libArena) await sql.query('delete from "workspace" where "id" = $1', [libArena]).catch(() => {});
    }
  }

  // --- Phase 33: run history and recovery ------------------------------------
  // `CONTRACT.md` → *Run history*, *Re-runs and retries*, on the deployed service. The phase's own
  // validation step is the heart of it: a run fails, the config is fixed, the run is **retried
  // from the failed step**, and the steps are counted to prove the ones before it were not
  // executed again. Probe rows are `zzzz-phase33`.
  {
    const P33 = "zzzz-phase33";
    const guarded = (fixed) => ({
      version: 1,
      nodes: [
        { id: "trigger", type: "core.manual_trigger", position: { x: 0, y: 0 }, config: {} },
        { id: "shape", type: "core.set", position: { x: 240, y: 0 }, config: { fields: { greeting: "hello {{input.name}}" } } },
        {
          id: "guard",
          type: "core.assert",
          label: "Check the greeting",
          position: { x: 480, y: 0 },
          config: {
            left: fixed ? "{{input.greeting}}" : "{{input.missing}}",
            operator: "is_not_empty",
            message: "PHASE33: expected a value and found none.",
          },
        },
        { id: "after", type: "core.log", position: { x: 720, y: 0 }, config: { message: "said {{steps.shape.output.greeting}}" } },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "shape", sourceHandle: null },
        { id: "e2", source: "shape", target: "guard", sourceHandle: null },
        { id: "e3", source: "guard", target: "after", sourceHandle: null },
      ],
    });
    const made = [];
    try {
      const created = await api("POST", "/api/workflows", { name: `${P33} retry`, graph: guarded(false) }, token);
      const subject = created.json?.data?.id;
      made.push(subject);
      check("a workflow to fail is created", created.status === 201 && subject);

      const failed = (await api("POST", `/api/workflows/${subject}/runs`, { input: { name: "Ada" } }, token)).json?.data;
      check(
        "it fails at the guard, with the steps before it done",
        failed?.status === "failed" &&
          isDeepStrictEqual(failed?.steps?.map((step) => step.status), ["succeeded", "succeeded", "failed", "skipped"]),
        JSON.stringify(failed?.steps?.map((step) => [step.nodeId, step.status])),
      );

      // --- the run's history, a page at a time ---
      const listed = await api("GET", `/api/workflows/${subject}/runs`, undefined, token);
      const item = listed.json?.data?.[0];
      check(
        "a workflow's run list is a page of summaries: its name, no input, output or steps",
        listed.status === 200 && item?.id === failed?.id && item?.workflowName === `${P33} retry` &&
          !("input" in (item ?? {})) && !("output" in (item ?? {})) && !("steps" in (item ?? {})) &&
          listed.json?.page && listed.json.page.next === null && listed.json.page.prev === null,
        JSON.stringify(listed.json).slice(0, 300),
      );

      // --- retry before the fix: it fails again, at the same place, having reused the rest ---
      const again = await api("POST", `/api/runs/${failed?.id}/retry`, {}, token);
      check(
        "a retry before the fix fails at the same step, reusing the two before it",
        again.status === 201 && again.json?.data?.status === "failed" &&
          isDeepStrictEqual(again.json?.data?.steps?.map((step) => step.status), ["reused", "reused", "failed", "skipped"]) &&
          isDeepStrictEqual(again.json?.data?.origin, { runId: failed?.id, kind: "retry" }),
        JSON.stringify(again.json).slice(0, 300),
      );

      // --- fix the config, save, and retry the ORIGINAL from its failed step ---
      const fixed = await api("PATCH", `/api/workflows/${subject}`, { graph: guarded(true) }, token);
      check("the guard's config is fixed and saved as a new version", fixed.status === 200 && fixed.json?.data?.version > failed?.workflowVersion);

      const retried = await api("POST", `/api/runs/${failed?.id}/retry`, { mode: "sync" }, token);
      const retry = retried.json?.data;
      check(
        "the retry from the failed step succeeds on the fixed version",
        retried.status === 201 && retry?.status === "succeeded" && retry?.workflowVersion === fixed.json?.data?.version,
        JSON.stringify(retried.json).slice(0, 300),
      );
      check("and names the run it retried", isDeepStrictEqual(retry?.origin, { runId: failed?.id, kind: "retry" }));

      // **Count the steps.** The rows the database holds for the retry: the two before the failure
      // are `reused` with no timestamps — never started in this run — and only the guard and what
      // follows it executed.
      const rows = await sql.query(
        'select "nodeId", "status", "startedAt", "output" from "run_step" where "runId" = $1 order by "seq"',
        [retry?.id],
      );
      check(
        "upstream steps were not re-executed: the retry ran 2 of 4 steps and reused 2",
        isDeepStrictEqual(rows.map((row) => [row.nodeId, row.status]), [
          ["trigger", "reused"],
          ["shape", "reused"],
          ["guard", "succeeded"],
          ["after", "succeeded"],
        ]) && rows.filter((row) => row.startedAt !== null).length === 2,
        JSON.stringify(rows.map((row) => [row.nodeId, row.status, row.startedAt !== null])),
      );
      const original = await sql.query('select "nodeId", "output" from "run_step" where "runId" = $1 order by "seq"', [failed?.id]);
      check(
        "a reused step carries the original's output, and the steps after it read it",
        isDeepStrictEqual(rows[1]?.output, original[1]?.output) &&
          retry?.steps?.[3]?.logs?.some((log) => log.message.includes("said hello Ada")),
        JSON.stringify(retry?.steps?.[3]?.logs),
      );

      // --- refusals that start nothing ---
      const [{ n: runsBefore }] = await sql.query('select count(*)::int as n from "run" where "workflowId" = $1', [subject]);
      const succeededRetry = await api("POST", `/api/runs/${retry?.id}/retry`, {}, token);
      check(
        "a succeeded run cannot be retried — 409, and told to re-run it",
        succeededRetry.status === 409 && /Re-run it/.test(succeededRetry.json?.error?.message ?? ""),
        `got ${succeededRetry.status} ${succeededRetry.json?.error?.message}`,
      );
      const badMode = await api("POST", `/api/runs/${failed?.id}/retry`, { mode: "eventually" }, token);
      check("a body asking for a mode that does not exist is refused", badMode.status === 400, `got ${badMode.status}`);
      const unknown = await api("POST", `/api/runs/${crypto.randomUUID()}/rerun`, {}, token);
      check("re-running a run that does not exist is a 404", unknown.status === 404, `got ${unknown.status}`);
      const waitingId = crypto.randomUUID();
      await sql.query(
        `insert into "run" ("id", "workflowId", "ownerId", "workspaceId", "status", "trigger", "mode", "wakeAt")
         select $1, w."id", $2, w."workspaceId", 'waiting', 'manual', 'durable', now() + interval '1 day' from "workflow" w where w."id" = $3`,
        [waitingId, user.id, subject],
      );
      const waitingRerun = await api("POST", `/api/runs/${waitingId}/rerun`, {}, token);
      check(
        "a run still waiting cannot be started again — 409, and told why",
        waitingRerun.status === 409 && /waiting/.test(waitingRerun.json?.error?.message ?? ""),
        `got ${waitingRerun.status} ${waitingRerun.json?.error?.message}`,
      );
      await sql.query('delete from "run" where "id" = $1', [waitingId]);
      const [{ n: runsAfter }] = await sql.query('select count(*)::int as n from "run" where "workflowId" = $1', [subject]);
      check("not one refusal created a run", runsAfter === runsBefore, `${runsBefore} → ${runsAfter}`);

      // --- re-run: the same input, from the trigger, every step executed ---
      const rerun = await api("POST", `/api/runs/${failed?.id}/rerun`, {}, token);
      check(
        "a re-run executes every step again with the original's input",
        rerun.status === 201 && rerun.json?.data?.status === "succeeded" &&
          isDeepStrictEqual(rerun.json?.data?.input, { name: "Ada" }) &&
          rerun.json?.data?.steps?.every((step) => step.status === "succeeded") &&
          isDeepStrictEqual(rerun.json?.data?.origin, { runId: failed?.id, kind: "rerun" }),
        JSON.stringify(rerun.json).slice(0, 300),
      );
      const queued = await api("POST", `/api/runs/${failed?.id}/rerun`, { mode: "durable" }, token);
      check(
        "a durable re-run answers as starting a durable run does — 202 queued, or 201 run here without a queue",
        (queued.status === 202 && queued.json?.data?.status === "queued") || (queued.status === 201 && queued.json?.data?.status === "succeeded"),
        `got ${queued.status} ${queued.json?.data?.status}`,
      );

      // --- a QUEUED retry: what the run pages and the canvas ask for (D154). It is created with its
      // frontier and its carried-over steps, and a Cloud Tasks delivery resumes it from them through
      // the ordinary dispatch path — nothing in the worker knows it is a retry.
      const retryQueued = await api("POST", `/api/runs/${failed?.id}/retry`, { mode: "durable" }, token);
      let queuedRetry = retryQueued.json?.data;
      if (retryQueued.status === 202) {
        for (let waited = 0; waited < 90_000 && !["succeeded", "failed", "cancelled"].includes(queuedRetry?.status); waited += 2000) {
          await sleep(2000);
          queuedRetry = (await api("GET", `/api/runs/${queuedRetry?.id}`, undefined, token)).json?.data;
        }
      } else {
        queuedRetry = (await api("GET", `/api/runs/${queuedRetry?.id}`, undefined, token)).json?.data;
      }
      check(
        `a queued retry (${retryQueued.status}) resumes from its carried-over steps and executes only the rest`,
        [201, 202].includes(retryQueued.status) && queuedRetry?.status === "succeeded" && queuedRetry?.mode === (retryQueued.status === 202 ? "durable" : "sync") &&
          isDeepStrictEqual(queuedRetry?.steps?.map((step) => step.status), ["reused", "reused", "succeeded", "succeeded"]) &&
          queuedRetry?.steps?.filter((step) => step.startedAt !== null).length === 2,
        JSON.stringify({ status: queuedRetry?.status, mode: queuedRetry?.mode, steps: queuedRetry?.steps?.map((step) => step.status) }),
      );

      // --- the failed step gone: a retry is refused, a re-run is not ---
      const removed = guarded(true);
      removed.nodes = removed.nodes.filter((node) => node.id !== "guard");
      removed.edges = [
        { id: "e1", source: "trigger", target: "shape", sourceHandle: null },
        { id: "e2", source: "shape", target: "after", sourceHandle: null },
      ];
      await api("PATCH", `/api/workflows/${subject}`, { graph: removed }, token);
      const gone = await api("POST", `/api/runs/${failed?.id}/retry`, {}, token);
      check(
        "a retry whose failed step was removed is refused, naming it",
        gone.status === 409 && /"Check the greeting" is no longer in the workflow/.test(gone.json?.error?.message ?? ""),
        `got ${gone.status} ${gone.json?.error?.message}`,
      );

      // --- one step's bodies, loaded on their own ---
      const body = await api("GET", `/api/runs/${failed?.id}/steps/1`, undefined, token);
      check(
        "one step's config, input and output load on their own",
        body.status === 200 && body.json?.data?.seq === 1 &&
          isDeepStrictEqual(body.json?.data?.output, { greeting: "hello Ada" }) &&
          // The config as it ran — resolved, with the node's defaults filled in.
          body.json?.data?.config?.fields?.greeting === "hello Ada",
        JSON.stringify(body.json).slice(0, 300),
      );
      check("a step that does not exist is a 404", (await api("GET", `/api/runs/${failed?.id}/steps/99`, undefined, token)).status === 404);
      check("a step number that is not one is a 404", (await api("GET", `/api/runs/${failed?.id}/steps/one`, undefined, token)).status === 404);

      // --- pages, filters and cursors ---
      const all = await sql.query('select "id" from "run" where "workflowId" = $1 order by "startedAt" desc, "id" desc', [subject]);
      const first = await api("GET", `/api/runs?workflowId=${subject}&limit=2`, undefined, token);
      const second = await api("GET", `/api/runs?workflowId=${subject}&limit=2&before=${encodeURIComponent(first.json?.page?.next ?? "")}`, undefined, token);
      const back = await api("GET", `/api/runs?workflowId=${subject}&limit=2&after=${encodeURIComponent(second.json?.page?.prev ?? "")}`, undefined, token);
      check(
        "pages follow on from each other with nothing skipped and nothing twice",
        isDeepStrictEqual(
          [...(first.json?.data ?? []), ...(second.json?.data ?? [])].map((run) => run.id),
          all.slice(0, 4).map((row) => row.id),
        ),
        `${JSON.stringify(first.json?.page)} ${JSON.stringify(second.json?.page)}`,
      );
      check(
        "the cursor is microsecond-precise, and the first page has no newer one",
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z_/.test(first.json?.page?.next ?? "") && first.json?.page?.prev === null,
        JSON.stringify(first.json?.page),
      );
      check(
        "stepping back from the second page answers the first again",
        isDeepStrictEqual(back.json?.data?.map((run) => run.id), first.json?.data?.map((run) => run.id)),
        JSON.stringify(back.json).slice(0, 200),
      );
      const onlyFailed = await api("GET", `/api/runs?workflowId=${subject}&status=failed`, undefined, token);
      check(
        "filtered by status, only failed runs come back",
        onlyFailed.status === 200 && onlyFailed.json?.data?.length === 2 && onlyFailed.json.data.every((run) => run.status === "failed"),
        JSON.stringify(onlyFailed.json?.data?.map((run) => run.status)),
      );
      const noWebhooks = await api("GET", `/api/runs?workflowId=${subject}&trigger=webhook`, undefined, token);
      check("filtered by trigger, a workflow run by hand has no webhook runs", noWebhooks.json?.data?.length === 0);
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      const future = await api("GET", `/api/runs?workflowId=${subject}&from=${tomorrow}`, undefined, token);
      const today = new Date().toISOString().slice(0, 10);
      const thisDay = await api("GET", `/api/runs?workflowId=${subject}&from=${today}&to=${today}`, undefined, token);
      check(
        "filtered by day, the range is whole UTC days with the last one included",
        future.json?.data?.length === 0 && thisDay.json?.data?.length === Math.min(all.length, 25),
        `${future.json?.data?.length} / ${thisDay.json?.data?.length} of ${all.length}`,
      );
      const refusals = await Promise.all(
        ["status=faild", "trigger=pigeon", "from=2026-02-30", "before=yesterday", "limit=0", "limit=101"].map((query) =>
          api("GET", `/api/runs?${query}`, undefined, token),
        ),
      );
      check(
        "a filter or cursor that does not parse is refused, naming it — never answered as the first page",
        refusals.every((response) => response.status === 400) &&
          refusals[0].json?.error?.details?.[0]?.path === "status" &&
          refusals[3].json?.error?.details?.[0]?.path === "before",
        refusals.map((response) => response.status).join(" "),
      );

      // --- the pages ---
      const runsPage = await page(`/runs?workflow=${subject}`, token);
      check(
        "/runs renders, filtered to the workflow by URL",
        runsPage.status === 200 && runsPage.html.includes(`${P33} retry`) && runsPage.html.includes(`href="/runs/${failed?.id}"`),
        `got ${runsPage.status}`,
      );
      check("/runs reads a mangled URL forgivingly", (await page("/runs?status=exploded&before=nope", token)).status === 200);
      const runPage = await page(`/runs/${failed?.id}`, token);
      check(
        "/runs/[id] renders the run with its retry, step headers and no step bodies",
        // "hello Ada" exists only in step bodies — the shape step's config and output, and what the
        // guard was given — so its absence is the page holding headers and not bodies.
        runPage.status === 200 && runPage.html.includes("Retry from failed step") && runPage.html.includes("Check the greeting") &&
          runPage.html.includes("PHASE33: expected a value") && !runPage.html.includes("hello Ada"),
        `got ${runPage.status}`,
      );
      check("a run that does not exist is the 404 page", (await page(`/runs/${crypto.randomUUID()}`, token)).status === 404);
    } finally {
      for (const id of made.filter(Boolean)) await api("DELETE", `/api/workflows/${id}`, undefined, token);
    }
  }

  // --- Phase 37: when things go wrong --------------------------------------------
  // `CONTRACT.md` → *On-error policy* and *Failure alerts and the inbox*, on the deployed service.
  // The phase's validation: `continue` and `route` behave as the contract says; a webhook run that
  // fails reaches the inbox and starts the workspace's error workflows — a real alert is the browser
  // walk's, with Discord — and the bounds hold: a manual run tells nobody, an error workflow that
  // fails sets off no other, and a switched-off one hears nothing. Probe rows are `zzzz-phase37`.
  {
    const P37 = "zzzz-phase37";
    const at = (x) => ({ x, y: 0 });
    const failingAssert = (id, message, policy) => ({
      id,
      type: "core.assert",
      position: at(240),
      config: { left: "{{input.missing}}", operator: "is_not_empty", message },
      ...(policy ? { policy } : {}),
    });
    const made = [];
    const make = async (name, g) => {
      const created = await api("POST", "/api/workflows", { name: `${P37} ${name}`, graph: g }, token);
      const row = created.json?.data;
      if (row?.id) made.push(row.id);
      return row ?? null;
    };
    const run = async (id, input = {}) => (await api("POST", `/api/workflows/${id}/runs`, { input }, token)).json?.data;
    const stepOf = (r, nodeId) => (r?.steps ?? []).find((step) => step.nodeId === nodeId);
    const inbox = async () => (await api("GET", "/api/inbox", undefined, token)).json?.data;
    const entryFor = (box, wfId) => (box?.entries ?? []).find((entry) => entry.workflowId === wfId && !entry.read);
    const runsOf = async (id) => (await api("GET", `/api/workflows/${id}/runs`, undefined, token)).json?.data ?? [];
    /** Error workflows are queued on the deployed service (Cloud Tasks); wait for the runs to land. */
    const settle = async (id, count) => {
      for (let i = 0; i < 30; i += 1) {
        const runs = await runsOf(id);
        if (runs.length >= count && runs.every((r) => !["queued", "running"].includes(r.status))) return runs;
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      return runsOf(id);
    };
    const hook = async (row) => {
      const url = row?.webhookUrl ?? "";
      const response = await fetch(`${base}/api/webhook/${url.split("/api/webhook/")[1] ?? "none"}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: P37 }),
      });
      return { status: response.status, json: await response.json().catch(() => null) };
    };

    try {
      // --- the policy -------------------------------------------------------------
      const cont = await make("continue", {
        version: 1,
        nodes: [
          { id: "trigger", type: "core.manual_trigger", position: at(0), config: {} },
          failingAssert("guard", "PHASE37: no total on the order.", { retries: 0, backoffMs: 500, onError: "continue" }),
          { id: "after", type: "core.log", position: at(480), config: { message: "after: {{input.error}}" } },
        ],
        edges: [
          { id: "e1", source: "trigger", target: "guard", sourceHandle: null },
          { id: "e2", source: "guard", target: "after", sourceHandle: null },
        ],
      });
      const continued = await run(cont?.id);
      check(
        "continue: the run succeeds, the step is handled, and the next step reads the error",
        continued?.status === "succeeded" &&
          continued?.handled === 1 &&
          stepOf(continued, "guard")?.status === "handled" &&
          stepOf(continued, "guard")?.output?.error === "PHASE37: no total on the order." &&
          stepOf(continued, "after")?.status === "succeeded" &&
          stepOf(continued, "after")?.config?.message === "after: PHASE37: no total on the order.",
        JSON.stringify({ status: continued?.status, handled: continued?.handled, guard: stepOf(continued, "guard")?.status }),
      );

      const routedGraph = (withErrorEdge, policy) => ({
        version: 1,
        nodes: [
          { id: "trigger", type: "core.manual_trigger", position: at(0), config: {} },
          failingAssert("guard", "PHASE37: routed.", policy),
          { id: "after", type: "core.log", position: at(480), config: { message: "the happy path" } },
          { id: "alert", type: "core.log", position: { x: 480, y: 160 }, config: { message: "caught: {{steps.guard.output.error}}" } },
        ],
        edges: [
          { id: "e1", source: "trigger", target: "guard", sourceHandle: null },
          { id: "e2", source: "guard", target: "after", sourceHandle: null },
          ...(withErrorEdge ? [{ id: "e3", source: "guard", target: "alert", sourceHandle: "error" }] : []),
        ],
      });
      const route = await make("route", routedGraph(true, { retries: 0, backoffMs: 500, onError: "route" }));
      const routed = await run(route?.id);
      check(
        "route: the failure leaves by Error, the default path is skipped, and the run succeeds",
        routed?.status === "succeeded" &&
          stepOf(routed, "guard")?.status === "handled" &&
          stepOf(routed, "guard")?.branch === "error" &&
          stepOf(routed, "alert")?.status === "succeeded" &&
          stepOf(routed, "alert")?.config?.message === "caught: PHASE37: routed." &&
          stepOf(routed, "after")?.status === "skipped",
        JSON.stringify((routed?.steps ?? []).map((step) => [step.nodeId, step.status, step.branch])),
      );
      const listed = (await api("GET", `/api/runs?workflowId=${route?.id}`, undefined, token)).json?.data?.[0];
      check("a run's summary says how many errors it handled", listed?.handled === 1, JSON.stringify(listed?.handled));

      const nowhere = await make("route nowhere", routedGraph(false, { retries: 0, backoffMs: 500, onError: "route" }));
      const stranded = await run(nowhere?.id);
      check(
        "route with nothing on Error fails the run — the failure had nowhere to go",
        stranded?.status === "failed" && stepOf(stranded, "guard")?.status === "failed",
        stranded?.status,
      );

      const orphan = await make("orphaned error edge", routedGraph(true, undefined));
      check(
        "an Error edge on a node that does not route is a problem that names the policy",
        orphan?.runnable === false &&
          (orphan?.problems ?? []).some((problem) => problem.code === "unknown_output_handle" && /on-error policy is "route"/.test(problem.message)),
        JSON.stringify(orphan?.problems ?? []).slice(0, 300),
      );
      const refused = await api("POST", `/api/workflows/${orphan?.id}/runs`, { input: {} }, token);
      check("and it does not run", refused.status === 422 && refused.json?.error?.code === "invalid_graph", `got ${refused.status}`);

      // --- the error trigger and the inbox ------------------------------------------
      const errorGraph = (failing) => ({
        version: 1,
        nodes: [
          { id: "trigger", type: "core.error_trigger", position: at(0), config: {} },
          failing
            ? failingAssert("broken", "PHASE37: the alert itself failed.")
            : { id: "say", type: "core.log", position: at(240), config: { message: "{{trigger.workflow.name}} failed at {{trigger.failedStep.label}}: {{trigger.error}}" } },
        ],
        edges: [{ id: "e1", source: "trigger", target: failing ? "broken" : "say", sourceHandle: null }],
      });
      const listener = await make("alert", errorGraph(false));
      const brokenListener = await make("broken alert", errorGraph(true));
      const failing = await make("failing hook", {
        version: 1,
        nodes: [
          { id: "trigger", type: "core.webhook_trigger", position: at(0), config: {} },
          { ...failingAssert("guard", "PHASE37: the order had no total."), label: "Check the total" },
        ],
        edges: [{ id: "e1", source: "trigger", target: "guard", sourceHandle: null }],
      });
      check("an error workflow and a webhook workflow to fail are made", Boolean(listener?.id && brokenListener?.id && failing?.webhookUrl));

      const sample = await run(listener?.id);
      check(
        "run by hand, the error trigger hands on a sample failure — and tells nobody",
        sample?.status === "succeeded" && stepOf(sample, "trigger")?.output?.sample === true,
        JSON.stringify(stepOf(sample, "trigger")?.output ?? null).slice(0, 200),
      );

      const before = await inbox();
      check("the inbox reads, with nothing yet for the failing workflow", before !== undefined && !entryFor(before, failing?.id));

      const first = await hook(failing);
      const firstRun = first.json?.data;
      check("a webhook run fails", first.status === 201 && firstRun?.status === "failed", `got ${first.status}`);
      const afterFirst = await inbox();
      const entry = entryFor(afterFirst, failing?.id);
      check(
        "the failure is in the inbox — unread, its run, its step's words",
        entry?.kind === "run_failed" &&
          entry?.runId === firstRun?.id &&
          entry?.count === 1 &&
          /Check the total: PHASE37: the order had no total\./.test(entry?.detail ?? "") &&
          afterFirst.unread >= 1,
        JSON.stringify(entry ?? afterFirst).slice(0, 300),
      );

      const heard = await settle(listener?.id, 2);
      const alerted = heard.find((r) => r.trigger === "error");
      const alertRun = alerted ? (await api("GET", `/api/runs/${alerted.id}`, undefined, token)).json?.data : null;
      check(
        "the error workflow ran, as trigger `error`, handed the workflow, the step, the error and a link",
        alertRun?.status === "succeeded" &&
          alertRun?.input?.workflow?.name === `${P37} failing hook` &&
          alertRun?.input?.failedStep?.label === "Check the total" &&
          alertRun?.input?.error === "PHASE37: the order had no total." &&
          alertRun?.input?.run?.url?.endsWith(`/runs/${firstRun?.id}`) &&
          stepOf(alertRun, "say")?.config?.message === `${P37} failing hook failed at Check the total: PHASE37: the order had no total.`,
        JSON.stringify(alertRun?.input ?? heard.map((r) => [r.trigger, r.status])).slice(0, 400),
      );

      // The broken listener ran too, failed — and that failure set off nothing more.
      const brokenRuns = await settle(brokenListener?.id, 1);
      check("a second error workflow heard the same failure, and its own failure was recorded",
        brokenRuns.length === 1 && brokenRuns[0]?.trigger === "error" && brokenRuns[0]?.status === "failed",
        JSON.stringify(brokenRuns.map((r) => [r.trigger, r.status])));
      const stillOne = (await settle(listener?.id, 2)).filter((r) => r.trigger === "error");
      check("an error workflow that fails sets off no other — the bound is depth one", stillOne.length === 1, `${stillOne.length} error runs`);
      check("its failure reached the inbox instead", Boolean(entryFor(await inbox(), brokenListener?.id)));

      const second = await hook(failing);
      const collapsed = entryFor(await inbox(), failing?.id);
      check(
        "a second failure while unread updates the entry rather than adding one",
        collapsed?.id === entry?.id && collapsed?.count === 2 && collapsed?.runId === second.json?.data?.id,
        JSON.stringify(collapsed ?? null).slice(0, 200),
      );

      const marked = (await api("POST", "/api/inbox/read", { ids: [collapsed?.id] }, token)).json?.data;
      check(
        "marking it read answers the inbox as it now is",
        marked?.marked === 1 && !entryFor(marked, failing?.id) && (marked?.entries ?? []).some((e) => e.id === collapsed?.id && e.read),
        JSON.stringify(marked ?? null).slice(0, 200),
      );
      check("someone else's entry, or nothing, marks nothing",
        (await api("POST", "/api/inbox/read", { ids: [crypto.randomUUID()] }, token)).json?.data?.marked === 0);
      check("a malformed body is refused",
        (await api("POST", "/api/inbox/read", { ids: [], all: true }, token)).status === 400);

      await run(failing?.id);
      check("a run somebody pressed Run on is told to nobody", !entryFor(await inbox(), failing?.id));

      const offed = await api("PATCH", `/api/workflows/${listener?.id}`, { active: false }, token);
      check("an error workflow can be switched off", offed.status === 200 && offed.json?.data?.active === false);
      const countBefore = (await runsOf(listener?.id)).length;
      await hook(failing);
      await new Promise((resolve) => setTimeout(resolve, 6_000));
      check("switched off, it hears nothing", (await runsOf(listener?.id)).length === countBefore);

      const page37 = await page("/workflows", token);
      check("the header carries the bell, its number in words", page37.status === 200 && /aria-label="Inbox, (\d+ unread|nothing unread)"/.test(page37.html));
    } finally {
      for (const id of made.filter(Boolean)) await api("DELETE", `/api/workflows/${id}`, undefined, token);
    }
  }

  // --- Phase 38: human in the loop ------------------------------------------------
  // `CONTRACT.md` → *Approvals*, on the deployed service: a run pauses; the link goes to a **real**
  // Discord channel and is read back from Discord; approving through it with **no session** resumes
  // the run down Approved through Cloud Tasks; a used link is dead; a member's reject works; a
  // timeout decides; a bare GET — what a link preview does — changes nothing; and the link's token is
  // nowhere in the database. Needs a queue, so the deployed service only. Probe rows are `zzzz-phase38`.
  if (!secure) {
    skip("Phase 38 approvals", "an approval needs the run queue (TASKS_QUEUE), which only the deployed service has");
  } else {
    const P38 = "zzzz-phase38";
    const at = (x, y = 0) => ({ x, y });
    const made = [];
    const make = async (name, nodes, edges) => {
      const created = await api("POST", "/api/workflows", { name: `${P38} ${name}`, graph: { version: 1, nodes, edges } }, token);
      const row = created.json?.data;
      if (row?.id) made.push(row.id);
      return row ?? null;
    };
    const approvalNodes = (config, ask) => [
      { id: "trigger", type: "core.manual_trigger", position: at(0), config: {} },
      { id: "approve", type: "core.approval", position: at(240), config },
      ...(ask ? [ask] : []),
      { id: "yes", type: "core.log", position: at(480, -120), config: { message: "approved via {{input.via}}: {{input.comment}}" } },
      { id: "no", type: "core.log", position: at(480, 120), config: { message: "rejected via {{input.via}}" } },
    ];
    const approvalEdges = (ask) => [
      { id: "e1", source: "trigger", target: "approve", sourceHandle: null },
      ...(ask ? [{ id: "e2", source: "approve", target: ask, sourceHandle: "ask" }] : []),
      { id: "e3", source: "approve", target: "yes", sourceHandle: "approved" },
      { id: "e4", source: "approve", target: "no", sourceHandle: "rejected" },
    ];
    const start = async (id, input = {}) => (await api("POST", `/api/workflows/${id}/runs`, { input }, token)).json?.data;
    const readRun = async (id) => (await api("GET", `/api/runs/${id}`, undefined, token)).json?.data;
    const stepOf = (r, nodeId) => (r?.steps ?? []).find((step) => step.nodeId === nodeId);
    /** A decided run is woken through Cloud Tasks; wait for it to finish. */
    const finished = async (id, seconds = 60) => {
      for (let i = 0; i < seconds; i += 1) {
        const r = await readRun(id);
        if (r && ["succeeded", "failed", "cancelled"].includes(r.status)) return r;
        await sleep(1_000);
      }
      return readRun(id);
    };
    const anon = async (path, body) => {
      const response = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: response.status, json: await response.json().catch(() => null) };
    };
    const approvalOf = async (id) => (await api("GET", `/api/approvals/${id}`, undefined, token)).json?.data;
    const tokenPattern = /\/approve#([A-Za-z0-9_-]{43})/;

    try {
      // --- the link, through a real Discord channel --------------------------------
      const discordHook = process.env.VERIFY_DISCORD_WEBHOOK ?? null;
      if (!discordHook) {
        skip("an approval link sent to Discord and decided through it", "VERIFY_DISCORD_WEBHOOK is not set");
      } else {
        // The connection a later section deletes; stored here so the Ask path has somewhere to send.
        await api("PUT", "/api/integrations/discord", { webhookUrl: discordHook }, token);
        const linked = await make(
          "link",
          approvalNodes(
            { message: "PHASE38 refund {{input.amount}} to {{input.customer}}?", timeout: 1, timeoutUnit: "days" },
            {
              id: "send",
              type: "integration.discord",
              position: at(480, 0),
              config: { content: "AgentForge Phase 38 verification — approval needed: {{input.message}} {{input.url}}" },
            },
          ),
          approvalEdges("send"),
        );
        const paused = await start(linked?.id, { amount: 250, customer: "Ada" });
        const send = stepOf(paused, "send");
        const asked = stepOf(paused, "approve");
        check(
          "the run asks and waits: the approval step is open, its link sent down Ask",
          paused?.status === "waiting" &&
            paused?.waitingFor === "approval" &&
            asked?.status === "running" &&
            send?.status === "succeeded" &&
            typeof send?.output?.messageId === "string",
          JSON.stringify({ status: paused?.status, waitingFor: paused?.waitingFor, steps: (paused?.steps ?? []).map((s) => [s.nodeId, s.status, s.error]) }),
        );
        const approvalId = asked?.output?.approvalId;
        check(
          "what Ask handed on is kept with the link removed",
          asked?.output?.message === "PHASE38 refund 250 to Ada?" && /\/approve#\[removed\]$/.test(asked?.output?.url ?? "") &&
            /\/approve#\[removed\]/.test(send?.config?.content ?? ""),
          JSON.stringify({ url: asked?.output?.url, content: send?.config?.content }),
        );
        const [leaked] = await sql.query(
          `select count(*)::int as n from "run_step" where "runId" = $1
             and (coalesce(config::text, '') ~ '/approve#[A-Za-z0-9_-]{43}' or coalesce(input::text, '') ~ '/approve#[A-Za-z0-9_-]{43}'
               or coalesce(output::text, '') ~ '/approve#[A-Za-z0-9_-]{43}' or logs::text ~ '/approve#[A-Za-z0-9_-]{43}')`,
          [paused?.id],
        );
        check("no step row in the database holds a working link", leaked?.n === 0, `${leaked?.n} rows`);

        // The message, as Discord has it — the only place the link exists.
        const message = await fetch(`${discordHook}/messages/${send?.output?.messageId}`).then((r) => r.json()).catch(() => null);
        const linkToken = message?.content?.match(tokenPattern)?.[1] ?? null;
        const [stored] = await sql.query('select "tokenHash", "status" from "approval" where "id" = $1', [approvalId ?? ""]);
        check(
          "the real Discord message carries the link, and the database holds only its hash",
          linkToken !== null && stored?.tokenHash === createHash("sha256").update(linkToken).digest("hex") && !String(stored?.tokenHash).includes(linkToken),
          JSON.stringify({ found: linkToken !== null, content: message?.content?.slice(0, 80) }),
        );

        const inboxed = (await api("GET", "/api/inbox", undefined, token)).json?.data;
        check(
          "it waits in the owner's inbox — counted, with its message",
          (inboxed?.approvals ?? []).some((a) => a.id === approvalId && a.message === "PHASE38 refund 250 to Ada?") && inboxed?.pending >= 1,
          JSON.stringify(inboxed?.approvals ?? null).slice(0, 200),
        );

        // What a chat app's link preview does: GETs. None of them can decide anything.
        const preview = await page("/approve");
        check("the link's page answers a bare GET with a page that knows nothing", preview.status === 200 && !preview.html.includes("PHASE38"));
        check("there is no page with the token in its path", (await page(`/approve/${linkToken ?? "x"}`)).status === 404);
        const getDescribe = await fetch(`${base}/api/approve/describe`);
        const getDecide = await fetch(`${base}/api/approve/decide`);
        check("neither link route answers a GET", getDescribe.status === 405 && getDecide.status === 405, `${getDescribe.status} / ${getDecide.status}`);
        const untouched = await approvalOf(approvalId);
        check("after every GET the request is still open and undecided", untouched?.status === "pending" && untouched?.open === true, untouched?.status);

        const described = await anon("/api/approve/describe", { token: linkToken });
        check(
          "signed out, the link describes its request — the workflow, the message, the deadline",
          described.status === 200 && described.json?.data?.state === "open" && described.json?.data?.message === "PHASE38 refund 250 to Ada?" &&
            described.json?.data?.workflowName === `${P38} link` && typeof described.json?.data?.expiresAt === "string",
          JSON.stringify(described.json).slice(0, 200),
        );
        check("an unknown token is a 404, a malformed one a 400",
          (await anon("/api/approve/describe", { token: "Q".repeat(43) })).status === 404 &&
            (await anon("/api/approve/describe", { token: "short" })).status === 400);

        const decided = await anon("/api/approve/decide", { token: linkToken, decision: "approve", comment: "PHASE38 via the link" });
        check("signed out, the link approves", decided.status === 200 && decided.json?.data?.status === "approved", JSON.stringify(decided.json));
        const resumed = await finished(paused?.id);
        check(
          "the run resumed through the queue, down Approved — the decision on its output",
          resumed?.status === "succeeded" &&
            stepOf(resumed, "approve")?.status === "succeeded" &&
            stepOf(resumed, "approve")?.branch === "approved" &&
            stepOf(resumed, "approve")?.output?.via === "link" &&
            stepOf(resumed, "approve")?.output?.decidedBy === null &&
            stepOf(resumed, "yes")?.config?.message === "approved via link: PHASE38 via the link" &&
            stepOf(resumed, "no")?.status === "skipped",
          JSON.stringify({ status: resumed?.status, steps: (resumed?.steps ?? []).map((s) => [s.nodeId, s.status, s.branch]) }),
        );
        const again = await anon("/api/approve/decide", { token: linkToken, decision: "reject" });
        check("a used link is dead: a second decision is refused, and the page says it is closed",
          again.status === 409 && (await anon("/api/approve/describe", { token: linkToken })).json?.data?.state === "closed",
          `got ${again.status}`);
        check("a decided request leaves the inbox",
          !(((await api("GET", "/api/inbox", undefined, token)).json?.data?.approvals ?? []).some((a) => a.id === approvalId)));
      }

      // --- a member decides, and a member not named cannot -------------------------
      const quiet = await make("member", approvalNodes({ message: "PHASE38 member decides" }), approvalEdges(null));
      const memberRun = await start(quiet?.id);
      const memberApproval = stepOf(memberRun, "approve")?.output?.approvalId;
      const view = await approvalOf(memberApproval);
      check("with nothing on Ask the run still waits, and the owner may decide",
        memberRun?.status === "waiting" && view?.open === true && view?.canDecide === true && view?.approvers === null,
        JSON.stringify(view ?? memberRun?.status).slice(0, 200));
      const rejected = await api("POST", `/api/approvals/${memberApproval}`, { decision: "reject", comment: "PHASE38 not this time" }, token);
      check("a member rejects", rejected.status === 200 && rejected.json?.data?.status === "rejected" && rejected.json?.data?.decidedBy?.email === user.email,
        JSON.stringify(rejected.json).slice(0, 200));
      const memberDone = await finished(memberRun?.id);
      check("the run goes down Rejected, saying who decided",
        memberDone?.status === "succeeded" && stepOf(memberDone, "no")?.status === "succeeded" && stepOf(memberDone, "yes")?.status === "skipped" &&
          stepOf(memberDone, "approve")?.output?.decidedBy?.email === user.email,
        JSON.stringify((memberDone?.steps ?? []).map((s) => [s.nodeId, s.status])));
      check("deciding twice is a 409", (await api("POST", `/api/approvals/${memberApproval}`, { decision: "approve" }, token)).status === 409);

      const named = await make("named", approvalNodes({ message: "PHASE38 only someone else", approvers: "someone-else@agentforge.invalid" }), approvalEdges(null));
      const namedRun = await start(named?.id);
      const namedApproval = stepOf(namedRun, "approve")?.output?.approvalId;
      check("a request naming somebody else is not this owner's to decide — told so, and refused 403",
        (await approvalOf(namedApproval))?.canDecide === false &&
          (await api("POST", `/api/approvals/${namedApproval}`, { decision: "approve" }, token)).status === 403 &&
          !(((await api("GET", "/api/inbox", undefined, token)).json?.data?.approvals ?? []).some((a) => a.id === namedApproval)));

      // --- stopping a waiting run closes its request ---------------------------------
      const stopped = await api("POST", `/api/runs/${namedRun?.id}/cancel`, {}, token);
      const closed = await approvalOf(namedApproval);
      check("stopping the run closes the request with it",
        stopped.json?.data?.status === "cancelled" && closed?.status === "void" && closed?.open === false &&
          stepOf(stopped.json?.data, "approve")?.status === "failed",
        JSON.stringify({ run: stopped.json?.data?.status, approval: closed?.status }));

      // --- the timeout decides ------------------------------------------------------
      const approving = await make("timeout approve", approvalNodes({ message: "PHASE38 nobody", timeout: 1, timeoutUnit: "minutes", onTimeout: "approve" }), approvalEdges(null));
      const failing = await make("timeout fail", approvalNodes({ message: "PHASE38 nobody", timeout: 1, timeoutUnit: "minutes", onTimeout: "fail" }), approvalEdges(null));
      const [approveRun, failRun] = [await start(approving?.id), await start(failing?.id)];
      check("a one-minute request waits until its timeout",
        approveRun?.status === "waiting" && Math.abs(Date.parse(approveRun?.wakeAt) - Date.now() - 60_000) < 15_000,
        JSON.stringify({ status: approveRun?.status, wakeAt: approveRun?.wakeAt }));
      const timedOut = await finished(approveRun?.id, 120);
      check("nobody decided, and the timeout approved: the run went down Approved",
        timedOut?.status === "succeeded" && stepOf(timedOut, "approve")?.output?.via === "timeout" && stepOf(timedOut, "yes")?.status === "succeeded",
        JSON.stringify({ status: timedOut?.status, via: stepOf(timedOut, "approve")?.output?.via }));
      const expired = await finished(failRun?.id, 60);
      check("a timeout set to fail fails the run, and the request says it expired",
        expired?.status === "failed" && /Nobody decided before the timeout/.test(stepOf(expired, "approve")?.error ?? "") &&
          (await approvalOf(stepOf(failRun, "approve")?.output?.approvalId))?.status === "expired",
        JSON.stringify({ status: expired?.status, error: stepOf(expired, "approve")?.error }));
    } finally {
      for (const id of made.filter(Boolean)) await api("DELETE", `/api/workflows/${id}`, undefined, token);
    }
  }

  // --- Phase 39: composition ------------------------------------------------------
  // `CONTRACT.md` → *Calling a workflow* and *Merge*, on the deployed service: a parent calls a child
  // and the output flows back, the two runs linked both ways; a cycle and a chain too deep are refused
  // at save, and again at run time when a `{{ }}` reference hides them from the save; a called
  // workflow cannot pause the run it is inside; a failed callee fails the step with its own words;
  // a diamond joined by `core.merge` runs the join once with both inputs, a race takes the first, and
  // a retry across a merge reuses the join. Marking a workflow as an agent tool is checked here
  // (the agent calling it needs a model, and is checked with the others that do). Probe rows are `zzzz-phase39`.
  {
    const P39 = "zzzz-phase39";
    const at = (x, y = 0) => ({ x, y });
    const made = [];
    const mk = (id, type, config = {}, x = 0, y = 0) => ({ id, type, position: at(x, y), config });
    const edge = (source, target, sourceHandle = null) => ({ id: `${source}-${target}-${sourceHandle ?? "out"}`, source, target, sourceHandle });
    const create = async (name, nodes, edges) => {
      const created = await api("POST", "/api/workflows", { name: `${P39} ${name}`, graph: { version: 1, nodes, edges } }, token);
      const row = created.json?.data;
      if (row?.id) made.push(row.id);
      return { row: row ?? null, status: created.status, json: created.json };
    };
    const run = async (id, input = {}) => (await api("POST", `/api/workflows/${id}/runs`, { input }, token)).json?.data;
    const stepOf = (r, nodeId) => (r?.steps ?? []).find((step) => step.nodeId === nodeId);
    const readRun = async (id) => (await api("GET", `/api/runs/${id}`, undefined, token)).json?.data;
    try {
      // --- a parent calls a child, and the output flows back --------------------------
      const child = (await create("totals", [mk("trigger", "core.manual_trigger"), mk("shape", "core.set", { fields: { total: 42, echo: "{{input.who}}" } }, 240)], [edge("trigger", "shape")])).row;
      const parent = (await create("parent", [
        mk("trigger", "core.manual_trigger"),
        mk("call", "core.call_workflow", { workflowId: child?.id, input: { who: "{{input.name}}" } }, 240),
        mk("say", "core.log", { message: "got {{input.output.total}} for {{input.output.echo}}" }, 480),
      ], [edge("trigger", "call"), edge("call", "say")])).row;

      const called = await run(parent?.id, { name: "Ada" });
      const callStep = stepOf(called, "call");
      check("a parent that calls a child carries on with what the child returned",
        called?.status === "succeeded" && callStep?.status === "succeeded" && callStep?.output?.output?.total === 42 &&
          callStep?.output?.output?.echo === "Ada" && stepOf(called, "say")?.config?.message === "got 42 for Ada",
        JSON.stringify({ status: called?.status, call: callStep?.output, error: called?.error }));

      const childRun = await readRun(callStep?.output?.runId);
      check("the child ran as a run of its own that names the parent — trigger `workflow`, the calling node, its own workflow",
        childRun?.workflowId === child?.id && childRun?.trigger === "workflow" && childRun?.status === "succeeded" &&
          childRun?.parent?.runId === called?.id && childRun?.parent?.nodeId === "call" && called?.parent === null,
        JSON.stringify({ trigger: childRun?.trigger, parent: childRun?.parent }));

      const parentPage = await page(`/runs/${called?.id}`, token);
      const childPage = await page(`/runs/${childRun?.id}`, token);
      check("the parent's page lists the run its step started, and the child's page says what called it",
        parentPage.status === 200 && parentPage.html.includes("Runs this step started") && parentPage.html.includes(`${P39} totals`) &&
          childPage.status === 200 && childPage.html.includes("Called by") && childPage.html.includes(`${P39} parent`),
        JSON.stringify({ parent: parentPage.status, child: childPage.status }));

      const listed = await api("GET", `/api/runs?trigger=workflow&workflow=${child?.id}`, undefined, token);
      check("run history filters by the new trigger kind, and a called run is in it",
        listed.status === 200 && (listed.json?.data?.runs ?? listed.json?.data ?? []).some?.((r) => r.id === childRun?.id),
        JSON.stringify({ status: listed.status, body: JSON.stringify(listed.json).slice(0, 200) }));

      // --- the called workflow's failure is the step's ---------------------------------
      const broken = (await create("broken", [mk("trigger", "core.manual_trigger"), mk("guard", "core.assert", { left: "{{input.missing}}", operator: "is_not_empty", message: "PHASE39 needs a value" }, 240)], [edge("trigger", "guard")])).row;
      const caller = (await create("caller", [mk("trigger", "core.manual_trigger"), mk("call", "core.call_workflow", { workflowId: broken?.id }, 240)], [edge("trigger", "call")])).row;
      const failed = await run(caller?.id);
      check("a called workflow that fails fails the calling step with its own words and its run id",
        failed?.status === "failed" && stepOf(failed, "call")?.status === "failed" &&
          /failed: .*PHASE39 needs a value.*\(run [0-9a-f-]{36}\)/.test(stepOf(failed, "call")?.error ?? ""),
        JSON.stringify({ status: failed?.status, error: stepOf(failed, "call")?.error }));
      const failedChild = (await api("GET", `/api/workflows/${broken?.id}/runs`, undefined, token)).json?.data?.[0];
      check("and the failed callee's run says it failed, linked to the run above it, without announcing itself",
        failedChild?.status === "failed" && failedChild?.trigger === "workflow",
        JSON.stringify({ status: failedChild?.status, trigger: failedChild?.trigger }));

      // --- a called workflow cannot pause the run it is inside ------------------------
      const napper = (await create("napper", [mk("trigger", "core.manual_trigger"), mk("nap", "core.delay", { amount: 1, unit: "minutes" }, 240)], [edge("trigger", "nap")])).row;
      const waiting = (await create("waits for napper", [mk("trigger", "core.manual_trigger"), mk("call", "core.call_workflow", { workflowId: napper?.id }, 240)], [edge("trigger", "call")])).row;
      const refusedNap = await run(waiting?.id);
      check("a delay in a called workflow fails its step, saying a called workflow cannot pause the run",
        refusedNap?.status === "failed" && /cannot pause it/.test(stepOf(refusedNap, "call")?.error ?? ""),
        JSON.stringify({ status: refusedNap?.status, error: stepOf(refusedNap, "call")?.error }));

      // --- a workflow that does not exist, and the refusals at save -------------------
      const nobody = (await create("calls nobody", [mk("trigger", "core.manual_trigger"), mk("call", "core.call_workflow", { workflowId: crypto.randomUUID() }, 240)], [edge("trigger", "call")])).row;
      const nobodyRun = await run(nobody?.id);
      check("calling a workflow that is not in this workspace fails the step as \"no such workflow\"",
        nobodyRun?.status === "failed" && /There is no workflow with the id/.test(stepOf(nobodyRun, "call")?.error ?? ""),
        JSON.stringify({ error: stepOf(nobodyRun, "call")?.error }));

      const selfCall = await api("PATCH", `/api/workflows/${parent?.id}`, { graph: { version: 1, nodes: [mk("trigger", "core.manual_trigger"), mk("call", "core.call_workflow", { workflowId: parent?.id }, 240)], edges: [edge("trigger", "call")] } }, token);
      check("saving a workflow that calls itself is refused 422, and nothing is stored",
        selfCall.status === 422 && selfCall.json?.error?.code === "invalid_graph" && /call itself/.test(selfCall.json?.error?.message ?? "") &&
          (await api("GET", `/api/workflows/${parent?.id}`, undefined, token)).json?.data?.version === parent?.version,
        JSON.stringify({ status: selfCall.status, error: selfCall.json?.error }));

      const cycle = await api("PATCH", `/api/workflows/${child?.id}`, { graph: { version: 1, nodes: [mk("trigger", "core.manual_trigger"), mk("call", "core.call_workflow", { workflowId: parent?.id }, 240)], edges: [edge("trigger", "call")] } }, token);
      check("saving a workflow that closes a circle of calls is refused, naming the circle",
        cycle.status === 422 && /call itself: .*→/.test(cycle.json?.error?.message ?? "") && cycle.json?.error?.message.includes(`${P39} parent`),
        JSON.stringify({ status: cycle.status, error: cycle.json?.error?.message }));

      // A chain of five: w1 → w2 → w3 → w4 → w5. Saved from the bottom up; the last save is one level too deep.
      const w5 = (await create("depth 5", [mk("trigger", "core.manual_trigger")], [])).row;
      let below = w5;
      for (const level of [4, 3, 2]) {
        below = (await create(`depth ${level}`, [mk("trigger", "core.manual_trigger"), mk("call", "core.call_workflow", { workflowId: below?.id }, 240)], [edge("trigger", "call")])).row;
      }
      const tooDeep = await create("depth 1", [mk("trigger", "core.manual_trigger"), mk("call", "core.call_workflow", { workflowId: below?.id }, 240)], [edge("trigger", "call")]);
      check("a chain more than three levels deep is refused at save",
        tooDeep.status === 422 && /3 levels deep/.test(tooDeep.json?.error?.message ?? ""),
        JSON.stringify({ status: tooDeep.status, error: tooDeep.json?.error?.message }));

      // --- the run-time bounds, where a reference hides the call from the save --------
      const hop = (name) => create(name, [mk("trigger", "core.manual_trigger"), mk("call", "core.call_workflow", { workflowId: "{{input.next}}", input: "{{input.rest}}" }, 240)], [edge("trigger", "call")]);
      const hops = [];
      for (let i = 1; i <= 5; i += 1) hops.push((await hop(`hop ${i}`)).row);
      const chain = { next: hops[1]?.id, rest: { next: hops[2]?.id, rest: { next: hops[3]?.id, rest: { next: hops[4]?.id, rest: {} } } } };
      const deep = await run(hops[0]?.id, chain);
      check("at run time a chain more than three deep stops at the bound — the fifth workflow never runs",
        deep?.status === "failed" && /3 levels deep/.test(JSON.stringify(deep?.error ?? "")) &&
          !((await api("GET", `/api/workflows/${hops[4]?.id}/runs`, undefined, token)).json?.data ?? []).length,
        JSON.stringify({ status: deep?.status, error: deep?.error }));
      const around = await run(hops[0]?.id, { next: hops[1]?.id, rest: { next: hops[0]?.id, rest: {} } });
      check("at run time a workflow already running above a call cannot be called again",
        around?.status === "failed" && /already running above this call|call itself/.test(JSON.stringify(around?.error ?? "")),
        JSON.stringify({ status: around?.status, error: around?.error }));

      // --- core.merge ----------------------------------------------------------------
      const diamond = (name, mode) => create(name, [
        mk("trigger", "core.manual_trigger"),
        mk("a", "core.set", { fields: { from: "a" } }, 240, -80),
        mk("b", "core.set", { fields: { from: "b" } }, 240, 80),
        mk("join", "core.merge", mode ? { mode } : {}, 480),
        mk("after", "core.log", { message: "joined {{input.count}}" }, 720),
      ], [edge("trigger", "a"), edge("trigger", "b"), edge("a", "join"), edge("b", "join"), edge("join", "after")]);
      const joined = await run((await diamond("diamond")).row?.id);
      check("a diamond joined by a merge runs the join once, with both inputs in arrival order",
        joined?.status === "succeeded" && (joined.steps ?? []).filter((x) => x.nodeId === "join").length === 1 &&
          (joined.steps ?? []).filter((x) => x.nodeId === "after").length === 1 &&
          isDeepStrictEqual(stepOf(joined, "join")?.output, { count: 2, inputs: [{ from: "a" }, { from: "b" }], from: ["a", "b"] }),
        JSON.stringify(stepOf(joined, "join")?.output));
      const raced = await run((await diamond("race", "first")).row?.id);
      check("in first mode it runs once, on the first branch, and the other is ignored",
        raced?.status === "succeeded" && (raced.steps ?? []).filter((x) => x.nodeId === "join").length === 1 &&
          stepOf(raced, "join")?.output?.count === 1 && stepOf(raced, "join")?.output?.from?.[0] === "a",
        JSON.stringify(stepOf(raced, "join")?.output));
      const branched = (await create("branch diamond", [
        mk("trigger", "core.manual_trigger"),
        mk("check", "core.branch", { left: "{{input.ok}}", operator: "equals", right: "yes" }, 240),
        mk("yes", "core.set", { fields: { side: "yes" } }, 480, -80),
        mk("no", "core.set", { fields: { side: "no" } }, 480, 80),
        mk("join", "core.merge", {}, 720),
      ], [edge("trigger", "check"), edge("check", "yes", "true"), edge("check", "no", "false"), edge("yes", "join"), edge("no", "join")])).row;
      const oneSide = await run(branched?.id, { ok: "no" });
      check("a diamond a Branch made does not wait for the side that was never chosen",
        oneSide?.status === "succeeded" && stepOf(oneSide, "join")?.output?.count === 1 && stepOf(oneSide, "yes")?.status === "skipped",
        JSON.stringify({ status: oneSide?.status, join: stepOf(oneSide, "join")?.output }));

      // --- a retry across a merge reuses the join -------------------------------------
      const guarded = (await create("guarded diamond", [
        mk("trigger", "core.manual_trigger"),
        mk("a", "core.set", { fields: { from: "a" } }, 240, -80),
        mk("b", "core.set", { fields: { from: "b" } }, 240, 80),
        mk("join", "core.merge", {}, 480),
        mk("guard", "core.assert", { left: "{{trigger.go}}", operator: "is_not_empty", message: "PHASE39 go needed" }, 720),
        mk("after", "core.log", { message: "after" }, 960),
      ], [edge("trigger", "a"), edge("trigger", "b"), edge("a", "join"), edge("b", "join"), edge("join", "guard"), edge("guard", "after")])).row;
      const stopped = await run(guarded?.id);
      check("a run that fails after a merge fails at the step after it, the join having run once",
        stopped?.status === "failed" && stepOf(stopped, "join")?.status === "succeeded" && stepOf(stopped, "guard")?.status === "failed",
        JSON.stringify({ status: stopped?.status }));
      await api("PATCH", `/api/workflows/${guarded?.id}`, { graph: { version: 1, nodes: [
        mk("trigger", "core.manual_trigger"), mk("a", "core.set", { fields: { from: "a" } }, 240, -80), mk("b", "core.set", { fields: { from: "b" } }, 240, 80),
        mk("join", "core.merge", {}, 480), mk("guard", "core.assert", { left: "{{input.count}}", operator: "is_not_empty", message: "PHASE39 go needed" }, 720), mk("after", "core.log", { message: "after" }, 960),
      ], edges: [edge("trigger", "a"), edge("trigger", "b"), edge("a", "join"), edge("b", "join"), edge("join", "guard"), edge("guard", "after")] } }, token);
      const retried = await api("POST", `/api/runs/${stopped?.id}/retry`, { mode: "sync" }, token);
      const afterRetry = retried.json?.data?.steps ? retried.json.data : await (async () => { for (let i = 0; i < 40; i += 1) { const r = await readRun(retried.json?.data?.id); if (["succeeded", "failed"].includes(r?.status)) return r; await sleep(1_000); } return null; })();
      check("a retry across a merge carries the join over as reused, and runs only what was left",
        retried.status < 300 && afterRetry?.status === "succeeded" && stepOf(afterRetry, "join")?.status === "reused" &&
          stepOf(afterRetry, "guard")?.status === "succeeded" && stepOf(afterRetry, "after")?.status === "succeeded",
        JSON.stringify({ http: retried.status, status: afterRetry?.status, join: stepOf(afterRetry, "join")?.status, error: afterRetry?.error }));

      // --- marking a workflow as an agent tool ---------------------------------------
      const tool = { name: "lookup_order", description: "Looks up an order by its id and says whether it has shipped.", fields: [{ name: "order_id", type: "string", description: "The order's id", required: true }] };
      const lookup = (await create("lookup order", [mk("trigger", "core.manual_trigger"), mk("find", "core.set", { fields: { order: "{{trigger.order_id}}", status: "shipped" } }, 240)], [edge("trigger", "find")])).row;
      const marked = await api("PUT", `/api/workflows/${lookup?.id}/tool`, tool, token);
      check("a workflow is marked callable by agents with a name, a description and its inputs — and that is not a version",
        marked.status === 200 && marked.json?.data?.agentTool?.name === "lookup_order" && marked.json?.data?.version === lookup?.version &&
          marked.json?.data?.agentTool?.fields?.[0]?.required === true,
        JSON.stringify({ status: marked.status, version: marked.json?.data?.version, tool: marked.json?.data?.agentTool }));
      check("the marking is refused for a bad name and for a description a model cannot act on",
        (await api("PUT", `/api/workflows/${lookup?.id}/tool`, { ...tool, name: "Look Up!" }, token)).status === 400 &&
          (await api("PUT", `/api/workflows/${lookup?.id}/tool`, { ...tool, description: "Looks" }, token)).status === 400);
      const twin = await api("PUT", `/api/workflows/${parent?.id}/tool`, tool, token);
      check("two workflows cannot present one tool name — 409, without naming the other",
        twin.status === 409 && !JSON.stringify(twin.json).includes(lookup?.id),
        JSON.stringify({ status: twin.status, error: twin.json?.error }));
      const pickers = (await api("GET", `/api/workflows/callable?exclude=${parent?.id}`, undefined, token)).json?.data ?? [];
      check("the pickers' list carries id, name and the marking, leaves out the workflow being edited, and carries no graph",
        pickers.some((w) => w.id === lookup?.id && w.tool?.name === "lookup_order") && !pickers.some((w) => w.id === parent?.id) &&
          pickers.every((w) => Object.keys(w).sort().join() === "id,name,tool"),
        JSON.stringify(pickers.slice(0, 2)));
      const read = (await api("GET", `/api/workflows/${lookup?.id}`, undefined, token)).json?.data;
      check("the marking reads back on the workflow", read?.agentTool?.description === tool.description);

      // --- the agent calls a workflow tool (needs a model: the key section below) ----
      phase39 = { lookupId: lookup?.id, plainId: parent?.id, made };
    } finally {
      // The key-gated agent checks below still need these; they are removed there.
      if (!process.env.VERIFY_GEMINI_KEY) {
        for (const id of made.filter(Boolean)) await api("DELETE", `/api/workflows/${id}`, undefined, token);
        phase39 = null;
      }
    }
  }

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
  // `workspaceId` is read off the workflow rather than passed in, exactly as the engine
  // does it: a run belongs where its workflow does. It became required in Phase 19A, and
  // this insert not having it is what the deployed run of that phase's migration caught.
  await sql.query(
    `insert into "run" ("id", "workflowId", "ownerId", "workspaceId", "status", "trigger", "startedAt", "heartbeatAt")
     select $1, $2, $3, w."workspaceId", $4, $5, $6, $6 from "workflow" w where w."id" = $2`,
    [orphan, workflowId, user.id, "running", "manual", new Date(Date.now() - 30 * 60 * 1000)],
  );
  await api("GET", "/api/runs", undefined, token);
  const [reaped] = await sql.query('select status, error from "run" where id = $1', [orphan]);
  check("an interrupted run is reaped into failed, never left running",
    reaped?.status === "failed" && typeof reaped?.error === "string",
    JSON.stringify(reaped));

  // --- a brand-new account gets its own workspace ---------------------------
  // Since Phase 19A this also exercises the healing path: a user row with no workspace
  // and no membership gets one created by the scope resolver on its very first request
  // (`lib/workspace/store.ts`). The account below is created straight in the database,
  // so it never goes through the `createUser` event — which is precisely the case the
  // resolver's fallback exists for.
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

  const [{ n: healed }] = await sql.query(
    'select count(*)::int as n from "workspace_member" where "userId" = $1',
    [other2.id],
  );
  check(
    "an account with no workspace is given one on its first request",
    healed === 1,
    `${healed} memberships`,
  );

  // The workspace is deleted explicitly: `workspace.createdBy` is `on delete set null`
  // so that removing a person does not remove the workspace other people are in, which
  // means deleting this user alone would strand the workspace it just created.
  await sql.query('delete from "workspace" where "createdBy" = $1', [other2.id]);
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

    // --- phase 39: an agent calls a workflow as a tool ---------------------------
    // Opt-in twice (D186): the workflow is marked, and the agent lists it by id. The tool call is a
    // run of its own that names the agent's node — and a workflow that is *not* marked is not offered.
    {
      const p39 = phase39;
      const agentWith = async (name, tools, objective) => {
        const created = await api("POST", "/api/workflows", {
          name: `zzzz-phase39 ${name}`,
          graph: {
            version: 1,
            nodes: [
              { id: "trigger", type: "core.manual_trigger", position: { x: 0, y: 0 }, config: {} },
              { id: "agent", type: "ai.agent", position: { x: 240, y: 0 }, config: { objective, tools, maxIterations: 4, temperature: 0 } },
            ],
            edges: [{ id: "e1", source: "trigger", target: "agent", sourceHandle: null }],
          },
        }, token);
        p39?.made.push(created.json?.data?.id);
        return created.json?.data;
      };
      if (p39?.lookupId) {
        const toolAgent = await agentWith("agent with a tool", [`workflow:${p39.lookupId}`], "Find out whether order A-17 has shipped by calling the workflow_lookup_order tool, then say the status in one sentence.");
        const asked = await api("POST", `/api/workflows/${toolAgent?.id}/runs`, {}, token);
        const agentRunStep = (asked.json?.data?.steps ?? []).find((step) => step.nodeId === "agent");
        check("an agent that lists a workflow tool is offered it, by the name and inputs the author declared",
          (agentRunStep?.logs ?? []).some((log) => /with 1 tool\(s\): workflow_lookup_order/.test(log.message)),
          JSON.stringify((agentRunStep?.logs ?? []).map((log) => log.message).slice(0, 3)));
        check("the agent called the workflow, and the call is a run of its own that names the agent's step",
          asked.json?.data?.status === "succeeded" &&
            (agentRunStep?.output?.toolCalls ?? []).some((call) => call.name === "workflow_lookup_order" && call.ok === true) &&
            (agentRunStep?.logs ?? []).some((log) => /\[workflow_lookup_order\] ran .* as run [0-9a-f-]{36}/.test(log.message)),
          JSON.stringify({ status: asked.json?.data?.status, calls: agentRunStep?.output?.toolCalls, error: agentRunStep?.error }));
        const childId = ((agentRunStep?.logs ?? []).map((log) => /as run ([0-9a-f-]{36})/.exec(log.message)?.[1]).find(Boolean));
        const toolRun = childId ? (await api("GET", `/api/runs/${childId}`, undefined, token)).json?.data : null;
        check("the tool's run is visible on its own: trigger `agent`, the agent's run and node, the model's arguments as its payload",
          toolRun?.workflowId === p39.lookupId && toolRun?.trigger === "agent" && toolRun?.parent?.runId === asked.json?.data?.id &&
            toolRun?.parent?.nodeId === "agent" && JSON.stringify(toolRun?.input ?? {}).includes("A-17"),
          JSON.stringify({ trigger: toolRun?.trigger, parent: toolRun?.parent, input: toolRun?.input }));

        // A workflow listed but not marked, and one that does not exist: named in the log, never offered.
        const unmarked = await agentWith("agent listing an unmarked workflow", [`workflow:${p39.plainId}`, `workflow:${crypto.randomUUID()}`], "Say hello in one sentence.");
        const unmarkedRun = await api("POST", `/api/workflows/${unmarked?.id}/runs`, {}, token);
        const unmarkedStep = (unmarkedRun.json?.data?.steps ?? []).find((step) => step.nodeId === "agent");
        const logs = (unmarkedStep?.logs ?? []).map((log) => log.message);
        check("a workflow that is not marked callable by agents is not offered — the agent's log says so, and it has no tools",
          logs.filter((line) => /is not available to agents/.test(line)).length === 2 && logs.some((line) => /with 0 tool\(s\): none/.test(line)),
          JSON.stringify(logs.slice(0, 4)));
      }
      for (const id of (p39?.made ?? []).filter(Boolean)) await api("DELETE", `/api/workflows/${id}`, undefined, token);
      phase39 = null;
    }

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

      // --- phase 35: the copilot proposes an edit, and writes nothing ---------
      //
      // A real model, through the deployed route, edits the workflow it just generated. The
      // proposal must be the same workflow plus the change — every node it had, where it was —
      // and the stored workflow must not have moved at all: no new version, the same graph.
      const storedBefore = (await api("GET", `/api/workflows/${madeId}`, undefined, token)).json?.data;
      const versionsQuery = 'select count(*)::int as n from "workflow_version" where "workflowId" = $1';
      const [{ n: versionsBefore }] = await sql.query(versionsQuery, [madeId]);
      const proposed = await api(
        "POST",
        `/api/workflows/${madeId}/copilot`,
        { instruction: "At the very end, also log the text 'triage finished'.", graph: storedBefore?.graph },
        token,
      );
      const proposal = proposed.json?.data?.proposal;
      const proposedNodes = new Map((proposal?.graph?.nodes ?? []).map((node) => [node.id, node]));
      check(
        "the copilot proposes an edit: every node kept where it was, one added, all from the registry",
        proposed.status === 200 &&
          (storedBefore?.graph?.nodes ?? []).every((node) => {
            const kept = proposedNodes.get(node.id);
            return kept && kept.type === node.type && kept.position.x === node.position.x && kept.position.y === node.position.y;
          }) &&
          proposal.changes.added >= 1 &&
          proposal.changes.removed === 0 &&
          proposal.graph.nodes.every((node) => registryTypes.has(node.type)) &&
          Array.isArray(proposal.unsupported) &&
          typeof proposed.json?.data?.generation?.model === "string",
        JSON.stringify({
          status: proposed.status,
          changes: proposal?.changes,
          nodes: proposal?.graph?.nodes?.map((node) => [node.id, node.type]),
          error: proposed.json?.error,
        }),
      );
      const storedAfter = (await api("GET", `/api/workflows/${madeId}`, undefined, token)).json?.data;
      const [{ n: versionsAfter }] = await sql.query(versionsQuery, [madeId]);
      check(
        "a proposal is not applied: the stored workflow, its version and its history are untouched",
        storedAfter?.version === storedBefore?.version &&
          JSON.stringify(storedAfter?.graph) === JSON.stringify(storedBefore?.graph) &&
          versionsAfter === versionsBefore,
        JSON.stringify({ before: storedBefore?.version, after: storedAfter?.version, versionsBefore, versionsAfter }),
      );

      // --- phase 36: the copilot explains the workflow, and writes nothing ----
      //
      // A pause first: the free tier allows `gemini-3-flash` five calls a minute, and the
      // generation and edit checks above have just spent them (Phase 35's battery met exactly that).
      await new Promise((resolve) => setTimeout(resolve, 20_000));
      const explained = await api("POST", `/api/workflows/${madeId}/copilot`, { kind: "explain", graph: storedBefore?.graph }, token);
      const explanation = explained.json?.data?.explanation;
      const graphIds = new Set((storedBefore?.graph?.nodes ?? []).map((node) => node.id));
      const citedIds = (explanation?.sentences ?? []).flatMap((sentence) => sentence.nodes);
      check(
        "the copilot explains a workflow in sentences that cite only steps it has, and stores nothing",
        explained.status === 200 &&
          typeof explanation?.summary === "string" &&
          explanation.sentences.length > 0 &&
          citedIds.length > 0 &&
          citedIds.every((id) => graphIds.has(id)) &&
          (await api("GET", `/api/workflows/${madeId}`, undefined, token)).json?.data?.version === storedBefore?.version,
        JSON.stringify({ status: explained.status, sentences: explanation?.sentences?.length, cited: citedIds, error: explained.json?.error }),
      );

      await api("DELETE", `/api/workflows/${madeId}`, undefined, token);
    }

    const emptyPrompt = await api("POST", "/api/workflows/generate", { prompt: "   " }, token);
    check(
      "an empty prompt is refused before any model is called",
      emptyPrompt.status === 400 && emptyPrompt.json?.error?.code === "invalid_request",
      JSON.stringify(emptyPrompt.json),
    );

    // Phase 35. The copilot's refusals that need no model: a blank instruction, a body that is
    // not a graph, and a workflow that is not there — each before a model is called.
    const someGraph = { version: 1, nodes: [{ id: "t", type: "core.manual_trigger", position: { x: 0, y: 0 }, config: {} }], edges: [] };
    const blankInstruction = await api("POST", `/api/workflows/${workflowId}/copilot`, { instruction: "  ", graph: someGraph }, token);
    const notAGraph = await api("POST", `/api/workflows/${workflowId}/copilot`, { instruction: "add a log", graph: { nodes: "x" } }, token);
    const noWorkflow = await api(
      "POST",
      "/api/workflows/00000000-0000-4000-8000-000000000000/copilot",
      { instruction: "add a log", graph: someGraph },
      token,
    );
    check(
      "the copilot refuses a blank instruction and a malformed graph with 400, and an unknown workflow with 404",
      blankInstruction.status === 400 &&
        blankInstruction.json?.error?.code === "invalid_request" &&
        notAGraph.status === 400 &&
        noWorkflow.status === 404 &&
        noWorkflow.json?.error?.code === "not_found",
      JSON.stringify({ blank: blankInstruction.status, graph: notAGraph.status, missing: noWorkflow.status }),
    );

    // --- phase 36: why did this run fail? — diagnose, fix, retry ----------------
    //
    // The whole loop the canvas runs, through the deployed API: a run that fails on a misspelt time
    // zone; the copilot diagnoses it from the run's record (which the server reads itself) and names
    // the fix in words; the fix, asked for as an edit, comes back as a proposal; saving the proposal
    // stands in for Accept and Save; and Phase 33's retry from the failed step then succeeds.
    const P36 = "zzzz-phase36";
    const dueGraph = {
      version: 1,
      nodes: [
        { id: "trigger", type: "core.manual_trigger", position: { x: 0, y: 0 }, config: {} },
        { id: "due", type: "transform.date", label: "Format the due date", position: { x: 300, y: 0 }, config: { value: "{{trigger.due}}", timeZone: "Asia/Calcuta" } },
        { id: "note", type: "core.log", label: "Log the due date", position: { x: 600, y: 0 }, config: { message: "Due {{steps.due.output.date}}" } },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "due", sourceHandle: null },
        { id: "e2", source: "due", target: "note", sourceHandle: null },
      ],
    };
    const dueId = (await api("POST", "/api/workflows", { name: `${P36} diagnose`, graph: dueGraph }, token)).json?.data?.id;
    const dueRun = (await api("POST", `/api/workflows/${dueId}/runs`, { input: { due: "2026-10-12T09:30:00Z" } }, token)).json?.data;
    check(
      "a misspelt time zone fails its run at the date step",
      dueRun?.status === "failed" && dueRun.steps?.find((step) => step.nodeId === "due")?.status === "failed",
      JSON.stringify({ status: dueRun?.status, steps: dueRun?.steps?.map((step) => [step.nodeId, step.status, step.error]) }),
    );

    // Refusals that need no model — each answered before a key is even looked up. A workflow of its
    // own for the run that succeeds: the shared one's state depends on every check before this.
    const okGraph = {
      version: 1,
      nodes: [
        { id: "trigger", type: "core.manual_trigger", position: { x: 0, y: 0 }, config: {} },
        { id: "say", type: "core.log", position: { x: 300, y: 0 }, config: { message: "fine" } },
      ],
      edges: [{ id: "e1", source: "trigger", target: "say", sourceHandle: null }],
    };
    const okId = (await api("POST", "/api/workflows", { name: `${P36} succeeds`, graph: okGraph }, token)).json?.data?.id;
    const okRun = (await api("POST", `/api/workflows/${okId}/runs`, { input: {} }, token)).json?.data;
    const notFailed = await api("POST", `/api/workflows/${okId}/copilot`, { kind: "diagnose", runId: okRun?.id, graph: okGraph }, token);
    const elsewhereRun = await api("POST", `/api/workflows/${okId}/copilot`, { kind: "diagnose", runId: dueRun?.id, graph: okGraph }, token);
    const noRunId = await api("POST", `/api/workflows/${dueId}/copilot`, { kind: "diagnose", graph: dueGraph }, token);
    const unknownKind = await api("POST", `/api/workflows/${dueId}/copilot`, { kind: "rewrite", graph: dueGraph }, token);
    const explainNoGraph = await api("POST", `/api/workflows/${dueId}/copilot`, { kind: "explain", graph: { nodes: "x" } }, token);
    check(
      "a diagnosis is refused for a run that did not fail (409), another workflow's run (404), and a malformed ask (400)",
      okRun?.status === "succeeded" &&
        notFailed.status === 409 &&
        notFailed.json?.error?.code === "conflict" &&
        elsewhereRun.status === 404 &&
        elsewhereRun.json?.error?.code === "not_found" &&
        noRunId.status === 400 &&
        unknownKind.status === 400 &&
        explainNoGraph.status === 400,
      JSON.stringify({
        okRun: okRun?.status,
        notFailed: notFailed.status,
        elsewhere: elsewhereRun.status,
        noRunId: noRunId.status,
        unknownKind: unknownKind.status,
        explain: explainNoGraph.status,
      }),
    );

    const [{ n: dueVersionsBefore }] = await sql.query('select count(*)::int as n from "workflow_version" where "workflowId" = $1', [dueId]);
    const diagnosed = await api("POST", `/api/workflows/${dueId}/copilot`, { kind: "diagnose", runId: dueRun?.id, graph: dueGraph }, token);
    const diagnosis = diagnosed.json?.data?.diagnosis;
    const facts = diagnosed.json?.data?.run;
    const [{ n: dueVersionsAfter }] = await sql.query('select count(*)::int as n from "workflow_version" where "workflowId" = $1', [dueId]);
    check(
      "the copilot diagnoses the failed run: it cites the date step, names a fix, and says which steps already ran",
      diagnosed.status === 200 &&
        diagnosis?.sentences?.some((sentence) => sentence.nodes.includes("due")) &&
        typeof diagnosis?.fix === "string" &&
        facts?.id === dueRun?.id &&
        facts?.failedNodeId === "due" &&
        isDeepStrictEqual(facts?.ran, ["trigger"]) &&
        facts?.partialTest === false &&
        dueVersionsAfter === dueVersionsBefore,
      JSON.stringify({ status: diagnosed.status, diagnosis, facts, error: diagnosed.json?.error }),
    );

    if (typeof diagnosis?.fix === "string") {
      const fixProposed = await api("POST", `/api/workflows/${dueId}/copilot`, { instruction: diagnosis.fix, graph: dueGraph }, token);
      const fixedGraph = fixProposed.json?.data?.proposal?.graph;
      const fixedZone = fixedGraph?.nodes?.find((node) => node.id === "due")?.config?.timeZone;
      // A zone this runtime recognises — Asia/Kolkata, or the Asia/Calcutta alias, both run.
      const realZone = (() => {
        if (typeof fixedZone !== "string" || fixedZone === "Asia/Calcuta") return false;
        try {
          // Throws a RangeError for a zone this runtime does not know.
          return new Intl.DateTimeFormat("en", { timeZone: fixedZone }).resolvedOptions().timeZone.length > 0;
        } catch {
          return false;
        }
      })();
      check(
        "the fix, asked for as an edit, proposes a real time zone on the date step and changes nothing else",
        fixProposed.status === 200 &&
          realZone &&
          isDeepStrictEqual(fixedGraph?.nodes?.find((node) => node.id === "note")?.config, dueGraph.nodes[2].config),
        JSON.stringify({ status: fixProposed.status, fix: diagnosis.fix, zone: fixedZone, error: fixProposed.json?.error }),
      );
      // Accept, then Save — the canvas's two acts, as one PATCH — then retry the original run.
      const savedFix = await api("PATCH", `/api/workflows/${dueId}`, { graph: fixedGraph }, token);
      const retriedFix = await api("POST", `/api/runs/${dueRun?.id}/retry`, { mode: "sync" }, token);
      const retryRun = retriedFix.json?.data;
      check(
        "after the fix is saved, the retry from the failed step succeeds — the trigger reused, the date step run",
        savedFix.status === 200 &&
          retriedFix.status === 201 &&
          retryRun?.status === "succeeded" &&
          retryRun?.steps?.find((step) => step.nodeId === "trigger")?.status === "reused" &&
          retryRun?.steps?.find((step) => step.nodeId === "due")?.status === "succeeded",
        JSON.stringify({ saved: savedFix.status, status: retryRun?.status, steps: retryRun?.steps?.map((step) => [step.nodeId, step.status]) }),
      );
    } else {
      skip("the fix becomes a proposal, and the retry succeeds", "the diagnosis named no fix — see the check above");
    }
    await api("DELETE", `/api/workflows/${dueId}`, undefined, token);
    await api("DELETE", `/api/workflows/${okId}`, undefined, token);

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

    /**
     * A scheduled run is ALWAYS durable (Phase 17), so the tick enqueues it and
     * answers; a Cloud Tasks delivery is what actually executes it. Reading the run
     * straight afterwards and asserting `succeeded` is therefore a race, and it is one
     * this check lost for the first time in Phase 18 — a single extra query on the
     * resume path was enough to tip it. It had been passing on luck since Phase 17.
     *
     * So it waits, the way a client would. The run must still reach `succeeded`; the
     * only thing that changed is that "not yet" stopped counting as "no".
     */
    let scheduleRun = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const scheduleRuns = await api("GET", `/api/workflows/${scheduleId}/runs`, undefined, token);
      scheduleRun = (scheduleRuns.json?.data ?? [])[0];
      if (scheduleRun && scheduleRun.status !== "queued" && scheduleRun.status !== "running") break;
      await sleep(1000);
    }
    check(
      "the run it created is attributed to the schedule trigger and succeeded",
      scheduleRun?.trigger === "schedule" && scheduleRun?.status === "succeeded",
      JSON.stringify(scheduleRun).slice(0, 250),
    );
    check(
      "a scheduled run records the workflow version it executed",
      typeof scheduleRun?.workflowVersion === "number",
      `workflowVersion ${JSON.stringify(scheduleRun?.workflowVersion)}`,
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
  // Four integrations here, and four more added by Phase 23B below; each a registry entry
  // and therefore each also an agent tool.
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
    // 9 since Phase 23C added Postgres to Phase 23B's eight. Pinned rather than counted
    // loosely, because this check's job is to make a new integration a decision somebody
    // takes rather than a line in a diff.
    "every integration declares an output shape for the generator to read",
    integrationNodes.length === 9 &&
      integrationNodes.every(
        (node) => typeof node.outputShape === "string" && node.outputShape.length > 20,
      ),
    JSON.stringify(integrationNodes.map((node) => [node.type, node.outputShape])).slice(0, 300),
  );

  // --- Phase 23B: the four token integrations -------------------------------
  // The real-service proofs live in `verify-integrations.mjs`, which needs credentials only
  // the user can create. What belongs here is the part that must never regress silently: the
  // registry projection, and that the new dynamic route did not swallow Discord's static one.
  check(
    "registry serves all four Phase 23B integration node types",
    ["integration.slack", "integration.notion", "integration.github", "integration.airtable"].every(
      (type) => registryTypes.has(type),
    ),
    JSON.stringify(types),
  );

  for (const slug of ["slack", "notion", "github", "airtable"]) {
    const anon = await api("GET", `/api/integrations/${slug}`);
    check(`GET /api/integrations/${slug} requires a session`, anon.status === 401, `got ${anon.status}`);

    const status = await api("GET", `/api/integrations/${slug}`, undefined, token);
    check(
      `${slug} reports status without any part of a secret`,
      status.status === 200 &&
        typeof status.json?.data?.configured === "boolean" &&
        !("secret" in (status.json?.data ?? {})),
      JSON.stringify(status.json?.data ?? {}).slice(0, 200),
    );
  }

  const unknownService = await api("GET", "/api/integrations/nope", undefined, token);
  check(
    "a service the registry does not know is 404, not a permissive default",
    unknownService.status === 404,
    `got ${unknownService.status}`,
  );
  const protoService = await api("GET", "/api/integrations/__proto__", undefined, token);
  check(
    "a prototype key is 404 too — the route's lookup is a Map, not an object index",
    protoService.status === 404,
    `got ${protoService.status}`,
  );

  const callableTypes = new Set(
    (nodes.json?.data ?? []).filter((node) => node.agentCallable).map((node) => node.type),
  );
  check(
    "every integration but Gmail is reachable by the agent",
    [
      "integration.http",
      "integration.discord",
      "integration.sheets",
      // Phase 23B. Each one's destination is bounded by the stored credential rather than by
      // the model, which is the D19 test each had to pass to be listed here.
      "integration.slack",
      "integration.notion",
      "integration.github",
      "integration.airtable",
    ].every((type) => callableTypes.has(type)),
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
    // Put it back. Until Phase 38 this suite left the workspace without its Discord connection,
    // and the next smoke walk lost its Discord beat (`PROGRESS.md` → *Notes*).
    const restored = await api("PUT", "/api/integrations/discord", { webhookUrl: discordWebhook }, token);
    check("the workspace's Discord connection is put back as it was", restored.json?.data?.configured === true);
  }

  // Clean up Phase 9's own workflows.
  for (const id of [httpId, credsId, discordId]) {
    if (id) await api("DELETE", `/api/workflows/${id}`, undefined, token);
  }

  // --- Phase 18: versioning and diffing --------------------------------------
  //
  // The whole point of these is that they cannot be proved by a unit test: the
  // version NUMBER is produced by a `RETURNING` on a single-row UPDATE against real
  // Postgres, the debounce depends on `jsonb` key normalisation, and the backfill is
  // a data statement in a migration. All three are properties of the database.
  {
    let vId = null;
    try {
      const created = await api(
        "POST",
        "/api/workflows",
        {
          name: "Phase 18 versioning",
          graph: {
            version: 1,
            nodes: [
              { id: "start", type: "core.manual_trigger", position: { x: 0, y: 0 }, config: {} },
              { id: "note", type: "core.log", position: { x: 240, y: 0 }, config: { message: "one" } },
            ],
            edges: [{ id: "e1", source: "start", target: "note", sourceHandle: null }],
          },
        },
        token,
      );
      vId = created.json?.data?.id;
      check(
        "a new workflow starts at v1",
        created.json?.data?.version === 1,
        `version ${created.json?.data?.version}`,
      );

      const first = await api("GET", `/api/workflows/${vId}/versions`, undefined, token);
      check(
        "creating a workflow records version 1, not nothing",
        Array.isArray(first.json?.data) &&
          first.json.data.length === 1 &&
          first.json.data[0].number === 1 &&
          first.json.data[0].current === true,
        JSON.stringify(first.json?.data).slice(0, 250),
      );
      check(
        "the history carries no graphs — it is a list, not fifty snapshots",
        first.json?.data?.[0]?.graph === undefined,
        JSON.stringify(Object.keys(first.json?.data?.[0] ?? {})),
      );
      check(
        "the oldest version reports null changes rather than a zeroed summary",
        first.json?.data?.[0]?.changes === null,
        JSON.stringify(first.json?.data?.[0]?.changes),
      );

      // The debounce. A PATCH that re-sends the graph it already stored must not
      // version — the canvas does exactly this before every run.
      const unchanged = await api(
        "PATCH",
        `/api/workflows/${vId}`,
        { graph: created.json.data.graph },
        token,
      );
      check(
        "re-saving an identical graph does NOT create a version",
        unchanged.json?.data?.version === 1,
        `version ${unchanged.json?.data?.version}`,
      );

      // The same graph with every object key in a different order. `jsonb` normalises
      // key order on the way back out, so a byte comparison would version this.
      const reordered = {
        edges: [{ sourceHandle: null, target: "note", source: "start", id: "e1" }],
        nodes: [
          { config: {}, position: { y: 0, x: 0 }, type: "core.manual_trigger", id: "start" },
          { config: { message: "one" }, position: { y: 0, x: 240 }, type: "core.log", id: "note" },
        ],
        version: 1,
      };
      const keyOrder = await api("PATCH", `/api/workflows/${vId}`, { graph: reordered }, token);
      check(
        "re-saving with reordered JSON keys does NOT create a version",
        keyOrder.json?.data?.version === 1,
        `version ${keyOrder.json?.data?.version}`,
      );

      // A real edit: change one config value, add a node, add an edge.
      const editedGraph = {
        version: 1,
        nodes: [
          { id: "start", type: "core.manual_trigger", position: { x: 0, y: 0 }, config: {} },
          { id: "note", type: "core.log", position: { x: 240, y: 0 }, config: { message: "two" } },
          { id: "note_2", type: "core.log", position: { x: 480, y: 0 }, config: { message: "added" } },
        ],
        edges: [
          { id: "e1", source: "start", target: "note", sourceHandle: null },
          { id: "e2", source: "note", target: "note_2", sourceHandle: null },
        ],
      };
      const edited = await api("PATCH", `/api/workflows/${vId}`, { graph: editedGraph }, token);
      check(
        "an actual edit bumps the version",
        edited.json?.data?.version === 2,
        `version ${edited.json?.data?.version}`,
      );

      // A move only. Substance unchanged, position changed.
      const movedGraph = structuredClone(editedGraph);
      movedGraph.nodes[2].position = { x: 480, y: 160 };
      const moved = await api("PATCH", `/api/workflows/${vId}`, { graph: movedGraph }, token);
      check("moving a node is a version too", moved.json?.data?.version === 3);

      // A rename with no graph change.
      const renamed = await api(
        "PATCH",
        `/api/workflows/${vId}`,
        { name: "Phase 18 versioning, renamed" },
        token,
      );
      check("renaming the workflow is a version", renamed.json?.data?.version === 4);

      const history = await api("GET", `/api/workflows/${vId}/versions`, undefined, token);
      const rows = history.json?.data ?? [];
      check(
        "the history is newest first and holds every version",
        rows.length === 4 && rows.map((r) => r.number).join(",") === "4,3,2,1",
        rows.map((r) => r.number).join(","),
      );
      check(
        "exactly one version is marked current, and it is the newest",
        rows.filter((r) => r.current).length === 1 && rows[0].current === true,
      );

      const v2 = rows.find((r) => r.number === 2);
      check(
        "v2 reports what it changed: one node added, one changed, one edge added",
        v2?.changes?.added === 1 && v2?.changes?.changed === 1 && v2?.changes?.edgesAdded === 1,
        JSON.stringify(v2?.changes),
      );
      const v3 = rows.find((r) => r.number === 3);
      check(
        "v3 reports a move, and NOT a change — substance and position are different facts",
        v3?.changes?.moved === 1 && v3?.changes?.changed === 0 && v3?.changes?.added === 0,
        JSON.stringify(v3?.changes),
      );
      const v4 = rows.find((r) => r.number === 4);
      check(
        "a rename-only version reports no graph changes but a different name",
        v4?.changes?.any === false && v4?.name === "Phase 18 versioning, renamed",
        `${JSON.stringify(v4?.changes)} / ${v4?.name}`,
      );

      const one = await api("GET", `/api/workflows/${vId}/versions/1`, undefined, token);
      check(
        "one version can be read back with its graph",
        one.status === 200 && one.json?.data?.graph?.nodes?.length === 2,
        JSON.stringify(one.json?.data?.graph?.nodes?.length),
      );
      const missing = await api("GET", `/api/workflows/${vId}/versions/99`, undefined, token);
      check("a version that does not exist is a 404", missing.status === 404);
      const nonsense = await api("GET", `/api/workflows/${vId}/versions/abc`, undefined, token);
      check(
        "a non-numeric version is a 404, not a coerced query",
        nonsense.status === 404,
        `${nonsense.status} ${JSON.stringify(nonsense.json).slice(0, 160)}`,
      );

      const compare = await api(
        "GET",
        `/api/workflows/${vId}/versions/compare?from=1&to=4`,
        undefined,
        token,
      );
      check(
        "compare returns both graphs and the diff between them",
        compare.status === 200 &&
          compare.json?.data?.from?.graph?.nodes?.length === 2 &&
          compare.json?.data?.to?.graph?.nodes?.length === 3 &&
          compare.json?.data?.diff?.summary?.added === 1,
        JSON.stringify(compare.json?.data?.diff?.summary),
      );
      check(
        "`to` defaults to the current version",
        (await api("GET", `/api/workflows/${vId}/versions/compare?from=1`, undefined, token)).json
          ?.data?.to?.number === 4,
      );
      const badCompare = await api(
        "GET",
        `/api/workflows/${vId}/versions/compare?from=nope`,
        undefined,
        token,
      );
      check("compare rejects a non-numeric version with a 400", badCompare.status === 400);

      const labelled = await api(
        "PATCH",
        `/api/workflows/${vId}/versions/2`,
        { label: "  Before the rewrite  " },
        token,
      );
      check(
        "a version can be named, and the name is trimmed",
        labelled.json?.data?.label === "Before the rewrite",
        JSON.stringify(labelled.json?.data?.label),
      );
      const cleared = await api(
        "PATCH",
        `/api/workflows/${vId}/versions/2`,
        { label: null },
        token,
      );
      check("a name can be cleared", cleared.json?.data?.label === null);

      // A run records the version it executed.
      const ran = await api("POST", `/api/workflows/${vId}/runs`, { input: {} }, token);
      check(
        "a run records the workflow version it executed",
        ran.json?.data?.workflowVersion === 4,
        `recorded v${ran.json?.data?.workflowVersion}, workflow is at v4`,
      );

      // Restore: forward, never backward.
      const restored = await api(
        "POST",
        `/api/workflows/${vId}/versions/1/restore`,
        undefined,
        token,
      );
      check(
        "restoring writes a NEW version rather than rewinding the number",
        restored.json?.data?.version === 5,
        `version ${restored.json?.data?.version}`,
      );
      check(
        "the restored workflow has v1's graph and v1's name back",
        restored.json?.data?.graph?.nodes?.length === 2 &&
          restored.json?.data?.name === "Phase 18 versioning",
        `${restored.json?.data?.graph?.nodes?.length} nodes / ${restored.json?.data?.name}`,
      );

      const afterRestore = await api("GET", `/api/workflows/${vId}/versions`, undefined, token);
      const restoredRows = afterRestore.json?.data ?? [];
      check(
        "nothing between was deleted — all five versions are still there",
        restoredRows.length === 5 &&
          restoredRows.map((r) => r.number).join(",") === "5,4,3,2,1",
        restoredRows.map((r) => r.number).join(","),
      );
      check(
        "the restore is labelled, which is also what exempts it from the retention cap",
        restoredRows[0]?.label === "Restored from v1",
        JSON.stringify(restoredRows[0]?.label),
      );

      // The earlier run still points at the version it actually ran, not at the
      // current one. This is the whole reason restore moves forward.
      const priorRun = await api("GET", `/api/runs/${ran.json?.data?.id}`, undefined, token);
      check(
        "a run made before the restore still reports the version it really executed",
        priorRun.json?.data?.workflowVersion === 4,
        `v${priorRun.json?.data?.workflowVersion}`,
      );

      // Owner scoping: a version is not reachable without a session.
      const anonymous = await api("GET", `/api/workflows/${vId}/versions`, undefined, undefined);
      check("version history requires a session", anonymous.status === 401);

      const [{ n: versionRows }] = await sql.query(
        'select count(*)::int as n from "workflow_version" where "workflowId" = $1',
        [vId],
      );
      check("the history is really five rows in Postgres", versionRows === 5, `${versionRows}`);

      const [{ bytes }] = await sql.query(
        'select coalesce(sum(pg_column_size(graph)), 0)::int as bytes from "workflow_version" where "workflowId" = $1',
        [vId],
      );
      console.log(`      storage: ${versionRows} versions of this graph = ${bytes} stored bytes`);
    } finally {
      if (vId) await api("DELETE", `/api/workflows/${vId}`, undefined, token);
    }

    const [{ n: orphans }] = await sql.query(
      'select count(*)::int as n from "workflow_version" wv left join "workflow" w on w."id" = wv."workflowId" where w."id" is null',
    );
    check("deleting a workflow cascades to its versions", orphans === 0, `${orphans} orphaned`);
  }

  // --- workspace isolation (Phase 19A) --------------------------------------
  //
  // **The checks this phase exists for.** Everything above proves a signed-in user can
  // drive their own workspace; none of it proves another workspace cannot. So this
  // creates a genuine second tenant — a second `user` row, a second `workspace`, and a
  // real session for them — and asserts that every route answers as though the first
  // workspace's resources simply do not exist.
  //
  // A second *account* rather than a second *cookie*: the scoping is resolved from
  // membership on the server, so anything less than a real user with a real membership
  // would be testing the test rather than the product.
  //
  // The probe user's id is fixed and sorts last on purpose. This script selects its
  // main user with `order by id limit 1`, and a probe left behind by an interrupted run
  // must never become the user a later run drives.
  const PROBE_USER_ID = "zzzz-workspace-isolation-probe";
  const probeToken = crypto.randomUUID() + crypto.randomUUID();
  let probeWorkspaceId = null;
  let probeWorkflowId = null;

  try {
    await cleanUpProbe(PROBE_USER_ID);

    await sql.query('insert into "user" ("id", "name", "email") values ($1, $2, $3)', [
      PROBE_USER_ID,
      "Isolation Probe",
      "workspace-isolation-probe@agentforge.invalid",
    ]);
    const [probeWorkspace] = await sql.query(
      'insert into "workspace" ("id", "name", "createdBy", "personal") values (gen_random_uuid()::text, $1, $2, true) returning "id"',
      ["Probe workspace", PROBE_USER_ID],
    );
    probeWorkspaceId = probeWorkspace.id;
    await sql.query(
      'insert into "workspace_member" ("workspaceId", "userId", "role") values ($1, $2, $3)',
      [probeWorkspaceId, PROBE_USER_ID, "owner"],
    );
    await sql.query(
      'insert into "session" ("sessionToken", "userId", "expires") values ($1, $2, $3)',
      [probeToken, PROBE_USER_ID, new Date(Date.now() + 60 * 60 * 1000)],
    );

    // The probe is a real, working tenant — otherwise every 404 below would pass for
    // the wrong reason, namely a session that does not work at all.
    const probeList = await api("GET", "/api/workflows", undefined, probeToken);
    check(
      "the second workspace's session works and its list is its own",
      probeList.status === 200 && Array.isArray(probeList.json?.data),
      `got ${probeList.status}`,
    );
    check(
      "the second workspace cannot see the first's workflow in its list",
      !(probeList.json?.data ?? []).some((w) => w.id === workflowId),
      "the first workspace's workflow appeared in the second's list",
    );

    const [aRun] = await sql.query(
      'select "id" from "run" where "workflowId" = $1 order by "startedAt" desc limit 1',
      [workflowId],
    );

    // Every route that takes an id, asked for a resource in the other workspace. 404
    // and not 403 throughout: the reply must not confirm that the id exists (D20).
    const crossTenant = [
      ["read a workflow", "GET", `/api/workflows/${workflowId}`, undefined],
      ["edit a workflow", "PATCH", `/api/workflows/${workflowId}`, { name: "hijacked" }],
      ["delete a workflow", "DELETE", `/api/workflows/${workflowId}`, undefined],
      ["trigger a run", "POST", `/api/workflows/${workflowId}/runs`, {}],
      ["list its runs", "GET", `/api/workflows/${workflowId}/runs`, undefined],
      ["list its versions", "GET", `/api/workflows/${workflowId}/versions`, undefined],
      ["read one of its versions", "GET", `/api/workflows/${workflowId}/versions/1`, undefined],
      ["label one of its versions", "PATCH", `/api/workflows/${workflowId}/versions/1`, { label: "x" }],
      ["restore one of its versions", "POST", `/api/workflows/${workflowId}/versions/1/restore`, {}],
      ["compare its versions", "GET", `/api/workflows/${workflowId}/versions/compare?from=1&to=2`, undefined],
      ["open its run stream", "GET", `/api/workflows/${workflowId}/stream`, undefined],
      ...(aRun ? [
        ["read its run", "GET", `/api/runs/${aRun.id}`, undefined],
        ["cancel its run", "POST", `/api/runs/${aRun.id}/cancel`, {}],
      ] : []),
    ];

    for (const [what, method, path, body] of crossTenant) {
      const response = await api(method, path, body, probeToken);
      check(
        `another workspace cannot ${what}`,
        response.status === 404,
        `got ${response.status} ${JSON.stringify(response.json).slice(0, 160)}`,
      );
    }

    // The edit and delete above must have answered 404 *and* done nothing. A route that
    // wrote first and refused afterwards would pass every check above this one.
    const [stillThere] = await sql.query(
      'select "name" from "workflow" where "id" = $1',
      [workflowId],
    );
    check(
      "the refused edit and delete changed nothing",
      stillThere !== undefined && stillThere.name !== "hijacked",
      stillThere ? `name is now ${stillThere.name}` : "the workflow was deleted",
    );

    const probeRuns = await api("GET", "/api/runs", undefined, probeToken);
    check(
      "another workspace's run list is empty of the first's runs",
      !(probeRuns.json?.data ?? []).some((run) => run.workflowId === workflowId),
      "a run from the first workspace appeared in the second's list",
    );

    // Credentials are the sharpest case: they are workspace-scoped now, so the *only*
    // thing keeping one tenant's Google connection away from another is this filter.
    const probeDiscord = await api("GET", "/api/integrations/discord", undefined, probeToken);
    check(
      "another workspace sees no Discord credential",
      probeDiscord.status === 200 && probeDiscord.json?.data?.configured === false,
      JSON.stringify(probeDiscord.json).slice(0, 160),
    );

    const probeGoogle = await api("GET", "/api/integrations/google", undefined, probeToken);
    check(
      "another workspace sees no Google connection",
      probeGoogle.status === 200 && probeGoogle.json?.data?.connected === false,
      JSON.stringify(probeGoogle.json).slice(0, 160),
    );

    const probeProvider = await api("GET", "/api/settings/provider", undefined, probeToken);
    check(
      "another workspace sees no stored provider key",
      probeProvider.status === 200 && probeProvider.json?.data?.configured === false,
      JSON.stringify(probeProvider.json).slice(0, 160),
    );

    // The reverse direction, which is the half a one-way test would miss.
    const probeCreated = await api(
      "POST",
      "/api/workflows",
      { name: "Probe workspace workflow" },
      probeToken,
    );
    check("the second workspace can create its own workflow", probeCreated.status === 201);
    probeWorkflowId = probeCreated.json?.data?.id ?? null;

    if (probeWorkflowId) {
      const [row] = await sql.query('select "workspaceId" from "workflow" where "id" = $1', [
        probeWorkflowId,
      ]);
      check(
        "a new workflow is stamped with the creator's workspace",
        row?.workspaceId === probeWorkspaceId,
        `${row?.workspaceId} !== ${probeWorkspaceId}`,
      );

      const firstSees = await api("GET", `/api/workflows/${probeWorkflowId}`, undefined, token);
      check("the first workspace cannot read the second's workflow", firstSees.status === 404);
    }
  } finally {
    await cleanUpProbe(PROBE_USER_ID);
    await sql.query('delete from "session" where "sessionToken" = $1', [probeToken]).catch(() => {});
  }

  // --- membership: invitations, roles and the switcher (Phase 19B) -----------
  //
  // **The checks this phase exists for**, and they need two real accounts rather than two
  // cookies: the role is resolved from a membership row on the server, so anything less
  // than a second `user` with a second session would be testing the test.
  //
  // The probe's id sorts last for the same reason the isolation probe's does — this
  // script picks its main user with `order by id limit 1`, and a probe left behind by an
  // interrupted run must never become the account a later run drives.
  const MEMBER_USER_ID = "zzzz-membership-probe";
  const MEMBER_EMAIL = "membership-probe@agentforge.invalid";
  const memberToken = crypto.randomUUID() + crypto.randomUUID();
  let memberWorkspaceId = null;
  let createdWorkspaceId = null;

  try {
    await cleanUpProbe(MEMBER_USER_ID);
    await sql.query('delete from "workspace_invitation" where "email" like $1', ["%@agentforge.invalid"]);

    const [homeWorkspace] = await sql.query(
      `select w."id", w."name" from "workspace" w
       join "workspace_member" m on m."workspaceId" = w."id"
       where m."userId" = $1 and m."role" = 'owner' and w."personal" limit 1`,
      [user.id],
    );
    check("the main account owns a personal workspace to invite into", Boolean(homeWorkspace));

    await sql.query('insert into "user" ("id", "name", "email") values ($1, $2, $3)', [
      MEMBER_USER_ID,
      "Membership Probe",
      MEMBER_EMAIL,
    ]);
    const [memberHome] = await sql.query(
      'insert into "workspace" ("id", "name", "createdBy", "personal") values (gen_random_uuid()::text, $1, $2, true) returning "id"',
      ["Membership probe workspace", MEMBER_USER_ID],
    );
    memberWorkspaceId = memberHome.id;
    await sql.query(
      'insert into "workspace_member" ("workspaceId", "userId", "role") values ($1, $2, $3)',
      [memberWorkspaceId, MEMBER_USER_ID, "owner"],
    );
    await sql.query(
      'insert into "session" ("sessionToken", "userId", "expires") values ($1, $2, $3)',
      [memberToken, MEMBER_USER_ID, new Date(Date.now() + 60 * 60 * 1000)],
    );

    // --- the switcher's list ------------------------------------------------
    const myWorkspaces = await api("GET", "/api/workspaces", undefined, token);
    check(
      "the switcher lists this account's workspaces",
      myWorkspaces.status === 200 &&
        (myWorkspaces.json?.data ?? []).some((w) => w.id === homeWorkspace.id),
      JSON.stringify(myWorkspaces.json).slice(0, 200),
    );
    check(
      "the switcher's list carries no user ids",
      !JSON.stringify(myWorkspaces.json).includes("createdBy"),
      "createdBy reached the client",
    );

    const foreignSwitch = await api(
      "POST",
      "/api/workspaces/active",
      { workspaceId: memberWorkspaceId },
      token,
    );
    check(
      "switching to a workspace you are not in answers 404, not 403",
      foreignSwitch.status === 404,
      `got ${foreignSwitch.status}`,
    );

    // --- issuing an invitation ----------------------------------------------
    const invited = await api(
      "POST",
      `/api/workspaces/${homeWorkspace.id}/invitations`,
      { email: `  ${MEMBER_EMAIL.toUpperCase()}  `, role: "viewer" },
      token,
    );
    check("an owner can invite an address", invited.status === 201, JSON.stringify(invited.json).slice(0, 200));
    const inviteUrl = invited.json?.data?.url ?? "";
    const inviteToken = inviteUrl.split("/invite/")[1] ?? "";
    check("the response carries one link, once", inviteToken.length >= 32, inviteUrl);
    check(
      "the invited address is normalised before it is stored",
      invited.json?.data?.invitation?.email === MEMBER_EMAIL,
      invited.json?.data?.invitation?.email,
    );

    // **The property hashing exists for.** If the token itself is anywhere in the row,
    // a database leak hands over live invitations.
    const [stored] = await sql.query(
      'select "id", "tokenHash", "role", "expiresAt" from "workspace_invitation" where "email" = $1',
      [MEMBER_EMAIL],
    );
    check(
      "only a sha256 hash of the token is stored",
      stored?.tokenHash === createHash("sha256").update(inviteToken).digest("hex"),
      `stored ${stored?.tokenHash?.slice(0, 16)}…`,
    );
    check(
      "the token itself appears in no column of the row",
      !JSON.stringify(stored).includes(inviteToken),
      "the plaintext token is in the database",
    );
    check(
      "the invitation expires in about seven days",
      Math.abs(new Date(stored.expiresAt).getTime() - (Date.now() + 7 * 864e5)) < 5 * 60_000,
      String(stored?.expiresAt),
    );

    const listed = await api("GET", `/api/workspaces/${homeWorkspace.id}/invitations`, undefined, token);
    check(
      "the invitation is listed as live, with no token",
      listed.status === 200 &&
        listed.json.data.some((i) => i.email === MEMBER_EMAIL && i.state === "live") &&
        !JSON.stringify(listed.json).includes("tokenHash"),
      JSON.stringify(listed.json).slice(0, 200),
    );

    // --- the unauthenticated preview ----------------------------------------
    const preview = await api("GET", `/api/invitations/${inviteToken}`);
    check(
      "a link holder with no session learns the workspace and the role",
      preview.status === 200 &&
        preview.json?.data?.workspace === homeWorkspace.name &&
        preview.json?.data?.role === "viewer",
      JSON.stringify(preview.json).slice(0, 200),
    );
    check(
      "the preview leaks nothing else — no address, no id, no members",
      !/email|@|"id"|member/i.test(JSON.stringify(preview.json)),
      JSON.stringify(preview.json),
    );

    // Every wrong token answers identically, so the endpoint cannot sort real tokens from
    // invented ones.
    const wrongShape = await api("GET", "/api/invitations/short");
    const wrongToken = await api("GET", `/api/invitations/${"A".repeat(43)}`);
    check("a malformed token answers 404", wrongShape.status === 404);
    check("a well-formed but unknown token answers 404", wrongToken.status === 404);
    check(
      "both wrong tokens answer with the same message as each other",
      wrongShape.json?.error?.message === wrongToken.json?.error?.message,
      `${wrongShape.json?.error?.message} vs ${wrongToken.json?.error?.message}`,
    );

    const previewPage = await page(`/invite/${inviteToken}`);
    check(
      "the invite page renders for a signed-out holder and names the workspace",
      previewPage.status === 200 && previewPage.html.includes(homeWorkspace.name),
      `got ${previewPage.status}`,
    );
    const deadPage = await page(`/invite/${"B".repeat(43)}`);
    check(
      "the invite page refuses an unknown link",
      deadPage.status === 200 && deadPage.html.includes("not valid"),
      `got ${deadPage.status}`,
    );
    check(
      "and tells a signed-out holder nothing about any workspace",
      !deadPage.html.includes(homeWorkspace.name),
      "a workspace name appeared on the page for an invalid token",
    );

    // --- accepting -----------------------------------------------------------
    //
    // The wrong account first. The main user holds the link but is not who it was sent
    // to, which is the whole reason possession of a token is not enough.
    //
    // The count is read before and after rather than asserted to be 1: a workspace that
    // already has other members is a legitimate state, and a check that only passes on a
    // pristine database is a check that will be disabled the first time it is wrong.
    const [{ n: membersBeforeRefusal }] = await sql.query(
      'select count(*)::int as n from "workspace_member" where "workspaceId" = $1',
      [homeWorkspace.id],
    );
    const wrongAccount = await api("POST", `/api/invitations/${inviteToken}/accept`, {}, token);
    check(
      "the wrong signed-in account cannot accept, even holding the link",
      wrongAccount.status === 403 && wrongAccount.json?.error?.code === "forbidden",
      `got ${wrongAccount.status} ${JSON.stringify(wrongAccount.json).slice(0, 160)}`,
    );
    const [{ n: membersAfterRefusal }] = await sql.query(
      'select count(*)::int as n from "workspace_member" where "workspaceId" = $1',
      [homeWorkspace.id],
    );
    check(
      "the refused accept created no membership",
      membersAfterRefusal === membersBeforeRefusal,
      `${membersBeforeRefusal} → ${membersAfterRefusal} members`,
    );

    const anonymousAccept = await api("POST", `/api/invitations/${inviteToken}/accept`, {});
    check("accepting with no session is rejected", anonymousAccept.status === 401);

    const accepted = await api("POST", `/api/invitations/${inviteToken}/accept`, {}, memberToken);
    check(
      "the invited account accepts and lands in the workspace",
      accepted.status === 200 && accepted.json?.data?.id === homeWorkspace.id,
      JSON.stringify(accepted.json).slice(0, 200),
    );
    check(
      "accepting sets the active-workspace cookie",
      accepted.setCookie.some((c) => c.startsWith("af_workspace=") && c.includes("HttpOnly")),
      accepted.setCookie.join(" | "),
    );
    const [membership] = await sql.query(
      'select "role" from "workspace_member" where "workspaceId" = $1 and "userId" = $2',
      [homeWorkspace.id, MEMBER_USER_ID],
    );
    check(
      "the membership was written with the role the invitation carried",
      membership?.role === "viewer",
      `role is ${membership?.role}`,
    );

    const secondUse = await api("POST", `/api/invitations/${inviteToken}/accept`, {}, memberToken);
    check(
      "the link is single use — a second accept is refused",
      secondUse.status === 409,
      `got ${secondUse.status} ${JSON.stringify(secondUse.json).slice(0, 160)}`,
    );

    // --- what a viewer can and cannot do ------------------------------------
    //
    // Every one of these is the same account, in the same workspace, with the same
    // session. The only thing deciding the answer is the role — which is what Phase 19A
    // wrote and did not enforce.
    const sharedList = await api("GET", "/api/workflows", undefined, memberToken, homeWorkspace.id);
    check(
      "a viewer SEES the workspace's workflows — sharing actually works",
      sharedList.status === 200 && sharedList.json.data.some((w) => w.id === workflowId),
      JSON.stringify(sharedList.json).slice(0, 200),
    );

    const [{ name: nameBefore }] = await sql.query('select "name" from "workflow" where "id" = $1', [workflowId]);
    const runsBefore = await sql.query('select count(*)::int as n from "run" where "workflowId" = $1', [workflowId]);

    const refusals = [
      ["create a workflow", "POST", "/api/workflows", { name: "viewer made this" }],
      ["edit a workflow", "PATCH", `/api/workflows/${workflowId}`, { name: "viewer renamed this" }],
      ["delete a workflow", "DELETE", `/api/workflows/${workflowId}`, undefined],
      ["run a workflow", "POST", `/api/workflows/${workflowId}/runs`, { input: null, mode: "sync" }],
      ["generate a workflow", "POST", "/api/workflows/generate", { prompt: "do something" }],
      [
        "ask the copilot for a change",
        "POST",
        `/api/workflows/${workflowId}/copilot`,
        { instruction: "do something", graph: { version: 1, nodes: [], edges: [] } },
      ],
      [
        "ask the copilot to explain a workflow",
        "POST",
        `/api/workflows/${workflowId}/copilot`,
        { kind: "explain", graph: { version: 1, nodes: [], edges: [] } },
      ],
      [
        "ask the copilot why a run failed",
        "POST",
        `/api/workflows/${workflowId}/copilot`,
        { kind: "diagnose", runId: "00000000-0000-4000-8000-000000000000", graph: { version: 1, nodes: [], edges: [] } },
      ],
      ["label a version", "PATCH", `/api/workflows/${workflowId}/versions/1`, { label: "viewer" }],
      ["restore a version", "POST", `/api/workflows/${workflowId}/versions/1/restore`, {}],
      ["store a provider key", "PUT", "/api/settings/provider", { apiKey: "AIzaNotARealKey" }],
      ["delete the provider key", "DELETE", "/api/settings/provider", undefined],
      ["list provider models", "GET", "/api/settings/provider/models", undefined],
      ["store a Discord webhook", "PUT", "/api/integrations/discord", { webhookUrl: "https://discord.com/api/webhooks/1/x" }],
      ["disconnect Discord", "DELETE", "/api/integrations/discord", undefined],
      ["disconnect Google", "DELETE", "/api/integrations/google", undefined],
      ["rename the workspace", "PATCH", `/api/workspaces/${homeWorkspace.id}`, { name: "viewer renamed it" }],
      ["invite somebody", "POST", `/api/workspaces/${homeWorkspace.id}/invitations`, { email: "eve@agentforge.invalid" }],
      ["list the invitations", "GET", `/api/workspaces/${homeWorkspace.id}/invitations`, undefined],
      ["remove another member", "DELETE", `/api/workspaces/${homeWorkspace.id}/members/${user.id}`, undefined],
    ];

    for (const [what, method, path, body] of refusals) {
      const response = await api(method, path, body, memberToken, homeWorkspace.id);
      check(
        `a viewer cannot ${what}`,
        response.status === 403 && response.json?.error?.code === "forbidden",
        `got ${response.status} ${JSON.stringify(response.json).slice(0, 140)}`,
      );
    }

    // Every refusal above must have refused *before* writing. A route that wrote and then
    // checked would pass all seventeen.
    const [{ name: nameAfter }] = await sql.query('select "name" from "workflow" where "id" = $1', [workflowId]);
    const runsAfter = await sql.query('select count(*)::int as n from "run" where "workflowId" = $1', [workflowId]);
    check("nothing a viewer was refused changed the workflow", nameAfter === nameBefore, `${nameBefore} → ${nameAfter}`);
    check("nothing a viewer was refused started a run", runsAfter[0].n === runsBefore[0].n);
    const [{ n: viewerWorkflows }] = await sql.query(
      'select count(*)::int as n from "workflow" where "name" like $1',
      ["viewer%"],
    );
    check("no workflow was created by a refused request", viewerWorkflows === 0, `${viewerWorkflows} exist`);

    const viewerReads = [
      ["read a workflow", `/api/workflows/${workflowId}`],
      ["list its runs", `/api/workflows/${workflowId}/runs`],
      ["list its versions", `/api/workflows/${workflowId}/versions`],
      ["read the provider status", "/api/settings/provider"],
      ["read the members list", `/api/workspaces/${homeWorkspace.id}/members`],
    ];
    for (const [what, path] of viewerReads) {
      const response = await api("GET", path, undefined, memberToken, homeWorkspace.id);
      check(`a viewer can still ${what}`, response.status === 200, `got ${response.status}`);
    }

    const members = await api("GET", `/api/workspaces/${homeWorkspace.id}/members`, undefined, memberToken, homeWorkspace.id);
    check(
      "the members list names both accounts and marks which one is you",
      members.json.data.some((m) => m.userId === user.id && m.role === "owner" && !m.you) &&
        members.json.data.some((m) => m.userId === MEMBER_USER_ID && m.role === "viewer" && m.you) &&
        members.json.data.filter((m) => m.you).length === 1,
      JSON.stringify(members.json).slice(0, 300),
    );

    // **The credential consequence, asserted rather than only documented.** A member of a
    // workspace can use its stored credentials — which is why the settings page says so.
    const viewerProvider = await api("GET", "/api/settings/provider", undefined, memberToken, homeWorkspace.id);
    check(
      "a member sees that the workspace has a provider key configured",
      viewerProvider.status === 200 && viewerProvider.json?.data?.configured === true,
      JSON.stringify(viewerProvider.json).slice(0, 160),
    );
    check(
      "and still cannot read any part of it",
      !/AIza|apiKey|ciphertext/.test(JSON.stringify(viewerProvider.json)),
      JSON.stringify(viewerProvider.json).slice(0, 200),
    );

    // --- the cookie is a preference, never a permission ---------------------
    const forged = await api("GET", "/api/workflows", undefined, memberToken, "not-a-real-workspace-id");
    check(
      "a cookie naming a workspace that does not exist falls back, it does not fail",
      forged.status === 200 && !forged.json.data.some((w) => w.id === workflowId),
      JSON.stringify(forged.json).slice(0, 160),
    );
    const stolen = await api("GET", "/api/workflows", undefined, token, memberWorkspaceId);
    check(
      "a cookie naming somebody else's workspace is ignored, not honoured",
      stolen.status === 200 && stolen.json.data.some((w) => w.id === workflowId),
      "the main account was scoped to a workspace it is not a member of",
    );

    // --- revoked and expired ------------------------------------------------
    const doomed = await api(
      "POST",
      `/api/workspaces/${homeWorkspace.id}/invitations`,
      { email: "revoked@agentforge.invalid", role: "editor" },
      token,
    );
    const doomedToken = (doomed.json?.data?.url ?? "").split("/invite/")[1] ?? "";
    const revoked = await api(
      "DELETE",
      `/api/workspaces/${homeWorkspace.id}/invitations/${doomed.json?.data?.invitation?.id}`,
      undefined,
      token,
    );
    check("an invitation can be revoked", revoked.status === 200 && revoked.json?.data?.state === "revoked");
    const revokedPreview = await api("GET", `/api/invitations/${doomedToken}`);
    check("a revoked link previews as invalid", revokedPreview.status === 404);
    // **The property the four identical 404s exist for**, asserted on the page rather
    // than only on the API: a revoked link and a token that never existed must render the
    // same screen. Compared with the token itself masked, because Next embeds the route's
    // own parameters in the flight payload.
    const mask = (html, tok) => html.replaceAll(tok, "TOKEN");
    const revokedPage = await page(`/invite/${doomedToken}`);
    const unknownPage = await page(`/invite/${"C".repeat(43)}`);
    check(
      "a revoked link and an invented one render the identical page",
      mask(revokedPage.html, doomedToken) === mask(unknownPage.html, "C".repeat(43)),
      "the page distinguishes a revoked invitation from a nonexistent one",
    );

    const revokedAccept = await api("POST", `/api/invitations/${doomedToken}/accept`, {}, memberToken);
    check(
      "a revoked link cannot be accepted, and says so rather than reporting the wrong email",
      revokedAccept.status === 409 && /revoked/i.test(revokedAccept.json?.error?.message ?? ""),
      `got ${revokedAccept.status} ${JSON.stringify(revokedAccept.json).slice(0, 160)}`,
    );
    const revokeAgain = await api(
      "DELETE",
      `/api/workspaces/${homeWorkspace.id}/invitations/${doomed.json?.data?.invitation?.id}`,
      undefined,
      token,
    );
    check("revoking twice answers 404 rather than pretending to work", revokeAgain.status === 404);

    // Expiry cannot be waited out, so the row is written expired. The state machine is
    // read from the columns, so this is the same code path a week-old link takes.
    const expiredToken = "e".repeat(43);
    // `id` is supplied explicitly: the column's default lives in application code
    // (`$defaultFn`), not in the database, so a direct insert has to mint one.
    await sql.query(
      `insert into "workspace_invitation" ("id", "workspaceId", "email", "role", "tokenHash", "expiresAt")
       values (gen_random_uuid()::text, $1, $2, 'editor', $3, now() - interval '1 day')`,
      [homeWorkspace.id, "expired@agentforge.invalid", createHash("sha256").update(expiredToken).digest("hex")],
    );
    const expiredPreview = await api("GET", `/api/invitations/${expiredToken}`);
    check("an expired link previews as invalid", expiredPreview.status === 404);
    const expiredAccept = await api("POST", `/api/invitations/${expiredToken}/accept`, {}, memberToken);
    check(
      "an expired link cannot be accepted",
      expiredAccept.status === 409 && /expired/i.test(expiredAccept.json?.error?.message ?? ""),
      `got ${expiredAccept.status} ${JSON.stringify(expiredAccept.json).slice(0, 160)}`,
    );

    // Re-inviting rotates the token rather than making a second live invitation.
    const first = await api("POST", `/api/workspaces/${homeWorkspace.id}/invitations`, { email: "again@agentforge.invalid" }, token);
    const second = await api("POST", `/api/workspaces/${homeWorkspace.id}/invitations`, { email: "again@agentforge.invalid", role: "viewer" }, token);
    check("re-inviting the same address succeeds", second.status === 201);
    check(
      "re-inviting rotates the token",
      second.json?.data?.url !== first.json?.data?.url,
      "the same link came back twice",
    );
    check(
      "re-inviting updates the one row rather than adding another",
      second.json?.data?.invitation?.id === first.json?.data?.invitation?.id &&
        second.json?.data?.invitation?.role === "viewer",
      `${first.json?.data?.invitation?.id} vs ${second.json?.data?.invitation?.id}`,
    );
    const deadLink = (first.json?.data?.url ?? "").split("/invite/")[1] ?? "";
    check("the previous link stops working", (await api("GET", `/api/invitations/${deadLink}`)).status === 404);
    const [{ n: liveForAddress }] = await sql.query(
      `select count(*)::int as n from "workspace_invitation"
       where "email" = $1 and "acceptedAt" is null and "revokedAt" is null`,
      ["again@agentforge.invalid"],
    );
    check("there is exactly one live invitation per address", liveForAddress === 1, `${liveForAddress} live`);

    const alreadyIn = await api(
      "POST",
      `/api/workspaces/${homeWorkspace.id}/invitations`,
      { email: MEMBER_EMAIL },
      token,
    );
    check(
      "inviting somebody who is already a member is refused",
      alreadyIn.status === 409,
      `got ${alreadyIn.status}`,
    );

    const badAddress = await api(
      "POST",
      `/api/workspaces/${homeWorkspace.id}/invitations`,
      { email: "not-an-address" },
      token,
    );
    check("an address that is not one is refused", badAddress.status === 400);
    const asOwner = await api(
      "POST",
      `/api/workspaces/${homeWorkspace.id}/invitations`,
      { email: "owner@agentforge.invalid", role: "owner" },
      token,
    );
    check("an invitation cannot hand out ownership", asOwner.status === 400, `got ${asOwner.status}`);

    // --- renaming, and a second workspace -----------------------------------
    const renamed = await api("PATCH", `/api/workspaces/${homeWorkspace.id}`, { name: "Renamed by verify" }, token);
    check("an owner can rename the workspace", renamed.status === 200 && renamed.json?.data?.name === "Renamed by verify");
    await api("PATCH", `/api/workspaces/${homeWorkspace.id}`, { name: homeWorkspace.name }, token);

    const created = await api("POST", "/api/workspaces", { name: "Verify probe workspace" }, token);
    check("a new workspace can be created", created.status === 201 && created.json?.data?.role === "owner");
    createdWorkspaceId = created.json?.data?.id ?? null;
    check(
      "creating a workspace switches to it",
      created.setCookie.some((c) => c.startsWith(`af_workspace=${createdWorkspaceId}`)),
      created.setCookie.join(" | "),
    );
    check(
      "a new workspace is not personal",
      created.json?.data?.personal === false,
      JSON.stringify(created.json?.data),
    );

    if (createdWorkspaceId) {
      const emptyList = await api("GET", "/api/workflows", undefined, token, createdWorkspaceId);
      check(
        "a new workspace starts empty",
        emptyList.status === 200 && emptyList.json.data.length === 0,
        `${emptyList.json?.data?.length} workflows`,
      );
      const noKey = await api("GET", "/api/settings/provider", undefined, token, createdWorkspaceId);
      check(
        "a new workspace has none of the other workspace's credentials",
        noKey.status === 200 && noKey.json?.data?.configured === false,
        JSON.stringify(noKey.json).slice(0, 160),
      );
      const stillThere = await api("GET", "/api/settings/provider", undefined, token, homeWorkspace.id);
      check(
        "and switching back finds the key again",
        stillThere.json?.data?.configured === true,
        "the credential did not survive a switch",
      );
    }

    // --- removal, leaving, and the last owner -------------------------------
    const lastOwner = await api(
      "DELETE",
      `/api/workspaces/${homeWorkspace.id}/members/${user.id}`,
      undefined,
      token,
      homeWorkspace.id,
    );
    check(
      "the only owner cannot leave — the workspace would be unadministrable",
      lastOwner.status === 409,
      `got ${lastOwner.status} ${JSON.stringify(lastOwner.json).slice(0, 160)}`,
    );

    const removed = await api(
      "DELETE",
      `/api/workspaces/${homeWorkspace.id}/members/${MEMBER_USER_ID}`,
      undefined,
      token,
      homeWorkspace.id,
    );
    check("an owner can remove a member", removed.status === 200, `got ${removed.status}`);

    // **The test the whole cookie design rests on.** The removed account's cookie still
    // names the workspace it was removed from.
    const afterRemoval = await api("GET", "/api/workflows", undefined, memberToken, homeWorkspace.id);
    check(
      "a removed member's cookie stops working immediately",
      afterRemoval.status === 200 && !afterRemoval.json.data.some((w) => w.id === workflowId),
      "a removed member still read the workspace's workflows",
    );
    const afterRemovalRead = await api("GET", `/api/workflows/${workflowId}`, undefined, memberToken, homeWorkspace.id);
    check("and its workflows answer 404 again", afterRemovalRead.status === 404, `got ${afterRemovalRead.status}`);
  } finally {
    if (createdWorkspaceId) {
      await sql.query('delete from "workspace" where "id" = $1', [createdWorkspaceId]).catch(() => {});
    }
    await sql.query('delete from "workspace_invitation" where "email" like $1', ["%@agentforge.invalid"]).catch(() => {});
    await sql.query('delete from "workspace_member" where "userId" = $1', [MEMBER_USER_ID]).catch(() => {});
    await cleanUpProbe(MEMBER_USER_ID);
    await sql.query('delete from "session" where "sessionToken" = $1', [memberToken]).catch(() => {});
  }

  // --- roles, permissions and sharing (Phase 20) ------------------------------
  //
  // **The matrix `BUILD_PLAN.md` Phase 20 asks for: every role against every action,
  // asserted at the API and not at the UI.**
  //
  // It runs in a **workspace created for it and deleted afterwards**, which is what makes it
  // able to be exhaustive. The allowed half of a permission matrix is destructive by nature —
  // it deletes workflows, stores credentials and renames the workspace — and pointing that at
  // the account's real workspace would mean either skipping those rows or damaging live data.
  // In a throwaway workspace with one throwaway workflow, nothing in it is precious.
  //
  // The probe account's role is moved by direct SQL rather than through the new PATCH route.
  // That is deliberate: a role is a database fact, and driving the matrix through the very
  // route the matrix is testing would make one bug able to hide another. The PATCH route gets
  // its own checks below, against the same rules.
  const MATRIX_USER_ID = "zzzz-matrix-probe";
  const MATRIX_EMAIL = "matrix-probe@agentforge.invalid";
  const matrixToken = crypto.randomUUID() + crypto.randomUUID();
  let arena = null;
  let arenaWorkflowId = null;

  try {
    await cleanUpProbe(MATRIX_USER_ID);

    await sql.query('insert into "user" ("id", "name", "email") values ($1, $2, $3)', [
      MATRIX_USER_ID,
      "Matrix Probe",
      MATRIX_EMAIL,
    ]);
    await sql.query(
      'insert into "session" ("sessionToken", "userId", "expires") values ($1, $2, $3)',
      [matrixToken, MATRIX_USER_ID, new Date(Date.now() + 60 * 60 * 1000)],
    );
    // The probe needs a personal workspace of its own, because every fallback in the
    // product resolves one — and because removing it from the arena must leave it somewhere.
    const [matrixHome] = await sql.query(
      'insert into "workspace" ("id", "name", "createdBy", "personal") values (gen_random_uuid()::text, $1, $2, true) returning "id"',
      ["Matrix probe home", MATRIX_USER_ID],
    );
    await sql.query(
      'insert into "workspace_member" ("workspaceId", "userId", "role") values ($1, $2, $3)',
      [matrixHome.id, MATRIX_USER_ID, "owner"],
    );

    const arenaCreated = await api("POST", "/api/workspaces", { name: "zzzz matrix arena" }, token);
    arena = arenaCreated.json?.data?.id ?? null;
    check("a throwaway workspace exists to run the matrix in", arena !== null, JSON.stringify(arenaCreated.json).slice(0, 200));
    await sql.query(
      'insert into "workspace_member" ("workspaceId", "userId", "role") values ($1, $2, $3)',
      [arena, MATRIX_USER_ID, "viewer"],
    );

    /** A trivial graph: a manual trigger into a log. It runs in milliseconds and calls nothing. */
    const cheapGraph = {
      version: 1,
      nodes: [
        { id: "trigger", type: "core.manual_trigger", position: { x: 0, y: 0 }, config: {} },
        { id: "say", type: "core.log", position: { x: 240, y: 0 }, config: { message: "matrix", level: "info" } },
      ],
      edges: [{ id: "e1", source: "trigger", target: "say", sourceHandle: null }],
    };

    const makeArenaWorkflowAs = async (as, name) => {
      const created = await api("POST", "/api/workflows", { name, graph: cheapGraph }, as, arena);
      return created.json?.data?.id ?? null;
    };
    const makeArenaWorkflow = (name) => makeArenaWorkflowAs(token, name);

    arenaWorkflowId = await makeArenaWorkflow("zzzz matrix subject");
    check("the matrix has a workflow to aim at", arenaWorkflowId !== null);

    // Phase 37 (D177): a failure reaches the inboxes of the members who may see the workflow — and
    // no one else (D101). The probe is a viewer here: told about a shared workflow's failure, never
    // about a private one's, which its owner and the workspace's admins still hear about.
    {
      const failingHook = (name) => ({
        name,
        graph: {
          version: 1,
          nodes: [
            { id: "trigger", type: "core.webhook_trigger", position: { x: 0, y: 0 }, config: {} },
            {
              id: "guard",
              type: "core.assert",
              position: { x: 240, y: 0 },
              config: { left: "{{input.missing}}", operator: "is_not_empty", message: "PHASE37 visibility" },
            },
          ],
          edges: [{ id: "e1", source: "trigger", target: "guard", sourceHandle: null }],
        },
      });
      const shared = (await api("POST", "/api/workflows", failingHook("zzzz matrix shared failure"), token, arena)).json?.data;
      const hidden = (await api("POST", "/api/workflows", failingHook("zzzz matrix private failure"), token, arena)).json?.data;
      await api("PATCH", `/api/workflows/${hidden?.id}`, { visibility: "private" }, token, arena);
      for (const row of [shared, hidden]) {
        await fetch(`${base}/api/webhook/${(row?.webhookUrl ?? "").split("/api/webhook/")[1] ?? "none"}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
      }
      const probeInbox = (await api("GET", "/api/inbox", undefined, matrixToken, arena)).json?.data?.entries ?? [];
      const ownerInbox = (await api("GET", "/api/inbox", undefined, token, arena)).json?.data?.entries ?? [];
      check(
        "a viewer is told about a shared workflow's failure, and not a private one's",
        probeInbox.some((e) => e.workflowId === shared?.id) && !probeInbox.some((e) => e.workflowId === hidden?.id),
        JSON.stringify(probeInbox.map((e) => e.workflowName)),
      );
      check(
        "its owner is told about both",
        ownerInbox.some((e) => e.workflowId === shared?.id) && ownerInbox.some((e) => e.workflowId === hidden?.id),
        JSON.stringify(ownerInbox.map((e) => e.workflowName)),
      );
      for (const row of [shared, hidden]) await api("DELETE", `/api/workflows/${row?.id}`, undefined, token, arena);
      check(
        "an entry goes with its workflow",
        !((await api("GET", "/api/inbox", undefined, matrixToken, arena)).json?.data?.entries ?? []).some((e) => e.workflowId === shared?.id),
      );
    }
    // Phase 38: who may decide an approval. With nobody named, a viewer may not; named, a viewer
    // may; and a request on a private workflow reaches nobody who cannot see it (D101), named or not.
    if (secure) {
      const asking = (name, approvers) => ({
        name,
        graph: {
          version: 1,
          nodes: [
            { id: "trigger", type: "core.manual_trigger", position: { x: 0, y: 0 }, config: {} },
            { id: "approve", type: "core.approval", position: { x: 240, y: 0 }, config: { message: name, ...(approvers ? { approvers } : {}) } },
          ],
          edges: [{ id: "e1", source: "trigger", target: "approve", sourceHandle: null }],
        },
      });
      const unnamed = (await api("POST", "/api/workflows", asking("zzzz matrix approval, nobody named"), token, arena)).json?.data;
      const naming = (await api("POST", "/api/workflows", asking("zzzz matrix approval naming the viewer", MATRIX_EMAIL), token, arena)).json?.data;
      const hiddenAsk = (await api("POST", "/api/workflows", asking("zzzz matrix approval, private", MATRIX_EMAIL), token, arena)).json?.data;
      await api("PATCH", `/api/workflows/${hiddenAsk?.id}`, { visibility: "private" }, token, arena);
      const askedOf = async (row) =>
        ((await api("POST", `/api/workflows/${row?.id}/runs`, { input: {} }, token, arena)).json?.data?.steps ?? [])
          .find((step) => step.nodeId === "approve")?.output?.approvalId ?? "missing";
      const ids = { unnamed: await askedOf(unnamed), naming: await askedOf(naming), hidden: await askedOf(hiddenAsk) };

      const probeView = (await api("GET", `/api/approvals/${ids.unnamed}`, undefined, matrixToken, arena)).json?.data;
      check("a viewer may read a request with nobody named, and is told they cannot decide it",
        probeView?.open === true && probeView?.canDecide === false, JSON.stringify(probeView ?? null).slice(0, 200));
      check("and deciding it is refused 403",
        (await api("POST", `/api/approvals/${ids.unnamed}`, { decision: "approve" }, matrixToken, arena)).status === 403);
      const probeBox = (await api("GET", "/api/inbox", undefined, matrixToken, arena)).json?.data?.approvals ?? [];
      check("a viewer's inbox holds the request naming them — not the unnamed one, nor the private one",
        probeBox.some((a) => a.id === ids.naming) && !probeBox.some((a) => a.id === ids.unnamed) && !probeBox.some((a) => a.id === ids.hidden),
        JSON.stringify(probeBox.map((a) => a.workflowName)));
      check("a request on a private workflow the viewer cannot see is a 404 to them, though it names them",
        (await api("GET", `/api/approvals/${ids.hidden}`, undefined, matrixToken, arena)).status === 404);
      const ownerBox = (await api("GET", "/api/inbox", undefined, token, arena)).json?.data?.approvals ?? [];
      check("the owner's inbox holds the unnamed request, and not the one naming somebody else",
        ownerBox.some((a) => a.id === ids.unnamed) && !ownerBox.some((a) => a.id === ids.naming),
        JSON.stringify(ownerBox.map((a) => a.workflowName)));
      const viewerDecides = await api("POST", `/api/approvals/${ids.naming}`, { decision: "approve", comment: "the viewer says yes" }, matrixToken, arena);
      check("named, a viewer decides", viewerDecides.status === 200 && viewerDecides.json?.data?.status === "approved",
        JSON.stringify(viewerDecides.json).slice(0, 200));
      for (const row of [unnamed, naming, hiddenAsk]) await api("DELETE", `/api/workflows/${row?.id}`, undefined, token, arena);
    }
    // Phase 33: a run to read a step of, re-run and retry — made by the owner, before the counts.
    const arenaRunId =
      (await api("POST", `/api/workflows/${arenaWorkflowId}/runs`, { input: null, mode: "sync" }, token, arena)).json?.data?.id ??
      "missing";
    // Phase 32: a tag to rename, assign and delete, and an export to import.
    const arenaTagId = (await api("POST", "/api/tags", { name: "zzzz matrix tag" }, token, arena)).json?.data?.id ?? "missing";
    const matrixEnvelope = {
      format: "agentforge/workflow",
      version: 1,
      workflow: { name: "zzzz matrix imported", description: null, graph: cheapGraph },
    };

    /**
     * **The matrix itself.** Each row is an action and the minimum role `CONTRACT.md` →
     * *What each role may do* says it needs. `destructive` marks a row that consumes the
     * workflow it is aimed at, so the allowed half re-creates one first.
     */
    const ROLES = ["viewer", "editor", "admin", "owner"];
    const rank = (role) => ROLES.indexOf(role);

    const actions = (wfId) => [
      // viewer — reads
      ["read a workflow", "GET", `/api/workflows/${wfId}`, undefined, "viewer"],
      ["list the workspace's workflows", "GET", "/api/workflows", undefined, "viewer"],
      ["list a workflow's runs", "GET", `/api/workflows/${wfId}/runs`, undefined, "viewer"],
      ["list every run", "GET", "/api/runs", undefined, "viewer"],
      ["list a workflow's versions", "GET", `/api/workflows/${wfId}/versions`, undefined, "viewer"],
      ["read one version", "GET", `/api/workflows/${wfId}/versions/1`, undefined, "viewer"],
      ["read the provider status", "GET", "/api/settings/provider", undefined, "viewer"],
      ["read the Discord status", "GET", "/api/integrations/discord", undefined, "viewer"],
      ["read the Google status", "GET", "/api/integrations/google", undefined, "viewer"],
      ["read the members list", "GET", `/api/workspaces/${arena}/members`, undefined, "viewer"],
      ["list this account's workspaces", "GET", "/api/workspaces", undefined, "viewer"],
      // Phase 32 — a star is the asker's own, and an export is a read of what they can open.
      ["list the workspace's tags", "GET", "/api/tags", undefined, "viewer"],
      ["star a workflow", "PUT", `/api/workflows/${wfId}/star`, undefined, "viewer"],
      ["unstar a workflow", "DELETE", `/api/workflows/${wfId}/star`, undefined, "viewer"],
      ["export a workflow", "GET", `/api/workflows/${wfId}/export`, undefined, "viewer"],
      // Phase 33 — a run's history is a read; starting one from it is starting a run.
      ["list runs a page at a time", "GET", `/api/runs?limit=5&status=succeeded`, undefined, "viewer"],
      ["read one step of a run", "GET", `/api/runs/${arenaRunId}/steps/0`, undefined, "viewer"],
      // Phase 37 — the inbox is every member's own; reading it is not a change to the workspace.
      ["read the inbox", "GET", "/api/inbox", undefined, "viewer"],
      ["mark the inbox read", "POST", "/api/inbox/read", { all: true }, "viewer"],

      // editor — writes inside the workspace
      ["create a workflow", "POST", "/api/workflows", { name: "zzzz matrix created" }, "editor"],
      ["edit a workflow", "PATCH", `/api/workflows/${wfId}`, { description: "matrix" }, "editor"],
      ["run a workflow", "POST", `/api/workflows/${wfId}/runs`, { input: null, mode: "sync" }, "editor"],
      ["re-run a run", "POST", `/api/runs/${arenaRunId}/rerun`, { mode: "sync" }, "editor"],
      // A succeeded run answers 409 at the bar — "not 403" is the assertion (Pass B).
      ["retry a run", "POST", `/api/runs/${arenaRunId}/retry`, { mode: "sync" }, "editor"],
      ["label a version", "PATCH", `/api/workflows/${wfId}/versions/1`, { label: "matrix" }, "editor"],
      ["restore a version", "POST", `/api/workflows/${wfId}/versions/1/restore`, {}, "editor"],
      ["delete a workflow", "DELETE", `/api/workflows/${wfId}`, undefined, "editor", "destructive"],
      // Phase 32 — the library's writes. "delete a tag" is last: it consumes the arena's tag.
      ["create a tag", "POST", "/api/tags", { name: "zzzz matrix created tag" }, "editor"],
      ["rename a tag", "PATCH", `/api/tags/${arenaTagId}`, { name: "zzzz matrix renamed tag" }, "editor"],
      ["tag a workflow", "PUT", `/api/workflows/${wfId}/tags`, { tagIds: [arenaTagId] }, "editor"],
      ["duplicate a workflow", "POST", `/api/workflows/${wfId}/duplicate`, undefined, "editor"],
      ["import a workflow", "POST", "/api/workflows/import", matrixEnvelope, "editor"],
      ["delete a tag", "DELETE", `/api/tags/${arenaTagId}`, undefined, "editor"],

      // admin — credentials, the workspace itself, and publishing
      ["store a provider key", "PUT", "/api/settings/provider", { apiKey: "AIzaNotARealKeyAtAll123" }, "admin"],
      ["delete the provider key", "DELETE", "/api/settings/provider", undefined, "admin"],
      ["list provider models", "GET", "/api/settings/provider/models", undefined, "admin"],
      ["store a Discord webhook", "PUT", "/api/integrations/discord", { webhookUrl: "https://discord.com/api/webhooks/1/matrix" }, "admin"],
      ["disconnect Discord", "DELETE", "/api/integrations/discord", undefined, "admin"],
      ["disconnect Google", "DELETE", "/api/integrations/google", undefined, "admin"],
      ["rename the workspace", "PATCH", `/api/workspaces/${arena}`, { name: "zzzz matrix arena" }, "admin"],
      ["list the invitations", "GET", `/api/workspaces/${arena}/invitations`, undefined, "admin"],
      ["invite somebody", "POST", `/api/workspaces/${arena}/invitations`, { email: "matrix-invitee@agentforge.invalid", role: "viewer" }, "admin"],
      ["publish a public share link", "POST", `/api/workflows/${wfId}/share`, undefined, "admin"],
      ["revoke a public share link", "DELETE", `/api/workflows/${wfId}/share`, undefined, "admin"],
    ];

    /**
     * **Pass A — the refusal half, run for every role below each action's minimum.**
     *
     * This is the security-relevant half and it is exhaustive: every cell of the lower
     * triangle. Nothing in it mutates anything, because every call is expected to be
     * refused — which is also what the row counts below prove rather than assume.
     */
    const [{ n: wfBefore }] = await sql.query(
      'select count(*)::int as n from "workflow" where "workspaceId" = $1',
      [arena],
    );
    const [{ n: runsBefore }] = await sql.query(
      'select count(*)::int as n from "run" where "workspaceId" = $1',
      [arena],
    );
    const [{ n: credsBefore }] = await sql.query(
      'select count(*)::int as n from "credential" where "workspaceId" = $1',
      [arena],
    );
    const tagsIn = async () =>
      (await sql.query(
        'select (select count(*)::int from "tag" where "workspaceId" = $1) + (select count(*)::int from "workflow_tag" wt join "workflow" w on w."id" = wt."workflowId" where w."workspaceId" = $1) as n',
        [arena],
      ))[0].n;
    const tagsBefore = await tagsIn();

    let refusals = 0;
    let wrongRefusals = [];
    for (const role of ROLES) {
      await sql.query(
        'update "workspace_member" set "role" = $1 where "workspaceId" = $2 and "userId" = $3',
        [role, arena, MATRIX_USER_ID],
      );
      for (const [what, method, path, body, needs] of actions(arenaWorkflowId)) {
        if (rank(role) >= rank(needs)) continue;
        const response = await api(method, path, body, matrixToken, arena);
        refusals += 1;
        if (response.status !== 403 || response.json?.error?.code !== "forbidden") {
          wrongRefusals.push(`${role} → ${what}: got ${response.status} ${JSON.stringify(response.json).slice(0, 90)}`);
        }
      }
    }
    check(
      `every role below the bar is refused — ${refusals} cells of the matrix`,
      wrongRefusals.length === 0,
      wrongRefusals.slice(0, 6).join("\n        "),
    );
    // **The refusals refused BEFORE writing.** A route that wrote and then checked would
    // pass every assertion above.
    const [{ n: wfAfter }] = await sql.query(
      'select count(*)::int as n from "workflow" where "workspaceId" = $1',
      [arena],
    );
    const [{ n: runsAfter }] = await sql.query(
      'select count(*)::int as n from "run" where "workspaceId" = $1',
      [arena],
    );
    const [{ n: credsAfter }] = await sql.query(
      'select count(*)::int as n from "credential" where "workspaceId" = $1',
      [arena],
    );
    const tagsAfter = await tagsIn();
    check(
      "not one refused request changed a row",
      wfAfter === wfBefore && runsAfter === runsBefore && credsAfter === credsBefore && tagsAfter === tagsBefore,
      `workflows ${wfBefore}→${wfAfter}, runs ${runsBefore}→${runsAfter}, credentials ${credsBefore}→${credsAfter}, tags ${tagsBefore}→${tagsAfter}`,
    );
    // **"A viewer refused (403 naming the role)"** — Phase 32's own validation step: the refusal
    // says which role the act needs, so a viewer is told why rather than only that.
    await sql.query(
      'update "workspace_member" set "role" = $1 where "workspaceId" = $2 and "userId" = $3',
      ["viewer", arena, MATRIX_USER_ID],
    );
    const viewerDuplicate = await api("POST", `/api/workflows/${arenaWorkflowId}/duplicate`, undefined, matrixToken, arena);
    check(
      "a viewer refused a library write is told which role it needs",
      viewerDuplicate.status === 403 && /needs the editor role/.test(viewerDuplicate.json?.error?.message ?? ""),
      `got ${viewerDuplicate.status}: ${viewerDuplicate.json?.error?.message}`,
    );

    /**
     * **Pass B — the allowed half, run at exactly the minimum role for each action.**
     *
     * At the boundary, because that is where the interesting failure is: a rule written one
     * rung too high refuses the role the matrix says may do it, and nothing above the
     * boundary would reveal that. "Not 403" is the assertion rather than "200" on purpose —
     * `list provider models` with a fake key answers 400, `disconnect Google` with nothing
     * connected answers 404, and a generation can answer 429. None of those is a refusal,
     * and demanding 200 would turn this into a test of the provider's uptime.
     */
    let denied = [];
    let allowed = 0;
    for (const role of ROLES) {
      await sql.query(
        'update "workspace_member" set "role" = $1 where "workspaceId" = $2 and "userId" = $3',
        [role, arena, MATRIX_USER_ID],
      );
      let subject = arenaWorkflowId;
      for (const [what, method, path, body, needs, destructive] of actions(subject)) {
        if (needs !== role) continue;
        // A destructive row gets its own workflow, so the rows after it still have one.
        const target = destructive ? await makeArenaWorkflow("zzzz matrix victim") : subject;
        const response = await api(
          method,
          destructive ? path.replace(subject, target) : path,
          body,
          matrixToken,
          arena,
        );
        allowed += 1;
        if (response.status === 403) {
          denied.push(`${role} → ${what}: ${JSON.stringify(response.json).slice(0, 90)}`);
        }
      }
    }
    check(
      `every role at the bar is allowed — ${allowed} cells of the matrix`,
      denied.length === 0,
      denied.slice(0, 6).join("\n        "),
    );

    // --- changing a role, through the route (Phase 20's own) ------------------
    await sql.query(
      'update "workspace_member" set "role" = $1 where "workspaceId" = $2 and "userId" = $3',
      ["viewer", arena, MATRIX_USER_ID],
    );
    const promote = await api(
      "PATCH",
      `/api/workspaces/${arena}/members/${MATRIX_USER_ID}`,
      { role: "editor" },
      token,
      arena,
    );
    check(
      "an owner can promote a viewer to editor",
      promote.status === 200 && promote.json?.data?.role === "editor",
      `got ${promote.status} ${JSON.stringify(promote.json).slice(0, 160)}`,
    );
    const [promoted] = await sql.query(
      'select "role" from "workspace_member" where "workspaceId" = $1 and "userId" = $2',
      [arena, MATRIX_USER_ID],
    );
    check("the promotion is in the database, not only in the response", promoted?.role === "editor");

    // **The promotion takes effect on the very next request** — the role is read per
    // request from the membership row, so there is no session to re-mint and no cache to
    // wait out. This is the check that proves it.
    const nowAllowed = await api(
      "PATCH",
      `/api/workflows/${arenaWorkflowId}`,
      { description: "written as an editor" },
      matrixToken,
      arena,
    );
    check(
      "a promoted member can immediately do what the new role carries",
      nowAllowed.status === 200,
      `got ${nowAllowed.status} ${JSON.stringify(nowAllowed.json).slice(0, 140)}`,
    );

    const demote = await api(
      "PATCH",
      `/api/workspaces/${arena}/members/${MATRIX_USER_ID}`,
      { role: "viewer" },
      token,
      arena,
    );
    check("and can be demoted again", demote.status === 200 && demote.json?.data?.role === "viewer");
    const nowRefused = await api(
      "PATCH",
      `/api/workflows/${arenaWorkflowId}`,
      { description: "written as a viewer" },
      matrixToken,
      arena,
    );
    check(
      "a demoted member loses it on the next request",
      nowRefused.status === 403,
      `got ${nowRefused.status}`,
    );
    const [{ description: afterDemotion }] = await sql.query(
      'select "description" from "workflow" where "id" = $1',
      [arenaWorkflowId],
    );
    check(
      "and the refused write changed nothing",
      afterDemotion === "written as an editor",
      `description is ${afterDemotion}`,
    );

    const notARole = await api(
      "PATCH",
      `/api/workspaces/${arena}/members/${MATRIX_USER_ID}`,
      { role: "root" },
      token,
      arena,
    );
    check("a role that is not a role is refused by the schema", notARole.status === 400, `got ${notARole.status}`);

    const sameRole = await api(
      "PATCH",
      `/api/workspaces/${arena}/members/${MATRIX_USER_ID}`,
      { role: "viewer" },
      token,
      arena,
    );
    check(
      "changing a member to the role they already hold is a conflict, not a silent no-op",
      sameRole.status === 409,
      `got ${sameRole.status} ${JSON.stringify(sameRole.json).slice(0, 140)}`,
    );

    // The owner-only half of the rule, from both directions. An admin who could grant
    // ownership would be an owner with extra steps.
    await sql.query(
      'update "workspace_member" set "role" = $1 where "workspaceId" = $2 and "userId" = $3',
      ["admin", arena, MATRIX_USER_ID],
    );
    const adminGrantsOwner = await api(
      "PATCH",
      `/api/workspaces/${arena}/members/${MATRIX_USER_ID}`,
      { role: "owner" },
      matrixToken,
      arena,
    );
    check(
      "an admin cannot promote anybody — including itself — to owner",
      adminGrantsOwner.status === 403,
      `got ${adminGrantsOwner.status} ${JSON.stringify(adminGrantsOwner.json).slice(0, 140)}`,
    );
    const adminDemotesOwner = await api(
      "PATCH",
      `/api/workspaces/${arena}/members/${user.id}`,
      { role: "viewer" },
      matrixToken,
      arena,
    );
    check(
      "an admin cannot demote an owner",
      adminDemotesOwner.status === 403,
      `got ${adminDemotesOwner.status} ${JSON.stringify(adminDemotesOwner.json).slice(0, 140)}`,
    );
    const [{ role: ownerStill }] = await sql.query(
      'select "role" from "workspace_member" where "workspaceId" = $1 and "userId" = $2',
      [arena, user.id],
    );
    check("and the owner is still the owner", ownerStill === "owner", `role is ${ownerStill}`);

    const lastOwnerDemotion = await api(
      "PATCH",
      `/api/workspaces/${arena}/members/${user.id}`,
      { role: "admin" },
      token,
      arena,
    );
    check(
      "the only owner cannot be demoted — the workspace would be unadministrable",
      lastOwnerDemotion.status === 409,
      `got ${lastOwnerDemotion.status} ${JSON.stringify(lastOwnerDemotion.json).slice(0, 160)}`,
    );

    // The handover: promote a second owner, then the first may step down.
    const grantOwner = await api(
      "PATCH",
      `/api/workspaces/${arena}/members/${MATRIX_USER_ID}`,
      { role: "owner" },
      token,
      arena,
    );
    check("an owner can grant ownership", grantOwner.status === 200 && grantOwner.json?.data?.role === "owner");
    const stepDown = await api(
      "PATCH",
      `/api/workspaces/${arena}/members/${user.id}`,
      { role: "admin" },
      token,
      arena,
    );
    check(
      "and can then step down, which is the intended handover",
      stepDown.status === 200,
      `got ${stepDown.status} ${JSON.stringify(stepDown.json).slice(0, 160)}`,
    );
    // Put it back so the rest of this block runs as an owner.
    await sql.query(
      'update "workspace_member" set "role" = $1 where "workspaceId" = $2 and "userId" = $3',
      ["owner", arena, user.id],
    );
    await sql.query(
      'update "workspace_member" set "role" = $1 where "workspaceId" = $2 and "userId" = $3',
      ["viewer", arena, MATRIX_USER_ID],
    );

    const strangerRole = await api(
      "PATCH",
      `/api/workspaces/${arena}/members/zzzz-not-a-member`,
      { role: "editor" },
      token,
      arena,
    );
    check("changing the role of somebody not in the workspace is a 404", strangerRole.status === 404);

    // --- per-workflow visibility ---------------------------------------------
    //
    // The workflow is owned by the main account, so `private` hides it from the probe at
    // `viewer` and `editor` and shows it at `admin` and `owner` — the decision
    // `lib/workflow/visibility.ts` argues for at length.
    const madePrivate = await api(
      "PATCH",
      `/api/workflows/${arenaWorkflowId}`,
      { visibility: "private" },
      token,
      arena,
    );
    check(
      "the creator can make a workflow private",
      madePrivate.status === 200 && madePrivate.json?.data?.visibility === "private",
      `got ${madePrivate.status} ${JSON.stringify(madePrivate.json).slice(0, 160)}`,
    );

    // Start a run of it, so the run-visibility checks have something to look for. The run
    // is by the creator, which is the case that matters: a colleague must not reach it.
    const privateRun = await api(
      "POST",
      `/api/workflows/${arenaWorkflowId}/runs`,
      { input: null, mode: "sync" },
      token,
      arena,
    );
    const privateRunId = privateRun.json?.data?.id ?? null;
    check("a private workflow still runs for its creator", privateRun.status === 201 || privateRun.status === 200, `got ${privateRun.status}`);

    for (const role of ["viewer", "editor"]) {
      await sql.query(
        'update "workspace_member" set "role" = $1 where "workspaceId" = $2 and "userId" = $3',
        [role, arena, MATRIX_USER_ID],
      );
      const read = await api("GET", `/api/workflows/${arenaWorkflowId}`, undefined, matrixToken, arena);
      check(
        `a ${role} gets 404 on a colleague's private workflow, not 403`,
        read.status === 404,
        `got ${read.status} — 403 would confirm the id exists, which is the fact private hides`,
      );
      const list = await api("GET", "/api/workflows", undefined, matrixToken, arena);
      check(
        `a ${role} does not see it in the list either`,
        list.status === 200 && !list.json.data.some((w) => w.id === arenaWorkflowId),
        JSON.stringify(list.json).slice(0, 160),
      );
      // **The check the run join exists for.** A run is addressed by its own id and does not
      // go through `getWorkflow`, so without the join a viewer would read the steps, inputs
      // and outputs of a workflow they cannot open.
      if (privateRunId) {
        const run = await api("GET", `/api/runs/${privateRunId}`, undefined, matrixToken, arena);
        check(
          `a ${role} cannot read a run of it by run id`,
          run.status === 404,
          `got ${run.status} — the run carries the private workflow's steps`,
        );
      }
      const runs = await api("GET", "/api/runs", undefined, matrixToken, arena);
      check(
        `and it is absent from the workspace's run list for a ${role}`,
        runs.status === 200 && !runs.json.data.some((r) => r.workflowId === arenaWorkflowId),
        JSON.stringify(runs.json).slice(0, 160),
      );
      // Phase 33 — every new way to reach a run goes through the same join (D101).
      if (privateRunId) {
        const filtered = await api("GET", `/api/runs?workflowId=${arenaWorkflowId}`, undefined, matrixToken, arena);
        check(`a ${role} filtering the run list by it gets nothing`, filtered.status === 200 && filtered.json?.data?.length === 0);
        const stepOf = await api("GET", `/api/runs/${privateRunId}/steps/0`, undefined, matrixToken, arena);
        check(`a ${role} cannot read a step of its run`, stepOf.status === 404, `got ${stepOf.status}`);
        // Both with the arena active and from another workspace: in the second case the page
        // offers to switch workspaces only for what the switch would show (D101) — until Phase 33
        // a private workflow's link answered "This workflow is in …" to a colleague.
        for (const active of [arena, null]) {
          const shown = await fetch(`${base}/runs/${privateRunId}`, {
            redirect: "manual",
            headers: { cookie: [`${cookieName}=${matrixToken}`, ...(active ? [`af_workspace=${active}`] : [])].join("; ") },
          });
          check(
            `a ${role} gets the 404 page for its run's page${active ? "" : " from another workspace"}`,
            shown.status === 404,
            `got ${shown.status}`,
          );
        }
        const canvasElsewhere = await page(`/workflows/${arenaWorkflowId}`, matrixToken);
        check(
          `a ${role} opening it from another workspace is not told it exists there`,
          canvasElsewhere.status === 404,
          `got ${canvasElsewhere.status}`,
        );
        if (role === "editor") {
          const rerunIt = await api("POST", `/api/runs/${privateRunId}/rerun`, {}, matrixToken, arena);
          check("an editor cannot re-run a run of it — 404, not 403", rerunIt.status === 404, `got ${rerunIt.status}`);
        }
      }
      const versions = await api("GET", `/api/workflows/${arenaWorkflowId}/versions`, undefined, matrixToken, arena);
      check(`a ${role} cannot read its version history`, versions.status === 404, `got ${versions.status}`);
      const stream = await api("GET", `/api/workflows/${arenaWorkflowId}/stream`, undefined, matrixToken, arena);
      check(`a ${role} cannot open its stream`, stream.status === 404, `got ${stream.status}`);
    }

    for (const role of ["admin", "owner"]) {
      await sql.query(
        'update "workspace_member" set "role" = $1 where "workspaceId" = $2 and "userId" = $3',
        [role, arena, MATRIX_USER_ID],
      );
      const read = await api("GET", `/api/workflows/${arenaWorkflowId}`, undefined, matrixToken, arena);
      check(
        `an ${role} CAN see a private workflow — it runs with the workspace's credentials`,
        read.status === 200,
        `got ${read.status}`,
      );
      if (privateRunId) {
        const run = await api("GET", `/api/runs/${privateRunId}`, undefined, matrixToken, arena);
        check(`an ${role} can read its runs`, run.status === 200, `got ${run.status}`);
      }
    }

    // Who may flip it. An editor may edit everything else about a workflow and may not
    // change who sees it — otherwise they could hide a colleague's work from the people it
    // was shared with.
    await sql.query(
      'update "workspace_member" set "role" = $1 where "workspaceId" = $2 and "userId" = $3',
      ["editor", arena, MATRIX_USER_ID],
    );
    const editorsOwn = await makeArenaWorkflowAs(matrixToken, "zzzz matrix editor's own");
    check("an editor can create their own workflow", editorsOwn !== null);
    if (editorsOwn) {
      const ownPrivate = await api(
        "PATCH",
        `/api/workflows/${editorsOwn}`,
        { visibility: "private" },
        matrixToken,
        arena,
      );
      check(
        "an editor can make their OWN workflow private",
        ownPrivate.status === 200 && ownPrivate.json?.data?.visibility === "private",
        `got ${ownPrivate.status} ${JSON.stringify(ownPrivate.json).slice(0, 160)}`,
      );
      const foreignFlip = await api(
        "PATCH",
        `/api/workflows/${editorsOwn}`,
        { visibility: "workspace" },
        token,
        arena,
      );
      check(
        "an owner can flip somebody else's, because an admin is who you ask when the author has gone",
        foreignFlip.status === 200,
        `got ${foreignFlip.status}`,
      );
    }
    // And the reverse: an editor aimed at a workflow they can see but did not create.
    await api("PATCH", `/api/workflows/${arenaWorkflowId}`, { visibility: "workspace" }, token, arena);
    const editorFlipsOthers = await api(
      "PATCH",
      `/api/workflows/${arenaWorkflowId}`,
      { visibility: "private" },
      matrixToken,
      arena,
    );
    check(
      "an editor cannot change the visibility of a workflow they did not create",
      editorFlipsOthers.status === 403,
      `got ${editorFlipsOthers.status} ${JSON.stringify(editorFlipsOthers.json).slice(0, 160)}`,
    );
    const stillEditable = await api(
      "PATCH",
      `/api/workflows/${arenaWorkflowId}`,
      { description: "an editor may still edit it" },
      matrixToken,
      arena,
    );
    check(
      "and can still edit everything else about it — the refusal is scoped to visibility",
      stillEditable.status === 200,
      `got ${stillEditable.status}`,
    );
    const [{ visibility: unchanged }] = await sql.query(
      'select "visibility" from "workflow" where "id" = $1',
      [arenaWorkflowId],
    );
    check("the refused visibility change wrote nothing", unchanged === "workspace", `visibility is ${unchanged}`);

    // **A trigger reaches a private workflow, because visibility is about people.** The
    // webhook has no session and derives its scope from the row (`systemScope`).
    await api("PATCH", `/api/workflows/${arenaWorkflowId}`, { visibility: "private" }, token, arena);
    const [{ webhookToken: privateWebhook }] = await sql.query(
      'select "webhookToken" from "workflow" where "id" = $1',
      [arenaWorkflowId],
    );
    const privateGraph = {
      ...cheapGraph,
      nodes: [
        { id: "trigger", type: "core.webhook_trigger", position: { x: 0, y: 0 }, config: { requiredFields: [] } },
        cheapGraph.nodes[1],
      ],
    };
    await api("PATCH", `/api/workflows/${arenaWorkflowId}`, { graph: privateGraph }, token, arena);
    const hookFired = await api("POST", `/api/webhook/${privateWebhook}`, { any: "thing" });
    check(
      "a webhook still fires a private workflow — visibility governs people, not triggers",
      hookFired.status === 200 || hookFired.status === 201,
      `got ${hookFired.status} ${JSON.stringify(hookFired.json).slice(0, 160)}`,
    );
    await api("PATCH", `/api/workflows/${arenaWorkflowId}`, { graph: cheapGraph, visibility: "workspace" }, token, arena);

    // --- the public share link ------------------------------------------------
    const shared = await api("POST", `/api/workflows/${arenaWorkflowId}/share`, undefined, token, arena);
    check(
      "an admin can publish a share link, and the response is a 201 the first time",
      shared.status === 201 && typeof shared.json?.data?.shareUrl === "string",
      `got ${shared.status} ${JSON.stringify(shared.json).slice(0, 200)}`,
    );
    const shareLink = shared.json?.data?.shareUrl ?? "";
    const shareToken = shareLink.split("/s/")[1] ?? "";
    check("the link is a /s/ URL carrying a 32-character token", shareToken.length === 32, shareLink);

    const again = await api("POST", `/api/workflows/${arenaWorkflowId}/share`, undefined, token, arena);
    check(
      "sharing twice is idempotent — it does not rotate a URL somebody has already pasted somewhere",
      again.status === 200 && again.json?.data?.shareUrl === shareLink,
      `got ${again.status} ${again.json?.data?.shareUrl}`,
    );

    // **The response body is the whole point of this route.** Everything below is about
    // what a stranger holding the URL can and cannot read.
    const publicRead = await api("GET", `/api/share/${shareToken}`);
    check(
      "an unauthenticated request reads the shared graph",
      publicRead.status === 200 && typeof publicRead.json?.data?.name === "string",
      `got ${publicRead.status} ${JSON.stringify(publicRead.json).slice(0, 200)}`,
    );
    const publicBody = JSON.stringify(publicRead.json);
    check(
      "it carries the graph's shape — nodes and edges",
      Array.isArray(publicRead.json?.data?.graph?.nodes) &&
        publicRead.json.data.graph.nodes.length === 2 &&
        publicRead.json.data.graph.edges.length === 1,
      JSON.stringify(publicRead.json?.data?.graph).slice(0, 200),
    );
    check(
      "and carries NO token of any kind",
      !publicBody.includes(shareToken) && !publicBody.includes(privateWebhook),
      "a token reached an unauthenticated response",
    );
    check(
      "and no id — not the workflow's, not the workspace's, not the owner's",
      !publicBody.includes(arenaWorkflowId) &&
        !publicBody.includes(arena) &&
        !publicBody.includes(user.id),
      "an id reached an unauthenticated response",
    );
    check(
      "and nothing about the workspace or who is in it",
      !/workspace|member|@|ownerId|credential/i.test(publicBody),
      publicBody.slice(0, 300),
    );
    check(
      "and no run data — the graph is published, its history is not",
      !/"runs"|"steps"|"status"|startedAt/i.test(publicBody),
      publicBody.slice(0, 300),
    );
    // The redaction, end to end. The log node's `message` was authored, so it must be
    // withheld and named as withheld; its `level` is an enum, so it is published.
    const sharedLogNode = (publicRead.json?.data?.graph?.nodes ?? []).find((n) => n.type === "core.log");
    check(
      "an authored value is withheld and reported as withheld",
      sharedLogNode && !("message" in sharedLogNode.config) && sharedLogNode.redacted.includes("message"),
      JSON.stringify(sharedLogNode),
    );
    check(
      "a setting that cannot carry a secret is published",
      sharedLogNode?.config?.level === "info",
      JSON.stringify(sharedLogNode?.config),
    );
    // **The value, not the key.** The field NAME does appear — in `redacted`, which is the
    // whole point of that array: the reader is told a value was withheld. What must never
    // appear is what was in it. An earlier version of this check tested for `"message"` and
    // failed on the correct behaviour, which is a good demonstration of why "no secret
    // leaked" has to be asserted against the secret and not against its label.
    check(
      "the authored value itself appears nowhere in the response",
      !/"message"\s*:\s*"/.test(publicBody),
      publicBody.slice(0, 300),
    );

    // An HTTP node with a bearer token in a header, which is the case the allowlist exists
    // for. Published: the method and the header NAME. Withheld: the URL and the value.
    const secretGraph = {
      version: 1,
      nodes: [
        { id: "trigger", type: "core.manual_trigger", position: { x: 0, y: 0 }, config: {} },
        {
          id: "call",
          type: "integration.http",
          position: { x: 240, y: 0 },
          config: {
            method: "POST",
            url: "https://api.example.com/v1?api_key=MATRIXSECRET",
            headers: { authorization: "Bearer MATRIXSECRET" },
            body: JSON.stringify({ to: "person@example.com" }),
            timeoutMs: 15000,
            failOnError: true,
          },
        },
      ],
      edges: [{ id: "e1", source: "trigger", target: "call", sourceHandle: null }],
    };
    await api("PATCH", `/api/workflows/${arenaWorkflowId}`, { graph: secretGraph }, token, arena);
    const withSecret = await api("GET", `/api/share/${shareToken}`);
    const secretBody = JSON.stringify(withSecret.json);
    check(
      "a bearer token in a request header never reaches a share link",
      !secretBody.includes("MATRIXSECRET"),
      secretBody.slice(0, 300),
    );
    check(
      "nor does an email address in a request body",
      !secretBody.includes("person@example.com"),
      secretBody.slice(0, 300),
    );
    const httpNode = (withSecret.json?.data?.graph?.nodes ?? []).find((n) => n.type === "integration.http");
    check(
      "the header's NAME is published, so the reader can see that one is sent",
      httpNode?.config?.headers?.authorization === null,
      JSON.stringify(httpNode?.config),
    );
    check(
      "and the method is published while the url is not",
      httpNode?.config?.method === "POST" && !("url" in (httpNode?.config ?? {})),
      JSON.stringify(httpNode?.config),
    );

    // The page itself, not only the API. The reader is told that values are hidden.
    const sharePage = await page(`/s/${shareToken}`);
    check(
      "the /s/ page renders for a signed-out stranger",
      sharePage.status === 200,
      `got ${sharePage.status}`,
    );
    check(
      "the page leaks nothing the API refused",
      !sharePage.html.includes("MATRIXSECRET") &&
        !sharePage.html.includes("person@example.com") &&
        !sharePage.html.includes(arenaWorkflowId),
      "the rendered page carries something the API withheld",
    );
    check(
      "and it says out loud that values are withheld",
      /withheld/i.test(sharePage.html),
      "a reader could take the diagram for the whole picture",
    );
    check(
      "the page is noindex — the URL is the credential",
      /noindex/i.test(sharePage.html),
      "a share URL could be indexed",
    );

    // Every dead or malformed token answers identically, so the endpoint cannot be probed.
    const shortToken = await api("GET", "/api/share/short");
    const unknownToken = await api("GET", `/api/share/${"Z".repeat(32)}`);
    check("a malformed share token answers 404", shortToken.status === 404, `got ${shortToken.status}`);
    check("an unknown share token answers 404", unknownToken.status === 404, `got ${unknownToken.status}`);
    check(
      "both answer with the same message, so a real token cannot be sorted from an invented one",
      shortToken.json?.error?.message === unknownToken.json?.error?.message,
      `${shortToken.json?.error?.message} vs ${unknownToken.json?.error?.message}`,
    );

    const revoked = await api("DELETE", `/api/workflows/${arenaWorkflowId}/share`, undefined, token, arena);
    check(
      "an admin can revoke the link",
      revoked.status === 200 && revoked.json?.data?.shareUrl === null,
      `got ${revoked.status} ${JSON.stringify(revoked.json).slice(0, 160)}`,
    );
    const afterRevoke = await api("GET", `/api/share/${shareToken}`);
    check("the revoked link is dead immediately", afterRevoke.status === 404, `got ${afterRevoke.status}`);
    const revokedPage = await page(`/s/${shareToken}`);
    check("and its page 404s", revokedPage.status === 404, `got ${revokedPage.status}`);
    const revokeAgain = await api("DELETE", `/api/workflows/${arenaWorkflowId}/share`, undefined, token, arena);
    check("revoking twice succeeds — the caller asked for a state", revokeAgain.status === 200);

    const reshared = await api("POST", `/api/workflows/${arenaWorkflowId}/share`, undefined, token, arena);
    const newToken = (reshared.json?.data?.shareUrl ?? "").split("/s/")[1] ?? "";
    check(
      "re-sharing mints a NEW token rather than resurrecting the old one",
      newToken.length === 32 && newToken !== shareToken,
      `${shareToken} → ${newToken}`,
    );
    check("and the old token stays dead", (await api("GET", `/api/share/${shareToken}`)).status === 404);

    // A share link is not a way in. It reads one redacted graph and nothing else.
    const sharedWriteAttempt = await api("PATCH", `/api/workflows/${arenaWorkflowId}`, { name: "via share" }, undefined, arena);
    check("holding a share link does not let you write", sharedWriteAttempt.status === 401, `got ${sharedWriteAttempt.status}`);
    const sharedRunAttempt = await api("POST", `/api/workflows/${arenaWorkflowId}/runs`, { input: null }, undefined, arena);
    check("nor run anything", sharedRunAttempt.status === 401, `got ${sharedRunAttempt.status}`);

    // The invariant: one token, one workflow, enforced by the partial unique index.
    const [{ n: duplicateTokens }] = await sql.query(
      `select count(*)::int as n from (
         select "shareToken" from "workflow" where "shareToken" is not null
         group by 1 having count(*) > 1
       ) duplicates`,
    );
    check("no share token names two workflows", duplicateTokens === 0, `${duplicateTokens} do`);
    const [{ n: strandedSharedAt }] = await sql.query(
      `select count(*)::int as n from "workflow"
       where ("shareToken" is null) <> ("sharedAt" is null)`,
    );
    check(
      "sharedAt and shareToken are null together or set together",
      strandedSharedAt === 0,
      `${strandedSharedAt} row(s) disagree`,
    );
    const [{ n: badVisibility }] = await sql.query(
      `select count(*)::int as n from "workflow" where "visibility" not in ('workspace', 'private')`,
    );
    check("every workflow's visibility is one of the two values", badVisibility === 0, `${badVisibility} are not`);
  } finally {
    // The arena and everything in it. `workspace` cascades to its workflows, runs,
    // versions, credentials, members and invitations, so this is the whole of it — but the
    // probe's own personal workspace is created with `createdBy` and needs `cleanUpProbe`.
    if (arena) await sql.query('delete from "workspace" where "id" = $1', [arena]).catch(() => {});
    await sql.query('delete from "workspace_invitation" where "email" like $1', ["%@agentforge.invalid"]).catch(() => {});
    await sql.query('delete from "workspace_member" where "userId" = $1', [MATRIX_USER_ID]).catch(() => {});
    await cleanUpProbe(MATRIX_USER_ID);
    await sql.query('delete from "session" where "sessionToken" = $1', [matrixToken]).catch(() => {});
  }


  // --- the migration's own invariants ---------------------------------------
  //
  // Asserted against the live database rather than against the migration file, because
  // the file only says what was intended. Phase 19A found a migration whose index never
  // actually landed (`scripts/verify-schema.mjs`), so "it is in the .sql" is not
  // evidence that it is in the database.
  const [{ n: unscoped }] = await sql.query(`
    select (
      (select count(*) from "workflow" where "workspaceId" is null) +
      (select count(*) from "run" where "workspaceId" is null) +
      (select count(*) from "workflow_version" where "workspaceId" is null) +
      (select count(*) from "credential" where "workspaceId" is null)
    )::int as n`);
  check("every row in every scoped table has a workspace", unscoped === 0, `${unscoped} without one`);

  const [tenancy] = await sql.query(`
    select
      (select count(*) from "user")::int as users,
      (select count(*) from "workspace" where "personal")::int as personal,
      (select count(distinct "userId") from "workspace_member")::int as members`);
  check(
    "every user has a personal workspace and a membership",
    tenancy.users === tenancy.personal && tenancy.users === tenancy.members,
    JSON.stringify(tenancy),
  );

  // A resource whose workspace nobody is a member of is unreachable by every route in
  // the product — invisible, undeletable, and still costing metered storage.
  const [{ n: orphanedByMembership }] = await sql.query(`
    select count(*)::int as n from "workflow" w
    where not exists (select 1 from "workspace_member" m where m."workspaceId" = w."workspaceId")`);
  check(
    "no workflow is stranded in a workspace with no members",
    orphanedByMembership === 0,
    `${orphanedByMembership} stranded`,
  );

  // Phase 19B's own invariant. Every stored token is a 32-byte hex digest and nothing
  // else — a row holding anything shorter would mean a plaintext token somewhere.
  const [{ n: badHashes }] = await sql.query(
    `select count(*)::int as n from "workspace_invitation"
     where "tokenHash" !~ '^[0-9a-f]{64}$'`,
  );
  check("every invitation stores a 64-character hex hash", badHashes === 0, `${badHashes} do not`);

  // Phase 20's migration, asserted against the live database. The partial unique index is
  // read by an unauthenticated route, so its presence is not something to take on trust —
  // `verify-schema.mjs` exists because Phase 19A found an index that was in the .sql and
  // not in the database.
  const [shareIndex] = await sql.query(
    `select indexdef from pg_indexes where indexname = 'workflow_share_token_idx'`,
  );
  check(
    "the share token's unique index exists and is partial",
    typeof shareIndex?.indexdef === "string" &&
      /unique/i.test(shareIndex.indexdef) &&
      /shareToken/.test(shareIndex.indexdef) &&
      /where/i.test(shareIndex.indexdef),
    shareIndex?.indexdef ?? "no such index",
  );

  const [{ n: doubleLive }] = await sql.query(
    `select count(*)::int as n from (
       select "workspaceId", "email" from "workspace_invitation"
       where "acceptedAt" is null and "revokedAt" is null
       group by 1, 2 having count(*) > 1
     ) duplicates`,
  );
  check(
    "no address has two live invitations to one workspace",
    doubleLive === 0,
    `${doubleLive} address(es) do`,
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

console.log(
  `\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}` +
    `${skipped > 0 ? ` (${skipped} skipped)` : ""}\n`,
);
process.exit(failures === 0 ? 0 : 1);
