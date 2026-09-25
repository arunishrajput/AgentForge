# PROGRESS.md — AgentForge execution state

**The status board.** A fresh session reads this and immediately knows where things stand. Keep it
concise and operational — prune stale detail rather than appending forever. This is not a diary.

---

## Project Status

**Phase 2 is complete. AgentForge is live.**

**https://agentforge-733000675212.asia-southeast1.run.app**

Google sign-in works in production, verified by a full sign-in → reload → sign-out cycle in a real
browser with each step proved against the database. No manual actions remain.

## Current Phase

**Phase 3 — data model + node registry + execution engine core** (not started) — `READY TO START`

## Completed Phases

| Phase | Status |
|---|---|
| **Phase 0** — setup, prerequisites, foundation decision | **COMPLETE** |
| **Phase 1** — application skeleton with Google auth | **COMPLETE** — verified in a container |
| **Phase 2** — first deploy, auth in production | **COMPLETE** — verified in a browser, 2026-09-25 |

---

## Deployed State

| Field | Value |
|---|---|
| **Canonical URL** | **`https://agentforge-733000675212.asia-southeast1.run.app`** |
| Legacy URL | `https://agentforge-i5d2u66boa-as.a.run.app` — works, do not publish it |
| Service | `agentforge` on Cloud Run, `asia-southeast1` |
| Revision | `agentforge-00001-h4k` — ready, 100% of traffic |
| Image | `agentforge@sha256:844a2c1e…f52c983a`, built by Cloud Build `63bc2468` |
| Scaling | `min-instances 1`, `max-instances 3`, 1 vCPU / 1 GiB, 3600 s timeout, port 8080 |
| Env vars set | `NODE_ENV` `AUTH_URL` `APP_BASE_URL` `DATABASE_URL` `AUTH_SECRET` `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` `ENCRYPTION_KEY` `CRON_SECRET` — 9, names confirmed, values never printed |
| Database | Neon `super-mountain-39872886`, `aws-ap-southeast-1` — auth tables applied |
| Warm latency | ~440 ms round trip India → Singapore; database 9–22 ms |
| Last verified | **2026-09-25** — see the evidence table below |

**One revision exists, so rollback is documented but untested.** First chance to test it is the
Phase 3 deploy.

---

## Phase 2 — what was verified, not just written

| Check | Result |
|---|---|
| `gcloud run deploy --source .` | ✓ built and deployed first try; no Dockerfile changes needed |
| Revision ready and serving | ✓ `agentforge-00001-h4k`, 100% traffic |
| `GET /api/health` | ✓ `200`, `database:"reachable"` |
| `GET /` | ✓ `200`, sign-in page renders |
| `GET /dashboard` unauthenticated | ✓ `307` → `/` |
| Startup logs | ✓ Next 16.3.6 ready, no errors, no env failure |
| Env var names on the service | ✓ all 9, no values logged |
| Auth cookies in production | ✓ `__Secure-authjs.pkce.code_verifier`, `Secure`, `HttpOnly`, `SameSite=Lax` — HTTPS correctly detected behind Cloud Run's proxy |
| `redirect_uri` the app actually sends | ✓ exactly the registered production URI |
| **Google sign-in on the deployed URL** | ✓ completed in a browser, landed on `/dashboard` |
| Session persists across reload | ✓ re-navigated to `/dashboard`, still signed in |
| Database effect of sign-in | ✓ `session` 1 → 2, **same `userId`**, `user` stayed 1 — account linking correct, no duplicate user |
| Sign-out in production | ✓ `POST 200 /dashboard`, session row deleted, `user` and `account` intact |

---

## Decisions — BINDING

Carried forward from every phase. These are the decisions later sessions must not quietly undo.

| # | Decision | Basis |
|---|---|---|
| D6 | **Driver: `drizzle-orm/neon-http`**, not `neon-serverless` | One HTTP round trip per statement, no pool to manage, ideal for a scale-to-zero container. It has **no transaction support** — verified safe by grepping the installed `@auth/drizzle-adapter`, which issues none. Swap point is confined to `src/db/index.ts` if Phase 3's engine needs one |
| D7 | **A misconfigured container must exit, not serve** | Found by testing: when `register()` merely throws, Next keeps listening on `$PORT` and answers **HTTP 500 to every request**. Cloud Run would read the open port as healthy, shift traffic, and serve nothing but errors. `src/instrumentation.ts` calls `process.exit(1)` in production |
| D8 | **`agentRules: false` in `next.config.ts`** | `next dev` otherwise appends a generated block to `CLAUDE.md` on every run. That file is the hand-authored operating contract and must not churn |
| D9 | **No middleware.** Route protection is a server-side `auth()` check in the page | Next 16 renamed `middleware` to `proxy` with no edge runtime, and database sessions cannot be read from the edge anyway. One fewer moving part |
| D10 | **The deterministic URL is canonical.** `https://agentforge-733000675212.asia-southeast1.run.app` | Cloud Run issues two URLs. `status.url` returns the *legacy hashed* one, so the obvious command yields the wrong origin for `AUTH_URL` and breaks production sign-in. The deterministic form is also predictable, which is what makes OAuth pre-registration possible |
| D11 | **Production env vars go on the deploy command via `--env-vars-file`** | Two reasons. D7 makes a revision with a missing variable exit 1, so deploying bare and configuring after would fail the deploy. And `--set-env-vars` splits on `,` and `=`, which connection strings and base64 secrets contain, besides putting every secret in shell history and the process list |
| D12 | **`.gcloudignore` is committed** | Without one, gcloud writes an untracked file on first deploy whose contents nobody reviews. It governs what leaves the machine, so it is reviewed and version-controlled |
| D13 | **`DATABASE_URL_UNPOOLED` is not set on the service** | Confirms the Phase 1 contract correction in production. Only `drizzle.config.ts` reads it; setting it would widen the production secret surface for a variable the app never uses |

---

## Resolved unknowns

**`UNKNOWN — VERIFY` → RESOLVED: the deployed URL *can* be pre-registered with OAuth before the
first deploy.** The deterministic form is `https://<service>-<project-number>.<region>.run.app`,
and both parts are knowable in advance (`gcloud projects describe <project>
--format='value(projectNumber)'`). The predicted URL matched the deployed one character for
character. A rebuild from scratch can register OAuth before deploying and skip the two-pass dance.

---

## Known Issues

| Issue | Impact | Action |
|---|---|---|
| **Google OAuth changes take ~90 s to propagate** | Cost 90 s this phase | First sign-in attempt after saving returned `redirect_uri_mismatch` despite a character-identical registered URI; it succeeded ~90 s later unchanged. **Wait and retry before suspecting a typo** |
| **A curl check cannot detect `redirect_uri_mismatch`** | Nearly caused a false "verified" | Without a Google session, Google serves the ordinary sign-in page and validates `redirect_uri` only after identifying the account. Only a real browser sign-in proves it |
| **`min-instances 1` bills continuously** | Cost, after the hackathon | Funded by the $300 credit now. **Set to 0 once judging ends** or it exceeds Always Free |
| **OAuth consent screen is in `Testing`** | Demo day | Only listed test users can sign in — currently just the developer. Before the demo: publish the app, or add each judge as a test user (cap 100) |
| **4 moderate `npm audit` findings, one root cause** | None in production | esbuild's dev-server CORS issue, reachable only through `drizzle-kit` → `@esbuild-kit/esm-loader`. Dev dependency, absent from the runtime image. **Accepted** — `npm audit fix --force` breaks `drizzle-kit` |
| **Discord rejects requests with no `User-Agent`** | Phase 9 Discord node | Default Python UA returned 403, Cloudflare 1010; an explicit UA returned 200 |
| **`gemini-2.0-flash` is retired** | Phases 6, 7 | API returns 404, points to `gemini-3.8-flash`. List models, never assume a name |
| **Pinned Gemini models return 503 under load** | Demo reliability | `gemini-3.8-flash` pinned returned 503 while `gemini-flash-latest` succeeded the same second. The adapter needs retry + a fallback chain |
| **Gemini first call took ~8.9 s** | Demo pacing | Warm the model before the demo alongside Cloud Run and Neon |

Carried risks, recorded so they are not rediscovered:

| Risk | Where it bites | Mitigation |
|---|---|---|
| In-flight runs die on redeploy — no queue | Any deploy during a run | Do not deploy on demo day; interrupted runs must read as failed |
| Only one LLM provider available | `PRD.md` C10 / S1 | Provider-agnostic adapter; model selection across Gemini tiers |
| Auth.js v5 is a beta | All phases | Pinned to exact `5.0.0-beta.32`; never track the `beta` tag |
| Rotating `ENCRYPTION_KEY` destroys all stored credentials | Any time | Never rotate it |
| Neon autosuspends independently of Cloud Run | Demo beat 1 | **Measured on the deployed service 2026-09-25: 9–22 ms warm, 701 ms after ~6 minutes idle.** `min-instances=1` keeps the container warm but does nothing for Neon. Warm the database separately right before the demo — one real query is enough |

---

## Manual Actions Pending

**None.** M1–M7 are all done and verified with live calls.

| # | Action | Status |
|---|---|---|
| M7 | Add the production redirect URI to the OAuth client | ✅ **DONE & VERIFIED 2026-09-25** — proved by a real browser sign-in, not by inspection |

---

## Cloud Resource Inventory

**Check this before creating anything.** Real values, verified by live calls.

| Resource | Provider | Identifier | Status |
|---|---|---|---|
| `AgentForge` git repository | GitHub | `arunishrajput/AgentForge` | **EXISTS** — push + pull verified |
| Google Cloud project | Google Cloud | `agentforge-hackathon-2026`, number **`733000675212`** | **EXISTS**, billing active ($300 / 90-day trial) |
| **`agentforge` Cloud Run service** | Google Cloud | `asia-southeast1`, revision `agentforge-00001-h4k` | **LIVE 2026-09-25** |
| **`cloud-run-source-deploy` repo** | Artifact Registry | `asia-southeast1` | **EXISTS** — auto-created by the first `--source` deploy |
| OAuth consent screen | Google Cloud | External, app "AgentForge" | **EXISTS** — status **Testing**, 1 test user |
| OAuth 2.0 client | Google Cloud | "AgentForge Web", `733000675212-…ntm7` | **VERIFIED** — 4 redirect entries: 2 localhost, 2 production |
| Neon Postgres project | Neon | `agentforge`, id `super-mountain-39872886` | **EXISTS** — free plan, PostgreSQL 18.6 |
| Neon branch / database / role | Neon | `production` / `neondb` / `neondb_owner` | **VERIFIED** |
| Neon tables | Neon | `user`, `account`, `session`, `verificationToken` | **APPLIED** — migration `0000_dark_paladin` |
| Enabled APIs | Google Cloud | `run`, `cloudbuild`, `artifactregistry`, `cloudscheduler`, `apikeys`, `generativelanguage` | **ENABLED & VERIFIED** |
| Gemini API key | Google Cloud | "AgentForge Gemini", restricted to `generativelanguage.googleapis.com` | **VERIFIED** — real model call |
| Discord server / channel / webhook | Discord | "AgentForge" · `#agentforge-demo` | **VERIFIED** — test post HTTP 200 |
| `agentforge-cron` Scheduler job | Google Cloud | — | Not created — Phase 8 |

**One Neon database serves both local and production.** There is no separate production database,
so migrations applied locally are already live. Worth remembering before assuming a deploy step is
missing — and before running anything destructive locally.

### Local `.env` — populated, gitignored, never committed

All 15 contract variables have values; `.env.example` mirrors `CONTRACT.md`. `git check-ignore`
confirms `.env` is ignored. Production holds the 9 runtime variables, set from a file written
outside the repository and deleted afterwards.

### Installed stack — `npm ls`, 2026-09-25

`next` 16.3.6 · `react` / `react-dom` 19.3.0 · `next-auth` **5.0.0-beta.32** ·
`@auth/drizzle-adapter` 1.11.3 · `drizzle-orm` 0.45.3 · `drizzle-kit` 0.31.11 ·
`@neondatabase/serverless` 1.1.0 · `zod` 4.6.5 · `tailwindcss` 4.3.3 · `typescript` 7.0.2

`@xyflow/react` and `ai` are **deliberately not installed yet** — canvas (Phase 4), agent layer
(Phase 6).

### Local toolchain

`git` 2.54.0 · `gh` 2.98.0 (authenticated) · `node` v26.8.2 · `npm` 11.19.1 ·
`docker` 29.7.2 · `gcloud` 580.0.0 (authenticated, project + region set)

⚠️ `gcloud auth application-default login` has **not** been run — there is no ADC file. Nothing
needs it; `--source` deploys use the user credential.

---

## Notes for Phase 3

- **`@neondatabase/serverless` v1 rejects a raw SQL string.** `sql("select 1")` throws; use
  `sql.query(text, params)`, or the tagged template for interpolated values. Cost time this phase
- **D6 stands, but re-check it.** `drizzle-orm/neon-http` has **no transaction support**. The
  execution engine writes run and node-run rows — if any of that needs a transaction, the swap to
  `neon-serverless` is confined to `src/db/index.ts`. Decide deliberately, do not discover it
- **Migrations are live the moment they are applied.** One Neon database, no staging
- **Every deploy from here ends with the deployed system verified**, per `CLAUDE.md`

---

## Open, but blocking nothing

**Project licence.** Every adopted dependency is permissive (React Flow MIT, Vercel AI SDK
Apache-2.0, Auth.js ISC, Drizzle Apache-2.0, Next MIT). MIT is the obvious default. **Left to the
user deliberately** — it governs whether others may commercialise the work. Say the word and it
takes one file.

---

## Recent Changes

**2026-09-25 — Phase 2 complete, AgentForge is live**

- Deployed to Cloud Run from source; the build and the first revision both succeeded first try
- **Found that the service has two URLs and that `status.url` returns the wrong one** — following
  the documented command would have set `AUTH_URL` to the legacy origin and broken sign-in (D10)
- Predicted the deterministic URL from the project number and pre-registered it with OAuth before
  the deploy finished; it matched exactly, resolving a `UNKNOWN — VERIFY` carried since Phase 0
- Set the 9 runtime variables from a file rather than `--set-env-vars` (D11); committed a reviewed
  `.gcloudignore` (D12)
- Verified production auth end to end in a browser and proved each step against the database:
  sign-in added one session and no second user, reload persisted it, sign-out deleted it
- Recorded two traps in `DEPLOYMENT.md`: OAuth changes take ~90 s to propagate, and a curl check
  for `redirect_uri_mismatch` is a false positive because Google validates only after identifying
  the account

---

## Next Phase

**Phase 3 — data model + node registry + execution engine core.** Definition in `BUILD_PLAN.md`.
Read `CONTRACT.md` before touching the schema.

## Next Recommended Action

**Start Phase 3 in a fresh session** — `/clear`, then "Start the next phase".

Phase 3 is the first phase that must end with a **deploy plus a verified run on the deployed
system**, not just a passing local test. It is also the first chance to test the rollback
procedure, since a second revision will finally exist.

---

## Last Updated

**2026-09-25** — Phase 2 complete. Live at
`https://agentforge-733000675212.asia-southeast1.run.app`, production auth verified in a browser.
No manual actions pending.
