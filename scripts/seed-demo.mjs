/**
 * Puts the demo account into the exact state `DEMO.md` assumes, and proves it.
 *
 *   node --env-file=.env scripts/seed-demo.mjs https://<the deployed url>
 *   node --env-file=.env scripts/seed-demo.mjs <url> --check      # report only, change nothing
 *   node --env-file=.env scripts/seed-demo.mjs <url> --keep-rows  # leave the sheet as it is
 *
 * `BUILD_PLAN.md` Phase 12 task 1. Three things it guarantees:
 *
 *  1. **The backup workflow exists and has been proved to work** — `DEMO.md` Fallback
 *     A, the single item that makes a bad generation survivable on stage. It is
 *     generated from the real demo prompt, its Sheets node is pointed at the demo
 *     spreadsheet, and then it is actually *run* end to end. "Already-generated,
 *     already-verified" is a claim, and a claim needs evidence.
 *  2. **The demo spreadsheet holds nothing but its header row.** Every smoke walk
 *     appends one, and `--loop 10` leaves ten; a sheet with fourteen stale rows makes
 *     Beat 8's payoff impossible to point at.
 *  3. **Nothing else is left lying around** — the generated scratch workflows are
 *     deleted and expired session rows are swept.
 *
 * It is written to be run **repeatedly** — before demo day, and after any smoke run
 * that dirtied the sheet — so every step is idempotent. This is deliberate: Phase 11's
 * hardest lesson was that a demo spreadsheet set up by hand had its id recorded
 * nowhere and could not be found again. Setup that only exists in someone's terminal
 * history is setup that is gone by the next session.
 *
 * **What it cannot do, and says so at the end:** delete the Discord messages. A webhook
 * post can only be deleted by its own message id, and the app does not keep them — it
 * has no reason to. Clearing `#agentforge-demo` is a human with a mouse.
 *
 * Environment: DATABASE_URL_UNPOOLED (session + credential), ENCRYPTION_KEY,
 * GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (to mint a Sheets access token from the
 * stored refresh token). SEED_SPREADSHEET_ID or SMOKE_SPREADSHEET_ID, else --sheet.
 */
import { createDecipheriv } from "node:crypto";

import { neon } from "@neondatabase/serverless";

import { adaptPayload, DEMO_PROMPT, URGENT_PAYLOAD } from "./demo-payload.mjs";

const args = process.argv.slice(2);
const flag = (n) => (args.indexOf(n) === -1 ? undefined : args[args.indexOf(n) + 1]);
const has = (n) => args.includes(n);

const base = (
  args.find((a) => /^https?:\/\//.test(a)) ??
  process.env.APP_BASE_URL ??
  "http://localhost:3000"
).replace(/\/$/, "");

const spreadsheetId =
  flag("--sheet") ?? process.env.SEED_SPREADSHEET_ID ?? process.env.SMOKE_SPREADSHEET_ID ?? "";
const checkOnly = has("--check");
const keepRows = has("--keep-rows");

const secure = base.startsWith("https://");
const cookieName = secure ? "__Secure-authjs.session-token" : "authjs.session-token";
const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);

/**
 * The backup workflow's name is matched exactly, so re-running replaces it rather
 * than accumulating copies. It is also what the presenter looks for on stage under
 * pressure, which is why it says what it is rather than being called "Copy of…".
 */
const BACKUP_NAME = "DEMO BACKUP — form triage (verified)";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/* ------------------------------------------------------------------ *
 * Reporting
 * ------------------------------------------------------------------ */

let failures = 0;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

function ok(label, detail) {
  console.log(`  \x1b[32mOK\x1b[0m    ${label}${detail ? dim(`  ${detail}`) : ""}`);
}
function bad(label, detail) {
  failures += 1;
  console.log(`  \x1b[31mFAIL\x1b[0m  ${label}`);
  if (detail) console.log(`        ${detail}`);
}
function todo(label, detail) {
  console.log(`  \x1b[33mTODO\x1b[0m  ${label}`);
  if (detail) console.log(`        ${dim(detail)}`);
}
function step(text) {
  console.log(`\n${bold(text)}`);
}

/* ------------------------------------------------------------------ *
 * HTTP against the app
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

/* ------------------------------------------------------------------ *
 * The stored Google credential — read exactly the way the app reads it
 * ------------------------------------------------------------------ */

/**
 * AES-256-GCM, the envelope from `src/lib/crypto.ts`. Reimplemented in eight lines
 * rather than imported because this script is plain `.mjs` and importing the app's
 * TypeScript would drag in `@/db`, Next's module aliases and the whole resolve hook
 * for one decrypt. If the envelope format ever changes, this fails loudly on the
 * auth tag rather than returning something plausible.
 */
function decryptSecret({ ciphertext, iv, authTag }) {
  const key = Buffer.from(process.env.ENCRYPTION_KEY ?? "", "base64");
  if (key.length !== 32) throw new Error(`ENCRYPTION_KEY must decode to 32 bytes; got ${key.length}`);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** The stored secret for `google.oauth` *is* the refresh token (store.ts). */
async function sheetsAccessToken(ownerId) {
  const [row] = await sql.query(
    `select ciphertext, iv, "authTag", metadata from credential
       where "ownerId" = $1 and kind = 'google.oauth' limit 1`,
    [ownerId],
  );
  if (!row) throw new Error("Google is not connected — connect it at Settings → Integrations.");

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: decryptSecret(row),
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
    }).toString(),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new Error(`Google refused the token request: ${body.error_description ?? response.status}`);
  }
  return body.access_token;
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
  new Date(Date.now() + 30 * 60 * 1000),
]);

console.log(bold("\nAgentForge — seed the demo account"));
console.log(`target  ${base}`);
console.log(`as      ${user.email}`);
console.log(`sheet   ${spreadsheetId || dim("(none given — sheet steps will be skipped)")}`);
console.log(checkOnly ? dim("mode    --check: reporting only, changing nothing") : "");

async function main() {
  /* 1 — the prerequisites the demo cannot run without ------------------ */
  step("1. Credentials");

  // Three separate routes, not one status endpoint — the integrations are stored and
  // read independently, and each settings card asks its own.
  const [googleRes, discordRes, provider] = await Promise.all([
    api("/api/integrations/google", { cookie: token }),
    api("/api/integrations/discord", { cookie: token }),
    api("/api/settings/provider", { cookie: token }),
  ]);
  const google = googleRes.data;
  const discord = discordRes.data;

  provider.data?.configured
    ? ok("Gemini key stored", `model ${provider.data.model ?? "default"}`)
    : bad("No Gemini key stored", "Beats 3 and 7 cannot run. Settings → Provider.");

  google?.connected && google.canAppendSheets
    ? ok("Google connected", `${google.email} · sheets ✓${google.canSendMail ? " mail ✓" : ""}`)
    : bad("Google not connected for Sheets", "Beat 8's second payoff. Settings → Integrations.");

  discord?.configured
    ? ok("Discord webhook stored", discord.webhookName ?? "")
    : bad("No Discord webhook stored", "Beat 8's first payoff. Settings → Integrations.");

  if (failures > 0) {
    console.log(dim("\nFix the above first — seeding a demo on missing credentials proves nothing."));
    return 1;
  }

  /* 2 — the backup workflow -------------------------------------------- */
  step("2. Backup workflow (DEMO.md Fallback A)");

  const before = (await api("/api/workflows", { cookie: token })).data ?? [];
  const existing = before.filter((w) => w.name === BACKUP_NAME);

  if (checkOnly) {
    existing.length === 1 && existing[0].runnable
      ? ok("backup workflow present and runnable", existing[0].updatedAt)
      : bad(`backup workflow ${existing.length === 0 ? "missing" : "not runnable"}`, "run without --check to build it");
  } else {
    for (const w of existing) {
      await api(`/api/workflows/${w.id}`, { cookie: token, method: "DELETE" });
    }
    if (existing.length > 0) ok(`replaced ${existing.length} previous copy`, "so re-running cannot accumulate copies");

    /**
     * Up to three attempts. Generation is measured 10/10 on the first attempt, but
     * this workflow's whole job is to be the thing that works when generation does
     * not — so it does not get to inherit generation's failure mode.
     */
    let built = null;
    for (let attempt = 1; attempt <= 3 && !built; attempt += 1) {
      const generated = await api("/api/workflows/generate", {
        cookie: token,
        method: "POST",
        body: { prompt: DEMO_PROMPT },
      });
      if (generated.status !== 201) {
        console.log(dim(`        attempt ${attempt}: HTTP ${generated.status} ${generated.error?.message ?? ""}`));
        continue;
      }
      const w = generated.data.workflow;
      const types = new Set(w.graph.nodes.map((n) => n.type));
      const spine =
        types.has("core.webhook_trigger") &&
        types.has("ai.agent") &&
        types.has("core.branch") &&
        types.has("integration.discord") &&
        types.has("integration.sheets");

      if (w.runnable && spine && (generated.data.unsupported ?? []).length === 0) {
        built = w;
        const { added } = adaptPayload(w.graph, URGENT_PAYLOAD);
        ok(
          `generated on attempt ${attempt}`,
          `${w.graph.nodes.length} nodes${added.length ? ` · trigger wants ${added.join(", ")}` : ""}`,
        );
      } else {
        console.log(dim(`        attempt ${attempt}: wrong shape, discarding`));
        await api(`/api/workflows/${w.id}`, { cookie: token, method: "DELETE" });
      }
    }

    if (!built) {
      bad("could not generate a correct backup workflow in 3 attempts", "the demo has no Fallback A");
      return 1;
    }

    /**
     * The generated Sheets node is born with an empty `spreadsheetId` on purpose —
     * the prompt names no spreadsheet, so the model has nothing to put there. The
     * backup must be ready to *run*, not ready to be configured, so it is filled in
     * here. Beat 4's live edit is what fills it in on the generated one.
     */
    let filled = 0;
    const graph = built.graph;
    for (const node of graph.nodes) {
      if (node.type === "integration.sheets" && spreadsheetId) {
        node.config = { ...node.config, spreadsheetId };
        filled += 1;
      }
    }

    const saved = await api(`/api/workflows/${built.id}`, {
      cookie: token,
      method: "PATCH",
      body: { name: BACKUP_NAME, graph },
    });
    saved.status === 200
      ? ok(`named and saved`, `${filled} Sheets node(s) pointed at the demo sheet`)
      : bad("could not save the backup workflow", saved.error?.message);

    /* 3 — prove it actually runs -------------------------------------- */
    step("3. Proving the backup workflow (this posts to Discord and the sheet)");

    /**
     * Fitted to the graph the model just wrote. The first run of this script built a
     * backup workflow whose trigger required `submission`, fired Beat 5's literal
     * payload at it and got **400** — the safety net, born broken. Proving it with a
     * payload the demo would not send proves the wrong thing, so this is the same
     * adaptation `demo-fire.mjs` performs on stage.
     */
    const { payload: firePayload, added: fitted } = adaptPayload(saved.data.graph, URGENT_PAYLOAD);
    if (fitted.length > 0) console.log(dim(`        payload fitted: added ${fitted.join(", ")}`));

    const fired = await fetch(saved.data.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(firePayload),
    });
    const run = (await fired.json().catch(() => ({})))?.data;

    if (fired.status !== 201 || run?.status !== "succeeded") {
      bad(
        `the backup workflow does not run (HTTP ${fired.status}, run ${run?.status ?? "?"})`,
        (run?.steps ?? [])
          .filter((s) => s.status === "failed")
          .map((s) => `${s.nodeType}: ${s.error}`)
          .join("\n        ") || "no step detail",
      );
      return 1;
    }

    const discordStep = run.steps.find((s) => s.nodeType === "integration.discord");
    const sheetsStep = run.steps.find((s) => s.nodeType === "integration.sheets");
    const branch = run.steps.find((s) => s.branch)?.branch;

    ok("it runs end to end", `${run.steps.length} steps, ${run.durationMs} ms, branch "${branch}"`);
    discordStep?.status === "succeeded"
      ? ok("it posts to Discord")
      : bad("its Discord step did not succeed", discordStep?.error);
    sheetsStep?.status === "succeeded"
      ? ok("it appends to the Sheet", sheetsStep.output?.updatedRange)
      : bad("its Sheets step did not succeed", sheetsStep?.error);
  }

  /* 4 — the sheet ------------------------------------------------------ */
  step("4. Demo spreadsheet");

  if (!spreadsheetId) {
    todo("no spreadsheet id given", "pass --sheet <id> or set SEED_SPREADSHEET_ID");
  } else {
    const accessToken = await sheetsAccessToken(user.id);
    const auth = { authorization: `Bearer ${accessToken}` };

    const read = await fetch(`${SHEETS_API}/${spreadsheetId}/values/Sheet1!A1:D1000`, { headers: auth });
    const body = await read.json().catch(() => ({}));
    if (!read.ok) {
      bad(`cannot read the demo sheet (HTTP ${read.status})`, body?.error?.message);
    } else {
      const rows = body.values ?? [];
      const header = rows[0] ?? [];
      const dataRows = rows.length > 1 ? rows.length - 1 : 0;

      header.length >= 3
        ? ok("header row present", header.join(" · "))
        : bad("the sheet has no header row", "DEMO.md expects Received · From · Summary · Urgency");

      if (dataRows === 0) {
        ok("sheet is clear", "only the header remains");
      } else if (keepRows || checkOnly) {
        todo(`${dataRows} stale row(s) below the header`, checkOnly ? "run without --check to clear" : "--keep-rows given");
      } else {
        const cleared = await fetch(`${SHEETS_API}/${spreadsheetId}/values/Sheet1!A2:Z1000:clear`, {
          method: "POST",
          headers: { ...auth, "content-type": "application/json" },
        });
        cleared.ok
          ? ok(`cleared ${dataRows} stale row(s)`, "Beat 8's new row is now the only one")
          : bad(`could not clear the sheet (HTTP ${cleared.status})`);
      }
    }
  }

  /* 5 — leftovers ------------------------------------------------------ */
  step("5. Leftovers");

  const workflows = (await api("/api/workflows", { cookie: token })).data ?? [];
  const strays = workflows.filter((w) => w.name !== BACKUP_NAME);
  strays.length === 0
    ? ok("no stray workflows", `${workflows.length} workflow(s) in the account`)
    : todo(
        `${strays.length} workflow(s) besides the backup`,
        `${strays.map((w) => w.name).join(", ")} — harmless, but Beat 1's list is on screen`,
      );

  if (!checkOnly) {
    const swept = await sql.query('delete from "session" where expires < now() returning "sessionToken"');
    swept.length > 0
      ? ok(`swept ${swept.length} expired session row(s)`)
      : ok("no expired session rows");
  }

  return failures === 0 ? 0 : 1;
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (error) {
  bad("seeding threw", error?.message ?? String(error));
  exitCode = 1;
} finally {
  await sql.query('delete from "session" where "sessionToken" = $1', [token]).catch(() => {});
}

console.log(
  `\n${exitCode === 0 ? "\x1b[32mSEEDED\x1b[0m" : "\x1b[31mNOT READY\x1b[0m"}  ${failures} failure(s)`,
);
if (!checkOnly && exitCode === 0) {
  console.log(
    dim(
      "\nStill needs a human:\n" +
        "  • Clear #agentforge-demo in Discord. A webhook post can only be deleted by its own\n" +
        "    message id and the app does not keep them — this script cannot do it.\n" +
        "  • Sign the demo browser profile OUT, so Beat 1 shows a real sign-in.",
    ),
  );
}

process.exit(exitCode);
