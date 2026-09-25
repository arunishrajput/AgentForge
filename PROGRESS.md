# PROGRESS.md — AgentForge execution state

**The status board.** A fresh session reads this and immediately knows where things stand. Keep it
concise and operational — prune stale detail rather than appending forever. This is not a diary.

---

## Project Status

**Phase 3 is complete. AgentForge executes workflows in production.**

**https://agentforge-733000675212.asia-southeast1.run.app**

Workflows persist, the node registry exists, and the engine runs sequential, branch and loop
workflows with per-node step records — verified by 33 live checks against the deployed URL, not
only locally. No manual actions pending.

## Current Phase

**Phase 4 — visual canvas: build, edit, save, load workflows** (not started) — `READY TO START`

## Completed Phases

| Phase | Status |
|---|---|
| **Phase 0** — setup, prerequisites, foundation decision | **COMPLETE** |
| **Phase 1** — application skeleton with Google auth | **COMPLETE** |
| **Phase 2** — first deploy, auth in production | **COMPLETE** — verified in a browser |
| **Phase 3** — data model, node registry, execution engine | **COMPLETE** — verified on the deployed URL, 2026-09-25 |

---

## Deployed State

| Field | Value |
|---|---|
| **Canonical URL** | **`https://agentforge-733000675212.asia-southeast1.run.app`** |
| Legacy URL | `https://agentforge-i5d2u66boa-as.a.run.app` — works, do not publish it |
| Service | `agentforge` on Cloud Run, `asia-southeast1` |
| Revision | **`agentforge-00002-zdg`** — ready, 100% of traffic. Previous good revision: `agentforge-00001-h4k` |
| Scaling | `min-instances 1`, `max-instances 3`, 1 vCPU / 1 GiB, 3600 s timeout, port 8080 |
| Env vars set | `NODE_ENV` `AUTH_URL` `APP_BASE_URL` `DATABASE_URL` `AUTH_SECRET` `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` `ENCRYPTION_KEY` `CRON_SECRET` — 9, unchanged by Phase 3 |
| Database | Neon `super-mountain-39872886` — **8 tables**, migrations `0000` + `0001` applied |
| Warm latency | health 170–400 ms India → Singapore; database 32 ms warm |
| Last verified | **2026-09-25** — `node --env-file=.env scripts/verify-api.mjs <url>`, all 33 checks passed |

**A redeploy preserves env vars.** Phase 3 deployed with `gcloud run deploy agentforge --source .
--region asia-southeast1` and no `--env-vars-file`; all 9 variables carried to the new revision.
The file is only needed when a variable changes.

---

## Phase 3 — what was verified, not just written

`npm test` — 19 engine/template tests, no database.
`scripts/verify-api.mjs` — 33 checks over HTTP, run against **localhost first, then the deployed
URL**. It mints a real database session row for an existing user, drives the API exactly as a
browser would, and deletes the row afterwards — no test-only bypass exists in the app.

| Check | Result |
|---|---|
| Deploy from source | ✓ revision `agentforge-00002-zdg`, 100% traffic, clean startup logs |
| `GET /api/health` on the new revision | ✓ `200`, database reachable |
| Auth still works | ✓ `GET /` 200, `GET /dashboard` unauthenticated 307 |
| Unauthenticated API access | ✓ 401 on both read and run-trigger |
| Owner scoping | ✓ a second user gets **404**, not 403, on read and on run |
| Graph round-trip | ✓ deeply equal including every node position |
| Sequential run | ✓ output threads node to node; templates resolve |
| Branch run | ✓ both sides exercised; untaken side recorded `skipped` |
| Bounded loop | ✓ body ran exactly 3 times, exited via `done`, `{{input.index}}` correct per pass |
| Loop cap | ✓ `maxIterations` above the hard cap rejected at validation; runaway cycle stopped by the per-node cap |
| Failure path | ✓ run `failed`, message on the step, downstream `skipped` |
| Config snapshot | ✓ each step stores the **resolved** config it ran with |
| Invalid graph | ✓ saves with `runnable: false`; running it returns 422 and executes nothing |
| Interrupted run | ✓ a `running` row with a stale heartbeat is reaped to `failed` |
| Delete cascade | ✓ deleting a workflow removes its runs |
| Database left clean | ✓ 0 workflows, 0 runs, 0 stray users after verification |

---

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

---

## Known Issues

| Issue | Impact | Action |
|---|---|---|
| **Rollback is still untested** | Demo-day risk | Phase 3 created a second revision so it is now *possible*. The attempt was blocked by the session's production-deploy guard. **Run it manually once before demo day:** `gcloud run services update-traffic agentforge --region asia-southeast1 --to-revisions agentforge-00001-h4k=100`, verify, then shift back to the newest revision |
| **Google OAuth changes take ~90 s to propagate** | Cost 90 s in Phase 2 | Wait and retry before suspecting a typo |
| **A curl check cannot detect `redirect_uri_mismatch`** | Nearly caused a false "verified" | Only a real browser sign-in proves the OAuth redirect |
| **`min-instances 1` bills continuously** | Cost, after the hackathon | **Set to 0 once judging ends** |
| **OAuth consent screen is in `Testing`** | Demo day | Only listed test users can sign in. Before the demo: publish the app, or add each judge as a test user (cap 100) |
| **4 moderate `npm audit` findings, one root cause** | None in production | esbuild dev-server issue reachable only through `drizzle-kit`. Dev dependency, absent from the runtime image. **Accepted** |
| **Discord rejects requests with no `User-Agent`** | Phase 9 Discord node | Send an explicit UA |
| **`gemini-2.0-flash` is retired** | Phases 6, 7 | List models, never assume a name |
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
`@neondatabase/serverless` 1.1.0 · `zod` 4.6.5 · `tailwindcss` 4.3.3 · `typescript` 7.0.2

**Phase 3 added no dependencies.** Tests run on Node's built-in runner.
`@xyflow/react` (Phase 4) and `ai` (Phase 6) are still deliberately not installed.

### Local toolchain

`git` 2.54.0 · `gh` 2.98.0 · `node` v26.8.2 · `npm` 11.19.1 · `docker` 29.7.2 ·
`gcloud` 580.0.0 (authenticated, project + region set)

---

## How to verify the system, from a cold session

```bash
npm run typecheck && npm test           # 19 tests, no database, ~100 ms
npm run build                           # Turbopack; one expected process.exit warning

# End-to-end over HTTP. Mints a real session row, drives the API, cleans up.
node --env-file=.env scripts/verify-api.mjs https://agentforge-733000675212.asia-southeast1.run.app
```

`npm test` runs the TypeScript sources directly on Node's built-in runner via a 30-line resolve
hook in `scripts/test-register.mjs`. **Consequence:** Node's strip-only mode rejects TypeScript
that needs real transformation — no constructor parameter properties, no enums, no namespaces, no
decorators anywhere in `src`. It cost one fix this phase.

---

## Notes for Phase 4

- **The palette comes from `GET /api/nodes`.** It already serves each node's label, category,
  outputs and its config schema as JSON Schema. Do not hand-write a node list in the UI
- **`sourceHandle` is the contract between the canvas and the engine.** React Flow's handle ids
  must be exactly the `outputs[].key` values — `"true"`/`"false"`, `"loop"`/`"done"`, or `null`
- **Positions are contract.** The round-trip test covers them; keep it that way
- **Save the whole graph with `PATCH /api/workflows/:id`.** It is one atomic row update
- A workflow saves even when invalid. `runnable` and `problems` come back on every read — surface
  them in the UI rather than blocking the save
- **Compare graphs structurally, never as strings.** Postgres `jsonb` reorders object keys

## Open, but blocking nothing

**Project licence.** Every adopted dependency is permissive. MIT is the obvious default. **Left to
the user deliberately** — it governs whether others may commercialise the work.

---

## Recent Changes

**2026-09-25 — Phase 3 complete, the engine runs in production**

- Schema, registry, engine, workflow CRUD, run trigger and run history — deployed as revision
  `agentforge-00002-zdg` and verified live with 33 checks
- **Decided the graph is one `jsonb` column** (D14), which is what let `neon-http` stand (D6)
- **Built the engine as a work list** (D15) and gave it three independent bounds (D16) — the
  containment that Phase 7's generated workflows will need
- **Kept `{{ }}` a lookup, not an expression language** (D17), with a test asserting it
- **Made the engine's persistence injectable** (D18) so the critical-path tests need no database
- Registry seeded with six real nodes; `agentCallable` defaults to false (D19)
- **Found that Postgres `jsonb` normalises key order** — a graph round-trip is deeply equal but not
  byte-identical. Caught by the verification script, recorded in `CONTRACT.md` and `ARCHITECTURE.md`
- **Found that Node's strip-only TypeScript mode rejects constructor parameter properties** — two
  classes rewritten; the constraint is recorded above
- Confirmed a plain `gcloud run deploy` inherits the existing env vars; `--env-vars-file` is only
  needed when a variable changes

---

## Next Phase

**Phase 4 — visual canvas.** Definition in `BUILD_PLAN.md`. Read `CONTRACT.md` → *Workflow / node /
edge JSON* and *Node definition interface* before touching the graph shape.

## Next Recommended Action

**Start Phase 4 in a fresh session** — `/clear`, then "Start the next phase".

Separately, and not blocking: **test the rollback command manually once** (see *Known Issues*).

---

## Last Updated

**2026-09-25** — Phase 3 complete. Revision `agentforge-00002-zdg` live, 33 deployed checks passed.
No manual actions pending.
