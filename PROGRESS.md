# PROGRESS.md — AgentForge execution state

**The status board.** A fresh session reads this and immediately knows where things stand. Keep it
concise and operational — prune stale detail rather than appending forever. This is not a diary.

---

## Project Status

**Phase 1 is complete.** The application skeleton runs locally and in a container, real Google
sign-in works end to end, and sessions persist in Neon. Verified by signing in through the actual
container image, not just the dev server.

**Phase 2 is blocked on M2 (billing), and only the user can clear it.** Nothing else blocks it.

## Current Phase

**Phase 2 — FIRST DEPLOY** (not started) — `BLOCKED — WAITING FOR MANUAL ACTION (M2)`

## Completed Phases

| Phase | Status |
|---|---|
| **Phase 0** — setup, prerequisites, foundation decision | **COMPLETE** except M2 (billing) |
| **Phase 1** — application skeleton with Google auth | **COMPLETE** — verified in a container |

---

## Phase 1 — what was verified, not just written

- [x] **Scaffold.** Next 16.3.6 App Router, React 19.3.0, `src/` layout. Hand-rolled, not
      `create-next-app` — the repo root already held the docs
- [x] **Database.** Drizzle + `@neondatabase/serverless` over Neon's **pooled** endpoint;
      migrations over the **direct** endpoint. Auth tables only
- [x] **Auth.** Auth.js v5 (`next-auth@5.0.0-beta.32`, exact pin), Google provider,
      **database** session strategy, `@auth/drizzle-adapter`
- [x] **Authenticated shell.** `/` signs in, `/dashboard` is gated server-side, sign-out works
- [x] **`Dockerfile`.** Three-stage, Next `standalone`, non-root, listens on `$PORT` at `0.0.0.0`
- [x] **Health endpoint.** `GET /api/health` does a real `select 1`; 503 when the database is down
- [x] **`README.md`.** Real setup, run, container and migration commands

**Evidence, all from live runs on 2026-09-25:**

| Check | Result |
|---|---|
| `npm run build` | ✓ compiled; all auth/db routes correctly dynamic (`ƒ`) |
| `npx tsc --noEmit` | ✓ clean |
| `npm run db:migrate` | ✓ applied; `user`, `account`, `session`, `verificationToken` confirmed present in Neon by query |
| `docker build` | ✓ 314 MB on `node:26-alpine` |
| Container `/api/health` | ✓ `200`, `database:"reachable"`, **129 ms** warm |
| Google sign-in **through the container** | ✓ completed; redirected to `/dashboard` |
| Session persistence | ✓ survives a full reload |
| Rows written to Neon | ✓ `user` (name/email/avatar), `account` (`google`/`oidc`, correct scopes), `session` (30-day expiry) |
| Repeat sign-in | ✓ links to the **same** user id — no duplicate user |
| Sign-out | ✓ `POST` 200, session row deleted, back to `/` |
| `/dashboard` unauthenticated | ✓ `307` → `/` |
| Secrets in the image | ✓ none — `.dockerignore` excludes `.env`; image holds only `.next`, `node_modules`, `package.json`, `public`, `server.js` |
| Startup with a broken env | ✓ exits **code 1**, serves nothing, lists every missing variable |

## Decisions made this phase — BINDING

| # | Decision | Basis |
|---|---|---|
| D6 | **Driver: `drizzle-orm/neon-http`**, not `neon-serverless` | One HTTP round trip per statement, no pool to manage, ideal for a scale-to-zero container. It has **no transaction support** — verified safe by grepping the installed `@auth/drizzle-adapter`, which issues none. Swap point is confined to `src/db/index.ts` if Phase 3's engine needs one |
| D7 | **A misconfigured container must exit, not serve** | Found by testing: when `register()` merely throws, Next keeps listening on `$PORT` and answers **HTTP 500 to every request**. Cloud Run would read the open port as healthy, shift traffic, and serve nothing but errors. `src/instrumentation.ts` now calls `process.exit(1)` in production |
| D8 | **`agentRules: false` in `next.config.ts`** | `next dev` otherwise appends a generated block to `CLAUDE.md` on every run. That file is the hand-authored operating contract and must not churn; its useful content was folded in deliberately instead |
| D9 | **No middleware.** Route protection is a server-side `auth()` check in the page | Next 16 renamed `middleware` to `proxy` with no edge runtime, and database sessions cannot be read from the edge anyway. One fewer moving part |

## Corrections to the documentation — material

1. **`DATABASE_URL_UNPOOLED` is not a server-runtime variable.** `CONTRACT.md` listed it under
   *Runtime — required*. Only `drizzle.config.ts` reads it; the running container never opens the
   direct endpoint. Requiring it at startup would make Cloud Run refuse to boot over a variable the
   app never uses. Left in the contract, note corrected, excluded from the startup check.
2. **The auth schema is Phase 1, not Phase 3.** `ARCHITECTURE.md` said "schema and migrations are
   written in Phase 3." Phase 1 cannot persist a session without `user`/`account`/`session`, and
   `BUILD_PLAN.md` Phase 1 asks for exactly that. Corrected; workflow tables remain Phase 3.
3. **Next 16 diverges from training data**, enough to matter: request APIs are async, `middleware`
   is renamed `proxy`, `next lint` is removed, Turbopack is the default builder. The version's own
   docs ship at `node_modules/next/dist/docs/`. A standing instruction to read them was added to
   `CLAUDE.md` → *Framework docs*.

---

## Known Issues

| Issue | Impact | Action |
|---|---|---|
| ~~Docker daemon not running~~ | — | ✅ **RESOLVED 2026-09-25.** Docker Desktop started; image built and ran |
| **4 moderate `npm audit` findings, all one root cause** | None in production | esbuild's dev-server CORS issue, reachable only through `drizzle-kit` → `@esbuild-kit/esm-loader`. `drizzle-kit` is a devDependency, its esbuild dev server never runs, and it is absent from the runtime image. **Accepted.** `npm audit fix --force` would break `drizzle-kit` |
| **OAuth consent screen is in `Testing`** | Demo day | Only listed test users can sign in — currently just the developer. Before the demo: publish the app, or add each judge as a test user (cap 100) |
| **Discord rejects requests with no `User-Agent`** | Phase 9 Discord node | Default Python UA returned **403, Cloudflare 1010**; an explicit UA returned 200 |
| **`gemini-2.0-flash` is retired** | Phases 6, 7 | API returns 404, points to `gemini-3.8-flash`. List models, never assume a name |
| **Pinned Gemini models return 503 under load** | Demo reliability | `gemini-3.8-flash` pinned returned 503 while `gemini-flash-latest` succeeded the same second. The adapter needs retry + a fallback chain |
| **Gemini first call took ~8.9 s** | Demo pacing | Warm the model before the demo alongside Cloud Run and Neon |
| **Neon cold query cost ~670 ms** | Demo beat 1 | Measured this phase: 670 ms cold vs **129 ms** warm. Confirms the autosuspend risk quantitatively |

Carried risks, recorded so they are not rediscovered:

| Risk | Where it bites | Mitigation |
|---|---|---|
| Cloud Run cold start + Neon autosuspend make the first request slow | Demo beat 1 | `min-instances=1`; warm both tiers pre-demo (`DEMO.md`) |
| In-flight runs die on redeploy — no queue | Any deploy during a run | Do not deploy on demo day; interrupted runs must read as failed |
| OAuth production redirect URI cannot exist before the first deploy | Phase 2 | Two-pass manual action — M7 below |
| Only one LLM provider available | `PRD.md` C10 / S1 | Provider-agnostic adapter; model selection across Gemini tiers |
| Auth.js v5 is a beta | Phases 1–2 | Pinned to exact `5.0.0-beta.32`; never track the `beta` tag |
| Rotating `ENCRYPTION_KEY` destroys all stored credentials | Any time | Never rotate it |

---

## Manual Actions Pending

| # | Action | Status |
|---|---|---|
| M2 | Link a billing account (activate the $300 / 90-day trial) | ❌ **OUTSTANDING — user only.** Needs card details, which Claude Code will not enter. **Blocks Phase 2 entirely** |
| M7 | Add the **production** redirect URI to the OAuth client | Due in Phase 2, immediately after the first deploy |

M1, M3, M4, M5, M6 are all **done and verified with live calls** — see *Cloud Resource Inventory*.

**M2 gates API enablement, not just deployment.** Verified: `gcloud services enable` for `run`,
`cloudbuild`, `artifactregistry` and `cloudscheduler` is rejected with
`UREQ_PROJECT_BILLING_NOT_FOUND`. `apikeys` and `generativelanguage` enabled fine without it, which
is why M5 completed.

```text
MANUAL ACTION REQUIRED

Reason:
Billing gates more than deployment. `gcloud services enable` for run, cloudbuild,
artifactregistry and cloudscheduler is rejected with UREQ_PROJECT_BILLING_NOT_FOUND until a
billing account is linked. Without it Phase 2 cannot start at all.

Location:
https://console.cloud.google.com/billing?project=agentforge-hackathon-2026

Steps:
1. Open the URL above.
2. Activate the free trial if offered, to receive the $300 / 90-day credit.
3. Link the billing account to the project AgentForge (agentforge-hackathon-2026).

Values to enter:
None beyond the card details Google requires. Claude Code will not enter these.

Expected result:
The project shows under the billing account with status Active.

Verification:
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com cloudscheduler.googleapis.com

Resume by:
Saying "billing is linked".
```

---

## Deployed State

**Nothing is deployed.**

| Field | Value |
|---|---|
| URL | None — created in Phase 2 |
| Service | `agentforge` on Cloud Run — not created |
| Region | **`asia-southeast1`** (Singapore) |
| Database | Neon `super-mountain-39872886`, region `aws-ap-southeast-1` — **live, auth tables applied** |
| Last verified | 2026-09-25 (database only) |

Phase 2 is **non-negotiable**: if the deployment is not live and reachable at the end of that
session, stop and tell the user rather than proceeding to Phase 3.

---

## Cloud Resource Inventory

**Check this before creating anything.** Real values, verified by live calls.

| Resource | Provider | Identifier | Status |
|---|---|---|---|
| `AgentForge` git repository | GitHub | `arunishrajput/AgentForge` | **EXISTS** — push + pull verified |
| Google Cloud project | Google Cloud | **`agentforge-hackathon-2026`** | **EXISTS** (`agentforge-mvp` was taken globally) |
| OAuth consent screen | Google Cloud | External, app "AgentForge" | **EXISTS** — status **Testing**, 1 test user |
| OAuth 2.0 client | Google Cloud | **"AgentForge Web"**, client id `733000675212-…ntm7` | **VERIFIED** — localhost redirect completes a real sign-in |
| Neon Postgres project | Neon | `agentforge`, id **`super-mountain-39872886`** | **EXISTS** — free plan |
| Neon branch / database / role | Neon | `production` / `neondb` / `neondb_owner` | **VERIFIED** — PostgreSQL 18.6 |
| Neon tables | Neon | `user`, `account`, `session`, `verificationToken` | **APPLIED 2026-09-25** — migration `0000_dark_paladin` |
| Neon region | Neon | **`aws-ap-southeast-1`** (Singapore) | matches the Cloud Run region decision |
| Discord server / channel / webhook | Discord | "AgentForge" · `#agentforge-demo` | **VERIFIED** — test post HTTP 200 |
| Gemini API key | Google Cloud | "AgentForge Gemini", restricted to `generativelanguage.googleapis.com` | **VERIFIED** — real model call |
| `agentforge` Cloud Run service | Google Cloud | — | Not created — Phase 2 |
| `agentforge-cron` Scheduler job | Google Cloud | — | Not created — Phase 8 |

### Local `.env` — populated, gitignored, never committed

All 15 contract variables have values; `.env.example` mirrors `CONTRACT.md` exactly (checked by
diff this phase). `git check-ignore` confirms `.env` is ignored.

### Installed stack — actual `npm ls`, 2026-09-25

`next` 16.3.6 · `react` / `react-dom` 19.3.0 · `next-auth` **5.0.0-beta.32** ·
`@auth/drizzle-adapter` 1.11.3 · `drizzle-orm` 0.45.3 · `drizzle-kit` 0.31.11 ·
`@neondatabase/serverless` 1.1.0 · `zod` 4.6.5 · `tailwindcss` 4.3.3 · `typescript` 7.0.2

`@xyflow/react` and `ai` are **deliberately not installed yet** — they arrive with the canvas
(Phase 4) and the agent layer (Phase 6).

### Local toolchain

`git` 2.54.0 · `gh` 2.98.0 (authenticated) · `node` v26.8.2 · `npm` 11.19.1 ·
`docker` 29.7.2 (**daemon running**) · `gcloud` 580.0.0 (authenticated, project + region set)

⚠️ `gcloud auth application-default login` has **not** been run — there is no ADC file. Nothing
needs it yet.

---

## Open, but blocking nothing

**Project licence.** Harvest inherits nothing copyleft and every adopted dependency is permissive
(React Flow MIT, Vercel AI SDK Apache-2.0, Auth.js ISC, Drizzle Apache-2.0, Next MIT). MIT is the
obvious default. **Left to the user deliberately** — it governs whether others may commercialise
the work. Say the word and it takes one file.

---

## Recent Changes

**2026-09-25 — Phase 1 complete**

- Scaffolded the Next 16 app, wired Drizzle to Neon, and landed Auth.js v5 with Google sign-in and
  database-backed sessions
- Applied the auth migration to Neon and confirmed the tables by query, not by exit code
- Wrote the `Dockerfile` now rather than in Phase 2; built it, ran it, and completed a **real Google
  sign-in through the container**, then verified the resulting rows in Neon
- **Found and fixed a Phase 2 trap (D7):** a container with a broken environment kept listening and
  returned 500 to every request, which Cloud Run would have promoted as healthy. It now exits 1
- Corrected `CONTRACT.md` (`DATABASE_URL_UNPOOLED` is not a runtime variable) and `ARCHITECTURE.md`
  (the auth schema belongs to Phase 1); added `CLAUDE.md` → *Framework docs*
- Measured Neon cold vs warm latency: **670 ms → 129 ms**

---

## Next Phase

**Phase 2 — FIRST DEPLOY.** Definition in `BUILD_PLAN.md`. Everything it needs exists except
billing.

## Next Recommended Action

**Clear M2, then say "billing is linked".** The manual action block is above. Phase 2 cannot begin
without it — not even the API enablement step.

Once billing is live, Phase 2 is: enable the four APIs → `gcloud run deploy` → capture the real URL
→ M7 (add the production redirect URI) → set production env vars → verify a real sign-in against the
deployed URL.

---

## Last Updated

**2026-09-25** — Phase 1 complete and verified in a container. Phase 2 blocked on M2 only.
