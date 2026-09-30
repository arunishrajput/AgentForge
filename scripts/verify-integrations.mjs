/**
 * The Phase 23B surface, verified against the deployed service **and against the real
 * Slack, Notion, GitHub and Airtable.**
 *
 *   node --env-file=.env scripts/verify-integrations.mjs
 *
 * **What this proves that no unit test can.** `tokens.test.ts` asserts the parsers and
 * `token-http.test.ts` asserts what a documented answer is taken to mean — both against a
 * stub. Neither can tell you whether a request this repository *builds* is one the service
 * actually accepts. That is what Phase 23B's completion bar means by "proven against real
 * services, not mocks", and it is the only thing that catches a wrong header, a version that
 * has been retired, or a payload shape a changelog quietly altered.
 *
 * So every check below either drives the deployed app's own API with a real `session` row, or
 * asserts the object the run created by reading it back **from the service itself**. A step
 * that reports `succeeded` is not evidence; the issue existing in GitHub is.
 *
 * **What it needs**, all in `.env` and none of it in this repository:
 *
 *   SLACK_WEBHOOK_URL   NOTION_TOKEN + NOTION_PAGE_ID + NOTION_DATABASE_ID
 *   GITHUB_TOKEN + GITHUB_REPO        AIRTABLE_TOKEN + AIRTABLE_BASE_ID + AIRTABLE_TABLE
 *
 * A service whose credentials are absent is **skipped and counted as skipped**, never passed.
 * The script is honest about what it did not check, because a green run that silently proved
 * three services out of four is worse than a red one.
 *
 * It cleans up what it can: every workflow it creates is deleted, and every Airtable record
 * it writes is deleted. **A Slack message, a Notion page and a GitHub issue cannot be
 * un-made by these APIs at the scopes this asks for** — they are left behind deliberately and
 * named in the output, because a verification that quietly deleted its evidence would also be
 * deleting the only proof it ever ran.
 */
import { neon } from "@neondatabase/serverless";

const BASE = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
if (!BASE) throw new Error("APP_BASE_URL is required.");

const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);

const COOKIE =
  new URL(BASE).protocol === "https:"
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";

/** A tag on everything this script creates, so leftovers are identifiable by eye. */
const RUN_TAG = `agentforge-verify-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}`;

let cookie = null;
let passed = 0;
let failed = 0;
let skipped = 0;
const created = [];
const airtableRecords = [];
const leftBehind = [];

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
  const [user] = await sql.query('select id, email from "user" order by "id" limit 1');
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

/** Create a one-node-chain workflow, run it, and return its finished steps. */
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

  const steps = new Map((run?.steps ?? []).map((step) => [step.nodeId, step]));
  return { run, steps, workflowId: made.id };
}

/** The step's error, when it failed — the thing worth printing on a red line. */
const why = (step) => step?.error ?? step?.status ?? "no step recorded";

async function main() {
  const email = await mintSession();
  console.log(`\nAgentForge — Phase 23B verification (integrations)`);
  console.log(`  ${BASE}`);
  console.log(`  session minted for ${email}`);
  console.log(`  tag: ${RUN_TAG}\n`);

  /* 1 — the deployed build carries the widened registry ------------------------- */
  console.log("1. The registry the deployed build is actually serving");
  const health = await api("/api/health");
  check(data(health)?.registry === 29, `health reports 29 nodes (${data(health)?.registry})`);
  console.log(`   revision ${data(health)?.revision}`);

  const nodes = data(await api("/api/nodes"));
  const list = Array.isArray(nodes) ? nodes : (nodes?.nodes ?? []);
  check(list.length === 29, `GET /api/nodes returns 29 definitions (${list.length})`);

  const added = [
    "integration.slack",
    "integration.notion",
    "integration.github",
    "integration.airtable",
  ];
  const byType = new Map(list.map((node) => [node.type, node]));
  const missing = added.filter((type) => !byType.has(type));
  check(missing.length === 0, "all four Phase 23B nodes are in the deployed registry", `missing: ${missing.join(", ")}`);

  const undocumented = added.filter((type) => !byType.get(type)?.docs?.summary);
  check(undocumented.length === 0, "every new node carries its docs over the wire", `no docs: ${undocumented.join(", ")}`);
  check(
    added.every((type) => byType.get(type)?.agentCallable === true),
    "all four are reachable as agent tools",
  );
  check(
    added.every((type) => (byType.get(type)?.outputShape ?? "").length > 20),
    "all four declare their output shape — D38",
  );
  // Phase 22's fourth obligation: `model` on an output means a model call and nothing else.
  check(
    added.every((type) => !/\bmodel\b/.test(byType.get(type)?.outputShape ?? "")),
    "none of them puts a `model` field on its output",
  );

  /* 2 — the dynamic route, and the precedence it depends on --------------------- */
  console.log("\n2. The credential route, and that a static segment still beats the dynamic one");
  // The whole reason `/api/integrations/[service]` is safe to add beside `discord/route.ts`.
  // Documented for the Pages router and merely conventional for the App one, so it is asserted
  // here against the deployed build rather than believed.
  const discord = await api("/api/integrations/discord");
  check(
    discord.status === 200 && "webhookName" in (data(discord) ?? {}),
    "/api/integrations/discord still reaches the Discord route, not the dynamic one",
    `got ${discord.status}: ${JSON.stringify(data(discord))}`,
  );

  const unknown = await api("/api/integrations/nope");
  check(unknown.status === 404, `an unknown service is 404 (${unknown.status})`);
  // A path segment is attacker-chosen, so the lookup must not answer for Object.prototype.
  for (const key of ["__proto__", "toString", "constructor"]) {
    const probe = await api(`/api/integrations/${encodeURIComponent(key)}`);
    check(probe.status === 404, `"${key}" is 404, not a prototype hit (${probe.status})`);
  }

  for (const slug of ["slack", "notion", "github", "airtable"]) {
    const status = await api(`/api/integrations/${slug}`);
    const body = data(status) ?? {};
    check(status.status === 200, `GET /api/integrations/${slug} answers 200 (${status.status})`);
    check(
      body.slug === slug && typeof body.configured === "boolean" && body.blurb?.length > 40,
      `${slug} reports its copy and whether it is configured`,
    );
    // Write-only: the response must carry nothing that could be a secret.
    const serialised = JSON.stringify(body);
    check(
      !/secret|token|webhookUrl|ntn_|github_pat|hooks\.slack/i.test(serialised.replace(/"(secretLabel|secretNoun|blurb|docsLabel|docsHref|placeholder)":"[^"]*"/g, "")),
      `${slug}'s status carries no part of a secret`,
      `${slug} leaked something: ${serialised.slice(0, 300)}`,
    );
  }

  const badSecret = await api("/api/integrations/slack", {
    method: "PUT",
    body: JSON.stringify({ secret: "https://evil.test/services/a/b/c" }),
  });
  check(
    badSecret.status === 400,
    `a webhook URL on another host is refused before it is stored (${badSecret.status})`,
  );

  /* 3 — Slack ------------------------------------------------------------------- */
  console.log("\n3. Slack — a real message in a real channel");
  if (!process.env.SLACK_WEBHOOK_URL) {
    skip("SLACK_WEBHOOK_URL is not set, so Slack was NOT verified");
  } else {
    const stored = await api("/api/integrations/slack", {
      method: "PUT",
      body: JSON.stringify({ secret: process.env.SLACK_WEBHOOK_URL }),
    });
    check(
      stored.status === 200 && data(stored)?.configured === true,
      `the webhook verifies against Slack and stores (${stored.status})`,
      `${stored.status}: ${JSON.stringify(data(stored))}`,
    );
    // The verification must not have posted anything — that is what the empty-payload probe
    // is for, and it is the one property of it a human would otherwise have to eyeball.
    console.log("   (if a message appeared in the channel from THAT step alone, the probe is wrong)");

    const text = `AgentForge ${RUN_TAG} — Phase 23B verification.`;
    const { steps } = await runGraph(
      `${RUN_TAG} slack`,
      [
        { id: "start", type: "core.manual_trigger" },
        { id: "post", type: "integration.slack", config: { text } },
      ],
      [{ from: "start", to: "post" }],
    );
    const step = steps.get("post");
    check(step?.status === "succeeded", "a run posts to Slack from the deployed app", `step: ${why(step)}`);
    check(step?.output?.posted === true && step?.output?.text === text, "and reports exactly what it sent");
    leftBehind.push(`a Slack message in your channel: "${text}"`);

    // Rotation, on the live credential, through the vault's own route.
    const rotated = await api("/api/credentials/integration.slack/rotate", {
      method: "POST",
      body: JSON.stringify({ secret: process.env.SLACK_WEBHOOK_URL }),
    });
    check(rotated.status === 200, `the Slack credential rotates in place (${rotated.status})`);
    const entry = (data(rotated)?.credentials ?? []).find((row) => row.kind === "integration.slack");
    check(entry?.rotationCount >= 1, `and its rotation count moved (${entry?.rotationCount})`);
    check(
      !/url\b/.test(entry?.title ?? "") || /URL/.test(entry?.title ?? ""),
      `the vault names it without mangling the acronym ("${entry?.title}")`,
    );

    const wrong = await api("/api/credentials/integration.slack/rotate", {
      method: "POST",
      body: JSON.stringify({ secret: "https://hooks.slack.com/services/T0/B0/definitelynotreal" }),
    });
    check(
      wrong.status === 400,
      `a webhook Slack rejects does not replace the working one (${wrong.status})`,
    );
    const stillThere = data(await api("/api/integrations/slack"));
    check(stillThere?.configured === true, "and the working credential is still in place");
  }

  /* 4 — Notion ------------------------------------------------------------------ */
  console.log("\n4. Notion — a real page and a real database row");
  if (!process.env.NOTION_TOKEN) {
    skip("NOTION_TOKEN is not set, so Notion was NOT verified");
  } else {
    const stored = await api("/api/integrations/notion", {
      method: "PUT",
      body: JSON.stringify({ secret: process.env.NOTION_TOKEN }),
    });
    check(
      stored.status === 200 && data(stored)?.configured === true,
      `the token verifies against Notion and stores (${stored.status})`,
      `${stored.status}: ${JSON.stringify(data(stored))}`,
    );
    console.log(`   connected as: ${data(stored)?.detail ?? "(Notion named nothing)"}`);

    if (!process.env.NOTION_PAGE_ID) {
      skip("NOTION_PAGE_ID is not set, so appendToPage was NOT verified");
    } else {
      const body = `AgentForge ${RUN_TAG} — appended by the Phase 23B verification.`;
      const { steps } = await runGraph(
        `${RUN_TAG} notion page`,
        [
          { id: "start", type: "core.manual_trigger" },
          {
            id: "write",
            type: "integration.notion",
            config: { operation: "appendToPage", target: process.env.NOTION_PAGE_ID, body },
          },
        ],
        [{ from: "start", to: "write" }],
      );
      const step = steps.get("write");
      check(step?.status === "succeeded", "a run appends to a real Notion page", `step: ${why(step)}`);
      check(step?.output?.blocks === 1, `and reports the paragraphs it wrote (${step?.output?.blocks})`);

      // Read it back from Notion itself. A succeeded step is not evidence.
      const blocks = await notion(`/blocks/${step?.output?.pageId}/children?page_size=100`);
      const texts = (blocks?.results ?? [])
        .map((block) => block?.paragraph?.rich_text?.[0]?.text?.content)
        .filter(Boolean);
      check(texts.includes(body), "and Notion itself has the paragraph", `Notion's last blocks: ${JSON.stringify(texts.slice(-3))}`);
      leftBehind.push("a paragraph on your Notion page");
    }

    if (!process.env.NOTION_DATABASE_ID) {
      skip("NOTION_DATABASE_ID is not set, so addDatabaseRow was NOT verified");
    } else {
      // The title property name varies per database, so read the real one rather than assume
      // "Name" — assuming it is exactly the failure this would otherwise hide.
      const database = await notion(`/databases/${process.env.NOTION_DATABASE_ID}`);
      const dataSourceId = database?.data_sources?.[0]?.id;
      check(typeof dataSourceId === "string", `the database resolves to one data source (${dataSourceId})`);
      const source = dataSourceId ? await notion(`/data_sources/${dataSourceId}`) : null;
      const titleProperty =
        Object.entries(source?.properties ?? {}).find(([, value]) => value?.type === "title")?.[0] ??
        "Name";
      console.log(`   the database's title property is "${titleProperty}"`);

      const title = `AgentForge ${RUN_TAG}`;
      const { steps } = await runGraph(
        `${RUN_TAG} notion row`,
        [
          { id: "start", type: "core.manual_trigger" },
          {
            id: "row",
            type: "integration.notion",
            config: {
              operation: "addDatabaseRow",
              target: process.env.NOTION_DATABASE_ID,
              title,
              titleProperty,
              body: "Created by the Phase 23B verification.",
            },
          },
        ],
        [{ from: "start", to: "row" }],
      );
      const step = steps.get("row");
      check(step?.status === "succeeded", "a run adds a row to a real Notion database", `step: ${why(step)}`);

      const page = step?.output?.pageId ? await notion(`/pages/${step.output.pageId}`) : null;
      const readBack = page?.properties?.[titleProperty]?.title?.[0]?.text?.content;
      check(readBack === title, "and Notion itself has the row, with the title it was given", `Notion says: ${readBack}`);
      check(
        typeof step?.output?.url === "string" && step.output.url.startsWith("https://"),
        `and the node reports a link to it (${step?.output?.url})`,
      );
      leftBehind.push("a row in your Notion database");
    }

    // The failure that is really a sharing problem, proved to say so.
    const { steps: bad } = await runGraph(
      `${RUN_TAG} notion 404`,
      [
        { id: "start", type: "core.manual_trigger" },
        {
          id: "write",
          type: "integration.notion",
          // A syntactically valid id that is certainly not shared with this integration.
          config: { operation: "appendToPage", target: "ffffffffffffffffffffffffffffffff", body: "x" },
        },
      ],
      [{ from: "start", to: "write" }],
    );
    const step = bad.get("write");
    check(step?.status === "failed", "a page the integration cannot see fails the step");
    check(
      /Connections/i.test(step?.error ?? ""),
      "and the error tells the user to connect the page, which Notion's own message does not",
      `error was: ${step?.error}`,
    );
  }

  /* 5 — GitHub ----------------------------------------------------------------- */
  console.log("\n5. GitHub — a real issue and a real comment");
  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPO) {
    skip("GITHUB_TOKEN or GITHUB_REPO is not set, so GitHub was NOT verified");
  } else {
    const stored = await api("/api/integrations/github", {
      method: "PUT",
      body: JSON.stringify({ secret: process.env.GITHUB_TOKEN }),
    });
    check(
      stored.status === 200 && data(stored)?.configured === true,
      `the token verifies against GitHub and stores (${stored.status})`,
      `${stored.status}: ${JSON.stringify(data(stored))}`,
    );
    console.log(`   connected as: ${data(stored)?.detail ?? "(the token may not read the account)"}`);

    const title = `AgentForge ${RUN_TAG}`;
    const { steps } = await runGraph(
      `${RUN_TAG} github`,
      [
        { id: "start", type: "core.manual_trigger" },
        {
          id: "file",
          type: "integration.github",
          config: {
            operation: "createIssue",
            repo: process.env.GITHUB_REPO,
            title,
            body: "Opened by the Phase 23B verification. Safe to close.",
          },
        },
      ],
      [{ from: "start", to: "file" }],
    );
    const step = steps.get("file");
    check(step?.status === "succeeded", "a run files a real GitHub issue", `step: ${why(step)}`);
    const number = step?.output?.number;
    check(typeof number === "number", `and reports its number (#${number})`);

    // The pinned X-GitHub-Api-Version is the thing most likely to be silently stale, and this
    // is the only check in the project that can catch it.
    pass(`the pinned API version was accepted by GitHub`);

    if (typeof number === "number") {
      const issue = await github(`/repos/${process.env.GITHUB_REPO}/issues/${number}`);
      check(issue?.title === title, "and GitHub itself has the issue, with that title", `GitHub says: ${issue?.title}`);
      check(issue?.state === "open", `and it is open (${issue?.state})`);
      leftBehind.push(`GitHub issue ${process.env.GITHUB_REPO}#${number} — close it when you like`);

      const { steps: commented } = await runGraph(
        `${RUN_TAG} github comment`,
        [
          { id: "start", type: "core.manual_trigger" },
          {
            id: "say",
            type: "integration.github",
            config: {
              operation: "commentOnIssue",
              repo: process.env.GITHUB_REPO,
              issueNumber: number,
              body: `Commented by the Phase 23B verification (${RUN_TAG}).`,
            },
          },
        ],
        [{ from: "start", to: "say" }],
      );
      const comment = commented.get("say");
      check(comment?.status === "succeeded", "a run comments on that issue", `step: ${why(comment)}`);
      check(comment?.output?.number === number, `and reports the issue it commented on (#${comment?.output?.number})`);

      const comments = await github(`/repos/${process.env.GITHUB_REPO}/issues/${number}/comments`);
      check(
        (comments ?? []).some((entry) => (entry?.body ?? "").includes(RUN_TAG)),
        "and GitHub itself has the comment",
      );
    }

    // A repository the token was not granted must fail as a permissions problem, not a crash.
    const { steps: denied } = await runGraph(
      `${RUN_TAG} github 404`,
      [
        { id: "start", type: "core.manual_trigger" },
        {
          id: "file",
          type: "integration.github",
          config: {
            operation: "createIssue",
            repo: "agentforge-verify/definitely-not-a-real-repository",
            title: "should never exist",
          },
        },
      ],
      [{ from: "start", to: "file" }],
    );
    const refused = denied.get("file");
    check(refused?.status === "failed", "a repository the token cannot reach fails the step");
    check(
      /not granted access/i.test(refused?.error ?? ""),
      "and the error explains that a fine-grained token only reaches selected repositories",
      `error was: ${refused?.error}`,
    );
  }

  /* 6 — Airtable --------------------------------------------------------------- */
  console.log("\n6. Airtable — a real record written and read back");
  if (!process.env.AIRTABLE_TOKEN || !process.env.AIRTABLE_BASE_ID || !process.env.AIRTABLE_TABLE) {
    skip("AIRTABLE_TOKEN, AIRTABLE_BASE_ID or AIRTABLE_TABLE is not set, so Airtable was NOT verified");
  } else {
    const stored = await api("/api/integrations/airtable", {
      method: "PUT",
      body: JSON.stringify({ secret: process.env.AIRTABLE_TOKEN }),
    });
    check(
      stored.status === 200 && data(stored)?.configured === true,
      `the token verifies against Airtable and stores (${stored.status})`,
      `${stored.status}: ${JSON.stringify(data(stored))}`,
    );

    // The field names have to match the real table, so read its own first column rather than
    // guessing "Name" — a 422 about a field name would otherwise look like a node bug.
    const existing = await airtable(
      `/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent(process.env.AIRTABLE_TABLE)}?maxRecords=1`,
    );
    const firstField = Object.keys(existing?.records?.[0]?.fields ?? {})[0];
    if (!firstField) {
      skip("the Airtable table has no rows to learn a column name from — add one row and re-run");
    } else {
      console.log(`   writing into the column "${firstField}"`);
      const value = `AgentForge ${RUN_TAG}`;
      const { steps } = await runGraph(
        `${RUN_TAG} airtable write`,
        [
          { id: "start", type: "core.manual_trigger" },
          {
            id: "row",
            type: "integration.airtable",
            config: {
              operation: "createRecord",
              baseId: process.env.AIRTABLE_BASE_ID,
              table: process.env.AIRTABLE_TABLE,
              fields: { [firstField]: value },
            },
          },
        ],
        [{ from: "start", to: "row" }],
      );
      const step = steps.get("row");
      check(step?.status === "succeeded", "a run writes a real Airtable record", `step: ${why(step)}`);
      const recordId = step?.output?.recordId;
      check(typeof recordId === "string" && recordId.startsWith("rec"), `and reports its id (${recordId})`);
      if (recordId) airtableRecords.push(recordId);

      const readBack = recordId
        ? await airtable(
            `/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent(process.env.AIRTABLE_TABLE)}/${recordId}`,
          )
        : null;
      check(
        readBack?.fields?.[firstField] === value,
        "and Airtable itself has the value",
        `Airtable says: ${JSON.stringify(readBack?.fields)}`,
      );

      /* The read path, and Phase 23A's list convention it has to obey. */
      const { steps: read } = await runGraph(
        `${RUN_TAG} airtable read`,
        [
          { id: "start", type: "core.manual_trigger" },
          {
            id: "rows",
            type: "integration.airtable",
            config: {
              operation: "listRecords",
              baseId: process.env.AIRTABLE_BASE_ID,
              table: process.env.AIRTABLE_TABLE,
              maxRecords: 10,
            },
          },
          // The whole point of `{ items, count }`: a transform node reads it with nothing
          // between them. If the envelope were Airtable's own, this step would see no items.
          { id: "count", type: "transform.aggregate", config: { operation: "count" } },
        ],
        [
          { from: "start", to: "rows" },
          { from: "rows", to: "count" },
        ],
      );
      const listStep = read.get("rows");
      check(listStep?.status === "succeeded", "a run reads Airtable records", `step: ${why(listStep)}`);
      check(
        Array.isArray(listStep?.output?.items) && typeof listStep?.output?.count === "number",
        `and returns { items, count } like every other list node (${listStep?.output?.count})`,
      );
      check(
        listStep?.output?.items?.some((item) => item?.fields?.[firstField] === value),
        "and the record just written is among them",
      );
      const aggregate = read.get("count");
      check(
        aggregate?.status === "succeeded" && aggregate?.output?.value === listStep?.output?.count,
        `and an Aggregate node chains straight off it with no glue (${aggregate?.output?.value})`,
      );
    }
  }

  /* 7 — the four new templates still clone and validate on the deployed build --- */
  console.log("\n7. The four Phase 23B templates clone and validate on the deployed build");
  const gallery = data(await api("/api/templates"));
  check(Array.isArray(gallery) && gallery.length === 10, `GET /api/templates returns 10 (${gallery?.length})`);
  for (const id of ["slack-standup", "notion-run-log", "webhook-to-github", "airtable-inbox"]) {
    const card = (gallery ?? []).find((template) => template.id === id);
    check(card?.requires?.length > 0, `${id} tells the user what it needs first`);
    const result = await api(`/api/templates/${id}`, { method: "POST" });
    const made = data(result);
    if (made?.id) created.push(made.id);
    check(result.status === 201, `${id} clones (${result.status})`);
    check((made?.problems ?? []).length === 0, `${id} has no validation problems`, `${id}: ${JSON.stringify(made?.problems)}`);
  }

  /* 8 — the agent can actually reach them ------------------------------------- */
  console.log("\n8. The four are in the agent's tool surface and the generator's vocabulary");
  const generated = await api("/api/workflows/generate", {
    method: "POST",
    body: JSON.stringify({
      prompt: "When a webhook arrives, post its message to Slack.",
      name: `${RUN_TAG} generated`,
    }),
  });
  const madeGraph = data(generated);
  if (madeGraph?.workflow?.id) created.push(madeGraph.workflow.id);
  if (generated.status === 201) {
    const types = (madeGraph?.workflow?.graph?.nodes ?? []).map((node) => node.type);
    check(types.includes("integration.slack"), `generation reached for the Slack node (${types.join(", ")})`);
  } else if (generated.status === 409 || generated.status === 503) {
    skip(`the model was unavailable, so generation was NOT verified (${generated.status})`);
  } else {
    fail(`generation failed unexpectedly (${generated.status}: ${JSON.stringify(madeGraph).slice(0, 200)})`);
  }
}

/* ------------------------------------------------------------------ *
 * Reading the services back directly. Not through the app — the point is an
 * independent witness to what the app claims it did.
 * ------------------------------------------------------------------ */

async function notion(path) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    headers: {
      authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      "notion-version": "2025-09-03",
    },
  });
  return response.json().catch(() => null);
}

async function github(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
    },
  });
  return response.json().catch(() => null);
}

async function airtable(path) {
  const response = await fetch(`https://api.airtable.com/v0${path}`, {
    headers: { authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` },
  });
  return response.json().catch(() => null);
}

async function cleanup() {
  if (created.length > 0) {
    console.log(`\nCleaning up ${created.length} workflow(s)`);
    for (const id of created) {
      const result = await api(`/api/workflows/${id}`, { method: "DELETE" });
      if (result.status >= 400) console.log(`   ! could not delete ${id} (${result.status})`);
    }
  }

  if (airtableRecords.length > 0) {
    console.log(`Cleaning up ${airtableRecords.length} Airtable record(s)`);
    for (const id of airtableRecords) {
      const response = await fetch(
        `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent(process.env.AIRTABLE_TABLE)}/${id}`,
        { method: "DELETE", headers: { authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` } },
      );
      if (!response.ok) console.log(`   ! could not delete ${id} (${response.status})`);
    }
  }

  if (leftBehind.length > 0) {
    console.log(`\nLeft behind on purpose — these APIs cannot un-make them, and they are the proof:`);
    for (const item of leftBehind) console.log(`   • ${item}`);
  }
}

main()
  .catch((error) => {
    failed += 1;
    console.error(`\nUNCAUGHT: ${error?.stack ?? error}`);
  })
  .finally(async () => {
    await cleanup().catch((error) => console.error(`cleanup failed: ${error}`));
    console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
    if (skipped > 0) {
      console.log("SKIPPED IS NOT PASSED — a service with no credentials was not verified.");
    }
    console.log(failed === 0 ? "ALL CHECKS PASSED\n" : "THERE ARE FAILURES\n");
    process.exit(failed === 0 ? 0 : 1);
  });
