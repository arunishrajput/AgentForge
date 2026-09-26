# PROGRESS.md — AgentForge execution state

**The status board.** A fresh session reads this and immediately knows where things stand. Keep it
concise and operational — prune stale detail rather than appending forever. This is not a diary.

---

## Project Status

**Phase 6 is complete. Agent nodes reason at runtime, in production, on a user-supplied key.**

**https://agentforge-733000675212.asia-southeast1.run.app**

Paste a Gemini key in Settings and it is verified against the provider, encrypted, and never shown
again. An agent node then reads its input, calls registry nodes as tools, and reaches a decision a
branch node routes on — with every step of its reasoning streaming onto the canvas while it is still
thinking. Verified by 82 live checks against the deployed URL **and** by driving the deployed
settings page and canvas in a real browser. No manual actions pending.

## Current Phase

**Phase 7 — natural language → workflow generation** (not started) — `READY TO START`

## Completed Phases

| Phase | Status |
|---|---|
| **Phase 0** — setup, prerequisites, foundation decision | **COMPLETE** |
| **Phase 1** — application skeleton with Google auth | **COMPLETE** |
| **Phase 2** — first deploy, auth in production | **COMPLETE** — verified in a browser |
| **Phase 3** — data model, node registry, execution engine | **COMPLETE** — verified on the deployed URL, 2026-09-25 |
| **Phase 4** — visual canvas: build, edit, save, load | **COMPLETE** — verified on the deployed URL in a browser, 2026-09-26 |
| **Phase 5** — live execution: per-node status and log streaming | **COMPLETE** — verified on the deployed URL in a browser, 2026-09-26 |
| **Phase 6** — agent layer: LLM node, agent node, provider config | **COMPLETE** — verified on the deployed URL in a browser, 2026-09-26 |

---

## Deployed State

| Field | Value |
|---|---|
| **Canonical URL** | **`https://agentforge-733000675212.asia-southeast1.run.app`** |
| Legacy URL | `https://agentforge-i5d2u66boa-as.a.run.app` — works, do not publish it |
| Service | `agentforge` on Cloud Run, `asia-southeast1` |
| Revision | **`agentforge-00008-l8q`** — ready, 100% of traffic. Previous good revision: `agentforge-00007-xx7` |
| Scaling | `min-instances 1`, `max-instances 3`, 1 vCPU / 1 GiB, 3600 s timeout, port 8080 |
| Env vars set | `NODE_ENV` `AUTH_URL` `APP_BASE_URL` `DATABASE_URL` `AUTH_SECRET` `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` `ENCRYPTION_KEY` `CRON_SECRET` — 9, **unchanged by Phase 6**. No Gemini key on the service: the product path is the user's own key, and leaving the env fallback unset is what proved it |
| Database | Neon `super-mountain-39872886` — **8 tables**, migrations `0000` + `0001` applied |
| Routes | `/` `/dashboard`→`/workflows` `/workflows` `/workflows/[id]` `/settings` + 10 API routes (Phase 6 added `/api/settings/provider` and `/api/settings/provider/models`) |
| Warm latency | health ~140 ms India → Singapore. A 7-node run with a 1.5 s delay and an agent node that calls a tool: **3.6 s end to end**, agent step ~2 s of it (two `gemini-3.5-flash-lite` calls) |
| Last verified | **2026-09-26** — `VERIFY_GEMINI_KEY=… node --env-file=.env scripts/verify-api.mjs <url>`, all **82** checks passed, plus the deployed settings page and an agent run driven in a real browser |
| Provider key stored | **Yes, deliberately left in place.** The user's own free-tier key is stored (encrypted) against their account on the deployed app, so Phase 7 is not blocked on re-pasting it |

**A redeploy preserves env vars.** Confirmed again on Phase 6's three deploys: `gcloud run deploy
agentforge --source . --region asia-southeast1` with no `--env-vars-file` carried all 9 variables
to each new revision. The file is only needed when a variable changes.

---

## Phase 6 — what was verified, not just written

`npm test` — **128 tests**, no database, no network, ~490 ms. Phase 6 added 68: the Gemini wire
format, the schema sanitiser, the tool projection, the agent loop against a fake model, and the
crypto round trip.
`scripts/verify-api.mjs` — **82 checks over HTTP**, run against localhost first, then the deployed
URL. Phase 6 added 21, all of them about keys, models, or an agent actually deciding something.

**A script cannot prove the settings page or a live reasoning trace.** So the deployed app was also
driven in a real browser:

| Checked on the deployed app | Result |
|---|---|
| Settings shows a stored key without showing the key | ✓ "Your key, stored 26 Sept 2026, 01:38 UTC", input reads "Replace the stored key…" |
| A wrong key typed into the form | ✓ refused with the provider's own words: "API key not valid. Please pass a valid API key." — and the stored key was **not** overwritten |
| Live model list | ✓ 18 models from the provider, current one marked `aria-current` |
| Choosing a model the key cannot serve | ✓ refused: "This key cannot use gemini-2.5-flash: … no longer available to new users", working model stays selected |
| Palette picks up the new nodes | ✓ "LLM" and "AI Agent" appear under **Agents**, from the registry, with no palette code touched |
| Agent config form | ✓ Objective, System, Model, Tools, Choices, Max iterations, Temperature — all derived from the Zod schema, no per-node UI |
| Agent reasoning streams mid-node | ✓ at +7.0 s `agent` reads **Running** with "Agent starting on gemini-3.5-flash-lite (key from user)"; at +8.05 s, **still Running**, "Calling tool core_log with {…}" and "[core_log] Production checkout is down for 40 minutes…" |
| The decision drives the branch | ✓ "Model answered: DECISION: urgent" → `route` took `true`, `escalate` Succeeded, `queue` **Skipped** |
| The same graph, a calm message | ✓ decision `normal`, the other branch taken. Nothing in the workflow changed |
| The iteration cap | ✓ a deliberately non-converging agent failed its step: "still calling tools after 2 model calls" |
| Console | ✓ **0 errors, 0 warnings** |
| Database left clean | ✓ 0 workflows, 0 runs, 0 steps; test sessions revoked |

**What the agent step actually contains, deployed:**

```
decision:   "urgent"
reason:     "The customer reports a production outage lasting 40 minutes with
             active financial loss, which requires immediate escalation."
toolCalls:  [{ name: "core_log", ok: true, ms: 1, args: { level: "warn", message: … } }]
iterations: 2      model: gemini-3.5-flash-lite      usage: 684 tokens
```

**The blocker this phase opened with.** Every Gemini model on the `agentforge-hackathon-2026` key
answered **402 "Your prepayment credits are depleted"** — because that project has billing enabled,
which moves it off the Gemini free tier. A free-tier key needs a project with **no** billing, so
`agentforge-gemini-free` was created for exactly that and nothing else. The old key is dead; see
*Known Issues*.

**Five problems found by calling the real API, not by reading about it:**

1. **A lossy adapter fails on the second tool call.** Gemini 3 signs `functionCall` parts with a
   `thoughtSignature` and answers **400** to a history that has lost one. A normalising adapter
   passes its first tool call and breaks on the next — so a model turn is replayed verbatim (D33).
2. **Gemini rejects `additionalProperties`.** Its `parameters` is a narrow OpenAPI subset, and
   `z.toJSONSchema()` emits keys it 400s on for nodes already in the registry. Every agent tool
   would have been rejected, first visible on demo day. Hence the allow-list sanitiser.
3. **`models.list` lists models a key cannot call.** `gemini-2.5-flash` is in the catalogue and
   answers **404 "no longer available to new users"**. Validating a model choice against the list
   stored a model that could not run — and it *did*: an unvalidated name got stored and every
   subsequent run failed with a 404 from inside the engine. A model is now proved with a real call.
4. **A client component's `toLocaleString()` is a hydration error.** React renders it on the server
   and again in the browser; the two disagreed and threw #418 on the deployed settings page. Caught
   by reading the console, not by any test. Now formatted in UTC with a fixed locale.
5. **A model given only a sentinel answers with only the sentinel**, leaving `output.reason` empty.
   The system prompt now asks for one sentence first.

**`gemini-3.8-flash` answered 503 "experiencing high demand" on a first call** and 200 twenty
seconds later, which is the *Known Issues* entry reproduced on demand. It is why the adapter retries
and then falls back down a chain, and why the chain is ordered by measured latency:
flash-lite ~1.2 s, 3.8-flash ~2.5 s, 3.5-flash ~8.9 s.

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
| **The `agentforge-hackathon-2026` Gemini key is dead** | Was a Phase 6 blocker | Every model answers **402 "prepayment credits are depleted"**: the project has billing enabled, which moves it off the Gemini free tier. `GOOGLE_GENERATIVE_AI_API_KEY` in local `.env` is this dead key. **Use the `agentforge-gemini-free` key instead** (no billing → free tier). Do not enable billing on that project |
| **`models.list` lists models a key cannot call** | Phases 6, 7 | `gemini-2.5-flash` is in the catalogue and answers 404 "no longer available to new users". Never treat the list as the callable set — make a real call (D34) |
| **`gemini-2.0-flash` and `gemini-2.5-flash*` are retired** | Phases 6, 7 | List models, never assume a name. Current default: `gemini-3.5-flash-lite` |
| **Free-tier rate limits are tight** | Phases 6, 7, demo | Back-to-back probes hit 429/503. The adapter retries twice per model then falls down the chain; do not run the verify script in a tight loop |
| **No favicon — `/favicon.ico` 404s** | Cosmetic, visible in the browser tab on demo day | Phase 10 (UI/UX pass). `public/` already exists |
| **A port-3000 `next dev` can outlive its session** | A stale server serves old code and the next session's `npm run dev` silently moves to 3001 | Check `lsof -nP -iTCP:3000 -sTCP:LISTEN` before trusting a local check. **Hit again in Phase 5** — a stale `next-server` was still listening |
| **`scripts/verify-api.mjs` leaves rows behind if it is killed** | Stray test workflows in the shared database | Its cleanup runs at the end, so a `ctrl-c` or a timeout skips it. Phase 5 found two orphans that way and deleted them. Check `select count(*) from "workflow"` after an interrupted run |
| **A `pull`-driven `ReadableStream` does not stream under Next** | Would have shipped a stream that opens and then says nothing | The SSE route drives its own loop. Do not "simplify" it back to `pull` (see `src/app/api/workflows/[id]/stream/route.ts`) |
| **Pinned Gemini models return 503 under load** | Demo reliability | **Handled.** Reproduced in Phase 6 (`gemini-3.8-flash`, 503 "experiencing high demand"). The adapter retries twice per model with backoff, then falls down `FALLBACK_MODELS`, and logs the fallback so it is never silent |
| **`gemini-3.5-flash` takes ~8.9 s; flash-lite ~1.2 s** | Demo pacing | Default is `gemini-3.5-flash-lite`. Still warm the model right before the demo |
| **A client component's `toLocaleString()` is a hydration error** | Any date rendered in a `"use client"` file | Server and browser disagree on locale and timezone → React #418. Format with `Intl.DateTimeFormat` pinned to a locale and `timeZone: "UTC"`. A **server** component is fine — the workflow list does it safely |

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
| **`agentforge` Cloud Run service** | Google Cloud | `asia-southeast1`, revision `agentforge-00011-tfq` | **LIVE 2026-09-26** |
| **`cloud-run-source-deploy` repo** | Artifact Registry | `asia-southeast1` | **EXISTS** |
| OAuth consent screen | Google Cloud | External, app "AgentForge" | **EXISTS** — status **Testing**, 1 test user |
| OAuth 2.0 client | Google Cloud | "AgentForge Web", `733000675212-…ntm7` | **VERIFIED** — 4 redirect entries |
| Neon Postgres project | Neon | `agentforge`, id `super-mountain-39872886` | **EXISTS** — free plan, PostgreSQL 18.6 |
| Neon branch / database / role | Neon | `production` / `neondb` / `neondb_owner` | **VERIFIED** |
| Neon tables | Neon | `user` `account` `session` `verificationToken` `workflow` `run` `run_step` `credential` | **APPLIED** — `0000_dark_paladin`, `0001_smiling_leper_queen` |
| Enabled APIs | Google Cloud | `run`, `cloudbuild`, `artifactregistry`, `cloudscheduler`, `apikeys`, `generativelanguage` | **ENABLED** |
| Stored provider credential | Neon | `credential` row, kind `llm.google`, for the demo user | **PRESENT** — the free-tier key, encrypted. Left in place so Phase 7 is not blocked |
| ~~Gemini API key~~ | Google Cloud | "AgentForge Gemini" in `agentforge-hackathon-2026` | **DEAD** — 402, the project has billing so it is off the free tier. Kept, unused |
| **`agentforge-gemini-free` project** | Google Cloud | **no billing**, `generativelanguage` enabled only | **CREATED Phase 6.** Exists solely to hold a free-tier Gemini key. **Never enable billing on it** |
| **Gemini API key (free tier)** | Google Cloud | "AgentForge Gemini Free Tier" in `agentforge-gemini-free`, restricted to `generativelanguage.googleapis.com` | **VERIFIED 2026-09-26** — text generation and function calling both work. Read it with `gcloud services api-keys get-key-string` |
| Discord server / channel / webhook | Discord | "AgentForge" · `#agentforge-demo` | **VERIFIED** |
| `agentforge-cron` Scheduler job | Google Cloud | — | Not created — Phase 8 |

**One Neon database serves both local and production.** Migrations applied locally are already
live. Phase 3's migration is purely additive, so the older revision still runs against it.

### Local `.env` — populated, gitignored, never committed

All 15 contract variables have values; `.env.example` mirrors `CONTRACT.md`.

### Installed stack — unchanged by Phase 6

`next` 16.3.6 · `react` / `react-dom` 19.3.0 · `next-auth` **5.0.0-beta.32** ·
`@auth/drizzle-adapter` 1.11.3 · `drizzle-orm` 0.45.3 · `drizzle-kit` 0.31.11 ·
`@neondatabase/serverless` 1.1.0 · `zod` 4.6.5 · `@xyflow/react` 12.12.0 ·
`tailwindcss` 4.3.3 · `typescript` 7.0.2

**Phase 6 added no dependencies either.** The provider adapter is `fetch` and the encryption is
`node:crypto`; `ai` and `@ai-sdk/google` are **deliberately not installed** (D32), and
`ARCHITECTURE.md`'s stack table now records that. Five phases in, the dependency list is still the
Phase 4 one. Tests run on Node's built-in runner.

### Local toolchain

`git` 2.54.0 · `gh` 2.98.0 · `node` v26.8.2 · `npm` 11.19.1 · `docker` 29.7.2 ·
`gcloud` 580.0.0 (authenticated, project + region set)

---

## How to verify the system, from a cold session

```bash
npm run typecheck && npm test           # 128 tests, no database, no network, ~490 ms
npm run build                           # Turbopack; one expected process.exit warning

# 82 checks end to end over HTTP. Mints a real session row, drives the API, cleans up.
# Takes ~90 s: one check deliberately waits 21 s for an idle stream to close itself, and the
# agent checks make real model calls.
#
# VERIFY_GEMINI_KEY turns on the 15 key/model/agent checks. Pipe the key in rather than
# pasting it anywhere — it is never printed:
VERIFY_GEMINI_KEY="$(gcloud services api-keys get-key-string \
  "$(gcloud services api-keys list --project=agentforge-gemini-free --format='value(name)' | head -1)" \
  --format='value(keyString)')" \
  node --env-file=.env scripts/verify-api.mjs https://agentforge-733000675212.asia-southeast1.run.app

# Without it those checks SKIP rather than pass. It also skips storing a key when one is
# already stored: the API is write-only, so a stored key cannot be read back and restored.

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

## Notes for Phase 7

- **The provider adapter is ready and the key is already stored.** `resolveProvider(ownerId)` hands
  back a `LanguageModel`; `generate({ json: true })` asks for a JSON body and parses it. Generation
  is a single call with no tools, so JSON mode is available (Gemini forbids JSON mode *with* tools)
- **`json: true` is a request, not a guarantee.** `stripCodeFence` in `src/lib/nodes/ai/llm.ts`
  already handles a model that fences its JSON anyway. Reuse it
- **The generated graph must go through `validateGraph` before it is persisted**, and a failure must
  be reported, never saved broken (`CONTRACT.md` → *Generation request/response*, still
  `NOT YET DECIDED` — Phase 7 fills it)
- **Feed the model the registry, not a hand-written node list.** `describeNodes()` is the same
  projection the palette and the agent's tool set use; a separate prompt-side catalogue would drift
  the first time a node changes
- **D16's bounds are the containment for generated graphs.** A model that emits a cycle is caught by
  validation; one that emits something pathological is caught by the run caps
- **Ask for `gemini-3.5-flash-lite` first** but expect to need a stronger model for graph synthesis —
  `FALLBACK_MODELS` in `src/lib/ai/gemini.ts` is where the chain lives. Measure before assuming
- **A generation call is slower than a chat call.** Watch it against `DEFAULT_DEADLINE_MS` (120 s) if
  generation ever runs inside a node rather than in its own route

## Open, but blocking nothing

**Project licence.** Every adopted dependency is permissive. MIT is the obvious default. **Left to
the user deliberately** — it governs whether others may commercialise the work.

---

## Recent Changes

**2026-09-26 — Phase 6 complete, agent nodes reason at runtime in production**

- Provider adapter, credential encryption, settings UI, LLM node and agent node — deployed as
  revision `agentforge-00011-tfq`, verified by 82 HTTP checks plus the settings page and an agent run
  driven in a real browser
- **Unblocked a dead Gemini key.** Every model 402'd on the main project because billing moves it off
  the free tier. Created `agentforge-gemini-free` (no billing) to hold a free-tier key
- **Chose `fetch` over the `ai` SDK** (D32) on four measured grounds, and struck the two packages out
  of `ARCHITECTURE.md`'s adopted-stack table rather than leaving it stale
- **Found that a normalising adapter breaks on the second tool call** — Gemini 3's `thoughtSignature`
  (D33). The history is now replayed verbatim
- **Found that Gemini rejects the JSON Schema Zod emits**, so every agent tool would have failed at
  first use. Added an allow-list sanitiser (D35)
- **Found that `models.list` lists models a key cannot call.** A model choice is now proved with a
  real call (D34) — the bug had already stored `gemini-does-not-exist` and broken every run
- **Found a hydration error on the deployed settings page** by reading the console: a client
  component's `toLocaleString()`. Now formatted in UTC with a fixed locale
- **Closed `core.branch` and `core.assert` to the agent** (D36), Phase 6's deliberate exercise of D19
- Put the tool projection, the schema sanitiser and the agent loop in pure modules so the cap is
  asserted against a fake model in a millisecond rather than against a real quota

## Last Updated

**2026-09-26** — Phase 6 complete. Revision `agentforge-00011-tfq` live, 82 deployed checks passed
plus the deployed settings page and an agent run driven in a real browser. No manual actions
pending.
