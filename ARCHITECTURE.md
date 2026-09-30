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
the canvas and Auth.js for Google OAuth; write the execution engine, the node registry, the
generation layer and the provider adapter ourselves. No borrowed codebase, no fork to strip.

> **Corrected in Phase 12.** This sentence named the **Vercel AI SDK** for provider-agnostic
> tool-calling. It was adopted at Phase 0 on licence grounds and then **`SUPERSEDED` at Phase 6
> (D32)** — `ai` and `@ai-sdk/google` are deliberately **not installed**, and the provider adapter is
> a `fetch` client we own. `PROGRESS.md` D32 said this table had been corrected; it had not, and
> Phase 12's doc reconciliation is what caught the drift. The reasons are in D32 and the decisive
> one is D33: Gemini signs every `functionCall` with a `thoughtSignature` and answers **400** to a
> history that has lost one, so a normalising adapter passes its first tool call and fails on the
> second.

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
| **Vercel AI SDK** (`ai`) | Apache-2.0 | Licence-wise yes; **`SUPERSEDED` at Phase 6 (D32) and never installed** — the provider adapter is a `fetch` client we own |
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
| ~~`ai`~~ | ~~7.0.114~~ | **SUPERSEDED in Phase 6 — not installed.** See *Agent and tool-calling architecture* |
| ~~`@ai-sdk/google`~~ | ~~4.0.80~~ | **SUPERSEDED in Phase 6 — not installed.** Same |
| `next-auth` | **5.0.0-beta.32** | see the note below |
| `@auth/drizzle-adapter` | 1.11.3 | |
| `drizzle-orm` / `drizzle-kit` | 0.45.3 / 0.31.11 | peers include `@neondatabase/serverless >= 0.10.0` |
| `@neondatabase/serverless` | 1.1.0 | |
| `zod` | 4.6.5 | |
| `tailwindcss` | 4.3.3 | Tokens in `@theme`, component classes as `@utility`. **No component library** — see *Design system* |
| `next/font` (Geist, Geist Mono) | bundled with Next | **Added in Phase 10.** Self-hosted, `latin` subset, variable axis. Not a dependency: `next/font` is part of Next |
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
wiring, then 5–10 minutes per deploy thereafter. Against a tight hackathon budget with a
non-negotiable Phase 2 deploy, that is the wrong trade.

**Railway** — `SUPERSEDED`. Docker-native and pleasant, but the only candidate that is not free
through judging: the Free plan gives $1/month of credits capped at 1 vCPU / 0.5 GB per service,
and the one-time $5 / 30-day trial is consumed in roughly 3 days by a four-service stack, or ~10
days by one service plus external Postgres. The credit runs out inside the judging window.

Both are recorded as unimplemented fallbacks in `DEPLOYMENT.md`.

### Cost of this choice

- **Cold starts.** With `min-instances=0`, the first request after idle pays container start.
  Mitigation: run `min-instances=1` during the hackathon, funded by the $300 credit, and drop to 0
  afterwards. `DEMO.md` also warms the service before the demo
- ~~**In-flight runs die on redeploy.**~~ **Closed in Phase 17.** Cloud Run still replaces
  revisions and still kills the container mid-run — what changed is what happens next. A
  **durable** run is a Cloud Tasks task, so a delivery that dies is redelivered and the engine
  resumes from the cursor its predecessor left. A **synchronous** run still dies, deliberately:
  `POST /runs` answers with the finished run, which is what the canvas and every script read, and
  that shape cannot survive a redeploy by definition. The sweeper knows the difference and only
  fails the ones nothing is coming back for — see *Execution engine design*
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
| **Design system** | **Toybox** (Phase 14). Tokens, component utilities and the React Flow theme in `src/app/globals.css`; keyboard-complete React primitives in `src/components/ui/`; the palette catalogue and the contrast maths in `src/lib/design/`; the living gallery at `/design`. Components name a token and never a raw value |
| **Node registry** | The single source of node types. Each entry declares its type, schema, and execute function. Serves three consumers: the engine's dispatch, the canvas's palette, and the agent's tool set |
| **Execution engine** | Walks the workflow DAG in-process, calls the registry per node, threads output forward, writes step records, emits events |
| **Agent layer** | Provider adapter over the LLM, prompt assembly, and the bounded tool-calling loop whose tools are derived from the registry |
| **Generation** | Natural language → validated workflow JSON → persisted workflow |
| **Versioning and diffing** | Phase 18. One compact snapshot per save (`src/lib/workflow/versions.ts`), a pure graph diff (`src/lib/workflow/diff.ts`), and the canvas's read-only diff mode (`src/components/canvas/diff/`) |
| **Tenancy** | Phases 19A–19B. `src/lib/workspace/` — the `WorkspaceScope` every store function takes, the one query that resolves it per request, invitations, and **the role check every mutating route now passes through**. **No query in the product reads across a workspace** |
| **Credential vault** | Phase 21. `src/lib/crypto/` — AES-256-GCM (`aes.ts`), the versioned root key (`root-key.ts`) and the two-layer envelope (`envelope.ts`); `src/lib/credentials/` — the store, the rotation registry, the re-key loop, the audit log and the vault's read model; `src/lib/gcp/` — the metadata server and Secret Manager over `fetch` |
| **Persistence** | Neon Postgres. Workspaces and memberships, users, credentials, **credential events**, workflows, workflow versions, runs, run steps |
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

## Design system — Toybox

**Phase 14 replaced the Chapter 1 dark system.** The language is `DESIGN.md`; this is its shape in
the codebase.

```
src/app/globals.css        @theme    colour, type, radius, elevation, easings, animations
                           @utility  btn* / field / card* / chip* / eyebrow / squish
                                     dotted / sweep-bar / hero-glow / pad-safe
                           .react-flow  React Flow's variables, pointed at those tokens
                           @media    prefers-reduced-motion — one blanket rule
src/components/ui/         the React primitives: button, field, card, badge,
                           dialog, toast, notice, tooltip, tabs, menu,
                           illustration; tone.ts is the shared message table
src/components/shell/      the signed-in shell (Phase 15): app-header,
                           account-menu, command-palette, logo
src/components/landing/    the landing page's demonstration and node catalogue
src/lib/design/            contrast.ts   the oklch → WCAG maths
                           palette.ts    the token catalogue, with roles
                           illustrations-static.ts  the generated public/ SVGs
src/lib/ui/command.ts      the command palette's ranking, with tests
src/app/design/            the living gallery, prerendered and public
```

**Phase 15 added the shell, and two rules came with it.** The header is a *server* component that
takes the current page as a prop rather than subscribing to `usePathname()`, and the sign-out server
action is defined there and passed into the client account menu — clearing an httpOnly cookie is not
something a client fetch can do. The command palette is mounted by the header, so it exists on the
two shell pages and not on the public landing page or the gallery, where it would have nothing to
search and no session to search it with.

**Chapter 1 had deliberately no `components/ui`, and Phase 14 reversed that.** The old reasoning —
"a button is a class, not a component; a wrapper per control buys indirection and costs a file each"
— holds exactly as long as the controls carry no behaviour. It stopped holding the moment the system
needed a dialog that traps focus, a tablist with a roving tabindex, a menu that answers arrow keys
and a toast region that exists before its first message. **None of that fits in a CSS class**, and
hand-rolling it per call site is how it gets shipped broken.

So the two coexist, and that is the arrangement rather than a migration half-done:

- **The utilities are the language.** `btn btn-primary` is still correct, still first-class, and the
  ~90 Chapter 1 call sites that use it were not migrated because they are not wrong
- **The primitives are the language plus behaviour.** New code reaches for `<Button>` because it
  also gets the accessibility properties. `<Button>` renders `btn btn-primary`

Properties this arrangement protects, each learned the hard way:

- **A component names a token, never a colour** (D49). `CATEGORY_STYLE` and `STATUS_STYLE` in
  `components/canvas/context.ts` are still the *only* mapping from a domain concept to a colour.
- **React Flow's stylesheet is imported in `globals.css`, not in `editor.tsx`**, so the cascade
  order — Tailwind preflight, React Flow's layout CSS, our overrides — is explicit rather than
  dependent on how the client bundle was assembled.
- **Reduced motion is honoured in two places.** The CSS block covers every animation and transition;
  `src/lib/canvas/motion.ts` covers React Flow's `fitView`, which tweens in JavaScript where a media
  query cannot reach.

The theme is **light only** (D65, superseding D48's dark-only). `color-scheme: light` on `:root` is
required, not cosmetic: without it the `<select>` in every registry-generated config form renders as
a dark OS widget inside a cream panel — the exact mirror of the Chapter 1 problem.

**Contrast is not a matter of opinion here.** `src/lib/design/contrast.ts` converts the `oklch()`
tokens to linear sRGB; `src/app/tokens.test.ts` asserts WCAG AA for every pairing the product uses
and fails the build otherwise (D52, extended in Phase 14 to the two-register rule, the focus-ring
rule, the outline rule, the sRGB-gamut rule and the no-blur shadow rule). The **same module** feeds
the `/design` gallery, so every figure a reader sees on that page is the figure CI asserts.

---

## Execution engine design

Sequential, resumable, and indifferent to which process is running it.

1. A trigger creates a `run` row in **`queued`** — a status Chapter 1 reserved and never wrote
2. A worker **claims** the run, which moves it to `running`. The claim is a compare-and-set on the
   lease; see *Leases* below
3. Resolve execution order from the workflow's edges as it runs — a work list, not a static
   topological sort, because branch and loop outputs mean the order is only known as it goes. A
   topological pass is still used for *validation*, to reject any cycle that does not close
   through a loop node
4. For each node: write a step record, resolve its config, call the registry's execute function
   with upstream output — **applying that node's retry and timeout policy** — record status /
   output / error / timing, emit an event
5. **Checkpoint.** One `UPDATE ... RETURNING` writes the frontier, extends the lease, and reads
   back whether a cancellation was requested. One statement, because on Neon's free tier a
   per-step poll for cancellation would double the cost of every run in the product
6. Branch nodes evaluate a condition and mark untaken paths skipped
7. Loop nodes re-enter a bounded subgraph with a hard iteration cap
8. A node failure fails the run, with the error attached to that step
9. The run ends `succeeded`, `failed`, or `cancelled` — or the engine **stops without writing a
   status**, because it lost the lease and the run is somebody else's now

### Two modes, and the only thing that separates them

| Mode | Who executes it | Survives a redeploy | Why it exists |
|---|---|---|---|
| `sync` | the request that started it | **No** | `POST /runs` answers with the finished run and every step. The canvas's Run button, `DEMO.md` and every verification script read that shape, and a request that returns before the run is over cannot have it |
| `durable` | a Cloud Tasks delivery | **Yes** | Nobody is watching a scheduled run at 03:00, and nobody will press Run again |

Manual runs default to `sync`; the canvas offers "Queue a run" for the other. **Scheduled runs are
always durable**, which is also what let the cron tick stop executing its runs inline — it now only
enqueues, so `MAX_FIRES_PER_TICK` went from 3 to 25.

### Leases — the property that makes at-least-once delivery safe

**Cloud Tasks delivers at least once.** A delivery whose HTTP request fails is retried, and "fails"
includes a container that finished the work and died before answering. Without an interlock, the
observable result of durable execution would be a workflow that posts two Discord messages — worse
than the problem durability was added to solve.

So a delivery may only execute a run it **claimed**, and a claim is a conditional
`UPDATE ... RETURNING` against `leaseExpiresAt`. `neon-http` has no transactions (D6), so that is
the only atomic primitive available — and it is enough, exactly as it was for the cron tick's
schedule claim (D42). Two containers racing one task: one update matches a row, the other matches
none, and the loser does nothing. Every comparison uses the **database's** clock, never a
container's, because under `max-instances 3` there are three of them.

The lease is 180 s against the engine's 120 s attempt deadline, so it cannot lapse while a
legitimate attempt is still inside its own budget.

### Resuming

The frontier is a **cursor** on the run row: the outstanding work list and the per-node execution
counts. Node **outputs are not in it** — they are already one per `run_step` row, so a queue entry
names the `seq` whose output feeds it and the engine reads them back on resume. The cursor's size
therefore depends on the shape of the graph and never on the size of the data flowing through it,
which matters twice over: it is written once per step on a metered database, and Cloud Tasks bills
per 32 KB of task payload.

The deadline applies to **each attempt**, not to the run's whole life. The alternative is a run
that can never finish because its first attempt spent the clock.

**A redelivered run executes the graph it started on, not the graph as it is now** — Phase 18.
Durability means a run survives a redeploy, which means it can also survive an *edit*: delivery 1
runs three nodes of v4, the author saves v5 removing one of them, and delivery 2 resumes from a
cursor naming a node that no longer exists. The run's recorded `workflowVersion` is what closes it;
the snapshot is read back and executed. A run with no recorded version, or whose snapshot was
pruned, falls back to the live graph — the pre-Phase-18 behaviour, so nothing in flight broke when
this landed.

### The sweeper knows which runs are actually lost

Chapter 1's `reapStaleRuns` failed every `running` run whose heartbeat had gone quiet, because a
quiet run *was* a lost run. Sweeping that indiscriminately now would destroy the durability this
phase adds — a durable run between deliveries looks exactly like an abandoned one. So
`sweepAbandonedRuns` fails only what nothing is coming back for: a `sync` run, a durable run whose
deliveries are spent, or a durable run that was never delivered at all because its enqueue failed.

Still deliberately simplified, and what each costs:

| Simplification | Cost |
|---|---|
| Runs inside a request | Bounded by Cloud Run's 60-minute timeout |
| No parallel node execution | A wide DAG runs slower than it could |
| No join semantics — a node with several incoming edges runs when the first one reaches it | A diamond's merge point runs twice, once per arriving branch, rather than waiting and merging |
| Cancellation lands at a step boundary | A node already talking to Gmail is not interrupted. A request in flight cannot be un-sent, and pretending otherwise would be worse than saying so in the UI |
| A synchronous run still dies on redeploy | Inherent to answering with the finished run. Durable mode is the escape hatch, and the sweeper tells the two apart |
| Bounded loops only | No unbounded `while`. Deliberate — it is also a safety property |


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

Tool-call schema: `CONTRACT.md` → *Agent tool-call schema*, **DEFINED** in Phase 6.

### Generation as built — Phase 7

```
src/lib/generate/
  schema.ts    what a model may emit (pure) — no positions, no edge ids, no version
  prompt.ts    registry -> the node catalogue the model is given (pure, tested)
  layout.ts    nodes + edges -> positions, cycle-safe and non-overlapping (pure, tested)
  generate.ts  the pipeline: ask -> parse -> assemble -> validate -> one retry (takes the model)
```

**Generate → validate → persist, and nothing in this directory touches the database.** The route
inserts only what `generateWorkflow` returns as `ok: true`, which is what makes "a broken workflow is
never saved" a structural property rather than a promise.

**The catalogue is the registry**, via the same `describeNodes()` the palette and the agent tool set
read. A hand-written node list in a prompt drifts the first time a node changes, and the drift shows
up as a model emitting config the engine rejects — on demo day. This is also why Phases 8 and 9 need
no generation change: registering a node makes it generatable.

**The model is asked only for what it alone knows.** Nodes and edges, plus `unsupported`. The system
supplies `version`, layout positions and edge ids (D40) — a model cannot lay out a graph, and an
overlapping one reads as broken on stage.

`generateWorkflow` takes its `LanguageModel` as an argument, the same trick as the engine's recorder
(D18): the whole pipeline is tested against a scripted model in milliseconds, with no key and no
quota. What a live model adds is whether it can follow the prompt, which is what the deployed
verification measures.

### The adapter as built — `fetch`, no SDK (D32)

```
src/lib/ai/
  types.ts     provider-agnostic interface + the lossless ChatTurn
  schema.ts    JSON Schema → Gemini's OpenAPI subset (allow-list, pure, tested)
  tools.ts     registry → tool definitions (pure, tested)
  loop.ts      the bounded tool-calling loop (pure, tested against a fake model)
  gemini.ts    the one HTTP implementation: retry, model fallback, wire parsing
  provider.ts  stored key → a usable LanguageModel
  settings.ts  the write-only settings API's logic
```

`ai` and `@ai-sdk/google` were in the adopted stack and are **not installed**. Four reasons, each
one discovered by calling the real API rather than reasoning about it:

1. **The history must be byte-exact.** Gemini 3 rejects a conversation whose `functionCall` parts
   have lost their `thoughtSignature`. That demands control of the wire history, which is the thing
   an SDK abstracts away.
2. **The tool schema needs a sanitiser we own anyway.** Gemini rejects `additionalProperties`, which
   Zod emits for real registry nodes.
3. **Retry and a model fallback chain are demo-reliability properties.** `gemini-3.8-flash` answered
   503 "experiencing high demand" on a first call. Through an SDK that is custom middleware; here it
   is fifteen lines in the one place that makes HTTP requests.
4. **Each tool call must become a visible, streamed step.** The engine already owns step recording
   and `context.log`; an SDK's internal loop is a second loop to reconcile with it.

The cost of the decision is one file of wire-format knowledge. The benefit is zero new dependencies,
a smaller container, and tests that inject a fake `fetch` with no module mocking — which matters
because `npm test` runs the TypeScript sources directly on Node's own runner.

**The pure/impure split is deliberate.** `schema.ts`, `tools.ts` and `loop.ts` touch no network, no
database and no registry state, so the property that actually matters — a model that never stops
calling tools is stopped by the cap — is asserted in a millisecond instead of against a live quota.

---

## Database

Neon Postgres, free tier.

- **Two connection strings.** `DATABASE_URL` is Neon's **pooled** endpoint, used by the app —
  Cloud Run instances multiply connections and Neon's free compute has a low limit.
  `DATABASE_URL_UNPOOLED` is the direct endpoint, used for migrations, which need a session
  connection that pooling breaks
- **Neon's free tier meters compute time awake, not statements.** This is the fact that decides
  whether a feature is affordable, and Phase 19A is the worked example: workspaces add a query to
  requests that already make one, and add no poller, tick or background job, so they cost
  essentially nothing against the ~39 CU-hour balance. What costs is a **new reason to wake an idle
  database**. Phase 22's analytics is the one that must be designed against the number
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
  | `workflow` | 3 | Owns the graph as a single `jsonb` column. **`visibility` and `shareToken` since 20** — who inside the workspace may see it, and the public read-only link. Partial unique index on `shareToken where not null` |
  | `run` | 3 | One per execution; `heartbeatAt` is what makes an interrupted run observable |
  | `run_step` | 3 | One per node execution, unique on `(runId, seq)`; snapshots its resolved config |
  | `credential` | 3 | Table only. Encryption and the write-only API are Phase 6. **Unique on `(workspaceId, kind, label)` since 19A** |
  | `workflow_version` | **18** | One compact snapshot per save — `number`, `name`, `graph`. Unique on `(workflowId, number)` |
  | `workspace` | **19A** | **The tenant.** Every resource belongs to one. Unique partial index on `createdBy where personal` |
  | `workspace_member` | **19A** | Who is in a workspace and as what. `(workspaceId, userId)` primary key. `role` is written here and **enforced since 19B** |
  | `workspace_invitation` | **19B** | An invitation by email on a hashed, expiring, single-use token. Partial unique index on `(workspaceId, email)` among rows neither accepted nor revoked — **that index is what makes re-inviting an atomic upsert** rather than a read-then-write race |

- **`workspaceId` is the scoping column, and it sits alongside `ownerId` rather than replacing it**
  — Phase 19A, on `workflow`, `run`, `workflow_version` and `credential`. The two answer different
  questions and both are worth keeping: `workspaceId` answers *who may see this*, `ownerId` answers
  *who made this happen*. Collapsing them would cost the run history the only record it has of who
  triggered a run
- **The migration was expand/contract, in two steps with a deploy between them.** `0005` added the
  tables and the columns **nullable** and backfilled a personal workspace per user, so the previous
  revision — which knows nothing about `workspaceId` — kept serving throughout; `0006` set the
  columns `NOT NULL` once the new revision was the only one running. The rollback is hand-written
  (`drizzle/rollback_0005_0006.sql`) and was rehearsed forward *and* backward on a throwaway schema
  holding a copy of the real rows before either half was applied — `scripts/rehearse-migration.mjs`

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
  graphs as strings. `graphsEqual` in `src/lib/workflow/graph.ts` is the single structural
  comparison, shared since Phase 18 by the canvas's dirty check and the version debounce
- **Versioning needs no sequence table and has no read-then-write race** (Phase 18). `neon-http`
  has no transactions, so `max(number) + 1` read and inserted a moment later is a genuine race.
  The number lives on `workflow.version` and is bumped **inside the same single-row UPDATE that
  writes the graph**, with `RETURNING` handing back a number no concurrent save can have. Same
  primitive D42 uses to claim a cron slot. A gap in the sequence is legal: a snapshot that could
  not be written must not fail the user's save
- **Version history is append-only and capped.** Restoring writes forward; nothing renumbers.
  `VERSION_LIMIT` is 50 unlabelled versions per workflow — measured at ~737 bytes per stored
  graph, so a fully-capped workflow is ~60 KB against a 0.5 GB free tier
- **Phase 20's migration cost nothing and changed nothing anybody can observe.** Three columns on
  `workflow`, all with a default or nullable, so the previous revision kept serving while `0008`
  was applied and no data migration was needed: `visibility` defaults to `workspace`, which is
  exactly what every row already behaved as. Row counts were identical before and after, and the
  rollback was rehearsed forward *and* backward on a throwaway copy — digest-identical —
  before it was applied (`scripts/rehearse-0008.mjs`). That rehearsal exists because the *rollback*
  drops columns from the table holding the user's actual workflows, not because the migration is
  risky
- **Authorisation reaches into the query for the first time in Phase 20.** `visibleWorkflows(scope)`
  is a `where` fragment, not a refusal, and it returns `undefined` for an admin so that
  `and(…, visibleWorkflows(scope))` composes with no branch at the call site. It is applied in
  `listWorkflows` and `getWorkflow` — which every workflow-scoped route goes through — plus
  `getRun` and `listRuns`, which are addressed by *run* id and therefore join `workflow` to reach
  it. Those two joins are the whole of the exception list, and missing them would have meant a
  viewer reading the steps of a workflow they cannot open

---

## API surface

Shapes are `NOT YET DECIDED` until the phase that needs them; the surface is:

| Area | Routes | Phase |
|---|---|---|
| Auth | Auth.js handlers | 1 |
| Workflows | list, create, read, update, delete | **3 — done** |
| Runs | trigger, list, read with steps | **3 — done** |
| Registry | `GET /api/nodes`, the palette projection | **3 — done** |
| Live | SSE stream for a run | **5 — done** |
| Generation | natural language → workflow | **7 — done** |
| Webhook | `POST /api/webhook/:token`, unguessable per-workflow receiver | **8 — done** |
| Cron | `POST /api/cron/tick`, `CRON_SECRET`-guarded, Cloud Scheduler only | **8 — done** |
| Settings | provider/model config, credentials write-only | **6 — done** |
| Workspaces | list, create, switch, rename, members, invitations | **19A/19B — done** |
| Membership | `PATCH /api/workspaces/:id/members/:userId`, change a role | **20 — done** |
| Sharing | `POST`/`DELETE /api/workflows/:id/share`, and `GET /api/share/:token` with no session | **20 — done** |

Every route except **four** requires a session and scopes its query to the caller's **workspace**,
enforced server-side. The four are `GET /api/invitations/:token` and `GET /api/share/:token`, both
reached by a link holder who may have no account, and the three machine endpoints — the webhook
receiver, the cron tick and the run dispatcher — which authorise themselves with a token and derive
their scope from the row it resolved to.

### The authorisation layer is one funnel, and Phase 20 is where it became complete

`requireScope(minimumRole)` in `src/lib/api.ts` is the single place a route's authority is
established: it resolves the session, resolves the active workspace, and refuses when the member's
role falls short. **The default argument is `viewer`**, so a new mutating route that forgets the
argument fails closed rather than open.

Phase 20 added the two rules that a single ranking cannot express, and both are **pure functions
tested without a database**:

- **`roleChangeRefusal`** (`lib/workspace/roles.ts`) — who may move whom to what. Ordered
  authority → ownership → invariant, which is Phase 19B's bug fix carried across
- **`visibleWorkflows`** (`lib/workflow/visibility.ts`) — which *rows* a member may see, as a
  `where` fragment rather than a refusal. It is the first authorisation in the product that filters
  rather than refuses, which is why it belongs in the query and not in a route

**A hidden button is not a permission.** Phase 20 also stopped the UI offering controls the API
refuses, and that is a usability change rather than a security one: every control it withholds was
already refused server-side and is still asserted to be, by 56 cells of the deployed matrix.

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

## Queue — Cloud Tasks for durability, in-process for everything else

**This section said "deliberately none" until Phase 17.** The old reasoning is kept below because it
was correct and because what changed was the *product*, not the analysis.

> **Superseded, Phase 17.** The original justification read: "the MVP's runs are short and
> user-initiated. A queue would add a service, a dependency, a failure mode, and deploy complexity
> to buy durability the demo does not need." Every clause was true of a hackathon demo. Two stopped
> being true of a product: a **scheduled** run is not user-initiated and has nobody to press Run
> again, and Chapter 1's carried risk "in-flight runs die on redeploy" is not something to ask a
> real user to live with.
>
> What made it affordable is that **Cloud Tasks costs none of the four things that were being
> avoided.** No service — the worker is a route in this same container. No dependency —
> `@google-cloud/tasks` brings gRPC, so the adapter is one authenticated `fetch` against the REST
> API, and the runtime dependency list is still the Phase 4 one. No deploy complexity — a queue and
> one IAM binding, created once. And free: 1,000,000 operations a month against roughly three per
> run.

**Still no Redis, no BullMQ and no worker service.** The engine runs in the web container either
way; the queue decides *which request* runs it.

- **Durable runs** go through Cloud Tasks to `POST /api/runs/dispatch`. The task carries a run id
  and that run's dispatch token — never a payload, because Cloud Tasks bills per 32 KB chunk and
  the graph is already in Postgres.
- **Synchronous runs** are executed by the request that started them, as before.
- **Not configured is a supported state.** There is no metadata server on a developer machine and
  no queue in CI, so `enqueueRun` reports that and the caller executes in-process instead — still
  leased, still checkpointed, still resumable, just not redeliverable. The hazard is that the
  *deployed* service could do the same silently, so `GET /api/health` reports the queue's
  configuration and the deployed verification asserts it.

**Schedule triggers still do not use an in-process timer.** Cloud Run scales to zero, so
`setInterval` simply does not fire. **Cloud Scheduler** — Google-managed cron, free tier covers it —
calls `POST /api/cron/tick` guarded by a `CRON_SECRET`, and that handler fires whatever schedules
are due. Built and verified in Phase 8; unchanged in shape.

What Phase 17 changed about the tick:

- It **enqueues** rather than executes. The old bound of 3 schedules per tick existed because the
  tick held its request open for the sum of its runs against Cloud Scheduler's 540 s attempt
  deadline. Enqueueing costs one call each, so the bound is now 25 and is about database writes
  rather than about the engine.
- It is the **sweeper's only scheduled caller**, across every owner. `listRuns` sweeps only the
  owner asking, so a run abandoned by a user who never comes back would otherwise stay `running`
  for ever on nobody looking at it.
- A duplicate tick is still safe by **claiming** each schedule with a compare-and-set before firing
  it (D42) — which is the same primitive the run lease uses, for the same reason.

**The tick interval is a database-cost decision, not a latency one.** Neon's free plan allows 100
CU-hours a month and its 5-minute autosuspend cannot be disabled, so a tick more frequent than about
6 minutes pins the compute awake permanently and exceeds the allowance. The job runs every 15
minutes; the arithmetic is in `DEPLOYMENT.md`.

Revisit the choice of queue only if a genuine need appears, and flag it as a material change.


## Auth

Google OAuth only, via Auth.js v5 (assuming the harvest path; a fork's own auth system with a
Google provider added would substitute).

**The redirect URI is a sequencing trap.** The production redirect URI needs the deployed URL,
which does not exist until the first deploy. Therefore:

- **Phase 1** — create the OAuth client with `http://localhost:3000/...` only
- **Phase 2** — deploy, capture the real Cloud Run URL, then a second short manual action adds the
  production redirect URI

~~Whether the newer deterministic `<service>-<project-number>.<region>.run.app` URL form allows
pre-registering the production URI before the first deploy is `UNKNOWN — VERIFY` at Phase 2.~~
**RESOLVED at Phase 2: it can.** Both parts are knowable in advance — the service name is chosen and
the project number comes from `gcloud projects describe <project> --format='value(projectNumber)'` —
and the predicted URL matched the deployed one exactly. A future rebuild can register OAuth before
deploying and collapse the two-step into one. The two-step is still the safe default when the URL
form is not known in advance. Exact values live in `DEPLOYMENT.md`.

Integration credentials (Google API scopes for Sheets and Gmail, Discord webhook URLs) are stored
encrypted **per workspace** since Phase 19A, separate from the sign-in session.

**Sign-in identifies a person; a workspace decides what they can reach.** Auth.js answers *who is
this*, and nothing more — every authorisation question is answered by a `workspace_member` row, not
by the session. A new account is given a personal workspace by the `createUser` event, and the scope
resolver creates one if it ever finds none, so the event is a convenience rather than a correctness
requirement: a failure there is repaired by the next request instead of locking somebody out.

**Which workspace a request is in comes from a cookie that grants nothing** — `af_workspace`,
Phase 19B. It is unsigned and carries only a workspace id, because `chooseMembership` honours that id
only when it appears in the memberships the database just returned for this user. A forged cookie, a
borrowed one and a stale one all fall back to the user's own personal workspace. The alternative — a
signed cookie, or a column on `user` — would buy nothing the membership query does not already
provide, and the column would additionally make the choice global across every tab.

**Authorisation is one function, called in one place.** `requireScope(minimumRole)` resolves the
scope and calls `assertRole`; `requireScopeFor(workspaceId, minimumRole)` does the same for routes
that name a workspace in the path. The default minimum is `viewer`, so a route that forgets the
argument fails closed rather than open. `CONTRACT.md` → *What each role may do* holds the matrix.
**Phase 20 built on this floor rather than replacing it**: role changes, per-workflow visibility and
the share link all go through the same funnel, and the UI now withholds what the funnel refuses.

**An invitation is the product's third unauthenticated surface**, after the webhook trigger and the
dispatch endpoint, and it is built on the same rules: a CSPRNG token, checked against a pattern
before the database is asked anything, expiring, single use — and, unlike the webhook token, **stored
only as a hash**, because it is shown once rather than displayed for ever. Possession is never
sufficient: the accept path also requires a session whose provider-verified email matches the address
invited.

**The public share link is the fourth, and the only one whose risk is in the response.** A webhook
starts a run, a tick fires schedules, an invitation preview names one workspace — each is guarded by
what its request may *cause*. `GET /api/share/:token` hands back content, so what it may carry is
decided by an allowlist in `lib/workflow/share.ts` whose default publishes nothing, and the route
itself does no field selection. A node type added in a later phase therefore cannot widen this
surface by existing; a test asserts the table covers the registry, so it fails the build instead.

### Secrets at rest — envelope encryption, Phase 21

Chapter 1 encrypted every credential directly under `ENCRYPTION_KEY` and documented, accurately,
that rotating it destroyed all of them. That is a property of any scheme where the key an operator
can rotate is the key the data is under. Phase 21 added one layer of indirection, and everything
else follows from it:

```
   the secret  --AES-256-GCM-->  ciphertext      key: a fresh 256-bit DEK, one per credential
   that DEK    --AES-256-GCM-->  wrappedKey      key: the root key, versioned in Secret Manager
```

**Rotating the root key re-wraps ~60 bytes per credential and never reads a secret.** That is what
turns "never rotate this" into an operation with a procedure (`SECURITY.md` → *Rotating the root
key*). It is resumable by construction — every row is an independent `UPDATE` naming the key that
wraps it, so an interrupted re-key leaves a database in which *every* row still decrypts — which is
why it needs no maintenance window and could not have been written any other way under D6.

**Secret Manager rather than Cloud KMS, and that is a cost decision with a real cost.** KMS is the
textbook home for a root key and would keep it inside Google's HSM; it is ~$0.06 per key per month
plus operations, and the zero-cost ceiling binds. Secret Manager's free tier covers the root key —
6 active versions, 10,000 access operations a month — and hands us the bytes, which this process
then holds in memory for the life of the instance. `SECURITY.md` → *What we do not claim* states
that difference rather than hiding it.

**No client library, following Phase 17.** Secret Manager is one authenticated `GET` with a token
from the metadata server, so `src/lib/gcp/` is ~200 lines of `fetch` and the runtime dependency
list is still the Phase 4 one. Phase 21 also **extracted the metadata and token code out of
`lib/engine/queue.ts`** into `lib/gcp/metadata.ts`: Cloud Tasks and Secret Manager now share one
token cache, because two caches on one instance are two things that can disagree about when the
token expired.

**Accessing `latest` resolves the version *and* returns its number**, so sealing costs one access
operation and no `versions.list`. A version's bytes are immutable, so they are cached for the life
of the instance and the cache can never be stale; `latest` is cached for five minutes instead,
which is how long a rotation takes to reach a warm instance.

**Refusing beats falling back.** If `ROOT_KEY_SECRET` is set and Secret Manager is unreachable, a
write fails. A silent fallback to `ENCRYPTION_KEY` would seal new credentials under a key the
operator believes is retired, leaving rows a later rotation would skip — and nothing would report
it.

### The credential audit log

`credential_event`, written from `readSecret` and nowhere else, because that is the single funnel
every plaintext passes through. It records *use* — which run, which node, when — and never content.
Retention is 30 days, pruned by the cron tick, which is the only thing in this system that runs on
a clock. `CONTRACT.md` → *The credential audit log* is the shape; `SECURITY.md` is the reasoning,
including the deliberate trade that an audit insert which fails is logged and swallowed rather than
failing the run it was auditing.

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

## The provider time budget and the circuit breaker — Phase 13

**The failure this exists for.** Phase 12 measured two demo runs at ~95 s, of which one
`ai.agent` step was **91.9 s**. The model accepted the request and never answered. The
Chapter 1 adapter allowed two attempts per model at a 45 s request timeout with no
overall deadline, so one wedged model cost 90 s before a fallback was tried. `ai.llm`
answered on that same model in 1.4 s in the same run.

**The measurement that explains it.** `scripts/probe-models.mjs` probes every catalogued
model on **both** paths — a plain call and a tool-calling call — because they fail
independently. Three passes on 2026-09-26:

| model | text | tool-call | healthy |
|---|---|---|---|
| `gemini-3-flash-preview` | 1.6 / 1.8 / 1.9 s | 1.1 / 1.4 / 1.1 s | **3 of 3** |
| `gemini-3.6-flash` | 2.3 / 6.2 s / 503 | 1.7 / 1.9 / 2.0 s | 2 of 3 |
| `gemini-3.5-flash-lite` | 4.2 s / **timeout** | 0.9 s / **timeout** | 1 of 3 |
| `gemini-3.1-flash-lite` | 10.2 / 5.1 / 9.3 s | **timeout** / **timeout** / 7.1 s | 1 of 3 |

A model's health flips on a timescale of **minutes**. That single fact shapes the design:
health is observed from real traffic, never configured, and the chain is reordered live.

**Three mechanisms, in `src/lib/ai/gemini.ts` and `src/lib/ai/health.ts`:**

1. **A timed-out attempt is never retried on the same model.** A model that accepted the
   request and went quiet has said what it is going to do. Retrying in place is what
   turned one bad model into 90 s. Retry in place is reserved for failures that return
   *fast* — a 503 usually comes back in under a second and a retry often succeeds.
2. **Every attempt is capped (12 s) and so is the whole chain (30 s).** `GenerateRequest.timeoutMs`
   raises the per-attempt budget for a large prompt; the total stretches to keep room for
   a fallback, because capping both at one number would spend everything on one model.
3. **A circuit breaker per model.** Two consecutive retryable failures open it; a 404 opens
   it at once, because "no longer available to new users" is permanent and three names in
   the Chapter 1 chain went that way mid-project. 400/401/403 never count — a rejected key
   is a fact about the caller, and marking every model unhealthy for it would be backwards.

**The breaker reorders; it never removes.** An open model goes to the *back* of the chain,
so the worst case of a wrong health reading is a suboptimal order, never a refusal to call
a model that would have worked. This matters because health is keyed on the model name
alone and is shared across users on one instance. State is per process, deliberately: it
costs no storage and nothing against Neon's 100 CU-hours, and a cold instance starts
optimistic and learns within one request.

**Health is surfaced, not buried.** `GET /api/settings/provider` returns what the instance
has actually observed. Before Phase 13 the only trace of the incident was one warning line
in a step log.

**Measured after, on the deployed system:** a 6-node run including the agent node takes
**4.2–7.5 s** across five consecutive walks, against **94.5 s** before.

---

## Key architectural decisions

| # | Decision | Status | Rationale |
|---|---|---|---|
| A1 | Cloud Run + Neon, not Railway or AWS | **BINDING** | Only genuinely free option through judging; reuses the required Google project; fastest deploy loop |
| A2 | Single container, UI + API together | **BINDING** | Cloud Run's unit is one container. Two services would double cost and setup for no demo value |
| A3 | Node registry in Phase 3, not Phase 8 | **BINDING** | The agent's tool surface *is* the registry; the original order inverted the dependency |
| A4 | ~~No queue; in-process executor~~ → **Cloud Tasks for durable runs, in-process for synchronous ones** | **SUPERSEDED at Phase 17.** The in-process path is retained, not replaced | The original rationale — "fewer moving parts, and the MVP's runs are short and user-initiated" — was right for a hackathon and wrong for a product: a scheduled run at 03:00 has nobody to press Run again. Cloud Tasks adds **no service and no dependency** (one authenticated `fetch`, free tier 1,000,000 ops/month), which is why this was affordable inside the zero-cost ceiling where Redis and a worker were not. See *Queue — Cloud Tasks for durability* |
| A5 | Cloud Scheduler for cron | **BINDING** | Scale-to-zero makes in-process timers non-functional |
| A6 | SSE, not WebSocket | Binding at Phase 5 | No affinity config, native reconnect, one-directional suffices |
| A7 | Gemini only, behind a provider-agnostic adapter | **BINDING** for MVP | Only available key. Second provider is `PRD.md` S1 |
| A8 | ~~AES-256-GCM under one `ENCRYPTION_KEY`~~ → **envelope encryption: per-credential data keys under a versioned root key in Secret Manager** | **SUPERSEDED at Phase 21.** AES-256-GCM is unchanged; what changed is which key the data is under | The original met "encrypted at rest" without KMS setup and shipped with the accurate warning that rotating the key destroyed every credential. A key that cannot be rotated is not a control. One layer of indirection makes a root key rotation re-wrap ~60 bytes per row instead of re-encrypting the database, and makes it resumable — see *Secrets at rest* |
| A9 | Discord instead of Slack | **BINDING** | Webhooks need no app review; Slack cannot be authorised for this build |
| A10 | Foundation: harvest, single Next.js app | **BINDING** | Decided in Phase 0 Part A, 2026-09-25, against verified licences and repo sizes |
| A11 | ORM: Drizzle, not Prisma | **BINDING** | No generate step or query engine in the container; first-class Neon serverless support; `@auth/drizzle-adapter` is maintained by Auth.js |
| A12 | Auth.js v5 pinned at `next-auth@5.0.0-beta.32` | **BINDING** | The stable v4 tag does not peer-support Next 16. Pin the exact version, not the `beta` tag |
| A13 | Region pair: Cloud Run `asia-southeast1` + Neon Singapore | **BINDING** | Co-locating app and database beats Tier 1 pricing; see *Hosting platform* |
| A14 | Provider adapter owns a **time budget and a circuit breaker** | **BINDING** from Phase 13 | One wedged model cost a run 91.9 s. The budget belongs in the adapter, not in the agent node, so every caller benefits — see *The provider time budget* |
| A15 | **oxlint**, not ESLint | Binding at Phase 13 | 2 packages against 305, for the same reason this project has no `ai` SDK and no test framework. Next 16 removed `next lint` and its own docs say to use a linter directly |
| A16 | **`src/components/ui/` exists, reversing Chapter 1's "no component library"** | Binding at Phase 14 | The old rule held while controls carried no behaviour. A dialog that traps focus, a tablist with a roving tabindex, a menu that answers arrow keys and a toast region that exists before its first message do not fit in a CSS class. Still **zero new dependencies** — no Radix, no `tailwind-merge`, no headless kit — because the native elements carry most of it |
| A17 | **The palette is mirrored in TypeScript, and CI asserts the mirror** | Binding at Phase 14 | The `/design` gallery needs token values plus a role per token, and a `readFileSync` of `globals.css` in a page is a build-versus-runtime trap that only shows up in the container. `src/lib/design/palette.ts` is the mirror; `tokens.test.ts` asserts it against the stylesheet in both directions, so it cannot become a second source of truth |
| A18 | **Secret Manager, not Cloud KMS, for the root key** | **BINDING** while the zero-cost ceiling holds | KMS is the textbook answer and is ~$0.06 per key per month plus operations. Secret Manager's free tier covers one versioned root key (6 versions, 10,000 accesses/month). The cost is that the root key's bytes reach this process rather than staying in an HSM, which `SECURITY.md` → *What we do not claim* states outright. Revisit if a budget ever exists |
| A19 | **A rotation validates against the provider before it writes** | Binding at Phase 21 | The old secret is not kept, so a route that stored first would have the failure mode *your workspace is broken and there is no way back*. The deployed suite asserts the stored envelope is byte-identical after a refused rotation |

---

## What is intentionally simplified, and what it costs

| Simplified | Cost | Recovery path |
|---|---|---|
| ~~No queue or worker~~ | **DONE in Phase 17** — Cloud Tasks, no second service and no dependency | — |
| ~~No partial run resume~~ | **DONE in Phase 17.** The recovery path this table predicted is what was built: "step records already hold enough state to resume later" turned out to be exactly true, and the cursor stores only the frontier because the outputs were already there | — |
| A node with several incoming edges has no join semantics | A diamond's merge point runs once per arriving branch | Still open. The cursor makes it expressible — a queue entry could carry several `fromSeq` — but nothing asks for it yet |
| Single LLM provider wired | "Provider-agnostic" is architectural, not shown | Adapter exists; add a key and a config entry |
| No credential KMS | Encryption key lives in the environment | Move to Secret Manager / KMS post-hackathon |
| No workflow versioning | Editing a workflow changes what past runs referenced | Run steps snapshot their own config |
| No parallel node execution | Wide DAGs run slower than necessary | Engine is a loop; parallelising is local |
| No RBAC or sharing | Single-owner workflows only | Ownership is already enforced per row |
| Four integrations | Not comparable to n8n's catalogue | Registry makes each new one additive |
| Bounded loops only | No unbounded iteration | Deliberate; also a safety property |
