# PROGRESS.md — AgentForge execution state

**The status board.** A fresh session reads this and immediately knows where things stand. Keep it
concise and operational — prune stale detail rather than appending forever. This is not a diary.

---

## Project Status

**Phase 5 is complete. A run streams onto the canvas live, in production.**

**https://agentforge-733000675212.asia-southeast1.run.app**

Press Run and the canvas fills in as the run proceeds: each node flips to `Running` and then
`Succeeded`, log lines appear while the node that wrote them is still running, and a `Live` badge
shows a stream is open. Reloading the page mid-run — or opening the canvas for a run someone else
triggered — recovers correct state and keeps streaming. Verified by 61 live checks against the
deployed URL **and** by driving the deployed canvas in a real browser. No manual actions pending.

## Current Phase

**Phase 6 — agent layer: LLM node, agent node with tool-calling, provider config** (not started) —
`READY TO START`

## Completed Phases

| Phase | Status |
|---|---|
| **Phase 0** — setup, prerequisites, foundation decision | **COMPLETE** |
| **Phase 1** — application skeleton with Google auth | **COMPLETE** |
| **Phase 2** — first deploy, auth in production | **COMPLETE** — verified in a browser |
| **Phase 3** — data model, node registry, execution engine | **COMPLETE** — verified on the deployed URL, 2026-09-25 |
| **Phase 4** — visual canvas: build, edit, save, load | **COMPLETE** — verified on the deployed URL in a browser, 2026-09-26 |
| **Phase 5** — live execution: per-node status and log streaming | **COMPLETE** — verified on the deployed URL in a browser, 2026-09-26 |

---

## Deployed State

| Field | Value |
|---|---|
| **Canonical URL** | **`https://agentforge-733000675212.asia-southeast1.run.app`** |
| Legacy URL | `https://agentforge-i5d2u66boa-as.a.run.app` — works, do not publish it |
| Service | `agentforge` on Cloud Run, `asia-southeast1` |
| Revision | **`agentforge-00008-l8q`** — ready, 100% of traffic. Previous good revision: `agentforge-00007-xx7` |
| Scaling | `min-instances 1`, `max-instances 3`, 1 vCPU / 1 GiB, 3600 s timeout, port 8080 |
| Env vars set | `NODE_ENV` `AUTH_URL` `APP_BASE_URL` `DATABASE_URL` `AUTH_SECRET` `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` `ENCRYPTION_KEY` `CRON_SECRET` — 9, unchanged by Phase 5 |
| Database | Neon `super-mountain-39872886` — **8 tables**, migrations `0000` + `0001` applied |
| Routes | `/` `/dashboard`→`/workflows` `/workflows` `/workflows/[id]` + 8 API routes (Phase 5 added `GET /api/workflows/[id]/stream`) |
| Warm latency | health ~140 ms India → Singapore. A 5-node run whose two delay nodes wait 2.5 s each took **5.18 s**, with stream events at +449 ms, +2.98 s and +5.53 s |
| Last verified | **2026-09-26** — `node --env-file=.env scripts/verify-api.mjs <url>`, all **61** checks passed, plus a browser run on the deployed canvas watched live from start to finish |

**A redeploy preserves env vars.** Confirmed again on Phase 5's four deploys: `gcloud run deploy
agentforge --source . --region asia-southeast1` with no `--env-vars-file` carried all 9 variables
to each new revision. The file is only needed when a variable changes.

---

## Phase 5 — what was verified, not just written

`npm test` — **60 tests**, no database, ~190 ms. Phase 5 added 19: the whole streaming protocol
(`src/lib/engine/stream.test.ts`) plus two engine tests proving a log line reaches the recorder
*before* its step finishes, and that a delay is cut short by the run deadline rather than outliving
it.
`scripts/verify-api.mjs` — **61 checks over HTTP**, run against localhost first, then the deployed
URL. Phase 5 added 15, all of them about the stream.

**A script cannot prove a canvas streams.** So the deployed app was also driven in a real browser,
sampling the DOM every 400 ms while a run was in flight:

| Checked on the deployed canvas | Result |
|---|---|
| Press Run, watch the canvas fill in | ✓ `Manual trigger: Succeeded` at +0.4 s, first delay `Running`, second delay `Running` at +3.2 s, all `Succeeded` at +5.6 s |
| `Live` badge while a stream is open | ✓ on from +0.8 s, off the moment the run ended |
| Log lines mid-node | ✓ `Waiting 2500 ms.` shown while its node still read `Running`; `Done waiting.` added when it finished |
| Press Run twice in a row | ✓ the second run starts from a clean canvas, does **not** show the first run's badges, and its stream follows the *new* run |
| Load the canvas mid-run, run triggered from outside the browser | ✓ opened already showing 3 steps with the third `Running`, then advanced through each node for the next 28 s |
| The run survives the client disconnecting | ✓ a `POST /runs` aborted after 1.2 s — the run still completed, `succeeded` in 5175 ms |
| Stream closes itself | ✓ `done` with `reason: finished` at +5.53 s, and `reason: idle` after 20 s with no run |
| Console | ✓ **0 errors, 0 warnings** |
| Database left clean | ✓ 0 workflows, 0 runs, 0 steps; every test session revoked |

**Wire timings, deployed, measured end to end** (Cloud Run, Singapore, from India):

```
stream open  +115 ms   200 text/event-stream
+  449 ms  snapshot  run running, 2 step(s)
+ 2979 ms  step      delay succeeded  logs=2 "Done waiting."
+ 2981 ms  step      delay_2 running  logs=1 "Waiting 2500 ms."     ← mid-node log
+ 5532 ms  step      delay_2 succeeded
+ 5532 ms  run       succeeded 5176 ms
+ 5534 ms  done      {"reason":"finished"}
+ 5535 ms  POST /runs resolved: succeeded
```

**Three real problems were found by running it, not by reading it:**

1. **A `pull`-driven `ReadableStream` never polls.** The first version produced frames from the
   stream's `pull` callback, which Next's Node adapter stops calling once its queue is satisfied.
   It sent its opening frames and then went silent for ever — a stream that looks alive until you
   watch the clock. The route now drives its own loop and enqueues on a timer.
2. **The look-back adopted the wrong run.** Deciding which run to follow by comparing `startedAt`
   against the stream's open time, with a 5 s window, passed locally and **failed the first time it
   ran against Cloud Run**: the watcher latched onto the run from two seconds earlier, snapshotted
   it and closed. It also compared two different clocks — the container's and Postgres's. Replaced
   by a clock-free rule (D29).
3. **Pressing Run showed the previous run's green badges** for the ~400 ms before the first
   snapshot arrived, which reads as "already finished". The canvas now clears the run first.

**One claim was measured rather than assumed.** `no-transform` on the stream was written down as
"the thing stopping Next's `compression` middleware buffering the stream". Compression *is* active
on this build — an HTML response comes back gzipped — but a route handler's response bypasses it in
Next 16.3.6. The header stays, because that is an implementation detail and `no-transform` is the
documented opt-out, but the code comment now says what was measured.

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

---

## Known Issues

| Issue | Impact | Action |
|---|---|---|
| **Rollback is still untested** | Demo-day risk | Phase 3 created a second revision so it is now *possible*. The attempt was blocked by the session's production-deploy guard. **Run it manually once before demo day:** `gcloud run services update-traffic agentforge --region asia-southeast1 --to-revisions agentforge-00007-xx7=100`, verify, then shift back to `agentforge-00008-l8q` |
| **Google OAuth changes take ~90 s to propagate** | Cost 90 s in Phase 2 | Wait and retry before suspecting a typo |
| **A curl check cannot detect `redirect_uri_mismatch`** | Nearly caused a false "verified" | Only a real browser sign-in proves the OAuth redirect |
| **`min-instances 1` bills continuously** | Cost, after the hackathon | **Set to 0 once judging ends** |
| **OAuth consent screen is in `Testing`** | Demo day | Only listed test users can sign in. Before the demo: publish the app, or add each judge as a test user (cap 100) |
| **4 moderate `npm audit` findings, one root cause** | None in production | esbuild dev-server issue reachable only through `drizzle-kit`. Dev dependency, absent from the runtime image. **Accepted** |
| **Discord rejects requests with no `User-Agent`** | Phase 9 Discord node | Send an explicit UA |
| **`gemini-2.0-flash` is retired** | Phases 6, 7 | List models, never assume a name |
| **No favicon — `/favicon.ico` 404s** | Cosmetic, visible in the browser tab on demo day | Phase 10 (UI/UX pass). `public/` already exists |
| **A port-3000 `next dev` can outlive its session** | A stale server serves old code and the next session's `npm run dev` silently moves to 3001 | Check `lsof -nP -iTCP:3000 -sTCP:LISTEN` before trusting a local check. **Hit again in Phase 5** — a stale `next-server` was still listening |
| **`scripts/verify-api.mjs` leaves rows behind if it is killed** | Stray test workflows in the shared database | Its cleanup runs at the end, so a `ctrl-c` or a timeout skips it. Phase 5 found two orphans that way and deleted them. Check `select count(*) from "workflow"` after an interrupted run |
| **A `pull`-driven `ReadableStream` does not stream under Next** | Would have shipped a stream that opens and then says nothing | The SSE route drives its own loop. Do not "simplify" it back to `pull` (see `src/app/api/workflows/[id]/stream/route.ts`) |
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
| A long run could outlive the request | Phases 6–9, when nodes call LLMs and APIs | Engine deadline is 120 s against Cloud Run's 3600 s. Raise deliberately if an agent node needs it — **and raise `STREAM_MAX_MS` (150 s) with it**, or the watcher closes before the run does |
| A stream polls Neon twice every 300 ms | Cost, if many streams are open at once | Only while a run is being watched, and a stream closes itself. Revisit only if it shows up in Neon's compute hours |

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
| **`agentforge` Cloud Run service** | Google Cloud | `asia-southeast1`, revision `agentforge-00008-l8q` | **LIVE 2026-09-26** |
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

### Installed stack — unchanged by Phase 5

`next` 16.3.6 · `react` / `react-dom` 19.3.0 · `next-auth` **5.0.0-beta.32** ·
`@auth/drizzle-adapter` 1.11.3 · `drizzle-orm` 0.45.3 · `drizzle-kit` 0.31.11 ·
`@neondatabase/serverless` 1.1.0 · `zod` 4.6.5 · `@xyflow/react` 12.12.0 ·
`tailwindcss` 4.3.3 · `typescript` 7.0.2

**Phase 5 added no dependencies at all.** SSE needs none: a `ReadableStream` on the server and the
browser's own `EventSource` on the client. `ai` (Phase 6) is still deliberately not installed.
Tests run on Node's built-in runner.

### Local toolchain

`git` 2.54.0 · `gh` 2.98.0 · `node` v26.8.2 · `npm` 11.19.1 · `docker` 29.7.2 ·
`gcloud` 580.0.0 (authenticated, project + region set)

---

## How to verify the system, from a cold session

```bash
npm run typecheck && npm test           # 60 tests, no database, ~190 ms
npm run build                           # Turbopack; one expected process.exit warning

# 61 checks end to end over HTTP. Mints a real session row, drives the API, cleans up.
# Takes ~40 s: one check deliberately waits 21 s for an idle stream to close itself.
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
decorators anywhere in `src`.

---

## Notes for Phase 6

- **The streaming path is what makes an agent node watchable — use it.** `context.log` is already
  persisted and streamed per line (D30), so an agent node that logs "calling tool X", "model chose
  Y" gets a live reasoning trace on the canvas for free. Write those log lines deliberately; they
  are `DEMO.md` Beat 7, the beat the product exists for
- **`core.delay` is the only node currently slow enough to make streaming observable.** Once agent
  nodes exist, they take over that job — but keep the delay node, it is what the streaming tests
  assert against
- **`agentCallable` defaults to false (D19).** Phase 6 decides deliberately which nodes the agent
  may call; `core.delay` is currently `false`
- The engine deadline is 120 s and the stream ceiling is 150 s. An agent node that needs longer
  must raise `DEFAULT_DEADLINE_MS` *and* `STREAM_MAX_MS`, deliberately
- `CONTRACT.md` → *Agent tool-call schema* is still `NOT YET DECIDED` — Phase 6 fills it
- **`gemini-2.0-flash` is retired.** List models first, never assume a name (see Known Issues)

## Open, but blocking nothing

**Project licence.** Every adopted dependency is permissive. MIT is the obvious default. **Left to
the user deliberately** — it governs whether others may commercialise the work.

---

## Recent Changes

**2026-09-26 — Phase 5 complete, runs stream onto the canvas live**

- SSE endpoint, client hook, canvas status and log streaming — deployed as revision
  `agentforge-00008-l8q` and verified by 61 HTTP checks plus a browser run watched start to finish
- **Put the streaming protocol in one pure, tested module** (`src/lib/engine/stream.ts`): wire
  shapes, framing, the follow rule, and the "what changed" diff. 19 tests, no database, no HTTP
- **Chose to read the database rather than emit in-process** (D27), because the watcher and the
  runner are different requests and, on Cloud Run, possibly different containers
- **Found that a `pull`-driven `ReadableStream` silently stops polling** under Next's Node adapter;
  the route drives its own loop
- **Found that a clock-based "which run" rule fails on Cloud Run** — it adopted the previous run.
  Replaced with an id baseline (D29)
- **Added `RunRecorder.stepLogged`** (D30) so a log line is persisted as it is written; all of a
  run's writes are now serialised on one chain so a late log write cannot clobber a finished step
- **Added `core.delay`**, the one node slow enough to make incremental delivery assertable, and the
  only current exercise of mid-node log streaming
- **Deduplicated the run wire types**: `lib/canvas/client.ts` now imports them from
  `lib/engine/stream.ts` instead of re-declaring them
- Confirmed a client disconnecting does **not** kill a run on Cloud Run, so a mid-run reload
  recovers a run that is genuinely still going

## Last Updated

**2026-09-26** — Phase 5 complete. Revision `agentforge-00008-l8q` live, 61 deployed checks passed
plus a browser run on the deployed canvas watched live from start to finish. No manual actions
pending.
