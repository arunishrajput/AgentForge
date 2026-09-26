# AgentForge

**Describe what you want. Get a workflow that builds itself, runs itself, and thinks while it runs.**

AgentForge is an agentic workflow automation platform — *n8n, but the workflows are built and driven
by AI agents rather than hand-wired by you*. Type a request in plain language and AgentForge produces
a real, executable, visually editable workflow whose agent nodes reason, call tools, and decide what
to do at runtime.

Built for the Zero Origin hackathon (Devpost).

**Live:** <https://agentforge-733000675212.asia-southeast1.run.app>

**Pitch video (4:00):** <https://www.youtube.com/watch?v=Suc4RV9LnLs>

**Devpost:** <https://devpost.com/software/agentforge-kz832x>

`PROGRESS.md` → *Deployed State* is authoritative.

---

## Status

**Phase 12 complete — the project is submittable.** The demo is rehearsed against the deployed URL,
the deployment is verified, rollback is tested, and the repository stands on its own.

The whole product is live: Google sign-in, a sentence turned into a real workflow on a canvas,
registry-driven config forms, a webhook or a schedule to start it, an execution engine whose agent
nodes call other nodes as tools and choose a branch at runtime, per-node status and logs streamed
over SSE while it runs, and four integrations that reach real services — HTTP, Discord, Google
Sheets and Gmail.

**Phase 12 was supposed to be paperwork and it was not.** Rehearsing [`DEMO.md`](./DEMO.md) in a
browser, rather than trusting a script that had only ever been walked by a test harness, found three
beats that could not have worked as written — and one of them was a product bug that the 178-check
suite and the ten-walk smoke test both passed straight over:

- **A webhook-triggered run was invisible on the canvas.** The page only opened a stream if it
  happened to *load* mid-run. Beat 5 fires from a terminal while the browser sits idle, so the graph
  never moved. The smoke script opens its own stream over HTTP and fires 400 ms later — it proves the
  server streams, not that the canvas is still listening 25 seconds after it loaded.
- **42% of generated workflows carried an agent budget that guaranteed their own failure.**
  `maxIterations: 1`, which is schema-valid and graph-valid, and stops the agent the moment it
  reaches for a tool. Measured 5 in 12; now 0 in 12.
- **Beat 5 could not have fired the right workflow**, because the webhook token is minted per
  workflow at creation and the one being demonstrated is generated live, seconds earlier.

Current state is always in [`PROGRESS.md`](./PROGRESS.md).

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
| [`SUBMISSION.md`](./SUBMISSION.md) | Everything the Devpost form asks for, written once |

---

## Setup

**Requires:** Node >= 20.9 (developed on v26.8.2 — Next 16's floor is 20.9), npm 11, Docker for
local container testing, `gcloud` for deploys, and `gh` for repository work.

```bash
git clone https://github.com/arunishrajput/AgentForge.git
cd AgentForge
npm install
cp .env.example .env     # then fill it in — see CONTRACT.md → Environment variables
npm run db:migrate       # creates the auth tables; uses the DIRECT connection string
```

You will need: a Neon Postgres database (two connection strings — pooled and direct), a Google OAuth
client whose authorised redirect URI includes `http://localhost:3000/api/auth/callback/google`, and
a Gemini API key. `DEPLOYMENT.md` → *One-time setup* has exact, copy-pasteable steps for each.

The app refuses to start if a required variable is missing, and names every one of them at once.

## Running locally

A single Next.js process plus the Neon database. No separate worker, no Redis.

```bash
npm run dev          # http://localhost:3000
npm run build        # production build (needs no environment)
npm run typecheck    # tsc --noEmit
npm test             # critical-path tests: engine, validation, templates, streaming, agent loop
```

`npm test` runs the TypeScript sources directly on Node's built-in test runner — no framework, no
dependency, via a small resolve hook in `scripts/test-register.mjs`. The engine takes its recorder
as an argument, so those tests touch no database and no network.

One consequence to know before writing code here: Node's strip-only TypeScript mode rejects syntax
that needs real transformation. **No constructor parameter properties, no enums, no namespaces, no
decorators in `src`.**

Verify it is actually working, rather than merely running:

```bash
# The whole API, end to end: auth gating, owner scoping, graph round-trip, a
# sequential run, both sides of a branch, a bounded loop, the failure path,
# live streaming, and the agent layer.
node --env-file=.env scripts/verify-api.mjs http://localhost:3000

# Setting VERIFY_GEMINI_KEY additionally exercises key storage, model validation,
# the LLM node, the agent node and its iteration cap. Without it those checks SKIP.
# See PROGRESS.md for the pipe-it-in recipe that never prints the key.

# The demo path only, beat by beat, in ~10 seconds — the pre-demo check rather than
# the regression suite. It fires a real webhook, watches the SSE stream, and asserts
# the agent's branch, the Discord post and the Sheet row. --loop 10 is the bar.
SMOKE_SPREADSHEET_ID=<the demo sheet> \
  node --env-file=.env scripts/smoke.mjs https://<the deployed url>

# Put the demo account into the state DEMO.md assumes, and prove it: credentials
# connected, the backup workflow generated AND run end to end, the sheet cleared to
# its header row. Idempotent — run it before every demo. --check reports only.
SEED_SPREADSHEET_ID=<the demo sheet> \
  node --env-file=.env scripts/seed-demo.mjs https://<the deployed url>

# DEMO.md Beat 5: fire the demo webhook without putting its URL on a shared screen.
# It resolves the newest workflow at fire time — the webhook token is minted per
# workflow at creation, so the one being demonstrated does not exist until Beat 3 —
# and fits the payload to the trigger the model just wrote.
node --env-file=.env scripts/demo-fire.mjs https://<the deployed url>
node --env-file=.env scripts/demo-fire.mjs https://<the deployed url> --payload calm

curl -fsS localhost:3000/api/health
# {"status":"ok","database":"reachable","databaseLatencyMs":129,...}
```

Then open `http://localhost:3000`, sign in with Google, and reload — the session should survive.

### In a container

The same image Cloud Run runs. Port 8080 is mapped to 3000 so the OAuth redirect URI registered for
local development still matches.

```bash
docker build -t agentforge .
docker run --rm --env-file .env -p 3000:8080 agentforge
curl -fsS localhost:3000/api/health
```

### Database changes

```bash
npm run db:generate   # write a migration from src/db/schema.ts into drizzle/
npm run db:migrate    # apply it
```

Migrations are committed. They use `DATABASE_URL_UNPOOLED`; the app uses the pooled `DATABASE_URL`.

## Deploying

One container on Google Cloud Run, one database on Neon. Full procedure, verification, and rollback
in [`DEPLOYMENT.md`](./DEPLOYMENT.md).

```bash
gcloud run deploy agentforge --source . --region "$GCP_REGION" --allow-unauthenticated \
  --min-instances 1 --max-instances 3 --memory 1Gi --cpu 1 --timeout 3600 --port 8080 \
  --env-vars-file "$SCRATCH/run-env.yaml"
```

Two things that are easy to get wrong, both covered in `DEPLOYMENT.md`:

- **Environment variables belong on the deploy command**, not a follow-up update. A revision
  missing one exits 1 on purpose, so the deploy fails rather than leaving a service to fix up
- **The service has two URLs, and `--format='value(status.url)'` returns the wrong one.** The
  canonical URL is the deterministic `https://<service>-<project-number>.<region>.run.app`

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
| LLM | Google Gemini, behind a provider-agnostic adapter, with a model fallback chain |
| Framework | Next.js 16 App Router (React 19) — one container serving UI and API |
| ORM | Drizzle + `@neondatabase/serverless` |
| Canvas | React Flow (`@xyflow/react`) |
| Agent / tool-calling | Written here — a `fetch` adapter over the Gemini REST API, no SDK ([D32](./PROGRESS.md)) |
| Auth library | Auth.js v5 (`next-auth`, pinned beta) |
| Engine | Written here. In-process DAG walker, not borrowed |

Decided in Phase 0 as **harvest** — build fresh, borrow libraries, no forked codebase. Reasoning,
verified licences, and the rejected forks are in
[`ARCHITECTURE.md`](./ARCHITECTURE.md) → *Foundation Decision*.

---

## License

**Unconstrained, and still the owner's call.** The reason this was deferred is resolved: Phase 0
chose harvest, so nothing copyleft or source-available is inherited. Every adopted dependency is
permissive — Next.js MIT, React MIT, React Flow MIT, Auth.js ISC, Drizzle Apache-2.0, Zod MIT,
`@neondatabase/serverless` MIT, Tailwind MIT.

MIT is the obvious default for a hackathon submission. Left open deliberately rather than chosen on
the owner's behalf, since it governs whether others may commercialise the work.
