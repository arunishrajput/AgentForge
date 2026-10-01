/**
 * Phase 21's deployed verification — the credential vault, rotation, and re-keying.
 *
 *   node --env-file=.env scripts/verify-vault.mjs https://<the deployed url>
 *
 * Its own script rather than another 600 lines in `verify-api.mjs`, following the precedent
 * `verify-durable.mjs` set in Phase 17: a phase whose subject is one subsystem gets a suite
 * that can be re-run on its own when that subsystem changes.
 *
 * Auth is a database session, exactly as `verify-api.mjs` does it: a real `session` row for a
 * real user, driven with a cookie, deleted afterwards. No test-only bypass exists in the app.
 *
 * **What this has to prove, from `BUILD_PLAN.md` → Phase 21 → Validation steps:**
 *
 *   1. Rotate a stored credential and confirm workflows keep working
 *   2. Rotate a workflow's webhook token and confirm the **old one is refused**
 *   3. Re-key and confirm every stored credential **still decrypts**
 *
 * And three things the phase claims that would otherwise be taken on trust:
 *
 *   4. The vault's response carries **no part of any secret** — asserted by reading the real
 *      ciphertext out of the database and searching the JSON for it
 *   5. A rotation that fails validation **writes nothing** — asserted by comparing the stored
 *      ciphertext before and after a refused rotation
 *   6. Every rotation produces a **fresh data key**, so the new secret shares no key material
 *      with the one it replaced
 *
 * **It touches the real user's credentials**, which is unavoidable: re-keying is a property of
 * the whole workspace and cannot be rehearsed on a throwaway one that holds nothing. Every
 * operation it performs is designed to be safe to repeat — re-keying is idempotent, and the one
 * rotation it performs re-stores the same Discord webhook URL it read from `.env`.
 */
import { neon } from "@neondatabase/serverless";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const secure = base.startsWith("https://");
const cookieName = secure ? "__Secure-authjs.session-token" : "authjs.session-token";

const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);

let failures = 0;
let skipped = 0;

function check(label, condition, detail) {
  const passed = Boolean(condition);
  if (!passed) failures += 1;
  console.log(
    `${passed ? "PASS" : "FAIL"}  ${label}${passed || detail === undefined ? "" : `\n        ${detail}`}`,
  );
}

function skip(label, why) {
  skipped += 1;
  console.log(`SKIP  ${label}\n        ${why}`);
}

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
  return { status: response.status, json, text };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The owner's session, and the workspace whose credentials this exercises. */
const token = crypto.randomUUID() + crypto.randomUUID();
const PROBE_USER_ID = "zzzz-vault-probe";
const probeToken = crypto.randomUUID() + crypto.randomUUID();

let ownerId = null;
let workspaceId = null;
let arena = null;
let webhookWorkflowId = null;

async function cleanUpProbe() {
  await sql
    .query('delete from "workspace_member" where "userId" = $1', [PROBE_USER_ID])
    .catch(() => {});
  await sql
    .query('delete from "workspace" where "createdBy" = $1', [PROBE_USER_ID])
    .catch(() => {});
  await sql.query('delete from "session" where "userId" = $1', [PROBE_USER_ID]).catch(() => {});
  await sql.query('delete from "user" where "id" = $1', [PROBE_USER_ID]).catch(() => {});
}

try {
  console.log(`\nVerifying the credential vault against ${base}\n`);

  /* ================================================================== *
   * 0. A session for the account that actually holds the credentials
   * ================================================================== */
  const [owner] = await sql.query(
    'select u."id" from "user" u join "credential" c on c."ownerId" = u."id" limit 1',
  );
  if (!owner) throw new Error("No user in the database holds a credential — nothing to verify.");
  ownerId = owner.id;

  await sql.query(
    'insert into "session" ("sessionToken", "userId", "expires") values ($1, $2, $3)',
    [token, ownerId, new Date(Date.now() + 60 * 60 * 1000)],
  );

  const [ws] = await sql.query(
    'select distinct "workspaceId" as id from "credential" where "ownerId" = $1 limit 1',
    [ownerId],
  );
  workspaceId = ws?.id ?? null;
  check("the credential-holding workspace was found", workspaceId !== null);

  /* ================================================================== *
   * 1. The vault reads, and carries no secret
   * ================================================================== */
  console.log("\n--- the vault ---");

  const vault = await api("GET", "/api/credentials", undefined, token, workspaceId);
  check("GET /api/credentials answers 200", vault.status === 200, JSON.stringify(vault.json).slice(0, 300));
  const v = vault.json?.data;
  check("it lists this workspace's credentials", Array.isArray(v?.entries) && v.entries.length > 0,
    `${v?.entries?.length ?? 0} entries`);
  check(
    "it reports the root key provider, so a deployment on the env key cannot hide",
    v?.rootKey?.provider === "secret-manager",
    JSON.stringify(v?.rootKey),
  );
  check(
    "every entry says what rotating it means",
    (v?.entries ?? []).every((e) => e.title && e.mode && e.help && typeof e.legacy === "boolean"),
    JSON.stringify((v?.entries ?? []).map((e) => ({ kind: e.kind, mode: e.mode }))),
  );

  /**
   * **The write-only rule, proved against the real ciphertext rather than against the type.**
   * Every envelope column of every credential in this workspace is pulled out of the database
   * and searched for in the response body. A unit test asserts the projection's shape; this
   * asserts that the thing actually on the wire does not contain the thing in the database.
   */
  const rows = await sql.query(
    'select "id","kind","label","ciphertext","iv","authTag","wrappedKey","wrapIv","wrapAuthTag","keyVersion","rotationCount" from "credential" where "workspaceId" = $1',
    [workspaceId],
  );
  const leaked = [];
  for (const row of rows) {
    for (const column of ["ciphertext", "iv", "authTag", "wrappedKey", "wrapIv", "wrapAuthTag"]) {
      const value = row[column];
      if (typeof value === "string" && value.length > 8 && vault.text.includes(value)) {
        leaked.push(`${row.kind}.${column}`);
      }
    }
  }
  check(
    "no part of any stored envelope appears in the response",
    leaked.length === 0,
    `leaked: ${leaked.join(", ")}`,
  );
  check(
    "and no event names who performed it",
    !/"actorId"/.test(vault.text),
    "actorId is in the response",
  );

  /* ================================================================== *
   * 2. Re-keying — and every credential still decrypts
   * ================================================================== */
  console.log("\n--- re-keying ---");

  const legacyBefore = rows.filter((r) => r.wrappedKey === null).length;
  console.log(`        ${rows.length} credential(s), ${legacyBefore} still in the Chapter 1 shape`);

  const rekey = await api("POST", "/api/credentials/rekey", undefined, token, workspaceId);
  check("POST /api/credentials/rekey answers 200", rekey.status === 200,
    JSON.stringify(rekey.json).slice(0, 300));
  const outcome = rekey.json?.data?.rekey;
  check("it examined every credential in the workspace", outcome?.examined === rows.length,
    `examined ${outcome?.examined} of ${rows.length}`);
  check(
    "no credential failed to re-key",
    Array.isArray(outcome?.failures) && outcome.failures.length === 0,
    JSON.stringify(outcome?.failures),
  );
  check(
    "it converted exactly the credentials that were still legacy",
    outcome?.converted === legacyBefore,
    `converted ${outcome?.converted}, expected ${legacyBefore}`,
  );

  /**
   * **This is the "still decrypts" proof, and it is server-side and per-row.** `rekeyOne`
   * reads the plaintext, writes the new envelope, then re-opens what it wrote and compares.
   * A row that came out wrong raises, lands in `failures`, and is not silently left behind —
   * so `failures: []` over `examined: n` is n independent decrypt-verify round trips on the
   * deployed system.
   */
  const after = await sql.query(
    'select "kind","label","ciphertext","wrappedKey","keyVersion" from "credential" where "workspaceId" = $1',
    [workspaceId],
  );
  check(
    "every credential now has a wrapped data key",
    after.length > 0 && after.every((r) => r.wrappedKey !== null),
    JSON.stringify(after.map((r) => ({ kind: r.kind, wrapped: r.wrappedKey !== null }))),
  );
  check(
    "every one names a Secret Manager root key version",
    after.every((r) => /^sm:\d+$/.test(r.keyVersion ?? "")),
    JSON.stringify(after.map((r) => ({ kind: r.kind, version: r.keyVersion }))),
  );

  /** A re-key of an already-enveloped row must not rewrite the ciphertext. */
  const unchangedCiphertext = after.filter((row) => {
    const before = rows.find((r) => r.kind === row.kind && r.label === row.label);
    return before && before.wrappedKey !== null && before.ciphertext === row.ciphertext;
  }).length;
  const alreadyEnveloped = rows.filter((r) => r.wrappedKey !== null).length;
  check(
    "an already-enveloped row had its data key moved and its ciphertext left alone",
    unchangedCiphertext === alreadyEnveloped,
    `${unchangedCiphertext} of ${alreadyEnveloped} kept their ciphertext`,
  );

  const again = await api("POST", "/api/credentials/rekey", undefined, token, workspaceId);
  check("re-keying twice is idempotent", again.status === 200 &&
    again.json?.data?.rekey?.unchanged === rows.length &&
    again.json?.data?.rekey?.converted === 0,
    JSON.stringify(again.json?.data?.rekey));

  /**
   * An independent confirmation that does not use the re-key's own verification: resolve the
   * provider key through the normal product path. The key is decrypted and sent to Google.
   *
   * 200 means it worked. **409 also proves it** — that is the free-tier quota refusing a
   * request the key was accepted for. A decryption failure would be a 500, which is what this
   * is really asserting is absent.
   */
  const models = await api("GET", "/api/settings/provider/models", undefined, token, workspaceId);
  check(
    "the re-keyed provider key decrypts and is accepted by the provider",
    models.status === 200 || models.status === 409,
    `got ${models.status}: ${JSON.stringify(models.json).slice(0, 200)}`,
  );
  if (models.status === 409) {
    console.log("        (409 is the free-tier quota; the key was decrypted and sent)");
  }

  /* ================================================================== *
   * 3. Rotating a stored credential in place
   * ================================================================== */
  console.log("\n--- rotating a credential ---");

  const discordUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!discordUrl) {
    skip("a Discord credential rotates in place", "DISCORD_WEBHOOK_URL is not set for this session");
    skip("a rotation mints a fresh data key", "same");
    skip("a workflow still posts to Discord after the rotation", "same");
  } else {
    const stored = await api("PUT", "/api/integrations/discord", { webhookUrl: discordUrl }, token, workspaceId);
    check("a Discord webhook is stored to rotate", stored.status === 200,
      JSON.stringify(stored.json).slice(0, 200));

    const [before] = await sql.query(
      `select "ciphertext","wrappedKey","rotationCount" from "credential"
       where "workspaceId" = $1 and "kind" = 'integration.discord'`,
      [workspaceId],
    );

    const rotated = await api(
      "POST",
      "/api/credentials/integration.discord/rotate",
      { secret: discordUrl },
      token,
      workspaceId,
    );
    check("POST /api/credentials/integration.discord/rotate answers 200", rotated.status === 200,
      JSON.stringify(rotated.json).slice(0, 300));

    const [afterRotate] = await sql.query(
      `select "ciphertext","wrappedKey","keyVersion","rotationCount","rotatedAt" from "credential"
       where "workspaceId" = $1 and "kind" = 'integration.discord'`,
      [workspaceId],
    );
    check(
      "the rotation count went up and a rotation timestamp appeared",
      afterRotate?.rotationCount === (before?.rotationCount ?? 0) + 1 && afterRotate?.rotatedAt !== null,
      `${before?.rotationCount} → ${afterRotate?.rotationCount}`,
    );
    /**
     * **The fresh-data-key property, which is most of what rotation buys.** The same URL is
     * stored twice, so identical `wrappedKey` and `ciphertext` would mean the new value shares
     * key material with the one it replaced.
     */
    check(
      "the rotation minted a fresh data key and a fresh ciphertext",
      afterRotate?.wrappedKey !== before?.wrappedKey && afterRotate?.ciphertext !== before?.ciphertext,
      "the envelope did not change",
    );
    check(
      "and it is still under the current root key version",
      /^sm:\d+$/.test(afterRotate?.keyVersion ?? ""),
      afterRotate?.keyVersion,
    );

    /** Validation step 1: the workflow keeps working. Nothing weaker proves it. */
    const discordGraph = {
      version: 1,
      nodes: [
        { id: "trigger", type: "core.manual_trigger", position: { x: 0, y: 0 }, config: {} },
        {
          id: "post",
          type: "integration.discord",
          position: { x: 260, y: 0 },
          config: { content: "AgentForge Phase 21: posting with a rotated credential." },
        },
      ],
      edges: [{ id: "e1", source: "trigger", target: "post", sourceHandle: null }],
    };
    const created = await api("POST", "/api/workflows",
      { name: "zzzz phase21 rotation probe", graph: discordGraph }, token, workspaceId);
    const probeWorkflow = created.json?.data?.id ?? null;

    if (!probeWorkflow) {
      check("a workflow exists to run with the rotated credential", false,
        JSON.stringify(created.json).slice(0, 200));
    } else {
      const run = await api("POST", `/api/workflows/${probeWorkflow}/runs`, {}, token, workspaceId);
      const steps = run.json?.data?.steps ?? [];
      const post = steps.find((s) => s.nodeType === "integration.discord");
      check(
        "a workflow still posts to Discord after the credential was rotated",
        run.json?.data?.status === "succeeded" && post?.status === "succeeded",
        `run ${run.json?.data?.status}, node ${post?.status}: ${post?.error ?? ""}`,
      );

      /** The audit log's whole point: the use is recorded, with the run and the node. */
      await sleep(500);
      const [used] = await sql.query(
        `select "event","runId","nodeType","detail" from "credential_event"
         where "workspaceId" = $1 and "event" = 'used' and "kind" = 'integration.discord'
         order by "at" desc limit 1`,
        [workspaceId],
      );
      check(
        "the audit log recorded the use, naming the run and the node",
        used?.runId === run.json?.data?.id && used?.nodeType === "integration.discord",
        JSON.stringify(used),
      );
      check(
        "and it recorded why, not what",
        used?.detail === "post-message",
        `detail was ${JSON.stringify(used?.detail)}`,
      );

      await api("DELETE", `/api/workflows/${probeWorkflow}`, undefined, token, workspaceId);
    }
  }

  /* --- the refusals, which must write nothing ------------------------ */
  console.log("\n--- rotation refuses before it writes ---");

  const [keyBefore] = await sql.query(
    `select "ciphertext","wrappedKey","rotationCount" from "credential"
     where "workspaceId" = $1 and "kind" = 'llm.google'`,
    [workspaceId],
  );

  const badKey = await api("POST", "/api/credentials/llm.google/rotate",
    { secret: "AIzaNotARealKeyAtAll000000000000000000" }, token, workspaceId);
  check("a key the provider rejects is refused", badKey.status === 400 || badKey.status === 409,
    `got ${badKey.status}: ${JSON.stringify(badKey.json).slice(0, 200)}`);

  const [keyAfter] = await sql.query(
    `select "ciphertext","wrappedKey","rotationCount" from "credential"
     where "workspaceId" = $1 and "kind" = 'llm.google'`,
    [workspaceId],
  );
  /**
   * **Property 5, and the one that would be worst to get wrong.** A route that stored first
   * and validated afterwards would leave the workspace with a dead key and no way back, since
   * the old secret is not kept.
   */
  check(
    "a refused rotation left the stored key byte-identical",
    keyAfter?.ciphertext === keyBefore?.ciphertext &&
      keyAfter?.wrappedKey === keyBefore?.wrappedKey &&
      keyAfter?.rotationCount === keyBefore?.rotationCount,
    "the stored key moved",
  );

  const google = await api("POST", "/api/credentials/google.oauth/rotate",
    { secret: "1//not-a-real-refresh-token" }, token, workspaceId);
  check(
    "a Google connection refuses a typed secret and says why",
    google.status === 400 && /only be issued by Google/.test(google.json?.error?.message ?? ""),
    `got ${google.status}: ${JSON.stringify(google.json).slice(0, 200)}`,
  );

  /**
   * **This check was stale and failed on 2026-10-01, against a correct product.**
   *
   * It used `integration.slack` as its stand-in for "a kind this product does not store",
   * which was true when Phase 21 wrote it and stopped being true in Phase 23B, where Slack
   * became a real credential kind with a real shape check. The route then answered 400
   * ("That is not a Slack incoming webhook URL") — the right answer to a different question.
   *
   * It is the defect class Phase 23C named: **a verification suite that is not re-run every
   * phase rots silently**, and a stale assertion fails later in a way that looks like a
   * regression in whatever phase happens to run it next. The fix is a kind that cannot
   * become real by accident, and the distinction the check was always about is now asserted
   * on both sides.
   */
  const unknown = await api("POST", "/api/credentials/integration.no_such_service/rotate",
    { secret: "a-secret-long-enough-to-pass-any-shape-check" }, token, workspaceId);
  check(
    "a kind this product does not store is 404, not 400",
    unknown.status === 404,
    `got ${unknown.status}: ${JSON.stringify(unknown.json).slice(0, 160)}`,
  );

  // The other half, which is what made the stale assertion look plausible for so long: a
  // kind that IS known, handed a secret of the wrong shape, is a 400 — refused before the
  // service is ever called.
  const malformed = await api("POST", "/api/credentials/integration.slack/rotate",
    { secret: "https://hooks.slack.com/services/x" }, token, workspaceId);
  check(
    "a known kind with a malformed secret is 400, refused before the service is called",
    malformed.status === 400,
    `got ${malformed.status}: ${JSON.stringify(malformed.json).slice(0, 160)}`,
  );

  const empty = await api("POST", "/api/credentials/llm.google/rotate", { secret: "" }, token, workspaceId);
  check("an empty secret is refused by the schema", empty.status === 400, `got ${empty.status}`);

  /* ================================================================== *
   * 4. Rotating a workflow's webhook token
   * ================================================================== */
  console.log("\n--- rotating a webhook token ---");

  const webhookGraph = {
    version: 1,
    nodes: [
      {
        id: "trigger",
        type: "core.webhook_trigger",
        position: { x: 0, y: 0 },
        config: { requiredFields: [] },
      },
      { id: "say", type: "core.log", position: { x: 260, y: 0 }, config: { message: "rotated", level: "info" } },
    ],
    edges: [{ id: "e1", source: "trigger", target: "say", sourceHandle: null }],
  };

  const madeHook = await api("POST", "/api/workflows",
    { name: "zzzz phase21 webhook probe", graph: webhookGraph }, token, workspaceId);
  webhookWorkflowId = madeHook.json?.data?.id ?? null;
  const oldUrl = madeHook.json?.data?.webhookUrl ?? null;
  check("a webhook workflow exists with a URL", webhookWorkflowId !== null && typeof oldUrl === "string",
    JSON.stringify(madeHook.json).slice(0, 200));
  check("it reports never having been rotated", madeHook.json?.data?.webhookTokenRotatedAt === null,
    JSON.stringify(madeHook.json?.data?.webhookTokenRotatedAt));

  const fireOld = await fetch(oldUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phase: 21 }),
  });
  check("the original URL fires the workflow", fireOld.status === 201 || fireOld.status === 200,
    `got ${fireOld.status}`);

  const rotatedHook = await api("POST", `/api/workflows/${webhookWorkflowId}/webhook/rotate`,
    undefined, token, workspaceId);
  const newUrl = rotatedHook.json?.data?.webhookUrl ?? null;
  check("POST /api/workflows/:id/webhook/rotate answers 200", rotatedHook.status === 200,
    JSON.stringify(rotatedHook.json).slice(0, 300));
  check("it returns a different URL", typeof newUrl === "string" && newUrl !== oldUrl,
    `${oldUrl} → ${newUrl}`);
  check("and it records when", typeof rotatedHook.json?.data?.webhookTokenRotatedAt === "string",
    JSON.stringify(rotatedHook.json?.data?.webhookTokenRotatedAt));

  /** **Validation step 2.** "The new one works" would pass on its own while this quietly did not. */
  const fireDead = await fetch(oldUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phase: 21 }),
  });
  check("the OLD URL is refused immediately, with no grace period", fireDead.status === 404,
    `got ${fireDead.status}`);

  const fireNew = await fetch(newUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phase: 21 }),
  });
  check("the new URL fires the workflow", fireNew.status === 201 || fireNew.status === 200,
    `got ${fireNew.status}`);

  /** A workflow with no webhook trigger has no URL to rotate, and says so rather than minting one. */
  const noHook = await api("POST", "/api/workflows",
    {
      name: "zzzz phase21 no trigger",
      graph: {
        version: 1,
        nodes: [
          { id: "trigger", type: "core.manual_trigger", position: { x: 0, y: 0 }, config: {} },
          { id: "say", type: "core.log", position: { x: 260, y: 0 }, config: { message: "x", level: "info" } },
        ],
        edges: [{ id: "e1", source: "trigger", target: "say", sourceHandle: null }],
      },
    },
    token, workspaceId);
  const noHookId = noHook.json?.data?.id ?? null;
  if (noHookId) {
    const refused = await api("POST", `/api/workflows/${noHookId}/webhook/rotate`, undefined, token, workspaceId);
    check("rotating a workflow with no webhook trigger is refused", refused.status === 400,
      `got ${refused.status}`);
    await api("DELETE", `/api/workflows/${noHookId}`, undefined, token, workspaceId);
  } else {
    check("a workflow without a webhook trigger exists to refuse", false);
  }

  /* ================================================================== *
   * 5. The permission bars
   * ================================================================== */
  console.log("\n--- who may do what ---");

  await cleanUpProbe();
  await sql.query('insert into "user" ("id", "name", "email") values ($1, $2, $3)', [
    PROBE_USER_ID,
    "Vault Probe",
    "vault-probe@agentforge.invalid",
  ]);
  await sql.query(
    'insert into "session" ("sessionToken", "userId", "expires") values ($1, $2, $3)',
    [probeToken, PROBE_USER_ID, new Date(Date.now() + 60 * 60 * 1000)],
  );
  const [probeHome] = await sql.query(
    'insert into "workspace" ("id", "name", "createdBy", "personal") values (gen_random_uuid()::text, $1, $2, true) returning "id"',
    ["Vault probe home", PROBE_USER_ID],
  );
  await sql.query(
    'insert into "workspace_member" ("workspaceId", "userId", "role") values ($1, $2, $3)',
    [probeHome.id, PROBE_USER_ID, "owner"],
  );

  const arenaCreated = await api("POST", "/api/workspaces", { name: "zzzz vault arena" }, token);
  arena = arenaCreated.json?.data?.id ?? null;
  check("a throwaway workspace exists to test the bars in", arena !== null,
    JSON.stringify(arenaCreated.json).slice(0, 200));

  // The role is moved by direct SQL, never through the PATCH route — driving the matrix through
  // a route the matrix is testing would let one bug hide another (Phase 20's rule).
  const setRole = async (role) => {
    await sql.query(
      `insert into "workspace_member" ("workspaceId","userId","role") values ($1,$2,$3)
       on conflict ("workspaceId","userId") do update set "role" = $3`,
      [arena, PROBE_USER_ID, role],
    );
  };

  const arenaHook = await api("POST", "/api/workflows",
    { name: "zzzz arena webhook", graph: webhookGraph }, token, arena);
  const arenaWorkflowId = arenaHook.json?.data?.id ?? null;

  const BARS = [
    { role: "viewer", read: 200, rotate: 403, rekey: 403, hook: 403 },
    { role: "editor", read: 200, rotate: 403, rekey: 403, hook: 403 },
    // An admin may rotate, so the arena — which holds no credential — answers 404 from the
    // rotation path rather than 403. That distinction is the assertion: 404 means the request
    // got past the permission check and found nothing to rotate.
    { role: "admin", read: 200, rotate: 404, rekey: 403, hook: 200 },
    { role: "owner", read: 200, rotate: 404, rekey: 200, hook: 200 },
  ];

  for (const bar of BARS) {
    await setRole(bar.role);

    const read = await api("GET", "/api/credentials", undefined, probeToken, arena);
    check(`${bar.role}: may read the vault (${bar.read})`, read.status === bar.read,
      `got ${read.status}`);

    const rotate = await api("POST", "/api/credentials/llm.google/rotate",
      { secret: "AIzaSomethingLongEnoughToPassTheSchema0000" }, probeToken, arena);
    check(`${bar.role}: rotate → ${bar.rotate}`, rotate.status === bar.rotate,
      `got ${rotate.status}: ${JSON.stringify(rotate.json).slice(0, 160)}`);

    const rekeyAs = await api("POST", "/api/credentials/rekey", undefined, probeToken, arena);
    check(`${bar.role}: re-key → ${bar.rekey}`, rekeyAs.status === bar.rekey, `got ${rekeyAs.status}`);

    if (arenaWorkflowId) {
      const hook = await api("POST", `/api/workflows/${arenaWorkflowId}/webhook/rotate`,
        undefined, probeToken, arena);
      check(`${bar.role}: rotate a webhook token → ${bar.hook}`, hook.status === bar.hook,
        `got ${hook.status}: ${JSON.stringify(hook.json).slice(0, 160)}`);
    }
  }

  /** A workspace the caller is not in must be 404 from the vault too, never 403 (D20). */
  await sql.query('delete from "workspace_member" where "workspaceId" = $1 and "userId" = $2',
    [arena, PROBE_USER_ID]);
  const outsider = await api("GET", "/api/credentials", undefined, probeToken, arena);
  check(
    "a non-member reading the vault falls back to their own workspace rather than seeing this one",
    outsider.status === 200 && (outsider.json?.data?.entries ?? []).length === 0,
    `got ${outsider.status} with ${(outsider.json?.data?.entries ?? []).length} entries`,
  );

  /* ================================================================== *
   * 6. The audit log's retention and shape
   * ================================================================== */
  console.log("\n--- the audit log ---");

  const [{ n: eventCount }] = await sql.query(
    'select count(*)::int as n from "credential_event" where "workspaceId" = $1',
    [workspaceId],
  );
  check("the log has rows for this workspace", eventCount > 0, `${eventCount} events`);

  const [{ n: tooOld }] = await sql.query(
    `select count(*)::int as n from "credential_event" where "at" < now() - interval '30 days'`,
  );
  check("nothing in the log is past its retention window", tooOld === 0, `${tooOld} rows are`);

  const kinds = await sql.query(
    'select distinct "event" from "credential_event" where "workspaceId" = $1 order by 1',
    [workspaceId],
  );
  check(
    "it records rekeyed events, which is how a re-key is auditable at all",
    kinds.some((k) => k.event === "rekeyed"),
    JSON.stringify(kinds.map((k) => k.event)),
  );

  const [{ n: withContent }] = await sql.query(
    `select count(*)::int as n from "credential_event"
     where "detail" is not null and length("detail") > 40`,
  );
  check(
    "no event's detail is long enough to be carrying a secret",
    withContent === 0,
    `${withContent} rows have a detail over 40 characters`,
  );

  const tick = await fetch(`${base}/api/cron/tick`, {
    method: "POST",
    headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
  });
  const tickJson = await tick.json().catch(() => ({}));
  check(
    "the cron tick reports pruning the log, so retention is actually enforced",
    tick.status === 200 && typeof tickJson?.data?.pruned === "number",
    `got ${tick.status}: ${JSON.stringify(tickJson).slice(0, 200)}`,
  );
} catch (error) {
  failures += 1;
  console.error("\nVerification threw:", error);
} finally {
  if (webhookWorkflowId) {
    await api("DELETE", `/api/workflows/${webhookWorkflowId}`, undefined, token, workspaceId).catch(() => {});
  }
  if (arena) {
    await sql.query('delete from "workspace" where "id" = $1', [arena]).catch(() => {});
  }
  await cleanUpProbe();
  await sql.query('delete from "session" where "sessionToken" = $1', [token]).catch(() => {});
}

console.log(
  `\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}` +
    `${skipped > 0 ? ` (${skipped} skipped)` : ""}\n`,
);
process.exit(failures === 0 ? 0 : 1);
