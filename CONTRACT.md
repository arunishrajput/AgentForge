# CONTRACT.md — AgentForge stable interfaces

Only interfaces that must stay consistent **across phases** live here. Once a section is filled, it
is stable: changing it means updating every consumer in the same session, and saying so in
`PROGRESS.md`.

**This file is deliberately mostly empty.** Contracts get defined by the phase that first needs
them, against real code — not invented in advance. Each section below names the phase that fills it.
Do not pre-empt them.

| Section | Status | Filled by |
|---|---|---|
| Environment variables | **DEFINED** | Phase 0 — verified against the chosen stack 2026-09-25; enforced in code since Phase 1 (`src/lib/env.ts`) |
| Workflow / node / edge JSON | **DEFINED** | Phase 3 — `src/lib/workflow/graph.ts` |
| Node definition interface | **DEFINED** | Phase 3 — `src/lib/nodes/types.ts` |
| Run and step records | **DEFINED** | Phase 3 — `src/lib/engine/types.ts`, `src/db/schema.ts` |
| Execution state machine | **DEFINED** | Phase 3 — `src/lib/engine/types.ts` |
| API request/response shapes | **DEFINED** for Phases 3's routes | Phase 3, extended by 4–9 |
| SSE event messages | `NOT YET DECIDED` | Phase 5 |
| Agent tool-call schema | `NOT YET DECIDED` | Phase 6 |
| Credential storage shape | Table **DEFINED**, API `NOT YET DECIDED` | Table Phase 3, API Phase 6 |
| Generation request/response | `NOT YET DECIDED` | Phase 7 |
| Trigger shapes | `NOT YET DECIDED` | Phase 8 |

---

## Environment variables — **DEFINED**

The authoritative list. `.env.example` mirrors this and must be updated alongside it. Real values
live in `.env` locally (never committed) and on the Cloud Run service in production.

### Runtime — required

| Variable | Purpose | Notes |
|---|---|---|
| `DATABASE_URL` | Neon Postgres connection, **pooled** endpoint | Application queries. Cloud Run multiplies connections; the pooled endpoint is not optional |
| `DATABASE_URL_UNPOOLED` | Neon Postgres, **direct** endpoint | Migrations only — read by `drizzle.config.ts`, **not by the running server**. Phase 1 moved it out of the startup check deliberately: requiring it on Cloud Run would make the app refuse to boot over a variable it never opens. Pooling breaks the session-level operations migrations need |
| `AUTH_SECRET` | Session/JWT signing secret | 32+ random bytes. Different per environment |
| `AUTH_URL` | Canonical app origin for OAuth callbacks | Must match the deployed origin **exactly**, or the Google callback fails in a way that looks like a bad client id. In production this is `https://agentforge-733000675212.asia-southeast1.run.app` — the **deterministic** Cloud Run URL. The service also answers on a legacy hashed URL and `status.url` returns *that* one; using it here breaks sign-in (Phase 2, D10) |
| `GOOGLE_CLIENT_ID` | Google OAuth client id | From the Phase 0 OAuth client. Auth.js v5 *auto-infers* `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`, not these names — pass these explicitly into the Google provider config. Verified Phase 0 |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | Secret |
| `ENCRYPTION_KEY` | AES-256-GCM key for credentials at rest | 32 bytes, base64. **Rotating this makes every stored credential unreadable** |
| `APP_BASE_URL` | Public base URL | Used to build webhook URLs shown to the user. Same value as `AUTH_URL`, no trailing slash |
| `CRON_SECRET` | Shared secret for `POST /api/cron/tick` | Cloud Scheduler sends it; the route rejects anything else |
| `NODE_ENV` | `development` \| `production` | — |

### Runtime — optional

| Variable | Purpose | Notes |
|---|---|---|
| `DISCORD_WEBHOOK_URL` | Demo Discord webhook for `#agentforge-demo` | Added Phase 0 (M6). Dev/demo convenience only — the product path is a user-supplied webhook stored encrypted. **Anyone holding it can post to the channel; treat as a secret** |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Server-side Gemini key | Development and demo fallback only. **Users normally supply their own key in-app**; this is not a substitute for that feature. This is the exact name `@ai-sdk/google` reads by default — verified Phase 0 |

### Deploy-time only — not read by the app

| Variable | Purpose |
|---|---|
| `GCP_PROJECT_ID` | Target Google Cloud project |
| `GCP_REGION` | Cloud Run region. One region for everything |
| `CLOUD_RUN_SERVICE` | Service name (`agentforge`) |

### Rules

- Every secret above is a secret. Never log it, never return it to a client, never commit it
- Adding a variable means updating **this table and `.env.example` in the same commit**
- A missing required variable should fail fast and loudly at startup, not at first use

---

## Workflow / node / edge JSON — **DEFINED**

Source of truth: `src/lib/workflow/graph.ts`. The whole graph is one `jsonb` column on the
`workflow` row.

**Why one column and not node/edge tables.** `drizzle-orm/neon-http` has no transactions (D6), so a
graph spread over three tables could not be saved atomically; a single-row update is atomic for
free. The canvas saves the whole graph at once anyway, and no query wants "all edges across all
workflows".

```jsonc
{
  "version": 1,                       // GRAPH_VERSION. A reader must reject what it does not know
  "nodes": [
    {
      "id": "shape",                  // unique within the workflow; runs, events and the canvas all key on it
      "type": "core.set",             // must name a registry entry
      "label": "Build the payload",   // optional display override
      "position": { "x": 240, "y": 0 },
      "config": { "fields": { "subject": "{{input.topic}}" } }
    }
  ],
  "edges": [
    {
      "id": "e2",
      "source": "shape",
      "target": "check",
      "sourceHandle": null            // which OUTPUT it leaves from; null = the default output
    }
  ]
}
```

- **Positions are contract.** A workflow that reloads with a scrambled layout is a broken
  round-trip, not a cosmetic bug
- **`sourceHandle` is how conditional routing is expressed** — `"true"`/`"false"` on a branch,
  `"loop"`/`"done"` on a loop. It must name one of the source node's declared outputs
- **`config` is opaque here.** Each node definition owns its own config schema and parses it at
  execution time
- Limits: 100 nodes, 200 edges per workflow
- **Postgres `jsonb` normalises object key order.** A graph read back is deeply equal to what was
  written but not byte-identical. Nothing may depend on key order

### Template references in config

`{{ path }}` is a **lookup, not an expression language** — no eval, no operators, no function
calls. `src/lib/workflow/template.ts`. A config field that is *only* a reference keeps the
referenced value's type; anything else interpolates as a string. An unresolvable reference becomes
empty rather than throwing.

Scope available to every node: `input`, `trigger`, `steps.<nodeId>.output`, `run.id`,
`run.workflowId`, `node.id`, `node.iteration`.

## Graph validation — **DEFINED**

`validateGraph` in `src/lib/engine/validate.ts`, applied by the engine before a run and reported
(without blocking the save) on every workflow read. A half-built canvas must be saveable, so an
invalid graph is stored and returned with `runnable: false` and its problems.

Problem codes: `no_trigger`, `multiple_triggers`, `unknown_node_type`, `duplicate_node_id`,
`dangling_edge`, `edge_into_trigger`, `unknown_output_handle`, `illegal_cycle`, `invalid_config`.

Rules: exactly one trigger node; nothing may edge into a trigger; every edge endpoint must exist;
every `sourceHandle` must be a declared output of its source; **a cycle is legal only when it
closes through a loop node**.

## Node definition interface — **DEFINED**

Source of truth: `src/lib/nodes/types.ts`. Registry: `src/lib/nodes/index.ts`.

```ts
interface NodeDefinition<Config> {
  type: string;            // stable, namespaced. Persisted in every graph — renaming breaks saved workflows
  label: string;
  description: string;     // READ VERBATIM BY THE AGENT. Contract, not decoration
  kind: "trigger" | "action" | "branch" | "loop";
  category: "trigger" | "logic" | "transform" | "integration" | "agent";
  outputs: { key: string | null; label: string }[];   // `key` is the edge's sourceHandle
  configSchema: z.ZodType<Config>;
  agentCallable?: boolean; // DEFAULTS TO FALSE — widening the agent's reach is always deliberate
  execute(invocation: { config: Config; input: unknown; context: NodeContext }): Promise<NodeOutcome>;
}

interface NodeContext {
  runId, workflowId, ownerId, nodeId: string;
  iteration: number;                    // completed executions of THIS node in THIS run; 0 on the first
  log(message: string, level?: "info" | "warn" | "error"): void;
  signal: AbortSignal;                  // aborted on cancellation or deadline
}

interface NodeOutcome { output: unknown; branch?: string | null }  // `branch` must be a declared output key
```

**Error contract.** Throw `NodeError` to fail the step with a message the user should read.
Anything else thrown is still recorded, but its message is not written for a user.

**Three consumers, one table** (`ARCHITECTURE.md` → *The node registry is the spine*):

| Consumer | Reads |
|---|---|
| Engine dispatch | `getNode(type)` → `kind`, `configSchema`, `execute` |
| Canvas palette | `describeNodes()` → everything but `execute`; `configSchema` as JSON Schema |
| Agent tool set | `listAgentTools()` → entries with `agentCallable === true` |

`describeNode` is the only shape that crosses to the client. It never includes `execute`.

**Registered at Phase 3:** `core.manual_trigger`, `core.set`, `core.log`, `core.branch`,
`core.loop`, `core.assert`. Phases 8–9 add entries to this table; they do not build a second
registry.

**Security boundary.** The agent reaches registry entries and nothing else. No shell node, no
filesystem node, no arbitrary-network escape hatch.

## Run and step records — **DEFINED**

Tables in `src/db/schema.ts`; wire shapes from `describeRun` in `src/lib/engine/run.ts`.

### `run`

| Field | Notes |
|---|---|
| `id` | uuid |
| `workflowId`, `ownerId` | `ownerId` is denormalised from the workflow so every run query is owner-scoped without a join |
| `status` | the run state machine below |
| `trigger` | `manual` \| `webhook` \| `schedule` \| `agent` |
| `input`, `output`, `error` | trigger payload, last node's output, failure message |
| `startedAt`, `finishedAt` | `finishedAt` is null until terminal |
| `heartbeatAt` | bumped after every step. **This is what makes an interrupted run observable** |

### `run_step`

| Field | Notes |
|---|---|
| `runId`, `seq` | `seq` is execution order, 0-based, **unique per run**. A looped node appears once per pass |
| `nodeId`, `nodeType` | as they were in the graph at run time |
| `iteration` | which pass of its node this is; 0 outside a loop body |
| `status` | the step state machine below |
| `config` | **the resolved config this step actually ran with** |
| `input`, `output` | what arrived, what it produced |
| `branch` | the output handle the run left through; null for a single-output node |
| `logs` | `{ at, level, message }[]` — what `context.log` wrote. Phase 5 streams these |
| `error` | failure message, user-readable when the node threw `NodeError` |
| `startedAt`, `finishedAt` | both null on a `skipped` step, which never ran |

**The config snapshot is load-bearing.** There is no workflow versioning, so without it run history
becomes misleading the first time the workflow is edited. It stores the config *after* template
resolution, which is what the node actually saw.

**Every node that never ran gets a `skipped` step.** The untaken side of a branch is visible in run
history rather than an unexplained gap.

## Execution state machine — **DEFINED**

`src/lib/engine/types.ts`.

```
run:   queued ──▶ running ──▶ succeeded          all three terminal
                         ├──▶ failed
                         └──▶ cancelled

step:  running ──▶ succeeded                     both terminal
               └──▶ failed
       skipped                                   entered directly, terminal
```

- A run is created directly in `running` by `startRun`; `queued` exists for a future queue and is
  not currently written
- **A run may never be observable as permanently `running`.** Execution is in-process, so a Cloud
  Run redeploy kills a run mid-flight and nothing would move it on. `reapStaleRuns` fails any
  `running` run whose `heartbeatAt` is older than `STALE_RUN_MS` (5 minutes). It is called before
  listing runs and before starting one — not on a timer, because Cloud Run scales to zero and a
  timer would never fire
- A node failure fails the run and stops execution. There is no partial resume and no retry

### Bounds — safety properties, not tuning knobs

| Bound | Value | Meaning |
|---|---|---|
| `MAX_NODE_EXECUTIONS` | 30 | One node may not run more times than this in a run |
| `MAX_STEPS` | 200 | Total steps in a run |
| `DEFAULT_DEADLINE_MS` | 120 000 | Wall clock, well under Cloud Run's request timeout |
| `HARD_MAX_ITERATIONS` | 25 | A loop node's `maxIterations` cannot be configured above this |

The loop cap and the per-node execution cap are **independent**: a malformed graph that defeats one
still hits the other. No workflow — including one an agent generates — can request an unbounded
loop.

## API request/response shapes — **DEFINED** for Phase 3's routes

`src/lib/api.ts` owns the envelope; later phases extend the surface, not the envelope.

**Every response is one of two shapes:**

```jsonc
{ "data": ... }                                              // success
{ "error": { "code": "...", "message": "...", "details": ... } }   // failure
```

| `code` | HTTP | When |
|---|---|---|
| `unauthenticated` | 401 | No session |
| `invalid_request` | 400 | Body failed its schema; `details` lists path + message |
| `not_found` | 404 | No such record **for this owner** — indistinguishable from someone else's record, deliberately |
| `invalid_graph` | 422 | The graph cannot run; `details` is the problem list |
| `conflict` | 409 | Reserved |
| `internal` | 500 | Unexpected. The detail goes to the server log, never to the client |

### Routes

| Route | Body | Returns |
|---|---|---|
| `GET /api/nodes` | — | The registry, palette projection |
| `GET /api/workflows` | — | Workflow list, newest-updated first |
| `POST /api/workflows` | `{ name, description?, graph? }` | 201, the workflow |
| `GET /api/workflows/:id` | — | The workflow |
| `PATCH /api/workflows/:id` | `{ name?, description?, graph? }` | The workflow |
| `DELETE /api/workflows/:id` | — | `{ deleted: id }` |
| `POST /api/workflows/:id/runs` | `{ input? }` | 201, **the finished run with every step** |
| `GET /api/workflows/:id/runs` | — | Run list for that workflow |
| `GET /api/runs?workflowId=` | — | Run list |
| `GET /api/runs/:id` | — | The run with its steps |

A workflow is returned as `{ id, name, description, graph, runnable, problems, createdAt,
updatedAt }`. `runnable` and `problems` come from `validateGraph`, so a client can show what is
wrong without the save having failed.

**`POST /runs` is synchronous.** Execution is in-process, so the request stays open until the run
finishes. Phase 5 adds the SSE stream for watching a run live; this stays the way a run is started.

**Owner scoping is server-side on every route.** Every query filters on the session's user id;
there is no code path that reads a workflow or run by id alone. Another user's record answers 404,
not 403.

## SSE event messages — `NOT YET DECIDED`

Filled by **Phase 5**. Must cover: event names, per-event payloads, node status transitions, log
lines, run completion, and how a client that connects mid-run or reconnects recovers correct state.

## Agent tool-call schema — `NOT YET DECIDED`

Filled by **Phase 6**. Must cover: how a registry node is projected into a tool definition, the
call and result shapes, how a tool error is returned to the model, and the iteration cap.
Constraints already fixed: tools come only from the registry, and there is no shell, filesystem, or
arbitrary-network tool.

## Credential storage shape — table **DEFINED**, API `NOT YET DECIDED`

The `credential` table landed in **Phase 3** because Phase 3 owns the schema. The encryption
helpers and the write-only API are **Phase 6**.

Columns: `id`, `ownerId`, `kind`, `label`, `ciphertext`, `iv`, `authTag`, `metadata`, `createdAt`,
`updatedAt`. Unique on `(ownerId, kind, label)`. The AES-256-GCM envelope is stored as three base64
columns; the key is `ENCRYPTION_KEY`.

Fixed now, and unchanged by Phase 6: nothing in this row is ever returned to a client in plaintext.
`label` and `metadata` exist so the UI can show that a credential exists without reading it. The
API is **write-only**.

## Generation request/response — `NOT YET DECIDED`

Filled by **Phase 7**. Must cover: the request, the validated workflow returned, and the error shape
for output that fails validation. Fixed now: invalid model output is rejected and reported, never
persisted.

## Trigger shapes — `NOT YET DECIDED`

Filled by **Phase 8**. Must cover: the webhook receiver's URL form and token, how a request body
becomes trigger output, the schedule trigger's cron field, and the `/api/cron/tick` contract. Fixed
now: webhook tokens are cryptographically random, and the tick route rejects any request without
`CRON_SECRET`.
