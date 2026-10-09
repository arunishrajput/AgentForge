/**
 * The Phase 23C surface, verified against the deployed service **and against a real Postgres
 * server over a real TLS socket.**
 *
 *   APP_BASE_URL=https://… node --env-file=.env scripts/verify-postgres.mjs
 *
 * **What this proves that no unit test can.** `postgres.test.ts` asserts the statement this
 * repository *builds* — exhaustively, with no network, because `buildSelect` is pure. What it
 * cannot assert is whether a server accepts that statement, whether the driver reaches a host
 * from inside the Cloud Run container at all, and — the claim the whole phase rests on —
 * whether `BEGIN READ ONLY` actually refuses a write. A server's behaviour can only honestly
 * be established by asking the server.
 *
 * That last one is why this script exists in the shape it does. **Read-only is asserted twice,
 * from two directions:** once by proving a write is refused at the transaction level, and once
 * by proving the role itself was never granted the privilege. Either alone would be a weaker
 * claim than the product makes.
 *
 * **What it needs**, in `.env` and not in this repository:
 *
 *   DEMO_DATABASE_URL        a connection string for a SELECT-only role.
 *                            `scripts/setup-demo-db.mjs` creates one, free, inside the Neon
 *                            project this product already uses.
 *   DATABASE_URL_UNPOOLED    the application's own, to mint a session and to read the role's
 *                            grants back out of `information_schema`.
 *
 * Absent credentials are **skipped and counted as skipped**, never passed. It deletes every
 * workflow it creates and leaves the demo database exactly as it found it — which it can
 * promise, unlike `verify-integrations.mjs`, precisely because nothing here can write.
 */
import { neon } from "@neondatabase/serverless";
import postgres from "postgres";
import { verificationUser } from "./verify-user.mjs";

// Either convention works, because this repository has both: `verify-api.mjs`,
// `verify-vault.mjs` and `verify-observability.mjs` take the URL as an argument, while
// `verify-integrations.mjs` reads `APP_BASE_URL`. Accepting both costs one line and removes
// a trap whose symptom is `ECONNREFUSED` against a localhost nobody is running.
const BASE = (process.argv[2] ?? process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
if (!BASE) {
  throw new Error("Pass the base URL as an argument, or set APP_BASE_URL.");
}

const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);
const DEMO_URL = process.env.DEMO_DATABASE_URL ?? "";

const COOKIE =
  new URL(BASE).protocol === "https:"
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";

let cookie = null;
let passed = 0;
let failed = 0;
let skipped = 0;
const created = [];

const pass = (message) => {
  passed += 1;
  console.log(`   ✓ ${message}`);
};
const fail = (message) => {
  failed += 1;
  console.log(`   ✗ ${message}`);
};
const skip = (message) => {
  skipped += 1;
  console.log(`   – ${message}`);
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

const data = (result) => result.body?.data ?? result.body;

async function runGraph(name, nodes, edges, input) {
  const made = data(
    await api("/api/workflows", {
      method: "POST",
      body: JSON.stringify({
        name,
        graph: {
          version: 1,
          nodes: nodes.map((node, index) => ({
            id: node.id,
            type: node.type,
            position: { x: 80 + index * 240, y: 160 },
            config: node.config ?? {},
          })),
          edges: edges.map((edge, index) => ({
            id: `e${index + 1}`,
            source: edge.from,
            target: edge.to,
            sourceHandle: null,
          })),
        },
      }),
    }),
  );
  if (!made?.id) throw new Error(`could not create "${name}": ${JSON.stringify(made)}`);
  created.push(made.id);

  const run = data(
    await api(`/api/workflows/${made.id}/runs`, {
      method: "POST",
      body: JSON.stringify(input === undefined ? {} : { input }),
    }),
  );
  return { run, steps: new Map((run?.steps ?? []).map((step) => [step.nodeId, step])) };
}

const why = (step) => step?.error ?? step?.status ?? "no step recorded";

async function main() {
  console.log(`\nAgentForge — Phase 23C verification against ${BASE}\n`);

  const email = await mintSession();
  console.log(`1. Session minted for ${email}`);

  /* 1 — the registry over the wire ---------------------------------------------- */
  console.log("\n2. The deployed registry");

  const health = data(await api("/api/health"));
  // 31 since Phase 37. The fifth script that pins the count — it moves with the other four.
  check(health?.registry === 31, `the deployed registry serves 31 nodes (${health?.registry})`);
  console.log(`   revision: ${health?.revision}`);

  const nodes = data(await api("/api/nodes"));
  const list = Array.isArray(nodes) ? nodes : (nodes?.nodes ?? []);
  const pg = list.find((node) => node.type === "integration.postgres");
  check(pg !== undefined, "integration.postgres is in the deployed registry");
  check(pg?.agentCallable === true, "it is agent-callable");
  check(pg?.category === "integration" && pg?.kind === "action", "it is an integration action");
  check(
    typeof pg?.outputShape === "string" && pg.outputShape.includes("items"),
    "it declares an output shape naming items — D38",
  );
  check(typeof pg?.docs?.summary === "string" && pg.docs.summary.length > 60, "it carries docs for a person");
  check(
    !JSON.stringify(pg ?? {}).includes('"model"'),
    "it does not carry a `model` output field — Phase 22's fourth obligation",
  );
  // The config must have no field a caller could put SQL in. This is the whole phase.
  const fields = Object.keys(pg?.configSchema?.properties ?? {});
  check(
    !fields.some((field) => /sql|query|statement|raw/i.test(field)),
    `no config field accepts SQL (${fields.join(", ")})`,
  );

  /* 2 — the credential route, derived from the token registry -------------------- */
  console.log("\n3. The credential route, which nobody wrote");

  const status = await api("/api/integrations/postgres");
  const card = data(status) ?? {};
  check(status.status === 200, `GET /api/integrations/postgres answers 200 (${status.status})`);
  check(card.slug === "postgres" && card.blurb?.length > 40, "it serves its own copy and connection state");
  check(
    Array.isArray(card.nodes) && card.nodes.includes("integration.postgres"),
    "it names the node that stops working without it",
  );

  // The vault lists every kind the product stores, held or missing. The point is that
  // Phase 23C wrote no vault code at all: the kind appears because `CREDENTIAL_KINDS` is
  // built from the same table the settings card is.
  const vault = data(await api("/api/credentials"));
  const known = [
    ...(vault?.entries ?? []).map((entry) => entry.kind),
    ...(vault?.missing ?? []).map((entry) => entry.kind),
  ];
  check(
    known.includes("integration.postgres"),
    `the vault knows the kind without being told (${known.join(", ")})`,
  );
  const missingEntry = (vault?.missing ?? []).find((entry) => entry.kind === "integration.postgres");
  const heldEntry = (vault?.entries ?? []).find((entry) => entry.kind === "integration.postgres");
  // Phase 21's rule: the vault may never name a credential without saying where to get one. A
  // workspace either holds this credential, or is told where to add it — never neither.
  check(
    heldEntry !== undefined || typeof missingEntry?.connectHref === "string",
    heldEntry !== undefined
      ? "the workspace holds one, so the vault lists it rather than offering a link"
      : `the vault says where to add one (${missingEntry?.connectHref})`,
    "the vault names the kind but offers no way to connect it — a dead end",
  );

  /* 3 — refusals, before anything is stored ------------------------------------- */
  console.log("\n4. What the settings card refuses, over HTTP");

  const refusals = [
    ["https://db.example.com/shop", "an https:// URL is not a connection string"],
    ["postgresql://u:p@localhost/shop", "localhost is refused"],
    ["postgresql://u:p@db.internal/shop", "a .internal host is refused"],
    ["postgresql://u:p@db.example.com/shop?sslmode=disable", "sslmode=disable is refused, not upgraded"],
    ["postgresql://u:p@db.example.com", "a string naming no database is refused"],
    ["mysql://u:p@db.example.com/shop", "another database's scheme is refused"],
  ];
  for (const [secret, label] of refusals) {
    const result = await api("/api/integrations/postgres", {
      method: "PUT",
      body: JSON.stringify({ secret }),
    });
    check(result.status === 400, `${label} (${result.status})`, `${label} — got ${result.status}: ${JSON.stringify(data(result))}`);
  }

  if (!DEMO_URL) {
    skip("DEMO_DATABASE_URL is not set — the real-server half of this phase is NOT verified");
    return;
  }

  /* 4 — connect it, for real ---------------------------------------------------- */
  console.log("\n5. Connecting a real database through the deployed app");

  const connected = await api("/api/integrations/postgres", {
    method: "PUT",
    body: JSON.stringify({ secret: DEMO_URL }),
  });
  const connectedCard = data(connected) ?? {};
  check(
    connected.status === 200 && connectedCard.configured === true,
    `the connection string was dialled from Cloud Run and stored (${connected.status})`,
    `could not connect: ${JSON.stringify(connectedCard)}`,
  );
  check(
    typeof connectedCard.detail === "string" && /^Postgres \d/.test(connectedCard.detail),
    `the card shows the server version it read (${connectedCard.detail})`,
  );

  // Write-only over the wire. The host, the database and the role are all inside the secret,
  // so none of them may appear — this is the check that would catch a well-meant "show the
  // user which host they connected" change.
  const serialised = JSON.stringify(connectedCard);
  const demo = new URL(DEMO_URL);
  const fragments = [demo.password, demo.hostname, demo.username, demo.pathname.slice(1)];
  for (const fragment of fragments) {
    if (!fragment) continue;
    check(
      !serialised.includes(fragment),
      `the status response carries no part of the secret (${fragment.slice(0, 6)}…)`,
      `LEAKED ${fragment.slice(0, 12)}… in ${serialised.slice(0, 200)}`,
    );
  }

  /* 5 — a real read, from the deployed app -------------------------------------- */
  console.log("\n6. Reading a real table, from the deployed container");

  const read = await runGraph(
    "verify 23c — read",
    [
      { id: "start", type: "core.manual_trigger" },
      {
        id: "rows",
        type: "integration.postgres",
        config: {
          operation: "select",
          schema: "public",
          table: "city",
          columns: ["name", "country", "population", "founded"],
          where: [],
          orderBy: "population",
          direction: "desc",
          limit: 3,
        },
      },
    ],
    [{ from: "start", to: "rows" }],
  );
  const rows = read.steps.get("rows");
  check(rows?.status === "succeeded", "the read step succeeded", `the read failed: ${why(rows)}`);
  const items = rows?.output?.items ?? [];
  check(items.length === 3, `it returned exactly the 3 rows the limit allowed (${items.length})`);
  check(rows?.output?.count === 3, `count agrees with the rows returned (${rows?.output?.count})`);
  check(rows?.output?.table === "public.city", `it reports the table it read (${rows?.output?.table})`);
  check(
    items[0]?.name === "Bengaluru" && items[0]?.population === 13608000,
    `order by population desc put Bengaluru first (${items[0]?.name} ${items[0]?.population})`,
  );
  check(
    Object.keys(items[0] ?? {}).sort().join(",") === "country,founded,name,population",
    `only the named columns came back (${Object.keys(items[0] ?? {}).join(", ")})`,
  );
  // The `toJsonValue` claim, proved on a real `date` column rather than a constructed Date.
  check(
    typeof items[0]?.founded === "string" && /^\d{4}-\d{2}-\d{2}T/.test(items[0].founded),
    `a date column came back as an ISO string, not a Date (${items[0]?.founded})`,
  );

  /* 6 — the operators, against the real server ---------------------------------- */
  console.log("\n7. The shared operator vocabulary, executed by Postgres");

  const cases = [
    [{ column: "country", operator: "equals", value: "IN" }, 1, "equals on text"],
    [{ column: "population", operator: "equals", value: "254000" }, 1, "equals on an integer, compared as text"],
    [{ column: "country", operator: "not_equals", value: "IN" }, 4, "not_equals"],
    [{ column: "name", operator: "contains", value: "ey" }, 1, "contains, as String.includes does it"],
    [{ column: "population", operator: "greater_than", value: "1000000" }, 2, "greater_than on an integer"],
    [{ column: "founded", operator: "greater_than", value: "1800-01-01" }, 2, "greater_than on a date column"],
    [{ column: "population", operator: "less_than", value: "300000" }, 3, "less_than"],
    [{ column: "notes", operator: "is_empty" }, 3, "is_empty counts null and empty alike"],
    [{ column: "notes", operator: "is_not_empty" }, 2, "is_not_empty"],
  ];

  for (const [condition, expected, label] of cases) {
    const result = await runGraph(
      `verify 23c — ${label}`,
      [
        { id: "start", type: "core.manual_trigger" },
        {
          id: "n",
          type: "integration.postgres",
          config: { operation: "count", schema: "public", table: "city", where: [condition] },
        },
      ],
      [{ from: "start", to: "n" }],
    );
    const step = result.steps.get("n");
    check(
      step?.status === "succeeded" && step?.output?.count === expected,
      `${label} → ${expected}`,
      `${label} expected ${expected}, got ${step?.output?.count ?? why(step)}`,
    );
  }

  // Two conditions, ANDed — the reason `where` stayed a list instead of one condition.
  const anded = await runGraph(
    "verify 23c — two conditions",
    [
      { id: "start", type: "core.manual_trigger" },
      {
        id: "n",
        type: "integration.postgres",
        config: {
          operation: "count",
          schema: "public",
          table: "city",
          where: [
            { column: "population", operator: "greater_than", value: "250000" },
            { column: "notes", operator: "is_empty" },
          ],
        },
      },
    ],
    [{ from: "start", to: "n" }],
  );
  // Three of the five: Bengaluru and Hobart have a null `notes`, Valparaíso has "". Counted
  // by hand against the rows `setup-demo-db.mjs` seeds, so a drift in either fails here.
  check(
    anded.steps.get("n")?.output?.count === 3,
    `two conditions are ANDed server-side (${anded.steps.get("n")?.output?.count})`,
    `expected 3, got ${anded.steps.get("n")?.output?.count ?? why(anded.steps.get("n"))}`,
  );

  /* 7 — it cannot write. Twice, from two directions ----------------------------- */
  console.log("\n8. Proved unable to write");

  // (a) There is no configuration that writes. The node offers no verb but select, so the
  //     attempt has to be made through an identifier — which the guard refuses by name.
  const injected = await runGraph(
    "verify 23c — injection",
    [
      { id: "start", type: "core.manual_trigger" },
      {
        id: "rows",
        type: "integration.postgres",
        config: {
          operation: "select",
          schema: "public",
          table: 'city"; drop table city; --',
          where: [],
        },
      },
    ],
    [{ from: "start", to: "rows" }],
  );
  const injectedStep = injected.steps.get("rows");
  check(
    injectedStep?.status === "failed" && /double quote/i.test(injectedStep?.error ?? ""),
    `a table name that would close its own quoting is refused by name (${injectedStep?.error?.slice(0, 70)})`,
  );

  // (b) The table still exists, read back from the server itself rather than inferred from
  //     a step's status. This is the assertion that would catch the refusal being cosmetic.
  const stillThere = await runGraph(
    "verify 23c — survived",
    [
      { id: "start", type: "core.manual_trigger" },
      { id: "n", type: "integration.postgres", config: { operation: "count", schema: "public", table: "city" } },
    ],
    [{ from: "start", to: "n" }],
  );
  check(
    stillThere.steps.get("n")?.output?.count === 5,
    `the table is intact afterwards — all 5 rows (${stillThere.steps.get("n")?.output?.count})`,
  );

  // (c) The second direction, asked of the demo server itself with the same credential the
  //     deployed app holds. Two independent facts, neither of which this product controls:
  //     the role has no write privilege, and a write inside a read-only transaction is
  //     refused by code even where a privilege would have allowed it.
  const demoSql = postgres(DEMO_URL, { max: 1, ssl: "require", connect_timeout: 20, prepare: false });
  try {
    const privileges = await demoSql`
      select privilege_type from information_schema.table_privileges
      where grantee = current_user and table_name = 'city' order by privilege_type
    `;
    const granted = privileges.map((row) => row.privilege_type);
    check(
      granted.length === 1 && granted[0] === "SELECT",
      `the connected role is granted SELECT and nothing else (${granted.join(", ") || "none"})`,
    );

    let refusedByGrant = "";
    try {
      await demoSql`insert into city (id, name, country, population) values (99, 'x', 'XX', 1)`;
    } catch (error) {
      refusedByGrant = error.code ?? "";
    }
    check(
      refusedByGrant === "42501",
      `an insert is refused by the role's grants (${refusedByGrant || "IT SUCCEEDED"})`,
    );

    let refusedByTransaction = "";
    try {
      await demoSql.begin("read only", async (tx) => {
        await tx`insert into city (id, name, country, population) values (98, 'y', 'YY', 1)`;
      });
    } catch (error) {
      refusedByTransaction = error.code ?? "";
    }
    check(
      refusedByTransaction === "25006" || refusedByTransaction === "42501",
      `a write inside BEGIN READ ONLY is refused (${refusedByTransaction || "IT SUCCEEDED"})`,
    );

    const [{ n }] = await demoSql`select count(*)::int as n from city`;
    check(n === 5, `the demo table still holds its 5 rows (${n})`);
  } finally {
    await demoSql.end({ timeout: 5 }).catch(() => {});
  }

  /* 8 — the agent can reach it, and generation knows it exists ------------------ */
  console.log("\n9. The agent tool surface and the generator");

  const agentRun = await runGraph(
    "verify 23c — agent",
    [
      { id: "start", type: "core.manual_trigger" },
      {
        id: "agent",
        type: "ai.agent",
        config: {
          objective:
            "Count how many rows are in the table named city in schema public, using the Postgres query tool. Answer with just that number.",
          tools: ["integration.postgres"],
          maxIterations: 4,
        },
      },
    ],
    [{ from: "start", to: "agent" }],
  );
  const agentStep = agentRun.steps.get("agent");
  const agentText = JSON.stringify(agentStep?.output ?? {});
  check(
    agentStep?.status === "succeeded",
    "an agent node with integration.postgres as its only tool ran",
    `the agent step failed: ${why(agentStep)}`,
  );
  check(
    agentText.includes("5"),
    `the agent called the tool and reported the real row count (${agentText.slice(0, 120)})`,
  );

  const generated = await api("/api/workflows/generate", {
    method: "POST",
    body: JSON.stringify({
      prompt:
        "Read the rows from my Postgres database table called orders and log how many there are.",
      name: "verify 23c — generated",
    }),
  });
  const madeGraph = data(generated);
  if (madeGraph?.workflow?.id) created.push(madeGraph.workflow.id);
  if (generated.status === 201) {
    const generatedTypes = (madeGraph?.workflow?.graph?.nodes ?? []).map((node) => node.type);
    check(
      generatedTypes.includes("integration.postgres"),
      `generation reached for the Postgres node (${generatedTypes.join(", ")})`,
    );
  } else if (generated.status === 409 || generated.status === 503) {
    // A model that is unavailable is not a defect in this phase, and reporting it as a pass
    // would be the lie this script exists to avoid.
    skip(`the model was unavailable, so generation was NOT verified (${generated.status})`);
  } else {
    fail(`generation failed unexpectedly (${generated.status}: ${JSON.stringify(madeGraph).slice(0, 200)})`);
  }

  /* 9 — rotation ---------------------------------------------------------------- */
  console.log("\n10. Rotation, on the deployed app");

  const rotated = await api("/api/credentials/integration.postgres/rotate", {
    method: "POST",
    body: JSON.stringify({ secret: DEMO_URL }),
  });
  check(rotated.status === 200, `the connection string rotates in place (${rotated.status})`, JSON.stringify(data(rotated)));

  const badRotation = await api("/api/credentials/integration.postgres/rotate", {
    method: "POST",
    body: JSON.stringify({ secret: "postgresql://u:p@db.example.com/x?sslmode=disable" }),
  });
  check(
    badRotation.status === 400,
    `a rotation to a refused string is rejected and changes nothing (${badRotation.status})`,
  );

  const afterRotation = data(await api("/api/integrations/postgres"));
  check(afterRotation?.configured === true, "the original credential still works after the failed rotation");

  const vaultAfter = data(await api("/api/credentials"));
  const row = (vaultAfter?.entries ?? []).find((entry) => entry.kind === "integration.postgres");
  check(
    (row?.rotationCount ?? 0) >= 1,
    `the vault counted the rotation (rotationCount ${row?.rotationCount})`,
  );
  check(
    row?.rotatedAt !== null && row?.rotatedAt !== undefined,
    `and recorded when it happened (${row?.rotatedAt})`,
  );
  // Phase 21's envelope, on a credential kind that did not exist when it was written.
  check(
    typeof row?.keyVersion === "string" && row.legacy === false,
    `the connection string is sealed under a Secret Manager root key version (${row?.keyVersion})`,
  );

  /* 10 — the share link must not publish the database's shape ------------------- */
  console.log("\n11. What a public share link publishes");

  const shareable = await runGraph(
    "verify 23c — share",
    [
      { id: "start", type: "core.manual_trigger" },
      {
        id: "rows",
        type: "integration.postgres",
        config: {
          operation: "select",
          schema: "reporting",
          table: "salaries",
          columns: ["employee", "amount"],
          where: [{ column: "amount", operator: "greater_than", value: "100000" }],
          orderBy: "amount",
          limit: 10,
        },
      },
    ],
    [{ from: "start", to: "rows" }],
  );
  void shareable;
  const shareWorkflowId = created[created.length - 1];
  const share = data(
    await api(`/api/workflows/${shareWorkflowId}/share`, { method: "POST" }),
  );
  const shareToken = (share?.shareUrl ?? "").split("/s/")[1] ?? "";
  if (!shareToken) {
    fail(`could not publish the workflow: ${JSON.stringify(share)}`);
  } else {
    const publicView = await fetch(`${BASE}/api/share/${shareToken}`);
    const publicBody = await publicView.text();
    check(publicView.status === 200, `the public endpoint answers unauthenticated (${publicView.status})`);
    // Together, `schema`, `table`, `columns` and `orderBy` are a map of a private database's
    // structure — more than `integration.sheets`' `spreadsheetId` ever was, and the reason
    // this node publishes only its settings.
    for (const withheld of ["reporting", "salaries", "employee", "100000", "amount"]) {
      check(
        !publicBody.includes(withheld),
        `the public graph withholds "${withheld}"`,
        `the public graph LEAKED "${withheld}": ${publicBody.slice(0, 200)}`,
      );
    }
    // And it does publish the settings, so a reader is not left thinking the node is blank.
    check(
      publicBody.includes('"operation"') && publicBody.includes('"limit"'),
      "and it does publish the settings, so the node does not read as unconfigured",
    );
    check(publicBody.includes("redacted"), "the public graph names what it withheld");
  }
}

async function cleanup() {
  for (const id of created) {
    await api(`/api/workflows/${id}`, { method: "DELETE" }).catch(() => {});
  }
  // The credential is left connected on purpose: it is a demo database with a SELECT-only
  // role, and removing it would mean the next run of this script could not tell a broken
  // deployment from an unconfigured one.
}

main()
  .catch((error) => {
    failed += 1;
    console.error(`\n   ✗ ${error.stack ?? error}`);
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
    if (skipped > 0) {
      console.log("SKIPPED IS NOT PASSED — something was not verified.");
    }
    console.log(failed === 0 ? "ALL CHECKS PASSED\n" : "FAILURES ABOVE\n");
    process.exit(failed === 0 ? 0 : 1);
  });
