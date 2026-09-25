# PROGRESS.md — AgentForge execution state

**The status board.** A fresh session reads this and immediately knows where things stand. Keep it
concise and operational — prune stale detail rather than appending forever. This is not a diary.

---

## Project Status

**Bootstrap complete. No application code exists yet.**

The repository contains documentation only. The next session builds Phase 0.

---

## Current Phase

**Phase 0 — Setup, prerequisites, and foundation decision** (not started)

## Phase Status

`NOT STARTED`

## Completed Phases

None. Documentation bootstrap is not a phase.

---

## Current Phase Tasks — Phase 0

See `BUILD_PLAN.md` → Phase 0 for the authoritative list. Summary:

- [ ] **Part A** — Foundation decision. Evaluate candidates, **verify licences from source**, choose
      fork / harvest / build lean, record in `ARCHITECTURE.md` and remove `NOT YET DECIDED`.
      **Timebox ~2 h**
- [ ] **Part B** — Confirm repo, remote, push *and* pull, `.gitignore` fits the chosen stack
- [ ] **Part C** — `gcloud auth login`; Google Cloud project + billing; enable Run / Build /
      Artifact Registry / Scheduler; Neon project verified with a real query; OAuth client
      (localhost only); Gemini key; Discord webhook
- [ ] **Part D** — Check before creating. Record naming, region, dependencies
- [ ] **Part E** — Prove it: versions print, gcloud authenticated, database answers, git pushes

## Completed Tasks

**Documentation bootstrap — 2026-09-25**

- [x] Verified the toolchain with real version checks (table below)
- [x] Researched hosting cost reality; **switched host from Railway to Cloud Run + Neon** with the
      user's confirmation
- [x] Corrected the phase ladder: node registry moved to Phase 3, original Phase 8 split into 8 + 9
- [x] Wrote all 11 documentation files plus 2 slash commands
- [x] `git init`, first commit, GitHub repo created, push verified

## Blocked Tasks

None.

---

## Known Issues

None yet. Nothing is built.

Carried risks, recorded so they are not rediscovered:

| Risk | Where it bites | Mitigation |
|---|---|---|
| Cloud Run cold start + Neon autosuspend make the first request slow | Demo beat 1 | `min-instances=1`; warm both tiers pre-demo (`DEMO.md`) |
| In-flight runs die on redeploy — no queue | Any deploy during a run | Do not deploy on demo day; interrupted runs must read as failed |
| OAuth production redirect URI cannot exist before the first deploy | Phase 2 | Two-pass manual action (`DEPLOYMENT.md`) |
| Only one LLM provider available | `PRD.md` C10 / S1 | Provider-agnostic adapter; model selection across Gemini tiers |
| Google credential expiry mid-demo | Demo beat 8 | Phase 11 makes it legible; Fallback E |
| Rotating `ENCRYPTION_KEY` destroys all stored credentials | Any time | Never rotate it. Stated in `DEMO.md` and `CONTRACT.md` |

---

## Manual Actions Pending

All six belong to Phase 0. Exact copy-pasteable blocks are in `DEPLOYMENT.md` → *One-time setup*.

| # | Action | Blocks | Verify with |
|---|---|---|---|
| M1 | `gcloud auth login` + `gcloud auth application-default login` | Everything cloud | `gcloud auth list` |
| M2 | Link a billing account to the Google Cloud project (activate the $300 / 90-day trial) | Phase 2 deploy | `gcloud beta billing projects describe <PROJECT_ID>` |
| M3 | Create the Neon project; copy **both** connection strings (pooled + direct) | Phase 1 onward | A real query |
| M4 | Create the Google OAuth client, **localhost redirect only** | Phase 1 | Real local sign-in |
| M5 | Obtain a Gemini API key | Phases 6, 7 | One minimal model call |
| M6 | Create the Discord webhook for `#agentforge-demo` | Phase 9, demo beat 8 | One test post |

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
| Region | `NOT YET DECIDED` — recommended `asia-south1`, fixed in Phase 0 |
| Database | Neon — not created |
| Last verified | Never |

Phase 2 is **non-negotiable**: if the deployment is not live and reachable at the end of that
session, stop and tell the user rather than proceeding to Phase 3.

---

## Cloud Resource Inventory

**No cloud resources exist yet.** Before creating anything, check whether it already exists — across
`/clear` boundaries this is how duplicate infrastructure happens. Full table in `DEPLOYMENT.md` →
*Services and resources*.

| Resource | Provider | Status |
|---|---|---|
| `AgentForge` git repository | GitHub | **EXISTS** — public, `arunishrajput/AgentForge` |
| Google Cloud project | Google Cloud | Not created |
| `agentforge` Cloud Run service | Google Cloud | Not created |
| OAuth 2.0 client | Google Cloud | Not created |
| Neon Postgres project | Neon | Not created |
| `agentforge-cron` Scheduler job | Google Cloud | Not created — Phase 8 |
| Gemini API key | Google AI Studio | Not obtained |
| Discord webhook | Discord | Not created |

### Verified local toolchain — 2026-09-25

| Tool | Version | State |
|---|---|---|
| `git` | 2.54.0 | ready |
| `gh` | 2.98.0 | authenticated as `arunishrajput` (`repo`, `workflow`, `gist`, `read:org`) |
| `node` | v26.8.2 | ready |
| `npm` | 11.19.1 | ready |
| `pnpm` | 11.21.0 | ready |
| `docker` | 29.7.2 | ready |
| `gcloud` | 580.0.0 | installed, **no credentialed account** → M1 |
| `aws` | 2.36.47 | authenticated (`hiveos-dev`, `890608337320`) — **not used**, AWS was rejected |
| `psql` | — | not installed, and not needed |
| `railway`, `flyctl`, `terraform` | — | not installed, not needed |

---

## Recent Changes

**2026-09-25 — documentation bootstrap**

- Created all 11 required docs + `.claude/commands/{next-phase,ship-check}.md`
- **Host changed: Railway → Google Cloud Run + Neon Postgres** (binding). Railway's $5 trial credit
  runs out inside the judging window; Cloud Run's Always Free has no end date and reuses the Google
  Cloud project already required for OAuth and Gemini. AWS evaluated and rejected — no always-free
  container tier, credit-based free plan expiring in 6 months, and 1–2 h of infra wiring. Both
  recorded as unimplemented fallbacks in `DEPLOYMENT.md`
- **Node registry moved from Phase 8 to Phase 3** — the agent's tool surface *is* the registry, so
  the original order inverted the dependency
- **Original Phase 8 split** into Phase 8 (triggers) and Phase 9 (integrations); later phases shifted
- **No queue, no Redis, no worker.** Schedule triggers use Cloud Scheduler, because a scale-to-zero
  service cannot run an in-process timer
- **Gemini is the only wired LLM provider** — the brief's two-provider requirement is not achievable
  with the available keys. Recorded in `PRD.md` → *Deviations*
- **Discord replaces Slack** in the demo spine — no app review needed

---

## Next Phase

**Phase 0 — Setup, prerequisites, and foundation decision.** Definition in `BUILD_PLAN.md`.

## Next Recommended Action

Say **"Build Phase 0."**

Expect the session to open with `MANUAL ACTION REQUIRED` blocks M1–M6, and to continue automatically
with everything not blocked by them — the foundation evaluation in particular needs nothing from the
user.

---

## Last Updated

**2026-09-25** — documentation bootstrap. Nothing built, nothing deployed, Phase 0 next.
