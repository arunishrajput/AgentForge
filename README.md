<div align="center">

<img src="./public/illustrations/mascot-happy.svg" alt="Sparky, the AgentForge mascot" width="88" height="88" />

# AgentForge

**Describe the automation. Get a workflow that runs.**

*n8n, but the workflows are built and driven by AI agents rather than hand-wired by you.*

[![CI](https://github.com/arunishrajput/AgentForge/actions/workflows/ci.yml/badge.svg)](https://github.com/arunishrajput/AgentForge/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-6B4EFF.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.9-43C59E.svg)](./package.json)
[![Nodes](https://img.shields.io/badge/registry-30%20nodes-FF8A3D.svg)](./docs/nodes.md)
[![Cost to run](https://img.shields.io/badge/cost%20to%20run-%240-FFD23F.svg)](./docs/self-hosting.md)

**[Live app](https://agentforge-733000675212.asia-southeast1.run.app)** ·
**[Design system](https://agentforge-733000675212.asia-southeast1.run.app/design)** ·
**[Docs](./docs)** ·
**[Pitch video](https://www.youtube.com/watch?v=Suc4RV9LnLs)**

</div>

---

Type a sentence. AgentForge produces a **real, executable, visually editable workflow** — nodes,
connections, editable configuration — not a mockup and not a suggestion. It runs, it streams
per-node status and logs live, and its **agent nodes call other nodes as tools and decide what to
do at runtime** instead of following a fixed script.

<img src="./docs/assets/workflow-demo.png" alt="A sentence becomes a five-node workflow — webhook trigger, an LLM summary, an agent that picks a branch, a Discord post and a log node — and then a live run log streaming beneath it" width="100%" />

---

## What makes it different

**The node registry is the agent's tool set.** Not a parallel list of tool definitions kept in
sync by hand — the *same* objects. One registry entry feeds three consumers:

```
                  ┌──────────────────────┐
                  │   the node registry  │   30 nodes, one object each
                  └──────────┬───────────┘
            ┌────────────────┼────────────────┐
            ▼                ▼                ▼
    engine dispatch    canvas palette    agent tool set
```

So adding an integration widens what the agent can do, what the generator can produce, and what
the palette offers — in one place, with no drift. Phase 23C added the Postgres node and wrote **no
route, no settings card, no rotation rule and no vault entry**.

It is also the security boundary: **the agent can reach registered nodes and nothing else.** No
shell, no filesystem, no arbitrary network, and no arbitrary code execution anywhere in the
product — not sandboxed, not behind a flag.

**A valid graph can still be the wrong graph.** Generation is a first draft you correct, not an
oracle — which is why the canvas is editable and why the product says so out loud rather than
pretending otherwise.

---

## Features

| | |
|---|---|
| **Sentence → workflow** | A validated graph, or an honest `unsupported` with a reason. A broken workflow is never saved — the generator does not touch the database |
| **A real canvas** | React Flow. Move nodes, rewire edges, change any node's configuration, add a trigger, delete half of it |
| **Agent nodes** | Bounded tool-calling. The model decides; the graph routes. Every tool call is a visible, streamed step |
| **Live execution** | Per-node status and logs over SSE while it runs. Reload mid-run and the page reattaches |
| **30 nodes** | Triggers, logic, nine transforms, two AI nodes, and nine integrations. [Full reference](./docs/nodes.md) — generated from the registry |
| **Durable runs** | Handed to a queue, survives a redeploy or a crash, resumes from the last finished step |
| **Versioning and diffing** | Every save is a version. Name one, restore one, compare two visually. Every run records which version it executed |
| **Workspaces and roles** | `viewer` · `editor` · `admin` · `owner`, enforced server-side on every route. Invite by single-use expiring link |
| **Read-only sharing** | Publish a workflow as a page anyone with the link can open. Shows the shape, withholds every value its author typed |
| **A credential vault** | Envelope encryption. Rotating the root key re-wraps the data keys **without decrypting a single secret** |
| **Observability** | Structured logs carrying the request's trace, grouped errors, five-check health, and per-workspace analytics computed on demand |
| **Free to operate** | Cloud Run always-free, Neon free tier, an LLM free tier. [Zero, and it binds](./docs/self-hosting.md) |

### Integrations

HTTP · Discord · Slack · Google Sheets · Gmail · Notion · GitHub · Airtable · Postgres

**What is proven against the real service, and what is not.** Every integration is exercised by a
deployed verification suite rather than a mock, but **two of the nine — Notion and Airtable — have
only ever run against a stubbed server.** Their parsers, error handling and documented failure
answers are unit-tested and their wire formats were read from each service's current API docs, but
nobody has created an account and watched a row appear. The other seven have: HTTP, Discord,
Sheets and Gmail, then Slack and GitHub against real services, and Postgres against a real server.

If you use Notion or Airtable and something is wrong, [that issue would be genuinely
useful](./CONTRIBUTING.md).

---

## Quickstart

```bash
git clone https://github.com/arunishrajput/AgentForge.git
cd AgentForge
npm install
cp .env.example .env     # eight required variables — the app names every missing one at once
npm run db:migrate
npm run dev              # http://localhost:3000
```

You need a **Postgres database** (Neon's free tier), a **Google OAuth client**, and an **LLM API
key** ([Gemini](https://aistudio.google.com/apikey) or [Groq](https://console.groq.com/keys) —
both free, neither needs a card). [`docs/self-hosting.md`](./docs/self-hosting.md) walks through
each one, including the two mistakes everybody makes with Neon's two connection strings.

Then prove it is working rather than merely running:

```bash
curl -fsS localhost:3000/api/health
node --env-file=.env scripts/verify-api.mjs http://localhost:3000
```

> **Locally, health reports `degraded` and that is correct** — `queue` and `rootKey` name the two
> Cloud-only features you deliberately left unset, and both have working local fallbacks.
> `verify-api.mjs` is written to run against a **deployed** instance; against a local dev server
> some checks are environment-sensitive rather than product failures.
> [`docs/self-hosting.md`](./docs/self-hosting.md#verifying-a-local-install) says exactly which,
> and why.

<details>
<summary><b>Running the production image, and other commands</b></summary>

```bash
npm run check        # lint · typecheck · tests with coverage thresholds · docs. The CI gate
npm run build        # production build (needs no environment)
npm test             # critical-path tests on Node's built-in runner
npm run docs:build   # regenerate docs/nodes.md from the registry
npm run db:generate  # write a migration from src/db/schema.ts

# The same image Cloud Run runs. 8080 maps to 3000 so the OAuth redirect URI still matches.
docker build -t agentforge .
docker run --rm --env-file .env -p 3000:8080 agentforge
```

</details>

---

## Architecture

**One container, one database.** No worker, no broker, no second service. That is not a
simplification made for a demo — it is the constraint the design is bent around, because the
project has a hard zero-cost ceiling.

```
                        Browser
            ┌───────────────────────────────┐
            │  Canvas · prompt · live run   │
            └──────────────┬────────────────┘
                           │ HTTPS + SSE
        ┌──────────────────▼──────────────────────────┐
        │   Cloud Run — one container, scales to zero │
        │                                             │
        │   Web / API ──▶ execution engine ──▶ node   │
        │                        │             registry│
        │                  agent layer ◀─────────┘     │
        │                        tools ARE registry rows│
        └──────────────────┬──────────────────────────┘
                           │
      ┌────────────────────┼──────────────┬─────────────────┐
      ▼                    ▼              ▼                 ▼
 Neon Postgres      Gemini · Groq    nine services    Cloud Tasks
                                                     (durable runs)

 Cloud Scheduler ──▶ POST /api/cron/tick    (schedule triggers)
```

Built as **harvest**: fresh code in one Next.js app, borrowing React Flow and Auth.js, writing the
engine, the registry, the generation layer and the provider adapter here. No fork to strip.

The dependency list is short on purpose — **no LLM SDK, no test framework, no queue client, no
telemetry exporter, no component library** — and each absence is a decision with its reasoning
written down:

| Read | For |
|---|---|
| [`docs/architecture.md`](./docs/architecture.md) | The orientation |
| [`adr/`](./adr/) | The decisions, in standard form, including [the one that was superseded](./adr/0004-no-queue.md) |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | The full version, including what is intentionally simplified and what it costs |

---

## Design

**Toybox** — bright, playful, light-first. Saturated colour, thick ink outlines, hard offset
shadows and springy motion. Deliberately not a dark IDE, which is what every competing tool looks
like.

<img src="./docs/assets/design-system.png" alt="The Toybox design system page, showing surface colour tokens with their computed contrast ratios" width="100%" />

Every contrast figure on
[`/design`](https://agentforge-733000675212.asia-southeast1.run.app/design) is computed by the
same module that **fails the build** when a token drops below WCAG AA. Nothing there is a claim.
The language is written down in [`DESIGN.md`](./DESIGN.md).

---

## Documentation

| | |
|---|---|
| [**Self-hosting**](./docs/self-hosting.md) | Local, Docker, and Cloud Run — and how to keep it free |
| [**Node reference**](./docs/nodes.md) | All 30 nodes. **Generated from the registry**, so it cannot drift |
| [**API reference**](./docs/api.md) | Every route, its role, and how a request is authorised |
| [**How the agents work**](./docs/agents.md) | Generation, the bounded loop, and what the agent cannot reach |
| [**Architecture**](./docs/architecture.md) | The orientation, and the one idea the rest follows from |
| [**Decision records**](./adr/) | Why there is no LLM SDK, no queue (and then a queue), one registry |
| [`SECURITY.md`](./SECURITY.md) | The posture, the rotation procedures, and **what is not claimed** |
| [`OPERATIONS.md`](./OPERATIONS.md) | The signals, the runbooks, the budget |
| [`CONTRACT.md`](./CONTRACT.md) | Interfaces that must stay stable across changes |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | The opinions, and how to add a node |

Documentation here is **checked rather than trusted**: CI fails if the node reference drifts from
the registry, if a route is undocumented, or if any link in the docs points at a file or heading
that does not exist.

---

## Status

Built in 13 phases for the Zero Origin hackathon and
[submitted](https://devpost.com/software/agentforge-kz832x) on 2026-09-26. It has been built out
since into a real product: durable execution, versioning, workspaces, roles and sharing, a
credential vault with rotation, observability and analytics, a 30-node catalogue, a second model
provider, and this documentation.

It is live, it works, and [`PROGRESS.md`](./PROGRESS.md) is the honest status board — including
what is unfinished.

<img src="./docs/assets/landing.png" alt="The deployed AgentForge landing page — 'Describe the automation. Get a workflow that runs.'" width="100%" />

---

## Contributing

Issues and pull requests are welcome. [`CONTRIBUTING.md`](./CONTRIBUTING.md) covers setup, the
opinions worth knowing before you write code, and how to add a node — which is the cheapest
contribution the architecture allows.

Found a security problem? [`SECURITY.md`](./SECURITY.md), **not** a public issue.

## License

[MIT](./LICENSE) © 2026 Arunish Rajput.

Every adopted dependency is permissive — Next.js, React, React Flow, Zod and Tailwind MIT, Auth.js
ISC, Drizzle Apache-2.0, postgres.js public domain — verified from each project's own licence file
rather than from a detected label.
