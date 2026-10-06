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

**CHAPTER 3 IS OPEN. THE NEXT PHASE IS 26, AND NOTHING IN IT HAS STARTED.**

| Chapter | Phases | State |
|---|---|---|
| **1** — the hackathon MVP | 0–12 | **COMPLETE.** Submitted 2026-09-26 (<https://devpost.com/software/agentforge-kz832x>). Closed, never reopened |
| **2** — the open-source product | 13–25 | **COMPLETE**, 2026-10-01. Durable runs, versioning, workspaces, roles and sharing, a credential vault, observability, 30 nodes, two LLM providers, docs, an a11y and security audit |
| **3** — a product people use every day | **26–42** | **OPEN — planned 2026-10-06, Phase 26 not started.** `BUILD_PLAN.md` is the scope contract |

**Chapter 3, in one line:** themes (Light, Dark, System), a canvas that edits like a serious tool,
an AI copilot that edits and repairs workflows, workflows that can handle errors, wait, ask a person
and call each other, and the daily-use basics — tags, run history, import/export and an API.

**The live system works and must keep working:**
**https://agentforge-733000675212.asia-southeast1.run.app** — revision `agentforge-00061-lwl`.
Launch demo video: <https://www.youtube.com/watch?v=3txmpCPEWd4>.

### The binding decisions, restated for Chapter 3

| Decision | Value |
|---|---|
| **Budget** | **Still strictly zero.** Free tiers only. Escalate, never provision paid |
| **Visual direction** | **Toybox — bright, playful, light-first.** Light is the default and the reference. **Dark ("Toybox Night") and System become opt-in themes in Phases 27–28** (D110, decided 2026-10-06, superseding D65's light-only). Until Phase 27 lands, the code still enforces light-only |
| **Restored scope** | Teams, versioning, observability and the vault are **built** (Chapter 2) |
| **Purpose** | **Open-source showpiece**, and now a product a stranger can use daily |
| **Neon** | The binding free tier: **never add a new reason to wake an idle database** — no polling, no frequent timers. `BUILD_PLAN.md` → *The zero-cost problem, Chapter 3 edition* |
| **Registry** | **No new registry node before Phase 34** (D112) — the generation prompt has one node of headroom left |

---

## Current Phase

## ▶ PHASE 26 — Timers: schedules that fire, at zero idle cost — NOT STARTED

**Why it is first:** since M12 (2026-10-01) `agentforge-cron` is `PAUSED`, so **no schedule trigger
fires**, silently. The phase replaces the `*/15` tick with Cloud Tasks timers armed for the exact
fire time, shrinks the cron to a daily safety sweep, makes `core.delay` able to wait durably for
minutes to days (a new `waiting` run status), and adds a per-workflow active switch. Full definition
in `BUILD_PLAN.md` → *Phase 26*.

**Before writing code, verify the real state** (the deployed service is idle and cold by design):

```bash
gcloud run services describe agentforge --region asia-southeast1 \
  --format='value(status.latestReadyRevisionName,spec.template.metadata.annotations)'
curl -fsS https://agentforge-733000675212.asia-southeast1.run.app/api/health   # ~6.4 s if cold
gcloud scheduler jobs describe agentforge-cron --location asia-southeast1 --format='value(state,schedule)'
gcloud tasks queues describe agentforge-runs --location asia-southeast1 --format='value(state)'
node --env-file=.env scripts/verify-schema.mjs     # 12 migrations, 0000–0011
npm run check                                      # the five CI gates
```

Expected: revision `agentforge-00061-lwl`, health `ok` with 12 migrations and registry 30, cron
`PAUSED` on `*/15 * * * *`, queue `RUNNING`. **A `PAUSED` cron is the starting state this phase
fixes, not a regression.**

---

## Chapter 3 — phases 26–42

| Phase | Status |
|---|---|
| **26** — Timers: schedules that fire, at zero idle cost | **NOT STARTED** ← next |
| **27** — Themes I: Toybox Night tokens, gates, switching | NOT STARTED |
| **28** — Themes II: every screen in both themes | NOT STARTED |
| **29** — Canvas I: editing ergonomics | NOT STARTED |
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
| **Revision** | **`agentforge-00061-lwl`**, 100% of traffic — Phase 25's image (`00060-z9v`) re-revisioned by M12 with `min-instances 0`, no code change. Previous good: `00060-z9v`, `00059-pd2`, `00058-q2z` (23D), `00054-8zw` (23C), `00053-hn6` (23B), `00051-252` (23A), `00047-w65` (22). Rollback tested (`update-traffic --to-revisions <rev>=100`, ~15 s) |
| Scaling | **`min-instances 0`**, `max-instances 3`, 1 vCPU / 1 GiB, 3600 s timeout, port 8080. **Cold start 6.38 s** (measured), 0.58–0.76 s warm |
| Env vars | 12: `NODE_ENV` `AUTH_URL` `APP_BASE_URL` `DATABASE_URL` `AUTH_SECRET` `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` `ENCRYPTION_KEY` `CRON_SECRET` `TASKS_QUEUE` `TASKS_LOCATION` `ROOT_KEY_SECRET`. A plain redeploy inherits them; add with `--update-env-vars` (merges), never `--env-vars-file` unless replacing the set (D11). `TASKS_PROJECT`, `GCP_ACCESS_TOKEN`, `GCP_PROJECT` and `DATABASE_URL_UNPOOLED` are deliberately **not** set on the service |
| Database | Neon `super-mountain-39872886`, **13 tables**, migrations **`0000`–`0011`** applied, ~10 MB of 0.5 GB. A second database `agentforge_demo` with a `SELECT`-only role serves the Postgres node's verification (23C). One Neon database serves local and production |
| Scheduler | **`agentforge-cron` is `PAUSED`** (M12) on `*/15 * * * *` — **no schedule trigger fires.** Phase 26 replaces it |
| Queue | `agentforge-runs` Cloud Tasks queue, `RUNNING`, `maxAttempts 5`, `maxConcurrentDispatches 3` |
| Routes | Pages `/` `/workflows` `/workflows/[id]` `/templates` `/analytics` `/settings` `/design` `/invite/[token]` `/s/[token]` (+ `/dashboard` → `/workflows`), and **41** API routes. Unauthenticated: **nine routes and two pages**, derived and checked by `verify-security.mjs` |
| Provider keys stored | `llm.google` on `gemini-3-flash-preview`, `llm.groq` on `openai/gpt-oss-120b`. `workspace.llmProvider` is `NULL` (resolves to Google). **No model key on the service** — the product path is the user's own key |
| **Registry** | **30 nodes.** The generation prompt is **24,876 characters against a 26,000 ceiling** (`src/lib/nodes/registry.test.ts`) — **one node of headroom** (D112; Phase 34 fixes it). A node owes five things, all asserted by `registry.test.ts`: a `PUBLISHABLE` entry, a `ROTATION_RULES` entry if it carries a credential kind, a `model` output field only if it is a model call, a generator catalogue entry (automatic), and `docs` |
| Tests | **992 tests** on Node's built-in runner; coverage **88.25 / 90.82 / 80.13** (lines / branches / functions) against thresholds 85 / 88 / 76. `npm run check` = lint · typecheck · test+coverage · test:scripts · docs:check; CI adds `build` |
| Latency | Warm health ~190 ms (India → Singapore), DB 7–11 ms. Neon wake ~0.7–1.1 s. Generation 2.7–3.5 s. Analytics 17–27 ms of DB time per page view |
| Last verified | **2026-10-01, on `00060-z9v` / `00061-lwl`**: every deployed suite ALL PASSED (`verify-a11y` 92, `verify-security` 67, `verify-api`, `verify-templates` 47, `verify-postgres` 65, `verify-providers` 55, `verify-vault`, `verify-durable`, `verify-observability`); `verify-integrations` 60 passed / **2 skipped** (Notion, Airtable — skipped is not passed); a clean `smoke.mjs` walk on `00061-lwl` |
| Billing | Trial credit account `Billing - AgentForge`, open. Spend is not queryable from the CLI — eyeball it in the console |
| Fonts | Geist + Geist Mono, self-hosted by `next/font` — no font request, CLS 0 |

---

## Decisions

**Binding, and in [`DECISIONS.md`](./DECISIONS.md).** D6–D109 from Chapters 1–2, and **D110–D112 from
Chapter 3's planning**: three themes with Light the default (D110), the ladder's ordering rule
(D111), and no new registry node before Phase 34 (D112). **The next free number is D113.**

Before changing anything, search `DECISIONS.md` for the area — by number, file or subject. A
decision changes only by being marked **SUPERSEDED** with a reason and replaced by a new row.

---

## Known Issues

Live issues and the traps that still bite. **Closed issues, and the full story behind each line
below, are in the archive → *Known Issues*.**

### Product

| Issue | Action |
|---|---|
| **No schedule trigger fires** — `agentforge-cron` is `PAUSED` since M12 | **Phase 26.** Resuming the job (`gcloud scheduler jobs resume agentforge-cron --location asia-southeast1`) is the stopgap and costs ~60 CU-hours/month; do not shorten the tick |
| **`bg-lift` applies no background** — used in 4 places, no `--color-lift` token exists | **Phase 27.** Found while planning Chapter 3 |
| **The generation prompt has one node of headroom** | D112 — no new node before Phase 34 |
| **Only listed test users can sign in** — the OAuth consent screen is in `Testing` (cap 100) | Publishing is complicated by the sensitive Sheets/Gmail scopes. **Phase 42** investigates |
| **Notion and Airtable have never run against the real service** | By the user's decision (M10). `README.md` says so; `verify-integrations.mjs` reports `2 skipped` and must not be weakened |
| **The default model is a `-preview` model** (`gemini-3-flash-preview`) | A 404 opens its breaker and the chain falls through; re-derive with `npm run probe:models` if agent steps start failing |
| **The webhook URL is a bearer secret shown in the UI** | Anyone holding it can start a run. Rotate it from the inspector (`POST /api/workflows/:id/webhook/rotate`) if it leaks |
| **`integration.http` is agent-reachable, i.e. SSRF by design** | Bounded by `guard.ts` (D45): public addresses only, https only, redirects reported not followed |
| **4 moderate `npm audit` findings, one root cause** | esbuild's dev server, reachable only through `drizzle-kit`. Not in the runtime image. Accepted |

### Operations and verification

| Trap | Rule |
|---|---|
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
| **`next dev` and `next build` share `.next`**, and **`next start` cannot serve a standalone build** | `rm -rf .next` between them; verify a production build the way the container runs it — see *How to verify* |
| **A prerendered static route is cached hard by the browser** | Append `?cb=x` when verifying a redeploy of `/design` |
| **React Flow does not refit on a window resize** | Reload after resizing before believing a canvas screenshot |
| **Cloud Run drains in-flight requests** — a redeploy does not kill a run | Do not repeat the old "runs die on redeploy" claim. A crash, an OOM or the request timeout does |
| **A Cloud Tasks queue reporting `PAUSED` still dispatches** | Never rely on pausing to hold a task in a test |
| **Google OAuth changes take ~90 s to propagate**, and **curl cannot detect `redirect_uri_mismatch`** | Wait before suspecting a typo; only a real browser sign-in proves the redirect |

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

**None.** M1–M12 are all resolved; their blocks and outcomes are in the archive. A Chapter 3 manual
action takes the next number, **M13**, in the `CLAUDE.md` format.

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
| Google Cloud project | Google Cloud | `agentforge-hackathon-2026`, number `733000675212` | **EXISTS**, billing on the trial account |
| Cloud Run service | Google Cloud | `agentforge`, `asia-southeast1` | **LIVE**, `agentforge-00061-lwl` |
| Artifact Registry | Google Cloud | `cloud-run-source-deploy`, `asia-southeast1` | **EXISTS** |
| Enabled APIs | Google Cloud | `run` `cloudbuild` `artifactregistry` `cloudscheduler` `apikeys` `generativelanguage` `gmail` `sheets` `cloudtasks` `secretmanager` | **ENABLED** |
| OAuth consent screen | Google Cloud | External, "AgentForge" | **Testing**, listed test users only |
| OAuth client | Google Cloud | "AgentForge Web", `733000675212-…ntm7` | **EXISTS**, 4 redirect entries |
| Scheduler job | Google Cloud | `agentforge-cron`, `*/15 * * * *` UTC, deadline 540 s | **`PAUSED`** (M12). Phase 26 changes its cadence and resumes it |
| Cloud Tasks queue | Google Cloud | `agentforge-runs`, `asia-southeast1` | **RUNNING** — `maxAttempts 5`, backoff 5 → 60 s, `maxConcurrentDispatches 3` |
| IAM | Google Cloud | `roles/cloudtasks.enqueuer` and `roles/secretmanager.secretAccessor` (on `agentforge-root-key` only) for `733000675212-compute@developer.gserviceaccount.com` | **GRANTED** |
| Root key | Secret Manager | `agentforge-root-key`, version `1` enabled | **EXISTS** — never destroy a version a credential names: `select distinct "keyVersion" from credential;` |
| Log-based metrics | Cloud Logging | `agentforge_runs` `agentforge_node_latency` `agentforge_model_fallbacks` `agentforge_errors` | **EXIST**, collecting. Their filters name events in `src/lib/logging/events.ts` |
| Free-tier Gemini key | Google Cloud | "AgentForge Gemini Free Tier" in project **`agentforge-gemini-free`** (no billing — **never enable it**) | **WORKS**. The key in `agentforge-hackathon-2026` is **dead** (402, billing) |
| Neon project | Neon | `agentforge`, `super-mountain-39872886`, PostgreSQL 18.6, free plan | **EXISTS** — branch `production`, database `neondb`, role `neondb_owner`; plus `agentforge_demo` with a `SELECT`-only role |
| Stored credentials | Neon | `llm.google`, `llm.groq`, `google.oauth` (Sheets + Gmail scopes), `integration.discord`, `integration.slack`, `integration.github`, `integration.postgres` — one row each | **PRESENT**, read from the database on 2026-10-06. `verify-api.mjs` with `VERIFY_DISCORD_WEBHOOK` deletes the Discord one as part of its test — re-add it from `DISCORD_WEBHOOK_URL` in `.env` |
| Discord | Discord | server "AgentForge", `#agentforge-demo`, webhook "AgentForge" | **EXISTS** |
| Demo spreadsheet | Google Sheets | "AgentForge Demo Log", id `1iz8vjkGNvPQ1q1vpDvaWnQZ6648BNYHYauVXHHY2IBo` | **EXISTS — do not delete** |

**Installed stack.** Runtime: `next` 16.3.6 · `react` 19.3.0 · `next-auth` **5.0.0-beta.32** (pinned
exactly — never track the `beta` tag) · `@auth/drizzle-adapter` 1.11.3 · `drizzle-orm` 0.45.3 ·
`@neondatabase/serverless` 1.1.0 · `postgres` 3.4.9 (23C, A24) · `zod` 4.6.5 · `@xyflow/react`
12.12.0. Dev: `tailwindcss` 4.3.3 · `typescript` 7.0.2 · `drizzle-kit` 0.31.11 · `oxlint` 1.85.0.
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
| Templates | `node --env-file=.env scripts/verify-templates.mjs $URL` | |
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

- **Start Phase 26.** Read its definition in `BUILD_PLAN.md`, then `CONTRACT.md` (run state machine,
  trigger shapes), `ARCHITECTURE.md` → *Queue*, and `DEPLOYMENT.md` → *Cloud Scheduler* and
  *Free-tier headroom*. **Read the current Cloud Tasks docs** for the `scheduleTime` horizon — it is
  marked `UNKNOWN — VERIFY` in the plan
- **This line names a phase, so it goes stale when that phase ends.** Rewrite it — and the *Current
  Phase* heading, the ladder table above and the `← START HERE` marker in `BUILD_PLAN.md` — at the
  end of every phase
- **From Phase 28 on, every UI claim is verified in a browser in both Light and Dark**
- **`npm run check` before every commit**; CI is mandatory and a red pipeline is a stop-work
  condition. Then confirm the pipeline actually ran (see *Known Issues*)
- **Every bug fixed gets a test that fails without the fix**
- **Warm the service before timing anything**: it is at `min-instances 0`, so the first request takes
  ~6.4 s and Neon's wake adds ~1 s

---

## Recent Changes

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

**2026-10-06** — Chapter 3 planned and documented. Deployed revision `agentforge-00061-lwl`
unchanged since 2026-10-01. **Next: Phase 26.**
