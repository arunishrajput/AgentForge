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
13 → 25, defined in `BUILD_PLAN.md`. **Nothing in Chapter 2 has been started.**

**The live system still works and must keep working:**
**https://agentforge-733000675212.asia-southeast1.run.app** — revision `agentforge-00021-v4s`.

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
budget. **Phase 13 must measure the real headroom before Phases 19 and 22 design against it.**
`BUILD_PLAN.md` → *The zero-cost problem* holds the per-area resolution.

---

## Current Phase

## ▶ NEXT: PHASE 14 — Toybox: the design system

**Phase 13 is COMPLETE (2026-09-26).** Full definition of Phase 14 in `BUILD_PLAN.md`.
Read `DESIGN.md`'s brief there before starting — Phase 14 is the phase that creates that file.

**What Phase 13 leaves you, and what it means for Phase 14:**

- **CI exists and must stay green.** `.github/workflows/ci.yml` — lint, typecheck, test with
  coverage thresholds, build. It ran in **53 s** on PR #1. **A red pipeline is a stop-work
  condition.** `npm run check` is the same four gates locally
- **Coverage thresholds fail the build**: 85% lines, 88% branches, 76% functions. Currently
  87.19 / 90.46 / 78.10. **A UI rewrite will move these** — if Phase 14 adds many untested
  `.tsx` files the function threshold is the one that will bite first. Lower it deliberately
  and say so, rather than deleting the gate
- **`oxlint` is the linter** (A15), configured in `.oxlintrc.json`. Every suppression in the
  codebase is inline and carries a written reason. **Three of them point at Phases 15 and 16**
  as the place to retire them — search `oxlint-disable-next-line`
- **The agent latency issue is closed.** A 6-node run is now **4.2–7.5 s** against 94.5 s

**Do not start Phase 15 in the same session.** One phase per session still holds; `/clear` between.

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
| **14** — Toybox design system | **NOT STARTED ← next** |
| **15** — UI rebuild I: the shell | NOT STARTED |
| **16** — UI rebuild II: the canvas | NOT STARTED |
| **17** — durable execution | NOT STARTED |
| **18** — workflow versioning and diffing | NOT STARTED |
| **19** — workspaces and membership | NOT STARTED |
| **20** — roles, permissions and sharing | NOT STARTED |
| **21** — credential vault and rotation | NOT STARTED |
| **22** — observability and run analytics | NOT STARTED |
| **23** — node catalogue and templates | NOT STARTED |
| **24** — documentation and open-source readiness | NOT STARTED |
| **25** — launch polish | NOT STARTED |


---

## Deployed State

| Field | Value |
|---|---|
| **Canonical URL** | **`https://agentforge-733000675212.asia-southeast1.run.app`** |
| Legacy URL | `https://agentforge-i5d2u66boa-as.a.run.app` — works, do not publish it |
| Service | `agentforge` on Cloud Run, `asia-southeast1` |
| Revision | **`agentforge-00023-xf4`** — ready, **`latestRevision: True`**, 100% of traffic (Phase 13). Previous good revisions: `agentforge-00022-zw6`, `agentforge-00021-v4s`. Rollback was tested against `agentforge-00020-rcr` |
| Scaling | `min-instances 1`, `max-instances 3`, 1 vCPU / 1 GiB, 3600 s timeout, port 8080 |
| Env vars set | `NODE_ENV` `AUTH_URL` `APP_BASE_URL` `DATABASE_URL` `AUTH_SECRET` `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` `ENCRYPTION_KEY` `CRON_SECRET` — **still 9. Phases 9, 10 and 11 added none** (`SMOKE_SPREADSHEET_ID` is a local test variable, never on the service): the Google integration flow reuses `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `APP_BASE_URL`, and every third-party credential is a `credential` row rather than an environment variable. No Gemini key on the service: the product path is the user's own key |
| Database | Neon `super-mountain-39872886` — **8 tables**, migrations `0000` + `0001` + `0002_wooden_morlocks` applied. **Phases 9, 10 and 11 needed no migration**: two new credential kinds are rows in the existing `credential` table, which is what `(ownerId, kind, label)` was for |
| Routes | `/` `/dashboard`→`/workflows` `/workflows` `/workflows/[id]` `/settings` + **17** API routes, unchanged by Phases 10 and 11. Phase 10 added three file-convention routes only: `app/icon.svg` (the favicon), `app/error.tsx` and `app/not-found.tsx`. **Phase 13 added no route**: model health is an additive field on the existing `GET /api/settings/provider` |
| Latency | **Warm**: health ~190 ms India → Singapore, database 7–11 ms. A 6-node demo-path run **4.2–7.5 s** end to end across five consecutive walks (Phase 13; it was 3.1–4.8 s in Chapter 1 when the model answered first time, and **94.5 s** when it did not — that second case is what Phase 13 removed). Generation 2.7–3.5 s. **Cold (Neon suspended)**: health **1.14 s, of which 739 ms is the database wake** — re-measured 2026-09-26 at 917 ms for a first query, 103 ms on the next. Cloud Run itself is never cold at `min-instances 1` |
| Last verified | **2026-09-26, after Phase 13** on revision `agentforge-00023-xf4`. `scripts/verify-api.mjs`: **ALL CHECKS PASSED, 169 passed / 0 failed / 4 skipped**. `scripts/smoke.mjs --loop 5`: **5 consecutive clean walks**, 0 failures, runs of 4.2 / 4.5 / 6.0 / 7.5 / 4.6 s. `npm test`: **346 passing**. Coverage **87.19% lines / 90.46% branches / 78.10% functions**. **CI green on PR #1 (53 s) and on `main`** |
| Rollback | **TESTED 2026-09-26, finally.** Traffic shifted to `agentforge-00020-rcr` in **~15 s**, health confirmed the older revision was serving, the demo path walked clean on it, then `--to-latest` restored `agentforge-00021-v4s` in ~15 s. The oldest open item in this file is closed |
| Billing | Trial credit account `Billing - AgentForge` is **open and enabled**. Actual spend is **not queryable from the CLI** (no billing export configured) — **eyeball it in the console once before judging** |
| Provider key stored | **Yes**, and the model was **rotated in Phase 13** from `gemini-3.5-flash-lite` to **`gemini-3-flash-preview`** — the only model healthy on both the text and tool-calling paths in all three probe passes. Confirmed persisted in Neon. Re-probe with `npm run probe:models` |
| Registry | **15 nodes**, unchanged by Phases 10–13. **The registry claim has now held seven times** |
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
| **A model's health flips on a timescale of MINUTES, and the text and tool-calling paths fail independently** | Every model choice, every fallback chain | The single most useful thing Phase 13 learned. Three probe passes minutes apart: `gemini-3.6-flash` went healthy → healthy → 503; `gemini-3.5-flash-lite` went healthy → timeout → timeout; `gemini-3.1-flash-lite` timed out on tool-calling twice and then worked. **Only `gemini-3-flash-preview` was healthy on both paths in all three.** Never conclude a model is good from one call, and never conclude a model that answers prose can call tools. `npm run probe:models` checks both paths and is the only honest way to pick a chain |
| **The default model is a `-preview` model** | If Google retires it | Accepted deliberately in Phase 13: it was the only model measurably reliable on the tool-calling path, and the alternative was keeping a default that timed out on 2 of 3 probes. **The mitigations are already in place** — a 404 opens its breaker immediately and the chain falls through to `gemini-3.6-flash`, and `npm run probe:models` re-derives the ranking in about a minute. Re-probe if agent steps start failing |
| **Coverage thresholds will bite the UI rewrite** | Phases 14–16 | The gate is 85% lines / 88% branches / **76% functions**, against 87.19 / 90.46 / **78.10** today. Functions has the least slack, and a design-system phase adds many small components. **Lower the threshold deliberately and say so in the commit**, or add tests — do not delete the gate. It is in `package.json` → `test:coverage` |
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
| **Free-tier rate limits are tight, and they are PER MODEL** | Phases 6, 7, 13, and any suite that loops | Measured in Phase 13: **`gemini-3-flash-preview` allows 20 requests per minute** on the free tier (`generate_content_free_tier_requests`). Running `verify-api.mjs` three times back to back exhausted it. **This is survivable by design** — the fallback chain spans three different models and therefore three quota buckets, and the breaker moves off a throttled one — but a *deliberate single-model probe* cannot fall back, so choosing a model in Settings can be throttled. That now returns **409 `conflict`, "your key was not changed"**, not a 400 claiming the key cannot use the model. Pro and omni models return 429 immediately on this key: their free-tier quota is effectively zero |
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

**One outstanding: M9.** M1–M8 are all done and verified with live calls.

### M9 — read Neon's consumed CU-hours — **OPEN, blocks nothing today**

**Why.** Neon's Free plan is **100 CU-hours per project per month** and the `*/15` cron tick
commits about **61** of them, leaving ~39 for real use. That ~39 is the budget Phases 19
(workspaces) and 22 (analytics) must design against — and the *balance* has never been read. The
*budget* is verified (`DEPLOYMENT.md` → *Free-tier headroom*); the balance is not.

**Why it is not automated.** Neon exposes consumption only through its API or console, never
through the SQL connection. `neonctl` is installed but unauthenticated on this machine, and
`neonctl auth` needs a browser — it was attempted in Phase 13 and timed out.

**Location.** <https://console.neon.tech> → project `agentforge` (`super-mountain-39872886`)
→ **Usage** (or **Billing → Usage**).

**Steps.**
1. Sign in to <https://console.neon.tech>.
2. Open the `agentforge` project.
3. Read **Compute hours** (CU-hours) used in the current billing period, and the period's end date.
4. Either paste those two numbers back, **or** run `neonctl auth` in this terminal so a future
   session can read it without you.

**Expected result.** A figure well under 100. If it is above ~70 with a week still to run, say so
— that is an escalation, not a note, and Phase 19 must be redesigned around it.

**Verification, once `neonctl auth` has been done:**

```bash
neonctl consumption projects --project-id super-mountain-39872886
```

**Resume by:** pasting the CU-hours figure, or saying "neonctl is authenticated".

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
| **GitHub Actions CI** | GitHub | `.github/workflows/ci.yml`, job `check` | **CREATED Phase 13** — lint · typecheck · test+coverage · build, on every push and PR to `main`. Green in **53 s** on PR #1. Free for a public repository |
| Google Cloud project | Google Cloud | `agentforge-hackathon-2026`, number **`733000675212`** | **EXISTS**, billing active ($300 / 90-day trial) |
| **`agentforge` Cloud Run service** | Google Cloud | `asia-southeast1`, revision **`agentforge-00023-xf4`** | **LIVE 2026-09-26** (this row was stale at `00018-x7q`; corrected in Phase 13) |
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
| **`agentforge-cron` Scheduler job** | Google Cloud | `asia-southeast1`, `*/15 * * * *` UTC, attempt deadline 540 s | **`ENABLED`, re-confirmed Phase 13.** It commits ~61 of Neon's 100 CU-hours/month — the arithmetic is verified in `DEPLOYMENT.md` → *Free-tier headroom*. Do not shorten the tick |
| Cloud Tasks API | Google Cloud | `cloudtasks.googleapis.com` | **NOT ENABLED.** Phase 17 enables it. Free tier verified: 1,000,000 ops/month per billing account |
| Secret Manager API | Google Cloud | `secretmanager.googleapis.com` | **NOT ENABLED.** Phase 21 enables it. Free tier verified: 6 versions, 10,000 access ops, **only 3 rotation notifications**/month |

**One Neon database serves both local and production.** Migrations applied locally are already
live. Phase 3's migration is purely additive, so the older revision still runs against it.

### Local `.env` — populated, gitignored, never committed

All 15 contract variables have values; `.env.example` mirrors `CONTRACT.md`.

### Installed stack — unchanged since Phase 4

`next` 16.3.6 · `react` / `react-dom` 19.3.0 · `next-auth` **5.0.0-beta.32** ·
`@auth/drizzle-adapter` 1.11.3 · `drizzle-orm` 0.45.3 · `drizzle-kit` 0.31.11 ·
`@neondatabase/serverless` 1.1.0 · `zod` 4.6.5 · `@xyflow/react` 12.12.0 ·
`tailwindcss` 4.3.3 · `typescript` 7.0.2

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

`npm run check` is what CI runs, so a green local run means a green pipeline. `probe:models` needs a
key: `GEMINI_API_KEY=$(gcloud services api-keys get-key-string <key> --format='value(keyString)')` —
the resource path is in the script's own header.

Then the deployed checks:

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

**Start Phase 14.** It is defined in `BUILD_PLAN.md` and summarised under *Current Phase* above.
Chapter 1 is closed; the hackathon items that used to live here (the Fallback B recording, the deck
re-cut) are **no longer part of this project's work** and have been dropped.

**New in Phase 13, and load-bearing from here on:**

- **`npm run check` before you commit** — lint, typecheck, test with coverage. It is the same four
  gates CI runs, and it takes ~15 s. **CI is mandatory and a red pipeline is a stop-work condition**
- **`npm run probe:models` before blaming the model layer.** It makes real calls on both the text
  and the tool-calling path and ranks what actually answers. A model that answers prose may still
  hang on tool calls — that was the whole of the 91.9 s incident
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

**Project licence.** Every adopted dependency is permissive. MIT is the obvious default. Still the
user's call — it governs whether others may commercialise the work. **Now scheduled: Phase 24
applies it.** An open-source showpiece without a licence is not open source, so this stops being
optional at that point.

**The old demo artefacts.** `DEMO.md` and `SUBMISSION.md` are archived, not deleted — `DEMO.md`
still documents a path known to work end to end, which is a useful smoke reference.

---

## Recent Changes

**2026-09-26 — Phase 13 complete. Chapter 2 has started, and the project has CI for the first time**

- **The 91.9 s agent step is closed, with numbers on both sides.** `scripts/probe-models.mjs`
  reproduced it rather than reasoning about it: `gemini-3.5-flash-lite` answers *text* and **times
  out on tool-calling**, which is exactly why `ai.llm` took 1.4 s and `ai.agent` took 91.9 s in the
  same Phase 12 run. Three passes over 15 models found **only `gemini-3-flash-preview` healthy on
  both paths every time**. Fixed in the adapter (A14): a timed-out attempt is never retried on the
  same model, a 12 s per-attempt cap sits inside a 30 s chain ceiling, and a per-model circuit
  breaker reorders the chain. **Before: 94.6 / 94.5 s. After: 4.2 / 4.5 / 6.0 / 7.5 / 4.6 s**
- **The breaker reorders, it never removes.** The worst case of a wrong health reading is a
  suboptimal order, never a refusal to call a model that would have worked
- **Model health is surfaced** on `GET /api/settings/provider` instead of one buried warning line.
  Verified live: it caught `gemini-3.6-flash` degraded on a real 503 and a 404 opening a breaker
  immediately
- **Four free-tier figures replaced with measured ones**, and two of them changed later phases.
  Cloud Tasks bills per 32 KB chunk, so **Phase 17 must enqueue a run id, not a payload**. Secret
  Manager allows **only 3 free rotation notifications a month**, so **Phase 21 must not subscribe to
  them** — that would be this project's first non-zero line. Cloud Logging measured at **6.34 MB /
  30 days, 0.0118%** of its allowance. Neon remains the binding constraint at ~39 spare CU-hours
- **CI exists**: lint · typecheck · test+coverage · build, green in 53 s on PR #1 and on `main`
- **`oxlint` over ESLint** (A15) — **2 packages against 305**, measured, for the same reason this
  project has no `ai` SDK and no test framework
- **297 → 346 tests**, with coverage thresholds that fail the build (87.19 / 90.46 / 78.10)
- **Three real defects the work surfaced**, none of them the one the phase was scoped around:
  zero-width spaces hidden in `cron.ts` comments; JSX built inside a `try/catch` in the workflow
  page, which looked guarded and was not; and a rate-limited model probe reported as *"this key
  cannot use this model"*, which sends a user to change a setting that was correct
- **Model rotated** in the stored credential: `gemini-3.5-flash-lite` → `gemini-3-flash-preview`
- **One `UNKNOWN — VERIFY` remains**: Neon CU-hours *consumed*. See *Manual Actions Pending* → M9


**2026-09-26 — SUBMITTED, and the rubric turned out to be a different one**

- **Submitted:** https://devpost.com/software/agentforge-kz832x. Verified on the public page rather than assumed:
  seven story headings, video embedded in the gallery, repo and live links both present and working
- **`UNKNOWN — VERIFY` on the category/rubric, carried since Phase 0, is RESOLVED.** One track, no
  sub-categories, top prize **"Impact Champion"**. **Round 1 marks the PPT and pitch video**, not the
  deployed software: problem validation, affected users, innovative and feasible solution, real-world
  impact. Every phase to date assumed "best working product". Recorded in `CLAUDE.md` → *Context*
- **New known issue:** the deck is mis-aimed for that rubric — asserts rather than validates the
  problem, names no user segment, and spends its impact slide on engineering proof

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
- At the time of this entry the category was still blank; it was **resolved later the same day** —
  see the entry above. Fallback B is still un-recorded

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


Older entries pruned — **4 earlier Chapter 1 entries** are in git history (`git log --oneline`). This file is a status board, not a diary.

## Last Updated

**2026-09-26** — **Phase 13 complete.** Revision `agentforge-00023-xf4` live and verified:
`verify-api.mjs` **ALL CHECKS PASSED (169 / 0 failed / 4 skipped)**, `smoke.mjs --loop 5` **5
consecutive clean walks**, `npm test` **346 passing**, coverage **87.19 / 90.46 / 78.10**, and
**CI green on PR #1 and on `main`** — the first CI this project has ever had.

The headline defect carried out of Chapter 1 is **closed with a measured before/after**: a 6-node
run including the agent node went from **94.5 s to a 7.5 s worst case** over five walks. The cause
was not what the log said. `ai.agent` and `ai.llm` were using the same model, and that model
answered text in 1.4 s while its *tool-calling* path timed out — a distinction no amount of reading
the code would have produced, and one `scripts/probe-models.mjs` now checks on demand.

Every free-tier figure Chapter 2 was designed on is now a measured number with a date, and two of
them changed later phases' designs. **One is still open** — Neon's *consumed* CU-hours, M9, which
needs a browser sign-in.


**2026-09-26** — **SUBMITTED** (https://devpost.com/software/agentforge-kz832x).
**The judging rubric is resolved and it is not the one this project was built against**: Round 1
marks the PPT and pitch video on problem validation, affected users, feasibility and real-world
impact — not the running product. The deck needs a re-cut to match. See *Known Issues*.

**2026-09-26** — **Pitch video published** (https://www.youtube.com/watch?v=Suc4RV9LnLs) and
`SUBMISSION.md` reshaped to Devpost's seven headings. **Fallback B is still un-recorded.** New known
issue: the **agent node fell back and cost ~92 s** on two consecutive runs — see *Known Issues*, and
fix it before demoing live.

**2026-09-26** — **Phase 12 complete. Phases 0–12 all done; the project is submittable.** Revision
`agentforge-00021-v4s` live. **10 consecutive clean walks** of the full `DEMO.md` path (123 s),
`verify-api.mjs` at **176 passed / 0 failed / 2 skipped of 178**, `npm test` at **297 passing**, a
**browser** rehearsal of all eight beats at 1920×1080 and 375 px with 0 console errors, and a
**tested rollback** — the oldest open item in this file, now closed.

Rehearsing the demo in a browser found **three beats that could not have worked as written**, one of
them a product bug that both suites passed over: a webhook-triggered run was invisible on an idle
canvas (D59). Also fixed: generated agents starved at `maxIterations: 1` in 42% of generations
(D57), and Beat 5 firing a webhook URL that did not exist yet (D58).

**No phase from 0 to 12 has an outstanding completion criterion, and the project is submitted**
(https://devpost.com/software/agentforge-kz832x). The **demo video is published**
(https://www.youtube.com/watch?v=Suc4RV9LnLs) and embedded on the Devpost page. What is open is no
longer submission plumbing but **fit to the Round 1 rubric** (see *Known Issues*), plus the
**Fallback B recording** (`DEMO.md` → *What Phase 12 could not rehearse*) — a demo-day risk.
Chapter 2 (phases 13–25) is now the work — see *Project Status* at the top of this file.
