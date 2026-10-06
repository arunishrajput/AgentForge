/**
 * The Phase 23A surface, verified against the deployed service.
 *
 *   node --env-file=.env scripts/verify-templates.mjs
 *
 * **What this proves that the unit tests cannot.** `templates.test.ts` executes every
 * offline template through the engine in-process, which is a real check but a local one:
 * it says nothing about whether the deployed build carries the same registry, whether the
 * clone route is wired, whether a template's graph survives a round trip through Postgres
 * `jsonb`, or whether the transform nodes behave the same on the deployed Node as they do
 * on this laptop — the date node in particular reads `Intl`, whose time-zone data is a
 * property of the *container image*, not of the code.
 *
 * Every request goes through the product's own API with a real `session` row, the same
 * mechanism `verify-api.mjs`, `verify-durable.mjs` and `verify-vault.mjs` use. There is no
 * test-only bypass in the app.
 *
 * It cleans up after itself: every workflow it creates is deleted at the end, pass or fail.
 */
import { neon } from "@neondatabase/serverless";
import { verificationUser } from "./verify-user.mjs";

const BASE = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
if (!BASE) throw new Error("APP_BASE_URL is required.");

const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);

const COOKIE =
  new URL(BASE).protocol === "https:"
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";

let cookie = null;
let passed = 0;
let failed = 0;
const created = [];

const pass = (message) => {
  passed += 1;
  console.log(`   ✓ ${message}`);
};
const fail = (message) => {
  failed += 1;
  console.log(`   ✗ ${message}`);
};
const check = (condition, good, bad) => (condition ? pass(good) : fail(bad ?? good));

async function mintSession() {
  const user = await verificationUser(sql);
  if (!user) throw new Error("No user row — sign in through the browser once first.");
  const token = crypto.randomUUID() + crypto.randomUUID();
  await sql.query(
    'insert into "session" ("sessionToken", "userId", "expires") values ($1, $2, $3)',
    [token, user.id, new Date(Date.now() + 2 * 60 * 60 * 1000)],
  );
  cookie = `${COOKIE}=${token}`;
  return user.email;
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
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

/** The API envelope is `{ data }` on success and `{ error }` on failure. */
const data = (result) => result.body?.data ?? result.body;

async function main() {
  const email = await mintSession();
  console.log(`\nAgentForge — Phase 23A verification`);
  console.log(`  ${BASE}`);
  console.log(`  session minted for ${email}\n`);

  /* 1 — the deployed build carries the widened registry ------------------------- */
  console.log("1. The registry the deployed build is actually serving");
  const health = await api("/api/health");
  // 30 since Phase 23C added the Postgres node to Phase 23B's 29.
  check(data(health)?.registry === 30, `health reports 30 nodes (${data(health)?.registry})`);
  console.log(`   revision ${data(health)?.revision}`);

  const nodes = data(await api("/api/nodes"));
  const list = Array.isArray(nodes) ? nodes : (nodes?.nodes ?? []);
  check(list.length === 30, `GET /api/nodes returns 30 definitions (${list.length})`);

  const expected = [
    "core.switch",
    "transform.filter",
    "transform.map",
    "transform.sort",
    "transform.unique",
    "transform.aggregate",
    "transform.json",
    "transform.text",
    "transform.number",
    "transform.date",
  ];
  const byType = new Map(list.map((node) => [node.type, node]));
  const missing = expected.filter((type) => !byType.has(type));
  check(missing.length === 0, "all ten Phase 23A nodes are in the deployed registry", `missing: ${missing.join(", ")}`);

  // The docs field has to survive `describeNode`'s JSON round trip to reach the inspector.
  const undocumented = expected.filter((type) => !byType.get(type)?.docs?.summary);
  check(undocumented.length === 0, "every new node carries its docs over the wire", `no docs: ${undocumented.join(", ")}`);

  const switchNode = byType.get("core.switch");
  check(
    switchNode?.outputs?.length === 5 && switchNode.outputs.at(-1)?.key === "else",
    "core.switch declares four cases and an else",
  );
  check(byType.get("core.branch")?.outputShape?.includes("matched"), "core.branch now declares its output shape");
  check(
    expected.filter((type) => type.startsWith("transform.")).every((type) => byType.get(type)?.agentCallable === true),
    "every transform node is reachable as an agent tool",
  );
  check(switchNode?.agentCallable === false, "core.switch is NOT agent-callable");

  /* 2 — the gallery ------------------------------------------------------------- */
  console.log("\n2. The template gallery");
  const gallery = data(await api("/api/templates"));
  check(Array.isArray(gallery) && gallery.length === 11, `GET /api/templates returns 11 (${gallery?.length})`);
  check(
    gallery?.every((template) => template.uses?.length > 0 && template.nodeCount > 0),
    "every card carries its node chips and a node count",
  );
  check(!gallery?.some((template) => "graph" in template), "the gallery response carries no graphs");
  const needing = gallery?.filter((template) => template.requires.length > 0).map((template) => template.id);
  check(
    // Six since Phase 23C: Phase 23B's four and this phase's one each need a credential only
    // the user can create, and `classify-and-route` needs a model key. What makes this worth
    // pinning is the inverse — a template that quietly loses its `requires` becomes a card
    // promising that cloning and pressing Run works.
    needing?.length === 6 &&
      [
        "classify-and-route",
        "slack-standup",
        "notion-run-log",
        "webhook-to-github",
        "airtable-inbox",
        "postgres-rollup",
      ].every((id) => needing.includes(id)),
    `six templates declare a prerequisite (${needing?.join(", ") || "none"})`,
  );

  const unknown = await api("/api/templates/does-not-exist", { method: "POST" });
  check(unknown.status === 404, `an unknown template id answers 404 (got ${unknown.status})`);

  /* 3 — cloning is an ordinary workflow creation -------------------------------- */
  console.log("\n3. Cloning a template into the workspace");
  const cloned = await api("/api/templates/rank-and-report", { method: "POST" });
  check(cloned.status === 201, `POST answers 201 (got ${cloned.status})`);
  const workflow = data(cloned);
  if (!workflow?.id) {
    fail("no workflow came back — cannot continue");
    return;
  }
  created.push(workflow.id);
  check(workflow.name === "Rank a list and report the top", "the clone is named after the template");
  check(workflow.version === 1, `the clone is at version 1 (${workflow.version})`);

  // The graph has now been through Postgres jsonb and back.
  const readBack = data(await api(`/api/workflows/${workflow.id}`));
  check(readBack?.graph?.nodes?.length === 6, `the stored graph has its 6 nodes (${readBack?.graph?.nodes?.length})`);
  check(
    readBack?.graph?.nodes?.every((node) => Number.isFinite(node.position?.x) && Number.isFinite(node.position?.y)),
    "every node kept a finite position — the layout survived the round trip",
  );
  const versions = data(await api(`/api/workflows/${workflow.id}/versions`));
  const first = versions?.versions?.at(-1) ?? versions?.at?.(-1);
  check(Boolean(first), "the clone has a version history");

  /* 4 — it RUNS on the deployed engine, and computes the right answer ------------ */
  console.log("\n4. The cloned template runs, and gets the arithmetic right");
  const run = await api(`/api/workflows/${workflow.id}/runs`, {
    method: "POST",
    body: JSON.stringify({ input: null, mode: "sync" }),
  });
  const finished = data(run);
  check(finished?.status === "succeeded", `the run succeeded (${finished?.status}${finished?.error ? `: ${finished.error}` : ""})`);
  check(finished?.steps?.length === 6, `all six steps ran (${finished?.steps?.length})`);

  const step = (nodeId) => finished?.steps?.find((entry) => entry.nodeId === nodeId);
  check(
    step("passing")?.output?.count === 4 && step("passing")?.output?.total === 5,
    `the filter kept 4 of 5 (${step("passing")?.output?.count} of ${step("passing")?.output?.total})`,
  );
  check(
    step("names")?.output?.value === "Katherine, Ada, Grace, Edsger",
    `the sort and join produced the exact expected string (got "${step("names")?.output?.value}")`,
  );
  const logged = step("report")?.logs?.at(-1)?.message;
  check(
    logged === "4 of 5 scored over 50: Katherine, Ada, Grace, Edsger",
    `the template's summary line is exactly right (got "${logged}")`,
  );

  /* 5 — the switch routes on the deployed engine -------------------------------- */
  console.log("\n5. The new control flow, running deployed");
  const triage = await api("/api/templates/triage-webhook", { method: "POST" });
  const triageWorkflow = data(triage);
  if (triageWorkflow?.id) created.push(triageWorkflow.id);

  for (const [priority, expectedNode, skipped] of [
    ["urgent", "page", ["queue", "file"]],
    ["high", "queue", ["page", "file"]],
    ["whenever", "file", ["page", "queue"]],
  ]) {
    const routed = data(
      await api(`/api/workflows/${triageWorkflow.id}/runs`, {
        method: "POST",
        body: JSON.stringify({ input: { priority, message: "verification" }, mode: "sync" }),
      }),
    );
    const byNode = new Map((routed?.steps ?? []).map((entry) => [entry.nodeId, entry]));
    const took = byNode.get(expectedNode)?.status === "succeeded";
    const rest = skipped.every((nodeId) => byNode.get(nodeId)?.status === "skipped");
    check(took && rest, `priority "${priority}" routed to ${expectedNode} and skipped the other two`);
  }

  /* 6 — the date node's Intl data is the container's, not this laptop's ---------- */
  console.log("\n6. transform.date on the deployed container");
  const digest = await api("/api/templates/daily-digest", { method: "POST" });
  const digestWorkflow = data(digest);
  if (digestWorkflow?.id) created.push(digestWorkflow.id);

  const digestRun = data(
    await api(`/api/workflows/${digestWorkflow.id}/runs`, {
      method: "POST",
      body: JSON.stringify({ input: null, mode: "sync" }),
    }),
  );
  check(digestRun?.status === "succeeded", `the digest ran (${digestRun?.status})`);
  const today = digestRun?.steps?.find((entry) => entry.nodeId === "today")?.output;
  check(today?.timeZone === "Europe/London", `it formatted in Europe/London (${today?.timeZone})`);
  check(
    /^\d{4}-\d{2}-\d{2}$/.test(today?.date ?? ""),
    `it produced a real date (${today?.date}) — the image carries full ICU time-zone data`,
  );
  check(
    typeof today?.weekday === "string" && today.weekday.length > 5,
    `and a named weekday (${today?.weekday}) rather than a number`,
  );

  /* 7 — a template's own graph is still valid according to the deployed build ---- */
  console.log("\n7. Every template clones and validates on the deployed build");
  for (const template of gallery ?? []) {
    if (["rank-and-report", "triage-webhook", "daily-digest"].includes(template.id)) continue;
    const result = await api(`/api/templates/${template.id}`, { method: "POST" });
    const made = data(result);
    if (made?.id) created.push(made.id);
    check(result.status === 201, `${template.id} clones (${result.status})`);
    const problems = made?.problems ?? [];
    check(problems.length === 0, `${template.id} has no validation problems`, `${template.id}: ${JSON.stringify(problems)}`);
  }
}

async function cleanup() {
  if (created.length === 0) return;
  console.log(`\nCleaning up ${created.length} workflow(s)`);
  for (const id of created) {
    const result = await api(`/api/workflows/${id}`, { method: "DELETE" });
    if (result.status >= 400) console.log(`   ! could not delete ${id} (${result.status})`);
  }
  console.log("   done");
}

main()
  .catch((error) => {
    failed += 1;
    console.error(`\nUNCAUGHT: ${error?.stack ?? error}`);
  })
  .finally(async () => {
    await cleanup().catch((error) => console.error(`cleanup failed: ${error}`));
    console.log(`\n${passed} passed, ${failed} failed`);
    console.log(failed === 0 ? "ALL CHECKS PASSED\n" : "THERE ARE FAILURES\n");
    process.exit(failed === 0 ? 0 : 1);
  });
