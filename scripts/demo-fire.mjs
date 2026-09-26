/**
 * `DEMO.md` Beat 5's pre-staged command: fire the demo webhook without ever putting
 * the URL on a shared screen.
 *
 *   node --env-file=.env scripts/demo-fire.mjs                  # newest workflow, urgent payload
 *   node --env-file=.env scripts/demo-fire.mjs --payload calm    # the reserve payload
 *   node --env-file=.env scripts/demo-fire.mjs --workflow <id>   # pin one explicitly
 *   node --env-file=.env scripts/demo-fire.mjs --list            # what it would pick, and why
 *
 * **Why this exists, and why a bare `curl` cannot replace it.** Beat 3 generates the
 * workflow *live*, and `createWorkflow` mints a fresh 192-bit `webhookToken` for every
 * workflow at creation (D41). So the URL Beat 5 has to POST to did not exist when the
 * demo began — it cannot have been exported into `$WEBHOOK_URL` beforehand, which is
 * what `DEMO.md` said to do until Phase 12 rehearsed it and found the contradiction.
 *
 * The two obvious repairs are both bad on stage:
 *
 *  - Copy the URL out of the inspector live. It is a bearer secret (anyone holding it
 *    can start runs and spend model quota) and the inspector would be on the shared
 *    screen. `DEMO.md` says not to show it, for that reason.
 *  - Fire a pre-exported URL from some earlier workflow. This is the worst outcome
 *    available: the `curl` answers **201**, a run really does execute — on the *other*
 *    workflow — and the canvas the audience is watching never lights up, because the
 *    stream is workflow-scoped (D28). A green terminal beside a dead canvas.
 *
 * So the URL is resolved at fire time instead of ahead of it. The presenter types one
 * short, rehearsed command; this asks the API which workflow is newest, reads its
 * `webhookUrl`, and POSTs the payload **with no session at all**, exactly as a real
 * form would. The URL is never printed — not on success, not in an error.
 *
 * Auth for the *lookup* is a real database session row, inserted here and deleted in
 * the `finally`, the same mechanism `smoke.mjs` and `verify-api.mjs` use and the same
 * code path `auth()` takes. There is no test-only bypass in the app. The POST itself
 * deliberately carries no cookie, because proving the webhook needs none is Beat 5.
 *
 * Environment: DATABASE_URL (or DATABASE_URL_UNPOOLED) to mint the session. The target
 * is argv, else APP_BASE_URL, else localhost.
 */
import { neon } from "@neondatabase/serverless";

import { adaptPayload, CALM_PAYLOAD, URGENT_PAYLOAD } from "./demo-payload.mjs";

const args = process.argv.slice(2);

function flag(name) {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}
const has = (name) => args.includes(name);

const base = (
  args.find((a) => !a.startsWith("--") && /^https?:\/\//.test(a)) ??
  process.env.APP_BASE_URL ??
  "http://localhost:3000"
).replace(/\/$/, "");

const secure = base.startsWith("https://");
const cookieName = secure ? "__Secure-authjs.session-token" : "authjs.session-token";
const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);

const PAYLOADS = { urgent: URGENT_PAYLOAD, calm: CALM_PAYLOAD };

const which = flag("--payload") ?? "urgent";
const payload = PAYLOADS[which];
if (!payload) {
  console.error(`Unknown --payload ${which}. Use "urgent" or "calm".`);
  process.exit(2);
}

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

const [user] = await sql.query('select id, email from "user" order by "id" limit 1');
if (!user) {
  console.error("No user row exists — sign in through the browser once first.");
  process.exit(1);
}

const token = crypto.randomUUID() + crypto.randomUUID();
await sql.query('insert into "session" ("sessionToken", "userId", "expires") values ($1, $2, $3)', [
  token,
  user.id,
  new Date(Date.now() + 15 * 60 * 1000),
]);

/**
 * Everything below runs inside `main` so that no early return can skip the session
 * cleanup in the `finally`. `process.exit()` terminates immediately and does *not*
 * run a pending `finally`, so an early exit here would leave a live session row in
 * the database on every `--list` — the one thing this script must not do.
 */
async function main() {
  const listed = await fetch(`${base}/api/workflows`, {
    headers: { cookie: `${cookieName}=${token}` },
  });
  if (!listed.ok) {
    console.error(`Could not list workflows: HTTP ${listed.status}`);
    return 1;
  }

  const all = (await listed.json()).data ?? [];
  /**
   * Only workflows that will actually answer. `webhookUrl` is non-null exactly when
   * the stored graph holds a webhook trigger, so this filter asks the same question
   * the receiver asks — one without a trigger would 404 and read as a broken demo.
   */
  const firable = all.filter((w) => w.webhookUrl);

  if (has("--list")) {
    console.log(bold(`\nWorkflows that can be fired  ${dim(base)}`));
    for (const [i, w] of firable.entries()) {
      console.log(
        `  ${i === 0 ? "\x1b[32m\u2192\x1b[0m" : " "} ${w.name}  ${dim(
          `${w.runnable ? "runnable" : "NOT RUNNABLE"} \u00b7 updated ${w.updatedAt}`,
        )}`,
      );
    }
    if (firable.length === 0) console.log(dim("  none \u2014 generate one first"));
    console.log(dim("\nThe arrow is the one a bare `demo-fire` would pick.\n"));
    return 0;
  }

  const pinned = flag("--workflow");
  const target = pinned ? firable.find((w) => w.id === pinned) : firable[0];

  if (!target) {
    console.error(
      pinned
        ? `No workflow ${pinned} with a webhook trigger. Try --list.`
        : "No workflow with a webhook trigger exists yet. Generate one first (Beat 3), or --list.",
    );
    return 1;
  }

  if (!target.runnable) {
    console.error(`"${target.name}" is not runnable: ${JSON.stringify(target.problems)}`);
    return 1;
  }

  /**
   * The model chose what this trigger requires and what the nodes read, seconds ago.
   * Fit the payload to it rather than hoping the literal matches — see
   * `demo-payload.mjs` for the measured reason this is not paranoia.
   */
  const { payload: body_, added } = adaptPayload(target.graph, payload);

  console.log(`${bold("firing")}  ${target.name}  ${dim(`(${which} payload)`)}`);
  if (added.length > 0) {
    console.log(dim(`        fitted to this graph: added ${added.join(", ")}`));
  }

  const startedAt = Date.now();
  /** No cookie. The point of Beat 5 is that the webhook needs none. */
  const fired = await fetch(target.webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body_),
  });
  const body = await fired.json().catch(() => null);
  const elapsed = Date.now() - startedAt;

  if (fired.status !== 201) {
    // Never echoes the URL, not even when reporting a failure.
    console.error(
      `\x1b[31mHTTP ${fired.status}\x1b[0m  ${body?.error?.message ?? "no message"}  ${dim(`${elapsed} ms`)}`,
    );
    console.error(dim("Fallback F: trigger the run from the canvas instead."));
    return 1;
  }

  const run = body?.data ?? {};
  const branch = (run.steps ?? []).find((s) => s.branch)?.branch ?? "\u2014";
  const failed = (run.steps ?? []).filter((s) => s.status === "failed");
  console.log(
    `\x1b[32mHTTP 201\x1b[0m  run ${run.status}  ${dim(
      `${run.steps?.length ?? 0} steps \u00b7 branch "${branch}" \u00b7 ${run.durationMs ?? elapsed} ms`,
    )}`,
  );
  for (const step of failed) console.log(`  \x1b[31m${step.nodeType}\x1b[0m  ${step.error}`);

  return run.status === "succeeded" ? 0 : 1;
}

let exitCode = 1;
try {
  exitCode = await main();
} finally {
  await sql.query('delete from "session" where "sessionToken" = $1', [token]).catch(() => {});
}

process.exit(exitCode);
