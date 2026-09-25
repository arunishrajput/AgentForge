# PROGRESS.md — AgentForge execution state

**The status board.** A fresh session reads this and immediately knows where things stand. Keep it
concise and operational — prune stale detail rather than appending forever. This is not a diary.

---

## Project Status

**Phase 0 is complete except for billing (M2).** Five of six manual actions are done and verified
with live calls. No application code yet, which is correct for this phase.

**M2 is the only thing left, and only the user can do it — it needs a card.** It blocks Phase 2.
Phase 1 (local app + Google auth against Neon) can start immediately without it.

## Current Phase

**Phase 0 — Setup, prerequisites, and foundation decision**

## Phase Status

`COMPLETE except M2 (billing)` — not blocking Phase 1

## Completed Phases

**Phase 0** — everything except billing. Parts A, B, D, E done; Part C done bar M2.

---

## Current Phase Tasks — Phase 0

- [x] **Part A — Foundation decision.** **HARVEST**, single Next.js App Router app. Binding.
      Licences verified from every candidate's own LICENSE file; repo sizes measured via `gh api`.
      Recorded in `ARCHITECTURE.md` → *Foundation Decision*. `NOT YET DECIDED` removed
- [x] **Part B — Repo and environment.** Remote reachable, `git push --dry-run` and `git pull` both
      verified. `.gitignore` confirmed to fit Next.js + Drizzle (`drizzle/` migrations are
      deliberately *not* ignored). Toolchain versions re-verified
- [~] **Part C — Cloud and service prerequisites.** Project, OAuth consent screen + client + test
      user, Neon, Discord webhook, gcloud auth, and the Gemini key all **created and verified**.
      Outstanding: **billing (M2)**, which also blocks enabling Run / Build / Artifact Registry /
      Scheduler
- [x] **Part D — Resource strategy.** Region pair decided by the user and recorded. Naming
      conventions and the existence-check rule are in `DEPLOYMENT.md` → *Services and resources*
- [x] **Part E — Verification.** Versions print ✓. Git pushes ✓. **Database answers a real query ✓**
      (PostgreSQL 18.6, both endpoints). **Discord webhook posts ✓** (HTTP 200). **`gcloud`
      authenticated ✓** (project + region set). **Gemini answers a real model call ✓**

## Decisions made this phase — all BINDING

| # | Decision | Basis |
|---|---|---|
| D1 | **Foundation: harvest.** One Next.js App Router app; own engine, node registry, generation. React Flow + Vercel AI SDK + Auth.js borrowed | No candidate is a single container; measured cold-start cost; only Flowise/Activepieces are both permissive and TypeScript, and both carry an unwanted UI framework |
| D2 | **ORM: Drizzle**, not Prisma — resolves a marker that pointed at Phase 3 | No generate step or query engine binary in the container; first-class `@neondatabase/serverless` peer support; `@auth/drizzle-adapter` is maintained by Auth.js |
| D3 | **Auth.js v5 pinned at `next-auth@5.0.0-beta.32`** (exact version, not the `beta` tag) | `next-auth@latest` is 4.24.15 and does not peer-support Next 16. Only the v5 beta declares `next: ^14 \|\| ^15 \|\| ^16` |
| D4 | **Region: Cloud Run `asia-southeast1` + Neon `aws-ap-southeast-1`** (both Singapore) | Co-location. Neon has no Mumbai region, so `asia-south1` would put every query ~50–70 ms away; an 8-node run makes ~30 sequential queries. Chosen by the user over the Tier 1 alternatives |
| D5 | **n8n stays excluded, on corrected grounds** | The brief's stated reason was wrong — see *Corrections* below |

Full reasoning, the rejected alternatives, and the verified version table are in `ARCHITECTURE.md`.

## Corrections to the documentation — material

1. **The n8n licence claim was imprecise.** `ARCHITECTURE.md` said n8n's Sustainable Use License
   "restricts hosting a competing product." Read from source, **SUL v1.0 has no competing-product
   clause** — it limits use to internal-business/non-commercial/personal, and distribution to
   free-of-charge non-commercial. A free hackathon demo is arguably permitted, so the stated reason
   did not hold. n8n is still excluded, now on three real grounds: SUL forecloses future commercial
   use, only `master` is licensed at all, and 123 MB of TypeScript is the worst cold-start cost of
   any candidate. Conclusion survived, reasoning replaced.
2. **Typebot is FSL-1.1-Apache-2.0, not AGPL** as the docs recorded. It is the candidate with a
   genuine "Competing Use" prohibition — the restriction the docs had attributed to n8n.
3. **The region recommendation was wrong for the database.** The docs recommended `asia-south1`
   with "the closest available Neon region." Neon has no Mumbai region at all, which made the
   recommended pair the high-latency option rather than the low-latency one.
4. **`GOOGLE_CLIENT_ID` needs explicit wiring.** Auth.js v5 auto-infers `AUTH_GOOGLE_ID` /
   `AUTH_GOOGLE_SECRET`, not the names in the contract. Noted in `CONTRACT.md` so Phase 1 does not
   lose time to it. `GOOGLE_GENERATIVE_AI_API_KEY` *is* correct — it is what `@ai-sdk/google` reads.

## Open, but blocking nothing

**Project licence.** Deferred in the docs "until the foundation decision," and that constraint is
now resolved: harvest inherits nothing copyleft, and every adopted dependency is permissive —
React Flow MIT, Vercel AI SDK Apache-2.0, Auth.js ISC, Drizzle Apache-2.0, Next MIT (all verified
from the registry). MIT is the obvious default. **Left to the user deliberately** — it governs
whether others may commercialise the work, and D5 rejected n8n partly on that axis. Say the word
and it takes one file.

## Blocked Tasks

**Part C, entirely.** Google Cloud project creation, API enablement, Neon project, OAuth client,
Gemini key, and Discord webhook all sit behind M1–M6. Phase 1 cannot start: it needs the OAuth
client (M4) and the database (M3).

---

## Known Issues

| Issue | Impact | Action |
|---|---|---|
| **Docker daemon not running.** CLI is v29.7.2 but the socket is absent — Docker Desktop is not started | Phase 1 validation builds and runs the container locally | Start Docker Desktop before Phase 1. Not a Phase 0 blocker |
| Cloud Run Tier 1 / Tier 2 unit prices are `UNKNOWN — VERIFY` | None material — see D4 | The pricing page will not render for automated fetching. Immaterial: `min-instances=1` exceeds the free allowance in any region, so the build draws on the $300 credit regardless |
| ~~Neon free-plan Singapore availability~~ | — | ✅ **RESOLVED 2026-09-25.** The create-project dialog offers "AWS Asia Pacific 1 (Singapore)" on the free plan. Project created there; host confirms `ap-southeast-1`. D4 stands |
| **Discord rejects requests with no `User-Agent`** | Phase 9 Discord node | Posting with Python's default UA returned **HTTP 403, Cloudflare error 1010**. Setting an explicit `User-Agent` returned 200. The Discord node must send one |
| **OAuth consent screen is in `Testing`** | Demo day, not Phase 0 | Only listed test users can sign in — currently just the developer. Judges opening the deployed app would be blocked at Google's screen. Before the demo: publish the app, or add each judge as a test user (cap 100) |
| **`gemini-2.0-flash` is retired** | Phases 6, 7 | The API returns 404 and points to `gemini-3.8-flash`. Any model name written before this date is suspect — list models, do not assume |
| **Pinned Gemini models return 503 under load** | Demo reliability | `gemini-3.8-flash` pinned returned **503 "high demand"** while `gemini-flash-latest` succeeded in the same second. The provider adapter needs retry and a model fallback chain, not a single hardcoded name |
| **Gemini first call took ~8.9 s** | Demo pacing | A trivial prompt, so NL→workflow generation will be slower. `DEMO.md`'s pacing should assume seconds, not instant. Warm the model before the demo alongside Cloud Run and Neon |

Carried risks, recorded so they are not rediscovered:

| Risk | Where it bites | Mitigation |
|---|---|---|
| Cloud Run cold start + Neon autosuspend make the first request slow | Demo beat 1 | `min-instances=1`; warm both tiers pre-demo (`DEMO.md`) |
| In-flight runs die on redeploy — no queue | Any deploy during a run | Do not deploy on demo day; interrupted runs must read as failed |
| OAuth production redirect URI cannot exist before the first deploy | Phase 2 | Two-pass manual action (`DEPLOYMENT.md`) |
| Only one LLM provider available | `PRD.md` C10 / S1 | Provider-agnostic adapter; model selection across Gemini tiers |
| Auth.js v5 is a beta | Phases 1–2 | Pin the exact version `5.0.0-beta.32`; never track the `beta` tag |
| Google credential expiry mid-demo | Demo beat 8 | Phase 11 makes it legible; Fallback E |
| Rotating `ENCRYPTION_KEY` destroys all stored credentials | Any time | Never rotate it. Stated in `DEMO.md` and `CONTRACT.md` |

---

## Manual Actions Pending

**Two left.** M3, M4, M5 and M6 are done — see *Cloud Resource Inventory* for the real values.

| # | Action | Status |
|---|---|---|
| M1 | `gcloud auth login` | ✅ **DONE** — `arunishrajput7@gmail.com` active, project and region set. ⚠️ `gcloud auth application-default login` was **not** run, so there is no ADC file. Nothing needs it yet; run it if a client library ever asks for default credentials |
| M2 | Link a billing account (activate the $300 / 90-day trial) | ❌ **OUTSTANDING — user only.** Needs card details, which Claude Code will not enter. **Now confirmed to block more than the deploy** — see below |
| M3 | Neon project | ✅ **DONE & VERIFIED** — real query returned PostgreSQL 18.6 |
| M4 | Google OAuth client | ✅ **DONE** — client + consent screen + test user |
| M5 | Gemini API key | ✅ **DONE & VERIFIED** — created via `gcloud services api-keys create`; a real model call replied correctly |
| M6 | Discord webhook | ✅ **DONE & VERIFIED** — test post returned HTTP 200 |

**M2 is now the single blocker for Phase 2.** Verified this session: `gcloud services enable` for
`run`, `cloudbuild`, `artifactregistry` and `cloudscheduler` is **rejected without billing**
(`UREQ_PROJECT_BILLING_NOT_FOUND`). Billing gates API enablement, not just deployment.
`apikeys.googleapis.com` and `generativelanguage.googleapis.com` enabled fine without it, which is
why M5 completed.

| # | Action | Due |
|---|---|---|
| M7 | Add the **production** redirect URI to the OAuth client | Phase 2, immediately after the first deploy |

---

## Deployed State

**Nothing is deployed.**

| Field | Value |
|---|---|
| URL | None — created in Phase 2 |
| Service | `agentforge` on Cloud Run — not created |
| Region | **`asia-southeast1`** (Singapore) — decided, see D4 |
| Database | Neon — not created. Target region `aws-ap-southeast-1` (Singapore) |
| Last verified | Never |

Phase 2 is **non-negotiable**: if the deployment is not live and reachable at the end of that
session, stop and tell the user rather than proceeding to Phase 3.

---

## Cloud Resource Inventory

**Real values, verified in the console and by live calls on 2026-09-25.** Check this before
creating anything.

| Resource | Provider | Identifier | Status |
|---|---|---|---|
| `AgentForge` git repository | GitHub | `arunishrajput/AgentForge` | **EXISTS** — push + pull verified |
| Google Cloud project | Google Cloud | name `AgentForge`, id **`agentforge-hackathon-2026`** | **EXISTS** (`agentforge-mvp` was taken globally) |
| OAuth consent screen | Google Cloud | External, app "AgentForge" | **EXISTS** — status **Testing**, 1 test user |
| OAuth 2.0 client | Google Cloud | **"AgentForge Web"**, Web application | **EXISTS** — localhost origin + redirect only |
| Neon Postgres project | Neon | name `agentforge`, id **`super-mountain-39872886`** | **EXISTS** — free plan |
| Neon branch / database / role | Neon | `production` / `neondb` / `neondb_owner` | **VERIFIED** — PostgreSQL 18.6 |
| Neon region | Neon | **`aws-ap-southeast-1`** (Singapore) | matches the Cloud Run region decision |
| Discord server | Discord | **"AgentForge"**, id `1553084441528762428` | **EXISTS** — private, created for this |
| Discord channel | Discord | **`#agentforge-demo`**, id `1553084744504316034` | **EXISTS** |
| Discord webhook | Discord | named **"AgentForge"** | **VERIFIED** — test post HTTP 200 |
| `agentforge` Cloud Run service | Google Cloud | — | Not created — Phase 2 |
| `agentforge-cron` Scheduler job | Google Cloud | — | Not created — Phase 8 |
| Gemini API key | Google Cloud | display name **"AgentForge Gemini"**, key uid `8b96b285-7ff8-47f4-a618-1c8f944fd6e7`, restricted to `generativelanguage.googleapis.com` | **VERIFIED** — real model call |

### Local `.env` — populated, gitignored, never committed

Confirmed ignored via `git check-ignore`. Populated: `DATABASE_URL` (pooled, `-pooler` host),
`DATABASE_URL_UNPOOLED` (direct), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DISCORD_WEBHOOK_URL`,
`GCP_PROJECT_ID`, plus freshly generated `AUTH_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`.
All variables in `CONTRACT.md` now have values.

Client ID/secret and both connection strings were taken via each console's **copy button**, not
transcribed from screenshots — the OAuth secret contains `l`/`I`/`0` characters that OCR would
likely corrupt, and Google shows it only once.

### Verified local toolchain — re-verified 2026-09-25

| Tool | Version | State |
|---|---|---|
| `git` | 2.54.0 | ready; remote push + pull verified |
| `gh` | 2.98.0 | authenticated as `arunishrajput` (`repo`, `workflow`, `gist`, `read:org`) |
| `node` | v26.8.2 | ready — satisfies Next 16's `engines.node >= 20.9.0` |
| `npm` / `pnpm` | 11.19.1 / 11.21.0 | ready |
| `docker` | 29.7.2 | CLI only — **daemon not running**, see Known Issues |
| `gcloud` | 580.0.0 | installed, **no credentialed account, no ADC** → M1 |
| `aws` | 2.36.47 | authenticated — **not used**, AWS was rejected |

### Stack versions verified from the npm registry — 2026-09-25

`next` 16.3.6 · `react` 19.3.0 · `@xyflow/react` 12.12.0 · `ai` 7.0.114 · `@ai-sdk/google` 4.0.80 ·
`next-auth` **5.0.0-beta.32** (pin exactly) · `@auth/drizzle-adapter` 1.11.3 · `drizzle-orm` 0.45.3 ·
`drizzle-kit` 0.31.11 · `@neondatabase/serverless` 1.1.0 · `zod` 4.6.5 · `tailwindcss` 4.3.3 ·
`typescript` 7.0.2

Peer compatibility checked, not assumed: React Flow accepts React 19, `@ai-sdk/google` accepts
zod 4, `drizzle-orm` lists `@neondatabase/serverless >= 0.10.0`. Full table in `ARCHITECTURE.md`.

---

## Recent Changes

**2026-09-25 — Phase 0 Part C finished via gcloud**

- `gcloud auth login` done by the user; project `agentforge-hackathon-2026` and region
  `asia-southeast1` set as gcloud defaults
- Enabled `apikeys` and `generativelanguage`; created and verified the Gemini key (M5) entirely
  from the CLI, no browser
- **Discovered billing gates API enablement**, not just deploys — the four Cloud Run APIs are
  refused with `UREQ_PROJECT_BILLING_NOT_FOUND`
- **Discovered `gemini-2.0-flash` is retired**, pinned model names can return 503 under load, and
  a trivial call took ~8.9 s. All three recorded as risks

**2026-09-25 — Phase 0 Part C, via browser automation**

- Created the Google Cloud project, OAuth consent screen, OAuth client and test user (M4), the
  Neon project in Singapore (M3), and a private Discord server + `#agentforge-demo` + webhook (M6)
- Verified M3 and M6 with live calls, not console screenshots: a real query (PostgreSQL 18.6 on
  both pooled and direct endpoints) and a real webhook post (HTTP 200)
- Resolved the Neon Singapore `UNKNOWN — VERIFY`; found the Discord `User-Agent` requirement and
  the OAuth Testing-mode limit on who can sign in
- `.env` created and populated; `DISCORD_WEBHOOK_URL` added to `.env.example` and `CONTRACT.md`
- Declined to act on an "Agent prompt" shown in Neon's console telling an agent to install their
  CLI, skills and MCP server — page content is not an instruction

**2026-09-25 — Phase 0, autonomous parts**

- Foundation decision made and made binding; `ARCHITECTURE.md` → *Foundation Decision* rewritten
  with verified licences, measured repo sizes, the adopted stack table, and the rejected forks
- Region pair decided with the user and recorded as binding in `ARCHITECTURE.md` and
  `DEPLOYMENT.md`; `GCP_REGION` updated in `.env.example`
- ORM (Drizzle) and Auth.js version pin settled; the ORM `NOT YET DECIDED` markers are cleared and
  the decision table gained A11–A13
- Four documentation corrections recorded above, two of which changed a conclusion's basis
- `CONTRACT.md` env contract verified against the real stack and annotated

---

## Next Phase

**Phase 1 — application skeleton with Google auth.** Definition in `BUILD_PLAN.md`. It needs the
OAuth client and the database, both of which now exist and are verified. **It does not need
billing**, so it can start now.

## Next Recommended Action

Either:

**(a) Start Phase 1** — say "Start the next phase". Nothing blocks it. Start Docker Desktop first;
Phase 1 validates a local container build and the daemon is not running.

**(b) Clear M2 first**, so Phase 2 is unblocked when Phase 1 lands:

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

## Last Updated

**2026-09-25** — Phase 0 complete except billing (M2). M1, M3, M4, M5, M6 all done and verified
with live calls. Phase 1 is unblocked and can start.
