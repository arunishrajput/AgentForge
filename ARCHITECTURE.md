# ARCHITECTURE.md — AgentForge

How AgentForge is built and why. Read before adding a component or a dependency.

Decisions marked **BINDING** do not get revisited without flagging a material change to the user.
Decisions marked `NOT YET DECIDED` belong to a named later phase — do not pre-empt them.

---

## System overview

One container, one database, no queue.

```
                      Browser
            ┌──────────────────────────┐
            │  Canvas (React Flow)     │
            │  Chat / NL prompt        │
            │  Live run view (SSE)     │
            └───────────┬──────────────┘
                        │ HTTPS
        ┌───────────────▼─────────────────────────────┐
        │   Cloud Run service  "agentforge"           │
        │   single container, scales to zero          │
        │                                             │
        │   ┌─────────────────────────────────────┐   │
        │   │ Web / API layer                     │   │
        │   │  auth · workflow CRUD · run API     │   │
        │   │  SSE stream · webhook · cron tick   │   │
        │   └────────────┬────────────────────────┘   │
        │                │                            │
        │   ┌────────────▼────────────┐  ┌──────────┐ │
        │   │ Execution engine        │──│ Node     │ │
        │   │  in-process DAG walker  │  │ registry │ │
        │   └────────────┬────────────┘  └────┬─────┘ │
        │                │                    │       │
        │   ┌────────────▼────────────┐       │       │
        │   │ Agent layer             │───────┘       │
        │   │  provider adapter       │  tools derived│
        │   │  tool-calling loop      │  from registry│
        │   └────────────┬────────────┘               │
        └────────────────┼────────────────────────────┘
                         │                    │
              ┌──────────▼─────────┐   ┌──────▼──────────────┐
              │ Neon Postgres      │   │ External services   │
              │ (pooled conn)      │   │ Gemini · Sheets ·   │
              └────────────────────┘   │ Gmail · Discord ·   │
                                       │ any HTTP endpoint   │
              ┌────────────────────┐   └─────────────────────┘
              │ Cloud Scheduler    │──▶ POST /api/cron/tick
              │ (managed cron)     │
              └────────────────────┘
```

---

## Foundation Decision — **BINDING**

### Verdict: **HARVEST.** One Next.js App Router application, own engine, borrowed libraries

Decided in Phase 0 Part A on 2026-09-25, against licences and repository sizes verified from
source. **This is binding.** Do not revisit without flagging a material change to the user.

**What harvest means here:** build fresh in a single Next.js App Router app; take React Flow for
the canvas, the Vercel AI SDK for provider-agnostic tool-calling, and Auth.js for Google OAuth;
write the execution engine, the node registry, and the generation layer ourselves. No borrowed
codebase, no fork to strip.

### Why, in the order that decided it

1. **No candidate is a single container.** Every fork candidate is a multi-service monorepo —
   Activepieces is NestJS + Angular, Flowise is Express + a Vite SPA, Windmill is Rust + Svelte.
   The deployment unit is one Cloud Run container, so a fork's first task would be collapsing its
   topology, which is hours of work that produces nothing demoable.
2. **The cold-start cost is measured, not guessed.** Repository sizes, `gh api`, 2026-09-25:
   n8n 123 MB of TypeScript, Activepieces 49 MB, Windmill 17 MB of Rust + 12 MB Svelte, Langflow
   32 MB of Python, Flowise 8.3 MB. The MVP's engine — DAG walk, branch, bounded loop, step
   records — is a few hundred lines. Reading enough of any candidate to modify it safely costs
   more than writing that.
3. **Stack fit is decisive at this timebox.** Only Flowise and Activepieces are permissively
   licensed *and* TypeScript, and both carry a UI framework we would not choose (React SPA on
   Express; Angular). Langflow is Python and Windmill is Rust — both break the one-JS-container
   premise outright.
4. **The agent axis does not transfer.** Flowise is the closest candidate on agents, but its
   abstractions are LangChain chatflows, not general automation with triggers. We would fight its
   data model to get workflows, schedules, and webhooks.
5. **The borrowed parts are the parts worth borrowing.** React Flow is the canvas every candidate
   uses anyway. The AI SDK gives tool-calling, which is the agent node's core. Auth.js gives
   Google OAuth in about an hour.

**The accepted risk:** harvesting starts the integration catalogue empty. Accepted — `PRD.md`
requires four integrations, not four hundred.

### Licences, verified from each repository's own LICENSE file on 2026-09-25

Verified by reading the file, not by trusting GitHub's detected label — five of these nine resolve
to `NOASSERTION` under GitHub's licence detection, so the label is not usable evidence.

| Project | What the LICENSE file actually says | Usable for this build |
|---|---|---|
| **n8n** | Sustainable Use License v1.0 for the core. `.ee.`-named files and `.ee` dirs need an Enterprise licence. **Branches other than `master` are not licensed at all** | **No** — see correction below |
| **Activepieces** | MIT Expat core; `packages/ee/` and `packages/server/api/src/app/ee` under a separate EE licence | Yes, licence-wise |
| **Windmill** | AGPLv3 for `backend/` and `frontend/`; Apache-2.0 for the language clients and the OpenAPI/OpenFlow spec; proprietary behind the `enterprise` compile flag. Forks **must not** include the proprietary code | Yes, but AGPL is viral over the whole derived work |
| **Typebot** | **FSL-1.1-Apache-2.0** (Functional Source License, converting to Apache-2.0). Prohibits "Competing Use" — making the software available in a commercial product or service that substitutes for it | Restricted |
| **Flowise** | Apache-2.0 core; `packages/server/src/enterprise` and files with an explicit copyright notice are Commercial | Yes, licence-wise |
| **Langflow** | MIT | Yes, licence-wise |
| **React Flow** (`@xyflow/react`) | MIT | **Yes — adopted** |
| **Vercel AI SDK** (`ai`) | Apache-2.0 | **Yes — adopted** |
| **Auth.js** (`next-auth`) | ISC | **Yes — adopted** |

#### Correction: the n8n claim in the original brief was imprecise

The brief stated n8n's licence "restricts hosting a competing product." **The Sustainable Use
License v1.0 contains no competing-product clause.** What it actually says is narrower and
broader at once:

> "You may use or modify the software only for your own internal business purposes or for
> non-commercial or personal use. You may distribute the software or provide it to others only if
> you do so free of charge for non-commercial purposes."

So a free, non-commercial hackathon demo is arguably permitted, and the stated reason for
excluding n8n does not hold as written. **n8n stays excluded on three real grounds instead:** the
SUL forecloses any future commercial use without relicensing, `master` is the only licensed
branch, and at 123 MB of TypeScript it is the worst cold-start cost of any candidate. The
conclusion survives; the reasoning had to be replaced.

`FSL` and `SUL` are source-available, not open-source. Neither is adopted, so neither constrains
this build.

### Alternatives rejected

- **Fork Flowise** — `SUPERSEDED`. Best-licensed and smallest TS candidate (Apache-2.0, 8.3 MB),
  but Express + Vite SPA is two services to collapse, and its chatflow model is not workflow
  automation with triggers.
- **Fork Activepieces** — `SUPERSEDED`. MIT core and the closest conceptual match, but Angular
  plus NestJS plus 49 MB of TypeScript is the wrong stack at the wrong size.
- **Fork Windmill / Langflow** — `SUPERSEDED`. Rust and Python respectively; both violate the
  single-JS-container premise. Windmill additionally imposes AGPL on everything derived.
- **Fork n8n** — `SUPERSEDED`. See the correction above.
- **Build lean with no borrowed libraries** — `SUPERSEDED`. Hand-writing a canvas or a
  tool-calling loop is a day each, and neither is a differentiator.

### The adopted stack, versions verified from the npm registry on 2026-09-25

| Package | Version | Note |
|---|---|---|
| `next` | 16.3.6 | `engines.node >= 20.9.0`; local Node is v26.8.2 |
| `react` / `react-dom` | 19.3.0 | |
| `@xyflow/react` | 12.12.0 | peer `react >= 17` — React 19 satisfied. **Installed in Phase 4** |
| `ai` | 7.0.114 | AI SDK v7 |
| `@ai-sdk/google` | 4.0.80 | peer `zod ^3.25.76 \|\| ^4.1.8` — satisfied by zod 4 |
| `next-auth` | **5.0.0-beta.32** | see the note below |
| `@auth/drizzle-adapter` | 1.11.3 | |
| `drizzle-orm` / `drizzle-kit` | 0.45.3 / 0.31.11 | peers include `@neondatabase/serverless >= 0.10.0` |
| `@neondatabase/serverless` | 1.1.0 | |
| `zod` | 4.6.5 | |
| `tailwindcss` | 4.3.3 | |
| `typescript` | 7.0.2 | |

**Auth.js v5 is still a beta, and is still the right choice.** `next-auth@latest` is 4.24.15,
whose peer range does not include Next 16. Only `next-auth@beta` (5.0.0-beta.32) declares
`next: ^14 || ^15 || ^16` and `react: ^18.2 || ^19`. Taking the stable tag would mean pinning an
older Next. Pin the exact beta version rather than tracking the `beta` tag, so a mid-hackathon
beta release cannot break the build.

**ORM: Drizzle, not Prisma** — resolves the `NOT YET DECIDED` this section previously carried into
Phase 3. Drizzle's `@neondatabase/serverless` peer support is first-class, it needs no generate
step or query engine binary in the container, and `@auth/drizzle-adapter` is maintained by the
Auth.js project. Schema and migrations still land in Phase 3; only the choice is settled here.

---

## Hosting platform — **BINDING**

**Google Cloud Run (single container) + Neon Postgres.**

This **supersedes** the originally pre-decided Railway choice. Decided 2026-09-25 by the user after
cost research. Do not revisit without flagging a material change.

### Why

- **Genuinely free through judging.** Cloud Run Always Free has no end date: 2M requests,
  180,000 vCPU-seconds, 360,000 GiB-seconds, 1 GB North-America egress per month. A $300 / 90-day
  welcome credit absorbs any overage during the hackathon
- **No new accounts.** A Google Cloud project is already required for the OAuth client, and Gemini
  is the chosen LLM. One account, one console, one CLI — and `gcloud` is already installed. Fewer
  `MANUAL ACTION REQUIRED` blocks than any alternative
- **Fastest deploy loop.** `gcloud run deploy --source .` is one command from Dockerfile to public
  HTTPS, ~2–4 minutes. Roughly twelve phases each end in a deployed verification, so deploy speed
  compounds
- **No restructuring for long work.** 60-minute request timeout, and SSE streaming works, so the
  executor runs inside a request rather than needing a separate worker
- **Scales to zero.** Idle costs nothing

### Alternatives rejected

**AWS** — `SUPERSEDED`. The account already exists and is authenticated (`hiveos-dev`), which was
the strongest argument for it. Rejected anyway: no AWS container service has a meaningful
always-free tier (App Runner and ECS Fargate have none; Aurora Serverless v2's floor is ~$40/mo),
the current free tier is credit-based ($100 + up to $100 more, expiring after 6 months with the
account auto-closing), and reaching a first deploy costs ~1–2 hours of ECR, IAM, RDS, and service
wiring, then 5–10 minutes per deploy thereafter. Against a 72-hour budget with a non-negotiable
Phase 2 deploy, that is the wrong trade.

**Railway** — `SUPERSEDED`. Docker-native and pleasant, but the only candidate that is not free
through judging: the Free plan gives $1/month of credits capped at 1 vCPU / 0.5 GB per service,
and the one-time $5 / 30-day trial is consumed in roughly 3 days by a four-service stack, or ~10
days by one service plus external Postgres. The credit runs out inside the judging window.

Both are recorded as unimplemented fallbacks in `DEPLOYMENT.md`.

### Cost of this choice

- **Cold starts.** With `min-instances=0`, the first request after idle pays container start.
  Mitigation: run `min-instances=1` during the hackathon, funded by the $300 credit, and drop to 0
  afterwards. `DEMO.md` also warms the service before the demo
- **In-flight runs die on redeploy.** Cloud Run replaces revisions; an executing workflow in the
  old revision is lost. Accepted: no queue, no worker, no Redis. A run interrupted this way shows
  as failed rather than silently stalling
- **CPU is billed while an SSE stream is open.** Streams are therefore opened only while a run is
  active and closed on completion, never held open idly

### Region — **BINDING**

| Tier | Resource | Region |
|---|---|---|
| Compute | Cloud Run `agentforge` | **`asia-southeast1`** (Singapore) |
| Database | Neon project `agentforge` | **`aws-ap-southeast-1`** (Singapore) |

Decided in Phase 0 Part D on 2026-09-25 by the user. Everything else follows this pair — one
region, recorded once.

**Why not Mumbai, which the docs originally recommended.** Neon has no Mumbai region; its nearest
Asia-Pacific region is Singapore. Cloud Run in `asia-south1` would put every database query
~50–70 ms from the app. The engine writes step records per node, so a single eight-node run makes
roughly 30 sequential queries — about **1.9 s of pure network latency per run**, against ~0.1 s
co-located. Live per-node execution streaming is the demo's strongest moment, so the latency that
compounds wins over the latency that does not.

**What it costs.** Verified against Cloud Run's locations doc, 2026-09-25: `asia-south1` (Mumbai)
and `us-east4` are **Tier 1** pricing; `asia-southeast1` (Singapore) is **Tier 2**. The free tier
is applied as a spending-based discount computed at Tier 1 rates, so a Tier 2 region receives a
slightly smaller effective allowance, and per-unit rates are higher. Exact Tier 1 / Tier 2 unit
prices are `UNKNOWN — VERIFY` — the pricing page would not render for automated fetching. The
premium is immaterial here regardless: `min-instances=1` across the hackathon window already
exceeds the monthly free vCPU-second allowance in *any* region, so this build draws on the $300
credit either way, and the tier delta is a few dollars of it.

**Also rejected:** `us-east4` + Neon N. Virginia — Tier 1, co-located, and free North-America
egress, which makes it the best choice for US-based judges. Rejected because the developer drives
the live demo from India: ~250 ms per interaction on the deployed app, and ~250 ms per query for
twelve phases of local development against the remote database.

The developer's own browser now sits ~60–80 ms from the app instead of ~25 ms. Accepted — that is
a handful of requests per page, not thirty per workflow run.

---

## Components

| Component | Responsibility |
|---|---|
| **Web / API layer** | Auth, workflow CRUD, run trigger, SSE stream, webhook receiver, cron tick endpoint |
| **Node registry** | The single source of node types. Each entry declares its type, schema, and execute function. Serves three consumers: the engine's dispatch, the canvas's palette, and the agent's tool set |
| **Execution engine** | Walks the workflow DAG in-process, calls the registry per node, threads output forward, writes step records, emits events |
| **Agent layer** | Provider adapter over the LLM, prompt assembly, and the bounded tool-calling loop whose tools are derived from the registry |
| **Generation** | Natural language → validated workflow JSON → persisted workflow |
| **Persistence** | Neon Postgres. Users, credentials, workflows, runs, run steps |
| **Cloud Scheduler** | Managed cron, calls `/api/cron/tick` to fire due schedule triggers |

---

## The node registry is the spine

This is the load-bearing design decision and the reason the build order was changed from the
original brief.

A single registry of node definitions feeds **three** consumers:

```
                   ┌──▶ Engine dispatch   (which code runs for this node type)
  Node registry ───┼──▶ Canvas palette    (what the user can drag in, and its config form)
                   └──▶ Agent tool set    (what the agent is allowed to call)
```

Because the agent's tool surface *is* the registry, the registry must exist before the agent node.
The original brief placed the registry in Phase 8 and the agent in Phase 6 — a dependency
inversion. **The registry therefore lands in Phase 3**, alongside the engine that needs its
dispatch table anyway. Phases 8 and 9 add entries to an existing registry rather than building one.

A consequence worth stating: adding an integration automatically widens what the agent can do. No
separate tool definitions, no drift between "nodes that exist" and "tools the agent knows about."

Security boundary: the agent can call registry entries and nothing else. There is no shell tool, no
filesystem tool, and no arbitrary-HTTP escape hatch beyond the explicit HTTP node, which is itself
a registry entry with a schema.

---

## Execution engine design

In-process, synchronous within a request, no queue.

1. A trigger creates a `run` row in `queued`, then transitions to `running`
2. Resolve execution order from the workflow's edges — topological, with cycle rejection except
   where a node is an explicit loop construct
3. For each node: write a step record, resolve its config, call the registry's execute function
   with upstream output, record status / output / error / timing, emit an event
4. Branch nodes evaluate a condition and mark untaken paths skipped
5. Loop nodes re-enter a bounded subgraph with a hard iteration cap
6. A node failure fails the run, with the error attached to that step
7. The run ends `succeeded`, `failed`, or `cancelled`

Deliberately simplified, and what each costs:

| Simplification | Cost |
|---|---|
| No queue, in-process execution | Runs die on redeploy or instance recycle. No retry-after-crash |
| Runs inside a request | Bounded by Cloud Run's 60-minute timeout |
| No parallel node execution | A wide DAG runs slower than it could |
| No join semantics — a node with several incoming edges runs when the first one reaches it | A diamond's merge point runs twice, once per arriving branch, rather than waiting and merging |
| No partial resume | A failed run is re-run from the start |
| Bounded loops only | No unbounded `while`. Deliberate — it is also a safety property |

**Implemented in Phase 3 as a work list, not a static topological sort.** Branch and loop outputs
mean the order is only known as the run proceeds: start at the trigger, execute, follow the
outgoing edges matching the handle the node left through, repeat. A topological pass is still used
for validation — to reject any cycle that does not close through a loop node.

State machine, bounds and record shapes: `CONTRACT.md` → *Execution state machine*.

---

## Agent and tool-calling architecture

```
Agent node
  │
  ├─ Provider adapter ─────▶ Gemini  (OpenAI / Anthropic / OpenRouter = same interface, unwired)
  │
  ├─ Tool set  ◀── derived from the node registry, filtered to what this workflow may use
  │
  └─ Loop:  model proposes tool call → engine executes that registry node → result fed back
            → repeat until the model answers or the step cap is hit
```

- **Provider-agnostic by construction.** One adapter interface; Gemini is the only implementation
  wired at MVP. Model selection is real across Gemini tiers. See `PRD.md` → *Deviations*
- **Keys are the user's.** Supplied in-app, AES-256-GCM encrypted at rest with a key from
  `ENCRYPTION_KEY`, never returned to the client in plaintext. No KMS — that is post-hackathon
- **Bounded.** A hard cap on tool-calling iterations per agent node. An agent that will not
  converge fails its step rather than spending the user's quota
- **Generation is a separate concern.** Natural language → workflow uses the same provider adapter
  but produces validated workflow JSON, schema-checked before persistence. Invalid model output is
  rejected and reported, never saved broken

Tool-call schema: `CONTRACT.md`, binding at Phase 6.

---

## Database

Neon Postgres, free tier.

- **Two connection strings.** `DATABASE_URL` is Neon's **pooled** endpoint, used by the app —
  Cloud Run instances multiply connections and Neon's free compute has a low limit.
  `DATABASE_URL_UNPOOLED` is the direct endpoint, used for migrations, which need a session
  connection that pooling breaks
- **Neon free compute autosuspends** when idle, so the first query after a quiet period pays a
  wake-up. Combined with Cloud Run cold start this is the demo's slowest possible first moment —
  hence the warm-up step in `DEMO.md`
- ORM and migration tool: **Drizzle** (`drizzle-orm` + `drizzle-kit`), decided in Phase 0 Part A.
  The **auth** schema and its migration landed in Phase 1 (`src/db/schema.ts`, `drizzle/`), as
  Phase 1 cannot persist a session without them. Workflow, run, step and credential tables are
  still Phase 3 and still binding there via `CONTRACT.md`
- **Driver: `drizzle-orm/neon-http`**, decided in Phase 1. Neon's HTTP endpoint, one round trip
  per statement, no pool to manage. It does **not support transactions** — verified as safe
  because `@auth/drizzle-adapter` issues none (checked against the installed package, not the
  docs). If Phase 3's engine needs a real transaction, switch `src/db/index.ts` to
  `drizzle-orm/neon-serverless`; nothing outside that file should have to change
- **Entities — settled in Phase 3**, migration `0001_smiling_leper_queen`:

  | Table | Phase | Notes |
  |---|---|---|
  | `user`, `account`, `session`, `verificationToken` | 1 | Auth.js adapter tables |
  | `workflow` | 3 | Owns the graph as a single `jsonb` column |
  | `run` | 3 | One per execution; `heartbeatAt` is what makes an interrupted run observable |
  | `run_step` | 3 | One per node execution, unique on `(runId, seq)`; snapshots its resolved config |
  | `credential` | 3 | Table only. Encryption and the write-only API are Phase 6 |

- **The graph is one `jsonb` column, not node and edge tables.** Decided in Phase 3. `neon-http`
  has no transactions, so a graph spread over three tables could not be saved atomically; a
  single-row update is atomic for free, the canvas saves the whole graph at once anyway, and no
  query wants "all edges across all workflows". Shape in `CONTRACT.md`
- **`neon-http` was re-examined in Phase 3 and kept.** The engine writes one step record per node
  and one run update at the end — each independently meaningful, so a run cut short loses at most
  the tail of its history and `reapStaleRuns` fails the run regardless. No transaction is needed,
  so the swap to `neon-serverless` stays unspent
- **Postgres `jsonb` normalises object key order.** A graph read back is deeply equal to what was
  written but not byte-identical. Found while verifying the Phase 3 round-trip; nothing may compare
  graphs as strings

---

## API surface

Shapes are `NOT YET DECIDED` until the phase that needs them; the surface is:

| Area | Routes | Phase |
|---|---|---|
| Auth | Auth.js handlers | 1 |
| Workflows | list, create, read, update, delete | **3 — done** |
| Runs | trigger, list, read with steps | **3 — done** |
| Registry | `GET /api/nodes`, the palette projection | **3 — done** |
| Live | SSE stream for a run | 5 |
| Generation | natural language → workflow | 7 |
| Webhook | unguessable per-trigger receiver | 8 |
| Cron | `/api/cron/tick`, `CRON_SECRET`-guarded, Cloud Scheduler only | 8 |
| Settings | provider/model config, credentials write-only | 6 |

Every route except the webhook receiver and the cron tick requires a session and scopes its query
to the owner, enforced server-side.

---

## Realtime transport — SSE

**Server-Sent Events**, not WebSocket. **Built and verified in Phase 5.**

- No session affinity configuration needed on Cloud Run; WebSockets require it
- `EventSource` reconnects natively — no client reconnection logic to write or debug
- One-directional is all this needs: the client triggers over normal HTTP and only *receives*
  execution events
- One fewer moving part, which is the project's stated priority ordering

**The stream reads the database rather than an in-process emitter.** This is the one decision Phase
5 had to get right. Execution is in-process, but the thing *watching* a run is a different request
from the one running it — and for a webhook-triggered run (`DEMO.md` Beat 6) it is a different
client entirely. Under `max-instances 3` those can be different containers, and an `EventEmitter`
keyed by run id would then deliver nothing, with no error anywhere. Polling the `run` and
`run_step` rows costs two statements every 300 ms while a stream is open and is correct regardless
of which instance serves what. It also collapses "connect mid-run", "reconnect" and "reload the
page" into one code path: every connection opens with a full snapshot.

Cost: Cloud Run bills CPU while a stream is open, so a stream is opened when a run starts and
closed when it ends — on a terminal run, after 20 s with no run to watch, or at a 150 s ceiling.
`POST /runs` still returns the authoritative final state, so the canvas is correct even if no
stream was ever open.

Event shapes, the follow rule, and the headers: `CONTRACT.md` → *SSE event messages*.

---

## Queue — deliberately none

No Redis, no BullMQ, no worker service. The engine runs in the web container.

Justification: the MVP's runs are short and user-initiated. A queue would add a service, a
dependency, a failure mode, and deploy complexity to buy durability the demo does not need.

**Schedule triggers do not use an in-process timer.** Cloud Run scales to zero, so `setInterval`
simply does not fire. Instead **Cloud Scheduler** — Google-managed cron, free tier covers it —
calls `POST /api/cron/tick` guarded by a `CRON_SECRET`, and that handler fires whatever schedules
are due. Same Google project, no extra infrastructure.

Revisit only if a genuine need appears, and flag it as a material change.

---

## Auth

Google OAuth only, via Auth.js v5 (assuming the harvest path; a fork's own auth system with a
Google provider added would substitute).

**The redirect URI is a sequencing trap.** The production redirect URI needs the deployed URL,
which does not exist until the first deploy. Therefore:

- **Phase 1** — create the OAuth client with `http://localhost:3000/...` only
- **Phase 2** — deploy, capture the real Cloud Run URL, then a second short manual action adds the
  production redirect URI

Whether the newer deterministic `<service>-<project-number>.<region>.run.app` URL form allows
pre-registering the production URI before the first deploy is `UNKNOWN — VERIFY` at Phase 2. The
two-step is the safe default regardless. Exact values live in `DEPLOYMENT.md`.

Integration credentials (Google API scopes for Sheets and Gmail, Discord webhook URLs) are stored
encrypted per user, separate from the sign-in session.

---

## Deployment topology

```
GitHub  ──(manual/CLI)──▶  gcloud run deploy --source .
                                  │
                                  ├── Cloud Build builds the Dockerfile
                                  └── new Cloud Run revision, traffic shifted
                                            │
   Cloud Run "agentforge"  ◀────────────────┘
      env from Secret Manager / --set-env-vars
      │
      ├──▶ Neon Postgres  (pooled endpoint)
      ├──▶ Gemini API
      └──▶ Sheets / Gmail / Discord / arbitrary HTTP

   Cloud Scheduler ──▶ POST /api/cron/tick   (CRON_SECRET)
```

One service, one region, one database. Rollback is a traffic shift to the previous revision.
Commands and the resource inventory are in `DEPLOYMENT.md`.

---

## Key architectural decisions

| # | Decision | Status | Rationale |
|---|---|---|---|
| A1 | Cloud Run + Neon, not Railway or AWS | **BINDING** | Only genuinely free option through judging; reuses the required Google project; fastest deploy loop |
| A2 | Single container, UI + API together | **BINDING** | Cloud Run's unit is one container. Two services would double cost and setup for no demo value |
| A3 | Node registry in Phase 3, not Phase 8 | **BINDING** | The agent's tool surface *is* the registry; the original order inverted the dependency |
| A4 | No queue; in-process executor | **BINDING** | Fewer moving parts. Cost: runs die on redeploy |
| A5 | Cloud Scheduler for cron | **BINDING** | Scale-to-zero makes in-process timers non-functional |
| A6 | SSE, not WebSocket | Binding at Phase 5 | No affinity config, native reconnect, one-directional suffices |
| A7 | Gemini only, behind a provider-agnostic adapter | **BINDING** for MVP | Only available key. Second provider is `PRD.md` S1 |
| A8 | AES-256-GCM app-level credential encryption | Binding at Phase 6 | Meets "encrypted at rest" without KMS setup |
| A9 | Discord instead of Slack | **BINDING** | Webhooks need no app review; Slack cannot be authorised for this build |
| A10 | Foundation: harvest, single Next.js app | **BINDING** | Decided in Phase 0 Part A, 2026-09-25, against verified licences and repo sizes |
| A11 | ORM: Drizzle, not Prisma | **BINDING** | No generate step or query engine in the container; first-class Neon serverless support; `@auth/drizzle-adapter` is maintained by Auth.js |
| A12 | Auth.js v5 pinned at `next-auth@5.0.0-beta.32` | **BINDING** | The stable v4 tag does not peer-support Next 16. Pin the exact version, not the `beta` tag |
| A13 | Region pair: Cloud Run `asia-southeast1` + Neon Singapore | **BINDING** | Co-locating app and database beats Tier 1 pricing; see *Hosting platform* |

---

## What is intentionally simplified, and what it costs

| Simplified | Cost | Recovery path |
|---|---|---|
| No queue or worker | Runs die on redeploy; no crash retry | Add BullMQ + a second service post-hackathon |
| No partial run resume | A failed run restarts from the beginning | Step records already hold enough state to resume later |
| Single LLM provider wired | "Provider-agnostic" is architectural, not shown | Adapter exists; add a key and a config entry |
| No credential KMS | Encryption key lives in the environment | Move to Secret Manager / KMS post-hackathon |
| No workflow versioning | Editing a workflow changes what past runs referenced | Run steps snapshot their own config |
| No parallel node execution | Wide DAGs run slower than necessary | Engine is a loop; parallelising is local |
| No RBAC or sharing | Single-owner workflows only | Ownership is already enforced per row |
| Four integrations | Not comparable to n8n's catalogue | Registry makes each new one additive |
| Bounded loops only | No unbounded iteration | Deliberate; also a safety property |
