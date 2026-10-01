/**
 * The Phase 23D surface, verified against the deployed service **and against Groq's real API.**
 *
 *   APP_BASE_URL=https://… node --env-file=.env scripts/verify-providers.mjs
 *
 * **What this proves that no unit test can.** `groq.test.ts` asserts the wire format this
 * repository *builds*, against payloads copied from a live response. What it cannot assert is
 * that the key works, that Groq answers from inside the Cloud Run container, that a **real
 * tool call** comes back — which `BUILD_PLAN.md` names as the check that matters, because
 * Phase 13 found a model that answered prose in 1.4 s and hung on tool calls — or that a
 * workspace can switch provider and switch back without losing the key it had.
 *
 * **The one claim this script exists for above all others:** `BUILD_PLAN.md` → *Phase 23D*
 * requires that *"existing `llm.google` credentials keep working across the change, proved on
 * the deployed database rather than asserted."* So this reads the Gemini credential's row out
 * of the deployed database **before and after** the provider is switched to Groq and back, and
 * compares the ciphertext, the wrapped key and the rotation count. A migration that silently
 * re-encrypted or replaced that row would pass every other check in this file.
 *
 * **What it needs**, in `.env` and not in this repository:
 *
 *   GROQ_API_KEY             a Groq key. Absent, the Groq half is SKIPPED, never passed.
 *   DATABASE_URL_UNPOOLED    the application's own, to mint a session and to read the
 *                            credential rows back out directly.
 *
 * It restores the workspace's original provider choice and leaves every credential it found in
 * place. The Groq key it stores is left connected on purpose, for the same reason
 * `verify-postgres.mjs` leaves its own: so the next run can tell a broken deployment from an
 * unconfigured one.
 */
import { neon } from "@neondatabase/serverless";

const BASE = (process.argv[2] ?? process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
if (!BASE) {
  throw new Error("Pass the base URL as an argument, or set APP_BASE_URL.");
}

const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);
const GROQ_KEY = process.env.GROQ_API_KEY ?? "";

const COOKIE =
  new URL(BASE).protocol === "https:"
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";

let cookie = null;
let workspaceId = null;
/** What the workspace was pointed at before this script ran. Restored at the end. */
let originalChoice = null;
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

const settings = async () => data(await api("/api/settings/provider"));

/** The stored credential row, read straight from the deployed database. */
async function credentialRow(kind) {
  const [row] = await sql.query(
    'select "ciphertext", "wrappedKey", "keyVersion", "rotationCount", "metadata", "createdAt" ' +
      'from "credential" where "workspaceId" = $1 and "kind" = $2',
    [workspaceId, kind],
  );
  return row ?? null;
}

async function runGraph(name, nodes, edges) {
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

  // `POST /runs` answers with the finished run and its steps — no polling, and no SSE, which
  // is proved elsewhere. Same helper shape as `verify-postgres.mjs`.
  const run = data(await api(`/api/workflows/${made.id}/runs`, { method: "POST", body: "{}" }));
  return { run, steps: new Map((run?.steps ?? []).map((step) => [step.nodeId, step])) };
}

const why = (step) => step?.error ?? step?.status ?? "no step recorded";

async function main() {
  console.log(`\nPhase 23D — two LLM providers, against ${BASE}\n`);
  const email = await mintSession();
  console.log(`   session minted for ${email}\n`);

  const [workspace] = await sql.query(
    'select "id", "llmProvider" from "workspace" order by "createdAt" limit 1',
  );
  workspaceId = workspace.id;
  originalChoice = workspace.llmProvider;
  console.log(`   workspace ${workspaceId}, provider column = ${originalChoice ?? "NULL"}\n`);

  /* ---------------------------------------------------------------- *
   * 1. Migration 0010 landed, and it landed additively
   * ---------------------------------------------------------------- */
  console.log("1. The migration");

  const [column] = await sql.query(
    "select data_type, is_nullable from information_schema.columns " +
      "where table_name = 'workspace' and column_name = 'llmProvider'",
  );
  check(Boolean(column), "workspace.llmProvider exists on the deployed database");
  check(column?.data_type === "text", `it is text (${column?.data_type})`);
  check(
    column?.is_nullable === "YES",
    "it is nullable, which is what made the migration need no backfill",
  );

  const [{ count: migrations }] = await sql.query(
    'select count(*)::int as count from "drizzle"."__drizzle_migrations"',
  );
  check(migrations >= 11, `${migrations} migrations applied (0000–0010)`);

  /* ---------------------------------------------------------------- *
   * 2. Both providers are offered, and Google is still the default
   * ---------------------------------------------------------------- */
  console.log("\n2. The registry, as the deployed app reports it");

  const before = await settings();
  check(Array.isArray(before?.providers), "GET /api/settings/provider lists providers");
  const ids = (before?.providers ?? []).map((entry) => entry.id);
  check(ids.length === 2, `two providers offered (${ids.join(", ")})`);
  check(ids[0] === "google" && ids[1] === "groq", "Google is first in registry order");

  const googleState = before.providers.find((entry) => entry.id === "google");
  const groqState = before.providers.find((entry) => entry.id === "groq");
  check(Boolean(googleState?.configured), "the existing Gemini key is still reported stored");
  // Not `configured` — whether Groq holds a key depends on whether this script has run before,
  // and asserting either way would make the suite order-dependent. What must be true is that the
  // provider is *offered* with everything a settings card needs to render it.
  check(
    Boolean(groqState) &&
      typeof groqState.label === "string" &&
      typeof groqState.keyUrl === "string" &&
      typeof groqState.model === "string",
    `Groq is offered with a label, a key URL and a default model (${groqState?.label}, ${groqState?.model})`,
  );
  check(
    before.provider === "google",
    `the active provider is google (${before.provider})`,
    `the active provider is ${before.provider}, not google — Groq must not become the default`,
  );

  /**
   * No part of a stored key in a response the client receives.
   *
   * **This assertion used to scan for the vendor prefixes `AIza` and `gsk_`, and it was wrong
   * — it failed on the first deployed run.** Groq's *placeholder* is the string `gsk_…`, a
   * hint rendered in an empty input, so a prefix scan reported a leak where there was none.
   *
   * The replacement tests the actual claim rather than a proxy for it: the **real stored
   * secret** must not appear. That is both stronger (a key whose format changes is still
   * caught) and narrower in the right way (a UI hint is not key material). The prefix scan is
   * kept as a second net, with the registry's own placeholders removed from the haystack
   * first, so it can still catch a key that this script does not hold.
   */
  const serialised = JSON.stringify(before);
  if (GROQ_KEY) {
    check(
      !serialised.includes(GROQ_KEY) && !serialised.includes(GROQ_KEY.slice(0, 12)),
      "the real Groq key does not appear in the settings response, in whole or in part",
    );
  } else {
    skip("no Groq key held, so its absence from the response cannot be proved");
  }
  const withoutHints = (before.providers ?? []).reduce(
    (text, provider) => text.split(provider.placeholder).join(""),
    serialised,
  );
  check(
    !withoutHints.includes("AIza") && !withoutHints.includes("gsk_"),
    "no vendor key prefix appears once the placeholders are discounted",
  );
  for (const key of ["apiKey", "secret", "ciphertext"]) {
    check(!serialised.includes(`"${key}"`), `the response carries no "${key}" field`);
  }

  /* ---------------------------------------------------------------- *
   * 3. The Gemini credential, recorded before anything is touched
   * ---------------------------------------------------------------- */
  console.log("\n3. The existing llm.google row, before the change");

  const geminiBefore = await credentialRow("llm.google");
  if (!geminiBefore) {
    skip("no llm.google credential stored — the no-data-loss claim cannot be checked");
  } else {
    pass(
      `llm.google stored: keyVersion ${geminiBefore.keyVersion}, ` +
        `rotationCount ${geminiBefore.rotationCount}, model ${geminiBefore.metadata?.model}`,
    );
  }

  /* ---------------------------------------------------------------- *
   * 4. Groq: a real key, a real call, and a real tool call
   * ---------------------------------------------------------------- */
  console.log("\n4. Groq, against the real service");

  if (!GROQ_KEY) {
    skip("GROQ_API_KEY is not set — the whole Groq half is unverified");
    skip("a real Groq completion");
    skip("a real Groq tool call");
    skip("switching provider and back");
  } else {
    // 4a. Store the key through the deployed app. The app verifies it against Groq before it
    // stores it, so a 200 here is already a real round trip from inside the container.
    const stored = await api("/api/settings/provider", {
      method: "PUT",
      body: JSON.stringify({ provider: "groq", apiKey: GROQ_KEY }),
    });
    check(
      stored.status === 200,
      "the deployed app verified the Groq key against Groq and stored it",
      `storing the Groq key answered ${stored.status}: ${JSON.stringify(stored.body)}`,
    );

    const afterStore = data(stored);
    check(afterStore?.provider === "groq", "pasting a key into a card switched to that provider");
    const storedGroq = afterStore?.providers?.find((entry) => entry.id === "groq");
    check(Boolean(storedGroq?.configured), "the Groq card now reports a stored key");
    check(
      storedGroq?.model === "openai/gpt-oss-120b",
      `the chain's head is the default model (${storedGroq?.model})`,
    );

    // 4b. The column really changed, read directly rather than believed from the response.
    const [switched] = await sql.query('select "llmProvider" from "workspace" where "id" = $1', [
      workspaceId,
    ]);
    check(
      switched?.llmProvider === "groq",
      `workspace.llmProvider is "groq" in the database (${switched?.llmProvider})`,
    );

    // 4c. The Groq credential is sealed by the same envelope as every other credential.
    const groqRow = await credentialRow("llm.groq");
    check(Boolean(groqRow), "an llm.groq credential row exists");
    check(
      Boolean(groqRow?.wrappedKey) && Boolean(groqRow?.keyVersion),
      `it is enveloped under a root key version (${groqRow?.keyVersion})`,
      "it has no wrapped data key — it was stored in the Chapter 1 single-layer shape",
    );
    check(
      !String(groqRow?.ciphertext ?? "").includes("gsk_"),
      "the stored ciphertext is not the plaintext key",
    );

    // 4d. The catalogue, live from Groq, filtered by declared capability.
    const listed = data(await api("/api/settings/provider/models?provider=groq"));
    const modelIds = (listed?.models ?? []).map((entry) => entry.id);
    check(modelIds.length > 0, `Groq listed ${modelIds.length} tool-capable models`);
    check(
      modelIds.includes("openai/gpt-oss-120b"),
      "the chain's head model is in the live catalogue",
    );
    check(
      !modelIds.some((id) => id.startsWith("whisper") || id.includes("orpheus")),
      "transcription and speech models are filtered out of the picker",
    );
    check(
      !modelIds.some((id) => id.includes("prompt-guard")),
      "a text model that declares no tool support is filtered out too",
    );

    // 4e. **A real completion, through a deployed workflow, on Groq.**
    const llmRun = await runGraph(
      "23D verify — groq llm",
      [
        { id: "t", type: "core.manual_trigger" },
        {
          id: "m",
          type: "ai.llm",
          config: { prompt: "Reply with exactly the word READY and nothing else." },
        },
      ],
      [{ from: "t", to: "m" }],
    );
    const llmStep = llmRun.steps.get("m");
    check(
      llmStep?.status === "succeeded",
      "an ai.llm step ran on Groq and succeeded",
      `the ai.llm step failed: ${why(llmStep)}`,
    );
    const answered = llmStep?.output?.model ?? null;
    check(
      typeof answered === "string" && answered.startsWith("openai/"),
      `a Groq model answered it (${answered})`,
      `the answering model was ${answered}, which is not a Groq model`,
    );
    check(
      /READY/i.test(String(llmStep?.output?.text ?? "")),
      `the completion carries the word the prompt asked for (${String(llmStep?.output?.text ?? "").slice(0, 60)})`,
    );

    // 4f. **A real tool call** — the check BUILD_PLAN names as the one that matters.
    const agentRun = await runGraph(
      "23D verify — groq agent tool call",
      [
        { id: "t", type: "core.manual_trigger" },
        {
          id: "a",
          type: "ai.agent",
          config: {
            objective:
              "Call the http_request tool to GET https://httpbin.org/json, then reply DONE. " +
              "You must use the tool; do not answer from memory.",
            tools: ["integration.http"],
            maxIterations: 4,
          },
        },
      ],
      [{ from: "t", to: "a" }],
    );
    const agentStep = agentRun.steps.get("a");
    check(
      agentStep?.status === "succeeded",
      "an ai.agent step ran on Groq and succeeded",
      `the ai.agent step failed: ${why(agentStep)}`,
    );
    const output = agentStep?.output ?? {};
    const toolCalls = Array.isArray(output.toolCalls) ? output.toolCalls : [];
    // **The check BUILD_PLAN names as the one that matters.** Phase 13 found a model that
    // answered prose in 1.4 s and hung on tool calls, so prose is not evidence of either.
    check(
      toolCalls.length > 0,
      `Groq made ${toolCalls.length} real tool call(s): ${toolCalls.map((call) => call.name).join(", ")}`,
      `no tool call is recorded on the agent step: ${JSON.stringify(output).slice(0, 300)}`,
    );
    check(
      toolCalls.some((call) => call.ok === true),
      `at least one tool call actually succeeded (${JSON.stringify(toolCalls.map((c) => ({ name: c.name, ok: c.ok })))})`,
    );
    check(
      typeof output.model === "string" && output.model.startsWith("openai/"),
      `the tool call was made by a Groq model (${output.model})`,
    );

    /* -------------------------------------------------------------- *
     * 5. The claim the phase rests on: Gemini survived unchanged
     * -------------------------------------------------------------- */
    console.log("\n5. The existing Gemini credential, after the change");

    if (!geminiBefore) {
      skip("no llm.google row existed to compare against");
    } else {
      const geminiAfter = await credentialRow("llm.google");
      check(Boolean(geminiAfter), "the llm.google row still exists after switching to Groq");
      check(
        geminiAfter?.ciphertext === geminiBefore.ciphertext,
        "its ciphertext is byte-for-byte unchanged — nothing re-encrypted it",
      );
      check(
        geminiAfter?.wrappedKey === geminiBefore.wrappedKey,
        "its wrapped data key is unchanged",
      );
      check(
        geminiAfter?.rotationCount === geminiBefore.rotationCount,
        `its rotationCount is unchanged (${geminiAfter?.rotationCount})`,
        "its rotationCount moved — something counted this as a rotation",
      );
      check(
        geminiAfter?.metadata?.model === geminiBefore.metadata?.model,
        `its chosen model is unchanged (${geminiAfter?.metadata?.model})`,
      );
      check(
        String(geminiAfter?.createdAt) === String(geminiBefore.createdAt),
        "its createdAt is unchanged — the row was never replaced",
      );
    }

    /* -------------------------------------------------------------- *
     * 6. Switch back, and Gemini still runs
     * -------------------------------------------------------------- */
    console.log("\n6. Switching back to Google");

    const back = await api("/api/settings/provider", {
      method: "PUT",
      body: JSON.stringify({ provider: "google" }),
    });
    check(back.status === 200, "switching provider with no key to verify is a 200");
    check(data(back)?.provider === "google", "the active provider is google again");

    if (geminiBefore) {
      const geminiRun = await runGraph(
        "23D verify — gemini still works",
        [
          { id: "t", type: "core.manual_trigger" },
          {
            id: "m",
            type: "ai.llm",
            config: { prompt: "Reply with exactly the word READY and nothing else." },
          },
        ],
        [{ from: "t", to: "m" }],
      );
      const step = geminiRun.steps.get("m");
      check(
        step?.status === "succeeded",
        "the pre-existing Gemini key still runs a workflow",
        `the Gemini run failed after the change: ${why(step)}`,
      );
      check(
        typeof step?.output?.model === "string" && step.output.model.startsWith("gemini-"),
        `and a Gemini model answered (${step?.output?.model})`,
      );
    } else {
      skip("no Gemini key to re-run");
    }

    /* -------------------------------------------------------------- *
     * 7. Health is per provider, and the vault knows both kinds
     * -------------------------------------------------------------- */
    console.log("\n7. Health and the vault");

    const now = await settings();
    const health = now?.health ?? [];
    check(
      health.every((entry) => entry.provider === "google"),
      `health is narrowed to the active provider (${health.map((e) => e.provider).join(",") || "empty"})`,
    );
    check(
      health.every((entry) => typeof entry.provider === "string" && entry.provider.length > 0),
      "every health record names its provider",
    );

    const vault = data(await api("/api/credentials"));
    const entries = vault?.entries ?? [];
    const kinds = entries.map((entry) => entry.kind);
    check(kinds.includes("llm.google"), "the vault lists llm.google");
    check(
      kinds.includes("llm.groq"),
      "the vault lists llm.groq, with no rotation code written for it",
      `the vault does not list llm.groq: ${kinds.join(", ")}`,
    );
    // `mode` is flattened onto a vault entry by `readVault`, not nested under a `rotation`
    // object — this assertion read `entry.rotation.mode` and failed against a correct product
    // on the first deployed run. The same shape of mistake Phase 23B made with `credentials`
    // vs `entries`, which is why it is worth naming twice: a wrong path on an optional chain
    // is indistinguishable from a missing feature.
    const groqEntry = entries.find((entry) => entry.kind === "llm.groq");
    check(
      groqEntry?.mode === "value",
      `llm.groq is rotatable by value (${groqEntry?.mode})`,
      `llm.groq's rotation mode is ${JSON.stringify(groqEntry?.mode)}`,
    );
    check(
      typeof groqEntry?.secretLabel === "string" && groqEntry.secretLabel.length > 0,
      `and the vault knows what to call its secret ("${groqEntry?.secretLabel}")`,
    );

    // The rotation path, exercised for real: the same key again, which must be accepted and
    // must count as a rotation rather than a first connection.
    const rotated = await api("/api/credentials/llm.groq/rotate", {
      method: "POST",
      body: JSON.stringify({ secret: GROQ_KEY }),
    });
    check(rotated.status === 200, `rotating the Groq key is a 200 (${rotated.status})`);
    const rotatedRow = await credentialRow("llm.groq");
    check(
      Number(rotatedRow?.rotationCount) >= 1,
      `rotationCount advanced to ${rotatedRow?.rotationCount}`,
    );

    // And an unknown provider is refused rather than defaulted.
    const bogus = await api("/api/settings/provider", {
      method: "PUT",
      body: JSON.stringify({ provider: "not-a-provider" }),
    });
    check(bogus.status === 400, `an unknown provider id is a 400 (${bogus.status})`);
    const proto = await api("/api/settings/provider", {
      method: "PUT",
      body: JSON.stringify({ provider: "__proto__" }),
    });
    check(proto.status === 400, `"__proto__" as a provider id is a 400 (${proto.status})`);
  }
}

async function cleanup() {
  for (const id of created) {
    await api(`/api/workflows/${id}`, { method: "DELETE" }).catch(() => {});
  }
  // Put the workspace back exactly as it was found, including a NULL that meant "never chosen".
  if (workspaceId) {
    await sql
      .query('update "workspace" set "llmProvider" = $1 where "id" = $2', [
        originalChoice,
        workspaceId,
      ])
      .catch(() => {});
  }
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
