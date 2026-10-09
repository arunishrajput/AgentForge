/**
 * **The final security review of every unauthenticated surface — Phase 25.**
 *
 *   node --env-file=.env scripts/verify-security.mjs
 *
 * `BUILD_PLAN.md` → *Phase 25* asks for a "final security review of every unauthenticated
 * surface". `SECURITY.md` → *The unauthenticated surfaces* lists the routes and two pages
 * and says the complete list is the thing worth auditing. This script is what makes that
 * sentence enforceable instead of aspirational.
 *
 * ## The one check that matters
 *
 * **Every route under `src/app/api` is enumerated from the filesystem and called with no
 * session.** Each one must answer 401, *except* the documented exceptions below — and an
 * exception that is not in that table is a failure even if it answers correctly, because
 * then the table in `SECURITY.md` is wrong.
 *
 * It is derived from the filesystem for the same reason `docs/api.md` is coverage-checked
 * both ways (Phase 24): a list of routes maintained by hand is a list that is wrong by the
 * next phase. A new route shipped without `requireScope` fails this script on the push that
 * adds it, which is the only time that mistake is cheap to fix.
 *
 * ## Why it checks both directions
 *
 *   • **A route that should need a session and does not** is the vulnerability.
 *   • **A route that is in the exception table and now refuses anonymous callers** is also
 *     reported, because it means a documented public surface silently stopped working —
 *     a broken webhook or share link looks like a product bug, not a security event.
 *
 * ## What it deliberately does not do
 *
 * It does not try to *exploit* anything. The guards on the four public surfaces — token
 * width, constant-time comparison, the per-run dispatch token, the share allowlist — are
 * each proved by their own suite (`verify-api.mjs`, `verify-durable.mjs`, `verify-vault.mjs`)
 * and reasoned about in `SECURITY.md`. Duplicating that here would be a second, weaker copy.
 * This script answers exactly one question, completely: **which routes answer without a
 * session, and is that the set we meant?**
 *
 * It writes nothing and needs no session of its own.
 */
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const BASE = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
if (!BASE) throw new Error("APP_BASE_URL is required.");

let passed = 0;
let failed = 0;
const pass = (m) => {
  passed += 1;
  console.log(`   ✓ ${m}`);
};
const fail = (m) => {
  failed += 1;
  console.log(`   ✗ ${m}`);
};
const check = (ok, good, bad) => (ok ? pass(good) : fail(bad ?? good));

/* ------------------------------------------------------------------ *
 * The exception table — kept in step with SECURITY.md by hand, and the
 * script fails if reality disagrees with it in either direction.
 * ------------------------------------------------------------------ */

/**
 * Routes that answer without a session, and the guard that stands in for one. The value is
 * the status an anonymous call with no valid token should get: never 401 (there is no
 * session to be missing) and never 200 (the token is still required).
 */
const PUBLIC = {
  "/api/webhook/[token]": {
    guard: "192-bit token on the workflow row",
    // An unknown token is a 404: the route must not confirm which tokens exist.
    expect: [404],
  },
  // Phase 40 — a hosted form's submission, added in the phase that added it. The token is the workflow
  // row's (D41); the route has no GET, a per-form and per-address rate limit, a 32 KB cap, a honeypot
  // and server-side validation (`verify-forms.mjs` proves each against the deployment).
  "/api/form/[token]": {
    guard: "192-bit token on the workflow row, plus a rate limit per form and per address",
    // An unknown token is a 404: the route must not confirm which tokens are forms.
    expect: [404],
  },
  "/api/cron/tick": {
    guard: "CRON_SECRET, compared in constant time",
    expect: [401],
    // 401 here means "the secret is missing", not "the session is missing" — the same
    // status for a different reason, which is why this route is in the table.
    note: "401 is the missing-secret answer, not a missing session",
  },
  "/api/runs/dispatch": {
    guard: "CRON_SECRET plus the run's own 192-bit dispatchToken",
    expect: [401],
    note: "401 is the missing-secret answer, not a missing session",
  },
  // Phase 26 — a schedule timer's delivery. Added in the phase that added the route, as
  // BUILD_PLAN.md's Chapter 3 rules require.
  "/api/cron/fire": {
    guard: "CRON_SECRET plus an HMAC token for one slot of one workflow",
    expect: [401],
    note: "401 is the missing-secret answer, not a missing session",
  },
  "/api/share/[token]": {
    guard: "192-bit share token",
    expect: [404],
  },
  "/api/invitations/[token]": {
    guard: "256-bit token, stored only as sha256",
    expect: [404],
  },
  "/api/invitations/[token]/accept": {
    guard: "256-bit token — but accepting needs a session as well",
    // The preview is public; accepting is not. It is listed because the path is under a
    // public prefix and a reader of the tree would expect it to be public too.
    expect: [401],
    note: "the preview is public, accepting is not",
  },
  "/api/auth/[...nextauth]": {
    guard: "Auth.js — this IS the sign-in surface",
    // Auth.js answers its own routes; the catch-all with no action is a 400.
    expect: [200, 400, 302, 404, 405],
  },

  /* ---------------------------------------------------------------- *
   * The three this script added to the table, Phase 25.
   *
   * All three were already public and already deliberate; none of them
   * was in `SECURITY.md`, whose whole claim is that the list is
   * complete. Finding them is what the enumeration is for.
   * ---------------------------------------------------------------- */

  "/api/health": {
    guard: "none — by design. An uptime check cannot hold a session",
    expect: [200, 503],
    note: "publishes a rollup, counts and the revision; Phase 25 removed the GCP project id",
  },
  "/api/integrations/google/connect": {
    guard: "none on the route — it only builds Google's consent URL and redirects",
    expect: [302, 307],
    note: "an anonymous caller is redirected, and the callback is what refuses them",
  },
  "/api/integrations/google/callback": {
    guard: "the OAuth state parameter, plus a session on the callback itself",
    expect: [302, 307],
    note: "a callback with no session redirects home — asserted by verify-api.mjs",
  },

  /* ---------------------------------------------------------------- *
   * Phase 38 — the approval link, added in the phase that added it, as
   * BUILD_PLAN.md's Chapter 3 rules require. The token rides in the POST
   * body, never a URL, so a probe with no token is a 400 for the missing
   * field — and neither route has a GET for a link preview to call.
   * ---------------------------------------------------------------- */

  "/api/approve/describe": {
    guard: "256-bit token in the body, stored only as sha256",
    expect: [400],
    note: "no token is a malformed request; an unknown one is a 404 (verify-api.mjs)",
  },
  "/api/approve/decide": {
    guard: "256-bit token in the body, single use, dead with its run",
    expect: [400],
    note: "no token is a malformed request; a used one is a 409 (verify-api.mjs)",
  },
};

/**
 * Routes whose dynamic segment must be **real** for the probe to reach the auth check at
 * all. `/api/integrations/[service]` validates the slug against the registry *before*
 * `requireScope`, so an invented slug answers 404 whether or not a session was sent —
 * correct behaviour (a 404 reveals nothing), and a probe that cannot tell the two apart.
 * The first version of this script reported that route as public because of it.
 */
const REAL_SEGMENT = {
  "/api/integrations/[service]": "slack",
};

/** A placeholder for each dynamic segment that is certain not to exist. */
const SAMPLE = "zzz-phase25-security-review-nonexistent";

function listRouteFiles(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listRouteFiles(full, found);
    else if (entry.name === "route.ts") found.push(full);
  }
  return found;
}

function routePath(file) {
  return (
    "/" +
    relative(join(root, "src/app"), file)
      .replace(/\/route\.ts$/, "")
      .split("/")
      .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")))
      .join("/")
  );
}

/** The methods a route file actually exports, so a probe uses one the route answers. */
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

async function methodsOf(file) {
  const { readFileSync } = await import("node:fs");
  const text = readFileSync(file, "utf8");
  return METHODS.filter((method) => new RegExp(`export (async )?function ${method}\\b`).test(text));
}

const concrete = (route) => {
  const real = REAL_SEGMENT[route];
  if (real) return route.replace(/\[[^\]]+\]/g, real);
  return route.replace(/\[\.\.\.[^\]]+\]/g, SAMPLE).replace(/\[[^\]]+\]/g, SAMPLE);
};

async function call(method, path) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    redirect: "manual",
    headers: method === "GET" ? {} : { "content-type": "application/json" },
    ...(method === "GET" || method === "DELETE" ? {} : { body: "{}" }),
  });
  let code = null;
  try {
    code = (await response.json())?.error?.code ?? null;
  } catch {
    /* not JSON — a redirect or an HTML body. The status is the answer. */
  }
  return { status: response.status, code };
}

/* ------------------------------------------------------------------ *
 * Run it
 * ------------------------------------------------------------------ */

console.log(`\nSecurity review — every unauthenticated surface\n${BASE}\n`);

const files = listRouteFiles(join(root, "src/app/api")).sort();
const routes = files.map((file) => ({ file, path: routePath(file) }));

console.log(`${routes.length} API routes found under src/app/api\n`);

console.log("Routes that must require a session");
const unexpectedlyPublic = [];

for (const { file, path } of routes) {
  if (PUBLIC[path]) continue;
  const methods = await methodsOf(file);
  if (methods.length === 0) {
    fail(`${path} exports no HTTP method — it cannot be a route`);
    continue;
  }
  for (const method of methods) {
    const { status, code } = await call(method, concrete(path));
    const refused = status === 401 && code === "unauthenticated";
    if (!refused) unexpectedlyPublic.push(`${method} ${path} → ${status}${code ? ` ${code}` : ""}`);
    check(
      refused,
      `${method} ${path} → 401 unauthenticated`,
      `${method} ${path} → ${status}${code ? ` ${code}` : ""}, expected 401 unauthenticated`,
    );
  }
}

console.log("\nThe documented public surfaces — SECURITY.md");
for (const [path, spec] of Object.entries(PUBLIC)) {
  const file = routes.find((route) => route.path === path);
  if (!file) {
    fail(`${path} is in the exception table but no such route exists — SECURITY.md is stale`);
    continue;
  }
  const methods = await methodsOf(file.file);
  for (const method of methods) {
    const { status } = await call(method, concrete(path));
    check(
      spec.expect.includes(status),
      `${method} ${path} → ${status} (${spec.guard})${spec.note ? ` — ${spec.note}` : ""}`,
      `${method} ${path} → ${status}, expected one of ${spec.expect.join("/")} (${spec.guard})`,
    );
  }
}

/**
 * The count itself is an assertion, so a route added to the table without a thought about
 * `SECURITY.md` fails here. Fourteen entries: the four `SECURITY.md` always named, the
 * invitation preview and its non-public `accept` sibling, Auth.js's own catch-all, the
 * three Phase 25 found missing — `/api/health` and the two Google OAuth legs — Phase
 * 26's `/api/cron/fire`, Phase 38's two approval-link routes and Phase 40's `/api/form/[token]`. `SECURITY.md` says
 * "twelve routes" because it counts what answers without a session, and `accept` does
 * not; this counts the table, which lists it.
 */
console.log("\nThe shape of the exception table");
check(
  unexpectedlyPublic.length === 0,
  "no route outside the exception table answers without a session",
  `routes answering without a session and not documented: ${unexpectedlyPublic.join("; ")}`,
);

const publicRoutes = Object.keys(PUBLIC).length;
check(
  publicRoutes === 14,
  `the exception table holds ${publicRoutes} routes, matching SECURITY.md`,
  `the exception table holds ${publicRoutes} routes — update SECURITY.md and this count together`,
);

console.log("\nThe three public pages");
// Phase 38 added `/approve`: the approval link's page, the same static shell for everybody — its
// token is in the URL's fragment, which a browser never sends, so a GET of it knows nothing.
for (const path of ["/", "/design", "/approve"]) {
  const response = await fetch(`${BASE}${path}`, { redirect: "manual" });
  check(
    response.status === 200,
    `${path} → 200 with no session (static, nothing belonging to any account)`,
    `${path} → ${response.status} with no session`,
  );
}

/**
 * **A link preview decides nothing — Phase 38.** A chat app fetches a link it is shown, with a GET.
 * The approval link's routes have no GET at all, and its page is a static shell: asserted here in
 * both directions, so a GET handler added to either route — the one way a preview could decide —
 * fails this script.
 */
console.log("\nAn approval link cannot be decided by a GET");
for (const path of ["/api/approve/describe", "/api/approve/decide"]) {
  const response = await fetch(`${BASE}${path}`, { redirect: "manual" });
  check(
    response.status === 405,
    `GET ${path} → 405: there is nothing a link preview can call`,
    `GET ${path} → ${response.status}, expected 405`,
  );
}

/**
 * **The form page and its submission — Phase 40.** The page is the fourth a signed-out visitor can
 * reach, and the only one whose address is a credential in the *path*. An address that is not a form
 * answers the same 404 as any page that does not exist, and the submission route has no GET: a link
 * preview or a crawler can fetch nothing that starts a run.
 */
console.log("\nA form's page and submission");
{
  const page = await fetch(`${BASE}/f/${SAMPLE}`, { redirect: "manual" });
  check(page.status === 404, `/f/<not a form> → 404 with no session`, `/f/<not a form> → ${page.status}`);
  const malformed = await fetch(`${BASE}/f/!!`, { redirect: "manual" });
  check(malformed.status === 404, `/f/<malformed> → 404`, `/f/<malformed> → ${malformed.status}`);
  const get = await fetch(`${BASE}/api/form/${SAMPLE}`, { redirect: "manual" });
  check(get.status === 405, `GET /api/form/[token] → 405: nothing a link preview can call`, `GET /api/form/[token] → ${get.status}`);
}

/**
 * **An access token is not a way in by itself — Phase 41.** Every route that needs a session answers a
 * well-formed token nobody holds exactly as it answers nobody: 401 `unauthenticated`. The routes that
 * accept a token do so by asking the database, so a token that is not there gets the same word as no
 * token; the routes that never accept one do not look at the header at all. (That a *real* token is
 * accepted on the allowlist and refused everywhere else needs a real token — `verify-tokens.mjs`.)
 */
console.log("\nA token nobody holds is no credential");
{
  const unknown = `afp_${"B".repeat(43)}`;
  let refusedWithToken = 0;
  let total = 0;
  for (const { file, path } of routes) {
    if (PUBLIC[path]) continue;
    for (const method of await methodsOf(file)) {
      total += 1;
      const response = await fetch(`${BASE}${concrete(path)}`, {
        method,
        redirect: "manual",
        headers: { authorization: `Bearer ${unknown}`, ...(method === "GET" ? {} : { "content-type": "application/json" }) },
        ...(method === "GET" || method === "DELETE" ? {} : { body: "{}" }),
      });
      const body = await response.json().catch(() => null);
      if (response.status === 401 && body?.error?.code === "unauthenticated") refusedWithToken += 1;
      else fail(`${method} ${path} with an unknown token → ${response.status}, expected 401 unauthenticated`);
    }
  }
  check(refusedWithToken === total, `all ${total} session routes → 401 unauthenticated for an unknown token`, `${refusedWithToken} of ${total} refused`);
}

/** A signed-in page must send an anonymous visitor to the landing page, not to an error. */
console.log("\nSigned-in pages redirect rather than failing");
// `/runs` and a run's page are Phase 33's: the history is a signed-in page like the others.
for (const path of ["/workflows", "/runs", `/runs/${SAMPLE}`, "/templates", "/analytics", "/settings"]) {
  const response = await fetch(`${BASE}${path}`, { redirect: "manual" });
  const location = response.headers.get("location") ?? "";
  check(
    [302, 303, 307].includes(response.status) && (location === "/" || location.endsWith("/")),
    `${path} → ${response.status} to ${location || "/"} with no session`,
    `${path} → ${response.status}${location ? ` to ${location}` : ""}, expected a redirect to /`,
  );
}

/** Phase 42 (D193): every kind of response carries the framing and sniffing headers. */
console.log("\nSecurity headers on pages, API answers and refusals");
for (const path of ["/", "/design", "/approve", "/f/" + "x".repeat(32), "/api/health", "/api/workflows", "/no-such-page"]) {
  const response = await fetch(`${BASE}${path}`, { redirect: "manual" });
  const csp = response.headers.get("content-security-policy") ?? "";
  check(
    /(^|; )frame-ancestors 'self'(;|$)/.test(csp) &&
      response.headers.get("x-frame-options") === "SAMEORIGIN" &&
      response.headers.get("x-content-type-options") === "nosniff",
    `${path} (${response.status}) cannot be framed by another site and is not sniffed`,
    `${path} (${response.status}) is missing a framing or sniffing header: csp=${JSON.stringify(csp)}`,
  );
  check(!/unsafe-|form-action/.test(csp), `${path}'s policy has no unsafe- source and no form-action`);
}

console.log(`\n${passed} passed / ${failed} failed\n`);
if (failed > 0) {
  console.log("Security review FAILED\n");
  process.exit(1);
}
console.log("Security review PASSED\n");
