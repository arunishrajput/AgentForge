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
| SSE event messages | **DEFINED** | Phase 5 — `src/lib/engine/stream.ts` |
| Agent tool-call schema | **DEFINED** | Phase 6 — `src/lib/ai/` |
| Credential storage shape | **DEFINED** | Table Phase 3, API Phase 6 |
| Generation request/response | **DEFINED** | Phase 7 |
| Trigger shapes | **DEFINED** | Phase 8 — `src/lib/triggers/` |

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

### How the canvas maps onto this shape — **DEFINED** (Phase 4)

`src/lib/canvas/bridge.ts`. The stored graph is the source of truth; React Flow's state is a
projection of it, and `fromFlow(toFlow(graph))` must be deeply equal to `graph`.

- Every canvas node carries the React Flow type `"workflow"`. The **registry** type lives in
  `data.nodeType` — React Flow's `type` and a node's `type` are different things
- A node's `data` holds **persisted fields only** (`nodeType`, `label`, `config`). Run status and
  the registry reach the node component through React context, so nothing React Flow attaches to a
  node (`selected`, `measured`, `dragging`) can leak into a saved graph
- **A React Flow handle id of `undefined` is this schema's `null`.** The default output must be
  rendered with no `id`, and `fromFlow` normalises `undefined` back to `null`
- An absent `label` stays **absent**, never written as `undefined`
- Node ids are readable and derived from the type (`set`, `set_2`), not uuids: they are persisted
  in every run step, and Phase 7 asks a model to produce them

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
  outputShape?: string;    // one line on the shape of `output`. READ BY THE GENERATOR
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

`describeNode` is the only shape that crosses to the client. It never includes `execute`, and it
**must be plain JSON**. Phase 4 renders the canvas from a server component and passes the registry
straight to it, and React refuses to serialise anything but a plain object across that boundary.
`describeNode` therefore forces `configSchema` through `JSON.parse(JSON.stringify(...))` rather
than trusting whatever `z.toJSONSchema` happens to build. The failure mode is a console error at
render time, not a type error, so this is a property to keep deliberately.

**Registered at Phase 3:** `core.manual_trigger`, `core.set`, `core.log`, `core.branch`,
`core.loop`, `core.assert`. **Phase 5 added `core.delay`** — it waits a bounded number of
milliseconds and passes its input through, which is both a real workflow need and the only node
slow enough to make "status and logs arrive *incrementally*" something that can be asserted rather
than assumed. Phases 8–9 add further entries to this table; they do not build a second registry.

**`outputShape` — added in Phase 7, optional.** One line saying what `output` holds, for whoever has
to write a `{{ }}` reference to it. Optional: a node that passes its input through has nothing to
say. It exists because the generator needed it and nothing else supplied it — a model asked to route
on an LLM node's answer wrote `{{steps.x.output}}`, the whole object, and the branch compared
`"[object Object]"` and took the wrong path. The graph was valid and ran; it just did the wrong
thing. It lives on the definition rather than in the prompt so a node added later documents itself,
exactly as `description` already does for the agent.

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
| `POST /api/workflows/generate` | `{ prompt, name? }` | 201, `{ workflow, generation }` — see *Generation* |
| `GET /api/workflows/:id` | — | The workflow |
| `PATCH /api/workflows/:id` | `{ name?, description?, graph? }` | The workflow |
| `DELETE /api/workflows/:id` | — | `{ deleted: id }` |
| `POST /api/workflows/:id/runs` | `{ input? }` | 201, **the finished run with every step** |
| `GET /api/workflows/:id/runs` | — | Run list for that workflow |
| `GET /api/runs?workflowId=` | — | Run list |
| `GET /api/runs/:id` | — | The run with its steps |
| `GET /api/workflows/:id/stream` | — | **SSE.** The workflow's current run, live. `?runId=` pins one |
| `POST /api/webhook/:token` | any JSON object | 201, the finished run. **No session** — see *Trigger shapes* |
| `POST /api/cron/tick` | — | The tick outcome. **No session**, `CRON_SECRET` required |

Every route above requires a session and is owner-scoped, **except the last two**, which are
machine endpoints and are specified under *Trigger shapes*.

A workflow is returned as `{ id, name, description, graph, runnable, problems, webhookUrl,
scheduleCron, scheduleNextAt, scheduleLastFiredAt, createdAt, updatedAt }`. `runnable` and
`problems` come from `validateGraph`, so a client can show what is wrong without the save having
failed. `webhookUrl` is null unless the **stored** graph holds a webhook trigger, and the three
`schedule*` fields are null unless it holds a schedule trigger (Phase 8).

**`POST /runs` is synchronous.** Execution is in-process, so the request stays open until the run
finishes, and its response is the authoritative final state. Watching a run live is a *separate*
concern — `GET /api/workflows/:id/stream`, below. The client opens that stream before it POSTs,
because a request that does not return until the run is over cannot also tell you a run id to watch.

A client disconnecting does **not** kill a run: verified against Cloud Run by aborting a `POST
/runs` mid-flight and finding the run had still completed. So a mid-run reload recovers a run that
is genuinely still going, rather than one its own reload killed.

**Owner scoping is server-side on every route.** Every query filters on the session's user id;
there is no code path that reads a workflow or run by id alone. Another user's record answers 404,
not 403.

## SSE event messages — **DEFINED**

Shapes and framing live in `src/lib/engine/stream.ts`; the endpoint is
`GET /api/workflows/:id/stream`, owner-scoped like every other route.

### The endpoint is workflow-scoped, not run-scoped

`BUILD_PLAN.md` Phase 5 said "an SSE endpoint per run". It is per *workflow*, with an optional
`?runId=` pin, because a run fired by a webhook is started by somebody else's request and the
browser has no run id to open a stream for — it can only ask what this workflow is doing. That is
`DEMO.md` Beat 6 exactly. Pinning is for when the id is known: a mid-run reload, or a run opened
from history.

### The stream reads the database

It polls the `run` and `run_step` rows every `STREAM_POLL_MS` (300 ms) rather than subscribing to
an in-process emitter. Execution is in-process but the *watcher* is a different request, and under
`max-instances 3` a different container — an emitter would show an empty canvas with no error.
Reading rows also makes "connect mid-run", "reconnect" and "reload the page" one code path.

### Events

| Event | Payload | When |
|---|---|---|
| `snapshot` | the whole run, `steps` included — the same shape `GET /api/runs/:id` returns | The first time this stream sees a run, and whenever the run it is following changes |
| `step` | `{ runId, step }` | A step appeared or changed: started, finished, branched, failed, or grew a log line |
| `run` | `{ runId, status, output, error, finishedAt, durationMs }` — never `steps` | The run's own fields changed |
| `done` | `{ runId, reason }` — `finished` \| `idle` \| `timeout` | The stream is over. **The client closes the `EventSource` on any reason** |
| `stream_error` | `{ message }` | The stream cannot continue. Named `stream_error` because an event named `error` arrives on an `EventSource` indistinguishably from a transport failure |

Comment frames (`: ping`) are keepalives and carry no meaning. `data` is always one line —
`JSON.stringify` escapes every newline, and a raw newline would end the frame early.

### Recovery is by snapshot, never by replay

There are no event ids and no `Last-Event-ID` handling. Every connection begins with a `snapshot`
of whatever the run currently is, so a client connecting mid-run, reconnecting after a dropped
connection, or reloading the page is correct by construction. Steps are always emitted before the
run-level change, so a client holds every final step status before it is told the run is over.

### Which run a stream follows

Not a timestamp comparison. **A run that was already finished the first time a stream looked is
history**: its id becomes a baseline and it is never reported; any other id is. The client opens
the stream and only then triggers the run, so at the first poll the newest run is very often the
previous one — a first attempt compared `startedAt` against the container's clock with a five
second window, and it adopted the wrong run the first time it ran against Cloud Run. The one case
given up is a run that starts *and* finishes inside a single poll interval, and there the client
already has the final state from `POST /runs`.

### It is never idle for long

Cloud Run bills CPU for as long as a stream is open. A stream closes on a terminal run, after
`STREAM_IDLE_MS` (20 s) if no run ever appears, and at `STREAM_MAX_MS` (150 s) regardless — above
the engine's 120 s deadline so a legitimate run is never cut off by its watcher.

### Headers

`content-type: text/event-stream`, `cache-control: no-cache, no-store, no-transform`,
`x-accel-buffering: no`. `no-transform` is the one that matters: Next's production server runs the
standard `compression` middleware — an HTML response from this build genuinely comes back gzipped —
and that middleware buffers to 1 KiB and counts `text/event-stream` as compressible, which would
present exactly as a broken stream.

### `stepLogged`

`RunRecorder` gained an optional `stepLogged`, so a log line is persisted when it is written rather
than when its node finishes. It is not awaited, because `context.log` is synchronous by design; all
of a run's writes are therefore serialised on one chain in `dbRecorder`, or a late log write could
land after the finished step and silently drop a line. Without this a log only becomes visible when
its node ends — which for an agent node is precisely when it stops being interesting.

## Agent tool-call schema — **DEFINED**

Shapes live in `src/lib/ai/types.ts`; the projection in `src/lib/ai/tools.ts`, the loop in
`src/lib/ai/loop.ts`, the Gemini wire format in `src/lib/ai/gemini.ts`.

### The provider interface

```ts
interface LanguageModel {
  provider: string;
  defaultModel: string;
  generate(request: GenerateRequest): Promise<GenerateResult>;
  listModels(): Promise<ModelInfo[]>;   // live — never a hardcoded catalogue
}
```

Gemini is the only implementation wired. A second provider is a new file implementing this
interface; nothing above it changes.

### A model turn is carried back verbatim — the one rule that shapes the rest

```ts
type ChatTurn =
  | { role: "user";  text: string }
  | { role: "model"; text: string; toolCalls: ToolCall[]; raw: unknown }
  | { role: "tool";  results: ToolResult[] };
```

`raw` is the provider's own content payload, opaque to everything but the provider that produced
it. Gemini 3 signs every `functionCall` part with a `thoughtSignature` and **rejects a
conversation that has lost one with HTTP 400** — measured against the live API on 2026-09-26:

> Function call is missing a thought_signature in functionCall parts. This is required for tools
> to work correctly

So a provider replays `raw` and never rebuilds a model turn from `text` + `toolCalls`. An adapter
that normalised the turn into a tidy internal shape works for one tool call and fails on the
second — which is every agent node that does more than one thing. The reconstruction path survives
only for a turn that never came from that provider (a test fake, another provider's history).

### Registry node → tool definition

| Tool field | Comes from |
|---|---|
| `name` | the registry `type` with dots replaced: `core.log` → `core_log`, reversible |
| `description` | the node's `description`, **verbatim** — it is written for a model |
| `parameters` | the node's `configSchema` as JSON Schema, narrowed to the provider's dialect |

**The tool set is exactly `agentCallable: true` (D19).** There is no second list. `allow` on an
agent node can only narrow it: a type listed there that is not callable is reported in `rejected`
and never granted. The agent reaches these entries and nothing else — no shell, no filesystem, no
arbitrary network.

**Gemini's `parameters` is not JSON Schema.** It is a narrow OpenAPI 3.0 subset where an unknown
key is a hard 400, and `z.toJSONSchema()` emits `$schema`, `additionalProperties` and
`propertyNames` for real registry nodes. `src/lib/ai/schema.ts` is therefore an **allow-list**: a
key the provider does not document is dropped, so a new node with an exotic config degrades to a
vaguer tool signature instead of breaking the agent. A `default` moves into the description; a
typeless field (`z.unknown()` → `{}`) becomes a string; a tool with no fields declares no
`parameters` key at all.

### Call, result, and a tool error

```ts
interface ToolCall   { id: string; name: string; args: Record<string, unknown> }
interface ToolResult { id: string; name: string; result: unknown }
```

A provider may emit **several calls in one turn** — Gemini does — so the loop executes the whole
batch and returns every response in a single `tool` turn.

Arguments are validated against the named node's own `configSchema` before it runs. A rejection, an
invented tool name, or a throw from the node itself all come back to the model as
`{ error: "..." }` rather than failing the step, so it can correct a bad argument. Runaway
correcting is bounded by the cap.

### The iteration cap

`maxIterations` counts **model calls**, defaults to 5, and is clamped to
`HARD_MAX_AGENT_ITERATIONS` = 8 — a safety property in the spirit of D16, not a tuning knob. A
loop that reaches the cap while still calling tools returns `stopped: "cap"` and the node **fails
its step**: an agent that will not converge must not return half an answer a downstream node would
treat as a real one. A live model told to call a tool for ever did exactly that on all six turns it
was given, so this bound is load-bearing.

### Routing

An agent node has one static output. Its decision comes out in `output.decision`, constrained to a
configured `choices` list, and a `core.branch` node routes on `{{input.decision}}`. Per-instance
output handles would break D21/D23 — the canvas draws a node's edges from its registry entry, so
handles cannot depend on a run. A decision that cannot be read leaves `decision: null` and the run
takes the default path rather than failing.

## Credential storage shape — **DEFINED**

The `credential` table landed in **Phase 3** because Phase 3 owns the schema. The encryption
helpers (`src/lib/crypto.ts`), the store (`src/lib/credentials.ts`) and the write-only API are
**Phase 6**.

Columns: `id`, `ownerId`, `kind`, `label`, `ciphertext`, `iv`, `authTag`, `metadata`, `createdAt`,
`updatedAt`. Unique on `(ownerId, kind, label)`. The AES-256-GCM envelope is stored as three base64
columns; the key is `ENCRYPTION_KEY`. GCM rather than CBC because it authenticates: a row edited in
the database fails to decrypt instead of yielding plausible rubbish that then gets sent to a
provider as an API key. A fresh IV per encryption, generated inside `encryptSecret` rather than
passed in.

**Nothing in this row ever reaches a client.** Not the value, not a prefix, not a masked tail — a
four-character hint is still key material. `configured: true` plus `updatedAt` is the whole answer
to "is a key stored". `describeCredential` never reads the envelope columns into its result, so a
future spread cannot leak them.

At MVP there is one kind: `llm.google`, label `default`, `metadata: { model }`.

### Routes

| Route | Body | Returns |
|---|---|---|
| `GET /api/settings/provider` | — | `{ provider, configured, model, defaultModel, source, updatedAt }` |
| `PUT /api/settings/provider` | `{ apiKey?, model? }` | the same shape |
| `DELETE /api/settings/provider` | — | the same shape, `configured: false` |
| `GET /api/settings/provider/models` | — | `{ models, source }`, live from the provider |

`source` is `user` \| `environment` \| `none` — whether a run would use the user's own key or the
server's development fallback. Surfaced deliberately: a demo silently running on
`GOOGLE_GENERATIVE_AI_API_KEY` would make the whole feature look tested when nobody's key had ever
been exercised.

**Both fields are proved against the provider before they are stored, and proved differently:**

- a **key** with one `models.list` call;
- a **model** with one real, tiny `generateContent` call, on that model alone
  (`fallbacks: []`, or a working model would answer for a broken choice).

The second is not redundant. `models.list` on a working key returns `gemini-2.5-flash`, and calling
it answers **404 "no longer available to new users"** — so the catalogue lists models a key cannot
run, and validating a choice against the list would happily store one. Found by running it: an
unvalidated model name was stored and every later run failed with a 404 from inside the engine.

## Generation request/response — **DEFINED** (Phase 7)

`POST /api/workflows/generate`. Source of truth: `src/lib/generate/`.

```jsonc
// request
{ "prompt": "summarise support messages and escalate urgent ones",  // 1–4000 chars, trimmed
  "name": "optional title, overriding the model's" }

// 201 response
{ "data": {
    "workflow": { /* the same shape every other workflow route returns */ },
    "generation": {
      "model": "gemini-3.5-flash-lite",       // who actually answered, after any fallback
      "source": "user",                        // whose key: "user" | "environment"
      "unsupported": ["post it to Discord"],   // request parts no registered node can do
      "usage": { "inputTokens": 1916, "outputTokens": 96, "totalTokens": 2012 },
      "attempts": [{ "model": "…", "issues": [], "ms": 1845 }]   // at most 2
    } } }
```

**The order is the contract: generate → validate → persist.** A workflow that cannot run is never
written. Nothing in `src/lib/generate/` touches the database; the route inserts only what the
generator returns as `ok: true`.

**What the model is asked for, and what it is not.** The model emits `name`, `description`, `nodes`,
`edges` and `unsupported`. It is *not* asked for `version`, node `position`, or edge `id` — the
system supplies all three. Positions come from `layout()`, because a model cannot lay out a graph
and an overlapping one reads as broken; edge ids are minted `e1…eN`; `version` is `GRAPH_VERSION`.

**Failure.** `422 invalid_graph`, with `details` of `{ issues, attempts }`. `issues[].code` is a
`GraphProblem` code, or one of two that only generation can produce:

| `code` | Meaning |
|---|---|
| `not_json` | The answer was not JSON at all |
| `bad_shape` | JSON, but not the expected shape. Carries `path` |

A whitespace-only prompt is `400 invalid_request` and never reaches the provider. A provider failure
(bad key, model busy) surfaces the provider's own words rather than being reported as bad output.

**One retry, never a loop.** An invalid answer is sent back to the model with its own turn replayed
verbatim (D33) and the issues listed. A second failure is reported. There is no repair loop.

**`unsupported` is how an impossible request fails cleanly.** Measured: asked to "SSH into my
production server and delete the database", the model emitted a valid, inert `trigger → log` — safe,
because the registry is the entire vocabulary, but silently wrong. The model now names what it could
not build, and the UI shows it instead of navigating to a workflow that quietly does less. It is
equally the honest answer to a request that is merely *early*: Discord and Sheets have no node until
Phase 9.

## Trigger shapes — **DEFINED** (Phase 8)

Source of truth: `src/lib/triggers/`. Three trigger types are registered, and validation still
allows **exactly one per workflow**.

| Type | Starts a run when | Output |
|---|---|---|
| `core.manual_trigger` | a person presses Run, or `POST /api/workflows/:id/runs` | the JSON the run was started with |
| `core.webhook_trigger` | something POSTs to the workflow's webhook URL | the posted JSON body |
| `core.schedule_trigger` | a cron slot comes due and the tick sweeps it | `{ firedAt, cron, scheduledFor }` |

Neither new trigger is `agentCallable` (D19). Starting a run is not a capability to hand a model in
the middle of one.

### The webhook token lives on the workflow row, not in the graph — **D41**

`workflow.webhookToken`: 24 bytes of CSPRNG as base64url — 192 bits in 32 URL-safe characters,
minted by `mintWebhookToken()` for **every** workflow at creation, unique-indexed. "Unguessable"
(`PRD.md` → Triggers) means exactly this: not a sequential id, and not a hash of the workflow id,
because a hash of a known input is one guess away from being the input.

On the row rather than in the node's config, for three reasons that are each sufficient:

- Validation already permits one trigger per workflow, so a per-node token would buy nothing.
- A secret inside the graph would be minted either by the **model** that writes the graph — and
  D40 says the system supplies what a model cannot — or by the browser.
- The receiver needs one indexed lookup, and a column has nothing to keep in sync with the graph.

The token is minted for every workflow so the URL does not change depending on when the trigger node
was added. `describeWorkflow` returns `webhookUrl` **only when the stored graph actually holds a
webhook trigger**, so the UI never prints a URL that would answer 404.

### `POST /api/webhook/:token` — the only route with no session

It cannot have one: the caller is another system. The token is therefore the whole of its access
control, and the owner comes *out* of the row, so a webhook can never run a workflow on anyone
else's behalf. This is the one query in the codebase not scoped by `ownerId`.

Order of checks, and it matters — everything before the run is cheap, because this endpoint can spend
a user's model quota:

1. The token must match `/^[A-Za-z0-9_-]{16,64}$/`, checked **before** the database is touched.
2. The workflow must exist **and** its stored graph must hold a webhook trigger. Both failures answer
   the same `404 "No webhook is registered at this URL."` — whoever holds the token learns nothing
   from the difference.
3. The body must be ≤ 64 KB (`MAX_WEBHOOK_BODY_BYTES`), counted in **bytes**, not characters.
4. An absent or whitespace body is `{}`. A webhook that only says "something happened" is legitimate.
5. It must be a JSON **object** — not an array or a scalar — or `{{trigger.field}}` has nothing to
   read. `400`.
6. Every name in the trigger's `requiredFields` must be a present key. `400` with
   `details.missing`. `null` counts as supplied; a missing key does not (`Object.hasOwn`).

Only then is a run created, with `trigger: "webhook"` and the body as its input. **A rejected call
writes nothing** — no run row, no history, no model spend. The response is the completed run, the
same synchronous shape as `POST /runs`; a browser watching does not need it, because it follows the
workflow rather than a run id it could not have known (D28).

### The cron field is validated where it is written

`core.schedule_trigger.config.cron` is a 5-field expression **evaluated in UTC**
(`src/lib/triggers/cron.ts`). Supported per field: `*`, a number, a list `a,b`, a range `a-b`, and a
step on either (`*/n`, `a-b/n`), plus the `@yearly @monthly @weekly @daily @hourly` aliases. Day 7
is Sunday. When day-of-month and day-of-week are **both** restricted they are OR-ed, which is
standard cron's one genuine oddity.

**Not supported, and rejected with a message naming the problem:** month and weekday names, `?`,
`L`, `W`, `#`, seconds, and a sixth year field.

Validation happens in the node's own `configSchema`, so an unsupported expression is an
`invalid_config` problem on the canvas and a rejected generation. The alternative is this node's
worst failure: an expression that saves cleanly, shows a schedule in the UI, and never fires. The
schema also rejects an expression that parses but can never match — `0 0 30 2 *` is legal to write
and matches no date that will ever exist.

### `workflow.scheduleNextAt` is a derived index, and how it is advanced — **D42**

The graph stays the source of truth (D14). `scheduleNextAt` is re-derived from it on **every graph
write**, so adding, editing or removing a schedule trigger cannot leave a stale due time behind.

One rule is load-bearing: **when the expression has not changed, the stored due time is kept, never
recomputed.** A schedule that already fired for 09:00 today holds tomorrow 09:00; recomputing at
08:59 would move it back to today and fire the same slot twice. Keeping it also means a *missed* due
time survives a save and is caught up, rather than an edit silently skipping it.

### `POST /api/cron/tick` — the second route with no session

Guarded by `CRON_SECRET` in the `x-cron-secret` header (`Authorization: Bearer` is also accepted),
compared in **constant time** — this endpoint acts across every owner, so a `===` leaking the
secret's length and prefix is not acceptable. Anything without the secret is `401`, and a signed-in
session is **not** a substitute: it is a machine endpoint. POST only.

Each tick selects at most `MAX_FIRES_PER_TICK` (3) workflows whose `scheduleNextAt` is due, ordered
by due time, then for each one:

1. If the graph no longer holds a schedule trigger, `scheduleNextAt` is set to null and it is
   reported as `cleared` — otherwise it would be selected on every tick for ever.
2. Otherwise it is **claimed** by a compare-and-set:
   `update workflow set scheduleNextAt = <next>, scheduleLastFiredAt = now() where id = ? and
   scheduleNextAt = <the value just observed>`. `neon-http` has no transactions (D6), so this
   conditional `UPDATE ... RETURNING` is the atomic primitive available — and it is enough. A second
   tick reading the same row updates **zero** rows and fires nothing, which is what makes a Scheduler
   retry, an overlapping manual run of the job, or two containers under `max-instances 3` safe.
3. The claim happens **before** the run, never after, so a run that kills the container loses its
   slot instead of re-firing for ever.

Response: `{ checkedAt, due, fired: [{ workflowId, runId, status, scheduledFor }], skipped, cleared }`.
Runs are attributed `trigger: "schedule"` and receive `{ scheduledFor, firedAt, cron }` as input.

The bound of 3 is not tuning: runs are synchronous and in-process, so the tick holds its request open
for the sum of its runs. Three at the engine's 120 s ceiling is 360 s, inside the Scheduler job's
540 s attempt deadline. Anything still due stays due and is taken by the next tick.

**Tick cadence is a cost decision, recorded in `DEPLOYMENT.md`:** every 15 minutes, not every minute.
The effective resolution of a cron expression is therefore the tick interval — a run starts at or
shortly after its slot, never on the second.
