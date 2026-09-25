# PROGRESS.md — AgentForge execution state

**The status board.** A fresh session reads this and immediately knows where things stand. Keep it
concise and operational — prune stale detail rather than appending forever. This is not a diary.

---

## Project Status

**Phase 4 is complete. AgentForge has a working visual canvas in production.**

**https://agentforge-733000675212.asia-southeast1.run.app**

A workflow can be built in the browser — nodes added from the registry-driven palette, connected by
dragging handles, configured through forms generated from each node's schema — then saved, hard
reloaded unchanged, and run from the canvas with per-node status shown on each node. Verified by 46
live checks against the deployed URL **and** by driving the deployed canvas in a real browser. No
manual actions pending.

## Current Phase

**Phase 5 — live execution: per-node status and log streaming to the UI** (not started) —
`READY TO START`

## Completed Phases

| Phase | Status |
|---|---|
| **Phase 0** — setup, prerequisites, foundation decision | **COMPLETE** |
| **Phase 1** — application skeleton with Google auth | **COMPLETE** |
| **Phase 2** — first deploy, auth in production | **COMPLETE** — verified in a browser |
| **Phase 3** — data model, node registry, execution engine | **COMPLETE** — verified on the deployed URL, 2026-09-25 |
| **Phase 4** — visual canvas: build, edit, save, load | **COMPLETE** — verified on the deployed URL in a browser, 2026-09-26 |

---

## Deployed State

| Field | Value |
|---|---|
| **Canonical URL** | **`https://agentforge-733000675212.asia-southeast1.run.app`** |
| Legacy URL | `https://agentforge-i5d2u66boa-as.a.run.app` — works, do not publish it |
| Service | `agentforge` on Cloud Run, `asia-southeast1` |
| Revision | **`agentforge-00004-2xw`** — ready, 100% of traffic. Previous good revision: `agentforge-00003-ndb` |
| Scaling | `min-instances 1`, `max-instances 3`, 1 vCPU / 1 GiB, 3600 s timeout, port 8080 |
| Env vars set | `NODE_ENV` `AUTH_URL` `APP_BASE_URL` `DATABASE_URL` `AUTH_SECRET` `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` `ENCRYPTION_KEY` `CRON_SECRET` — 9, unchanged by Phase 4 |
| Database | Neon `super-mountain-39872886` — **8 tables**, migrations `0000` + `0001` applied |
| Routes | `/` `/dashboard`→`/workflows` `/workflows` `/workflows/[id]` + 7 API routes |
| Warm latency | health 142 ms India → Singapore; a 4-node run on the deployed canvas took **104 ms** |
| Last verified | **2026-09-26** — `node --env-file=.env scripts/verify-api.mjs <url>`, all 46 checks passed, plus a browser build/save/reload/run on the deployed canvas |

**A redeploy preserves env vars.** Confirmed again on Phase 4's two deploys: `gcloud run deploy
agentforge --source . --region asia-southeast1` with no `--env-vars-file` carried all 9 variables
to each new revision. The file is only needed when a variable changes.

---

## Phase 4 — what was verified, not just written

`npm test` — 41 tests, no database, ~130 ms. Phase 4 added 22: the canvas round trip and the
schema→form mapping, both pure modules with no DOM.
`scripts/verify-api.mjs` — **46 checks over HTTP**, run against localhost first, then the deployed
URL. It mints a real database session row, drives the API exactly as a browser would, and deletes
the row afterwards. Phase 4 added 13 covering the palette projection, page reachability and
owner-scoping, and a canvas-shaped graph saving, running and reporting its problems.

**A script cannot prove a canvas works.** So the deployed app was also driven in a real browser:

| Checked on the deployed canvas | Result |
|---|---|
| Palette built from the registry | ✓ six nodes, grouped by category, no hardcoded list |
| Add four nodes by clicking the palette | ✓ laid out as a left-to-right chain, all in view |
| Connect by dragging handles | ✓ 3 edges, ids `e1`–`e3`, branch edge carries `sourceHandle: "true"` |
| Configure through generated forms | ✓ key/value editor, required marker, operator select, textarea |
| Drag a node to a fractional position | ✓ `x: 884.784, y: 572.625` |
| Save, then **hard reload** | ✓ every node position byte-identical, name and edges intact |
| Header state after reload | ✓ reads `Saved`, not `Unsaved changes` — the jsonb key reorder does not read as dirty |
| Run from the canvas with a trigger payload | ✓ succeeded in **104 ms**, all four nodes `Succeeded` |
| Templates threaded end to end | ✓ `{{input.subject}}` → `{{input.topic}}` → `{{input.matched}}` |
| Per-node status on the canvas | ✓ badge per node, branch shows `→ true` |
| Delete the trigger, save | ✓ saves anyway, `runnable: false`, `no_trigger` shown in the panel |
| Run an unrunnable workflow | ✓ blocked with a message, no run row created |
| Console | ✓ **0 errors, 0 warnings** |
| Database left clean | ✓ 0 workflows, 0 runs, 0 steps; both test sessions revoked |

**Two real bugs were caught by warnings rather than by a failing check**, both fixed:

1. **The registry arrived after the first render.** It was fetched client-side, so every node
   briefly drew with a single default output and React Flow could not resolve the edge leaving the
   branch's `true` handle. On a cold instance a user would watch a branch node appear broken. The
   page now passes `describeNodes()` from the server component.
2. **`z.toJSONSchema` output would not cross the RSC boundary.** React rejects anything that is not
   a plain object; `describeNode` now forces the schema through JSON. See `CONTRACT.md`.

## Decisions — BINDING

Carried forward from every phase. These are the decisions later sessions must not quietly undo.

| # | Decision | Basis |
|---|---|---|
| D6 | **Driver: `drizzle-orm/neon-http`**, not `neon-serverless` | One HTTP round trip per statement, no pool, ideal for a scale-to-zero container. No transaction support. **Re-examined in Phase 3 and kept** — see D14 |
| D7 | **A misconfigured container must exit, not serve** | When `register()` merely throws, Next keeps listening and answers HTTP 500 to everything; Cloud Run reads the open port as healthy. `src/instrumentation.ts` calls `process.exit(1)` in production |
| D8 | **`agentRules: false` in `next.config.ts`** | `next dev` otherwise appends a generated block to `CLAUDE.md` on every run |
| D9 | **No middleware.** Route protection is a server-side `auth()` check | Next 16 renamed `middleware` to `proxy` with no edge runtime, and database sessions cannot be read from the edge |
| D10 | **The deterministic URL is canonical** | `status.url` returns the *legacy hashed* URL, which breaks production sign-in if used for `AUTH_URL` |
| D11 | **Production env vars go on the deploy command via `--env-vars-file`** | D7 makes a revision with a missing variable exit 1. `--set-env-vars` also splits on `,` and `=`, which connection strings contain. **Only needed when a variable changes** — a plain redeploy inherits them |
| D12 | **`.gcloudignore` is committed** | It governs what leaves the machine, so it is reviewed and version-controlled |
| D13 | **`DATABASE_URL_UNPOOLED` is not set on the service** | Only `drizzle.config.ts` reads it; setting it would widen the production secret surface for nothing |
| **D14** | **The workflow graph is one `jsonb` column, not node and edge tables** | `neon-http` has no transactions, so a three-table graph could not be saved atomically; a single-row update is atomic for free. The canvas saves the whole graph at once and no query wants edges across workflows. This is what let D6 stand |
| **D15** | **The engine is a work list, not a static topological sort** | Branch and loop outputs mean the order is only known as the run proceeds. Topological analysis is still used at validation, to reject any cycle that does not close through a loop node |
| **D16** | **A run's bounds are safety properties, not tuning knobs** | `HARD_MAX_ITERATIONS` 25, `MAX_NODE_EXECUTIONS` 30, `MAX_STEPS` 200, deadline 120 s. The loop cap and the per-node cap are independent, so a malformed graph that defeats one still hits the other. Phase 7 generates graphs from model output — this is the containment |
| **D17** | **`{{ }}` is lookup, not an expression language** | No eval, no operators, no function calls. A config field is exactly where arbitrary code execution would re-enter the product. A test asserts `{{1+1}}` stays literal |
| **D18** | **The engine takes its recorder as an argument** | `src/lib/engine/recorder.ts` is the only engine module importing `@/db`, so the critical-path tests run with no database, no network, in ~100 ms |
| **D19** | **`agentCallable` defaults to false** | Adding a node must not silently widen what the agent may do. Phases 8–9 opt each new node in deliberately |
| **D20** | **Another user's record answers 404, not 403** | 403 confirms the record exists. Every query filters on the session's user id; no code path reads a workflow or run by id alone |
| **D21** | **The canvas is one React Flow node type; the registry type lives in `data.nodeType`** | Registering six React Flow types would make an *unknown* type fall back to React Flow's default node — the one case that must be visible as a problem. One type renders unknown nodes explicitly |
| **D22** | **A canvas node's `data` holds persisted fields only** | Run status and the registry travel by context instead, so `fromFlow` is a clean inverse of `toFlow` and no UI state can leak into a saved graph. It also means a status change does not rebuild every node object — which is what Phase 5 will do many times a second |
| **D23** | **The registry is passed from the server component, not fetched by the canvas** | A node's output handles come from its registry entry. Fetching it client-side makes every node briefly render with the wrong handles and breaks edges that leave a named handle. `describeNodes()` is the same projection `GET /api/nodes` serves |
| **D24** | **`describeNode` output must be plain JSON** | It crosses to a client component. React refuses to serialise anything else, and the failure is a console error at render time rather than a type error. See `CONTRACT.md` |
| **D25** | **Dirty state is a structural graph comparison, never a string one** | Postgres `jsonb` reorders object keys, so a freshly loaded workflow would otherwise always read as having unsaved changes |
| **D26** | **Adding a node is a click, not a drag** | It satisfies "the palette comes from the registry" with no drop-target failure mode, works on any input device, and the demo's editing beat opens a node rather than dragging one (`DEMO.md`, Beat 4) |

---

## Known Issues

| Issue | Impact | Action |
|---|---|---|
| **Rollback is still untested** | Demo-day risk | Phase 3 created a second revision so it is now *possible*. The attempt was blocked by the session's production-deploy guard. **Run it manually once before demo day:** `gcloud run services update-traffic agentforge --region asia-southeast1 --to-revisions agentforge-00003-ndb=100`, verify, then shift back to the newest revision |
| **Google OAuth changes take ~90 s to propagate** | Cost 90 s in Phase 2 | Wait and retry before suspecting a typo |
| **A curl check cannot detect `redirect_uri_mismatch`** | Nearly caused a false "verified" | Only a real browser sign-in proves the OAuth redirect |
| **`min-instances 1` bills continuously** | Cost, after the hackathon | **Set to 0 once judging ends** |
| **OAuth consent screen is in `Testing`** | Demo day | Only listed test users can sign in. Before the demo: publish the app, or add each judge as a test user (cap 100) |
| **4 moderate `npm audit` findings, one root cause** | None in production | esbuild dev-server issue reachable only through `drizzle-kit`. Dev dependency, absent from the runtime image. **Accepted** |
| **Discord rejects requests with no `User-Agent`** | Phase 9 Discord node | Send an explicit UA |
| **`gemini-2.0-flash` is retired** | Phases 6, 7 | List models, never assume a name |
| **No favicon — `/favicon.ico` 404s** | Cosmetic, visible in the browser tab on demo day | Phase 10 (UI/UX pass). `public/` already exists |
| **A port-3000 `next dev` can outlive its session** | A stale server serves old code and the next session's `npm run dev` silently moves to 3001 | Check `lsof -nP -iTCP:3000 -sTCP:LISTEN` before trusting a local check |
| **Pinned Gemini models return 503 under load** | Demo reliability | The adapter needs retry + a fallback chain |
| **Gemini first call took ~8.9 s** | Demo pacing | Warm the model before the demo |

Carried risks, recorded so they are not rediscovered:

| Risk | Where it bites | Mitigation |
|---|---|---|
| In-flight runs die on redeploy — no queue | Any deploy during a run | Do not deploy on demo day. **Now handled gracefully:** `reapStaleRuns` moves an abandoned run to `failed` within 5 minutes |
| Only one LLM provider available | `PRD.md` C10 / S1 | Provider-agnostic adapter; model selection across Gemini tiers |
| Auth.js v5 is a beta | All phases | Pinned to exact `5.0.0-beta.32`; never track the `beta` tag |
| Rotating `ENCRYPTION_KEY` destroys all stored credentials | Any time | Never rotate it |
| Neon autosuspends independently of Cloud Run | Demo beat 1 | 9–32 ms warm, ~700 ms after ~6 min idle. `min-instances=1` does nothing for Neon — warm the database separately right before the demo |
| A long run could outlive the request | Phases 6–9, when nodes call LLMs and APIs | Engine deadline is 120 s against Cloud Run's 3600 s. Raise deliberately if an agent node needs it |

---

## Manual Actions Pending

**None.** M1–M7 are all done and verified with live calls.

---

## Cloud Resource Inventory

**Check this before creating anything.** Real values, verified by live calls.

| Resource | Provider | Identifier | Status |
|---|---|---|---|
| `AgentForge` git repository | GitHub | `arunishrajput/AgentForge` | **EXISTS** |
| Google Cloud project | Google Cloud | `agentforge-hackathon-2026`, number **`733000675212`** | **EXISTS**, billing active ($300 / 90-day trial) |
| **`agentforge` Cloud Run service** | Google Cloud | `asia-southeast1`, revision `agentforge-00002-zdg` | **LIVE 2026-09-25** |
| **`cloud-run-source-deploy` repo** | Artifact Registry | `asia-southeast1` | **EXISTS** |
| OAuth consent screen | Google Cloud | External, app "AgentForge" | **EXISTS** — status **Testing**, 1 test user |
| OAuth 2.0 client | Google Cloud | "AgentForge Web", `733000675212-…ntm7` | **VERIFIED** — 4 redirect entries |
| Neon Postgres project | Neon | `agentforge`, id `super-mountain-39872886` | **EXISTS** — free plan, PostgreSQL 18.6 |
| Neon branch / database / role | Neon | `production` / `neondb` / `neondb_owner` | **VERIFIED** |
| Neon tables | Neon | `user` `account` `session` `verificationToken` `workflow` `run` `run_step` `credential` | **APPLIED** — `0000_dark_paladin`, `0001_smiling_leper_queen` |
| Enabled APIs | Google Cloud | `run`, `cloudbuild`, `artifactregistry`, `cloudscheduler`, `apikeys`, `generativelanguage` | **ENABLED** |
| Gemini API key | Google Cloud | "AgentForge Gemini", restricted to `generativelanguage.googleapis.com` | **VERIFIED** |
| Discord server / channel / webhook | Discord | "AgentForge" · `#agentforge-demo` | **VERIFIED** |
| `agentforge-cron` Scheduler job | Google Cloud | — | Not created — Phase 8 |

**One Neon database serves both local and production.** Migrations applied locally are already
live. Phase 3's migration is purely additive, so the older revision still runs against it.

### Local `.env` — populated, gitignored, never committed

All 15 contract variables have values; `.env.example` mirrors `CONTRACT.md`.

### Installed stack — unchanged by Phase 3

`next` 16.3.6 · `react` / `react-dom` 19.3.0 · `next-auth` **5.0.0-beta.32** ·
`@auth/drizzle-adapter` 1.11.3 · `drizzle-orm` 0.45.3 · `drizzle-kit` 0.31.11 ·
`@neondatabase/serverless` 1.1.0 · `zod` 4.6.5 · **`@xyflow/react` 12.12.0** ·
`tailwindcss` 4.3.3 · `typescript` 7.0.2

**Phase 4 added exactly one dependency: `@xyflow/react` 12.12.0** (MIT, peer `react >= 17`), pinned
exactly, as `ARCHITECTURE.md` planned. `ai` (Phase 6) is still deliberately not installed.
Tests run on Node's built-in runner.

### Local toolchain

`git` 2.54.0 · `gh` 2.98.0 · `node` v26.8.2 · `npm` 11.19.1 · `docker` 29.7.2 ·
`gcloud` 580.0.0 (authenticated, project + region set)

---

## How to verify the system, from a cold session

```bash
npm run typecheck && npm test           # 41 tests, no database, ~130 ms
npm run build                           # Turbopack; one expected process.exit warning

# 46 checks end to end over HTTP. Mints a real session row, drives the API, cleans up.
node --env-file=.env scripts/verify-api.mjs https://agentforge-733000675212.asia-southeast1.run.app

# To look at the canvas without driving Google OAuth by hand: mint a session row,
# set it as a cookie in the browser, then revoke it. Same mechanism, no app bypass.
node --env-file=.env scripts/mint-session.mjs
node --env-file=.env scripts/mint-session.mjs --revoke <token>
```

Cookie name is `authjs.session-token` over http, `__Secure-authjs.session-token` over https.

`npm test` runs the TypeScript sources directly on Node's built-in runner via a 30-line resolve
hook in `scripts/test-register.mjs`. **Consequence:** Node's strip-only mode rejects TypeScript
that needs real transformation — no constructor parameter properties, no enums, no namespaces, no
decorators anywhere in `src`. It cost one fix this phase.

---

## Notes for Phase 5

- **The canvas already has the shape Phase 5 needs.** `runStates` in
  `src/components/canvas/editor.tsx` is a `Map<nodeId, NodeRunState>` derived from a finished run's
  steps. Streaming means feeding that same map as events arrive instead of once at the end
- **Status travels by context, not through node `data`** (D22). Keep it that way: a status change
  must not rebuild every node object many times a second
- **`POST /api/workflows/:id/runs` stays the way a run starts.** It is synchronous and returns the
  finished run. The SSE stream is for *watching*, and `CONTRACT.md` → *SSE event messages* is still
  `NOT YET DECIDED` — Phase 5 fills it
- A client that connects mid-run or reconnects must recover correct state. The run and its steps
  are already readable at `GET /api/runs/:id`, which is the obvious resync
- `run_step.logs` is already `{ at, level, message }[]` and the inspector already renders it

## Open, but blocking nothing

**Project licence.** Every adopted dependency is permissive. MIT is the obvious default. **Left to
the user deliberately** — it governs whether others may commercialise the work.

---

## Recent Changes

**2026-09-26 — Phase 4 complete, the canvas is live**

- Canvas, palette, config panel, workflow list and run view — deployed as revision
  `agentforge-00004-2xw` and verified both by 46 HTTP checks and by driving the deployed canvas in
  a browser
- **Added `@xyflow/react` 12.12.0**, the one dependency this phase needed, pinned exactly
- **Put the canvas↔graph mapping in one pure, tested module** (`src/lib/canvas/bridge.ts`), so the
  round trip is asserted on Node with no DOM. `CONTRACT.md` now records its rules
- **Generated every config form from the node's JSON Schema** (`src/lib/canvas/schema.ts`), tested
  against the real registry — a node added in Phase 8 or 9 gets a working form with no UI work
- **Found that the registry must be server-rendered, not fetched** (D23): fetching it made every
  node briefly draw the wrong handles and broke the branch edge
- **Found that `z.toJSONSchema` output will not cross the RSC boundary** (D24) — `describeNode`
  now forces it through JSON
- **Found that dirty-state detection must be structural** (D25): the Phase 3 note that `jsonb`
  reorders keys turned out to matter here, not just in the verification script
- Confirmed `z.unknown()` is *required* inside a zod 4 object, so a fresh Branch node is saveable
  but not runnable until `left` is set — which is the behaviour the UI now shows
- Added `scripts/mint-session.mjs` so a browser can reach the app without driving OAuth by hand
- Sign-in now lands on `/workflows`; `/dashboard` redirects there

---

## Last Updated

**2026-09-26** — Phase 4 complete. Revision `agentforge-00004-2xw` live, 46 deployed checks passed
plus a browser build/save/reload/run on the deployed canvas. No manual actions pending.
