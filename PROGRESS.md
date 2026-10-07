# PROGRESS.md — AgentForge execution state

**The status board.** A fresh session reads this and immediately knows where things stand. Keep it
concise and operational — prune stale detail rather than appending forever. This is not a diary.

**Rebuilt on 2026-10-06, when Chapter 3 opened.** The previous board had grown to ~1,800 lines.
Nothing was deleted:

| Moved | Where it lives now |
|---|---|
| The binding decisions, D6–D109, plus Chapter 3's D110 onward | **[`DECISIONS.md`](./DECISIONS.md)** — the live register |
| Everything else — the Phase 25 narrative, per-phase evidence, closed Known Issues with their stories, the M1–M12 blocks, the long verification narrative, *Recent Changes* | [`archive/progress-chapters-1-2.md`](./archive/progress-chapters-1-2.md), verbatim |
| The phase definitions for 0–25 | [`archive/build-plan-chapters-1-2.md`](./archive/build-plan-chapters-1-2.md), verbatim |

---

## Project Status

**CHAPTER 3 IS OPEN. PHASES 26–28 ARE COMPLETE (2026-10-07); PHASE 29 IS NEXT.** The product has
three themes — Light (the default), Toybox Night and System — and every screen works in both.

| Chapter | Phases | State |
|---|---|---|
| **1** — the hackathon MVP | 0–12 | **COMPLETE.** Submitted 2026-09-26 (<https://devpost.com/software/agentforge-kz832x>). Closed, never reopened |
| **2** — the open-source product | 13–25 | **COMPLETE**, 2026-10-01. Durable runs, versioning, workspaces, roles and sharing, a credential vault, observability, 30 nodes, two LLM providers, docs, an a11y and security audit |
| **3** — a product people use every day | **26–42** | **OPEN — planned 2026-10-06. Phases 26–28 complete; 29 next.** `BUILD_PLAN.md` is the scope contract |

**Chapter 3, in one line:** themes (Light, Dark, System), a canvas that edits like a serious tool,
an AI copilot that edits and repairs workflows, workflows that can handle errors, wait, ask a person
and call each other, and the daily-use basics — tags, run history, import/export and an API.

**The live system must keep working:** **https://agentforge-733000675212.asia-southeast1.run.app** —
revision `agentforge-00066-wvx`.
Launch demo video: <https://www.youtube.com/watch?v=3txmpCPEWd4>.

### The binding decisions, restated for Chapter 3

| Decision | Value |
|---|---|
| **Budget** | **Still zero**, now inside Always Free on a **paid** billing account with a ₹100/month budget alert (D113, after the trial closed), and build artefacts held by cleanup rules (D120). Escalate anything billed beyond cents |
| **Visual direction** | **Toybox — bright, playful, light-first.** Light is the default and the reference. **Dark ("Toybox Night") and System are opt-in themes since Phase 27** (D110, D121–D123), held to the same gates per theme. **Since Phase 28 every screen is verified in both**, and every new UI is built in both |
| **Restored scope** | Teams, versioning, observability and the vault are **built** (Chapter 2) |
| **Purpose** | **Open-source showpiece**, and now a product a stranger can use daily |
| **Neon** | The binding free tier: **never add a new reason to wake an idle database** — no polling, no frequent timers. `BUILD_PLAN.md` → *The zero-cost problem, Chapter 3 edition* |
| **Registry** | **No new registry node before Phase 34** (D112) — the generation prompt has one node of headroom left |

---

## Current Phase

## ▶ PHASE 29 — Canvas I — editing ergonomics — NOT STARTED

**Next.** `BUILD_PLAN.md` → *Phase 29* is the definition: undo/redo, copy/paste/duplicate, multi-select,
auto-arrange, shortcuts with a `?` dialog, and find-on-canvas. Every UI it adds is built and verified in
**both themes**, and run through `scripts/contrast-audit.browser.js` in each (D126).

**Phase 28 closed on 2026-10-07** — `agentforge-00066-wvx` (part 1 was `00065-d2r`), verified on the
deployed service and in a real browser in Light and Night. Its evidence is in `BUILD_PLAN.md` →
*Phase 28* → *Status*.

---

## Chapter 3 — phases 26–42

| Phase | Status |
|---|---|
| **26** — Timers: schedules that fire, at zero idle cost | **COMPLETE**, 2026-10-06 — `agentforge-00063-zt5` |
| **27** — Themes I: Toybox Night tokens, gates, switching | **COMPLETE**, 2026-10-07 — `agentforge-00064-jmm` |
| **28** — Themes II: every screen in both themes | **COMPLETE**, 2026-10-07 — `agentforge-00066-wvx` |
| **29** — Canvas I: editing ergonomics | NOT STARTED ← next |
| **30** — Canvas II: sticky notes and disabled nodes | NOT STARTED |
| **31** — Canvas III: pinned data and partial runs | NOT STARTED |
| **32** — Library: organising workflows | NOT STARTED |
| **33** — Runs: history and recovery | NOT STARTED |
| **34** — Generator at scale: catalogue selection and evals | NOT STARTED |
| **35** — Copilot I: edit a workflow by conversation | NOT STARTED |
| **36** — Copilot II: explain and repair | NOT STARTED |
| **37** — Workflows I: when things go wrong | NOT STARTED |
| **38** — Workflows II: human in the loop | NOT STARTED |
| **39** — Workflows III: sub-workflows, workflow tools, merge | NOT STARTED |
| **40** — Workflows IV: forms and webhook responses | NOT STARTED |
| **41** — Public API: personal access tokens | NOT STARTED |
| **42** — Chapter 3 launch polish | NOT STARTED |

**Phases 0–25: all COMPLETE.** The per-phase evidence (revisions, check counts, what each found) is
in `archive/progress-chapters-1-2.md` → *Completed Phases*.

---

## Deployed State

| Field | Value |
|---|---|
| **Canonical URL** | **`https://agentforge-733000675212.asia-southeast1.run.app`** — the deterministic URL (D10). The legacy `https://agentforge-i5d2u66boa-as.a.run.app` works; do not publish it |
| Service | `agentforge` on Cloud Run, `asia-southeast1`, project `agentforge-hackathon-2026` (`733000675212`) |
| **Revision** | **`agentforge-00066-wvx`**, 100% of traffic — Phase 28 (2026-10-07). **Rollback targets are only the revisions behind the five kept images (D120)**: `00065-d2r` (Phase 28 part 1), `00064-jmm` (Phase 27), `00063-zt5` (Phase 26), `00062-kxm`. Rollback tested (`update-traffic --to-revisions <rev>=100`, ~15 s) |
| Scaling | **`min-instances 0`**, `max-instances 3`, 1 vCPU / 1 GiB, 3600 s timeout, port 8080. **Cold start 6.38 s** (measured), 0.58–0.76 s warm |
| Env vars | 12: `NODE_ENV` `AUTH_URL` `APP_BASE_URL` `DATABASE_URL` `AUTH_SECRET` `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` `ENCRYPTION_KEY` `CRON_SECRET` `TASKS_QUEUE` `TASKS_LOCATION` `ROOT_KEY_SECRET`. A plain redeploy inherits them; add with `--update-env-vars` (merges), never `--env-vars-file` unless replacing the set (D11). `TASKS_PROJECT`, `GCP_ACCESS_TOKEN`, `GCP_PROJECT` and `DATABASE_URL_UNPOOLED` are deliberately **not** set on the service |
| Database | Neon `super-mountain-39872886`, **13 tables**, migrations **`0000`–`0012`** applied (`0012` by Phase 26 — additive; `rollback_0012.sql` is safe only once no run is `waiting`), ~10 MB of 0.5 GB. A second database `agentforge_demo` with a `SELECT`-only role serves the Postgres node's verification (23C). One Neon database serves local and production |
| Scheduler | **`agentforge-cron` is `ENABLED` on `0 4 * * *` UTC** — the daily safety sweep (Phase 26, D114). Schedules fire from per-slot Cloud Tasks timers on `POST /api/cron/fire`, not from the cron. Its first run, 2026-10-06, caught up the three slots overdue since 2026-10-02 |
| Queue | `agentforge-runs` Cloud Tasks queue, `RUNNING`, `maxAttempts 5`, `maxConcurrentDispatches 3` |
| Routes | Pages `/` `/workflows` `/workflows/[id]` `/templates` `/analytics` `/settings` `/design` `/invite/[token]` `/s/[token]` (+ `/dashboard` → `/workflows`), and **45 API route files** under `src/app/api` (Phase 26 added `POST /api/cron/fire`; an earlier "41" counted something else). Unauthenticated: **ten routes and two pages** — `verify-security.mjs`'s table has **11** entries because it also lists the invitation `accept` route, which needs a session |
| Provider keys stored | `llm.google` on `gemini-3-flash-preview`, `llm.groq` on `openai/gpt-oss-120b`. `workspace.llmProvider` is `NULL` (resolves to Google). **No model key on the service** — the product path is the user's own key |
| **Registry** | **30 nodes.** The generation prompt is **25,042 characters against a 26,000 ceiling** (`src/lib/nodes/registry.test.ts`; Phase 26's `core.delay` rework added 166) — **still one node of headroom** (D112; Phase 34 fixes it). A node owes five things, all asserted by `registry.test.ts`: a `PUBLISHABLE` entry, a `ROTATION_RULES` entry if it carries a credential kind, a `model` output field only if it is a model call, a generator catalogue entry (automatic), and `docs` |
| Tests | **1089 tests** on Node's built-in runner, plus **20** script tests; coverage **88.60 / 91.12 / 80.98** (lines / branches / functions) against thresholds 85 / 88 / 76. `npm run check` = lint · typecheck · test+coverage · test:scripts · docs:check; CI adds `build`. **Every colour gate runs once per theme** (`tokens.test.ts`), `utilities.test.ts` asks Tailwind's compiler about every colour class in `src/` (D124) and refuses `outline-none` and a dimmed fill label (D126). **The rendered half of contrast is `scripts/contrast-audit.browser.js`**, run in a browser in both themes (D126) |
| Latency | Warm health ~190 ms (India → Singapore), DB 7–11 ms. Neon wake ~0.7–1.1 s. Generation 2.7–3.5 s. Analytics 17–27 ms of DB time per page view |
| Last verified | **2026-10-07, on `00066-wvx`, acting as the owner**: `verify-security` 68, `verify-a11y` 92, `verify-api` 405 passed / 3 skipped, `verify-templates` 47, `verify-postgres` 65, `verify-providers` 55, `verify-vault` 62, `verify-observability` 68 / 1 structural skip, `verify-integrations` 60 / **2 skipped** (Notion, Airtable), `verify-timers` 34, `verify-durable all` — **0 failed**. **`smoke.mjs` failed 2 walks of 3 and passed the third CLEAN** — a generated Sheets cell resolving to `null` (*Known Issues*). In a real browser: every page in **Light and Night**, the contrast audit clean on all of them, a workflow generated, edited and run in Night, and the share page signed out in both |
| Billing | **`Billing - AgentForge` (`017EB5-0D8A5E-F212CC`) is a paid account since M13** (2026-10-06; the 90-day trial had closed). Budget **"AgentForge zero"**, ₹100/month, e-mail alerts at 50 / 90 / 100 % (D113). Artifact Registry keeps the newest 5 images and the source bucket deletes uploads after 7 days (D120) — measured 896 MB and 687 MB before the first prune. Spend is not queryable from the CLI |
| Fonts | Geist + Geist Mono, self-hosted by `next/font` — no font request, CLS 0 |

---

## Decisions

**Binding, and in [`DECISIONS.md`](./DECISIONS.md).** D6–D109 from Chapters 1–2, and **D110–D113 from
Chapter 3**: three themes with Light the default (D110), the ladder's ordering rule (D111), no new
registry node before Phase 34 (D112), zero cost held on a paid account inside Always Free (D113),
Phase 26's timers, waits and active switch (D114–D119), build-artefact retention (D120), and Phase
27's ink roles and Night palette (D121), its cream structure (D122), the theme mechanism (D123) and
the dead-utility gate (D124), and Phase 28's per-theme fill hover (D125), the fill's label belonging to the fill with a rendered contrast audit (D126), and files outside the page following their environment (D127). **The next free number is D128.**

Before changing anything, search `DECISIONS.md` for the area — by number, file or subject. A
decision changes only by being marked **SUPERSEDED** with a reason and replaced by a new row.

---

## Known Issues

Live issues and the traps that still bite. **Closed issues, and the full story behind each line
below, are in the archive → *Known Issues*.**

### Product

| Issue | Action |
|---|---|
| **Night's amber fill is bronze** (`warn-pop`, `cat-integration-pop`, `#ad7f0c`) | **By design (D121)**: a fill must sit at ~0.24 luminance in Night, where yellow cannot be bright. Revisit only with the gate maths, never by brightening one fill |
| **The generation prompt has one node of headroom** | D112 — no new node before Phase 34 |
| **The demo prompt sometimes generates a Sheets cell that resolves to `null`** — `smoke.mjs` failed 2 walks of 3 on 2026-10-07 (`00066-wvx`) with `Invalid config: values.N Invalid input`: a whole-string `{{ }}` reference to a path the run never produced. The third walk was CLEAN. The generated graph is valid and runs; one cell is wrong | **Phase 34** (generator evals) — exactly the "valid graph, wrong behaviour" case evals exist for. Re-run the walk before believing a regression; Phase 28 changed no generator, engine or node code |
| **No anti-framing header** — the app sends neither `X-Frame-Options` nor a CSP `frame-ancestors`, so another site can frame it (clickjacking). Found in Phase 28 while measuring the canvas in a same-origin iframe | **Phase 42** (launch polish), with the CSP D123 already anticipates. `frame-ancestors 'self'` keeps the same-origin measurement working |
| **Only listed test users can sign in** — the OAuth consent screen is in `Testing` (cap 100) | Publishing is complicated by the sensitive Sheets/Gmail scopes. **Phase 42** investigates |
| **A Google connection dies every 7 days** — Google issues a 7-day refresh token to an External app in `Testing` that asks for more than name, email and profile (its OAuth 2.0 docs, read 2026-10-06). The owner's, connected 2026-09-26, was dead by the time Phase 26 ran the smoke walk; **reconnected 2026-10-06 17:48 UTC (M15), so it expires again ~2026-10-13** | Reconnect it in Settings → Integrations, as M15 did; the Sheets and Gmail nodes already say "revoked or expired — reconnect it". It recurs weekly until the app is published, so **Phase 42** owns the real fix |
| **Notion and Airtable have never run against the real service** | By the user's decision (M10). `README.md` says so; `verify-integrations.mjs` reports `2 skipped` and must not be weakened |
| **The default model is a `-preview` model** (`gemini-3-flash-preview`) | A 404 opens its breaker and the chain falls through; re-derive with `npm run probe:models` if agent steps start failing |
| **The webhook URL is a bearer secret shown in the UI** | Anyone holding it can start a run. Rotate it from the inspector (`POST /api/workflows/:id/webhook/rotate`) if it leaks |
| **`integration.http` is agent-reachable, i.e. SSRF by design** | Bounded by `guard.ts` (D45): public addresses only, https only, redirects reported not followed |
| **4 moderate `npm audit` findings, one root cause** | esbuild's dev server, reachable only through `drizzle-kit`. Not in the runtime image. Accepted |

### Operations and verification

| Trap | Rule |
|---|---|
| **The verify scripts act as the deployment owner — `scripts/verify-user.mjs`** | The creator of the oldest personal workspace, or `VERIFY_USER_EMAIL`. Until Phase 26 they took `order by "id" limit 1`, which silently became a second account on 2026-10-01. **Every suite runs in the owner's real workspace**, as all of Chapter 2 did |
| **`verify-observability.mjs` always reports 1 skipped** — "both failures share one group id in the logs too" | Not a fault of the run: the check compares two runs' log lines but the query reads only the first run's, so it can never execute. Widening the query would break the "one run is one trace" check beside it; fix both together when the suite is next touched |
| **Cloud Logging ingests a run's lines out of order, seconds apart** | Poll for the *last* line you need, never "any entry" — `verify-observability.mjs` asserted on a half-ingested run until Phase 26 |
| **A push to `main` may create no CI run at all** — seen twice | **Check, never assume**: `gh api repos/arunishrajput/AgentForge/commits/$(git rev-parse HEAD)/check-runs --jq .total_count` — `0` means it never ran. Recover with `gh workflow run ci.yml --ref main` |
| **Free-tier model quota is per model, and the 500 cap is daily** | **Run the full verification battery once per session.** A 429 is not a regression — check the quota (<https://aistudio.google.com/rate-limit>) before debugging code. A full `probe:models` is ~90 calls |
| **A model's health flips in minutes; text and tool-calling fail independently** | Never trust a model from one call or from prose alone (D62). `npm run probe:models` checks both paths |
| **The API suites cannot see the browser** | 178 checks passed while a webhook run was invisible on the canvas (D59). **Drive a real browser before believing any UI claim** |
| **A migration can be in the `.sql` and not in the database** | `node --env-file=.env scripts/verify-schema.mjs` **before and after every migration** |
| **The registry count is pinned in four scripts** | `verify-api`, `verify-templates`, `verify-integrations`, `verify-observability` move together. Run every suite at the end of a phase, not just the ones it touched |
| **`verify-api.mjs` leaves rows behind if killed** | Probe rows are `*@agentforge.invalid` / `zzzz-` prefixed; delete them |
| **`scripts/smoke.mjs` writes to real services** | One Discord message and one Sheet row per walk. Since `min-instances 0`, Beat 1 *reports* a cold start rather than failing it; `--expect-warm` asserts it |
| **A generated webhook's `requiredFields` vary run to run** | Anything that POSTs to a generated webhook fits the payload to the graph (`scripts/demo-payload.mjs`, D58) |
| **A stale local server keeps the port and serves old code** | `lsof -nP -iTCP:<port> -sTCP:LISTEN` before trusting a local check; `pkill -f "next start"` leaves the worker holding it — `lsof -ti:3000 \| xargs -r kill -9` |
| **A local build's CSS is not the deployed CSS** | Tailwind's source detection reads Markdown locally — `DECISIONS.md` and the archive add `text-red-300` and `bg-white/10` — while the container build never sees them. Compare *computed values* between local and deployed, never stylesheet bytes |
| **The automated browser cannot be signed in** | Minting a session for it means moving a live token into the browser, which the agent's safety layer refuses as credential leakage — rightly. A signed-in UI check needs a Chrome profile that is signed in **and** has the Claude extension connected |
| **`next dev` and `next build` share `.next`**, and **`next start` cannot serve a standalone build** | `rm -rf .next` between them; verify a production build the way the container runs it — see *How to verify* |
| **A prerendered static route is cached hard by the browser** | Append `?cb=x` when verifying a redeploy of `/design` |
| **React Flow does not refit on a window resize** | Reload after resizing before believing a canvas screenshot |
| **Cloud Run drains in-flight requests** — a redeploy does not kill a run | Do not repeat the old "runs die on redeploy" claim. A crash, an OOM or the request timeout does |
| **A Cloud Tasks queue reporting `PAUSED` still dispatches** | Never rely on pausing to hold a task in a test |
| **Google OAuth changes take ~90 s to propagate**, and **curl cannot detect `redirect_uri_mismatch`** | Wait before suspecting a typo; only a real browser sign-in proves the redirect |
| **A hidden browser window takes no input and freezes CSS transitions** | Phase 28: synthetic clicks and keys from the extension never arrived, page timers were throttled past the tool's 45 s limit, and a live theme switch read grey cards at 1.13:1 until the frozen cross-fade settled. Check `document.visibilityState`; ask for the window to be brought forward, or drive the UI's own controls with DOM events and let transitions settle before measuring |
| **A phone width in a signed-in browser** | Chrome's window cannot go below ~500 px, and the automated browser cannot be signed in. Load the page in a **same-origin `<iframe>`** of the width you need inside the signed-in tab and measure its `contentDocument` — Phase 28's toolbar figures came from this |

### Engineering rules learned the hard way

| Rule | Where it came from |
|---|---|
| **The run-bound family moves together**: engine deadline 120 s < `STREAM_MAX_MS` 150 s < `LEASE_MS` 180 s | D78. Raise one and raise the others, or a live worker loses its lease and a node runs twice. **Phase 26's `waiting` state sits outside it** — a waiting run holds no lease |
| **A table indexed by a URL path segment must be own-property only** | `toString` as a credential kind answered 500 (23B). `Object.hasOwn` or a `Map` |
| **A test whose "does not exist" example later starts existing asserts nothing** | 23B. When registering a name, search the suite for it first |
| **A route wrapping its body in an error mapper destroys every refusal under it** | D109 |
| **Authority first, legality second** in an authorisation rule | 19B: a viewer was told how many owners a workspace had |
| **`request.url` is the bind address in the container** | D53 — the public origin comes from `APP_BASE_URL` |
| **A `pull`-driven `ReadableStream` does not stream under Next** | The SSE route drives its own loop; do not "simplify" it |
| **A client component's `toLocaleString()` is hydration error #418** | Every date goes through `@/lib/format/date` (UTC, pinned locale) |
| **`z.string().min(1)` accepts `"   "`** | `.trim()` before `.min(1)` |
| **A generated graph can be valid and do the wrong thing** | Give every non-pass-through node an `outputShape` (D38); ask what the model does with a numeric field's minimum (D57) |
| **A class in the DOM is not evidence it applies** | Filled animations override utilities; arbitrary-value colours drop opacity modifiers. `DESIGN.md` → *Traps*. Measure with `getComputedStyle` |
| **When a role removes an action, check the whole region it lived in** | 20: a viewer was offered a payload box for a run they could not start |
| **Two lint rules disagree about one dependency array in `editor.tsx`** | The `start` callback keeps `stopStream` with the newer rule suppressed on that line — the reason is in the archive |

---

## Manual Actions Pending

M1–M12 are resolved; their blocks and outcomes are in the archive. **M13** — upgrade the closed trial
billing account — was done by the user on 2026-10-06 and verified the same day (account open, project
billing enabled, health 200; its block is in git history at `ec19b5b`). **M15** — reconnect Google as the
owner after its 7-day `Testing` token expired — was done by the user on 2026-10-06 (credential re-created
17:48 UTC) and verified by a clean `smoke.mjs` walk; its block is in git history at `c2af0e1`. **It will
be needed again about every 7 days** until Phase 42 — see *Known Issues*. **The next free number is M16.**

### M14 — Read Neon's consumed CU-hours, on or after 2026-10-13 (non-blocking)

Phase 26 changed what wakes the database: the `*/15` tick (~61 CU-hours a month) became a daily sweep
(~0.6). That is arithmetic (`DEPLOYMENT.md` → *Free-tier headroom* → *Neon*); a week of the new cadence
turns it into a measurement. Console-only on the free plan (`OPERATIONS.md`), so it needs the user.

```text
MANUAL ACTION REQUIRED (non-blocking — nothing waits on it)

Reason:
To confirm Phase 26 cut Neon's idle compute from ~61 to ~0.6 CU-hours a month. The free plan's
consumption API is Scale-plan only, so the number can be read only in the console.

Location:
https://console.neon.tech → project "agentforge" → Usage (or Billing → Usage)

Steps:
1. On or after 2026-10-13, open the page above.
2. Note "Compute" (CU-hours) consumed so far in the current billing period, and the period's
   start date.

Values to enter:
None.

Expected result:
Well under the ~15 CU-hours a week the old */15 tick alone would have used — a few CU-hours,
mostly real use. M9 read 0.91 on 2026-10-01, a few hours into the period, with the tick running.

Verification:
Claude Code records the figure in DEPLOYMENT.md → Free-tier headroom → Neon and in PROGRESS.md.

Resume by:
"M14: <n> CU-hours since <date>".
```

## Blocked

**Nothing.**

---

## Cloud Resource Inventory

**Check this before creating anything.** Corrected against live state on 2026-10-01; the rows'
history is in the archive.

| Resource | Provider | Identifier | Status |
|---|---|---|---|
| Git repository | GitHub | `arunishrajput/AgentForge`, public, MIT | **EXISTS** |
| CI | GitHub Actions | `.github/workflows/ci.yml`, job name **`lint · typecheck · test · build`** (a contract — branch protection requires it) | **EXISTS**, ~1 min |
| Branch protection on `main` | GitHub | required check above, strict, no force push | **EXISTS** — `enforce_admins` deliberately `false`, so the owner's direct push to `main` works |
| Private vulnerability reporting | GitHub | `arunishrajput/AgentForge` | **ENABLED** |
| Google Cloud project | Google Cloud | `agentforge-hackathon-2026`, number `733000675212` | **EXISTS**, billing on the **paid** account `017EB5-0D8A5E-F212CC` since M13 |
| Cloud Run service | Google Cloud | `agentforge`, `asia-southeast1` | **LIVE**, `agentforge-00066-wvx` |
| Artifact Registry | Google Cloud | `cloud-run-source-deploy`, `asia-southeast1` | **EXISTS** — cleanup policy: keep the newest 5 images, delete the rest once a day old (D120). **Re-read 2026-10-07: 160.4 MB, five images** — down from 926.9 MB the day of the prune. The saving D120 assumed is real; the size figure is simply computed late, so re-read it a day after a prune, not the same hour |
| Build-source bucket | Cloud Storage | `run-sources-agentforge-hackathon-2026-asia-southeast1` | **EXISTS** — lifecycle: delete objects after 7 days (D120). No free tier in this region |
| Budget | Cloud Billing | "AgentForge zero", `72b470cc-…`, ₹100/month, alerts at 50 / 90 / 100 % | **EXISTS** since 2026-10-06 (D113) |
| Enabled APIs | Google Cloud | `run` `cloudbuild` `artifactregistry` `cloudscheduler` `apikeys` `generativelanguage` `gmail` `sheets` `cloudtasks` `secretmanager` `billingbudgets` | **ENABLED** (`billingbudgets` added 2026-10-06 for the budget) |
| OAuth consent screen | Google Cloud | External, "AgentForge" | **Testing**, listed test users only |
| OAuth client | Google Cloud | "AgentForge Web", `733000675212-…ntm7` | **EXISTS**, 4 redirect entries |
| Scheduler job | Google Cloud | `agentforge-cron`, **`0 4 * * *`** UTC, deadline 540 s → `/api/cron/tick` | **`ENABLED`** since 2026-10-06 — the daily safety sweep (D114) |
| Cloud Tasks queue | Google Cloud | `agentforge-runs`, `asia-southeast1` | **RUNNING** — `maxAttempts 5`, backoff 5 → 60 s, `maxConcurrentDispatches 3`. Carries durable runs, run wakes **and schedule timers** (Phase 26) |
| IAM | Google Cloud | `roles/cloudtasks.enqueuer` and `roles/secretmanager.secretAccessor` (on `agentforge-root-key` only) for `733000675212-compute@developer.gserviceaccount.com` | **GRANTED** |
| Root key | Secret Manager | `agentforge-root-key`, version `1` enabled | **EXISTS** — never destroy a version a credential names: `select distinct "keyVersion" from credential;` |
| Log-based metrics | Cloud Logging | `agentforge_runs` `agentforge_node_latency` `agentforge_model_fallbacks` `agentforge_errors` | **EXIST**, collecting. Their filters name events in `src/lib/logging/events.ts` |
| Free-tier Gemini key | Google Cloud | "AgentForge Gemini Free Tier" in project **`agentforge-gemini-free`** (no billing — **never enable it**) | **WORKS**. The key in `agentforge-hackathon-2026` is **dead** (402, billing) |
| Neon project | Neon | `agentforge`, `super-mountain-39872886`, PostgreSQL 18.6, free plan | **EXISTS** — branch `production`, database `neondb`, role `neondb_owner`; plus `agentforge_demo` with a `SELECT`-only role |
| Stored credentials | Neon | **The owner's workspace**: `llm.google`, `llm.groq`, `google.oauth` (Sheets + Gmail scopes), `integration.discord`, `integration.slack`, `integration.github`, `integration.postgres` — one row each. **The test account's workspace holds none** (four put there by mistake on 2026-10-06 were removed) | **PRESENT**, read 2026-10-06. `verify-api.mjs` with `VERIFY_DISCORD_WEBHOOK` deletes the Discord one as part of its test — re-add it from `DISCORD_WEBHOOK_URL` in `.env` |
| Discord | Discord | server "AgentForge", `#agentforge-demo`, webhook "AgentForge" | **EXISTS** |
| Demo spreadsheet | Google Sheets | "AgentForge Demo Log", id `1iz8vjkGNvPQ1q1vpDvaWnQZ6648BNYHYauVXHHY2IBo` | **EXISTS — do not delete** |

**Installed stack.** Runtime: `next` 16.3.6 · `react` 19.3.0 · `next-auth` **5.0.0-beta.32** (pinned
exactly — never track the `beta` tag) · `@auth/drizzle-adapter` 1.11.3 · `drizzle-orm` 0.45.3 ·
`@neondatabase/serverless` 1.1.0 · `postgres` 3.4.9 (23C, A24) · `zod` 4.6.5 · `@xyflow/react`
12.12.0. Dev: `tailwindcss` 4.3.3 · `@tailwindcss/node` and `@tailwindcss/oxide` 4.3.3 (Phase 27, D124 — the
compiler and scanner `utilities.test.ts` uses, pinned rather than reached through `@tailwindcss/postcss`) ·
`typescript` 7.0.2 · `drizzle-kit` 0.31.11 · `oxlint` 1.85.0.
**Deliberately absent:** an LLM SDK (D32), a test framework, a queue client, a telemetry exporter, a
component library (A16). Toolchain: `node` v26 · `gh` · `gcloud` (authenticated) · `docker`.

Local `.env` is populated and gitignored; `.env.example` mirrors `CONTRACT.md`.

---

## How to verify the system, from a cold session

The authoritative deploy checklist is `DEPLOYMENT.md` → *Verification*. The narrative behind each
suite — what it proves, what it cannot — is in the archive. `$URL` below is the canonical URL.

| What | Command | Notes |
|---|---|---|
| The CI gates, locally | `npm run check` | ~15 s, no network. Then `npm run build` |
| Database matches the repo | `node --env-file=.env scripts/verify-schema.mjs` | Before and after every migration. `--repair` records only DDL it can see |
| Which models answer | `npm run probe:models` (`--provider groq`) | Real calls on **both** paths. Sparingly — quota |
| The demo path | `SMOKE_SPREADSHEET_ID=1iz8vjkGNvPQ1q1vpDvaWnQZ6648BNYHYauVXHHY2IBo node --env-file=.env scripts/smoke.mjs $URL` | Writes real Discord and Sheets rows |
| The API regression suite | `node --env-file=.env scripts/verify-api.mjs $URL` | ~2 min. `VERIFY_GEMINI_KEY` and `VERIFY_DISCORD_WEBHOOK` enable the checks that need them — the exact pipe-in-the-key form is in the archive. Without them those checks SKIP |
| Durable execution | `APP_BASE_URL=$URL node --env-file=.env scripts/verify-durable.mjs all` | ~6 min. After touching the engine, queue or lease |
| The vault | `node --env-file=.env scripts/verify-vault.mjs $URL` | Re-keys the real workspace |
| Observability | `node --env-file=.env scripts/verify-observability.mjs $URL` | Plus `gcloud logging metrics list` (expect 4) |
| Integrations | `APP_BASE_URL=$URL node --env-file=.env scripts/verify-integrations.mjs` | 2 skips are Notion and Airtable, by decision |
| Postgres node | `node --env-file=.env scripts/verify-postgres.mjs $URL` | |
| Providers | `node --env-file=.env scripts/verify-providers.mjs $URL` | |
| Templates | `APP_BASE_URL=$URL node --env-file=.env scripts/verify-templates.mjs` | Reads `APP_BASE_URL` only — an argument is ignored and `.env`'s localhost wins. Corrected 2026-10-07 |
| Accessibility | `APP_BASE_URL=$URL node --env-file=.env scripts/verify-a11y.mjs` | After adding a page or touching `components/ui` |
| Unauthenticated surfaces | `APP_BASE_URL=$URL node --env-file=.env scripts/verify-security.mjs` | After adding any route |
| See the canvas in a browser without OAuth | `node --env-file=.env scripts/mint-session.mjs` then `--revoke <token>` | Same session mechanism, no bypass |

**A production build, run the way the container runs it** (`next start` cannot serve it):

```bash
npm run build && cp -r .next/static .next/standalone/.next/static && cp -r public .next/standalone/
(cd .next/standalone && PORT=3100 HOSTNAME=127.0.0.1 node --env-file=../../.env server.js)
```

---

## Notes for whoever comes next

- **Start Phase 29 — Canvas I.** Phase 28 is closed and deployed: every screen works in both themes.
  Everything Phase 29 adds — toolbar buttons, the `?` dialog, the *N nodes selected* inspector — is
  built in both from the start, and verified in a browser in **Light and Night**
- **Run `scripts/contrast-audit.browser.js` on every screen you touch, in both themes** (D126). Evaluate
  the file in the page; an empty list is a pass. The token gates cannot see which pair a component
  draws — Phase 28's seven empty badges passed every one of them
- **A new `Badge` that should stand out without a fill is `tone="outline"`**; `tone="pop"` needs its
  `fill` and the type says so. The fill's label (`text-accent-ink`) never takes an opacity modifier
- **The theme is per browser**: `localStorage["agentforge:theme"]`, `<html data-theme>`. To look at
  Night in a script-driven browser, set the key and reload; `/design` has a switch for a person
- **Prove "no flash" with frames, not a settled screenshot.** Phase 27's method: CDP
  `Page.startScreencast` across a throttled, cache-disabled hard reload, read each frame's corner
  pixel in the page, and run a control with the head script stripped (it painted 64 cream frames).
  The snippet is in `BUILD_PLAN.md` → *Phase 27* → *Status*
- **A signed-in browser check needs a signed-in Chrome with the Claude extension connected — and in
  the foreground.** Phase 28 asked the user to sign in early, which worked; midway the window went to
  the background and stopped taking input (*Known Issues* → *Operations*). Ask early, and check
  `document.visibilityState` before trusting a failed click
- **Every verify script, and `mint-session.mjs`, acts as the deployment owner** (`scripts/verify-user.mjs`),
  i.e. in the owner's real workspace. `VERIFY_USER_EMAIL` picks another account deliberately — which
  then needs its own keys, or every model check fails. Clean up after yourself
- **M14 is due on or after 2026-10-13** — ask the user for the Neon reading; it is non-blocking
- **The owner's Google connection expires every 7 days** (next ~2026-10-13). When `smoke.mjs` fails
  beats 7–8, or a Sheets/Gmail node says "revoked or expired", ask the user to reconnect it before
  believing it is a regression. **A beat-7 failure reading `Invalid config: values.N` is different** —
  a generated cell resolving to `null` (*Known Issues*); re-run the walk once
- **This line names a phase, so it goes stale when that phase ends.** Rewrite it — and the *Current
  Phase* heading, the ladder table above and the `← START HERE` marker in `BUILD_PLAN.md` — at the
  end of every phase
- **`npm run check` before every commit**; CI is mandatory and a red pipeline is a stop-work
  condition. Then confirm the pipeline actually ran (see *Known Issues*)
- **Every bug fixed gets a test that fails without the fix**
- **Warm the service before timing anything**: it is at `min-instances 0`, so the first request takes
  ~6.4 s and Neon's wake adds ~1 s

---

## Recent Changes

**2026-10-07 — Phase 28 closed: every screen in both themes.** Two deploys, `00065-d2r` then
`00066-wvx`. The canvas follows the theme (React Flow's `colorMode`, the minimap mask, and a dot grid
that had never been ink — its override set a property React Flow does not read); Night's fill hover no
longer breaks the outline (D125); the favicon and the static illustrations exist in both themes, and the
README picks with `<picture>` (D127); the root error page applies the theme through `ThemeSync`, after a
probe build showed a copied head script would be dead code. The signed-in pass found what no gate could:
**the account menu was unreachable from the keyboard** (its disabled first item swallowed focus),
**seven badges were empty capsules in Night** (a fill's label with no fill, 1.06:1), and **two dimmed
labels on fills were under AA** in Light — all fixed and gated, and the contrast audit that found them is
kept as `scripts/contrast-audit.browser.js` (D126). The phone toolbar is two rows at 375 px. All three
theme controls work signed in. A workflow was generated, edited and run in Night. The battery passed
with 0 failed; the smoke walk failed twice on a generated Sheets reference and passed the third time
(*Known Issues*, owned by Phase 34).

**2026-10-07 — Phase 27 closed: three themes, Light the default.** Toybox Night and System, built and
deployed as `agentforge-00064-jmm`. Ink's four jobs became four roles (D121); Night's fills sit in the
one luminance band where a dark label reads and a cream outline shows, and its structure is drawn in
cream (D122); a blocking `<head>` script applies the stored choice before the first paint, and the
stylesheet resolves System itself (D123) — 121 deployed frames on a cold reload, all indigo, against
a control that flashed 64 cream ones. Every colour gate runs per theme, and ten deliberate breaks of
Night were each caught. Light computes exactly as before. The sweep found **three classes that
compiled to nothing** — `bg-lift` in six places, `text-ok-ink`, `text-warn-ink` — now guarded by a
gate that asks Tailwind's compiler (D124); the browser found three Night defects no gate could see.
The signed-in placements of the theme choice were not seen in a browser (no signed-in, connected
Chrome) and are Phase 28's task 4. The full battery ran on `00064-jmm` with **0 failed** and the smoke walk clean.

**2026-10-06 — Phase 26 closed: deployed, verified, and schedules fire again.** The user upgraded the
billing account (M13), and the session added the ₹100 budget alert, pruned 53 of 58 registry images and
38 old source uploads under standing cleanup rules (D120), deployed, and set the cron to a daily
`ENABLED` sweep. **The M12 consequence — no schedule trigger fired — is closed**, and at a fraction of the
old cost: the `*/15` tick woke Neon ~2,920 times a month (~61 of 100 CU-hours); timers wake it only when
something is due, so the idle product is ~0.6 CU-hours a month (the daily sweep), plus ~0.6 per daily
schedule (M14 will measure it). `verify-timers.mjs` passed 34/34 on the deployed service — fired 0.1 s
after the slot — and a real browser watched a schedule fire on an open canvas. Deployed verification
found five things, all fixed: the panel naming a past slot after a firing (now re-read per firing,
with the next slot armed before the run starts); every verify script silently acting as a second
account since 2026-10-01 (now `verify-user.mjs`; four operator credentials it had stored there were
removed, and `verify-a11y.mjs` no longer audits another account's canvas); a stale route count in `verify-security.mjs`; `verify-observability.mjs` asserting on
half-ingested logs; and a build upload carrying every git-ignored file (now `#!include:.gitignore`,
1.9 MB instead of 65.8). Two deploys: `00062-kxm`, then `00063-zt5`. The smoke walk failed only its Sheets
beats, on a Google token that expired by Google's 7-day `Testing` rule; the user reconnected it (M15)
and the walk ran clean.

**2026-10-06 — Phase 26 built; deploy blocked (M13).** The session opened to a dead service: the
Free Trial billing account had closed at 90 days, so Cloud Run answered 503 and every Google API
refused. The user chose to upgrade to a paid account inside Always Free (D113, M13). Meanwhile the
phase was built in full — per-slot Cloud Tasks timers and `POST /api/cron/fire` (D114, D115), the
daily sweep, durable `waiting` runs and `core.delay` as `{ amount, unit }` (D116, D117), the active
switch with a 409 webhook refusal (D118), and the save-path double-fire race (D119). Migration `0012`
is applied; 1023 tests pass; a local production build was driven in a browser. Two things were found
and fixed on the way: the cancel/wake race that would strand a paused step, and the toolbar clipping
the save status at 375 px. A stale `MAX_FIRES_PER_TICK (3)` in `CONTRACT.md`, wrong since Phase 17,
was corrected.

**2026-10-06 — Chapter 3 opened (documentation only, no deploy).** Planned with the user: themes
(Light, Dark, System — D110), and all four feature areas (canvas editing, an AI copilot, more
powerful workflows, organisation and daily use), sequenced into **17 phases, 26–42** by D111's
ordering rule, with D112 holding new nodes until Phase 34. **`PROGRESS.md` was rebuilt** from ~1,800
lines into this board; the decision register moved to `DECISIONS.md` and the history to `archive/`,
both verbatim. `BUILD_PLAN.md` now holds Chapter 3, with phases 0–25 archived. Two defects were found
while exploring and are now owned by phases: **schedules do not fire** (26) and **`bg-lift` has no
token** (27). Three stale lines were corrected on the way: the ladder's `← START HERE` still on
Phase 24, an inventory row naming revision `00047-w65`, and "installed stack unchanged since
Phase 4" after `postgres` was added in 23C.

---

## Last Updated

**2026-10-07** — **Phase 28 complete**, deployed as `agentforge-00066-wvx` and verified on the deployed
service and in a real browser in Light and Night. **M14** (Neon reading, from 2026-10-13) is pending and
non-blocking. **Next: Phase 29 — Canvas I.**
