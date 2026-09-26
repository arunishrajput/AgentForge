# PROGRESS.md — AgentForge execution state

**The status board.** A fresh session reads this and immediately knows where things stand. Keep it
concise and operational — prune stale detail rather than appending forever. This is not a diary.

---

## Project Status

**Phase 8 is complete. A workflow now starts from an external HTTP call and on a schedule — in
production, fired by Cloud Scheduler.**

**https://agentforge-733000675212.asia-southeast1.run.app**

A webhook trigger has an unguessable per-workflow URL that runs the workflow with no session at all,
and a schedule trigger fires from a real Cloud Scheduler job. Verified by the full HTTP suite against
the deployed URL — **125 checks run, all passed** (38 of them Phase 8's) — by a real Cloud Scheduler
invocation returning **HTTP 200**, and in a browser.

**The registry paid off again: generation needed no code change.** `DEMO.md` Beat 2's target prompt
now builds `webhook_trigger → llm → agent → branch → log` on the first attempt, and a schedule
request produced `0 9 * * 1-5` with the next run correctly computed as Monday the 28th (the 26th is a
Saturday). Discord and Sheets are still correctly reported as `unsupported` — that is Phase 9's
acceptance test.

## Current Phase

**Phase 9 — integration nodes: Google Sheets, Gmail, Discord, generic HTTP** (not started) — `READY TO START`

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
| **Phase 7** — natural language → workflow generation | **COMPLETE** — verified on the deployed URL in a browser, 2026-09-26 |
| **Phase 8** — triggers: webhook + schedule | **COMPLETE** — verified on the deployed URL and by a real Cloud Scheduler invocation, 2026-09-26 |

---

## Deployed State

| Field | Value |
|---|---|
| **Canonical URL** | **`https://agentforge-733000675212.asia-southeast1.run.app`** |
| Legacy URL | `https://agentforge-i5d2u66boa-as.a.run.app` — works, do not publish it |
| Service | `agentforge` on Cloud Run, `asia-southeast1` |
| Revision | **`agentforge-00014-cpb`** — ready, 100% of traffic. Previous good revision: `agentforge-00013-zwt` |
| Scaling | `min-instances 1`, `max-instances 3`, 1 vCPU / 1 GiB, 3600 s timeout, port 8080 |
| Env vars set | `NODE_ENV` `AUTH_URL` `APP_BASE_URL` `DATABASE_URL` `AUTH_SECRET` `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` `ENCRYPTION_KEY` `CRON_SECRET` — 9, **unchanged by Phase 8 too**. `CRON_SECRET` and `APP_BASE_URL` were already set in Phase 2 and Phase 8 finally uses both. No Gemini key on the service: the product path is the user's own key |
| Database | Neon `super-mountain-39872886` — **8 tables**, migrations `0000` + `0001` + **`0002_wooden_morlocks`** applied. Phase 8 added `webhookToken`, `scheduleNextAt`, `scheduleLastFiredAt` to `workflow` |
| Routes | `/` `/dashboard`→`/workflows` `/workflows` `/workflows/[id]` `/settings` + **13** API routes (Phase 8 added `POST /api/webhook/[token]` and `POST /api/cron/tick`) |
| Warm latency | health ~190 ms India → Singapore. A 7-node run with a 1.5 s delay and an agent node that calls a tool: **3.6 s end to end**. **Generation: 2.3–3.2 s** for a 5-node workflow, measured again in Phase 8 |
| Last verified | **2026-09-26** — `VERIFY_GEMINI_KEY=… node --env-file=.env scripts/verify-api.mjs <url>`, **125 checks passed, 0 failed, 1 skipped** (the skip is storing a key, because one is already stored and the API is write-only), plus the trigger UI driven in a real browser |
| Provider key stored | **Yes, deliberately left in place.** The user's own free-tier key is stored (encrypted) against their account on the deployed app, so Phase 7 is not blocked on re-pasting it |

**A redeploy preserves env vars.** Confirmed again on Phase 6's three deploys: `gcloud run deploy
agentforge --source . --region asia-southeast1` with no `--env-vars-file` carried all 9 variables
to each new revision. The file is only needed when a variable changes.

---

## Phase 8 — what was verified, not just written

`npm test` — **215 tests**, no database, no network, ~750 ms. Phase 8 added 46: the cron evaluator
(steps, ranges, lists, the day-of-month/day-of-week OR rule, leap years, an expression that can never
match, UTC), the payload rules, the schedule derivation, and the secret comparison.
`scripts/verify-api.mjs` — **126 checks defined, 38 added by Phase 8**. Against the deployed URL:
125 passed, 0 failed, 1 skipped.

**Driven against the deployed URL:**

| Checked | Result |
|---|---|
| `POST /api/cron/tick` with no secret, a wrong secret, or **a valid session cookie** | ✓ 401 in all three cases — a session is not a substitute for the secret |
| `POST /api/cron/tick` as GET | ✓ 405 |
| A webhook call with **no session at all** | ✓ 201, the run succeeded |
| The posted body as the trigger's output, and `{{trigger.field}}` downstream | ✓ `"from Priya: Our production checkout has been down…"` resolved in the log node's config |
| An unknown token, a malformed token, a token whose workflow has no webhook trigger | ✓ 404 for all three, indistinguishable |
| A missing required field / malformed JSON / a non-object body | ✓ 400, and the missing field named in `details.missing` |
| **A rejected call writes nothing** | ✓ 0 run rows after four rejected calls |
| A due schedule fired by the tick | ✓ run created, `trigger: "schedule"`, succeeded |
| **A second tick immediately after** | ✓ fired nothing; exactly **1 run for 1 slot** |
| A due workflow whose schedule trigger was removed | ✓ `cleared`, not run, and its due time nulled |
| **Cloud Scheduler itself** | ✓ `gcloud scheduler jobs run` → Scheduler's own log records **HTTP 200** |

**Driven in a real browser on the deployed app:**

| Checked | Result |
|---|---|
| The palette | ✓ both new triggers appear with their descriptions — no palette code changed |
| The webhook node's inspector | ✓ URL in a readonly field, **Copy URL** button, and the "treat it as a secret" note |
| Copying the URL | ✓ no failure path shown, so `writeText` resolved |
| The schedule node's inspector | ✓ **Next run 26 Sept 2026, 05:48 UTC**, the expression, and the UTC + 15-minute note |
| Console | ✓ 0 errors, 0 warnings |

**Generation, with no generation code changed at all** — the prompt reads the registry, so
registering two nodes was the entire change:

| Prompt | Trigger chosen | Result |
|---|---|---|
| `DEMO.md` Beat 2's **target** prompt | `core.webhook_trigger` | `webhook → llm → agent → branch → log`, first attempt, 3.2 s. `unsupported`: Discord, Sheets |
| The pinned demo prompt | `core.manual_trigger` | unchanged, `unsupported: []` — **no regression** |
| "Every weekday at 9am UTC…" | `core.schedule_trigger`, `0 9 * * 1-5` | next run computed as **Mon 28 Sept**, because the 26th is a Saturday |

**Three things worth recording, found while building:**

1. **An every-minute tick would have blown Neon's free tier.** `DEPLOYMENT.md` pre-specified
   `* * * * *`. Neon's free plan is **100 CU-hours/month** and its 5-minute autosuspend **cannot be
   disabled**, so a minutely tick pins the database awake 24/7 — 720 h × 0.25 CU ≈ **180 CU-hours**,
   nearly double the allowance, and it would have suspended mid-month during a live-demo hackathon.
   Corrected to `*/15` (≈60 CU-hours). The cost is that a cron expression's effective resolution is
   the tick interval, which `DEMO.md` says costs the demo nothing.
2. **Recomputing `scheduleNextAt` on save would double-fire a slot.** A schedule that already fired
   for 09:00 holds *tomorrow* 09:00; recomputing at 08:59 moves it back to today. The rule is to keep
   the stored time whenever the expression has not changed (D42). A test asserts it.
3. **A pure guard must not live next to database code.** `cronSecretMatches` first sat in `tick.ts`,
   which reaches the engine, which reaches `next-auth` — and the test runner cannot load it. Split
   into `src/lib/triggers/secret.ts`. This is D18's lesson arriving a second time: the guard on the
   one endpoint reachable by anyone is exactly what must be assertable in a millisecond.

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

---

## Known Issues

| Issue | Impact | Action |
|---|---|---|
| **Rollback is still untested** | Demo-day risk | Phase 3 created a second revision so it is now *possible*. The attempt was blocked by the session's production-deploy guard. **Run it manually once before demo day:** `gcloud run services update-traffic agentforge --region asia-southeast1 --to-revisions agentforge-00007-xx7=100`, verify, then shift back to `agentforge-00008-l8q` |
| **Google OAuth changes take ~90 s to propagate** | Cost 90 s in Phase 2 | Wait and retry before suspecting a typo |
| **A curl check cannot detect `redirect_uri_mismatch`** | Nearly caused a false "verified" | Only a real browser sign-in proves the OAuth redirect |
| **`min-instances 1` bills continuously** | Cost, after the hackathon | **Set to 0 once judging ends** — and **pause `agentforge-cron` at the same time**, or the tick keeps Neon awake ~240 h/month for nothing |
| **Neon free plan is 100 CU-hours/month and autosuspend cannot be disabled** | Any background polling | The 5-minute autosuspend is fixed on the free plan. Anything that touches the database more often than ~every 6 minutes pins it awake at 0.25 CU — 720 h/month ≈ 180 CU-hours, which is **over the allowance**. This is why the cron tick is `*/15` and not `* * * * *` (D43 sibling; the arithmetic is in `DEPLOYMENT.md`) |
| **The webhook URL is a bearer secret shown in the UI** | Demo day, screen sharing | Anyone holding it can start a run, and a run can spend model quota. The inspector says so. **There is no rotation yet** — re-minting means recreating the workflow. Do not show the webhook node's inspector on a shared screen; the `curl` in `DEMO.md` uses an exported `$WEBHOOK_URL` for exactly this reason |
| **OAuth consent screen is in `Testing`** | Demo day | Only listed test users can sign in. Before the demo: publish the app, or add each judge as a test user (cap 100) |
| **4 moderate `npm audit` findings, one root cause** | None in production | esbuild dev-server issue reachable only through `drizzle-kit`. Dev dependency, absent from the runtime image. **Accepted** |
| **Discord rejects requests with no `User-Agent`** | Phase 9 Discord node | Send an explicit UA |
| **The `agentforge-hackathon-2026` Gemini key is dead** | Was a Phase 6 blocker | Every model answers **402 "prepayment credits are depleted"**: the project has billing enabled, which moves it off the Gemini free tier. `GOOGLE_GENERATIVE_AI_API_KEY` in local `.env` is this dead key. **Use the `agentforge-gemini-free` key instead** (no billing → free tier). Do not enable billing on that project |
| **`models.list` lists models a key cannot call** | Phases 6, 7 | `gemini-2.5-flash` is in the catalogue and answers 404 "no longer available to new users". Never treat the list as the callable set — make a real call (D34) |
| **`gemini-2.0-flash` and `gemini-2.5-flash*` are retired** | Phases 6, 7 | List models, never assume a name. Current default: `gemini-3.5-flash-lite` |
| **Free-tier rate limits are tight** | Phases 6, 7, demo | Back-to-back probes hit 429/503. The adapter retries twice per model then falls down the chain; do not run the verify script in a tight loop. **Hit again in Phase 7:** a generated run's agent step failed once mid-suite and passed on a re-run 20 s later. The verify check now prints the failing step's error so the next occurrence diagnoses itself |
| **No favicon — `/favicon.ico` 404s** | Cosmetic, visible in the browser tab on demo day | Phase 10 (UI/UX pass). `public/` already exists |
| **A port-3000 `next dev` can outlive its session** | A stale server serves old code and the next session's `npm run dev` silently moves to 3001 | Check `lsof -nP -iTCP:3000 -sTCP:LISTEN` before trusting a local check. **Hit again in Phase 5** — a stale `next-server` was still listening |
| **`scripts/verify-api.mjs` leaves rows behind if it is killed** | Stray test workflows in the shared database | Its cleanup runs at the end, so a `ctrl-c` or a timeout skips it. Phase 5 found two orphans that way and deleted them. Check `select count(*) from "workflow"` after an interrupted run |
| **A `pull`-driven `ReadableStream` does not stream under Next** | Would have shipped a stream that opens and then says nothing | The SSE route drives its own loop. Do not "simplify" it back to `pull` (see `src/app/api/workflows/[id]/stream/route.ts`) |
| **Pinned Gemini models return 503 under load** | Demo reliability | **Handled.** Reproduced in Phase 6 (`gemini-3.8-flash`, 503 "experiencing high demand"). The adapter retries twice per model with backoff, then falls down `FALLBACK_MODELS`, and logs the fallback so it is never silent |
| **`gemini-3.5-flash` takes ~8.9 s; flash-lite ~1.2 s** | Demo pacing | Default is `gemini-3.5-flash-lite`. Still warm the model right before the demo |
| **A client component's `toLocaleString()` is a hydration error** | Any date rendered in a `"use client"` file | Server and browser disagree on locale and timezone → React #418. Format with `Intl.DateTimeFormat` pinned to a locale and `timeZone: "UTC"`. A **server** component is fine — the workflow list does it safely |
| **`z.string().min(1)` accepts `"   "`** | Any user-supplied string that costs money downstream | Whitespace counts toward the length. `.trim()` must come **before** `.min(1)`; the other order silently accepts it. A whitespace prompt reached the provider and spent a model call before this was fixed |
| **A generated graph can be valid and still do the wrong thing** | Generation, every phase that adds a node | Validation proves a graph *can* run, never that it does what was asked. The `{{ }}` reference bug passed validation and succeeded at runtime. **Give every non-pass-through node an `outputShape`** (D38), and eyeball a generated branch's `left` when adding nodes |
| **A one-off React #418 on first page load** | Cosmetic; not reproduced | Seen once on revision `agentforge-00012-cs6` alongside an `ERR_NETWORK_CHANGED` from a fetch interrupted mid-hydration. **Not reproducible on `00013-zwt`**: signed-out landing, workflow list, canvas, and the whole generate → run path each read 0 errors, 0 warnings. Re-check with a clean profile before the demo |

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
| **`agentforge` Cloud Run service** | Google Cloud | `asia-southeast1`, revision `agentforge-00014-cpb` | **LIVE 2026-09-26** |
| **`cloud-run-source-deploy` repo** | Artifact Registry | `asia-southeast1` | **EXISTS** |
| OAuth consent screen | Google Cloud | External, app "AgentForge" | **EXISTS** — status **Testing**, 1 test user |
| OAuth 2.0 client | Google Cloud | "AgentForge Web", `733000675212-…ntm7` | **VERIFIED** — 4 redirect entries |
| Neon Postgres project | Neon | `agentforge`, id `super-mountain-39872886` | **EXISTS** — free plan, PostgreSQL 18.6 |
| Neon branch / database / role | Neon | `production` / `neondb` / `neondb_owner` | **VERIFIED** |
| Neon tables | Neon | `user` `account` `session` `verificationToken` `workflow` `run` `run_step` `credential` | **APPLIED** — `0000_dark_paladin`, `0001_smiling_leper_queen`, `0002_wooden_morlocks` |
| Enabled APIs | Google Cloud | `run`, `cloudbuild`, `artifactregistry`, `cloudscheduler`, `apikeys`, `generativelanguage` | **ENABLED** |
| Stored provider credential | Neon | `credential` row, kind `llm.google`, for the demo user | **PRESENT** — the free-tier key, encrypted. Left in place so Phase 7 is not blocked |
| ~~Gemini API key~~ | Google Cloud | "AgentForge Gemini" in `agentforge-hackathon-2026` | **DEAD** — 402, the project has billing so it is off the free tier. Kept, unused |
| **`agentforge-gemini-free` project** | Google Cloud | **no billing**, `generativelanguage` enabled only | **CREATED Phase 6.** Exists solely to hold a free-tier Gemini key. **Never enable billing on it** |
| **Gemini API key (free tier)** | Google Cloud | "AgentForge Gemini Free Tier" in `agentforge-gemini-free`, restricted to `generativelanguage.googleapis.com` | **VERIFIED 2026-09-26** — text generation and function calling both work. Read it with `gcloud services api-keys get-key-string` |
| Discord server / channel / webhook | Discord | "AgentForge" · `#agentforge-demo` | **VERIFIED** |
| **`agentforge-cron` Scheduler job** | Google Cloud | `asia-southeast1`, `*/15 * * * *` UTC, attempt deadline 540 s | **CREATED Phase 8, `ENABLED`** — a real invocation returned HTTP 200. **Pause it when judging ends** |

**One Neon database serves both local and production.** Migrations applied locally are already
live. Phase 3's migration is purely additive, so the older revision still runs against it.

### Local `.env` — populated, gitignored, never committed

All 15 contract variables have values; `.env.example` mirrors `CONTRACT.md`.

### Installed stack — unchanged since Phase 4

`next` 16.3.6 · `react` / `react-dom` 19.3.0 · `next-auth` **5.0.0-beta.32** ·
`@auth/drizzle-adapter` 1.11.3 · `drizzle-orm` 0.45.3 · `drizzle-kit` 0.31.11 ·
`@neondatabase/serverless` 1.1.0 · `zod` 4.6.5 · `@xyflow/react` 12.12.0 ·
`tailwindcss` 4.3.3 · `typescript` 7.0.2

**Phase 8 added no dependencies either.** The cron evaluator is ~200 lines of arithmetic rather than
a cron package with its own opinion about timezones (D43). `ai` and `@ai-sdk/google` remain
**deliberately not installed** (D32). Seven phases in, the dependency list is still the Phase 4 one.
Tests run on Node's built-in runner.

### Local toolchain

`git` 2.54.0 · `gh` 2.98.0 · `node` v26.8.2 · `npm` 11.19.1 · `docker` 29.7.2 ·
`gcloud` 580.0.0 (authenticated, project + region set)

---

## How to verify the system, from a cold session

```bash
npm run typecheck && npm test           # 215 tests, no database, no network, ~750 ms
npm run build                           # Turbopack; one expected process.exit warning

# 126 checks end to end over HTTP. Mints a real session row, drives the API, cleans up.
# Takes ~2 min: one check deliberately waits 21 s for an idle stream to close itself, and the
# agent and generation checks make real model calls.
#
# VERIFY_GEMINI_KEY turns on the key/model/agent/generation checks. Pipe the key in rather than
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

## Notes for Phase 9

- **Phase 8 proved the registry claim twice over.** Registering two trigger nodes was the entire
  change: the palette, the config forms, the validator and the generation prompt all picked them up
  with **no code changed in any of them**. Expect the same for the four integration nodes — if a
  Phase 9 node needs UI work, that is a signal something is wrong with the node, not the UI
- **`unsupported` is the acceptance test.** `DEMO.md` Beat 2's target prompt now builds its webhook
  spine and reports exactly two unsupported parts: `"post urgent ones to Discord"` and
  `"log every one to my Google Sheet"`. **Those two lines disappearing is how Phase 9 is done.**
  Re-run that prompt against the deployed URL at the end of the phase
- **`agentCallable` still defaults to false** (D19). Opt each integration in deliberately — D36 is
  the worked example, and an integration that writes to someone's spreadsheet deserves more thought
  than `core.log` did
- **Give every non-pass-through node an `outputShape`** (D38). A Sheets node's output shape is
  exactly what a generated `{{ }}` reference will need
- **The config form falls back to a raw JSON editor for an array field.** `requiredFields` renders as
  a JSON box — usable, and the documented fallback (`src/lib/canvas/schema.ts`), but if a Phase 9
  node has a list-shaped config worth polishing, that is a Phase 10 item, not a Phase 9 one
- **Discord rejects requests with no `User-Agent`** — already recorded above, and Phase 9's first
  trap
- **A credential per integration goes through the Phase 6 envelope.** `credential` is keyed
  `(ownerId, kind, label)`; nothing in that row may reach a client in plaintext

## Open, but blocking nothing

**Project licence.** Every adopted dependency is permissive. MIT is the obvious default. **Left to
the user deliberately** — it governs whether others may commercialise the work.

---

## Recent Changes

**2026-09-26 — Phase 8 complete, workflows start from a webhook and on a schedule**

- `core.webhook_trigger` and `core.schedule_trigger`, `POST /api/webhook/[token]`,
  `POST /api/cron/tick`, a UTC cron evaluator, and the trigger UI — deployed as
  `agentforge-00014-cpb`, with the `agentforge-cron` Cloud Scheduler job created and verified by a
  real invocation returning HTTP 200
- **Corrected a pre-decided number rather than following it.** `DEPLOYMENT.md` specified an
  every-minute tick; Neon's free plan is 100 CU-hours/month with a 5-minute autosuspend that cannot
  be disabled, so that would have cost ~180 CU-hours and suspended the database mid-month. Now
  `*/15`, with the arithmetic written down
- **The token is on the workflow row, not in the graph** (D41) — otherwise a model or the browser
  would be minting a secret
- **A duplicate tick cannot double-fire** (D42): the schedule is claimed by compare-and-set before
  the run, which is the only atomic primitive `neon-http` offers. Verified on the deployed URL —
  one due slot, two ticks, exactly one run
- **Found that recomputing the due time on save would fire a slot twice**, and that a pure guard
  living beside database code cannot be tested (D18's lesson, a second time)
- **Generation needed no change at all.** Beat 2's target prompt now builds its webhook spine on the
  first attempt; the pinned demo prompt still picks the manual trigger
- Added no dependencies. Seven phases in, the list is still the Phase 4 one

**2026-09-26 — Phase 7 complete, a sentence becomes a workflow in production**

- `POST /api/workflows/generate`, a prompt box on the workflow list, registry-derived prompt,
  auto-layout and hard validation before persistence — deployed as `agentforge-00013-zwt`
- **Generate → validate → persist, in that order.** Nothing in `src/lib/generate/` touches the
  database; a graph that cannot run is never written (D40)
- **Found a valid graph that did the wrong thing** — a `{{steps.x.output}}` reference where
  `.text` was meant, so the branch compared `"[object Object]"` and skipped the urgent path. The
  run *succeeded*, which is why no check caught it and a browser did. Fixed by putting
  `outputShape` on the node definition (D38); afterwards 5/5 wired it correctly and 5/5 also
  switched to the agent node, which is the demo's Beat 7
- **Found a whitespace prompt reaching the provider** — `.trim()` must precede `.min(1)`
- **Found that an impossible request produced a valid, inert workflow silently.** Now reported as
  `unsupported` (D39) and shown in the UI rather than navigating to a workflow that does less
- **Confirmed the registry-derived prompt pays off:** `DEMO.md` Beat 2's prompt already builds its
  agent spine and names Discord and Sheets as unsupported. Phase 9 needs no generation change
- Added no dependencies. Six phases in, the list is still the Phase 4 one

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

**2026-09-26** — Phase 8 complete. Revision `agentforge-00014-cpb` live; the deployed HTTP suite
passed (125 of 126 checks run, 1 skipped, 0 failed), the `agentforge-cron` Cloud Scheduler job fires
the live URL (HTTP 200 in Scheduler's own log), and the trigger UI was driven in a real browser with
0 console errors. No manual actions pending.
