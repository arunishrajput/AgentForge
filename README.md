# AgentForge

**Describe what you want. Get a workflow that builds itself, runs itself, and thinks while it runs.**

AgentForge is an agentic workflow automation platform — *n8n, but the workflows are built and driven
by AI agents rather than hand-wired by you*. Type a request in plain language and AgentForge produces
a real, executable, visually editable workflow whose agent nodes reason, call tools, and decide what
to do at runtime.

Built for the Zero Origin hackathon (Devpost) as a 72-hour solo build.

**Live URL:** not yet deployed — created in Phase 2. `PROGRESS.md` → *Deployed State* is authoritative.

---

## Status

**Bootstrap. No application code yet.** The repository currently holds the documentation that drives
the build. Current state is always in [`PROGRESS.md`](./PROGRESS.md).

---

## What the MVP does

Once built, the core journey is:

1. Sign in with Google
2. Add a Gemini API key and pick a model
3. Type *"When my form webhook fires, summarise the submission, decide if it's urgent, post urgent
   ones to Discord and log every one to a Google Sheet"*
4. A real workflow appears on the canvas — editable, not a picture
5. Trigger it and watch per-node status and logs stream live
6. Watch the agent node reason about the content and take one branch rather than another
7. See the result land in Discord and in the Google Sheet

Full scope, including what is deliberately excluded, is in [`PRD.md`](./PRD.md).

---

## The fastest path to understanding this project

1. [`PROGRESS.md`](./PROGRESS.md) — where things actually stand right now
2. [`PRD.md`](./PRD.md) — what the MVP must do, and what it will not
3. [`ARCHITECTURE.md`](./ARCHITECTURE.md) → *The node registry is the spine* — the one design idea
   the rest follows from
4. [`BUILD_PLAN.md`](./BUILD_PLAN.md) — the phase ladder

---

## Documentation

| File | What it is |
|---|---|
| [`CLAUDE.md`](./CLAUDE.md) | How to work in this repo. Read first |
| [`PROGRESS.md`](./PROGRESS.md) | Current execution state. The status board |
| [`PRD.md`](./PRD.md) | What the MVP must do |
| [`BUILD_PLAN.md`](./BUILD_PLAN.md) | The phase roadmap |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | How it is built, and why |
| [`CONTRACT.md`](./CONTRACT.md) | Interfaces that must stay stable |
| [`DEPLOYMENT.md`](./DEPLOYMENT.md) | How to deploy and verify |
| [`DEMO.md`](./DEMO.md) | The 3-minute demo, used as a scope contract |

---

## Setup

Application setup lands in Phase 1 and this section gets replaced with real commands. What is
already true:

**Requires:** Node 22+ (developed on v26.8.2), a package manager (pnpm 11 / npm 11), Docker for
local container testing, `gcloud` for deploys, and `gh` for repository work.

```bash
git clone https://github.com/arunishrajput/AgentForge.git
cd AgentForge
cp .env.example .env     # then fill it in — see CONTRACT.md → Environment variables
```

You will need: a Neon Postgres database (two connection strings — pooled and direct), a Google OAuth
client, and a Gemini API key. `DEPLOYMENT.md` → *One-time setup* has exact, copy-pasteable steps for
each.

## Running locally

A single Next.js process plus the Neon database. No separate worker, no Redis.

Exact commands land in Phase 1, when the scaffold exists — the foundation decision (Phase 0) fixed
*what* it is, not yet *how to run it*.

## Deploying

One container on Google Cloud Run, one database on Neon. Full procedure, verification, and rollback
in [`DEPLOYMENT.md`](./DEPLOYMENT.md).

```bash
gcloud run deploy agentforge --source . --region "$GCP_REGION" --allow-unauthenticated
```

---

## Architecture in one picture

```
Browser (canvas · prompt · live run view)
        │  HTTPS + SSE
        ▼
Cloud Run — one container
   web/API  →  execution engine  →  node registry
                      │                  │
                 agent layer  ◀──────────┘   tools ARE registry entries
                      │
        ┌─────────────┼──────────────┐
        ▼             ▼              ▼
   Neon Postgres   Gemini      Sheets · Gmail · Discord · HTTP

Cloud Scheduler ──▶ POST /api/cron/tick   (schedule triggers)
```

The load-bearing idea: **one node registry feeds three consumers** — the engine's dispatch table,
the canvas palette, and the agent's tool set. Adding an integration therefore widens what the agent
can do, with no separate tool definitions and no drift. It is also the security boundary: the agent
can call registry entries and nothing else — no shell, no filesystem, no arbitrary network.

Details, and the full list of what is intentionally simplified and what that costs, in
[`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## Stack

| Layer | Choice |
|---|---|
| Host | Google Cloud Run — single container, scales to zero |
| Database | Neon Postgres, free tier, pooled connection |
| Cron | Cloud Scheduler |
| Queue | None. The executor runs in-process |
| Auth | Google OAuth |
| LLM | Google Gemini, behind a provider-agnostic adapter |
| Framework | Next.js 16 App Router (React 19) — one container serving UI and API |
| ORM | Drizzle + `@neondatabase/serverless` |
| Canvas | React Flow (`@xyflow/react`) |
| Agent / tool-calling | Vercel AI SDK |
| Auth library | Auth.js v5 (`next-auth`, pinned beta) |
| Engine | Written here. In-process DAG walker, not borrowed |

Decided in Phase 0 as **harvest** — build fresh, borrow libraries, no forked codebase. Reasoning,
verified licences, and the rejected forks are in
[`ARCHITECTURE.md`](./ARCHITECTURE.md) → *Foundation Decision*.

---

## License

**Unconstrained, and still the owner's call.** The reason this was deferred is resolved: Phase 0
chose harvest, so nothing copyleft or source-available is inherited. Every adopted dependency is
permissive — React Flow MIT, Vercel AI SDK Apache-2.0, Auth.js ISC, Drizzle Apache-2.0.

MIT is the obvious default for a hackathon submission. Left open deliberately rather than chosen on
the owner's behalf, since it governs whether others may commercialise the work.
