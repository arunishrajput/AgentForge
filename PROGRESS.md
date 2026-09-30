# PROGRESS.md — AgentForge execution state

**The status board.** A fresh session reads this and immediately knows where things stand. Keep it
concise and operational — prune stale detail rather than appending forever. This is not a diary.

---

## Project Status

**CHAPTER 1 IS CLOSED. CHAPTER 2 IS THE WORK NOW.**

Phases 0–12 built and shipped a hackathon MVP. It was submitted on 2026-09-26
(<https://devpost.com/software/agentforge-kz832x>), the pitch video is published
(<https://www.youtube.com/watch?v=Suc4RV9LnLs>), and that chapter is done and not reopened.

**Chapter 2 turns the MVP into a real, professional, open-source product.** Thirteen phases,
13 → 25, defined in `BUILD_PLAN.md`. **Phases 13–22 are done** (19 was split into 19A and 19B, both
complete). **Phase 23 is next.**

**The live system still works and must keep working:**
**https://agentforge-733000675212.asia-southeast1.run.app** — revision `agentforge-00047-w65`.

### Four binding decisions, made 2026-09-26

| Decision | Value |
|---|---|
| **Budget** | **Still strictly zero.** Free tiers only. Escalate, never provision paid |
| **Visual direction** | **Toybox — bright, playful, light-first.** Saturated colour, thick dark outlines, chunky offset shadows, springy motion. The opposite of a dark IDE |
| **Restored scope** | Teams/roles/sharing, versioning and diffing, observability, credential vault with rotation — **all back in** |
| **Purpose** | **Open-source showpiece.** Optimise for the stranger who lands on the repo |

### The tension to hold, stated plainly

Zero budget plus teams plus observability plus a vault **pull against each other**. Neon's free tier
is 100 CU-hours/month with autosuspend that cannot be disabled, and Chapter 1 already had to set the
cron tick to `*/15` to stay inside it. Multi-user queries and analytics both spend from that same
budget. **Phase 13 measured the real headroom; Phase 18 re-measured storage; Phase 19A sharpened
what the meter actually counts — compute time awake, not statements**, which is why workspaces were
nearly free and why Phase 22's analytics was the phase that had to be designed against the number.
**Phase 22 settled the observability half and it also cost nothing**: logging is `console.log` of a
JSON line (Cloud Run parses it, 6.34 MB against 50 GiB), the four log-based metrics are free, and
the analytics page runs three statements **on demand** with no rollup job and no polling —
**measured at 21–27 ms of database time per page view**. The tension is now resolved in every area
it was stated for.
**Phase 21 settled the vault half of it and it cost nothing**: Secret Manager's free tier covers a
versioned root key, the app spends single-digit access operations a day against 10,000 a month, and
the audit log is one insert per credential read on a database a run has already woken. **Cloud KMS
was the textbook answer and was refused for being ~$0.06 a key a month** (D106) — that is what the
ceiling costing something looks like, and `SECURITY.md` states the protection given up.
`BUILD_PLAN.md` → *The zero-cost problem* holds the per-area resolution.

---

## Current Phase

## ▶ NEXT: PHASE 23 — Node catalogue and templates

**Phase 22 is COMPLETE (2026-09-30).** Full definition of Phase 23 in `BUILD_PLAN.md`. Read
`ARCHITECTURE.md` → *The node registry is the spine* and `CONTRACT.md` → *Node definition interface*
before touching the registry — **it now carries four obligations, not one**.

**What Phase 22 leaves you:**

- **The registry's fourth obligation.** A node type already needs an entry in `PUBLISHABLE`
  (Phase 20) and, for credential kinds, in `ROTATION_RULES` (Phase 21). Phase 22 adds a softer one
  with teeth: **a node whose output carries `model` is counted as a model call** by the analytics
  query, which reads the JSONB rather than a list of AI node types — so a Phase 23 node that calls a
  model gets counted without anybody remembering to register it, and one that puts an unrelated
  `model` field on its output will be miscounted. Name that field something else
- **`src/lib/logging/` is the only place anything writes to stdout.** Sixteen ad-hoc `console.*`
  calls are gone. A new node does not need to log — `context.log` already streams to the canvas and
  persists to the step row, and the engine emits `node.finished` with the type and duration for
  every node automatically. **Do not add a `console.log` to a node**
- **`src/lib/logging/events.ts` is a catalogue and a test guards it.** A log-based metric is a
  filter string in a GCP resource; renaming an event leaves its metric reporting zero forever, which
  looks exactly like a healthy system. Add an event there first
- **`OPERATIONS.md` exists** and is the runbook. If Phase 23 changes what can go wrong
  operationally — a node that can wedge, a template that can be expensive — that file is where it
  belongs, not a comment
- **The analytics page is the first screen that shows the registry back to the user by label.**
  `NodeStat.label` resolves through `getNode()` and is `null` for a type the registry no longer has,
  which is deliberate: a run is a historical record and outlives a rename

**What Phase 23 must not undo:** nothing may start aggregating on a schedule, and nothing may poll.
That is the constraint the whole zero-cost position rests on — see below.

**The phase's finding, and it is the reason the phase existed.** Within minutes of
`agentforge_model_fallbacks` existing, it caught the deployed system doing exactly what Chapter 1
did invisibly for days: **`gemini-3-flash-preview`, the configured default, was being answered by
`gemini-3.5-flash-lite` on nearly every call**, having hit its free-tier quota. Every affected run
*succeeded*. Nothing else in the system moved. A fallback is a success from the outside — that is
the entire point of having one — which is why it needed an instrument of its own.

**Two defects came from verification, and both were found before the phase shipped**, which is why
Phase 22 took one deploy rather than three:

1. **A real browser found that the third nav link broke the header.** Adding *Analytics* pushed the
   workspace switcher's trigger past its wrapper and it drew **on top of** the *Workflows* link, 22
   px of overlap. The bounding boxes of the *containers* said there was no overlap — only
   `getBoundingClientRect` on the `<button>` itself showed it. **The cause was a latent bug my nav
   item merely exposed**: a flex child's `min-width` defaults to `auto`, so `Menu`'s trigger refused
   to shrink below its content although the switcher passes it a `max-w` and a truncating label
   intending exactly that. Fixed in the primitive, where it also fixes every future caller
2. **`array_agg` over the Neon HTTP driver returns a Postgres array as its text literal**,
   `{1200,34,5}`, not a JavaScript array — so the node-latency query called `.map` on a string and
   the whole analytics route answered 500. Fixed with `jsonb_agg` *and* a tolerant coercion, with
   tests for every shape. Writing the coercion then surfaced a second bug in it: `Number(null)` is
   `0`, which is finite, so an absent duration became a zero-millisecond step and dragged that node
   type's median toward nothing

**A third defect was found by the deployed suite** and is smaller but worth the note: the error
fingerprinter labelled a thirteen-digit `Date.now()` as `<hex>` rather than `<n>`, because every
decimal digit is also a hex digit. It mis-grouped nothing; it told a reader a number was an id.

**Do not start Phase 24 in the same session as 23.** One phase per session still holds; `/clear`
between.

---


## Completed Phases

| Phase | Status |
|---|---|
| **Phase 0** — setup, prerequisites, foundation decision | **COMPLETE** |
| **Phase 1** — application skeleton with Google auth | **COMPLETE** |
| **Phase 2** — first deploy, auth in production | **COMPLETE** — verified in a browser |
| **Phase 3** — data model, node registry, execution engine | **COMPLETE** — verified on the deployed URL, 2026-09-25 |
| **Phase 4** — visual canvas: build, edit, save, load | **COMPLETE** — verified on the deployed URL in a browser, 2026-09-26 |
| **Phase 5** — live execution streaming | **COMPLETE** — verified on the deployed URL in a browser, 2026-09-26 |
| **Phase 6** — agent layer: LLM node, agent node, provider config | **COMPLETE** — verified on the deployed URL in a browser, 2026-09-26 |
| **Phase 7** — natural language → workflow generation | **COMPLETE** — verified on the deployed URL in a browser, 2026-09-26 |
| **Phase 8** — triggers: webhook + schedule | **COMPLETE** — verified on the deployed URL and by a real Cloud Scheduler invocation, 2026-09-26 |
| **Phase 9** — integrations: HTTP, Discord, Sheets, Gmail | **COMPLETE** — all four proven against the real service from the deployed app. HTTP and Discord in Phase 9; **Sheets and Gmail closed out on 2026-09-26** with a real appended row (`Sheet1!A2:D2`) and a real sent mail (id `1a0dcf7f7df25cc8`) |
| **Phase 10** — design system, motion, responsiveness, accessibility | **COMPLETE** — verified on the deployed URL in a browser at 1440 px and 375 px, 2026-09-26 |
| **Phase 11** — hardening: demo-path reliability, critical-path tests, error surfaces | **COMPLETE** — **10 consecutive clean walks** of the full demo path on the deployed URL, 2026-09-26 |
| **Phase 12** — demo readiness and final ship | **COMPLETE** — rehearsed in a browser, three broken beats found and fixed, rollback tested, docs reconciled, secret scan clean, 2026-09-26 |

### Chapter 2 — phases 13–25

| Phase | Status |
|---|---|
| **13** — reset, verification, professional foundations | **COMPLETE** — verified on the deployed URL, CI green on PR #1 and on `main`, 2026-09-26 |
| **14** — Toybox design system | **COMPLETE** — deployed and verified in a real browser, 2026-09-26 |
| **15** — UI rebuild I: the shell | **COMPLETE** — deployed and verified in a real browser at 1920 / 1440 / 1024 / 375 px, 2026-09-26 |
| **16** — UI rebuild II: the canvas | **COMPLETE** — deployed and verified in a real browser at 1920 / 1440 / 375 px, 2026-09-27 |
| **17** — durable execution | **COMPLETE** — verified on the deployed URL by `verify-durable.mjs` (7 checks, all passing) and in a real browser, 2026-09-27 |
| **18** — workflow versioning and diffing | **COMPLETE** — verified on the deployed URL (185 API checks, 32 of them Phase 18's own) and in a real browser, 2026-09-27 |
| **19A** — workspaces: the data model and scoping | **COMPLETE** — both migrations applied to the deployed database with **no data loss** (row counts identical before and after), 26 workspace checks green over HTTP against the deployed URL, rollback rehearsed forward and backward on a copy, 2026-09-27 |
| **19B** — membership: invitations and the switcher | **COMPLETE** — two real accounts, one shared workspace, driven in a browser; 83 workspace checks green over HTTP against the deployed URL, 2026-09-27 |
| **20** — roles, permissions and sharing | **COMPLETE** — 56 matrix cells green over HTTP against the deployed URL, the share link's redaction proved against a real bearer token in a real header, and both a viewer's canvas and the public page driven in a real browser at 1440 and 375 px, 2026-09-30 |
| **21** — credential vault and rotation | **COMPLETE** — envelope encryption under a Secret Manager root key, all three rotations proved on the deployed URL by `verify-vault.mjs` (61 checks), and the vault driven in a real browser at 1440 and 375 px, 2026-09-30 |
| **22** — observability and run analytics | **COMPLETE** — `verify-observability.mjs` ALL CHECKS PASSED against the deployed URL, including every analytics figure recomputed independently from SQL and an induced failure traced end to end **through Cloud Logging with the database never opened**; four log-based metrics created and all four confirmed collecting real points; the model-fallback metric caught a live degradation within minutes of existing; driven in a real browser at 1440 / 1024 / 375 px with zero console errors, 2026-09-30 |
| **23** — node catalogue and templates | **NOT STARTED ← next** |
| **24** — documentation and open-source readiness | NOT STARTED |
| **25** — launch polish | NOT STARTED |


---

## Deployed State

| Field | Value |
|---|---|
| **Canonical URL** | **`https://agentforge-733000675212.asia-southeast1.run.app`** |
| Legacy URL | `https://agentforge-i5d2u66boa-as.a.run.app` — works, do not publish it |
| Service | `agentforge` on Cloud Run, `asia-southeast1` |
| Revision | **`agentforge-00047-w65`** — ready, **`latestRevision: True`**, 100% of traffic (Phase 22). **Phase 22 took ONE deploy**, the first since Phase 18: both of its defects were found *before* it shipped, by a browser walk at 1440 px and by the suite running locally. Previous good revisions: `agentforge-00046-w7b`, `agentforge-00045-jj4`, `agentforge-00044-zmx` (all Phase 21), `agentforge-00043-nn2` (Phase 20, second), `agentforge-00042-5zx` (Phase 20, first), `agentforge-00041-75x` (Phase 19B). Earlier: `agentforge-00037-k7x` (19A), `agentforge-00035-vfd` (18), `agentforge-00034-54v` (17), `agentforge-00030-gv2` (16). **`00032` and `00033` were deliberately deleted** during Phase 17's verification, testing whether deleting a serving revision kills its in-flight request — it does not. Rollback was tested against `agentforge-00020-rcr` |
| Scaling | `min-instances 1`, `max-instances 3`, 1 vCPU / 1 GiB, 3600 s timeout, port 8080 |
| Env vars set | `NODE_ENV` `AUTH_URL` `APP_BASE_URL` `DATABASE_URL` `AUTH_SECRET` `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` `ENCRYPTION_KEY` `CRON_SECRET` `TASKS_QUEUE` `TASKS_LOCATION` **`ROOT_KEY_SECRET`** — **12 now. Phase 21 added the last one**, naming the Secret Manager secret that holds the root key. Unset it and the service silently falls back to `ENCRYPTION_KEY` as the root key, which is the Chapter 1 problem back without the Chapter 1 warning — hence `rootKey.provider` on `/api/health`. **`GCP_ACCESS_TOKEN` and `GCP_PROJECT` are script-only and must never be set here**: they exist so `scripts/rekey.mjs` can reach Secret Manager from a machine with no metadata server, and an access token in a service env var is a long-lived credential in a place that survives restarts. Phase 20 added none (a share link is built from `APP_BASE_URL`); Phase 19B added none (an invitation link likewise, and there is no mail provider); **Phase 17 added `TASKS_QUEUE` and `TASKS_LOCATION`** — `TASKS_PROJECT` is deliberately unset, because the project comes from the metadata server, which cannot be wrong the way a copied variable can. All were added with `--update-env-vars`, which **merges**, rather than `--env-vars-file`, which replaces the whole set. No Gemini key on the service: the product path is the user's own key |
| Database | Neon `super-mountain-39872886` — **13 tables**, migrations `0000`–`0009` applied, ~10 MB of 0.5 GB. **Phase 22 added no migration, no table, no column and no index** — the analytics are computed from the `run` and `run_step` rows the engine already writes, and every query opens on `run_workspace_idx`, present since Phase 19A. That was a design constraint, not luck: a rollup table would have needed a job to fill it, and a job on a clock is the one thing Neon's free plan actually charges for. Earlier migrations are unchanged — see `DEPLOYMENT.md` for `0009` (the vault, and the only rollback in this project that can destroy data), `0008` (sharing), `0007` (invitations), `0005`/`0006` (workspaces, deliberately in two halves), `0004` (versioning) |
| Routes | `/` `/dashboard`→`/workflows` `/workflows` `/workflows/[id]` **`/analytics`** `/settings` `/design` `/invite/[token]` `/s/[token]` + **37** API routes. **Phase 22 added one API route and one page.** The route is `GET /api/analytics` (`viewer`); the page is `/analytics`, the fourth item in the shell nav — and adding it is what exposed the `Menu` trigger's `min-width: auto` overflow, which had been latent since Phase 14. **`/api/health` was rewritten, additively**: `checks[]`, `migrations` and `registry` are new, and every field `verify-api.mjs`, `verify-durable.mjs`, `verify-vault.mjs` and `DEPLOYMENT.md` assert on kept its name and meaning. **Phase 22 added no unauthenticated surface**: still exactly four. Phase 21 added four API routes and the Vault settings tab; Phase 20 added two routes, one method and `/s/[token]`; Phase 19B added nine routes and the accept page; Phase 18 added four under `/api/workflows/[id]/versions`; Phase 14 added `/design`, public and prerendered |
| Latency | **Warm**: health ~190 ms India → Singapore, database 7–11 ms. A 6-node demo-path run **4.2–7.5 s** end to end across five consecutive walks (Phase 13; it was 3.1–4.8 s in Chapter 1 when the model answered first time, and **94.5 s** when it did not — that second case is what Phase 13 removed). Generation 2.7–3.5 s. **Cold (Neon suspended)**: health **1.14 s, of which 739 ms is the database wake** — re-measured 2026-09-26 at 917 ms for a first query, 103 ms on the next. Cloud Run itself is never cold at `min-instances 1` | **Analytics, Phase 22: 21–27 ms of database time per page view** on 46 runs and ~200 steps, three statements, measured on the deployed service. The page is server-rendered and does not poll |
| Last verified | **2026-09-30, after Phase 22.** On **`agentforge-00047-w65`**: `verify-observability.mjs` **ALL CHECKS PASSED** (1 skipped) — every analytics total, percentile, day bucket, node row and model row **recomputed independently from SQL** and compared; a probe workflow created, failed twice on purpose, and those failures found **in Cloud Logging without the database being opened**, with the right severity, an indexed `event` label, a duration, an error group and one trace per run; two identical failures proved to be ONE group in both the API and the logs; a hostile `?range=` proved to fall back rather than widen the window, with the `run` table still intact after. `verify-api.mjs` **ALL CHECKS PASSED (3 skipped)**; a second back-to-back run reported 4 failures that were **Gemini free-tier quota (20 req/min), not regression** — the provider says so in its own words. `verify-vault.mjs` ALL CHECKS PASSED. `verify-durable.mjs` ALL CHECKS PASSED, including a real Cloud Tasks scheduled run on this revision. `verify-schema.mjs` 6/6. **Four log-based metrics created and all four confirmed collecting real points** via the Monitoring API. **A real browser** at 1440, 1024 and 375 px, deployed and local: the page read, the range links driven, nothing overflowing at 375, **zero console errors**. Local `npm run check` **769 passing** (was 739), coverage **86.79 / 91.04 / 77.72** against thresholds 85 / 88 / 76 |
| Rollback | **TESTED 2026-09-26, finally.** Traffic shifted to `agentforge-00020-rcr` in **~15 s**, health confirmed the older revision was serving, the demo path walked clean on it, then `--to-latest` restored `agentforge-00021-v4s` in ~15 s. The oldest open item in this file is closed |
| Billing | Trial credit account `Billing - AgentForge` is **open and enabled**. Actual spend is **not queryable from the CLI** (no billing export configured) — **eyeball it in the console once before judging** |
| Provider key stored | **Yes**, and the model was **rotated in Phase 13** from `gemini-3.5-flash-lite` to **`gemini-3-flash-preview`** — the only model healthy on both the text and tool-calling paths in all three probe passes. Confirmed persisted in Neon. Re-probe with `npm run probe:models` |
| Registry | **15 nodes**, unchanged by Phases 10–21. **Phase 20 gave the registry a second obligation**: every node type must have an entry in `PUBLISHABLE` in `lib/workflow/share.ts` saying what a public share link may show of it, asserted by a test in both directions. **Phase 21 gave it a third obligation**: every credential *kind* must have an entry in `ROTATION_RULES` in `lib/credentials/rotation.ts` saying what rotating it means, asserted by a test in both directions — so a kind added in Phase 23 cannot become silently unrotatable. **The registry claim has now held nine times** — and the landing page now *renders* that number from the registry rather than stating it |
| Fonts | **Geist + Geist Mono, self-hosted by `next/font`**, `latin` subset, variable axis. Two woff2 files in the image; no request leaves the browser for a font and there is no layout shift |

**A redeploy preserves env vars.** Confirmed again on Phase 6's three deploys: `gcloud run deploy
agentforge --source . --region asia-southeast1` with no `--env-vars-file` carried all 9 variables
to each new revision. The file is only needed when a variable changes.

---

## Phase 12 — the lesson worth keeping

**The method was the finding, and it still is.** Every phase up to 12 verified over HTTP: a script
minted a session, drove the API and asserted the JSON. Phase 12 drove a **real browser** against the
deployed URL and found three broken beats — one of them a product bug that **178 API checks and ten
clean smoke walks had all passed over**: a webhook-triggered run was invisible on an idle canvas
(D59). `smoke.mjs` opens its own SSE stream, so it proves the *server* streams; it can never prove
the *page* is still listening.

**Drive a real browser before believing a UI claim.** Phases 6, 8, 10 and 12 each found something
that way. Phase 13 found its own equivalent for the model layer: the suites all passed while a model
answered prose in 1.4 s and hung on tool calls — see *Known Issues*.

The full Phase 12 detail is in git history at `a970709`.

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
| **D21** | **The canvas is one React Flow node type; the registry type lives in `data.nodeType`** | Registering six React Flow types would make an *unknown* type fall back to React Flow's default node — the one case that must be visible as a problem. One type renders unknown nodes explicitly |
| **D22** | **A canvas node's `data` holds persisted fields only** | Run status and the registry travel by context instead, so `fromFlow` is a clean inverse of `toFlow` and no UI state can leak into a saved graph. It also means a status change does not rebuild every node object — which is what Phase 5 will do many times a second |
| **D23** | **The registry is passed from the server component, not fetched by the canvas** | A node's output handles come from its registry entry. Fetching it client-side makes every node briefly render with the wrong handles and breaks edges that leave a named handle. `describeNodes()` is the same projection `GET /api/nodes` serves |
| **D24** | **`describeNode` output must be plain JSON** | It crosses to a client component. React refuses to serialise anything else, and the failure is a console error at render time rather than a type error. See `CONTRACT.md` |
| **D25** | **Dirty state is a structural graph comparison, never a string one** | Postgres `jsonb` reorders object keys, so a freshly loaded workflow would otherwise always read as having unsaved changes |
| **D26** | **Adding a node is a click, not a drag** | It satisfies "the palette comes from the registry" with no drop-target failure mode, works on any input device, and the demo's editing beat opens a node rather than dragging one (`DEMO.md`, Beat 4) |
| **D27** | **The run stream reads the database, not an in-process emitter** | The request *running* a workflow and the request *watching* it are different, and for a webhook-triggered run (`DEMO.md` Beat 6) they are different clients. Under `max-instances 3` they can be different containers, where an emitter delivers nothing and reports no error. Polling `run` + `run_step` costs two statements per 300 ms while a stream is open and is correct regardless |
| **D28** | **The stream endpoint is workflow-scoped, with an optional `?runId=` pin** | Refines `BUILD_PLAN.md` Phase 5 task 3 deliberately. A browser cannot know the run id of a webhook-triggered run; it can only ask what a workflow is doing. `POST /runs` is also synchronous, so a client that waited for the response to learn a run id would have nothing left to watch |
| **D29** | **Which run to follow is decided by id, never by clock** | A run already finished the first time a stream looks becomes a baseline and is never reported; any other id is. The first attempt compared `startedAt` to the stream's open time with a 5 s window — that is two different clocks (container and Postgres) and it adopted the wrong run the first time it met Cloud Run. Recovery is likewise by full `snapshot` on every connection, not by replaying events, so mid-run connect, reconnect and reload are one code path with no `Last-Event-ID` |
| **D30** | **A log line is persisted when it is written, not when its node ends** | `RunRecorder.stepLogged`. `context.log` stays synchronous, so all of a run's writes are serialised on one chain in `dbRecorder` — otherwise a late log write lands after the finished step and silently drops a line. Without this an agent node's reasoning only appears once it has stopped reasoning |
| **D31** | **A stream is never idle for long** | Cloud Run bills CPU for the whole time one is open. It closes on a terminal run, after 20 s with nothing to watch, and at a 150 s ceiling — above the engine's 120 s deadline, so a watcher can never cut a legitimate run short |
| **D32** | **The provider adapter is `fetch`, not the `ai` SDK** | `ai` 7 and `@ai-sdk/google` were in `ARCHITECTURE.md`'s adopted stack and are **not installed** (that table now says so). Four measured reasons: the history must be byte-exact for Gemini's `thoughtSignature`; the tool schema needs a sanitiser we own anyway; retry + a model fallback chain is a demo-reliability property, not middleware; and every tool call must become a step our own recorder streams. Cost: one file of wire-format knowledge. Benefit: zero new dependencies and tests that inject a fake `fetch` with no module mocking |
| **D33** | **A model turn is carried back to the provider verbatim** | Gemini 3 signs every `functionCall` part with a `thoughtSignature` and answers **400** to a history that has lost one. So `ChatTurn` carries the provider's own content in an opaque `raw`, and the provider replays it rather than rebuilding the turn from `text` + `toolCalls`. A tidy normalising adapter passes its first tool call and fails on the second — which is every agent node that does more than one thing |
| **D34** | **A model choice is proved with a real call; a key with `models.list`** | `models.list` on a working key returns `gemini-2.5-flash`, which then answers **404 "no longer available to new users"**. The catalogue is not the set of callable models, so validating a choice against it stored one that could not run — and did, until a real one-token call replaced the list lookup. Validation uses `fallbacks: []`, or a working model would answer for a broken choice |
| **D35** | **The Gemini tool schema is an allow-list, not a deny-list** | `parameters` is a narrow OpenAPI 3.0 subset where an unknown key is a hard 400, and `z.toJSONSchema()` emits `$schema`, `additionalProperties` and `propertyNames` for nodes already in the registry. Dropping undocumented keys means a future node with an exotic config degrades to a vaguer tool signature instead of breaking the agent for every node |
| **D36** | **`core.branch` and `core.assert` are closed to the agent; `core.log` and `core.set` are open** | Phase 6's deliberate exercise of D19. A branch called as a tool returns a boolean the model could compute itself, since there is no edge to take; an assert's effect is to fail the run, which is a guard an author places, not a capability to hand a model. Phase 9 opts each integration node in individually |
| **D37** | **An agent node routes through its output, not through its own handles** | `output.decision` is constrained to a configured `choices` list and a `core.branch` reads `{{input.decision}}`. Per-instance output handles would break D21/D23 — the canvas draws a node's edges from its registry entry, so handles must not depend on having run. An unreadable decision is `null` and takes the default path rather than failing the run |
| **D38** | **A node declares the shape of its output; the generator reads it** | Optional `outputShape` on the node definition. A model told only what a node *does* wrote `{{steps.x.output}}` where it meant `{{steps.x.output.text}}`, and the branch compared `"[object Object]"` and took the wrong path — valid graph, successful run, wrong behaviour, nothing reporting it. On the definition rather than in the prompt so a Phase 9 node documents itself, exactly as `description` already does for the agent. Optional, so a pass-through node says nothing |
| **D39** | **What the model could not build is reported, never swallowed** | `unsupported` on the generated output. The registry is the entire vocabulary, so an impossible request cannot produce a dangerous workflow — but it did produce a valid, inert one with no explanation. It is equally the honest answer to a request that is merely early: Discord has no node until Phase 9. **Deliberately not a hard failure** — judging a request unsatisfiable and refusing it would break a valid request on stage, which is strictly worse than building what is possible and naming the rest |
| **D40** | **The model emits nodes and edges; the system supplies `version`, positions and edge ids** | A model cannot lay out a graph, and an overlapping one reads as broken on stage, so `layout()` derives positions from the edges. Edge ids must be unique and nothing but the graph reads them, so minting `e1…eN` beats asking and de-duplicating. `GRAPH_VERSION` is ours to set. Layout is bounded relaxation, not a topological sort, because a generated graph is not reliably acyclic and an illegal cycle must survive layout for `validateGraph` to report it |
| **D41** | **The webhook token lives on the workflow row, not in the graph** | Validation already permits one trigger per workflow, so a per-node token buys nothing. A secret inside the graph would be minted by the *model* that writes it (D40 says the system supplies what a model cannot) or by the browser. And a column is one indexed lookup for the receiver with nothing to keep in sync. 24 bytes of CSPRNG as base64url — 192 bits — minted for every workflow at creation so the URL does not depend on when the node was added. `webhookUrl` is returned only when the stored graph actually holds a webhook trigger, so the UI never prints a URL that would 404 |
| **D42** | **The cron tick claims a due schedule by compare-and-set, before running it** | `neon-http` has no transactions (D6), so a conditional `UPDATE … WHERE scheduleNextAt = <observed>` is the atomic primitive available — and it is enough: a second tick updates zero rows and fires nothing. That is what makes a Scheduler retry, an overlapping manual run, or two containers under `max-instances 3` safe. Claiming **before** the run means a run that kills the container loses its slot instead of re-firing for ever. The paired rule: on save, an unchanged expression **keeps** its stored due time, because recomputing can move a fired slot back into the future's past and fire it twice |
| **D43** | **Cron is evaluated in UTC, by ~200 lines of arithmetic rather than a dependency** | A cron expression carries no timezone. Reading the server's zone makes a schedule mean different things on a laptop and on Cloud Run; a per-workflow zone means implementing DST, where "02:30 daily" legitimately happens zero times or twice a year. UTC is stated in the node's own description, so the model writing an expression and the user reading one are told rather than left to assume. Unsupported syntax (names, `?`, `L`, `W`, `#`, seconds, a year field) is **rejected at config-validation time** — the alternative is this node's worst failure, a schedule that saves cleanly, displays, and never fires |
| **D44** | **`integration.gmail` is closed to the agent; HTTP, Discord and Sheets are open** | D19 exercised the way D36 exercised it. The other three act inside something the user owns — Discord's destination is not even in the config, it is the stored credential. A sent email leaves the account, reaches a third party and cannot be recalled, and an agent-callable Gmail means a model chooses **both** recipient and body from text that arrived on an unauthenticated webhook. `DEMO.md` needs nothing from it (Beat 8 is Discord and Sheets), and Phase 9's own notes rank Gmail first to cut. **A deliberate deviation from `BUILD_PLAN.md`'s wording, recorded not hidden**; flipping the boolean is one line |
| **D45** | **`integration.http` is bounded by a guard, not by trust** | `BUILD_PLAN.md` says it is not an agent escape hatch; `src/lib/integrations/guard.ts` is what makes that true, because `agentCallable: true` means a model picks the URL. Public addresses only — **every** resolved address, not any, or a split-DNS name passes and `fetch` picks the other one — including the IPv4-mapped and NAT64 forms, since `::ffff:a9fe:a9fe` is the metadata server too. **https only** is the rule that matters: rule 1 checks DNS and `fetch` resolves again, so rebinding defeats it, whereas the metadata server has no certificate. Redirects reported, never followed, because following one re-resolves a host already cleared |
| **D46** | **Google's extra scopes are asked for in their own flow, and the stored secret is the refresh token** | Sign-in asks for identity only: putting "Send email on your behalf" in front of every visitor before they have built anything is what `BUILD_PLAN.md` calls actively harmful. Auth.js does not re-persist account tokens on a later sign-in, so a second flow is also the only reliable way to get a refresh token. `access_type=offline` **with** `prompt=consent` is what returns one — Google omits it for an already-granted user otherwise, leaving a connection that works for exactly one hour. A connection with no refresh token is **refused** rather than stored. Access tokens are fetched per execution and not cached: ~200 ms against a 120 s budget, versus a cache that would need invalidating on disconnect |
| **D47** | **`state` on the integration callback is a CSRF control, not decoration** | The callback is a `GET` a third party can cause a signed-in browser to make. Without it an attacker delivers *their* authorization code and the victim's account stores a refresh token for the attacker's Google account — after which every appended row and every sent mail goes to the attacker. 24 bytes of CSPRNG in an `HttpOnly`, path-scoped, 10-minute cookie, compared in constant time. `SameSite=Lax` is required rather than chosen: the callback is a cross-site top-level navigation and `Strict` withholds the cookie |
| **D60** | **A timed-out model attempt is never retried on the same model** | The whole of Phase 12's 91.9 s step. A model that accepted the request and went quiet has already said what it will do; asking it again at the same 45 s budget just buys the same silence twice. Retry-in-place is now reserved for failures that come back **fast** — a 503 usually returns in under a second and a retry there often succeeds. A timeout moves straight down the chain, and a 12 s per-attempt cap sits inside a 30 s ceiling on the whole call, so the worst case is bounded by construction rather than by luck |
| **D61** | **The circuit breaker reorders the fallback chain; it never removes a model from it** | Health is keyed on the model name alone and is shared by every user on an instance, so a wrong reading is not hypothetical. Reordering makes the worst case a *suboptimal order*; removing would make it a *refusal to call a model that would have worked*. Only retryable failures count, plus 404 — which opens the breaker immediately, because "no longer available to new users" is permanent and three names in the Chapter 1 chain went that way mid-project. **400/401/403 never count**: a rejected key is a fact about the caller, and marking every model unhealthy because one key is bad is exactly backwards. State is per process — no storage, nothing against Neon's CU-hours, and a cold instance learns within one request |
| **D62** | **A model is only trusted after it answers on BOTH the text and the tool-calling path** | The finding that explains the incident, and it was not visible in any log: `gemini-3.5-flash-lite` answered `ai.llm` in 1.4 s and hung `ai.agent` for 91.9 s **in the same run**. The two paths fail independently, and health flips on a timescale of minutes, so `scripts/probe-models.mjs` probes both, sequentially (the free tier rate-limits hard enough that parallel probes measure the limiter, not the models), and `FALLBACK_MODELS` is set from its ranking. A model that answers prose is not thereby an agent model |
| **D63** | **A throttled model probe is `conflict`, not `invalid_request`** | Choosing a model runs one real call before the choice is stored, and that call cannot fall back — it must prove *that* model. A 429 therefore reaches the user, and reporting it as "this key cannot use gemini-3-flash-preview" sends them to change a setting that was correct. The free-tier allowance on the current default is **20 requests a minute**, so this is routine, not exotic. 400/404 stay `invalid_request`: those really are verdicts on the choice |
| **D64** | **oxlint, not ESLint** | Next 16 removed `next lint` and its own upgrade guide says to use a linter directly, so this was a real choice rather than a default. Measured: `eslint` + `eslint-config-next` resolves to **305 packages**; `oxlint` is **2**, and lints 139 files in 73 ms. The same reasoning that left this project without the `ai` SDK (D32), without a cron dependency (D43) and without a test framework. Recorded as A15 in `ARCHITECTURE.md`. The cost is honest: no type-aware rules, and a smaller rule set than the full ESLint ecosystem — worth it here, and revisitable |
| **D65** | **Light-only, cream. Supersedes D48's dark-only** | The Chapter 2 visual direction is binding, and a theme toggle was not built: two themes is two contrast matrices, two sets of tokens to keep in step and two sets of screenshots, for a product whose whole point is to look unlike the dark IDEs it competes with. `color-scheme: light` is required rather than cosmetic — without it the `<select>` in every registry-generated config form renders as a dark OS widget in a cream panel, the exact mirror of the problem D48 solved. A dark theme is a later phase's decision, not an omission |
| **D66** | **Every chromatic token exists twice — a dark `text` register and a bright `-pop` fill** | The phase's own implementation note said saturated-accent-on-cream is where AA fails, and it is: a grape vivid enough to be a good button fill measures **2.6:1** on cream, and a grape dark enough to read measures 5.2:1 and makes a muddy button. One token cannot do both jobs, so no token is asked to. **The plain name is the safe one** because the safe thing should be the short thing — which is also why the ~90 Chapter 1 call sites (`text-bad`, `text-warn`, `text-accent`…) needed **zero edits**: they were already naming the register that stayed readable. The label on any fill is ink, never white. Six invariants in `tokens.test.ts` make it a property rather than a convention, and each was mutation-tested — brightening `--color-bad` to its pop value fails 4 of them |
| **D67** | **The ink outline carries object separation, not lightness** | The four surfaces are within a few percent of each other, and some `-pop` fills sit as little as **1.3:1** off the cream page. In a dark UI elevation *is* lightness; here it is the outline and the hard shadow. The consequence is a hard rule — **a pop fill is never drawn without its ink outline** — because taking the outline off does not make an object subtle, it makes it invisible. Asserted from both sides: the test checks that some fill really is flat against cream, *and* that the outline clears 3:1 on every fill and on the page. The same reasoning made the focus ring **ink rather than the accent**: ink is ≥6.2:1 against everything in the system, the accent fill is 2.6:1 on cream and would fail WCAG 2.2 SC 1.4.11 |
| **D68** | **`src/components/ui/` exists, reversing Chapter 1's "no component library" (A16)** | The old rule — "a button is a class, not a component" — holds exactly as long as controls carry no behaviour, and it stopped holding here. A dialog that traps focus, a tablist with a roving tabindex, a menu that answers arrow keys and a toast region that must exist *before* its first message do not fit in a CSS class, and hand-rolling them per call site is how they ship broken. **The utilities did not go away**: `btn btn-primary` is still first-class and the Chapter 1 call sites were not migrated, because a primitive and its utility are the same language — `<Button>` renders `btn btn-primary`. Still **zero new dependencies**: no Radix, no headless kit, no `tailwind-merge`, because native `<dialog>`, `<select>` and `<input type=checkbox>` carry most of it |
| **D69** | **The workflow list searches, filters and sorts in the browser, over the whole list** | The server already sends every card, because a user's own workflows are a short owner-scoped list. A round trip per keystroke would make the search feel *worse* and would spend Neon CU-hours the project does not have to spare — the same budget that forces the cron tick to `*/15`. The honest limit is stated rather than hidden: when one account holds enough workflows for this to hurt, the fix is **pagination on the server**, not a debounce in the component. The matching itself is a pure module (`lib/workflow/list.ts`) with 19 tests, so the part that can be wrong is the part that is tested |
| **D70** | **The landing page reads the node registry as it renders** | A hand-written feature list is a promise that rots — Chapter 1 shipped four integration nodes in Phase 9, and a static list would have said three for a fortnight. The catalogue, the node count and "callable by an agent" all come from `describeNodes()`, the same projection the canvas palette and the agent's tool set are built from. It is a server component, so the registry never reaches the browser bundle. **Do not type a number into that page** |
| **D71** | **A notice and a toast are the same statement, and share one table** | `ui/tone.ts` holds the fill, the glyph and — the part that matters — the **word** for each of the four tones, so the same failure never announces itself two different ways to a screen reader. The split is by *subject*, not by severity: a toast reports the result of something the user just did anywhere on the page, a notice describes the state of one region and stays until that state changes. This replaced five hand-written copies of a translucent tint plus a hairline ring, which is a dark-UI idiom that reads as a smudge on cream |
| **D72** | **The command palette is mounted by the shell header, and its ranking is a tested pure module** | Mounting it in the header rather than the root layout keeps it off the public landing page and the gallery, where there is no session to search and nothing to find. The ARIA shape is a combobox owning a listbox — focus stays in the input and `aria-activedescendant` moves a virtual cursor — because moving real focus onto the options would stop the user typing to narrow the list, which is the whole interaction. The ranking lives in `lib/ui/command.ts` with 14 tests: the dialog either opens or it does not, but "why is the thing I typed not first?" is fifteen lines of arithmetic that deserve tests |
| **D73** | **The canvas layout is solved by collapsible rails, not by smaller node cards** | `BUILD_PLAN.md` Phase 16 states the constraint in measured terms — two 280px panels leave an 880px canvas at 1440px, forcing 0.39 zoom and an 88px card — and warns that chunkier cards make it *worse*. Shrinking the cards would have traded the phase's own goal away to pay for it. A panel collapses to a **40px rail** instead: 880 → **1360px**, 0.524 → **0.810** zoom, **182px** card, measured on the deployed revision. The rail is the load-bearing half of the idea — a panel that collapses to *nothing* is a panel the user cannot find again, so it stays a real button that names itself and reports `aria-expanded`. Per-panel and persisted, because the two are not one choice |
| **D74** | **A panel's two breakpoint behaviours are decided by CSS, never by a measured viewport** | Below `lg` a panel is a drawer driven by `open`; at `lg` and up it is a column driven by `collapsed`. Neither reads a width in JavaScript, so there is nothing to mismatch between the server render and the browser, and the closed drawer stays out of the tab order via `visibility` rather than `display` so it can still slide. The preference itself reaches React through `useSyncExternalStore`: reading `localStorage` in a `useState` initialiser is a hydration mismatch, and reading it in an effect is the cascading render `react/set-state-in-effect` rejects. Guarded on every access with an in-memory fallback, so a blocked store leaves a working button rather than a dead one |
| **D75** | **Node status is a tested table carrying five channels, only one of which is hue** | `BUILD_PLAN.md` Phase 16 asks for five states "visually distinct at a glance and without relying on colour alone", which is exactly the requirement that decays silently as five hand-written class strings drift together. `lib/canvas/status.ts` carries word, shape, outline, surface and motion, and `status.test.ts` asserts the distinctness rather than the specific glyphs — a later phase may change a character, not make two states look alike. A running **agent** says "Thinking" where every other node says "Running", because the phase asks for status as character and the distinction costs one word. Run status is a **separate** five-entry table: a run can be `queued` or `cancelled`, and mapping `cancelled` onto the step vocabulary would have rendered it "Skipped", which is a different statement about what happened |
| **D76** | **The fuzzy tier of the shared ranking applies to a title alone** | The node palette reuses the command palette's ranking (`lib/ui/command.ts`) rather than growing a second search, because two search boxes in one product that disagree is worse than either being imperfect. Offering each node's *description* as a subtitle then exposed a real flaw: a subsequence match means something against a short name and nothing against a sentence, and searching `gmail` matched **7 of 15** nodes — "Schedule trigger", "Loop", "LLM" — because every one of those descriptions contains g…m…a…i…l in order. Substring and word-start matching on a subtitle stay; only the fuzzy tier is withdrawn from it. `gmail` now returns **1**. The fix is in the shared module, so the ⌘K palette gets it too |
| **D77** | **Durable execution is Cloud Tasks, and `mode` is per run rather than global** | `sync` is kept, not replaced: `POST /runs` answering with the finished run is what the canvas's Run button, `DEMO.md` and every verification script read, and a request that returns before the run is over cannot have that shape. So durability is a second mode beside it — manual runs default to `sync`, the canvas offers "Queue a run", and **scheduled runs are always durable**, which is the case with nobody watching and nobody to press Run again. A4 in `ARCHITECTURE.md` is superseded, not deleted: its rationale ("a queue would add a service, a dependency, a failure mode") was right, and Cloud Tasks costs **none of the three** — the worker is a route in this container, the adapter is one `fetch`, and the free tier is 1,000,000 ops/month against ~3 per run |
| **D78** | **The lease, not the queue, is what makes durability safe** | Cloud Tasks delivers **at least once**: a delivery whose HTTP request fails is retried, and "fails" includes a container that finished the work and died before answering. Without an interlock the observable result of this phase would be a workflow that posts two Discord messages — worse than the problem it was added to solve. So every delivery must **claim** the run by compare-and-set against `leaseExpiresAt`, which is the same atomic primitive the cron tick's schedule claim already used (D42) and the only one `neon-http` offers. **`LEASE_MS` (180 s) is above `DEFAULT_DEADLINE_MS` (120 s) deliberately** — that ordering is what closes the window, because a worker still inside its own budget cannot have a lapsed lease. Raising one without the other reopens it |
| **D79** | **The cursor stores the frontier, never the outputs** | Node outputs are already persisted one per `run_step` row, so putting them in the cursor would write an HTTP node's whole response body into the run row **once per step** on a metered database. A queue entry names the `seq` whose output feeds it and `rehydrate` reads them back. The cursor's size therefore depends on the graph's shape and never on the data — which is also why a Cloud Tasks task carries a run **id** and not a payload, since it bills per 32 KB chunk |
| **D80** | **`heartbeat()` became `checkpoint(cursor)`: one statement writes progress, extends the lease and reports back** | Three separate writes per step — heartbeat, cursor, cancellation poll — would roughly triple the per-step database cost of every run in the product, against ~39 spare CU-hours a month. One `UPDATE ... RETURNING` does all three and the answer is free. It can stop the engine two ways, and **`leaseHeld: false` wins over `cancelRequested`**: an engine with no lease has no standing to finish the run as anything, so it writes no status and no cursor and lets the new owner carry on |
| **D81** | **Retry and timeout are a `policy` sibling of `config`, not fields inside it** | They are properties of *running* a node, not of what the node does. Inside `config` they would mean adding two fields to fifteen schemas, teaching the generator about them fifteen times, and handing the agent two more parameters to get wrong on every tool call. **Optional, and absent stays absent** — a schema default would make every pre-Phase-17 workflow structurally different from its stored form and show as unsaved the instant it loaded. Every bound is enforced by the schema rather than by a comment, because a **model** writes these graphs too (`maxIterations: 1`, D57, is the standing example) |
| **D82** | **The dispatch route is guarded by `CRON_SECRET` *plus* a per-run token, and not by OIDC** | Cloud Tasks can sign a delivery with an OIDC token, but this service must stay `--allow-unauthenticated` to serve the app, so Cloud Run would not check it and the app would have to verify the JWT against Google's rotating JWKS — a meaningful amount of security-critical code sitting **outside** the thing that is already narrow. The run's `dispatchToken` is 192 bits of CSPRNG scoped to **one run**, so the most a holder can do is cause a run its owner already started to be resumed; it cannot start an arbitrary workflow. The lease then makes even that harmless. If the worker is ever split onto a private endpoint, OIDC becomes the right answer |
| **D83** | **The version number lives on `workflow.version` and is bumped by the save's own UPDATE** | `neon-http` has no transactions (D6), so reading `max(number)` from `workflow_version` and inserting a moment later is a real race — two saves of the same workflow can both read 4, and the unique index then turns the second into an error the user sees. Bumping a counter **inside the single-row UPDATE that writes the graph** is atomic for free and `RETURNING` hands back a number nothing else can have. D42's primitive, reused. The cost is that a failed snapshot leaves a **gap** in the sequence, which is the honest outcome: the workflow row is already correct, and refusing somebody's save because its *history* could not be written is the wrong trade |
| **D84** | **Not every save is a version, and the test is structural** | The canvas PATCHes the whole graph on Save **and again before every run**, so versioning every PATCH would mean five identical snapshots for five runs of an unchanged workflow, on a metered database. A save that changes neither the graph nor the name writes nothing. It cannot be a string comparison — `jsonb` normalises key order (D25) — so `graphsEqual` **moved out of `lib/canvas/bridge.ts` into `lib/workflow/graph.ts`**, where the canvas's dirty check and the debounce call the same function. Two copies would drift, and the failure would be silent both ways: a canvas that never looks saved, or a history that quietly drops an edit. **A description change is deliberately not a version** — it is not restored either, so versioning it would offer a restore that did not restore it |
| **D89** | **The scoping token is a type, not a string** | Phase 19A changed the meaning of the first argument of about thirty store functions from "the user" to "the workspace". With both as `string`, every call site missed in that sweep would have compiled, run, and read one tenant's rows under another tenant's name — the worst possible failure mode, silent and cross-tenant. `WorkspaceScope` is an object carrying `workspaceId`, `userId` and `role`, so a missed call site is a **typecheck failure**; all 43 were found that way. It also gives Phase 20 one place to put an authorisation check that is already in the hand of every mutating function. **Do not weaken it back to a string** |
| **D90** | **`workspaceId` is added alongside `ownerId`, never replacing it** | The obvious migration is to rename the column, and it is wrong twice over. Semantically the two answer different questions — *who may see this* and *who made this happen* — and a run row exists precisely to record what happened, so losing who triggered it would cost the history its point. Operationally, an additive column is a **reversible** migration: the hand-written rollback drops what Phase 19A added and every workflow, run, version and credential is still attributed exactly as before, which is what let the rollback be rehearsed and believed. The cost is four columns that look redundant until you ask either question |
| **D91** | **A tightening migration is expand/contract, with a deploy between the halves** | A `NOT NULL` column with no default makes every insert from the *previous* revision fail for the length of a deploy, and Cloud Run serves both revisions during one. So `0005` adds the columns nullable and backfills, the new revision goes out, and only then does `0006` tighten them. The schema file declares the final state throughout; the database is deliberately looser in between, which is what expand/contract *is*. Paired with a hand-written rollback and `scripts/rehearse-migration.mjs`, which proves both directions on a copy of the real rows before either half is applied |
| **D85** | **Restoring moves history forward; it never rewinds** | Restoring v3 writes v3's graph as v8. Deleting 4–7 or resetting the counter is the obvious implementation and it would silently corrupt the run history — a run that recorded v5 would point at a number that no longer means what it meant. That history is the entire reason versioning was added, so the append-only rule outranks the tidier-looking one. The restored save is **labelled**, which is also what exempts it from the retention cap |
| **D86** | **A run records `workflowVersion` as an integer, not a foreign key — and a resumed run executes that snapshot** | Denormalised for the reason `ownerId` already is: a run survives as a record of what happened and must stay true when the version row is gone. The sharper half is the resume. Durability means a run survives a redeploy, which means it can also survive an **edit**: delivery 1 runs three nodes of v4, v5 lands removing one, delivery 2 resumes from a cursor naming a node that no longer exists — half of one workflow and half of another, reported as neither. Reading the snapshot back closes it. Null falls back to the live graph, which is exactly the pre-Phase-18 behaviour, so nothing in flight broke when this landed |
| **D87** | **A removed node in a diff keeps its position only where that position is free** | Delete the last node of a chain and add a new one, and `addNode` places the new one in the slot that just came free — so the union graph held two nodes at identical coordinates, React Flow stacked them, and the **added** node rendered invisible underneath the removed one. Every API check passed. A ghost now drops until it is clear and the live graph never moves: a ghost moving is honest, since it has no position in the newer workflow, while moving a surviving node would be a lie about where the workflow actually is. **Found in a browser** — the Phase 12 lesson, for the fourth time |
| **D88** | **Diff mode withholds `onNodesChange`, and therefore must supply `initialWidth`** | Withholding the handlers is the whole safety story: React Flow reports edits through `onNodesChange`, so a draggable diff would feed nodes from a union graph nobody ever saved back into the editing state, and the next Save would write a workflow assembled out of two others. The consequence is not obvious — React Flow also writes **measurements** back through that same handler, so a diff node never gains `measured` and the **minimap renders empty** for the whole time a diff is on screen. `initialWidth`/`initialHeight` satisfies the dimension read without forcing the DOM size the way `width` would |

---

| **D48** | **One theme, dark. There is no light mode** | `BUILD_PLAN.md` Phase 10 lists "dark mode" as part of the design system; the product had already been dark since Phase 1 and its canvas, node cards and status colours are all designed against a dark ground. A second theme doubles every colour decision and every visual check for a demo that is given once, on one screen. What "dark mode" actually cost us was `color-scheme: dark` on `:root` — without it the `<select>` in every generated config form and the checkbox in `core.http`'s `failOnError` rendered as light OS widgets in a dark panel |
| **D49** | **A component names a token; it never names a colour** | Every `text-red-300`, `bg-white/10` and `text-[11px]` in the product was swept onto `text-bad`, `border-line` and `text-2xs` — 113 font sizes and ~60 colours, at identical values, so the sweep was provably invisible. The point is not tidiness: `CATEGORY_STYLE` and `STATUS_STYLE` are read by the canvas, the palette and the inspector, and a status colour that exists in three spellings drifts the first time one of them is edited |
| **D50** | **The run leaves its path lit on the canvas** | Edges are projected, not stored: `displayEdges` derives `animated` and a class from `runStates`, and `edges` itself stays exactly what `fromFlow` will save. An edge into a node that is *running* pulses; an edge the run actually crossed stays accent-coloured. On a branch the untaken edge never lights, so when the run ends the graph is showing the path the agent chose. This is `DEMO.md` Beat 7 made visible on the canvas rather than only in the log |
| **D51** | **No `loading.tsx` on a page whose first act is an auth redirect** | It converts the redirect from a 307 into a 200 carrying a `NEXT_REDIRECT` in the stream, because the shell flushes before the page body runs. Nothing leaks and a browser still redirects, but the status code at an auth boundary is not a thing to trade for a navigation skeleton. If a later phase wants the skeleton back, the guard has to move into a segment `layout.tsx`, which costs a second session lookup per request |
| **D52** | **Contrast is computed from the tokens, not eyeballed** | `src/app/tokens.test.ts` parses `globals.css`, converts `oklch()` to linear sRGB and asserts WCAG ratios. Every other Phase 10 criterion is checked by looking; this one cannot be, because a token drifting 0.05 in lightness is invisible and still fails AA. It is also what rejected the tinted status chip |

| **D53** | **A redirect's origin comes from `APP_BASE_URL`, never from `request.url`** | Inside the Cloud Run container `request.url` is built from the **bind address** — `HOSTNAME=0.0.0.0`, `PORT=8080` (the Dockerfile) — not from the public host. Both Google OAuth routes resolved their redirects against it, so a *successful* connection sent the browser to `http://0.0.0.0:8080/settings` (ERR_CONNECTION_REFUSED), and `protocol === "https:"` evaluated false, silently dropping `Secure` from the CSRF state cookie that is the whole of D47's defence. `appReturn()` in `src/lib/integrations/google.ts` is now the single source for both, and it is the same value `callbackUrl()` builds the `redirect_uri` from — so the flow starts, returns and sets its cookie on one origin by construction. **Neither symptom was reachable before M8**, because the flow died at Google's consent screen |

| **D54** | **Retrying an outbound call is opt-in per call site, and never on a status that could mean "already done"** | The integrations had no retry at all (the provider adapter has had one since Phase 6), so one Discord 429 or one Google 503 ended `DEMO.md` Beat 8. But a blanket retry is worse than none: a POST that *creates* may have taken effect before the answer was lost, and two copies of Beat 8's message on a shared screen is not a recoverable demo. So the caller declares what it knows. `on` defaults to **429, 502, 503, 504** — statuses that mean the server did not act. **500 is deliberately absent**: ambiguous for a create. `onTransportError` is only for a genuinely idempotent call — the OAuth token refresh and the webhook-verify GET — because a dead connection is evidence of nothing. A **spent timeout and a cancelled run are never retried**: one means the deadline is already gone, the other means the run is over. Eight of the thirteen new tests assert the negative half |
| **D55** | **A `Retry-After` longer than 5 s is honoured by *not* retrying** | Discord can ask for 30 s. Sleeping that long inside a node is worse on stage than a failed step naming the rate limit, and the engine's 120 s deadline is not a budget to spend asleep. The caller still gets the real 429 to report, so nothing is hidden |
| **D56** | **The smoke script and the verification suite are two different tools and stay separate** | `verify-api.mjs` is 178 checks over the whole API surface in ~2 minutes — the regression test for a code change. `smoke.mjs` is the eight beats of `DEMO.md` in order in ~10 seconds, and it reports *which beat* broke. Merging them would give the pre-demo check a two-minute runtime and the regression suite a demo-shaped bias. `DEMO.md`'s pre-demo checklist runs the smoke script; a phase ending runs both |
| **D57** | **The generator is never allowed to starve an agent of model calls** | A tool-calling agent needs at least two model calls — one to make the call, one to read the result — and the generator wrote `maxIterations: 1` in **5 of 12** generations of the pinned demo prompt. Valid against the schema (1–8), valid as a graph, and fatal at runtime, so nothing reported it. Fixed in two places on purpose: the prompt now says not to set the field **and gives the reason**, and `assembleGraph` **drops** a generated agent budget below 3 so the registry default applies. The prompt rule is the real fix; the guard is what makes it a property rather than a tendency, which is the same division D40 draws. Deliberately narrow: it only ever touches a **generated** `ai.agent` node, and only by removing the key. A user who types 1 into the config form still gets 1 — D16's bounds are untouched. Re-measured on the deployed revision: **0 of 12** |
| **D58** | **Beat 5 resolves the webhook at fire time and fits the payload to the graph** | `createWorkflow` mints a fresh token per workflow at creation (D41) and Beat 3 generates the demonstrated workflow **live**, so a `$WEBHOOK_URL` exported before the demo cannot be the right one. Copying it live puts a bearer secret on a shared screen; firing a stale one is worse still — **201, a real run on the wrong workflow, and a canvas that never moves**, because the stream is workflow-scoped (D28). `scripts/demo-fire.mjs` asks the API which workflow is newest and never prints the URL. It also fits the payload: the trigger's `requiredFields` are the model's choice and in **8 of 20** measured walks it wanted a field the fixed JSON did not send. Fields are only ever **added**, never overwritten, and the graph's own `{{trigger.x}}` references are read too — a field that passes validation but is referenced and missing produces a successful run with an empty cell, which is Beat 8's payoff quietly becoming a blank |
| **D59** | **The canvas watches while it is visible, not only while a run it started is going** | It watched only if the page loaded mid-run or the user pressed Run, so a **webhook- or schedule-triggered run was invisible** — the run executed, finished, and the graph never moved. That is `DEMO.md` Beat 6, whose claim is literally "nothing is being refreshed", broken in exactly the case Beat 5 sets up. Now every stream close re-arms, because none of the server's three reasons (`finished · idle · timeout`) means the *canvas* is finished — only that the connection is. Gated on `document.visibilityState`, so a hidden tab costs nothing and re-attaches when it returns, and an explicit `stop()` still wins. **The cost is bounded by human attention rather than uptime**: 2 statements / 300 ms while someone is looking, which is 0.25 CU on Neon ≈ 400 hours of continuously-watched canvas inside the free month. The Known Issue about pinning Neon awake is about a *background* poller at 720 h/month; a visible tab is not that |
| **D92** | **The demo account's state is produced by a script, not by hand** *(was numbered D60, which Phase 13 had already used — renumbered in Phase 19A)* | Phase 11's sharpest lesson was a demo spreadsheet set up by hand whose id was recorded nowhere and, because the `spreadsheets` scope cannot search Drive, could not be recovered. `scripts/seed-demo.mjs` is the answer: it connects nothing it cannot verify, generates the backup workflow **and actually runs it end to end**, clears the sheet to its header row, and sweeps strays. Idempotent, so it is the pre-demo checklist's step rather than a one-off. It also states plainly what it **cannot** do — a Discord webhook post can only be deleted by its own message id, which the app has no reason to keep — so that gap is a printed instruction rather than a surprise |
| **D93** | **The role check is one function with a least-privilege default** | Phase 19B had to enforce `workspace_member.role` or merge into Phase 20, because an invitation that hands somebody `viewer` next to full write access is worse than no role at all. The check is `requireScope(minimumRole)` — the funnel every authenticated route already went through — and **its default is `viewer`**, which is the part that matters: a mutating route added later that forgets the argument gets read access, not write access. It **fails closed by omission**, which is the only property that survives people forgetting things. `assertRole` lives in `lib/workspace/roles.ts` rather than `lib/api.ts` so it can be unit-tested; `lib/api.ts` imports `@/auth`, which the test runner cannot load (D18's shape again) |
| **D94** | **403 and 404 answer different questions, and neither may absorb the other** | D20 answers **404** for another workspace's resource, because 403 would confirm the id exists. Phase 19B adds the opposite case: a resource in *your own* workspace that your role cannot change answers **403**, naming the role required. Collapsing them either way costs something real — a blanket 404 makes a permission boundary look like a bug and sends people hunting for a missing record; a blanket 403 turns every id into an existence oracle. The rule is mechanical: *not a member* → 404, *member without the role* → 403 |
| **D95** | **An invitation token is stored only as a hash; the link exists once** | The deliberate difference from the webhook trigger token (D41), which must stay displayable for ever because the URL *is* the feature. An invitation is shown once, in one link, so the database has no reason to be able to hand a live invitation to whoever reads it. Plain SHA-256, **not** bcrypt or argon2: those exist to make a *low-entropy* secret expensive to guess, and there is nothing to slow down at 256 bits of CSPRNG. The cost is that "send it again" cannot re-show the old link — it re-invites, which rotates the token and invalidates the previous one. That is the honest trade and the UI says so |
| **D96** | **The active workspace is an unsigned cookie, because it grants nothing** | `af_workspace` carries a workspace id and no signature, no user id and no expiry claim. It does not need them: `chooseMembership` honours the id only when it appears in the memberships the database just returned for this user, so a forged cookie, one copied from another browser, and one naming a workspace the user was removed from all fall back to their own. Signing it would protect a value that is already powerless. **The three fallback cases are deployed checks** — weaken any of them and the cookie stops being a preference. No `activeWorkspaceId` column either: a write per switch on a metered database, and it would make the choice global across every tab, which two tabs on two workspaces says is wrong |
| **D97** | **Re-inviting an address is an upsert against a partial unique index, not a read-then-write** | `neon-http` has no transactions (D6), so "is there a live invitation for this address?" followed by an insert is a genuine race that can leave two live links into one workspace. `workspace_invitation_live_idx` is unique on `(workspaceId, email)` among rows neither accepted nor revoked, and `ON CONFLICT ... targetWhere` names that predicate — the same interlock argument as `workspace_personal_idx`. It carries the Phase 19A warning with it: **`ON CONFLICT` against a partial index that does not match fails to *plan*** (42P10), which is how every credential write became a 500 for days, so the DDL was rehearsed on a copy before it went near the real database |
| **D98** | **What a public share link may publish is an allowlist that defaults to nothing** | `GET /api/share/:token` is the fourth unauthenticated route and the only one whose risk is in the *response*. A denylist — strip `headers`, strip `to` — is the obvious shape and it **fails open**: the day Phase 23 adds a node with a `token` field, the denylist does not know about it and the link starts publishing it. `PUBLISHABLE` in `lib/workflow/share.ts` refuses to publish a field nobody has named, so the same mistake produces a share that says too *little*. The line it draws is **shape and settings are published, typed-in values are not**: enums, numbers, booleans and object *key names* cannot carry a secret; a URL, a prompt, an address, a body and a header value all can. A test asserts the table covers the registry in both directions, so adding a node fails the build until somebody decides — and one place to audit beats fifteen files to audit, which is why the table is not a field on `NodeDefinition` |
| **D99** | **`visibility` and `shareToken` are independent columns, not one three-valued ladder** | The tempting shape is `private → workspace → public`. It is wrong because the two answer different questions: one is *which of my colleagues may open this*, a reversible day-to-day setting among people who already share credentials; the other is *may anybody handed a URL read this*, an outward-facing act needing `admin`. A ladder would make "published" read as a kind of privacy setting, and would make the genuinely coherent combination — private, with a live link — inexpressible. That combination is exactly *not ready for my colleagues, ready for the person I am showing it to* |
| **D100** | **An admin can see a private workflow, and that is the decision rather than the hole** | A private workflow still runs with the **workspace's** credentials: it sends mail from the workspace's Gmail connection and posts to its Discord channel. An admin who cannot see it cannot account for what those credentials are doing, and "you may hide what you do with the team's secrets from the person responsible for them" is not a property worth having. `private` means *not yet shared with my colleagues*, never *hidden from the workspace*, and the UI says it in those words. The creator is always included regardless of role, so a demotion does not hide somebody's own work from them |
| **D101** | **Visibility filters rows in the `where`; it is never checked after the read** | The first authorisation in the product that **filters** rather than refuses. `visibleWorkflows(scope)` is a drizzle fragment returning `undefined` for an admin, so `and(…, visibleWorkflows(scope))` composes with no branch at any call site. It goes in the query rather than after it so there is no moment at which `getWorkflow` holds a row the caller may not see — which is what makes every route downstream correct without a second thought. **The two exceptions are the whole of the risk**: `getRun` and the unfiltered `listRuns` are addressed by *run* id and do not pass through `getWorkflow`, so both join `workflow`. Missing them would have let a viewer read the steps, inputs and outputs of a workflow they cannot open |
| **D102** | **A read-only canvas is a separate component, not `Editor` with a flag** | `Editor` is eleven hundred lines that exist to mutate a workflow — it holds a save function, a run function, the API client, the SSE stream and the palette. Pointing it at a public page with `readOnly` would mean the thing between an anonymous visitor and `api.updateWorkflow` was a boolean. `SharedCanvas` cannot save anything because it imports no client, no store and no mutation. It reuses everything about how a node *looks* — `WorkflowNodeView`, `toFlow`, the same edge treatment — so the two cannot drift into two visual languages. **The same argument does not apply inside the app**, where the viewer's canvas *is* `Editor` with a role: there the API refuses every write already, and a second canvas would be a second thing to keep correct for no gain |
| **D103** | **Minting a share link is idempotent; rotating it is two deliberate requests** | The opposite of the choice invitations made (D95), and the difference is what each token is for. An invitation is delivered once and then dead, so re-issuing should rotate — an old link in somebody's chat history is a liability. A share link is a URL somebody pastes into a README or a ticket, so re-minting on every press of a Share button would break those quietly, and the user pressed a button labelled "Share", not "Rotate". Rotation is therefore `DELETE` then `POST`, which reads as what it is. The mint is a conditional UPDATE on `shareToken is null` so two admins pressing at once cannot produce two tokens, one of them live and unreachable (D6 — no transactions) |
| **D104** | **A `<fieldset disabled>` makes a region read-only, not a prop threaded through four components** | The config form builds its controls from a JSON schema at runtime, so a `readOnly` prop would have to pass `ConfigForm` → `Field` → `Control` → six control components, and a control type added later would be missed. A native disabled fieldset disables every form control inside it however deeply nested and whatever type — one element, and the guarantee is the browser's. It needs `min-w-0` (a fieldset's default `min-inline-size: min-content` breaks flex) and it cannot be `display: contents` (which drops the disabling). **Note when testing it: the descendants do not gain a `disabled` attribute**, so `input[disabled]` matches nothing and `:disabled` matches everything — an attribute selector reports the opposite of the truth |
| **D105** | **Envelope encryption: a per-credential data key wrapped by a versioned root key** | Chapter 1's warning — *rotating `ENCRYPTION_KEY` destroys all stored credentials* — was accurate and is a property of any scheme where the key an operator can rotate is the key the data is under. One layer of indirection makes a root key rotation re-wrap ~60 bytes per row instead of re-encrypting the database, and makes it **resumable**: every row names the key that wraps it, so an interrupted re-key leaves a database in which every row still decrypts. That last property is what lets it run against production with no maintenance window, and it could not have been written any other way under D6 (no transactions). A fresh data key per write is the bonus: rotating a secret leaves no key material in common with what it replaced |
| **D106** | **The root key lives in Secret Manager, not Cloud KMS** | KMS is the textbook home for a root key and would keep it inside an HSM. It costs ~$0.06 per key per month plus operations, and the zero-cost ceiling binds. Secret Manager's free tier covers one versioned root key — 6 active versions, 10,000 accesses a month — and hands the bytes to this process, which then holds them for the life of the instance. **That is a real reduction in protection and `SECURITY.md` → *What we do not claim* states it outright** rather than describing the scheme as though it were KMS. Revisit if a budget ever exists |
| **D107** | **If a named root key is unreachable, a write fails rather than falling back to `ENCRYPTION_KEY`** | The tempting behaviour is to degrade gracefully. It is wrong: a fallback would seal new credentials under a key the operator believes is retired, leaving rows behind that a later rotation would skip — and nothing would report it, because everything would keep working. Refusing makes the failure loud and leaves no wrongly-keyed rows. `rootKeyProvider()` is on `/api/health` for the same reason the queue's configuration is |
| **D108** | **The audit log is written from `readSecret` and nowhere else** | It is the single funnel every plaintext credential passes through, so it is the one place that cannot miss a use. Recording at the four call sites would mean four places to keep in step and a fifth added later without one — and **a use this log missed is worse than no log, because a log is trusted**. The cost is a `use` parameter threaded through three integration helpers and `resolveProvider`, and an optional one, because the two routes that resolve a key to fill a picker genuinely have no run and no node |
| **D109** | **An `ApiError` passes through `integrationApiError` unchanged** | The vault's rotation route wrapped its whole body in that mapper and collapsed four deliberate refusals into one 500. Fixed at the mapper rather than the call site because the defect is a class: an `ApiError` already carries a code and a client-safe message chosen on purpose, so re-deciding either is always wrong, in every caller present and future. **Found by the deployed suite** — a route's error mapping is invisible to a unit test, because `lib/api.ts` imports `@/auth`, which the test runner cannot load (D18's shape again) |

## Known Issues

| Issue | Impact | Action |
|---|---|---|
| **A route that wraps its whole body in an error mapper destroys every deliberate refusal underneath it** | Four refusals came back as one 500 | **Phase 21, found by `verify-vault.mjs` and by nothing else.** `POST /api/credentials/:kind/rotate` wrapped `rotateCredential` in `integrationApiError`, so an unknown kind (404), a Google connection explaining a refresh token cannot be typed (400), and a key the provider had rejected (400) all answered *"Something went wrong saving this The provider connection."* **A route's error mapping is invisible to the unit suite**, because `lib/api.ts` imports `@/auth`, which the test runner cannot load. Fixed at the mapper (D109) with a test that fails without it |
| **An arbitrary-value colour can apply its utility and silently drop its opacity modifier** | A quiet log list was separated by full-strength ink rules | **Phase 21, found in a browser with `getComputedStyle`.** `divide-[--color-line]/40`: `divide-y` gave `border-bottom-width: 1px`, and the `/40` never arrived, so the colour was full ink where `line-soft` (alpha 0.16) was meant. The class was in the DOM, the build passed, and no test in this repository could see it. **`divide-line-soft` already existed for exactly this.** Reach for the token the system has rather than an arbitrary value that looks equivalent — `DESIGN.md` → *Traps* |
| **An empty state is a different sentence, not the same sentence with nothing under it** | The vault told a workspace with no secrets how "every secret below" was encrypted | **Phase 21, in a browser, in an editor's empty workspace.** Two defects in one screen: that paragraph, and a "Not connected" list that offered a way to connect for **one kind out of three** because it read `reconnectHref` — a field only a `reconnect` credential has. **Naming something missing without saying where to get it is worse than not listing it.** Every rule now carries a `connectHref` and a test asserts it |
| **A flag that makes one control honest does not make the region around it honest** | A viewer was offered a trigger-input box and a "Queue a run" button, under a paragraph starting *"Press **Run**"* | **Found in Phase 20 in a browser, on the deployed revision, by looking at a screenshot.** `canRun` was correctly false so the durable-run button was disabled — and the panel around it still explained a feature the viewer has no way to use and still offered a payload for a run they cannot start. Two dead controls and an explanation of a third. **When a role removes an action, look at the whole region that action lived in**, not only at its button |
| **A header that fits at 1440 px can leave a title 90 px wide at 375 px** | The public share page truncated a real workflow name to two words and an ellipsis | **Phase 20, measured in a browser.** The title shared a flex row with the wordmark and a status badge; at 375 px there was nothing left for it. It is `max-sm:basis-full` now and takes its own line, measured at 351 px of 375 and not truncating. **On a page a stranger lands on, the name is the first thing they need** — and this is the fourth phase in a row where the only thing that found a layout defect was resizing to 375 and looking |
| **A test that asserts "the secret did not leak" must name the secret, not its label** | Cost one verification round in Phase 20 | The share-redaction check tested for the string `"message"` and failed on **correct** behaviour: the field *name* legitimately appears in the `redacted` array, which is the whole point of that array. What must never appear is the **value**. A leak assertion written against a key name will either fail on correct behaviour or, worse, pass while the value sits in the response under a different key |
| **An authorisation rule that tests the invariant before the actor's authority reports the wrong refusal** | A viewer got a 409 where a 403 belonged, and it leaked a fact | **Found in Phase 19B by the deployed suite, not by a unit test.** `removalRefusal` checked "would this leave the workspace ownerless?" first, so a **viewer** aiming *remove member* at the sole owner was told *"This is the workspace's only owner"* — which describes a refusal as a conflict and tells somebody with no authority how many owners there are. **Authority first, legality second.** Regression test asserts the viewer gets `not_allowed` and an admin gets `owner_only` for the same request |
| **A fallback that reads "the personal workspace" stops being right the moment one can be shared** | An invited account landed in the *inviter's* workspace by default | **Phase 19B.** `chooseMembership` fell back to `find(m => m.workspace.personal)`, correct while nobody could be in anybody else's workspace. `listMemberships` returns oldest first, so after an invitation the inviter's workspace was found first. Not a leak — the membership was real — but the wrong home, and it reads like one in a bug report. Now `personal && createdBy === userId`. **The general shape: a column describing a row's origin is not a statement about whoever is reading it** |
| **`personal` is a fact about a row; `own` is a fact about the reader** | Two screens told a guest that somebody else's workspace was theirs | **Phase 19B, found in a browser.** The switcher labelled the inviter's workspace `PERSONAL` and the workflow list said "2 workflows in your workspace". `describeWorkspace` now carries both, and `viewerUserId` is a **required** argument so no call site can quietly get the old behaviour back |
| **A control hidden below `sm` is a feature removed on a phone, not a styling choice** | A member of two workspaces on a phone could not switch | **Phase 19B.** The switcher inherited `hidden sm:flex` from Phase 19A's badge, where it was right: the badge was static text the pages repeated in their own copy. As the only control that changes workspace it meant a phone user was stuck in whichever one the cookie named. Also worth measuring rather than eyeballing: once shown, its open panel ran **63 px past a 375 px viewport**, which needed a width cap on the panel rather than on its wrapper |
| **`pkill -f "next start"` leaves the worker holding the port** | Cost three verification rounds in Phase 19B | The parent dies, `next-server` keeps port 3000, the new server exits with `EADDRINUSE` into a log nobody reads, and **the suite quietly tests the previous build** — which is how two fixed bugs kept reporting as broken. Same family as Phase 14's stale-server trap. **`lsof -ti:3000 \| xargs -r kill -9`, then grep the log for a clean bind before trusting a single local check** |
| **A migration can be in the .sql and NOT in the database, and nothing in the suite can see it** | Was: every credential *write* 500'd in production, for days | **Found in Phase 19A, by rehearsing a migration on a copy.** `credential_owner_kind_label_idx` is created by migration `0001`; every other index from that migration was present in Neon and **this one was not**. `putCredential` upserts with `ON CONFLICT ("ownerId", "kind", "label")` and Postgres will not *plan* that statement without a matching unique index, so saving an API key, connecting Google and storing a Discord webhook all answered 500. Proved against the deployed URL, repaired inside migration `0005`, and proved fixed when the identical request returned **200 on the unchanged revision**. **`scripts/verify-schema.mjs` now compares drizzle's snapshot, its journal and `information_schema` — run it before and after every migration.** The general lesson is the Phase 12 lesson in a new place: a green suite proves the code and says nothing about the shape of the database it is talking to |
| **`drizzle.__drizzle_migrations` had 3 rows while 5 migrations were applied** | Would have broken the next `db:migrate`, with Phase 19A's own migrations queued behind | **Found in Phase 19A.** `0003` and `0004` were physically in the database and absent from the ledger — applied by hand at some point, with the bookkeeping never updated. The next `drizzle-kit migrate` would have tried to re-apply them and died on `CREATE TABLE ... already exists`. Reconciled by `verify-schema.mjs --repair`, which **refuses to record a migration whose DDL it cannot actually see**, and is reversible by deleting the two rows |
| **An error mapper that speaks for a service it did not hear from sends the diagnosis the wrong way** | Cost real time in Phase 19A | The Discord route turned *any* non-`IntegrationError` into `"Could not reach Discord."` — including a Postgres error, on a request where Discord had already answered successfully. Now `integrationApiError` only speaks for the service when the error came from it, logs the cause, and says plainly that it does not know otherwise. Three tests, one of which fails against the old mapping |
| **Cloud Run DRAINS in-flight requests. A redeploy does not kill a running run — and neither does deleting the serving revision** | Corrects a risk this project carried from Chapter 1 to Phase 17 | **Measured twice in Phase 17, both times the opposite of what was assumed.** A durable run was interrupted by (a) a new revision taking 100% of traffic and (b) **deleting the revision that was serving it**. Both times the run carried on and completed **on the old revision**, `attempt` never left 1 — the second one finished on a revision that no longer existed. So "in-flight runs die on redeploy" was substantially wrong: a run dies on a **crash, an OOM kill, or the request timeout**, not on an ordinary deploy. Phase 17 is still worth it — durability covers the cases that *do* kill a run, and it is what let the cron tick go from 3 schedules per tick to 25 — but **do not repeat the old claim.** The practical consequence: a container cannot be killed on demand from outside, so the resume path is verified by delivering the retry the queue would deliver (`verify-durable` check 3b) |
| **A Cloud Tasks queue reporting `PAUSED` still dispatches** | Any test that tries to hold a task in the queue | **Measured in Phase 17.** `gcloud tasks queues pause` was issued, `describe` was polled until it returned `state: PAUSED`, and a task created immediately afterwards was **still delivered inside a second**. Pausing is not a lever a test can rely on. `verify-durable` check 4 therefore asserts the invariant that holds either way — "cancelling stops it and no further node runs" — and check 4b constructs the unclaimed state directly instead of racing for it |
| **A model's health flips on a timescale of MINUTES, and the text and tool-calling paths fail independently** | Every model choice, every fallback chain | The single most useful thing Phase 13 learned. Three probe passes minutes apart: `gemini-3.6-flash` went healthy → healthy → 503; `gemini-3.5-flash-lite` went healthy → timeout → timeout; `gemini-3.1-flash-lite` timed out on tool-calling twice and then worked. **Only `gemini-3-flash-preview` was healthy on both paths in all three.** Never conclude a model is good from one call, and never conclude a model that answers prose can call tools. `npm run probe:models` checks both paths and is the only honest way to pick a chain |
| **The default model is a `-preview` model** | If Google retires it | Accepted deliberately in Phase 13: it was the only model measurably reliable on the tool-calling path, and the alternative was keeping a default that timed out on 2 of 3 probes. **The mitigations are already in place** — a 404 opens its breaker immediately and the chain falls through to `gemini-3.6-flash`, and `npm run probe:models` re-derives the ranking in about a minute. Re-probe if agent steps start failing |
| ~~Coverage thresholds will bite the UI rewrite~~ | Was: Phases 14–16 | **WRONG, and measured in Phase 14.** Coverage went **UP** — 87.19 → **87.81** lines, 90.46 → **90.56** branches, 78.10 → **79.71** functions — while adding 12 `.tsx` files. Two reasons: **`.tsx` files never appear in the coverage report at all** (Node's coverage counts only modules a test actually loads, and no test loads a React component), and the new `.ts` modules (`cn`, `contrast`, `palette`, `illustrations-static`) are all tested. The thresholds were not touched. **The real gate to watch in Phases 15–16 is the contrast gate, not coverage** |
| ~~Rollback is still untested~~ | Was the oldest open item in this file | **TESTED 2026-09-26 (Phase 12).** `update-traffic --to-revisions agentforge-00020-rcr=100` shifted in **~15 s**; health confirmed the older revision was serving; the demo path walked clean on it; `--to-latest` restored `agentforge-00021-v4s`. The procedure in `DEPLOYMENT.md` is correct as written. **Know it without looking it up on demo day** |
| **Google OAuth changes take ~90 s to propagate** | Cost 90 s in Phase 2 | Wait and retry before suspecting a typo |
| **A curl check cannot detect `redirect_uri_mismatch`** | Nearly caused a false "verified" | Only a real browser sign-in proves the OAuth redirect |
| **`min-instances 1` bills continuously** | Cost, after the hackathon | **Set to 0 once judging ends** — and **pause `agentforge-cron` at the same time**, or the tick keeps Neon awake ~240 h/month for nothing |
| **Neon free plan is 100 CU-hours/month and autosuspend cannot be disabled** | Any background polling | The 5-minute autosuspend is fixed on the free plan. Anything that touches the database more often than ~every 6 minutes pins it awake at 0.25 CU — 720 h/month ≈ 180 CU-hours, which is **over the allowance**. This is why the cron tick is `*/15` and not `* * * * *` (D43 sibling; the arithmetic is in `DEPLOYMENT.md`) |
| **The webhook URL is a bearer secret shown in the UI** | Demo day, screen sharing | Anyone holding it can start a run, and a run can spend model quota. The inspector says so. **There is no rotation yet** — re-minting means recreating the workflow. Do not show the webhook node's inspector on a shared screen; the `curl` in `DEMO.md` uses an exported `$WEBHOOK_URL` for exactly this reason |
| **OAuth consent screen is in `Testing`, and must stay there** | Demo day | Only listed test users can sign in, so **add each judge as a test user** (cap 100). **"Publish the app" is no longer an option**: Phase 9's Sheets and Gmail scopes are *sensitive*, and going to production with them requires Google verification, which takes days. Corrected here — the earlier note offering either is wrong. The judge never connects Google anyway: sign-in asks for identity only, and the presenter's account is connected beforehand |
| ~~Sheets and Gmail cannot run until OAuth pass 3 is done~~ | Was Phase 9's open runtime | **Unblocked 2026-09-26.** M8 done, Google connected as `arunishrajput7@gmail.com` with both scopes granted (`canAppendSheets` and `canSendMail` both true). What remains is the *proof*: one real appended row and one real sent mail through the deployed engine |
| **`integration.http` is agent-reachable, which is SSRF by design** | Any agent node, any webhook-triggered run | **Bounded, not unbounded** — D45. The residual risk is a valid certificate for a hostname resolving into a private range, which this service has nothing private to reach. If that ever changes, pin the resolved address into the connection. The guard's nine refusals are asserted against the deployed container, not just in unit tests |
| **A stored Discord webhook URL can post to that channel for ever** | Any leaked credential | Encrypted at rest and never returned to a client, but there is no rotation: replacing it means pasting a new URL. Same shape as the webhook-trigger issue above |
| **4 moderate `npm audit` findings, one root cause** | None in production | esbuild dev-server issue reachable only through `drizzle-kit`. Dev dependency, absent from the runtime image. **Accepted** |
| ~~Discord rejects requests with no `User-Agent`~~ | Was the Phase 9 trap | **Handled.** `src/lib/integrations/net.ts` sets one on every outbound request, so no node can forget. Also why `api.github.com` answers the HTTP node — it 403s without one, which makes the deployed check prove the header |
| **The `agentforge-hackathon-2026` Gemini key is dead** | Was a Phase 6 blocker | Every model answers **402 "prepayment credits are depleted"**: the project has billing enabled, which moves it off the Gemini free tier. `GOOGLE_GENERATIVE_AI_API_KEY` in local `.env` is this dead key. **Use the `agentforge-gemini-free` key instead** (no billing → free tier). Do not enable billing on that project |
| **`models.list` lists models a key cannot call** | Phases 6, 7 | `gemini-2.5-flash` is in the catalogue and answers 404 "no longer available to new users". Never treat the list as the callable set — make a real call (D34) |
| **`gemini-2.0-flash` and `gemini-2.5-flash*` are retired** | Phases 6, 7 | List models, never assume a name. Current default: `gemini-3.5-flash-lite` |
| ~~The pitch deck is not cut for its rubric~~ **(CLOSED — hackathon over, not this project's work)** | Was: Round 1 judging | Criteria name, in order: *identifies and **validates** the real-world problem*, *understands the **affected users***, *innovative and **feasible** solution*, *potential **real-world impact***. The deck is strongest on solution and implementation — the two things Round 1 weights least. It **asserts** the problem with no evidence, **never names a user segment**, and slide 8 fills its impact section with 178 checks / 297 tests, which is product-quality proof, not impact. Feasibility is the one criterion it nails, because the thing is deployed. **Re-cutting slides 2 and 8 plus their narration targets the named top prize directly**; Devpost allows edits, and the video can be re-rendered in minutes |
| ~~The agent node fell back and cost ~92 s~~ | Was the headline Chapter 1 defect | **CLOSED in Phase 13, with a measured before/after.** Before: **94.6 s and 94.5 s** on two consecutive runs, one step (`decide_urgency`, `ai.agent`) accounting for **91.9 s**. After: **4.2 / 4.5 / 6.0 / 7.5 / 4.6 s** across five consecutive deployed walks — worst case **7.5 s**. **The cause, reproduced rather than guessed** (`npm run probe:models`): `gemini-3.5-flash-lite` answers *text* and **times out on tool-calling**, which is why `ai.llm` took 1.4 s and `ai.agent` took 91.9 s in the same run. The adapter then retried the wedged model in place at a 45 s timeout — two timeouts is the 90 s. **Fixed three ways** (A14): a timed-out attempt is never retried on the same model, every attempt is capped at 12 s inside a 30 s chain ceiling, and a circuit breaker moves a failing model to the back of the chain. Three regression tests, each verified to fail against the old adapter |
| **The `limit: 500` free-tier cap is a DAILY one, and the API's `Please retry in Ns` hint is boilerplate** | Any session that runs the full battery | **Sharpened in Phase 14.** Two `smoke.mjs` walks 90 seconds apart both 429'd, and the advertised wait went **up**, 38.9 s → 45.0 s — the counter was not draining. A later `verify-api.mjs` failed all three models in the chain (`limit: 20` on `gemini-3-flash` and `gemini-3.6-flash`, `limit: 500` on `gemini-3.5-flash-lite`). **Do not wait out a `retry in Ns` on the 500 cap; it is a day, not a minute.** The fallback chain behaved exactly as designed under it — two attempts per model, fall through, report the provider's own message — so a full-chain 429 is not a regression. **Check the quota before debugging the code** |
| **Free-tier quota is PER MODEL, and a day of heavy verification exhausts it** | Any session that runs the full battery | **Measured on 2026-09-26, and it ended Phase 13's final re-verification.** The API's own words: `limit: 20, model: gemini-3-flash` and `limit: 500, model: gemini-3.5-flash-lite`. The 20 is per minute; the 500 behaved like a **per-day** cap — it did not recover after 7 minutes of complete idle, and nor did the other two. Google's rate-limit docs no longer publish free-tier numbers and defer to AI Studio (<https://aistudio.google.com/rate-limit>), so **the console is the only authority** and reading it needs a browser. **What burns it:** `probe-models.mjs` over the full catalogue is ~90 calls, each `smoke.mjs` walk is 2, each `verify-api.mjs` run is ~10. Phase 13 did all of that many times over. **The design already absorbs the per-minute case** — three models means three buckets, and the breaker moves off a throttled one — but nothing survives the whole chain being out for the day. **Practical rule: run the full battery ONCE per session, and re-probe models sparingly.** A 429 is not a regression; check the quota before debugging the code |
| ~~No favicon — `/favicon.ico` 404s~~ | Was cosmetic, visible in the browser tab | **Handled in Phase 10.** `src/app/icon.svg` is Next's app-icon convention; the framework emits the `<link rel="icon">` and serves it at `/icon.svg`, verified 200 on the deployed URL. `/favicon.ico` still 404s and that is fine — nothing requests it once the link tag is present |
| **A full-page `EmptyState` ships a document with no `h1`** | The 404 and the error boundary, for one deploy | `EmptyState` renders an `h3`, which is right for a region inside a page and wrong for a screen that *is* the empty state. It now takes `level`, and the two full-page callers pass `level={1}`. **Found by asking the deployed page for its headings, not by looking at it** — the screen looked perfect either way, which is the point: heading structure is invisible to the eye and load-bearing for everyone using a screen reader |
| **A closed `<dialog>` still renders its heading into the document** | A confirm dialog kept mounted | The delete dialog is mounted always so it can close itself, so its `<h2>` is in the DOM whether it is open or not — and a template literal in that title printed `Delete “undefined”?` the instant the row it was about was cleared. Guard the title or unmount the dialog. Harmless to a sighted user (a closed dialog is `display:none`) and visible to anything walking the document |
| **A stale local server outlives its session and serves old code — on ANY port** | A local UI check that silently verifies the previous build | **Hit again in Phase 14, on port 3100**, and it cost three rounds of screenshots: a detached standalone server from an earlier launch held the port, the new one died with `EADDRINUSE` into a log nobody read, and the browser kept showing the old stylesheet. A backgrounded start that is not checked for a successful bind is a check that proves nothing. **`lsof -nP -iTCP:<port> -sTCP:LISTEN` before trusting a local check**, and read the server log after starting it. Previously hit in Phase 5 on port 3000 |
| **A prerendered static route is cached hard by the browser** | Verifying a redeploy of `/design` | **Phase 14.** A fix was deployed, the page was re-navigated, and the browser served the cached prerender — the conclusion "the deploy did not take" was wrong, and the fix had shipped. **Append a cache-busting query string (`?cb=x`) when verifying a redeploy of a static route.** Dynamic routes (`/`, `/workflows`) do not have this problem |
| **`scripts/verify-api.mjs` leaves rows behind if it is killed** | Stray test workflows in the shared database | Its cleanup runs at the end, so a `ctrl-c` or a timeout skips it. Phase 5 found two orphans that way and deleted them. Check `select count(*) from "workflow"` after an interrupted run |
| **A `pull`-driven `ReadableStream` does not stream under Next** | Would have shipped a stream that opens and then says nothing | The SSE route drives its own loop. Do not "simplify" it back to `pull` (see `src/app/api/workflows/[id]/stream/route.ts`) |
| **Pinned Gemini models return 503 under load** | Demo reliability | **Handled.** Reproduced in Phase 6 (`gemini-3.8-flash`, 503 "experiencing high demand"). The adapter retries twice per model with backoff, then falls down `FALLBACK_MODELS`, and logs the fallback so it is never silent |
| **`gemini-3.5-flash` takes ~8.9 s; flash-lite ~1.2 s** | Demo pacing | Default is `gemini-3.5-flash-lite`. Still warm the model right before the demo |
| **A client component's `toLocaleString()` is a hydration error** | Any date rendered in a `"use client"` file | Server and browser disagree on locale and timezone → React #418. Format with `Intl.DateTimeFormat` pinned to a locale and `timeZone: "UTC"`. A **server** component is fine — the workflow list does it safely |
| **`z.string().min(1)` accepts `"   "`** | Any user-supplied string that costs money downstream | Whitespace counts toward the length. `.trim()` must come **before** `.min(1)`; the other order silently accepts it. A whitespace prompt reached the provider and spent a model call before this was fixed |
| **A generated graph can be valid and still do the wrong thing** | Generation, every phase that adds a node | Validation proves a graph *can* run, never that it does what was asked. The `{{ }}` reference bug passed validation and succeeded at runtime. **Give every non-pass-through node an `outputShape`** (D38), and eyeball a generated branch's `left` when adding nodes |
| ~~A redirect built from `request.url` points at `0.0.0.0:8080`~~ | Was: every successful Google connection landed on ERR_CONNECTION_REFUSED | **Fixed 2026-09-26** in `agentforge-00018-x7q` (D53). **The general lesson is live for every future route**: in this container `request.url` is the bind address, so anything that needs the public origin must read `APP_BASE_URL`. Four tests guard it |
| **`next start` cannot serve a `standalone` build** | Local verification only | It warns and then 404s every CSS chunk, which looks exactly like a broken stylesheet. Assemble the container's own layout instead — the commands are in *Notes for Phase 11* |
| **`next dev` and `next build` share `.next` and poison each other** | Local verification only | A dev server started after a production build serves the build's manifest and 404s every asset. `rm -rf .next` between the two |
| **A generated trigger's `requiredFields` are the model's choice, and vary run to run** | Any fixed payload posted to a generated webhook | Measured across 20 walks: **8 declared a field a fixed literal would not send** (`submission` mostly, once `content`, once `id`) — a **400** before the run starts. `scripts/demo-payload.mjs` fits the payload to the graph (D58). **Anything else that POSTs to a generated webhook must do the same**, or it is relying on a coin flip |
| **The API suites cannot see the browser** | Any UI regression, and one shipped | 178 deployed checks and ten clean smoke walks all passed while a webhook-triggered run was **invisible on the canvas** (D59). `smoke.mjs` opens its own SSE stream and fires 400 ms later — it proves the server streams, never that the page is still listening. **Drive a real browser before believing a UI claim**; Phases 6, 8, 10 and 12 each found something that way |
| **A generated config value can be valid and self-defeating** | Generation, every phase that adds a config field | `maxIterations: 1` on an agent (D57) is the sharpest case: schema-valid, graph-valid, fatal. Sibling of the `{{ }}` reference bug. **When adding a config field with a numeric bound, ask what the model does with the minimum** |
| ~~Beat 3 is small on a 1440 px screen~~ | Was: the headline beat was an 88px node card on a projector | **Fixed 2026-09-27 in Phase 16** (D73). The two side panels no longer take a fixed 560px — each collapses to a 40px rail, so the canvas at 1440px goes 880 → **1360px** and the card is drawn at **182px** rather than 88px. The old advice to present at 1920 still helps and is no longer load-bearing: 1920 with both panels *open* now gives the same 182px. `fitView` padding stays at 0.18 |
| **A one-off React #418 on first page load** | Cosmetic; not reproduced | Seen once on revision `agentforge-00012-cs6` alongside an `ERR_NETWORK_CHANGED` from a fetch interrupted mid-hydration. **Not reproducible on `00013-zwt`**: signed-out landing, workflow list, canvas, and the whole generate → run path each read 0 errors, 0 warnings. Re-check with a clean profile before the demo |
| **Two attempts means two timeouts** | A wedged external host, worst case | A retried call gets a fresh timeout, so a Sheets append is at worst `20 s × 2 + 0.5 s backoff ≈ 40.5 s` and a Discord post ≈ 30.5 s. Both sit inside the engine's 120 s deadline **with an agent node's own budget alongside them**, which is the number to re-check if either timeout is ever raised. Bounded, measured, accepted (D54) |
| **`scripts/smoke.mjs` writes to real services** | The demo channel and the demo sheet | One Discord message and one Sheet row **per walk** — `--loop 10` leaves ten of each. That is the point (it proves Beat 8) but they must be cleared before demoing. The script says so when it finishes. Phase 11's ten walks filled `Sheet1!A4:C4` through `A14:C14` |
| **`verify-api.mjs` now reports 2 skips, not 1** | Reading the tally | **Not a regression.** The second check only runs when Google is *dis*connected, and Google is connected — which is the state the demo needs. 178 checks, 176 passed, 0 failed, 2 skipped. A tally that moves without a failure is a state difference; check *which* skip before suspecting code |
| ~~The demo spreadsheet's id is recorded nowhere~~ | Was: a cold session could not find the sheet Beat 8 depends on | **Fixed 2026-09-26.** The `spreadsheets` scope cannot search Drive, so the old sheet was genuinely unrecoverable. A new "AgentForge Demo Log" was created through the app's own stored credential and **its id is in `DEMO.md`'s seed table** |
| **A filled CSS animation silently overrides a utility on the same element** | Any element carrying `animate-rise` / `animate-pop` / `animate-boing` and an `opacity-*` class | **Found in Phase 16, in a browser, by `getComputedStyle` — not by any test.** `animate-rise` uses `animation-fill-mode: both`, so once it ends its keyframe *keeps* `opacity: 1` applied, and a filled animation outranks an ordinary declaration in the cascade. `opacity-65` on the skipped node card was present in the DOM and did **nothing**. The fix is structural: the entry animation now lives on a wrapper and the card carries its own state classes. **A class being in the DOM is not evidence it applies.** Note the near-miss: `-translate-x-px` was *not* affected, because Tailwind 4 compiles it to the `translate` property while the keyframe animates `transform` — so do not assume the two behave alike |
| **Two lint rules disagree about one dependency in `editor.tsx`** | Anyone touching the `start` callback's dependency array | `react-hooks/exhaustive-deps` reports `stopStream` as **missing** if it is left out; `react/memo-dependencies` reports it as **extra** if it is put in. Both cannot be satisfied. It stays in with the newer rule suppressed on that line, because `useRunStream` defines it as `useCallback(..., [])` — stable for the component's lifetime, so listing it cannot cost a render, while omitting it would capture a stale closure the day that hook closes over anything. Every *other* entry in that array was verified as required by removing it and watching `exhaustive-deps` ask for it back. This replaces Chapter 1's blanket suppression on the same array |
| **React Flow does not refit on a window resize** | Judging the canvas by resizing a browser window | Only mount, adding a node, and a panel collapse call `fitView`. Resizing a window leaves the graph at the previous fit, which at 375px looks like a broken layout and is not one — **reload after resizing before believing a screenshot.** Deliberate: a viewport that jumps while the user drags a window edge is worse than a stale fit, and every node editor behaves this way |

Carried risks, recorded so they are not rediscovered:

| Risk | Where it bites | Mitigation |
|---|---|---|
| ~~In-flight runs die on redeploy — no queue~~ | Was: any deploy during a run | **CLOSED in Phase 17, and the premise was wrong twice over.** Cloud Run *drains*, so a redeploy does not kill a run at all (see *Known Issues*), and for the cases that genuinely do — a crash, an OOM kill — a **durable** run is redelivered by Cloud Tasks and resumes from its cursor. `reapStaleRuns` is gone; `sweepAbandonedRuns` fails only what nothing is coming back for |
| Only one LLM provider available | `PRD.md` C10 / S1 | Provider-agnostic adapter; model selection across Gemini tiers |
| Auth.js v5 is a beta | All phases | Pinned to exact `5.0.0-beta.32`; never track the `beta` tag |
| Rotating `ENCRYPTION_KEY` destroys all stored credentials | Any time | Never rotate it |
| Neon autosuspends independently of Cloud Run | Demo beat 1 | 9–32 ms warm, ~700 ms after ~6 min idle. `min-instances=1` does nothing for Neon — warm the database separately right before the demo |
| A long run could outlive the request | Phases 6–9, when nodes call LLMs and APIs | Engine deadline is 120 s against Cloud Run's 3600 s. Raise deliberately if an agent node needs it — **and raise `STREAM_MAX_MS` (150 s) and `LEASE_MS` (180 s) with it.** Phase 17 made that a three-number family: the stream must outlive the run or the watcher closes first, and the **lease must outlive the attempt** or a live worker can lose its lease to a redelivery and the same node executes twice (D78) |
| A stream polls Neon twice every 300 ms | Cost, if many streams are open at once | Only while a run is being watched, and a stream closes itself. Revisit only if it shows up in Neon's compute hours |

---

## Manual Actions Pending

**One outstanding: M9.** M1–M8 are all done and verified with live calls.

### M9 — read Neon's consumed CU-hours — **OPEN, blocks nothing today**

**Why.** Neon's Free plan is **100 CU-hours per project per month** and the `*/15` cron tick
commits about **61** of them, leaving ~39 for real use. The *budget* is verified
(`DEPLOYMENT.md` → *Free-tier headroom*); the *balance* is not.

**Phase 19A did not need it** — Neon meters compute *time awake* rather than statements, and
workspaces add a query to requests that already make one. **Phase 22 did not need it either, in the
end**, and that is the more useful precedent: the analytics were designed against the *rule* rather
than the balance — never add a new reason to wake an idle database — and the feature's own cost was
then measured directly at **21–27 ms per page view**. A phase that respects the rule does not have
to know the balance. A phase that wants a scheduled job does.

**Why it is not automated — SHARPENED IN PHASE 22, and the Phase 13 reason was wrong.** `neonctl`
**is** authenticated on this machine now, so "it needs a browser" no longer applies. The real reason
is permanent on this plan: the consumption API is a paid feature.

```
$ neonctl api "/consumption_history/projects?...&granularity=daily" 
ERROR: This endpoint is not available. It is included with Scale plans and above.
```

And the legacy fields that used to carry it read zero — `compute_time_seconds`, `active_time_seconds`
and `cpu_used_sec` are all `0` on both `/projects/{id}` and `/projects/{id}/branches`, verified
2026-09-30. **It is console-only.** Do not spend another session trying to script it.

**Location.** <https://console.neon.tech> → project `agentforge` (`super-mountain-39872886`)
→ **Usage** (or **Billing → Usage**).

**Steps.**
1. Sign in to <https://console.neon.tech>.
2. Open the `agentforge` project.
3. Read **Compute hours** (CU-hours) used in the current billing period, and the period's end date.
4. Paste those two numbers back. **There is no scriptable alternative** — see above.

**Expected result.** A figure well under 100. If it is above ~70 with a week still to run, say so
— that is an escalation, not a note.

**Verification.** There is no command. The API refuses on this plan (above), so the console is the
only source. Paste the number back.

**Resume by:** pasting the CU-hours figure and the period end date.

---

**Older manual actions, all complete:**

**M8 — add two redirect URIs to the OAuth client — COMPLETE, 2026-09-26.** Done in the console by the
user; there is no API for a Web-application client's redirect URIs, re-checked at the time rather
than assumed (`gcloud iam oauth-clients` manages Workforce Identity apps, which is a different
resource). Verified straight afterwards: `/api/integrations/google/connect` now reaches Google's real
consent page instead of `Error 400: redirect_uri_mismatch`, requesting exactly
`auth/spreadsheets` + `auth/gmail.send` with `access_type=offline`, `prompt=consent` and
`include_granted_scopes=true`.

```
http://localhost:3000/api/integrations/google/callback
https://agentforge-733000675212.asia-southeast1.run.app/api/integrations/google/callback
```

**Re-verify it with** (expects the consent page, not a mismatch):

```bash
TOKEN=$(node --env-file=.env scripts/mint-session.mjs | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')
CONSENT=$(curl -s -o /dev/null -w "%{redirect_url}" \
  "$APP_URL/api/integrations/google/connect" \
  -H "cookie: __Secure-authjs.session-token=$TOKEN")
curl -s -L "$CONSENT" | grep -c redirect_uri_mismatch   # 0 is good
```

Allow ~90 s for Google to propagate a change before believing a `redirect_uri_mismatch`
(`DEPLOYMENT.md` records this as real, seen on 2026-09-25; Google's own docs say 5 minutes to a few
hours).

---

## Cloud Resource Inventory

**Check this before creating anything.** Real values, verified by live calls.

| Resource | Provider | Identifier | Status |
|---|---|---|---|
| `AgentForge` git repository | GitHub | `arunishrajput/AgentForge` | **EXISTS** |
| **GitHub Actions CI** | GitHub | `.github/workflows/ci.yml`, job `check` | **CREATED Phase 13** — lint · typecheck · test+coverage · build, on every push and PR to `main`. Green in **53–60 s** on PR #1 and on `main`. Free for a public repository |
| **Branch protection on `main`** | GitHub | required check `lint · typecheck · test · build` | **CREATED Phase 13.** Strict (a branch must be current with `main`), no force pushes, no deletions, conversation resolution required. **`enforce_admins` is deliberately `false`** so `CLAUDE.md`'s "work directly on `main`" still works for the solo developer — **verified by an actual direct push, not assumed**. A contributor's PR is gated; the owner's direct push is not |
| Google Cloud project | Google Cloud | `agentforge-hackathon-2026`, number **`733000675212`** | **EXISTS**, billing active ($300 / 90-day trial) |
| **`agentforge` Cloud Run service** | Google Cloud | `asia-southeast1`, revision **`agentforge-00047-w65`** | **LIVE 2026-09-30.** This row has gone stale three times now (`00018-x7q`, `00023-xf4`, `00041-75x`) — the *Deployed State* table above is the one kept current, and this one is corrected against it at the end of each phase |
| **`cloud-run-source-deploy` repo** | Artifact Registry | `asia-southeast1` | **EXISTS** |
| OAuth consent screen | Google Cloud | External, app "AgentForge" | **EXISTS** — status **Testing**, 1 test user |
| OAuth 2.0 client | Google Cloud | "AgentForge Web", `733000675212-…ntm7` | **VERIFIED** — 4 redirect entries |
| Neon Postgres project | Neon | `agentforge`, id `super-mountain-39872886` | **EXISTS** — free plan, PostgreSQL 18.6 |
| Neon branch / database / role | Neon | `production` / `neondb` / `neondb_owner` | **VERIFIED** |
| Neon tables | Neon | `user` `account` `session` `verificationToken` `workflow` `run` `run_step` `credential` `workflow_version` `workspace` `workspace_member` `workspace_invitation` **`credential_event`** | **13 tables. `0000`–`0009` APPLIED and verified against `information_schema` by `scripts/verify-schema.mjs`** — the ledger was three migrations behind reality until Phase 19A reconciled it. **9.9 MB of the free plan's 0.5 GB** |
| Enabled APIs | Google Cloud | `run`, `cloudbuild`, `artifactregistry`, `cloudscheduler`, `apikeys`, `generativelanguage`, `gmail`, `sheets`, `cloudtasks`, **`secretmanager`** | **ENABLED** — `secretmanager` added 2026-09-30 for Phase 21's root key; `gmail` and `sheets` added 2026-09-26, without which `integration.gmail` and `integration.sheets` fail at runtime however the OAuth consent went |
| Stored provider credential | Neon | `credential` row, kind `llm.google`, for the demo user | **PRESENT** — the free-tier key, encrypted. Left in place so no phase is blocked |
| Stored Discord credential | Neon | `credential` row, kind `integration.discord` | **PRESENT 2026-09-26** — webhook "AgentForge", channel `1553084744504316034`, verified against Discord before storage. **Note it goes absent whenever `scripts/verify-api.mjs` is run with `VERIFY_DISCORD_WEBHOOK`**: the script stores it, posts with it, then deletes it, because deletion is one of the paths under test. Re-add it from `DISCORD_WEBHOOK_URL` in local `.env` — a `PUT /api/integrations/discord` is enough |
| Stored Google credential | Neon | `credential` row, kind `google.oauth` | **PRESENT 2026-09-26** — `arunishrajput7@gmail.com`, scopes include `spreadsheets` and `gmail.send`, so `canAppendSheets` and `canSendMail` are both true. Consent was completed by the user in a browser; that step authenticates as them and cannot be scripted |
| ~~Gemini API key~~ | Google Cloud | "AgentForge Gemini" in `agentforge-hackathon-2026` | **DEAD** — 402, the project has billing so it is off the free tier. Kept, unused |
| **`agentforge-gemini-free` project** | Google Cloud | **no billing**, `generativelanguage` enabled only | **CREATED Phase 6.** Exists solely to hold a free-tier Gemini key. **Never enable billing on it** |
| **Gemini API key (free tier)** | Google Cloud | "AgentForge Gemini Free Tier" in `agentforge-gemini-free`, restricted to `generativelanguage.googleapis.com` | **VERIFIED 2026-09-26** — text generation and function calling both work. Read it with `gcloud services api-keys get-key-string` |
| Discord server / channel / webhook | Discord | "AgentForge" · `#agentforge-demo` | **VERIFIED** |
| **"AgentForge Demo Log" spreadsheet** | Google Sheets | id **`1iz8vjkGNvPQ1q1vpDvaWnQZ6648BNYHYauVXHHY2IBo`**, owned by `arunishrajput7@gmail.com`, tab `Sheet1`, headers `Received · From · Summary · Urgency` | **CREATED Phase 11** — through the app's own stored Google credential, because the previous sheet's id was recorded nowhere and the `spreadsheets` scope cannot search Drive. **This is `DEMO.md` Beat 8's second payoff — do not delete it** |
| **`agentforge-cron` Scheduler job** | Google Cloud | `asia-southeast1`, `*/15 * * * *` UTC, attempt deadline 540 s | **`ENABLED`, re-confirmed Phase 13.** It commits ~61 of Neon's 100 CU-hours/month — the arithmetic is verified in `DEPLOYMENT.md` → *Free-tier headroom*. Do not shorten the tick |
| Cloud Tasks API | Google Cloud | `cloudtasks.googleapis.com` | **ENABLED Phase 17.** Free tier verified: 1,000,000 ops/month per billing account |
| **`agentforge-runs` Cloud Tasks queue** | Google Cloud | `asia-southeast1`, state `RUNNING` | **CREATED Phase 17.** `maxAttempts 5` (mirrors `MAX_DELIVERIES` in `lease.ts`), backoff 5 s → 60 s, `maxConcurrentDispatches 3` — which is a **Neon** decision, not a Cloud Run one, since every concurrent run spends from the same 100 CU-hours. Measured: a task is delivered in **under a second**. Nothing to pause when idle; it bills per operation, not per hour |
| **`roles/cloudtasks.enqueuer`** | Google Cloud IAM | on `733000675212-compute@developer.gserviceaccount.com` | **GRANTED Phase 17.** The service account Cloud Run already runs as. Without it `enqueueRun` gets a 403 and every durable run silently falls back to in-process — which is why `/api/health` reports `queue.configured` |
| Secret Manager API | Google Cloud | `secretmanager.googleapis.com` | **ENABLED Phase 21, 2026-09-30.** Free tier: 6 active versions, 10,000 access ops/month. **The 3-rotation-notification limit is not a constraint here** — AgentForge subscribes to nothing and rotates on its own procedure |
| **`agentforge-root-key` secret** | Google Cloud | Secret Manager, user-managed replication in `asia-southeast1` | **CREATED Phase 21.** **Version `1` enabled** — 32 bytes of CSPRNG, base64, generated on the maintainer's machine and never written to the repository. It wraps every credential's data key. **Do not destroy a version anything still names**: `select distinct "keyVersion" from credential;` is the check. `SECURITY.md` → *Rotating the root key* |
| **`roles/secretmanager.secretAccessor`** | Google Cloud IAM | on `733000675212-compute@developer.gserviceaccount.com`, **scoped to `agentforge-root-key`** | **GRANTED Phase 21.** On the one secret, not the project. Without it every credential read answers `RootKeyError` while `/api/health` still reports `rootKey.provider: secret-manager` — which is why the deployed suite asserts a real decrypt rather than the configuration alone |
| **GitHub private vulnerability reporting** | GitHub | `arunishrajput/AgentForge` | **ENABLED Phase 21.** `SECURITY.md` points readers at it, so it had to actually exist |
| **Four log-based metrics** | Google Cloud | `agentforge_runs`, `agentforge_node_latency`, `agentforge_model_fallbacks`, `agentforge_errors` | **CREATED Phase 22, 2026-09-30**, and **all four confirmed collecting real points** through the Monitoring API rather than assumed from the create call. Free — they bill against Cloud Monitoring's 150 MiB/month chargeable-metrics allowance and this project makes a handful of time series. **Their filters name events declared in `src/lib/logging/events.ts` and a test guards those names**: a rename would leave a metric reporting zero forever, which is indistinguishable from a healthy system. `gcloud logging metrics list` |
| **Cloud Logging** | Google Cloud | project-wide, default `_Default` bucket | **IN USE, Phase 22.** No sink, no exporter and no agent was created — Cloud Run parses a JSON line on stdout into a `LogEntry` on its own. 30-day retention is included. Measured 6.34 MB per 30 days against **50 GiB**, so roughly 8,000× headroom |

**One Neon database serves both local and production.** Migrations applied locally are already
live. Phase 3's migration is purely additive, so the older revision still runs against it.

### Local `.env` — populated, gitignored, never committed

All 15 contract variables have values; `.env.example` mirrors `CONTRACT.md`.

### Installed stack — unchanged since Phase 4

`next` 16.3.6 · `react` / `react-dom` 19.3.0 · `next-auth` **5.0.0-beta.32** ·
`@auth/drizzle-adapter` 1.11.3 · `drizzle-orm` 0.45.3 · `drizzle-kit` 0.31.11 ·
`@neondatabase/serverless` 1.1.0 · `zod` 4.6.5 · `@xyflow/react` 12.12.0 ·
`tailwindcss` 4.3.3 · `typescript` 7.0.2

**Phase 17 added nothing.** The Cloud Tasks adapter is one authenticated `fetch` against the REST
API with a token from the metadata server; `@google-cloud/tasks` would have brought gRPC and its
generated protobufs. The runtime dependency list is **still the Phase 4 one**, a sixth phase
running.

**Phase 13 added exactly one devDependency: `oxlint` 1.85.0** — the first change to this list since
Phase 4, and a dev dependency only, so the runtime image is untouched. It was measured against the
alternative: **ESLint + `eslint-config-next` resolves to 305 packages; oxlint is 2** and lints 139
files in 73 ms. Next 16 removed `next lint` and its own upgrade guide says to use a linter directly
(A15). The runtime dependency list is **still the Phase 4 one**.

The cron evaluator is ~200 lines of arithmetic rather than a cron package with its own opinion about
timezones (D43). `ai` and `@ai-sdk/google` remain **deliberately not installed** (D32). Tests run on
Node's built-in runner, now with coverage thresholds that fail the build.

### Local toolchain

`git` 2.54.0 · `gh` 2.98.0 · `node` v26.8.2 · `npm` 11.19.1 · `docker` 29.7.2 ·
`gcloud` 580.0.0 (authenticated, project + region set)

---

## How to verify the system, from a cold session

**Fastest first, added in Phase 13** — no network, no deployment, ~15 s:

```bash
npm run check          # lint + typecheck + test with coverage thresholds. Same four gates as CI
npm run probe:models   # which Gemini models actually answer, on BOTH paths. ~1 min, real calls
```

**Does the database match the repository?** — instant, no deployment, added in Phase 19A:

```bash
node --env-file=.env scripts/verify-schema.mjs
```

It compares drizzle's own snapshot, its migration journal and `information_schema`. **Run it before
and after every migration.** It exists because two silent drifts had been live for days and no test
could see either — see *Known Issues*. `--repair` records migrations whose DDL is verifiably already
present, and refuses to record one whose effects it cannot see.

**Rehearse a migration before applying it.** There are two, one per migration that needed one, and
they are separate scripts on purpose — each knows its own tables and its own invariants, and
generalising them into a framework for a job that has happened twice would be the wrong trade.
**Phase 19B's rehearsal was written for the session and not kept**: what it proved is now asserted
permanently by `verify-api.mjs` against the deployed system on every run, which is the better home
for it.

```bash
node --env-file=.env scripts/rehearse-migration.mjs   # 19A — expand/contract, 5 tables, a backfill
node --env-file=.env scripts/rehearse-0008.mjs        # 20  — 3 additive columns and a partial index
node --env-file=.env scripts/rehearse-0009.mjs        # 21  — a table, 7 columns, and a guard
```

**Phase 21's exists because its rollback can destroy every credential in the product.** After a
re-key, a credential's data key lives only in `wrappedKey`, so `DROP COLUMN "wrappedKey"` discards
the only copy of the key and leaves the ciphertext permanently unreadable. `rollback_0009.sql`
therefore opens with a `DO` block that counts enveloped rows and raises rather than proceeding — and
the rehearsal **puts an envelope on a row and asserts the guard fires**, because a guard that does
not fire is worse than no guard: it is trusted. 15/15, including that the guard aborts the whole
script and drops nothing. The real rollback does not touch the schema at all: `scripts/rekey.mjs
--to-legacy`, then shift traffic.

**Phase 20's exists because of its *rollback*, not its migration.** `0008` is three `ADD COLUMN`s
and cannot lose anything; `rollback_0008.sql` is three `DROP COLUMN`s against `workflow`, the table
holding the user's actual workflows, on a free-tier database with no point-in-time restore. It also
exercises the partial unique index against the real DDL — a duplicate token refused, many nulls
permitted — because an index that *exists* is not an index that *refuses anything*.

It clones the affected tables and their rows into a throwaway schema, applies the migration forward,
applies the hand-written rollback backward, and asserts the copy is **digest-identical** to where it
started. The copy is a schema rather than a Neon branch only because `neonctl` here is
unauthenticated (M9). The procedure it belongs to is in `DEPLOYMENT.md` → *Migrations*.

**Storage against the free tier** — Phase 18 is the first feature whose cost is storage rather
than compute. The queries are in `DEPLOYMENT.md` → *Free-tier headroom* → *Storage, re-measured in
Phase 18*. Re-run them after anything that writes per-save.

**Durable execution, against the deployed service** — ~6 minutes, 7 checks, added in Phase 17:

```bash
APP_BASE_URL="https://agentforge-733000675212.asia-southeast1.run.app" \
  node --env-file=.env scripts/verify-durable.mjs all
```

It creates its own workflow through the API, runs it durably, resumes it, cancels it twice, fires
the scheduled path, and constructs four abandoned runs to check the sweeper's mode-aware decision.
`--interrupt` additionally deletes the serving revision mid-run. `cleanup` removes the fixture.
**Re-run it after touching the engine, the queue or the lease** — none of those are reachable by a
unit test, because they are properties of Postgres and Cloud Tasks rather than of the code. Phase
18 re-ran it for exactly that reason: the resume path now reads a version snapshot first.

**The credential vault, against the deployed service** — ~90 s, 61 checks, added in Phase 21:

```bash
node --env-file=.env scripts/verify-vault.mjs \
  "https://agentforge-733000675212.asia-southeast1.run.app"
```

It proves the three rotations the phase exists for — a stored credential, a workflow's webhook token
with the **old URL refused immediately**, and a re-key in which **every credential is verified to
decrypt** — plus three claims that would otherwise be taken on trust: that the vault's response
contains no part of any stored envelope (searched for against the real ciphertext, read out of the
database), that a refused rotation leaves the stored secret byte-identical, and that every rotation
mints a fresh data key. It also runs a 16-cell role matrix.

**Observability and analytics, against the deployed service** — ~2 minutes, added in Phase 22:

```bash
node --env-file=.env scripts/verify-observability.mjs \
  "https://agentforge-733000675212.asia-southeast1.run.app"
```

It does three things no other suite can. It **recomputes every analytics figure from SQL
independently** — totals, both percentiles by hand-written nearest rank, day buckets, node rows and
model rows — and compares, which is the only check that can catch an aggregate that is merely
plausible. It **creates its own workflow, fails it twice on purpose, and then finds those failures
in Cloud Logging**, asserting severity, the indexed `event` label, the duration, the error group and
that one run is one trace — the phase's objective written as a test, with the database never opened.
And it **measures what the analytics page costs** and prints the number. It deletes what it made.

Run it locally too: four checks skip there rather than fail, because a machine with no Cloud Tasks
and no Secret Manager is *correctly* `degraded`, and that verdict existing is the point.

**The log-based metrics are a separate thing and are not asserted by any suite** — they live in GCP,
not in the repository. Confirm they still exist and still collect:

```bash
gcloud logging metrics list --format='table(name,filter)'     # expect 4
gcloud logging read 'resource.type=cloud_run_revision AND jsonPayload.event="model.call"' \
  --limit 10 --freshness 6h --format='value(jsonPayload.requested,jsonPayload.answered,jsonPayload.fallback)'
```

`OPERATIONS.md` is the runbook for reading all of it.

**It re-keys the real workspace**, which is unavoidable — re-keying is a property of the whole
workspace and cannot be rehearsed on a throwaway one that holds nothing — and every operation it
performs is idempotent and safe to repeat. Supply `DISCORD_WEBHOOK_URL` to exercise the rotation and
the post-rotation run; without it those three checks SKIP rather than silently pass.

**Re-run it after touching `lib/crypto/`, `lib/credentials/` or `lib/gcp/`.**

Note `APP_BASE_URL` must be overridden: `.env` points at `localhost:3000` for development.

`npm run check` is what CI runs, so a green local run means a green pipeline. `probe:models` needs a
key: `GEMINI_API_KEY=$(gcloud services api-keys get-key-string <key> --format='value(keyString)')` —
the resource path is in the script's own header.

Then the deployed checks:

```bash
npm run typecheck && npm test           # 661 tests, no database, no network, ~11 s
npm run build                           # Turbopack; one expected process.exit warning

# ~400 checks end to end over HTTP. Mints a real session row, drives the API, cleans up.
# ~80 of them are Phase 20's: a 56-cell role matrix run in a throwaway workspace created and
# deleted by the script — every role below each action's bar refused AND proved to have changed no
# row, every role at the bar allowed — plus the role-change rule, per-workflow visibility, and the
# share link's redaction against a real Bearer header and a real address.
# 83 are Phase 19B's membership checks, which need a real second account to mean anything:
# a second `user` row, a second workspace, a real session, a real invitation accepted over HTTP.
# 32 more are Phase 18's versioning and diffing, which need real Postgres: the version number comes
# from a RETURNING on a single-row UPDATE, and the debounce depends on jsonb key normalisation.
#
# It creates and deletes its own rows. An interrupted run leaves probe users, workspaces,
# invitations and a `zzzz matrix arena` workspace behind — all named `*@agentforge.invalid` or
# prefixed `zzzz-`, so they are safe to delete, and the probe ids sort last on purpose so a stray
# one is never picked as the main user.
# Takes ~2 min: one check deliberately waits 21 s for an idle stream to close itself, and the
# agent and generation checks make real model calls.
#
# VERIFY_GEMINI_KEY turns on the key/model/agent/generation checks. Pipe the key in rather than
# pasting it anywhere — it is never printed:
VERIFY_GEMINI_KEY="$(gcloud services api-keys get-key-string \
  "$(gcloud services api-keys list --project=agentforge-gemini-free --format='value(name)' | head -1)" \
  --format='value(keyString)')" \
VERIFY_DISCORD_WEBHOOK="$(grep '^DISCORD_WEBHOOK_URL=' .env | cut -d= -f2-)" \
  node --env-file=.env scripts/verify-api.mjs https://agentforge-733000675212.asia-southeast1.run.app

# Without them those checks SKIP rather than pass. It also skips storing a key when one is
# already stored: the API is write-only, so a stored key cannot be read back and restored.
#
# VERIFY_DISCORD_WEBHOOK posts a REAL message to #agentforge-demo and then deletes the stored
# credential, because deletion is one of the paths under test. Clear the message afterwards,
# and re-add the webhook in Settings before demo day.
#
# The nine outbound-guard checks and everything else in Phase 9 run without either variable.

# The demo path only, beat by beat, in ~10 s. This is the pre-demo check (D56) and the
# first thing to run when asking "does the product still work end to end?".
# It posts a REAL Discord message and appends a REAL row per walk — clear them after.
SMOKE_SPREADSHEET_ID=1iz8vjkGNvPQ1q1vpDvaWnQZ6648BNYHYauVXHHY2IBo \
  node --env-file=.env scripts/smoke.mjs https://agentforge-733000675212.asia-southeast1.run.app

# --loop 10 is Phase 11's bar: ten consecutive clean walks, ~2 min. It stops at the
# first failing walk, because "ten in a row" is the claim, not "ten attempts".

# Put the demo account into the state DEMO.md assumes, and PROVE it: credentials
# connected, the backup workflow generated and RUN end to end, the sheet cleared to
# its header row, strays swept. Idempotent — run it before every demo.
SEED_SPREADSHEET_ID=1iz8vjkGNvPQ1q1vpDvaWnQZ6648BNYHYauVXHHY2IBo \
  node --env-file=.env scripts/seed-demo.mjs https://agentforge-733000675212.asia-southeast1.run.app
#
# --check reports without changing anything, which is the fastest "is the demo still
# set up?" there is. It cannot clear Discord — a webhook post is deletable only by its
# own message id — and says so when it finishes.

# DEMO.md Beat 5. Resolves the newest workflow at fire time (the webhook token is
# minted per workflow at creation, so the demonstrated one does not exist until
# Beat 3) and fits the payload to the trigger the model just wrote. Never prints
# the URL. --payload calm sends the reserve message and takes the FALSE branch.
node --env-file=.env scripts/demo-fire.mjs https://agentforge-733000675212.asia-southeast1.run.app
node --env-file=.env scripts/demo-fire.mjs <url> --list        # what it would pick, and why

# To look at the canvas without driving Google OAuth by hand: mint a session row,
# set it as a cookie in the browser, then revoke it. Same mechanism, no app bypass.
node --env-file=.env scripts/mint-session.mjs
node --env-file=.env scripts/mint-session.mjs --revoke <token>
```

Cookie name is `authjs.session-token` over http, `__Secure-authjs.session-token` over https.

`npm test` runs the TypeScript sources directly on Node's built-in runner via a 30-line resolve
hook in `scripts/test-register.mjs`. **Consequence:** Node's strip-only mode rejects TypeScript
that needs real transformation — no constructor parameter properties, no enums, no namespaces, no
decorators anywhere in `src`.

---

## Notes for whoever comes next

**Start Phase 22 — observability and run analytics.** It is defined in `BUILD_PLAN.md` and
summarised under *Current Phase* above. **Read `DEPLOYMENT.md` → *Free-tier headroom* first**: Neon
compute is the binding resource, analytics queries spend from the ~39 spare CU-hours a month, and
Phase 22 is the phase that has to be designed against that number rather than around it.

*(This line said "Start Phase 19" from Phase 19 until Phase 21 found it — a heading that names a
phase goes stale the moment that phase ends, so it is corrected at the end of every phase now, the
same way the Cloud Run revision row is.)*

Chapter 1 is closed; the hackathon items that used to live here (the Fallback B recording, the deck
re-cut) are **no longer part of this project's work** and have been dropped.

**New in Phase 13, and load-bearing from here on:**

- **`npm run check` before you commit** — lint, typecheck, test with coverage. It is the same four
  gates CI runs, and it takes ~15 s. **CI is mandatory and a red pipeline is a stop-work condition**
- **`npm run probe:models` before blaming the model layer.** It makes real calls on both the text
  and the tool-calling path and ranks what actually answers. A model that answers prose may still
  hang on tool calls — that was the whole of the 91.9 s incident
- **Free-tier quota is a real budget and it is per model.** A full probe is ~90 model calls; Phase 13
  exhausted the day's allowance across all three chain models and could not re-run its final smoke
  walk. **Run the full battery once per session.** A 429 is not a regression — see *Known Issues*
- **Free-tier numbers are measured and dated** in `DEPLOYMENT.md` → *Free-tier headroom*. Neon is
  the binding one at ~39 spare CU-hours/month. **Re-read them before designing against them**;
  vendors move them

**Carry these forward — they are Chapter 1 lessons that still bite:**

- **Run `scripts/smoke.mjs` first, every session.** Ten seconds, names the beat that broke.
  `verify-api.mjs` is the regression suite for a code change (D56). `seed-demo.mjs --check` says
  whether the demo account is still in its demo state
- **Drive a real browser before believing a UI claim.** Phase 12's worst find passed 178 API checks
  and ten smoke walks (D59). The suites cannot see the page
- **Do not deploy on demo day.** A redeploy kills in-flight runs and replaces a verified build.
  If you must, **rollback is now tested**: `update-traffic --to-revisions <rev>=100`, ~15 s, then
  `--to-latest`
- **`min-instances 1` keeps Cloud Run warm, so a Cloud Run cold start is not reachable** without
  changing the demo's own configuration. Neon's wake is the only cold tier: 1.14 s at 13½ min idle
- **The registry claim has held eight times.** Phases 13, 14 and 15 each added no node, no palette
  entry, no config form, no dependency, no environment variable and no migration
- **The design system is `src/app/globals.css` plus `src/components/ui/`.** Tokens in `@theme`,
  component classes as `@utility`, and keyboard-complete React primitives beside them (D68 reversed
  Chapter 1's "no component library" once controls started carrying behaviour). **Still zero new
  dependencies.** `DESIGN.md` is the spec and `/design` is the living reference
- **`prefers-reduced-motion` is handled in two places and both must stay**: the CSS block in
  `globals.css`, and `src/lib/canvas/motion.ts` for React Flow's JavaScript `fitView`
- **Every date goes through `@/lib/format/date`**, which pins the locale and uses UTC. A client
  component that calls `toLocaleString()` renders differently on the server and in the browser —
  hydration error #418. Phase 15 replaced the three hand-rolled copies with that one module
- **Verify the production build the way the container runs it**, not with `next start`:
  ```bash
  npm run build && cp -r .next/static .next/standalone/.next/static && cp -r public .next/standalone/
  (cd .next/standalone && PORT=3100 HOSTNAME=127.0.0.1 node --env-file=../../.env server.js)
  ```
  Never run `next dev` against a `.next` a production build wrote — they share the directory

**After judging ends, two things cost money for nothing:** set Cloud Run `min-instances 0`, and
**pause the `agentforge-cron` Scheduler job at the same time**, or the tick keeps Neon awake ~240
h/month. Both are in `DEPLOYMENT.md` → *After judging ends*.

## Open, but blocking nothing

**Project licence.** Every adopted dependency is permissive. MIT is the obvious default. Still the
user's call — it governs whether others may commercialise the work. **Now scheduled: Phase 24
applies it.** An open-source showpiece without a licence is not open source, so this stops being
optional at that point.

**The old demo artefacts.** `DEMO.md` and `SUBMISSION.md` are archived, not deleted — `DEMO.md`
still documents a path known to work end to end, which is a useful smoke reference.

---

## Recent Changes

**2026-09-30 — Phase 22 complete. The system explains itself: structured logs, four metrics, error
grouping, and a per-workspace analytics page that costs 21 ms**

- **"What is this system doing, and what broke" is answerable without a database client**, which was
  the phase's objective verbatim. `verify-observability.mjs` induces a failure and then traces it end
  to end through Cloud Logging — which node, with what message, how long each step took, one trace
  per run — with the database never opened
- **Logging is `console.log` of a JSON line (A20).** Cloud Run's runtime turns it into a `LogEntry`,
  so structured logs, log-based metrics and Error Reporting all work with **no client library, no
  exporter, no background flush and no new dependency** — and nothing buffered to lose when a
  container is recycled mid-run, which is exactly when it matters. Sixteen ad-hoc `console.*` calls
  became nine named events
- **The correlation id is Cloud Run's trace, and no request log is written (A21).** Cloud Run already
  logs method, path, status and latency for free; emitting its trace joins ours to that record rather
  than paying to duplicate it. A Next 16 `proxy` was considered purely to put the route path on every
  entry, and **rejected** for that reason
- **Error grouping is one normaliser used twice (A23)** — by the logs and by the analytics page — so
  a group id read off a chart pastes into the Logs Explorer and finds its own lines. The rule *order*
  is the design: a URL contains digits and a UUID contains hex runs, so a greedy rule first shreds
  both and scatters one problem across many groups
- **Analytics is computed on demand and nothing runs on a clock (A22).** Three statements against the
  rows the engine already writes, when a signed-in person opens the page — no rollup table, no
  materialised view, no cache warmer, no polling, and the window selector is three links. **No
  migration, no column, no index.** Measured at **21–27 ms of database time per page view** on the
  deployed service; a 30-second auto-refresh would have cost 120 wakes an hour instead
- **`/api/health` reports five dependency checks with three verdicts**, and `degraded` answers **200
  on purpose** — failing a health check would take a working revision out of service over a
  configuration warning. Every field the four existing suites assert on kept its name and meaning
- **The phase's finding.** Within minutes of existing, `agentforge_model_fallbacks` caught the
  deployed system doing what Chapter 1 did invisibly for days: **the configured `gemini-3-flash-preview`
  was being answered by `gemini-3.5-flash-lite` on nearly every call**, on quota. Every affected run
  *succeeded*. A fallback is a success from the outside — which is precisely why it needed its own
  instrument
- **Two defects, both caught before the deploy**, which is why this phase took one deploy rather than
  three. A browser walk found that the third nav link made the workspace switcher draw **on top of**
  the *Workflows* link — the containers' boxes said there was no overlap; only measuring the
  `<button>` showed it, and the cause was a `min-width: auto` in the `Menu` primitive that had been
  latent since Phase 14. And `array_agg` over the Neon HTTP driver returns a Postgres array as its
  **text literal**, so the node-latency query called `.map` on a string and the route answered 500;
  fixing it then exposed that `Number(null)` is `0`, which was turning absent durations into
  zero-millisecond steps
- **`OPERATIONS.md` created** — the signals, four runbooks, the budget with its numbers, and the
  honest note that `verify-api.mjs` run twice inside a minute reports quota as failure
- **M9 corrected.** `neonctl` **is** authenticated; the Phase 13 reason was wrong. Neon's consumption
  API is Scale-plan-only and the legacy fields read zero on the free plan, so it is **console-only**.
  Recorded so nobody scripts it again
- Local: `npm run check` **769 passing** (was 739), coverage 86.79 / 91.04 / 77.72

**2026-09-30 — Phase 21 complete. Credentials are enveloped under a rotatable root key, all three
rotations work, and the product has an audit log**

- **Chapter 1's sharpest gap is closed.** Every secret is sealed under its own 256-bit data key,
  wrapped by a **versioned root key in Secret Manager** (D105, D106). Rotating the root key re-wraps
  ~60 bytes per row and **never decrypts a secret**, so *never rotate `ENCRYPTION_KEY`, it destroys
  all stored credentials* is now a four-step procedure in `SECURITY.md`. The re-key is **resumable
  by construction** — every row names the key that wraps it — which is what lets it run against
  production with no maintenance window, and it re-opens and compares every row it writes
- **Three rotations, all proved on the deployed system.** A stored credential, per-kind and
  **validated against the provider before anything is written** (A19); a workflow's webhook token,
  with **the old URL answering 404 from the moment the request returns** and no grace period; and
  the root key itself, by route per workspace and by `scripts/rekey.mjs` over every workspace
- **Two of the three credential kinds are not a text box**, and the interface says so instead of
  offering a control that cannot work: a Google refresh token can only be minted by Google, so the
  vault links to the consent flow. `ROTATION_RULES` is asserted against the credential registry in
  both directions, so a kind added in Phase 23 cannot become silently unrotatable
- **`credential_event` is the product's first audit log** (D108) — which run, which node, when, and
  **never what the credential contains**. Written from `readSecret`, the single funnel; survives the
  revocation it describes; retained 30 days, pruned by the cron tick; and never fails the thing it
  audits
- **`SECURITY.md` exists**, and its *What we do not claim* section is deliberately blunt: the root
  key is in process memory, a compromised container reads everything, there is no rate limiting, and
  the audit log is not tamper-evident
- **The rollback is the first in this project that can destroy data, and the first that refuses to.**
  `rollback_0009.sql` counts enveloped rows and raises; `scripts/rehearse-0009.mjs` puts an envelope
  on a row and asserts the refusal, because a guard that does not fire is worse than no guard
- **One shared GCP access layer.** `lib/gcp/metadata.ts` was extracted out of `lib/engine/queue.ts`
  so Cloud Tasks and Secret Manager share one token cache

Verified on **`agentforge-00046-w7b`**: `verify-vault.mjs` **61/61**, `verify-api.mjs` **393 passed /
0 failed / 4 skipped**, `verify-durable.mjs` all-pass, `verify-schema.mjs` 6/6,
`rehearse-0009.mjs` 15/15. Local `npm run check` **714 passing** (was 661), coverage
**86.07 / 91.30 / 76.57** against 85 / 88 / 76.

**Four defects came from verification and nothing else.** One from the deployed suite — a route that
wrapped its whole body in an error mapper and collapsed four deliberate refusals into a 500, which
**no unit test in this repository can see**, because `lib/api.ts` imports `@/auth`. Three from a real
browser — a divider whose opacity modifier silently did not apply, an empty-state paragraph
describing secrets that were not there, and a "Not connected" list offering a way to connect for one
kind out of three. All four fixed, redeployed and re-verified, three of them with a regression test
that fails without the fix. **That is the Phase 12 lesson for the seventh time.**

---

**2026-09-30 — Phase 20 complete. Roles are administrable, a workflow can be private, and a
workflow can be published read-only to anybody holding a URL**

- **The authorisation layer is finished.** Phase 19B built the floor — one funnel, least-privilege
  default. Phase 20 added the two rules a ranking cannot express: `roleChangeRefusal` (D98's
  sibling in `roles.ts`), ordered **authority → ownership → invariant** exactly as 19B's bug fix
  taught, and `visibleWorkflows` (D101), **the first authorisation in the product that filters rows
  rather than refusing requests**
- **A role can be changed** — `PATCH /api/workspaces/:id/members/:userId`. Ownership moves only by
  an owner's hand in either direction, the last owner can be neither removed nor demoted, and the
  handover is promote-then-step-down. Proved through the route on the deployed system and through
  the settings picker in a real browser
- **A workflow can be private to its creator plus the workspace's admins** (D99, D100). 404 to
  everybody else — its runs and its version history included, which is why `getRun` and `listRuns`
  gained a join. **A private workflow still fires on its own triggers**: visibility governs people,
  not machines, and that is asserted with a real webhook delivery
- **A public share link** (D103) — the product's **fourth** unauthenticated surface and the only one
  whose risk is in the response. What it may publish is an allowlist that **defaults to nothing**
  (D98), so a node added in Phase 23 cannot widen it by existing; a test asserts the table covers
  the registry and fails the build otherwise. Proved with a real `Bearer` token in a real header and
  a real address in a real body: **neither reaches the response or the rendered page**
- **`/s/:token` is a separate component, not `Editor` with a flag** (D102). It cannot save anything
  because it imports nothing that could
- **The UI withholds what the API refuses.** A viewer has no Save, Run, Share, palette, delete or
  restore, the canvas is not draggable, and the node inspector is a `<fieldset disabled>` (D104) —
  which Playwright confirmed by being **unable to type into it**. None of this is enforcement: all
  56 matrix cells still assert the server refuses regardless
- **Migration `0008`** — three additive columns and a partial unique index. Rehearsed forward and
  backward on a copy first (11/11, digest-identical), because the *rollback* drops columns from the
  table holding the user's workflows. Row counts identical before and after; `visibility` defaults
  to the behaviour every row already had, so nothing observable changed
- **Two deploys**: `00042` shipped the phase, `00043` shipped the two defects the browser found

**Two defects came from the browser and nothing else** — a viewer's panel offering a trigger input
and a "Queue a run" button under a paragraph beginning *"Press Run"*, and a share-page title
truncated to two words at 375 px. Both are in *Known Issues* with the lesson each carries. **394
deployed checks, 661 unit tests and a green typecheck all passed while both were live.** That is the
Phase 12 lesson for the sixth time: drive the real thing before believing a claim about it.

**Next session: Phase 21 — credential vault and rotation.** Read `CONTRACT.md` → *Credential storage
shape* first, and note that Phase 21 **creates `SECURITY.md`**. Phase 20 leaves it a worked example
of an admin-gated secret lifecycle (mint, show, revoke, re-mint under a new token) and one gap it
does not close: **the webhook trigger token still has no rotation at all**.

**Phases 13–19B — pruned; 13–18 on 2026-09-30, 19A and 19B the same day after Phase 21.** Their entries said what each phase built, and every one of
those facts now lives where a cold session actually reads it: the deployed state is in the table
above, the decisions are in *Decisions — BINDING*, the traps are in *Known Issues*, and the
contracts are in `CONTRACT.md`. The narrative is in `git log`. **This file is a status board, not a
diary** — keeping six months of "what happened when" here makes the part that matters harder to
find, which is the failure mode it is meant to prevent.

## Last Updated

**2026-09-30** — **Phase 22 complete.** Revision `agentforge-00047-w65` live, `/api/health` reporting
`status: ok` across all five dependency checks. **No migration**, so nothing to roll back at the
schema level.

**Verified on the deployed system, not asserted.** `verify-observability.mjs` — **ALL CHECKS
PASSED** (1 skipped), this phase's own suite:

- **Every analytics figure recomputed independently from SQL** and compared — totals, both
  percentiles by a hand-written nearest rank, the day buckets, the node table and the model table.
  The only check that can catch an aggregate which is merely plausible
- **A failure induced and then found from the logs alone** — a probe workflow created through the
  API, failed twice on purpose, and both failures located in Cloud Logging with the right severity,
  an indexed `event` label, a duration, an error group, and one trace per run. **The database was
  never opened.** The suite then deleted what it made
- **Two identical failures proved to be ONE error group** in the API response *and* in the logs,
  which is the property that makes the fingerprint worth having
- **A hostile `?range=` proved to fall back rather than widen the window**, with the `run` table
  intact afterwards
- **The feature's cost measured and printed: 21–27 ms of database time per page view**

`verify-api.mjs` **ALL CHECKS PASSED (3 skipped)**. A second back-to-back run reported 4 failures
that were **Gemini's 20-requests-per-minute free tier, not a regression** — the provider says so in
its own words, and `DEPLOYMENT.md` now warns about it. `verify-vault.mjs` ALL CHECKS PASSED.
`verify-durable.mjs` ALL CHECKS PASSED including a real Cloud Tasks scheduled run on this revision.
`verify-schema.mjs` 6/6.

**Four log-based metrics created, and all four confirmed collecting real points** through the
Monitoring API rather than trusted from the create call. `agentforge_model_fallbacks` needed a real
degradation to prove, so one was induced on the deployed service: a workflow asking for a model that
does not exist, answered by `gemini-3.5-flash-lite` — **and the run succeeded**, which is the whole
reason the metric exists.

**A real browser** at 1440, 1024 and 375 px, deployed and local. It found the header defect before
the deploy. Zero console errors on the deployed page; nothing overflows at 375 px.

Local: `npm run check` **769 passing**, coverage **86.79 / 91.04 / 77.72** against 85 / 88 / 76.

**Next: Phase 23 — node catalogue and templates.** `/clear` first.

---

## Previously

**2026-09-30** — **Phase 21 complete.** Revision `agentforge-00046-w7b` live, `/api/health` green
and reporting `rootKey.provider: secret-manager`, migration `0009_jazzy_alex_power` applied with row
counts identical before and after and the previous revision serving throughout.

**Verified on the deployed system, not asserted.** `verify-vault.mjs` — **61 passed / 0 failed**,
**ALL CHECKS PASSED**, and it is this phase's own suite: all three credentials converted from the
Chapter 1 shape to `sm:1` with **each one verified to decrypt**, the re-key idempotent on a second
run, an already-enveloped row proved to have kept its ciphertext byte-identical, a Discord
credential rotated **with a fresh data key** and a workflow still posting with it, a webhook token
rotated with the **old URL answering 404 immediately** and the new one 201, a refused rotation proved
to have left the stored envelope byte-identical, a 16-cell role matrix, the vault's response searched
against the real ciphertext for all six envelope columns and found clean, and the audit log naming
the run and the node that used a credential. `verify-api.mjs` — **393 passed / 0 failed / 4
skipped**, the skips all unsupplied env vars, one rate limit and one state difference.
`verify-durable.mjs` **ALL CHECKS PASSED**, including a Cloud Tasks scheduled run completing on this
revision. `verify-schema.mjs` **6/6**. Migration `0009` rehearsed **15/15** on a throwaway schema,
forward, then with the rollback's guard proved to fire, then rolled back to a digest-identical copy.

**A real browser** at 1440 px and 375 px, **0 console errors or warnings** beyond two deliberate
error responses: the vault read at both widths with no horizontal overflow, a rotation refused with
the provider's own words rendered and the stored key proved untouched, a re-key pressed, the canvas
webhook rotation driven through its confirm step with the old URL confirmed 404 **from inside the
page**, and an editor's view confirmed to offer neither the rotate control nor the re-key button.

Local `npm run check` **714 passing** (was 661), coverage **86.07 / 91.30 / 76.57** against
85 / 88 / 76.

**Four defects came from verification and nothing else** — one from the deployed suite (a route
whose error mapper collapsed four deliberate refusals into a 500, invisible to every unit test
because `lib/api.ts` imports `@/auth`), three from the browser (a divider whose opacity modifier
silently did not apply, an empty-state paragraph describing secrets that were not there, and a "Not
connected" list that offered a way to connect for one kind out of three). All fixed, redeployed and
re-verified; three carry a regression test that fails without the fix. **714 unit tests, 393 API
checks and a green typecheck all passed while every one of them was live.** That is the Phase 12
lesson for the seventh time: drive the real thing before believing a claim about it.
