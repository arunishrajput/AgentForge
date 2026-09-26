# PROGRESS.md — AgentForge execution state

**The status board.** A fresh session reads this and immediately knows where things stand. Keep it
concise and operational — prune stale detail rather than appending forever. This is not a diary.

---

## Project Status

**Phase 12 is complete. The project is submittable.** The demo is rehearsed against the deployed
URL *in a browser*, the deployment is verified, **rollback is tested for the first time**, every doc
is reconciled against reality, and the repository has no secret in any tracked file or anywhere in
its history.

**https://agentforge-733000675212.asia-southeast1.run.app** — revision `agentforge-00021-v4s`.

**Phase 12 was supposed to be paperwork. It was not.** `BUILD_PLAN.md` says it "is not a feature
phase", and no feature was added — but rehearsing `DEMO.md` in a real browser, rather than trusting
a script that had only ever been walked by a test harness, **found three beats that could not have
worked as written**, one of them a genuine product bug that both suites passed straight over:

1. **A webhook-triggered run was invisible on the canvas.** The page opened a stream only if it
   happened to *load* mid-run, or when Run was pressed. Beat 5 fires from a terminal while the
   browser sits idle, so the graph never moved. Measured: no status change across 9 s while a run
   completed behind it. **Fixed** — the canvas watches from the moment it opens and re-attaches when
   the server closes a quiet connection, while the tab is visible.
2. **42% of generated workflows carried an agent budget that guaranteed their own failure.**
   `maxIterations: 1` — schema-valid, graph-valid, and fatal the moment the agent reaches for a
   tool. **Measured 5 in 12; now 0 in 12** (D57).
3. **Beat 5 could not have fired the right workflow.** The webhook token is minted per workflow at
   creation (D41) and the demonstrated workflow is generated live, so the pre-exported `$WEBHOOK_URL`
   the script told the presenter to use did not exist yet (D58).

**Three new scripts, and they are the artefacts of this phase** — `scripts/seed-demo.mjs` (puts the
demo account into the state `DEMO.md` assumes and *proves* it), `scripts/demo-fire.mjs` (Beat 5), and
`scripts/demo-payload.mjs` (the demo constants, in one place, plus the payload fitting).

**No regression: 178 checks, 176 passed, 0 failed, 2 skipped** on `agentforge-00021-v4s` — identical
to Phase 11's tally. `npm test` is **297 tests**, 4 of them new and all on the agent-budget guard.
**`smoke.mjs --loop 10`: 10 consecutive clean walks, 0 failures, 123 s**, at the original 3 s gap.

**The pitch video is published** — https://www.youtube.com/watch?v=Suc4RV9LnLs (4:00, narrated deck over real
screenshots of the deployed app, including a run in flight). **The Fallback B recording is still
outstanding** and is a different artefact: nothing here can record a screen, and a narrated deck
cannot stand in for a live product when the network dies on stage. It remains a
`MANUAL ACTION REQUIRED` block in `DEMO.md`, with the exact script to perform.

## Current Phase

**Phase 12 — COMPLETE.** Phases 0–12 are all done and verified.

**Nothing is blocking a submission** except the **hackathon category** (`UNKNOWN — VERIFY` since
Phase 0), recorded in `SUBMISSION.md`. The **demo video is published** (https://www.youtube.com/watch?v=Suc4RV9LnLs).
The **Fallback B screen recording is still outstanding** — a demo-day risk, not a submission
blocker. Stretch phases 13–14 are now unblocked but **`DEMO.md` is the scope contract and nothing
on it needs them.**

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

---

## Deployed State

| Field | Value |
|---|---|
| **Canonical URL** | **`https://agentforge-733000675212.asia-southeast1.run.app`** |
| Legacy URL | `https://agentforge-i5d2u66boa-as.a.run.app` — works, do not publish it |
| Service | `agentforge` on Cloud Run, `asia-southeast1` |
| Revision | **`agentforge-00021-v4s`** — ready, **`latestRevision: True`**, 100% of traffic. Previous good revision: `agentforge-00020-rcr`, which is also the one **rollback was tested against** |
| Scaling | `min-instances 1`, `max-instances 3`, 1 vCPU / 1 GiB, 3600 s timeout, port 8080 |
| Env vars set | `NODE_ENV` `AUTH_URL` `APP_BASE_URL` `DATABASE_URL` `AUTH_SECRET` `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` `ENCRYPTION_KEY` `CRON_SECRET` — **still 9. Phases 9, 10 and 11 added none** (`SMOKE_SPREADSHEET_ID` is a local test variable, never on the service): the Google integration flow reuses `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `APP_BASE_URL`, and every third-party credential is a `credential` row rather than an environment variable. No Gemini key on the service: the product path is the user's own key |
| Database | Neon `super-mountain-39872886` — **8 tables**, migrations `0000` + `0001` + `0002_wooden_morlocks` applied. **Phases 9, 10 and 11 needed no migration**: two new credential kinds are rows in the existing `credential` table, which is what `(ownerId, kind, label)` was for |
| Routes | `/` `/dashboard`→`/workflows` `/workflows` `/workflows/[id]` `/settings` + **17** API routes, unchanged by Phases 10 and 11. Phase 10 added three file-convention routes only: `app/icon.svg` (the favicon), `app/error.tsx` and `app/not-found.tsx` |
| Latency | **Warm**: health ~190 ms India → Singapore, database 7–11 ms. A 6-node demo-path run **3.1–4.8 s** end to end; generation **2.7–3.5 s**. **Cold (Neon suspended, measured 2026-09-26 at 13½ min idle)**: health **1.14 s, of which 739 ms is the database wake** — then 184 ms on the very next request. Cloud Run itself is never cold at `min-instances 1` |
| Last verified | **2026-09-26, after Phase 12** — `scripts/smoke.mjs --loop 10`: **10 consecutive clean walks**, 0 failures, 123 s. `scripts/verify-api.mjs`: **176 passed, 0 failed, 2 skipped** of 178. Plus a **browser** rehearsal of all eight beats at 1920×1080 and 375 px, 0 console errors, and a **tested rollback** |
| Rollback | **TESTED 2026-09-26, finally.** Traffic shifted to `agentforge-00020-rcr` in **~15 s**, health confirmed the older revision was serving, the demo path walked clean on it, then `--to-latest` restored `agentforge-00021-v4s` in ~15 s. The oldest open item in this file is closed |
| Billing | Trial credit account `Billing - AgentForge` is **open and enabled**. Actual spend is **not queryable from the CLI** (no billing export configured) — **eyeball it in the console once before judging** |
| Provider key stored | **Yes, deliberately left in place.** The user's own free-tier key is stored (encrypted) against their account on the deployed app, so no phase is blocked on re-pasting it |
| Registry | **15 nodes**, unchanged by Phases 10, 11 and 12. **The registry claim has now held six times** |
| Fonts | **Geist + Geist Mono, self-hosted by `next/font`**, `latin` subset, variable axis. Two woff2 files in the image; no request leaves the browser for a font and there is no layout shift |

**A redeploy preserves env vars.** Confirmed again on Phase 6's three deploys: `gcloud run deploy
agentforge --source . --region asia-southeast1` with no `--env-vars-file` carried all 9 variables
to each new revision. The file is only needed when a variable changes.

---

## Phase 12 — what was verified, not just written

**The method is the finding.** Every previous phase verified over HTTP: a script minted a session,
drove the API and asserted the JSON. Phase 12 drove a **real browser** against the deployed URL for
the first time since Phase 10, and three of the eight beats did not survive it. Two of the three
were wrong in `DEMO.md` alone; one was wrong in the product.

| Beat | What the browser found |
|---|---|
| 1 | Sound. Signed-out landing page offers **Continue with Google** by that exact name |
| 3 | Sound, but **small** — the six-node spine rendered at **0.39 zoom / 88 px per card** at 1440×900. Fixed two ways, below |
| 4 | **Wrong.** Edited the Discord message; the beat that actually *has* to happen is pasting the spreadsheet id, because the generated Sheets node is born empty by design |
| 5 | **Impossible.** Fired a `$WEBHOOK_URL` exported before a workflow that does not exist until Beat 3 |
| 6 | **Broken in the product.** A webhook-triggered run was invisible on an idle canvas |
| 7 | Sound once 6 was fixed — the branch decision is visible on the canvas and in the log |
| 8 | Sound once 4 was fixed |

**1 — The canvas was not listening.** `watch()` ran on mount only when the page had loaded *mid-run*,
or when Run was pressed. Beat 5 fires from a terminal while the browser sits on the canvas, so
nothing ever opened a stream. Measured before: **no status change across 9 s** while a run completed
behind it. Measured after, with the canvas deliberately left idle for **25 s** first:

```
19s  Form Webhook Succeeded · Summarise Running
20s  Summarise Succeeded · Decide Urgency Running
22s  Decide Urgency Succeeded · Is Urgent? Succeeded → true · Post to Discord Running
22s  Post to Discord Succeeded · Log to Sheet Succeeded
```

**Why no suite caught it**, which is the part worth keeping: `smoke.mjs` opens the SSE stream itself
over HTTP and fires 400 ms later. It proves the **server** streams. It cannot prove the **canvas** is
still listening 25 seconds after it loaded — and 25 seconds is exactly how long Beat 4 takes. A whole
class of bug lives in the gap between "the API works" and "the page works".

**2 — Generated agents were being starved.** Twelve fresh generations of the pinned demo prompt:
**five wrote `maxIterations: 1`**. It passes config validation (the schema allows 1–8) and the graph
is valid, so nothing reported it — then the agent spent its single call reaching for a tool, got
stopped, and failed the run at Beats 7 and 8. The prompt already said `default 5`; the model appears
to read *"keep the workflow as small as the request allows"* as applying to this number too. Fixed
both ways (D57) and re-measured on the deployed revision: **0 of 12**.

**3 — Beat 5 could not have worked** (D58). Now `scripts/demo-fire.mjs`, which resolves the workflow
at fire time and never prints the URL. It also **fits the payload to the graph**: across two
ten-walk runs, **5 of 10 and 3 of 10** generations declared a trigger field (`submission`, once
`content`, once `id`) that Beat 5's fixed JSON literal did not send — a **400**, two beats before the
payoff. The very first post-fix smoke walk hit it and absorbed it live.

**4 — Beat 3 was legible on a laptop and not on a projector.** Two fixes, both measured on the real
generated graph:

| | zoom | node card |
|---|---|---|
| 1440×900, `padding: 0.3` (before) | 0.393 | **88 px** |
| 1920×1080, `padding: 0.3` | 0.608 | 136 px |
| 1920×1080, `padding: 0.18` (now) | **0.669** | **150 px** |

**The larger share is not code.** Presenting at 1920 rather than 1440 is worth 55% on its own,
because the two side panels take a fixed 560 px and everything left over is the graph's. It is now
setup state 12 in `DEMO.md`. The padding change is the remaining 10% and helps at every size. 375 px
still fits all six nodes with **0 px** horizontal overflow at 0.185 zoom, above the 0.15 floor.

**Rollback, tested at last.** The oldest open item in this file. Traffic to `agentforge-00020-rcr` in
**~15 s**, health confirmed the older revision was serving, **the demo path walked clean on it**, then
`--to-latest` restored `agentforge-00021-v4s`. The procedure in `DEPLOYMENT.md` is correct as written.

**Secret scan, working tree and full history.** Every value in `.env` long enough to be a secret,
checked with `git grep -F` across tracked files and `git log --all -S` across every commit:
**no hit**. A shape-based scan (`AIza…`, `postgres://…:…@`, Discord webhook URLs, PEM headers,
`GOCSPX-…`) returns only three deliberately fake test fixtures. `.env` has never been added in any
commit.

**Doc reconciliation found real drift**, not just typos:

- **`ARCHITECTURE.md` still listed the Vercel AI SDK as adopted**, in two places, and `README.md`'s
  stack table and licence list both named it. D32 dropped it at Phase 6 and *claimed the table had
  been corrected*. It had not. Now marked `SUPERSEDED` with the reason kept
- **`DEPLOYMENT.md` said the deployed suite was "33 checks"** — true at Phase 3, and 178 since
- **The Phase 2 `UNKNOWN — VERIFY` on pre-registering the deterministic OAuth redirect URI was
  resolved in `DEPLOYMENT.md` and nowhere else.** `ARCHITECTURE.md` and `BUILD_PLAN.md` both still
  carried it open. Propagated

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
| **D60** | **The demo account's state is produced by a script, not by hand** | Phase 11's sharpest lesson was a demo spreadsheet set up by hand whose id was recorded nowhere and, because the `spreadsheets` scope cannot search Drive, could not be recovered. `scripts/seed-demo.mjs` is the answer: it connects nothing it cannot verify, generates the backup workflow **and actually runs it end to end**, clears the sheet to its header row, and sweeps strays. Idempotent, so it is the pre-demo checklist's step rather than a one-off. It also states plainly what it **cannot** do — a Discord webhook post can only be deleted by its own message id, which the app has no reason to keep — so that gap is a printed instruction rather than a surprise |

## Known Issues

| Issue | Impact | Action |
|---|---|---|
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
| **The agent node fell back and cost ~92 s — measured 2026-09-26, after Phase 12** | Demo pacing, on the headline beat | Two runs of the demo path took **94.6 s and 94.5 s**, against the **3.1–5.7 s** recorded above. The whole cost is one step: `decide_urgency` (`ai.agent`) at **91.9 s**, whose log reads `Model gemini-3.5-flash-lite was unavailable; answered by gemini-3.1-flash-lite`. The adapter behaved as designed — two retries with backoff per model, then down `FALLBACK_MODELS` — but the retry ladder is the latency. **`ai.llm` answered on the same model in 1.4 s in the same run**, so the model is not down generally; it is the tool-calling path that fails over. **Before demoing live, point the stored provider model at one that is actually answering and re-measure**, or Beats 6–8 will not fit inside 3:00 |
| **Free-tier rate limits are tight** | Phases 6, 7, demo | Back-to-back probes hit 429/503. The adapter retries twice per model then falls down the chain; do not run the verify script in a tight loop. **Hit again in Phase 7:** a generated run's agent step failed once mid-suite and passed on a re-run 20 s later. The verify check now prints the failing step's error so the next occurrence diagnoses itself |
| ~~No favicon — `/favicon.ico` 404s~~ | Was cosmetic, visible in the browser tab | **Handled in Phase 10.** `src/app/icon.svg` is Next's app-icon convention; the framework emits the `<link rel="icon">` and serves it at `/icon.svg`, verified 200 on the deployed URL. `/favicon.ico` still 404s and that is fine — nothing requests it once the link tag is present |
| **A port-3000 `next dev` can outlive its session** | A stale server serves old code and the next session's `npm run dev` silently moves to 3001 | Check `lsof -nP -iTCP:3000 -sTCP:LISTEN` before trusting a local check. **Hit again in Phase 5** — a stale `next-server` was still listening |
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
| **Beat 3 is small on a 1440 px screen** | Demo legibility, the headline beat | The two side panels take a fixed 560 px, so the pane is 880 px for a ~1730 px graph → 0.39 zoom, an 88 px node card. **Present at 1920×1080**: 0.67 zoom, 150 px. `fitView` padding went 0.3 → 0.18 for the rest. Not a bug, a geometry constraint — the fix is the setup, not the code |
| **A one-off React #418 on first page load** | Cosmetic; not reproduced | Seen once on revision `agentforge-00012-cs6` alongside an `ERR_NETWORK_CHANGED` from a fetch interrupted mid-hydration. **Not reproducible on `00013-zwt`**: signed-out landing, workflow list, canvas, and the whole generate → run path each read 0 errors, 0 warnings. Re-check with a clean profile before the demo |
| **Two attempts means two timeouts** | A wedged external host, worst case | A retried call gets a fresh timeout, so a Sheets append is at worst `20 s × 2 + 0.5 s backoff ≈ 40.5 s` and a Discord post ≈ 30.5 s. Both sit inside the engine's 120 s deadline **with an agent node's own budget alongside them**, which is the number to re-check if either timeout is ever raised. Bounded, measured, accepted (D54) |
| **`scripts/smoke.mjs` writes to real services** | The demo channel and the demo sheet | One Discord message and one Sheet row **per walk** — `--loop 10` leaves ten of each. That is the point (it proves Beat 8) but they must be cleared before demoing. The script says so when it finishes. Phase 11's ten walks filled `Sheet1!A4:C4` through `A14:C14` |
| **`verify-api.mjs` now reports 2 skips, not 1** | Reading the tally | **Not a regression.** The second check only runs when Google is *dis*connected, and Google is connected — which is the state the demo needs. 178 checks, 176 passed, 0 failed, 2 skipped. A tally that moves without a failure is a state difference; check *which* skip before suspecting code |
| ~~The demo spreadsheet's id is recorded nowhere~~ | Was: a cold session could not find the sheet Beat 8 depends on | **Fixed 2026-09-26.** The `spreadsheets` scope cannot search Drive, so the old sheet was genuinely unrecoverable. A new "AgentForge Demo Log" was created through the app's own stored credential and **its id is in `DEMO.md`'s seed table** |

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

**None outstanding. M1–M8 are all done and verified with live calls.** Nothing in Phase 11
needed one, and Phase 12 needs one only if a judge has to be added as an OAuth test user.

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
| Google Cloud project | Google Cloud | `agentforge-hackathon-2026`, number **`733000675212`** | **EXISTS**, billing active ($300 / 90-day trial) |
| **`agentforge` Cloud Run service** | Google Cloud | `asia-southeast1`, revision `agentforge-00018-x7q` | **LIVE 2026-09-26** |
| **`cloud-run-source-deploy` repo** | Artifact Registry | `asia-southeast1` | **EXISTS** |
| OAuth consent screen | Google Cloud | External, app "AgentForge" | **EXISTS** — status **Testing**, 1 test user |
| OAuth 2.0 client | Google Cloud | "AgentForge Web", `733000675212-…ntm7` | **VERIFIED** — 4 redirect entries |
| Neon Postgres project | Neon | `agentforge`, id `super-mountain-39872886` | **EXISTS** — free plan, PostgreSQL 18.6 |
| Neon branch / database / role | Neon | `production` / `neondb` / `neondb_owner` | **VERIFIED** |
| Neon tables | Neon | `user` `account` `session` `verificationToken` `workflow` `run` `run_step` `credential` | **APPLIED** — `0000_dark_paladin`, `0001_smiling_leper_queen`, `0002_wooden_morlocks` |
| Enabled APIs | Google Cloud | `run`, `cloudbuild`, `artifactregistry`, `cloudscheduler`, `apikeys`, `generativelanguage`, **`gmail`, `sheets`** | **ENABLED** — the last two added 2026-09-26, without which `integration.gmail` and `integration.sheets` fail at runtime however the OAuth consent went |
| Stored provider credential | Neon | `credential` row, kind `llm.google`, for the demo user | **PRESENT** — the free-tier key, encrypted. Left in place so no phase is blocked |
| Stored Discord credential | Neon | `credential` row, kind `integration.discord` | **PRESENT 2026-09-26** — webhook "AgentForge", channel `1553084744504316034`, verified against Discord before storage. **Note it goes absent whenever `scripts/verify-api.mjs` is run with `VERIFY_DISCORD_WEBHOOK`**: the script stores it, posts with it, then deletes it, because deletion is one of the paths under test. Re-add it from `DISCORD_WEBHOOK_URL` in local `.env` — a `PUT /api/integrations/discord` is enough |
| Stored Google credential | Neon | `credential` row, kind `google.oauth` | **PRESENT 2026-09-26** — `arunishrajput7@gmail.com`, scopes include `spreadsheets` and `gmail.send`, so `canAppendSheets` and `canSendMail` are both true. Consent was completed by the user in a browser; that step authenticates as them and cannot be scripted |
| ~~Gemini API key~~ | Google Cloud | "AgentForge Gemini" in `agentforge-hackathon-2026` | **DEAD** — 402, the project has billing so it is off the free tier. Kept, unused |
| **`agentforge-gemini-free` project** | Google Cloud | **no billing**, `generativelanguage` enabled only | **CREATED Phase 6.** Exists solely to hold a free-tier Gemini key. **Never enable billing on it** |
| **Gemini API key (free tier)** | Google Cloud | "AgentForge Gemini Free Tier" in `agentforge-gemini-free`, restricted to `generativelanguage.googleapis.com` | **VERIFIED 2026-09-26** — text generation and function calling both work. Read it with `gcloud services api-keys get-key-string` |
| Discord server / channel / webhook | Discord | "AgentForge" · `#agentforge-demo` | **VERIFIED** |
| **"AgentForge Demo Log" spreadsheet** | Google Sheets | id **`1iz8vjkGNvPQ1q1vpDvaWnQZ6648BNYHYauVXHHY2IBo`**, owned by `arunishrajput7@gmail.com`, tab `Sheet1`, headers `Received · From · Summary · Urgency` | **CREATED Phase 11** — through the app's own stored Google credential, because the previous sheet's id was recorded nowhere and the `spreadsheets` scope cannot search Drive. **This is `DEMO.md` Beat 8's second payoff — do not delete it** |
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
npm run typecheck && npm test           # 297 tests, no database, no network, ~1.5 s
npm run build                           # Turbopack; one expected process.exit warning

# 178 checks end to end over HTTP. Mints a real session row, drives the API, cleans up.
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

**Phases 0–12 are complete. There is no next phase that has to happen.** 13 and 14 are stretch, and
`DEMO.md` — the scope contract — needs nothing from either. The highest-value work left is not code:
record the **Fallback B** screen video and fill in the one remaining blank in `SUBMISSION.md` (the
hackathon category). The pitch video is done and published.

**If you do touch the code:**

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
- **The registry claim has held six times.** Phase 12 added no node, no palette entry, no config
  form, no dependency, no environment variable and no migration
- **The design system is `src/app/globals.css` and nothing else.** Tokens in `@theme`, component
  classes as `@utility`. No component library, deliberately
- **`prefers-reduced-motion` is handled in two places and both must stay**: the CSS block in
  `globals.css`, and `src/lib/canvas/motion.ts` for React Flow's JavaScript `fitView`
- **Two client components format dates**, and both must keep formatting in UTC with a fixed locale
  or React throws hydration error #418: `provider-form.tsx` and `integrations-form.tsx`
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

**Project licence.** Every adopted dependency is permissive. MIT is the obvious default. **Left to
the user deliberately** — it governs whether others may commercialise the work.

---

## Recent Changes

**2026-09-26 — pitch video published, submission copy reshaped**

- **Pitch video live:** https://www.youtube.com/watch?v=Suc4RV9LnLs — 4:00, 1920×1080, narrated deck.
  Source assets are in `presentation/`, which is **gitignored** (14 MB video, and the slides show
  the demo account): `AgentForge-Pitch.mp4`, `AgentForge-Presentation.pdf`, `slides/*.png`,
  `deck.html` (re-renderable), `narration.json`/`.txt`, `youtube.md` (title, description, chapters)
- **Voiceover is Amazon Polly**, generative engine, voice `Matthew`, `us-east-1`, ~4.1k characters
  (~$0.12). Audio normalised to −14 LUFS / −1.5 dBTP for YouTube
- **Slides 4 and 5 are real screenshots of the deployed app**, captured through a minted session
  (revoked afterwards), not mockups. Slide 5 is a genuine run in flight
- **`SUBMISSION.md` restructured** around Devpost's seven `About the project` headings, between
  paste markers, with a `Supporting reference` section for the side fields
- **Team-size and timebox phrasing removed** from every outward- and inward-facing file at the
  user's request, rewritten rather than deleted so the constraints still explain the decisions they
  drove. `CLAUDE.md` *Core constraints* now reads "a fixed hackathon timebox"
- **Only remaining submission blank: the hackathon category.** Fallback B is still un-recorded

**2026-09-26 — Phase 12 complete, the project is submittable**

- **Rehearsed `DEMO.md` in a real browser for the first time, and three of the eight beats did not
  survive it.** Deployed as `agentforge-00021-v4s`
- **Beat 6 was broken in the product**: a webhook-triggered run was **invisible** on an idle canvas,
  because the page only opened a stream if it happened to load mid-run or the user pressed Run.
  Measured: no status change across 9 s while a run completed behind it. **178 API checks and ten
  clean smoke walks all passed over it** — `smoke.mjs` opens its own stream and fires 400 ms later,
  so it proves the server streams, never that the canvas is still listening 25 s after it loaded (D59)
- **Beat 5 was impossible as written**: it fired a `$WEBHOOK_URL` exported before the demo, for a
  workflow that is generated *during* the demo and mints its token at creation (D41). The failure
  mode is the nastiest available — **201, a real run on the wrong workflow, and a dead canvas**.
  Now `scripts/demo-fire.mjs` (D58)
- **Beat 4 edited the wrong node**: the generated Sheets node is born empty by design, so pasting the
  spreadsheet id is the beat that *has* to happen. Rehearsing it produced the predicted failure
  verbatim — *"This node has no spreadsheet yet."*
- **42% of generated workflows carried an agent budget that guaranteed their own failure.**
  `maxIterations: 1` — schema-valid, graph-valid, fatal the moment the agent calls a tool. **5 of 12
  before, 0 of 12 after** (D57). Fixed in the prompt *and* guaranteed in `assembleGraph`
- **Generated trigger fields vary run to run**: 8 of 20 walks declared a field a fixed payload would
  not send, which is a 400 before the run starts. The payload is now fitted to the graph (D58)
- **Rollback tested at last** — the oldest open item in this file. ~15 s each way, demo path clean on
  the rolled-back revision
- **Beat 3's legibility is a geometry problem, not a code one**: 0.39 zoom / 88 px node at 1440,
  0.67 / 150 px at 1920. **Presenting at 1920 is worth 55% on its own**; `fitView` padding 0.3 → 0.18
  is the other 10%
- **Doc reconciliation found real drift**: `ARCHITECTURE.md` and `README.md` still claimed the Vercel
  AI SDK was adopted (dropped at Phase 6, D32 wrongly said the table was fixed); `DEPLOYMENT.md` said
  "33 checks" when it has been 178 since Phase 3; a resolved `UNKNOWN — VERIFY` had been recorded in
  one doc and left open in two others
- **Secret scan clean** across the working tree *and* every commit in history
- New: `scripts/seed-demo.mjs`, `scripts/demo-fire.mjs`, `scripts/demo-payload.mjs`, `SUBMISSION.md`.
  **No node, no dependency, no environment variable, no migration** — the registry claim holds a
  sixth time

**2026-09-26 — Phase 11 complete, the demo path is hardened and walks clean ten times**

- `scripts/smoke.mjs`: the eight beats of `DEMO.md`, in order, against a running instance in ~10 s,
  naming the beat that broke. **`--loop 10` → 10 consecutive clean walks, 0 failures**, deployed as
  `agentforge-00019-4xw`
- **The integrations had no retry at all** — only the provider adapter did, which made it look as
  though the product was covered. The Discord post, the Sheets append and the Google token refresh
  were each one-shot, so a single 429 or 503 ended Beat 8 with an empty channel and an empty sheet.
  Now one retry, **opt-in per call site** (D54)
- **The hard part was what *not* to retry.** A POST that creates may have taken effect before the
  answer was lost, so 500 is excluded (ambiguous), transport failures are retried only on genuinely
  idempotent calls, and a spent timeout or a cancelled run never is. **Eight of the thirteen new
  tests assert the negative half**
- **A `Retry-After` over 5 s is honoured by not retrying** (D55): Discord can ask for 30 s, and
  sleeping through a demo is worse than a failed step that names the rate limit
- **A failed run said nothing at the top of the canvas.** `api.runWorkflow` resolves happily for a
  run whose status is `failed` — the request succeeded, the run did not — leaving a red node card as
  the only signal. On a shared screen that is a demo that looks like it worked. The header now reads
  *"Append to Google Sheet failed: …"*
- **The demo spreadsheet's id was unrecoverable.** The Phase 9 proof run was cleaned up and the
  `spreadsheets` scope cannot search Drive, so a cold session could not find the sheet Beat 8 needs.
  A new one was created through the app's own credential and **its id is now in `DEMO.md`**
- **`DEMO.md` Beat 1 named a button that does not exist** — "Sign in with Google" versus the actual
  "Continue with Google". The smoke script asserts the button by name, which is why it was caught
- **Cold start measured rather than assumed**: 1.14 s at 13½ min idle, 739 ms of it Neon waking,
  184 ms on the next request. Cloud Run's own cold start left untested on purpose — reaching it
  means changing the demo's configuration
- **Walk 5 of the ten is the most useful data point**: two generation attempts and a 12.2 s run
  where the other nine took ~3.4 s. The free-tier rate limit, absorbed live by the retry chain,
  without a failure
- Added no dependencies. **Ten phases in, the list is still the Phase 4 one**, and Phase 11 added no
  environment variable, no migration and no node

**2026-09-26 — Phase 10 complete, the product looks built on purpose**

- A design system in `src/app/globals.css`: surfaces, hairlines, text, accent, four status tones and
  five category accents as `oklch()` tokens; a type scale; elevation; two easings and three
  durations; eleven `@utility` component classes. **Geist and Geist Mono self-hosted by `next/font`.**
  Deployed as `agentforge-00017-5k2`
- **113 arbitrary font sizes and ~60 raw colour classes swept onto tokens at identical values**, so
  the sweep was provably invisible and the vocabulary is now singular (D49)
- **Motion where it is watched**: a staggered entry for a generated graph, a breathing ring on the
  running node, a status chip that replays its pop on every transition, an indeterminate sweep and a
  live elapsed clock for the generation wait — and **the run's path left lit on the canvas**, with the
  untaken branch edge deliberately dark (D50). All opacity and transform; `prefers-reduced-motion`
  collapses every one of them, including React Flow's JavaScript `fitView`
- **375 px works.** The canvas's two side panels become drawers below `lg`, opened from the header or
  by tapping a node, closed by Escape or the backdrop, and `visibility: hidden` keeps a closed drawer
  out of the tab order. 0 px horizontal overflow on every page
- **Accessibility**: one `:focus-visible` ring for the whole product, a working skip link to `#main`
  on every page, `color-scheme: dark` so native controls stop rendering as light widgets, and
  **contrast computed from the tokens in a test** rather than judged by eye (D52)
- **The deployed suite is the regression test and it is unchanged**: 178 checks, 177 passed, 0 failed
- **Caught and reverted a real regression of my own**: `loading.tsx` turned the signed-out redirect on
  `/workflows` and `/workflows/[id]` into a **200** carrying `NEXT_REDIRECT` in the stream. No data
  leaked, but the status at an auth boundary is not worth a navigation skeleton (D51). The suite
  caught it; looking at the pages would not have

**2026-09-26 — Phase 9 complete, workflows reach real outside services**

- `integration.http`, `integration.discord`, `integration.sheets`, `integration.gmail`, an outbound
  guard, a Google incremental-consent flow, the credential UI and 52 new deployed checks — deployed
  as `agentforge-00015-vwg`. **177 of 178 checks passed, 0 failed**
- **Beat 2's acceptance test met.** Phase 8 predicted the two `unsupported` lines would disappear
  when the nodes existed, and they did: **3/3 first attempt, `unsupported: []`**, building
  `webhook → llm → agent → branch → Discord + Sheets`. The model wires the sheet off *both* branch
  outputs unprompted, because the request said "log every one"
- **The registry claim held a third time** — six nodes across two phases and still no palette code,
  no config form, no validator rule, no second tool list. Verified visually: an `INTEGRATIONS` group
  appeared in the palette on its own, and the Discord inspector renders `Content` as a required
  textarea entirely from the schema
- **Corrected the generation prompt, which named the now-possible as impossible.** It hardcoded
  "sending email, posting to a chat service, writing to a spreadsheet" as its examples of
  `unsupported`. The catalogue needed no change, exactly as predicted — but that *sentence* would
  have kept steering the model away from nodes sitting in the list above it. **Prose dates like code
  and nothing type-checks it**
- **Made `integration.http` safe to hand a model** (D45) rather than assuming it was. Nine blocked
  targets refused through the real engine on the deployed container, including the GCP metadata
  server by address, by name, and by scheme — a token for this service's own identity was one plain
  GET away
- **Closed Gmail to the agent** (D44), a deliberate, recorded deviation from `BUILD_PLAN.md`'s
  wording: a model choosing both recipient and body from webhook text is the one effect here that
  leaves the user's account and cannot be recalled
- **Found that a throwing `preprocess` escapes `safeParse`** on zod 4.6.5, which would have turned a
  malformed agent argument into an unhandled 500 instead of a correctable tool error
- **Found that `min(1)` on `spreadsheetId` would break Beat 2** — the prompt names no spreadsheet, so
  the model must invent an id or fail the whole generation. Empty, with a node that says what it
  needs, is the honest third answer
- **Corrected a Known Issue that had gone wrong:** "publish the app, or add test users" is no longer
  a choice. Phase 9's scopes are *sensitive*, so publishing now requires Google verification. Test
  users is the only path
- Added no dependencies. **Eight phases in, the list is still the Phase 4 one**, and Phase 9 added no
  environment variable and no migration either

**2026-09-26 — Phases 6, 7 and 8, compressed**

Three phases whose findings are all carried forward in the decisions table and *Known Issues*, so
only the shape is kept here. **Phase 6** built the provider adapter, credential encryption, the
settings UI and the LLM and agent nodes (D32–D36: `fetch` over the `ai` SDK, Gemini 3's
`thoughtSignature` breaking a normalising adapter on the second tool call, `models.list` listing
models a key cannot call, the dead billing-enabled key). **Phase 7** turned a sentence into a
persisted workflow — generate, validate, *then* insert — and found a graph that was valid and still
did the wrong thing, fixed by putting `outputShape` on the node definition (D38–D40). **Phase 8**
added the webhook and schedule triggers, a UTC cron evaluator written rather than depended on, and
a compare-and-set claim so a duplicate tick cannot double-fire (D41–D43); it also corrected
`DEPLOYMENT.md`'s every-minute tick to `*/15` after doing the Neon compute-hour arithmetic.

Full detail is in git history at `56dce47`, `59f7adb` and `26ed481`.

## Last Updated

**2026-09-26** — **Pitch video published** (https://www.youtube.com/watch?v=Suc4RV9LnLs) and
`SUBMISSION.md` reshaped to Devpost's seven headings. Only the **hackathon category** is still blank;
**Fallback B is still un-recorded**. New known issue: the **agent node fell back and cost ~92 s** on
two consecutive runs — see *Known Issues*, and fix it before demoing live.

**2026-09-26** — **Phase 12 complete. Phases 0–12 all done; the project is submittable.** Revision
`agentforge-00021-v4s` live. **10 consecutive clean walks** of the full `DEMO.md` path (123 s),
`verify-api.mjs` at **176 passed / 0 failed / 2 skipped of 178**, `npm test` at **297 passing**, a
**browser** rehearsal of all eight beats at 1920×1080 and 375 px with 0 console errors, and a
**tested rollback** — the oldest open item in this file, now closed.

Rehearsing the demo in a browser found **three beats that could not have worked as written**, one of
them a product bug that both suites passed over: a webhook-triggered run was invisible on an idle
canvas (D59). Also fixed: generated agents starved at `maxIterations: 1` in 42% of generations
(D57), and Beat 5 firing a webhook URL that did not exist yet (D58).

**No phase from 0 to 12 has an outstanding completion criterion.** Nothing is blocking submission
except the **hackathon category**, recorded in `SUBMISSION.md`. The **demo video is published**
(https://www.youtube.com/watch?v=Suc4RV9LnLs). The **Fallback B recording** is still outstanding
(`DEMO.md` → *What Phase 12 could not rehearse*) — a demo-day risk, not a submission blocker.
Stretch phases 13–14 are unblocked but `DEMO.md` needs nothing from them.
