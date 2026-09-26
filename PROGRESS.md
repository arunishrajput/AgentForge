# PROGRESS.md — AgentForge execution state

**The status board.** A fresh session reads this and immediately knows where things stand. Keep it
concise and operational — prune stale detail rather than appending forever. This is not a diary.

---

## Project Status

**Phase 10 is built, deployed and verified.** The product has a design system now rather than
legibility-only styling: one dark theme in tokens, Geist and Geist Mono self-hosted, a named type
scale, motion on the two beats that matter, drawers instead of broken columns at 375 px, a keyboard
focus ring, and error and 404 surfaces that read like sentences.

**https://agentforge-733000675212.asia-southeast1.run.app** — revision `agentforge-00018-x7q`.

**No functional regression: 178 checks defined, 177 passed, 0 failed, 1 skipped** against the
deployed URL — the same suite and the same result as Phase 9, re-run after the UI pass. `npm test`
is **276 tests**, 9 of them new: the contrast of every text token, computed from `globals.css`
itself.

**Phase 9's last criterion is closed (2026-09-26). All four integrations are now proven against the
real service from the deployed app** — `integration.http` and `integration.discord` in Phase 9, and
`integration.sheets` and `integration.gmail` today: a real row appended at `Sheet1!A2:D2` with
`{{trigger.ref}}` and `{{trigger.note}}` resolved into cells, and a real message sent with Gmail id
`1a0dcf7f7df25cc8`. **There is no longer an outstanding completion criterion anywhere in Phases 0–10.**

Getting there took M8 (the user's console click) and surfaced **two defects that were unreachable
while the flow died at `redirect_uri_mismatch`**, both now fixed in `agentforge-00018-x7q`:
every OAuth redirect was resolved against `request.url`, which inside the container is the **bind
address**, so a *successful* connection landed the browser on `http://0.0.0.0:8080/settings` and the
CSRF state cookie shipped without `Secure` (D53); and the **`gmail` and `sheets` APIs were never
enabled on the GCP project**, which no amount of correct OAuth can substitute for.

**`DEMO.md` Beat 2's target prompt is the demo prompt**, pinned in Phase 9: measured 3/3 valid on the
first attempt with `unsupported: []`, building `webhook → llm → agent → branch → Discord + Sheets`.

## Current Phase

**Phase 11 — Hardening: demo-path reliability, critical-path tests, error surfaces** (not started) —
`READY TO START`. Nothing in Phase 11 depends on M8 either.

**Nothing is blocking Phase 11 or Phase 12.** M8 is done, all three credentials are connected, and
`DEMO.md` Beat 8's payoffs are both proven on the deployed system.

**All three credentials are connected** as of 2026-09-26: Gemini key, Discord webhook ("AgentForge",
channel `1553084744504316034`) and Google (`arunishrajput7@gmail.com`, both scopes). Note the Discord
row **goes absent whenever `scripts/verify-api.mjs` runs with `VERIFY_DISCORD_WEBHOOK`** — the script
stores, posts, then deletes, because deletion is a path under test. Re-add it with a
`PUT /api/integrations/discord` from `DISCORD_WEBHOOK_URL` in local `.env`.

**One tidy-up left for demo day:** the verification row sits at **row 2 of the demo sheet**, marked
`DELETE ME` in column D. `DEMO.md`'s setup checklist already says to clear prior demo rows.

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

---

## Deployed State

| Field | Value |
|---|---|
| **Canonical URL** | **`https://agentforge-733000675212.asia-southeast1.run.app`** |
| Legacy URL | `https://agentforge-i5d2u66boa-as.a.run.app` — works, do not publish it |
| Service | `agentforge` on Cloud Run, `asia-southeast1` |
| Revision | **`agentforge-00018-x7q`** — ready, 100% of traffic. Previous good revision: `agentforge-00017-5k2` |
| Scaling | `min-instances 1`, `max-instances 3`, 1 vCPU / 1 GiB, 3600 s timeout, port 8080 |
| Env vars set | `NODE_ENV` `AUTH_URL` `APP_BASE_URL` `DATABASE_URL` `AUTH_SECRET` `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` `ENCRYPTION_KEY` `CRON_SECRET` — **still 9. Phases 9 and 10 added none**: the Google integration flow reuses `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `APP_BASE_URL`, and every third-party credential is a `credential` row rather than an environment variable. No Gemini key on the service: the product path is the user's own key |
| Database | Neon `super-mountain-39872886` — **8 tables**, migrations `0000` + `0001` + `0002_wooden_morlocks` applied. **Phases 9 and 10 needed no migration**: two new credential kinds are rows in the existing `credential` table, which is what `(ownerId, kind, label)` was for |
| Routes | `/` `/dashboard`→`/workflows` `/workflows` `/workflows/[id]` `/settings` + **17** API routes, unchanged by Phase 10. Phase 10 added three file-convention routes only: `app/icon.svg` (the favicon), `app/error.tsx` and `app/not-found.tsx` |
| Warm latency | health ~190 ms India → Singapore. A 7-node run with a 1.5 s delay and an agent node that calls a tool: **3.6 s end to end**. **Generation: 2.3–3.2 s** for a 5-node workflow, measured again in Phase 8 |
| Last verified | **2026-09-26, after Phase 10** — `VERIFY_GEMINI_KEY=… VERIFY_DISCORD_WEBHOOK=… node --env-file=.env scripts/verify-api.mjs <url>`, **177 passed, 0 failed, 1 skipped** of 178 (the skip is storing a key, because one is already stored and the API is write-only), plus the canvas run and both panel drawers driven in a real browser at 1440 px and 375 px |
| Provider key stored | **Yes, deliberately left in place.** The user's own free-tier key is stored (encrypted) against their account on the deployed app, so no phase is blocked on re-pasting it |
| Registry | **15 nodes**, unchanged by Phase 10 |
| Fonts | **Geist + Geist Mono, self-hosted by `next/font`**, `latin` subset, variable axis. Two woff2 files in the image; no request leaves the browser for a font and there is no layout shift |

**A redeploy preserves env vars.** Confirmed again on Phase 6's three deploys: `gcloud run deploy
agentforge --source . --region asia-southeast1` with no `--env-vars-file` carried all 9 variables
to each new revision. The file is only needed when a variable changes.

---

## Phase 10 — what was verified, not just written

`npm test` — **276 tests**, no database, no network, ~880 ms. Phase 10 added 9, all in
`src/app/tokens.test.ts`: it parses the `oklch()` tokens out of `globals.css`, converts them to
linear sRGB and asserts WCAG contrast for every text-on-surface pair the product actually uses.
That exists because the failure mode is silent — darkening `--color-muted` to calm a panel down is
an easy change to make and an impossible one to spot by eye.

`scripts/verify-api.mjs` against the deployed URL — **178 checks, 177 passed, 0 failed, 1 skipped.**
Identical to Phase 9. **Phase 10 added no check and changed no behaviour the suite measures**, which
is the point: it is the regression test for a UI pass.

**Driven in a real browser on the deployed app, at 1440 px and at 375 px:**

| Checked | Result |
|---|---|
| A real run on the deployed canvas | ✓ 578 ms, six steps, every status chip correct |
| **The path the run took, left lit on the graph** | ✓ the four traversed edges accent-coloured, **the untaken branch edge still grey** and its node badged `Skipped` — `DEMO.md` Beat 7 is now visible on the canvas, not only in the log |
| Console on the canvas, signed in, after a run | ✓ **0 errors, 0 warnings** |
| The canvas at 375 px | ✓ header wraps to two rows, palette and inspector become drawers, minimap hidden, **0 px horizontal overflow** |
| Tapping a node at 375 px | ✓ opens the inspector drawer with the registry-generated form — otherwise the tap appears to do nothing (`DEMO.md` Beat 4 on a phone) |
| A closed drawer and the keyboard | ✓ `visibility: hidden`, so it is out of the tab order rather than an invisible tab trap |
| Escape, and the backdrop | ✓ both close whichever drawer is open |
| `prefers-reduced-motion: reduce` | ✓ every animation collapses to 1 ms, the duration tokens to 0 s, nodes render fully opaque, and `tweenMs()` reports 0 for React Flow's JS-driven `fitView` |
| The skip link, on first Tab | ✓ slides in, fully styled, and jumps to `#main` — which every page and the canvas now carry |
| `/workflows/<a uuid that does not exist>` | ✓ the new 404 page, not a stack trace |
| Fonts | ✓ Geist resolved as the computed body font, 13 `@font-face` rules served from our own origin |
| `/icon.svg` | ✓ 200 — the browser tab has a favicon for the first time |

**Four things worth recording, found while building:**

1. **A `loading.tsx` over a page whose first act is an auth redirect turns a 307 into a 200.** Both
   `/workflows` and `/workflows/[id]` started answering **200 to a signed-out request** instead of
   redirecting, and the deployed suite caught it. The cause is streaming: `loading.tsx` wraps the
   segment in Suspense, the shell flushes with the status line already sent, and the later
   `redirect()` can only arrive as a `NEXT_REDIRECT` instruction inside the stream. **No data
   leaked** — the body was the skeleton plus that instruction, and a browser still redirects — but
   the HTTP status at an auth boundary changed, which is not a thing to trade for polish.
   **Both files were removed** (D51). The alternative, an auth guard in a segment `layout.tsx`,
   costs a second database session lookup on the two hottest pages, and the skeleton was worth
   roughly 200 ms of a client-side navigation.
2. **A chip cannot be a translucent wash of its own colour and still clear AA.** `bg-<tone>/15` under
   text of the same tone measured **3.34:1 for red** on a node card — the tint lifts the background
   faster than it lifts the text. No usable alpha fixes it: even 8 % only reaches 4.13. The status
   pill is the recessed neutral instead, with the tone as text and a hairline ring, which measures
   7.4:1 and up. The rejected measurement is asserted in the test so a later phase that prefers the
   softer look has to answer for the number.
3. **`not-sr-only` sets `padding: 0`**, so the classic `sr-only focus:not-sr-only` skip link came
   back with the `btn` padding stripped — focusable, styled, unreadable. It is parked above the
   viewport with a transform instead.
4. **`line-clamp-2` and `block` both set `display`, and `block` won.** Every node description in the
   palette rendered in full, making the palette seven screens tall and pushing `INTEGRATIONS` far
   below the fold. Pre-existing, invisible until the palette was looked at properly. `line-clamp-2`
   already implies a block box; the extra class was the bug.

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

## Known Issues

| Issue | Impact | Action |
|---|---|---|
| **Rollback is still untested** | Demo-day risk | Phase 3 created a second revision so it is now *possible*. The attempt was blocked by the session's production-deploy guard. **Run it manually once before demo day:** `gcloud run services update-traffic agentforge --region asia-southeast1 --to-revisions agentforge-00007-xx7=100`, verify, then shift back to `agentforge-00008-l8q` |
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

**None outstanding. M1–M8 are all done and verified with live calls.**

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
npm run typecheck && npm test           # 267 tests, no database, no network, ~860 ms
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

## Notes for Phase 11

- **The registry claim held a fourth time, through the phase most likely to break it.** Phase 10's
  job *was* the UI and it still added **no** node-type name to the palette, the inspector or the
  config form. `CATEGORY_STYLE` maps a *category* to a colour token and falls back to the category's
  own name for a group it has never met; `STATUS_STYLE` maps the engine's four step outcomes. Nothing
  else in the UI knows a node exists. Keep it that way
- **The design system is `src/app/globals.css` and nothing else.** Tokens in `@theme`, component
  classes as `@utility` (`btn`, `btn-primary`, `btn-quiet`, `btn-ghost`, `btn-danger`, `field`,
  `card`, `chip`, `eyebrow`, `sweep-bar`, `hero-glow`, `pad-safe`). A new panel should name those, not
  copy a class list. There is no component library and no `components/ui` — deliberately
- **The type scale is Tailwind's, plus three steps**: `text-3xs` (10 px), `text-2xs` (11 px) and
  `text-ui` (13 px, every form control and button). `xs`, `sm` and up are Tailwind's own and
  unchanged, so existing `text-xs`/`text-sm` are stable
- **React Flow's stylesheet is imported in `globals.css`, not in `editor.tsx`.** The cascade order is
  load-bearing: Tailwind preflight → React Flow layout → our overrides. Imported from the component it
  could land either side of ours and the symptom is unreadable canvas controls
- **`prefers-reduced-motion` is handled in two places and both must stay.** The blanket CSS block in
  `globals.css`, and `src/lib/canvas/motion.ts` for React Flow's `fitView`, which tweens in
  JavaScript where a media query cannot reach it
- **One config field still renders as a raw JSON box:** `integration.sheets.values`, because it is an
  array (`src/lib/canvas/schema.ts`'s documented fallback). Usable as-is, and `DEMO.md` does not open
  it — Beat 4 opens the Discord node, whose fields are a textarea and an input
- **`integration.http.url` renders as a textarea**, deliberately: capped at 2000 characters because a
  URL can carry a long query string, and `describeFields` sends anything over 200 to a text box.
  Asserted in `src/lib/nodes/integration/integration.test.ts`
- **Two client components format dates**, and both must keep formatting in UTC with a fixed locale or
  React throws hydration error #418: `provider-form.tsx` and `integrations-form.tsx`
- **Read the console on the deployed page, not just locally.** Phase 6's hydration error, Phase 8's
  clean run and Phase 10's clean canvas were all found that way
- **Verify the production build the way the container runs it**, not with `next start`. `next start`
  warns and then 404s CSS chunks because `output: standalone` moves them. The faithful local check is
  the Dockerfile's own shape:
  ```bash
  npm run build && cp -r .next/static .next/standalone/.next/static && cp -r public .next/standalone/
  (cd .next/standalone && PORT=3100 HOSTNAME=127.0.0.1 node --env-file=../../.env server.js)
  ```
  Never run `next dev` against a `.next` a production build wrote — they share the directory and the
  dev server serves the build's manifest, which 404s every asset

## Open, but blocking nothing

**Project licence.** Every adopted dependency is permissive. MIT is the obvious default. **Left to
the user deliberately** — it governs whether others may commercialise the work.

---

## Recent Changes

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

Provider adapter, credential encryption, settings UI, LLM node and agent node. The findings that
still matter are all carried in the decisions table (D32–D36) and Known Issues: `fetch` over the
`ai` SDK, Gemini 3's `thoughtSignature` breaking a normalising adapter on the second tool call,
Gemini rejecting the JSON Schema Zod emits, `models.list` listing models a key cannot call, and the
dead billing-enabled key. Full detail is in git history at `56dce47`.

## Last Updated

**2026-09-26** — Phase 10 complete **and Phase 9 fully closed out**. Revision `agentforge-00018-x7q`
live. All four integrations are now proven against the real service from the deployed app: HTTP,
Discord, **Sheets** (`Sheet1!A2:D2`) and **Gmail** (id `1a0dcf7f7df25cc8`). M8 is done and all three
credentials are connected. `npm test` is 280 passing. **No phase from 0 to 10 has an outstanding
completion criterion.** Next: **Phase 11 — hardening**.
