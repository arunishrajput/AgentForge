# PROGRESS.md — AgentForge execution state

**The status board.** A fresh session reads this and immediately knows where things stand. Keep it
concise and operational — prune stale detail rather than appending forever. This is not a diary.

---

## Project Status

**Phase 0 is substantially complete and blocked on the user.** All decisions are made and recorded.
No application code exists yet — correct for this phase.

Every autonomous part of Phase 0 is done: the foundation decision is made and binding, the stack
and its versions are verified from the npm registry, all candidate licences are verified from
source, the region pair is decided, and the repository and toolchain are proven. **Part C — every
cloud resource — cannot start until M1–M6 are done in a browser.**

## Current Phase

**Phase 0 — Setup, prerequisites, and foundation decision**

## Phase Status

`BLOCKED — WAITING FOR MANUAL ACTION` (M1–M6)

## Completed Phases

None. Phase 0 completes when Part C is verified.

---

## Current Phase Tasks — Phase 0

- [x] **Part A — Foundation decision.** **HARVEST**, single Next.js App Router app. Binding.
      Licences verified from every candidate's own LICENSE file; repo sizes measured via `gh api`.
      Recorded in `ARCHITECTURE.md` → *Foundation Decision*. `NOT YET DECIDED` removed
- [x] **Part B — Repo and environment.** Remote reachable, `git push --dry-run` and `git pull` both
      verified. `.gitignore` confirmed to fit Next.js + Drizzle (`drizzle/` migrations are
      deliberately *not* ignored). Toolchain versions re-verified
- [ ] **Part C — Cloud and service prerequisites.** **BLOCKED on M1–M6.** Nothing can proceed:
      `gcloud projects list` fails with "no active account", there is no ADC file, and no gcloud
      configuration has an account or project
- [x] **Part D — Resource strategy.** Region pair decided by the user and recorded. Naming
      conventions and the existence-check rule are in `DEPLOYMENT.md` → *Services and resources*
- [~] **Part E — Verification.** Versions print ✓. Git pushes ✓. `gcloud` authenticated ✗ (M1).
      Database answers a query ✗ (M3)

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
| Neon's free plan may not offer Singapore — `UNKNOWN — VERIFY` | Would invalidate D4 | `neon.com` is unreachable from this environment and the regions API needs a key. The user confirms it visually during M3; the manual action says to stop rather than substitute a region |

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

**All six block Phase 0 Part C and therefore Phase 1.** Exact copy-pasteable blocks are in
`DEPLOYMENT.md` → *One-time setup*. Two carry Phase 0 changes — read them there, not from memory.

| # | Action | Verify with |
|---|---|---|
| M1 | `! gcloud auth login`, then `! gcloud auth application-default login` | `gcloud auth list` |
| M2 | Link a billing account to the project (activate the $300 / 90-day trial) | `gcloud beta billing projects describe <PROJECT_ID>` |
| M3 | Create the Neon project — **region `aws-ap-southeast-1` (Singapore)**, not the default. Copy **both** connection strings | A real query printing the server version |
| M4 | Create the Google OAuth client, **localhost redirect only** | A real local sign-in writing a user row |
| M5 | Obtain a Gemini API key | One minimal model call |
| M6 | Create the Discord webhook for `#agentforge-demo` | One test post |

Later, not yet due:

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

**No cloud resources exist yet — verified, not assumed:** `gcloud projects list` fails for lack of
an active account, and there is no `application_default_credentials.json`. Before creating
anything, check whether it already exists.

| Resource | Provider | Status |
|---|---|---|
| `AgentForge` git repository | GitHub | **EXISTS** — public, `arunishrajput/AgentForge`, push and pull verified |
| Google Cloud project | Google Cloud | Not created — blocked on M1/M2 |
| `agentforge` Cloud Run service | Google Cloud | Not created — Phase 2 |
| OAuth 2.0 client | Google Cloud | Not created — M4 |
| Neon Postgres project | Neon | Not created — M3 |
| `agentforge-cron` Scheduler job | Google Cloud | Not created — Phase 8 |
| Gemini API key | Google AI Studio | Not obtained — M5 |
| Discord webhook | Discord | Not created — M6 |

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

**Finish Phase 0 Part C**, then Phase 1. Definitions in `BUILD_PLAN.md`.

## Next Recommended Action

**Do M1–M6.** The blocks are in `DEPLOYMENT.md` → *One-time setup*; M3 changed this phase, so read
it rather than working from memory. Start with `! gcloud auth login`.

Then say **"M1–M6 are done"** (or name the ones that are). The next session verifies each rather
than assuming it worked — real query, real sign-in, real model call — finishes Part C, and closes
Phase 0.

Nothing autonomous remains in Phase 0. Do not start Phase 1 before Part C is verified: Phase 1
needs the OAuth client and the database.

---

## Last Updated

**2026-09-25** — Phase 0 Parts A, B, D complete and E partly verified. Part C blocked on M1–M6.
