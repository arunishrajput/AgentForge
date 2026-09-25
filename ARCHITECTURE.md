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

## Foundation Decision

### Verdict: `NOT YET DECIDED` — Phase 0 Part A resolves this and the verdict becomes BINDING

The brief requires this decision be made in Phase 0 against real evaluation, not assumed here.
What follows is the rubric, the candidate list, and the recorded leaning. **Phase 0 fills in the
matrix, records the decision and the alternatives, and this section stops being provisional.**

Timebox: **~2 hours.** If evaluation exceeds it, pick the lowest risk to shipping, record the
decision, and move on. A fork that takes 10 hours to understand is worse than a lean engine that
takes 6 hours to write.

### The three options

| Option | Meaning |
|---|---|
| **Fork** | Clone an existing project, strip to essentials, build on top |
| **Harvest** | Build fresh, reuse specific libraries and patterns (React Flow, an AI SDK) |
| **Build lean** | Own minimal engine, no borrowed codebase |

### Candidates

`n8n is excluded.` Its Sustainable Use License restricts hosting a competing product.
`UNKNOWN — VERIFY` current licence terms in Phase 0 before relying on that statement.

| Candidate | Stack | Licence | Notes |
|---|---|---|---|
| Activepieces | TypeScript / NestJS / Angular | `UNKNOWN — VERIFY` (MIT core + EE dirs reported) | Closest conceptual match; piece framework |
| Windmill | Rust + TypeScript | `UNKNOWN — VERIFY` (AGPL reported) | Fast engine, script-first not node-first |
| Typebot | TypeScript / Next.js | `UNKNOWN — VERIFY` (AGPL reported) | Conversational flows, not general automation |
| Flowise | TypeScript / Node | `UNKNOWN — VERIFY` (Apache-ish reported) | LLM-chain oriented, closest on the agent axis |
| Langflow | Python | `UNKNOWN — VERIFY` (MIT reported) | Python stack; mismatch with a single JS container |

### Evaluation criteria

1. **Licence** — can this be hosted publicly and built on for a hackathon submission? Flag AGPL
   implications explicitly
2. **Stack fit** — can Claude Code move fast in it
3. **Extensibility** — can a new node type and an agent node be added without fighting the codebase
4. **Deployment story** — does it ship a working Docker setup that survives on Cloud Run
5. **Auth** — does it already have OAuth, or is it pluggable
6. **Cold-start cost** — realistic hours to first meaningful modification

**Bias toward whichever reaches a deployed, demoable state fastest.**

### Recorded leaning (not a decision)

**Harvest**, with a single Next.js App Router application:

- One container serving both UI and API is exactly the Cloud Run unit — a forked multi-service
  stack would have to be collapsed before it could deploy, which is work that produces no demo
- React Flow for the canvas is the component every candidate uses anyway, without the rest
- An AI SDK gives provider-agnostic tool-calling directly, which is the agent node's core
- Auth.js v5 with the Google provider is roughly an hour, versus learning a foreign auth system
- Drizzle or Prisma against Neon — `NOT YET DECIDED`, Phase 3
- The engine we need (DAG walk, branch, bounded loop, step records) is a few hundred lines. Every
  candidate's engine is far larger because it solves problems the MVP explicitly does not have

The honest risk: harvesting means the integration catalogue starts empty. That is accepted — the
MVP needs four integrations, not four hundred.

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
| No partial resume | A failed run is re-run from the start |
| Bounded loops only | No unbounded `while`. Deliberate — it is also a safety property |

State machine: `CONTRACT.md` → *Execution state machine*, binding at Phase 3.

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
- ORM and migration tool: `NOT YET DECIDED` — Phase 3
- Entities: `NOT YET DECIDED` in detail, but at minimum users/accounts/sessions (auth), credentials,
  workflows, runs, run_steps. Schema is binding at Phase 3 via `CONTRACT.md`

---

## API surface

Shapes are `NOT YET DECIDED` until the phase that needs them; the surface is:

| Area | Routes | Phase |
|---|---|---|
| Auth | Auth.js handlers | 1 |
| Workflows | list, create, read, update, delete | 3–4 |
| Runs | trigger, list, read with steps | 3 |
| Live | SSE stream for a run | 5 |
| Generation | natural language → workflow | 7 |
| Webhook | unguessable per-trigger receiver | 8 |
| Cron | `/api/cron/tick`, `CRON_SECRET`-guarded, Cloud Scheduler only | 8 |
| Settings | provider/model config, credentials write-only | 6 |

Every route except the webhook receiver and the cron tick requires a session and scopes its query
to the owner, enforced server-side.

---

## Realtime transport — SSE

**Server-Sent Events**, not WebSocket. Binding at Phase 5.

- No session affinity configuration needed on Cloud Run; WebSockets require it
- `EventSource` reconnects natively — no client reconnection logic to write or debug
- One-directional is all this needs: the client triggers over normal HTTP and only *receives*
  execution events
- One fewer moving part, which is the project's stated priority ordering

Cost: Cloud Run bills CPU while a stream is open, so a stream is opened when a run starts and
closed when it ends. The run view falls back to fetching the run record when no stream is open,
so a reload mid-run still shows correct state.

Event shapes: `CONTRACT.md`, binding at Phase 5.

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
| A10 | Foundation: harvest, single Next.js app | **LEANING** | Decided in Phase 0 |
| A11 | ORM / migration tool | `NOT YET DECIDED` | Phase 3 |

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
