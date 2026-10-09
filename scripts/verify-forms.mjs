/**
 * Forms and webhook responses, verified end to end against the deployed service — Phase 40.
 *
 *   APP_BASE_URL=https://… node --env-file=.env scripts/verify-forms.mjs
 *
 * **What this proves that the unit suites cannot.** `form.test.ts` and `respond.test.ts` assert the
 * rules and the engine's behaviour. They cannot show that a stranger with no session can load a page
 * and submit it, that the route refuses before it writes, that the honeypot and the rate limit act on
 * the deployed container, or that a webhook's caller really receives the status and headers a workflow
 * chose. `BUILD_PLAN.md` → *Phase 40* → *Validation steps*:
 *
 *   • the form page and its POST work signed out; a missing required field is refused and writes no run
 *   • the honeypot is answered like success and starts nothing; the rate limit answers 429 + Retry-After
 *   • an off form is closed; a rotated link kills the old one; nothing about the workflow leaks to a visitor
 *   • `curl` against a webhook gets the custom status, headers and body — and a branch not taken, the summary
 *   • a Respond is refused where nobody is waiting, and outside the allowlist
 *
 * Product actions go through the product's own API with a real `session` row (no test-only bypass);
 * everything a stranger does is sent with **no cookie at all**. It cleans up every workflow it made.
 */
import { neon } from "@neondatabase/serverless";
import { verificationUser } from "./verify-user.mjs";

const BASE = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
if (!BASE) throw new Error("APP_BASE_URL is required.");
const PREFIX = "PHASE 40 VERIFY — ";

const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);
const COOKIE = new URL(BASE).protocol === "https:" ? "__Secure-authjs.session-token" : "authjs.session-token";

let passed = 0;
let failed = 0;
const check = (ok, good, bad) => {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${good}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${bad ?? good}`);
  }
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let cookie = null;
let sessionToken = null;
const created = [];

async function mintSession() {
  const user = await verificationUser(sql);
  if (!user) throw new Error("No user row — sign in through the browser once first.");
  sessionToken = crypto.randomUUID() + crypto.randomUUID();
  await sql.query('insert into "session" ("sessionToken", "userId", "expires") values ($1, $2, $3)', [
    sessionToken,
    user.id,
    new Date(Date.now() + 60 * 60 * 1000),
  ]);
  cookie = `${COOKIE}=${sessionToken}`;
}

/** As the signed-in owner. */
async function api(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init.body === undefined ? {} : { "content-type": "application/json" }), cookie, ...init.headers },
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

/** As a stranger: no cookie, ever. */
async function stranger(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    redirect: "manual",
    headers: { ...(init.body === undefined ? {} : { "content-type": "application/json" }), ...init.headers },
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* an HTML page */
  }
  return { status: response.status, headers: response.headers, text, body };
}
const submit = (token, values) => stranger(`/api/form/${token}`, { method: "POST", body: JSON.stringify(values) });

const node = (id, type, config = {}, x = 0) => ({ id, type, position: { x, y: 0 }, config });
const edge = (source, target, sourceHandle = null) => ({ id: `${source}-${target}-${sourceHandle ?? "out"}`, source, target, sourceHandle });
const tokenOf = (url) => url.split("/").at(-1);

async function createWorkflow(name, graph) {
  const { status, body } = await api("/api/workflows", { method: "POST", body: JSON.stringify({ name: `${PREFIX}${name}`, graph }) });
  if (status !== 201) throw new Error(`creating "${name}" answered ${status}: ${JSON.stringify(body)}`);
  created.push(body.data.id);
  return body.data;
}
const runsOf = async (id) => (await api(`/api/workflows/${id}/runs`)).body?.data ?? [];
const runOf = async (id) => (await api(`/api/runs/${id}`)).body?.data;

const FIELDS = [
  { name: "name", label: "Your name", type: "text", required: true },
  { name: "email", label: "Your email", type: "email", required: true },
  { name: "plan", label: "Plan", type: "select", required: false, options: "Free, Team" },
  { name: "agree", label: "I agree to be contacted", type: "checkbox", required: true },
  { name: "notes", label: "Anything else?", type: "longtext" },
];

const form = (extra = {}, tail = [node("log", "core.log", { message: "{{trigger.name}} <{{trigger.email}}> chose {{trigger.plan}}" }, 260)], edges = [edge("form", "log")]) => ({
  version: 1,
  nodes: [
    node("form", "core.form_trigger", {
      title: "Verify form",
      description: "A form made by Phase 40's verification",
      fields: FIELDS,
      successMessage: "Got it — thank you.",
      failureMessage: "That did not go through.",
      ...extra,
    }),
    ...tail,
  ],
  edges,
});

console.log(`\nForms and webhook responses — ${BASE}\n`);
await mintSession();

try {
  /* ---------------------------------------------------------------- *
   * The form, as a stranger
   * ---------------------------------------------------------------- */
  console.log("The form, signed out");
  const wf = await createWorkflow("contact form", form());
  check(typeof wf.formUrl === "string" && wf.formUrl.includes("/f/"), "the saved workflow carries a form link");
  check(wf.webhookUrl === null, "…and no webhook URL: its trigger is a form");
  const token = tokenOf(wf.formUrl);

  const page = await stranger(`/f/${token}`);
  check(page.status === 200, "GET /f/<token> → 200 with no session", `GET /f/<token> → ${page.status}`);
  check(page.text.includes("Verify form") && page.text.includes("Your email"), "the page shows the form's title and its fields");
  check(/name="robots"[^>]*noindex|noindex[^>]*name="robots"/.test(page.text), "the page asks not to be indexed");
  check(/name="referrer"[^>]*no-referrer|no-referrer[^>]*name="referrer"/.test(page.text), "…and sends no Referer");
  check(!page.text.includes(PREFIX) && !page.text.includes(wf.id), "nothing about the workflow — its name or id — reaches a visitor");

  check((await stranger(`/f/zzzz-not-a-form-token-at-all-nope`)).status === 404, "an address that is not a form → 404");
  check((await stranger(`/f/!!`)).status === 404, "a malformed address → 404");
  check((await submit("zzzz-not-a-form-token-at-all-nope", {})).status === 404, "POST to a token that is not a form → 404");
  check((await submit("short", {})).status === 404, "POST to a malformed token → 404");

  const before = (await runsOf(wf.id)).length;
  const bad = await submit(token, { email: "not-an-email", plan: "Platinum", agree: false });
  check(bad.status === 400, "a submission missing a required field, with a bad email and an unlisted choice → 400", `→ ${bad.status}`);
  const fields = bad.body?.error?.details?.fields ?? {};
  check(["name", "email", "plan", "agree"].every((k) => typeof fields[k] === "string"), "…with a message per field", JSON.stringify(fields));
  check((await runsOf(wf.id)).length === before, "…and no run was written");

  const notJson = await stranger(`/api/form/${token}`, { method: "POST", body: "name=Ada", headers: { "content-type": "text/plain" } });
  check(notJson.status === 400, "a body that is not JSON → 400");
  const array = await submit(token, [1, 2]);
  check(array.status === 400, "a JSON array → 400");
  const huge = await submit(token, { name: "x".repeat(40 * 1024) });
  check(huge.status === 400 && /larger/i.test(huge.body?.error?.message ?? ""), "a body over 32 KB → 400 naming the limit", `→ ${huge.status}`);
  check((await runsOf(wf.id)).length === before, "…none of those wrote a run");

  // Built as text so `__proto__` is a real key on the wire, not a prototype assignment in this script.
  const good = await stranger(`/api/form/${token}`, {
    method: "POST",
    body: '{"name":"Ada","email":"ada@example.com","plan":"Team","agree":true,"notes":"hello","admin":true,"__proto__":{"x":1},"constructor":"no"}',
  });
  check(good.status === 200 && good.body?.data?.accepted === true, "a valid submission → 200 accepted", `→ ${good.status} ${good.text}`);
  check(good.body?.data?.message === "Got it — thank you.", "…saying the author's own success message");
  check(!/run|step|workflow|trace/i.test(JSON.stringify(good.body)), "…and nothing about the run", good.text);
  const runs = await runsOf(wf.id);
  check(runs.length === before + 1, "exactly one run started");
  const run = runs[0] ? await runOf(runs[0].id) : null;
  check(run?.trigger === "form" && run?.status === "succeeded", "…triggered by the form, and it succeeded", JSON.stringify(run && { t: run.trigger, s: run.status }));
  check(
    run?.input?.name === "Ada" && run?.input?.plan === "Team" && run?.input?.agree === true,
    "its input is the validated answers",
    JSON.stringify(run?.input),
  );
  check(
    !("admin" in (run?.input ?? {})) && !Object.hasOwn(run?.input ?? {}, "__proto__") && !("constructor" in (run?.input ?? {}) && typeof run.input.constructor === "string"),
    "an undeclared key a stranger sent never reaches the run — not even __proto__ or constructor",
    JSON.stringify(run?.input),
  );
  check(
    run?.steps?.find((s) => s.nodeId === "log")?.logs?.some((l) => l.message === "Ada <ada@example.com> chose Team"),
    "the steps after it read the answers as {{trigger.name}}",
    JSON.stringify(run?.steps?.find((s) => s.nodeId === "log")?.logs),
  );

  const trap = await submit(token, { name: "Bot", email: "bot@example.com", agree: true, hp_website: "http://spam.example" });
  check(trap.status === 200 && trap.body?.data?.accepted === true, "a filled honeypot is answered exactly like success");
  check((await runsOf(wf.id)).length === before + 1, "…and starts nothing");

  /* Off, then on */
  await api(`/api/workflows/${wf.id}`, { method: "PATCH", body: JSON.stringify({ active: false }) });
  const off = await submit(token, { name: "Ada", email: "ada@example.com", agree: true });
  check(off.status === 409, "a switched-off form → 409 and no run", `→ ${off.status}`);
  const closed = await stranger(`/f/${token}`);
  check(closed.status === 200 && /is closed/.test(closed.text), "…and its page says it is closed");
  await api(`/api/workflows/${wf.id}`, { method: "PATCH", body: JSON.stringify({ active: true }) });
  check((await submit(token, { name: "Ada", email: "ada@example.com", agree: true })).status === 200, "switched back on, it takes submissions again");

  /* Rotation */
  const rotated = await api(`/api/workflows/${wf.id}/webhook/rotate`, { method: "POST" });
  const newToken = tokenOf(rotated.body?.data?.formUrl ?? "");
  check(rotated.status === 200 && newToken && newToken !== token, "rotating issues a new link");
  check((await stranger(`/f/${token}`)).status === 404 && (await submit(token, {})).status === 404, "the old link is dead at once — page and POST");
  check((await stranger(`/f/${newToken}`)).status === 200, "the new one works");

  /* The webhook route does not answer for a form workflow, and the form route not for a webhook one */
  check(
    (await stranger(`/api/webhook/${newToken}`, { method: "POST", body: "{}" })).status === 404,
    "a form workflow's token does not open the webhook route",
  );

  /* A failing workflow: the visitor is told the author's message, and nothing of the error */
  const failing = await createWorkflow(
    "failing form",
    form({}, [node("check", "core.assert", { left: "{{trigger.email}}", operator: "equals", right: "never@example.com", message: "SECRET-INTERNAL-REASON" }, 260)], [edge("form", "check")]),
  );
  const failed409 = await submit(tokenOf(failing.formUrl), { name: "Ada", email: "ada@example.com", agree: true });
  check(failed409.status === 500 && failed409.body?.error?.message === "That did not go through.", "a run that fails tells the visitor the author's failure message", `→ ${failed409.status} ${failed409.text}`);
  check(!failed409.text.includes("SECRET-INTERNAL-REASON"), "…and none of the internal reason");
  const failedRuns = await runsOf(failing.id);
  check(failedRuns[0]?.status === "failed" && failedRuns[0]?.trigger === "form", "the failed run is in the author's history, as a form run");

  /* A form that answers: Respond */
  console.log("\nA form that answers");
  const answering = await createWorkflow(
    "answering form",
    form(
      {},
      [node("reply", "core.respond", { status: 200, body: { message: "Thanks {{trigger.name}}, we will write to {{trigger.email}}." } }, 260)],
      [edge("form", "reply")],
    ),
  );
  const answered = await submit(tokenOf(answering.formUrl), { name: "Ada", email: "ada@example.com", agree: true });
  check(answered.status === 200 && answered.body?.message === "Thanks Ada, we will write to ada@example.com.", "a Respond sets what the visitor is told", answered.text);
  const refusing = await createWorkflow(
    "refusing form",
    form({}, [node("reply", "core.respond", { status: 422, body: { message: "Not today." } }, 260)], [edge("form", "reply")]),
  );
  const refused = await submit(tokenOf(refusing.formUrl), { name: "Ada", email: "ada@example.com", agree: true });
  check(refused.status === 422 && refused.body?.message === "Not today.", "…and the status", `→ ${refused.status}`);

  /* ---------------------------------------------------------------- *
   * The webhook's answer
   * ---------------------------------------------------------------- */
  console.log("\nA webhook that answers");
  const hook = await createWorkflow("answering webhook", {
    version: 1,
    nodes: [
      node("trigger", "core.webhook_trigger", {}),
      node("check", "core.branch", { left: "{{trigger.ok}}", operator: "equals", right: "yes" }, 200),
      node("yes", "core.respond", { status: 202, headers: { "X-Request-Id": "req-{{trigger.qty}}", "Cache-Control": "no-store" }, body: { received: "{{trigger.qty}}", nested: { ok: true } } }, 420),
    ],
    edges: [edge("trigger", "check"), edge("check", "yes", "true")],
  });
  const hookUrl = `/api/webhook/${tokenOf(hook.webhookUrl)}`;
  const hit = await stranger(hookUrl, { method: "POST", body: JSON.stringify({ ok: "yes", qty: 3 }) });
  check(hit.status === 202, "curl against the webhook gets the workflow's status", `→ ${hit.status} ${hit.text}`);
  check(hit.headers.get("x-request-id") === "req-3" && hit.headers.get("cache-control") === "no-store", "…its headers, with the reference resolved");
  check(/application\/json/.test(hit.headers.get("content-type") ?? ""), "…as JSON");
  check(hit.body?.received === 3 && hit.body?.nested?.ok === true, "…and its body, built from the payload", hit.text);
  check(hit.body?.data === undefined, "…not the run summary");
  const miss = await stranger(hookUrl, { method: "POST", body: JSON.stringify({ ok: "no", qty: 1 }) });
  check(miss.status === 201 && miss.body?.data?.status === "succeeded", "a branch that never reaches the Respond answers with the run summary, as before", `→ ${miss.status} ${miss.text}`);

  /* ---------------------------------------------------------------- *
   * Where a Respond is refused
   * ---------------------------------------------------------------- */
  console.log("\nWhere a Respond is refused");
  const manual = await api("/api/workflows", {
    method: "POST",
    body: JSON.stringify({
      name: `${PREFIX}respond under a manual trigger`,
      graph: { version: 1, nodes: [node("t", "core.manual_trigger"), node("r", "core.respond", {}, 200)], edges: [edge("t", "r")] },
    }),
  });
  if (manual.body?.data?.id) created.push(manual.body.data.id);
  check(
    manual.body?.data?.runnable === false && manual.body?.data?.problems?.some((p) => p.code === "respond_without_caller" && p.nodeId === "r"),
    "a Respond under a manual trigger is a problem on the Respond itself",
    JSON.stringify(manual.body?.data?.problems),
  );
  for (const [label, config] of [
    ["a redirect status", { status: 302 }],
    ["a header that sets a cookie", { headers: { "Set-Cookie": "a=b" } }],
    ["a header with a line break", { headers: { "X-Request-Id": "a\r\nSet-Cookie: x" } }],
  ]) {
    const made = await api("/api/workflows", {
      method: "POST",
      body: JSON.stringify({
        name: `${PREFIX}bad respond`,
        graph: { version: 1, nodes: [node("t", "core.webhook_trigger"), node("r", "core.respond", config, 200)], edges: [edge("t", "r")] },
      }),
    });
    if (made.body?.data?.id) created.push(made.body.data.id);
    check(
      made.body?.data?.runnable === false && made.body?.data?.problems?.some((p) => p.code === "invalid_config" && p.nodeId === "r"),
      `${label} is refused when the workflow is saved`,
      JSON.stringify(made.body?.data?.problems),
    );
  }

  /* ---------------------------------------------------------------- *
   * The rate limit — last, so nothing else is slowed by it
   * ---------------------------------------------------------------- */
  console.log("\nThe rate limit");
  const limited = await createWorkflow("rate limited form", form());
  const limitedToken = tokenOf(limited.formUrl);
  let first429 = null;
  // Each instance counts for itself (12 an address), and a burst may land on any of up to three.
  for (let i = 0; i < 45 && !first429; i += 1) {
    const answer = await submit(limitedToken, {});
    if (answer.status === 429) first429 = { at: i + 1, answer };
  }
  check(first429 !== null, `a burst of invalid submissions meets a 429 (after ${first429?.at ?? "—"})`, "no 429 in 45 submissions");
  check(Number(first429?.answer.headers.get("retry-after")) > 0, "…with a Retry-After");
  check(first429?.answer.body?.error?.code === "rate_limited", "…in the API's envelope");
  check((await runsOf(limited.id)).length === 0, "…and none of it wrote a run");
  const other = await submit(tokenOf(answering.formUrl), { name: "Ada", email: "ada@example.com", agree: true });
  check(other.status !== 429, "another form is not slowed by it", `→ ${other.status}`);
} finally {
  for (const id of created) await api(`/api/workflows/${id}`, { method: "DELETE" }).catch(() => {});
  if (sessionToken) await sql.query('delete from "session" where "sessionToken" = $1', [sessionToken]);
  await sleep(0);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
