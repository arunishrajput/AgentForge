/**
 * The demo path, walked end to end against a running instance.
 *
 *   node --env-file=.env scripts/smoke.mjs https://<the deployed url>
 *   node --env-file=.env scripts/smoke.mjs <url> --loop 10
 *
 * **This is not `verify-api.mjs`.** That suite is 178 checks over the whole API
 * surface and takes ~2 minutes. This walks the eight beats of `DEMO.md` in order,
 * in ~20 seconds, and fails on anything that would be visible on stage. It is what
 * `DEMO.md`'s pre-demo checklist runs 15 minutes before the demo, and `--loop 10`
 * is `BUILD_PLAN.md` Phase 11's bar: ten consecutive clean runs.
 *
 * Every beat below maps to a beat in `DEMO.md`. When one fails, the beat number in
 * the output says which part of the demo just broke.
 *
 * Auth is a real database session row, inserted here and deleted afterwards — the
 * same mechanism `verify-api.mjs` uses, and the same code path `auth()` takes. There
 * is no test-only bypass in the app.
 *
 * **It writes to real services**, because that is the point: a real Discord message
 * and a real row in the demo spreadsheet, once per iteration. Clear both before
 * demoing (`DEMO.md` → pre-demo checklist).
 *
 * Environment:
 *   DATABASE_URL            required — to mint the session
 *   APP_BASE_URL            unused here; the target is argv[2]
 *   SMOKE_SPREADSHEET_ID    the demo sheet. Without it Beat 8's Sheets half SKIPs
 *                           rather than passing, because the generated node is
 *                           deliberately born empty (see sheets.ts).
 */
import { neon } from "@neondatabase/serverless";

/* ------------------------------------------------------------------ *
 * Arguments
 * ------------------------------------------------------------------ */

const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith("--")) ?? "http://localhost:3000").replace(/\/$/, "");
const loops = Number(flag("--loop") ?? 1);
const gapMs = Number(flag("--gap") ?? 3000);
const spreadsheetId = flag("--sheet") ?? process.env.SMOKE_SPREADSHEET_ID ?? "";

function flag(name) {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

const secure = base.startsWith("https://");
const cookieName = secure ? "__Secure-authjs.session-token" : "authjs.session-token";
const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);

/**
 * `DEMO.md` Beat 2's prompt, verbatim. If this string and `DEMO.md` ever disagree,
 * the smoke test is measuring something the demo does not do.
 */
const DEMO_PROMPT = `When my form webhook fires, summarise the submission, decide whether it's urgent,
post urgent ones to Discord, and log every one to my Google Sheet.`;

/** `DEMO.md` Beat 5's payload, verbatim. */
const URGENT_PAYLOAD = {
  name: "Priya",
  email: "priya@example.com",
  message: "Our production checkout has been down for 40 minutes and we are losing orders.",
};

/* ------------------------------------------------------------------ *
 * Reporting
 * ------------------------------------------------------------------ */

let failures = 0;
let skipped = 0;
let beat = 0;

function pass(label) {
  console.log(`  \x1b[32mPASS\x1b[0m  ${beat}. ${label}`);
}

/**
 * `detail` is what to say when this fails, so it is printed only then. An earlier
 * version showed it beside PASS too, which made every passing line read as its own
 * contradiction ("PASS  it built the webhook spine — Beat 5's curl has nothing to
 * fire"). Anything worth seeing on a pass goes through `note`.
 */
function check(label, condition, detail) {
  if (condition) return pass(label);
  failures += 1;
  console.log(`  \x1b[31mFAIL\x1b[0m  ${beat}. ${label}`);
  if (detail) console.log(`        ${detail}`);
}

/** A measurement worth reading on a clean walk. */
function note(text) {
  console.log(`        \x1b[2m${text}\x1b[0m`);
}

function skip(label, why) {
  skipped += 1;
  console.log(`  \x1b[33mSKIP\x1b[0m  ${beat}. ${label}\n        ${why}`);
}

const ms = (start) => `${Date.now() - start} ms`;

/* ------------------------------------------------------------------ *
 * HTTP
 * ------------------------------------------------------------------ */

async function api(path, { cookie, method = "GET", body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    redirect: "manual",
    headers: {
      ...(cookie ? { cookie: `${cookieName}=${cookie}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* a rendered page, or an error page */
  }
  return { status: response.status, json, text, data: json?.data, error: json?.error };
}

/**
 * Opens the SSE stream and resolves once the run it is following reaches a terminal
 * state. Beat 6 is "nodes light up in sequence", so this records the frames as they
 * arrive rather than reading the finished run — a stream that delivered one buffered
 * blob at the end would pass a row-reading check and fail on stage.
 */
function watch(path, cookie) {
  const controller = new AbortController();
  const frames = [];
  let firstStepAt = null;

  const done = (async () => {
    const response = await fetch(`${base}${path}`, {
      headers: { accept: "text/event-stream", cookie: `${cookieName}=${cookie}` },
      signal: controller.signal,
    });
    if (!response.body) return frames;

    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let cut;
        while ((cut = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const name = raw.split("\n").find((l) => l.startsWith("event: "))?.slice(7);
          const payload = raw.split("\n").find((l) => l.startsWith("data: "))?.slice(6);
          if (!name) continue;
          let data = null;
          try {
            data = payload ? JSON.parse(payload) : null;
          } catch {
            /* keep the frame, lose the payload */
          }
          if (name === "step" && firstStepAt === null) firstStepAt = Date.now();
          frames.push({ name, data, at: Date.now() });
          if (name === "done") {
            controller.abort();
            return frames;
          }
        }
      }
    } catch {
      /* aborted, or the connection closed under us */
    }
    return frames;
  })();

  return { frames, done, stop: () => controller.abort(), firstStepAt: () => firstStepAt };
}

const sleep = (msec) => new Promise((resolve) => setTimeout(resolve, msec));

/* ------------------------------------------------------------------ *
 * One walk of the demo path
 * ------------------------------------------------------------------ */

async function walk(cookie, iteration) {
  console.log(`\n\x1b[1m── Demo path, walk ${iteration}\x1b[0m`);
  let workflowId = null;

  try {
    /* Beat 1 — the live product ------------------------------------ */
    beat = 1;
    const healthAt = Date.now();
    const health = await api("/api/health");
    check(
      "health answers, database reachable",
      health.status === 200 && health.json?.database === "reachable",
      `status ${health.status}, body ${health.text.slice(0, 160)}`,
    );
    check(
      "first interaction is not a cold-start stall",
      Date.now() - healthAt < 5000,
      `took ${ms(healthAt)} — Cloud Run or Neon was asleep. Warm both before demoing.`,
    );

    const landing = await api("/");
    check(
      "the signed-out landing page offers sign-in",
      landing.status === 200 && landing.text.includes("Continue with Google"),
      `status ${landing.status} — DEMO.md Beat 1 clicks this button by name, so its ` +
        `text is part of the script, not decoration`,
    );

    const guarded = await api("/workflows");
    check(
      "a signed-out /workflows redirects rather than rendering",
      guarded.status === 307 || guarded.status === 302,
      `status ${guarded.status} — an auth boundary must not answer 200 (D51)`,
    );

    const list = await api("/api/workflows", { cookie });
    check("the session reaches the workflow list", list.status === 200, `status ${list.status}`);

    /* Beat 2 + 3 — the ask, and the generation --------------------- */
    beat = 3;
    const generatedAt = Date.now();
    const generated = await api("/api/workflows/generate", {
      cookie,
      method: "POST",
      body: { prompt: DEMO_PROMPT },
    });

    if (generated.status !== 201) {
      check(
        "the demo prompt generates a workflow",
        false,
        `status ${generated.status}: ${generated.error?.message ?? generated.text.slice(0, 300)}`,
      );
      return;
    }

    const workflow = generated.data.workflow;
    workflowId = workflow.id;
    const generation = generated.data.generation;
    const types = workflow.graph.nodes.map((n) => n.type);

    pass("the demo prompt generates a workflow");
    note(`${ms(generatedAt)}, ${types.length} nodes, ${generation.model}`);
    check("the graph is runnable", workflow.runnable === true, JSON.stringify(workflow.problems));
    check(
      "nothing was reported unsupported",
      generation.unsupported.length === 0,
      `unsupported: ${JSON.stringify(generation.unsupported)}`,
    );
    check(
      "it built the webhook spine",
      types.includes("core.webhook_trigger"),
      `got: ${types.join(", ")} — Beat 5's curl has nothing to fire`,
    );
    check(
      "it built an agent node",
      types.includes("ai.agent"),
      `got: ${types.join(", ")} — Beat 7 is the runtime decision`,
    );
    check("it built a branch", types.includes("core.branch"), `got: ${types.join(", ")}`);
    check(
      "it wired Discord and Sheets",
      types.includes("integration.discord") && types.includes("integration.sheets"),
      `got: ${types.join(", ")} — Beat 8 has no payoff`,
    );
    check(
      "the workflow has a webhook URL",
      typeof workflow.webhookUrl === "string" && workflow.webhookUrl.length > 0,
      "webhookUrl is null — describeWorkflow found no webhook trigger",
    );

    if (!workflow.webhookUrl) return;

    /* Beat 4 — it is real, not a picture --------------------------- */
    beat = 4;
    const graph = structuredClone(workflow.graph);
    const discordNode = graph.nodes.find((n) => n.type === "integration.discord");
    const sheetsNode = graph.nodes.find((n) => n.type === "integration.sheets");

    const marker = `smoke-${Date.now()}`;
    if (discordNode) {
      discordNode.config = {
        ...discordNode.config,
        content: `${String(discordNode.config?.content ?? "").slice(0, 900)}\n(${marker})`,
      };
    }
    if (sheetsNode && spreadsheetId) {
      sheetsNode.config = { ...sheetsNode.config, spreadsheetId };
    }

    const saved = await api(`/api/workflows/${workflowId}`, {
      cookie,
      method: "PATCH",
      body: { graph },
    });
    check(
      "an edited node saves",
      saved.status === 200,
      `status ${saved.status}: ${saved.error?.message ?? ""}`,
    );

    const reloaded = await api(`/api/workflows/${workflowId}`, { cookie });
    const reloadedDiscord = reloaded.data?.graph.nodes.find((n) => n.type === "integration.discord");
    check(
      "the edit survives a reload",
      String(reloadedDiscord?.config?.content ?? "").includes(marker),
      "the Message field came back without the edit — Beat 4 is a lie",
    );
    check(
      "the edit did not break the graph",
      reloaded.data?.runnable === true,
      JSON.stringify(reloaded.data?.problems),
    );

    /* Beat 5 + 6 — fire it, and watch it think --------------------- */
    beat = 5;
    const triggerNode = workflow.graph.nodes.find((n) => n.type === "core.webhook_trigger");
    const requiredFields = triggerNode?.config?.requiredFields ?? [];
    const unmet = requiredFields.filter((field) => !(field in URGENT_PAYLOAD));
    check(
      "the demo payload satisfies the generated trigger",
      unmet.length === 0,
      `the trigger requires ${JSON.stringify(unmet)}, which DEMO.md Beat 5's curl does not send`,
    );

    // The stream opens *before* the webhook fires, exactly as the browser is already
    // sitting on the canvas when the presenter runs the curl.
    const stream = watch(`/api/workflows/${workflowId}/stream`, cookie);
    await sleep(400);

    const firedAt = Date.now();
    const fired = await api(`/api/webhook/${workflow.webhookUrl.split("/").pop()}`, {
      method: "POST",
      body: URGENT_PAYLOAD,
    });
    check(
      "the webhook starts a run with no session at all",
      fired.status === 201,
      `status ${fired.status}: ${fired.error?.message ?? fired.text.slice(0, 300)}`,
    );

    const run = fired.data;
    const frames = await Promise.race([stream.done, sleep(20_000).then(() => stream.frames)]);
    stream.stop();

    beat = 6;
    const stepFrames = frames.filter((f) => f.name === "step");
    check(
      "the stream opened with a snapshot",
      frames.some((f) => f.name === "snapshot"),
      `frames: ${frames.map((f) => f.name).join(", ") || "none"}`,
    );
    check(
      "per-node status arrived as the run proceeded",
      stepFrames.length >= 2,
      `${stepFrames.length} step frame(s) — Beat 6 shows nothing lighting up`,
    );
    check(
      "the stream reported the run finishing",
      frames.some((f) => f.name === "run" || f.name === "done"),
      `frames: ${frames.map((f) => f.name).join(", ")}`,
    );
    check(
      "the first status landed before the run ended",
      stream.firstStepAt() !== null && stream.firstStepAt() < firedAt + (run?.durationMs ?? 0) + 1500,
      "every frame arrived at once — that is a buffered response, not a stream",
    );

    /* Beat 7 — the runtime decision -------------------------------- */
    beat = 7;
    if (!run) return;
    check(
      "the run succeeded",
      run.status === "succeeded",
      `status ${run.status}: ${run.error ?? ""}\n        ${failedSteps(run)}`,
    );

    const agentStep = run.steps?.find((s) => s.nodeType === "ai.agent");
    check(
      "the agent node ran",
      agentStep?.status === "succeeded",
      `status ${agentStep?.status ?? "absent"}: ${agentStep?.error ?? ""}`,
    );
    check(
      "the agent left its reasoning in the log",
      (agentStep?.logs?.length ?? 0) > 0,
      "no log lines — Beat 7 has nothing to point at",
    );

    const branchStep = run.steps?.find((s) => s.nodeType === "core.branch");
    check(
      "the branch chose a path at runtime",
      typeof branchStep?.branch === "string" && branchStep.branch.length > 0,
      `branch: ${JSON.stringify(branchStep?.branch ?? null)}`,
    );
    check(
      "the urgent payload took the urgent path",
      run.steps?.some((s) => s.nodeType === "integration.discord" && s.status === "succeeded"),
      `Discord step: ${JSON.stringify(
        run.steps?.find((s) => s.nodeType === "integration.discord")?.status ?? "absent",
      )} — the agent judged a 40-minute outage non-urgent, or the post failed`,
    );

    /* Beat 8 — the payoff ------------------------------------------ */
    beat = 8;
    const discordStep = run.steps?.find((s) => s.nodeType === "integration.discord");
    check(
      "a real Discord message was posted",
      discordStep?.status === "succeeded",
      `${discordStep?.status ?? "absent"}: ${discordStep?.error ?? ""}`,
    );

    const sheetsStep = run.steps?.find((s) => s.nodeType === "integration.sheets");
    if (!spreadsheetId) {
      skip(
        "a real row was appended to the Sheet",
        "no SMOKE_SPREADSHEET_ID — the generated Sheets node is born empty by design",
      );
    } else {
      check(
        "a real row was appended to the Sheet",
        sheetsStep?.status === "succeeded" && Boolean(sheetsStep?.output?.updatedRange),
        `${sheetsStep?.status ?? "absent"}: ${sheetsStep?.error ?? ""} ${JSON.stringify(
          sheetsStep?.output ?? null,
        ).slice(0, 200)}`,
      );
      if (sheetsStep?.output?.updatedRange) note(`row at ${sheetsStep.output.updatedRange}`);
    }

    note(
      `branch took "${branchStep?.branch}", ran ${run.steps?.length ?? 0} steps in ${run.durationMs} ms, ` +
        `generated in ${generation.attempts?.length ?? 1} attempt(s)`,
    );
  } finally {
    if (workflowId) {
      await api(`/api/workflows/${workflowId}`, { cookie, method: "DELETE" }).catch(() => {});
    }
  }
}

function failedSteps(run) {
  return (run.steps ?? [])
    .filter((s) => s.status === "failed")
    .map((s) => `${s.nodeType}: ${s.error}`)
    .join("\n        ");
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

const [user] = await sql.query('select id, email from "user" order by "id" limit 1');
if (!user) {
  console.error("No user row exists — sign in through the browser once first.");
  process.exit(1);
}

const token = crypto.randomUUID() + crypto.randomUUID();
await sql.query('insert into "session" ("sessionToken", "userId", "expires") values ($1, $2, $3)', [
  token,
  user.id,
  new Date(Date.now() + 2 * 60 * 60 * 1000),
]);

console.log(`\x1b[1mAgentForge smoke — the DEMO.md path\x1b[0m`);
console.log(`target  ${base}`);
console.log(`as      ${user.email}`);
console.log(`sheet   ${spreadsheetId || "(none — Beat 8's Sheets half will SKIP)"}`);
console.log(`walks   ${loops}`);

const startedAt = Date.now();
try {
  for (let i = 1; i <= loops; i += 1) {
    const before = failures;
    await walk(token, i);
    if (failures > before && loops > 1) {
      console.log(`\n\x1b[31mWalk ${i} failed. Stopping: the bar is ${loops} consecutive clean walks.\x1b[0m`);
      break;
    }
    if (i < loops) await sleep(gapMs);
  }
} finally {
  await sql.query('delete from "session" where "sessionToken" = $1', [token]).catch(() => {});
}

console.log(
  `\n\x1b[1m${failures === 0 ? "\x1b[32mCLEAN" : "\x1b[31mFAILED"}\x1b[0m  ` +
    `${failures} failure(s), ${skipped} skipped, ${Math.round((Date.now() - startedAt) / 1000)} s total`,
);
if (failures === 0 && loops > 1) {
  console.log(`\x1b[2m${loops} consecutive clean walks of the demo path.\x1b[0m`);
}
console.log(
  `\x1b[2mThis wrote ${loops} real Discord message(s)` +
    `${spreadsheetId ? ` and ${loops} real Sheet row(s)` : ""}. Clear them before demoing.\x1b[0m`,
);

process.exit(failures === 0 ? 0 : 1);
