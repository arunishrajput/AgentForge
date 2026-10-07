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
| Credential storage shape | **DEFINED** | Table Phase 3, API Phase 6, **envelope + vault Phase 21** |
| Credential audit log | **DEFINED** | Phase 21 — `src/lib/credentials/audit.ts` |
| Generation request/response | **DEFINED** | Phase 7 |
| Trigger shapes | **DEFINED** | Phase 8 — `src/lib/triggers/` |
| Design token names | **DEFINED** | Phase 14 — `src/app/globals.css`, `src/lib/design/palette.ts`; two themes since Phase 27 |

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
| `ENCRYPTION_KEY` | AES-256-GCM key for credentials at rest | 32 bytes, base64. **Two jobs since Phase 21**: it is the root key when `ROOT_KEY_SECRET` is unset (a developer machine, CI), and it decrypts any credential still in the Chapter 1 single-layer shape whatever `ROOT_KEY_SECRET` says. The Chapter 1 warning no longer holds unconditionally — changing it makes unreadable only the rows it is still the key for, and `scripts/rekey.mjs --dry-run` names them. `SECURITY.md` → *Rotating the root key* |
| `APP_BASE_URL` | Public base URL | Used to build webhook URLs shown to the user. Same value as `AUTH_URL`, no trailing slash |
| `CRON_SECRET` | Shared secret for the **machine endpoints** — `POST /api/cron/tick` and `POST /api/runs/dispatch` | Cloud Scheduler sends it for the tick; Cloud Tasks sends it in the task's headers for a dispatch. **One secret for both, deliberately** (Phase 17): the dispatch route's real authorisation is the run's own 192-bit `dispatchToken`, so this is the outer gate rather than the thing that grants anything. A leaked `CRON_SECRET` lets someone fire due schedules — which was already true — and lets them re-dispatch only runs whose per-run token they also hold |
| `NODE_ENV` | `development` \| `production` | — |

### Runtime — optional

| Variable | Purpose | Notes |
|---|---|---|
| `DISCORD_WEBHOOK_URL` | Demo Discord webhook for `#agentforge-demo` | Added Phase 0 (M6). Dev/demo convenience only — the product path is a user-supplied webhook stored encrypted. **Anyone holding it can post to the channel; treat as a secret** |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Server-side Gemini key | Development and demo fallback only. **Users normally supply their own key in-app**; this is not a substitute for that feature. This is the exact name `@ai-sdk/google` reads by default — verified Phase 0 |
| `TASKS_QUEUE` | Cloud Tasks queue name for durable runs (Phase 17) | **Unset means durable runs execute in-process instead** — correct locally and in CI, and a silent no-op in production, which is why `GET /api/health` reports `queue.configured`. Set to `agentforge-runs` on the service |
| `TASKS_LOCATION` | The queue's region | Falls back to `GCP_REGION`. A queue in another region would be a deliberate act; there is no reason to state the common case twice |
| `TASKS_PROJECT` | The queue's project | Falls back to the metadata server's `project/project-id`, which cannot be wrong in the way a copied variable can. Set it only when the queue lives outside this project |
| `ROOT_KEY_SECRET` | The Secret Manager secret holding the **root key** (Phase 21) | **Unset means `ENCRYPTION_KEY` is the root key**, version `env` — correct locally and in CI, where there is no metadata server. Set, it means *versions*: adding one is a rotation, and `scripts/rekey.mjs` moves the database onto it without decrypting a secret. Set to `agentforge-root-key` on the service. Unset in production is the Chapter 1 problem back without the Chapter 1 warning, which is why `GET /api/health` reports `rootKey.provider` and the vault shows it |

### Deploy-time only — not read by the app

| Variable | Purpose |
|---|---|
| `GCP_PROJECT_ID` | Target Google Cloud project |
| `GCP_REGION` | Cloud Run region. One region for everything |
| `CLOUD_RUN_SERVICE` | Service name (`agentforge`) |

### Script-only — **never set on the service** (Phase 21)

| Variable | Purpose |
|---|---|
| `GCP_ACCESS_TOKEN` | A Google access token for `scripts/rekey.mjs`, which has no metadata server to mint one. Supply it on the command line from `gcloud auth print-access-token`. On Cloud Run the token comes from the metadata server and is short-lived by construction; pasted into a service environment variable it would be a long-lived credential in a place that survives restarts |
| `GCP_PROJECT` | The project that script should reach Secret Manager in. Overrides the metadata server, which does not exist off Cloud Run |

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
      "config": { "fields": { "subject": "{{input.topic}}" } },
      "policy": { "retries": 2, "backoffMs": 500, "timeoutMs": 20000 }  // optional, Phase 17
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
- **`policy` is retry and timeout** (Phase 17, `PRD.md` C4) — a *sibling* of `config`, because it is
  a property of running a node rather than of what the node does. **Optional, and absent stays
  absent**: every graph saved before Phase 17 has no `policy` on any node, and a schema default
  here would make a freshly loaded graph structurally different from the stored one. Bounds are
  enforced by the schema and are safety properties, not preferences — `retries` 0–3, `backoffMs`
  0–10 000, `timeoutMs` 1 000–60 000 — because a *model* writes these graphs too
- Limits: 100 nodes, 200 edges per workflow
- **Postgres `jsonb` normalises object key order.** A graph read back is deeply equal to what was
  written but not byte-identical. Nothing may depend on key order. `graphsEqual` in
  `src/lib/workflow/graph.ts` is the one structural comparison, and **both the canvas's dirty
  check and Phase 18's version debounce call it** — two copies would eventually disagree, and the
  failure would be silent in both directions

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
  docs?: NodeDocs;         // Phase 23A. Long-form help for the INSPECTOR — written for a person
  configSchema: z.ZodType<Config>;
  agentCallable?: boolean; // DEFAULTS TO FALSE — widening the agent's reach is always deliberate
  execute(invocation: { config: Config; input: unknown; context: NodeContext }): Promise<NodeOutcome>;
}

interface NodeContext {
  runId, workflowId, nodeId: string;
  nodeType: string;        // Phase 21. The engine already had it. Added so a node attributing a
                           // credential use in the audit log need not repeat its own `type`
  scope: WorkspaceScope;   // Phase 19A. Replaced `ownerId`. A node's ENTIRE authority:
                           // the credentials of the workspace whose workflow is running,
                           // and nothing else. Nothing in a node's config can widen it
  iteration: number;                    // completed executions of THIS node in THIS run; 0 on the first
  log(message: string, level?: "info" | "warn" | "error"): void;
  signal: AbortSignal;                  // aborted on cancellation or deadline
}

interface NodeOutcome { output: unknown; branch?: string | null }  // `branch` must be a declared output key
```

**`docs` — added in Phase 23A, optional.** Documentation for a *person*, shown in the inspector:

```ts
interface NodeDocs {
  summary: string;                               // what it does, for a human. 2–3 sentences
  accepts?: string;                              // what it reads as input when config supplies none
  examples?: { title: string; body: string }[];  // worked examples
}
```

**Deliberately not `description`.** That field is read verbatim by the model and is tuned for it —
terse, imperative, about *when to call this*. A person opening the panel wants different sentences.
Writing one string for both audiences produced a description that served neither. The inspector
falls back to `description` plus `outputShape` when `docs` is absent, which is what every node had
before Phase 23A. A test asserts `docs.summary !== description` for every node that declares one.

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
than assumed.

**Phase 8 added** `core.webhook_trigger` and `core.schedule_trigger`; **Phase 9 added**
`integration.http`, `integration.discord`, `integration.sheets` and `integration.gmail` — **15
entries in one table.** Neither phase built a second registry and neither touched the palette, the
config forms, the validator or the generation prompt's catalogue: all four read this table. Phase 9's
only prompt change was prose, and it was a correction rather than an addition — see
*Integration nodes and their credentials*.

**Phase 23A took the registry to 25.** One control-flow node, `core.switch`, and nine transform
nodes: `transform.filter`, `.map`, `.sort`, `.unique`, `.aggregate`, `.json`, `.text`, `.number`
and `.date`. None of them reaches a service, holds a credential or can have an effect outside the
run, which is the whole argument for the nine transform nodes being `agentCallable` — `core.switch`
is not, for the same reason `core.branch` is not (D19): a node whose entire output is the *edge* the
run leaves through has nothing to say when called as a tool.

**Two rules the transform nodes establish, and a node added later must follow:**

- **A node that returns a list returns `{ items, count }`, never a bare array**, and a node that
  consumes one reads its config, then a bare array input, then `input.items`. That is what makes
  filter → sort → unique → aggregate chain with nothing between them. A bare array leaves nowhere
  to put the count, and every join would then need a `core.set` to reshape it.
- **No expression language, ever.** Every operator set is a fixed `z.enum`, `transform.text`'s
  replace is a literal `replaceAll` and never a compiled pattern, and the dotted paths in
  `transform.map`/`.filter`/`.sort` read own properties only — `readPath` refuses `__proto__`,
  `constructor` and array methods, asserted in both directions. A config field is exactly where
  arbitrary code execution would re-enter this product (`CLAUDE.md`, security rules).

**A fifth registry obligation, and the count of them now.** A node type needs: an entry in
`PUBLISHABLE` (Phase 20), an entry in `ROTATION_RULES` if it carries a credential kind (Phase 21),
an output field named `model` **only** if it really is a model call (Phase 22 counts them by reading
the step's JSONB), a catalogue entry the generator renders (Phase 7, automatic), and — from Phase
23A — `docs` if it is to explain itself in the inspector. `src/lib/nodes/registry.test.ts` asserts
all of them in one place.

**`outputShape` — added in Phase 7, optional.** One line saying what `output` holds, for whoever has
to write a `{{ }}` reference to it. Optional: a node that passes its input through has nothing to
say. It exists because the generator needed it and nothing else supplied it — a model asked to route
on an LLM node's answer wrote `{{steps.x.output}}`, the whole object, and the branch compared
`"[object Object]"` and took the wrong path. The graph was valid and ran; it just did the wrong
thing. It lives on the definition rather than in the prompt so a node added later documents itself,
exactly as `description` already does for the agent.

**Security boundary.** The agent reaches registry entries and nothing else. No shell node, no
filesystem node. `integration.http` is the one entry that reaches an arbitrary host, and it is
bounded by `src/lib/integrations/guard.ts` rather than by trust — D45 below.

## Run and step records — **DEFINED**

Tables in `src/db/schema.ts`; wire shapes from `describeRun` in `src/lib/engine/run.ts`.

### `run`

| Field | Notes |
|---|---|
| `id` | uuid |
| `workflowId`, `workspaceId`, `ownerId` | **`workspaceId` is the scoping column** (Phase 19A) — every run query filters on it, denormalised from the workflow so it needs no join. `ownerId` is kept and still means *who triggered this run*, which the workspace cannot answer |
| `status` | the run state machine below — `waiting` since Phase 26 |
| `trigger` | `manual` \| `webhook` \| `schedule` \| `agent` |
| `input`, `output`, `error` | trigger payload, last node's output, failure message |
| `startedAt`, `finishedAt` | `finishedAt` is null until terminal |
| `heartbeatAt` | bumped at every checkpoint. **This is what makes an interrupted run observable** |
| `mode` | `sync` \| `durable` (Phase 17). **The only thing that distinguishes "interrupted, lost" from "interrupted, will resume"**, and therefore the only thing that tells the sweeper whether failing a run is correct or a lie |
| `cursor` | the frontier to resume from — `{ queue, executions, seq }`. Node outputs are **not** in it; a queue entry names the `seq` whose output feeds it, so the cursor's size never depends on payload size |
| `attempt` | deliveries that reached a worker. Incremented by the **claim**, not by the enqueue. Above 1 means the run resumed |
| `leaseOwner`, `leaseExpiresAt` | who is executing it and until when. **The correctness columns**: Cloud Tasks is at-least-once, so without them a redelivery would run a workflow twice |
| `cancelRequestedAt` | a stop was asked for. The engine reads it at its next checkpoint |
| `dispatchToken` | 192 bits of CSPRNG. The task carries it and `POST /api/runs/dispatch` demands it, so that route can only ever resume a run that already exists. Never returned to a client |
| `workflowVersion` | which version of the workflow this run executed (Phase 18). An integer, not a foreign key — see *Workflow versions*. Null for a run recorded before versioning, and **that is not claimed to be v1** |
| `wakeAt` | **Phase 26.** When a `waiting` run resumes; null in every other status. The claim compares it against the database's `now()`, so an early delivery claims nothing. Returned by `describeRun` as `wakeAt` |

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

**The config snapshot is load-bearing, and Phase 18 did not make it redundant.** A version says
what the config *template* was; this says what it resolved to on this run. `{{input.subject}}` is
identical in every version and different in every run, and the resolved value is the one worth
reading back. It stores the config *after* template
resolution, which is what the node actually saw.

**Every node that never ran gets a `skipped` step.** The untaken side of a branch is visible in run
history rather than an unexplained gap.

## Workflow versions — **DEFINED** (Phase 18)

Table `workflow_version` in `src/db/schema.ts`; wire shapes from `describeVersion` and
`describeHistory` in `src/lib/workflow/versions.ts`. The diff is `src/lib/workflow/diff.ts`.

**Every save is a version, and history is append-only.** Nothing renumbers a version and nothing
deletes one except the retention cap below.

### `workflow_version`

| Field | Notes |
|---|---|
| `id` | uuid |
| `workflowId`, `workspaceId`, `ownerId` | **`workspaceId` is the scoping column** (Phase 19A). `ownerId` records *who saved this version*, which in a shared workspace is not necessarily who created the workflow |
| `number` | **the version number, unique per workflow.** Supplied by `workflow.version`, not computed here |
| `label` | null for an ordinary save. A restore and a generation set one. **A labelled version is never pruned** |
| `name`, `graph` | the two things a save can change and a restore must put back. **A compact snapshot, not a row copy** — the webhook token, the schedule columns and the timestamps describe the workflow as it is *now*, not as it was |
| `createdAt` | when the save happened |

### `workflow.version` is the counter, and that is what makes the number safe

`neon-http` has no transactions (D6), so `max(number) + 1` read from `workflow_version` and
inserted a moment later is a real race — two saves of the same workflow can both read 4. The
number is instead bumped **inside the same single-row UPDATE that writes the graph**, and
`RETURNING` hands back a number no concurrent save can also have been given. Same atomic primitive
D42 claims a cron slot with.

**A gap in the numbering is legal and is the honest outcome** when a snapshot could not be
written: the workflow row is already correct, and refusing a user's save because its *history*
could not be recorded would be the wrong trade. A number is never reused, so the order things
happened in is never misreported.

### Which saves become versions — the debounce

A save that changes neither the graph nor the name **is not a version**. The canvas PATCHes the
whole graph on every Save and again before every run, so without this, running a workflow five
times would leave five identical snapshots. The comparison is `graphsEqual`, never a string one.

**A description change is deliberately not a version**, and is not restored either — versioning it
would offer a restore that silently did not restore it.

### Retention

`VERSION_LIMIT` is **50 per workflow**, and the cap bounds the *unlabelled* tail only. Measured
2026-09-27: a stored graph averages **737 bytes** and the six-node demo workflow is **1,097**, so
a fully-capped workflow is ~60 KB against Neon's 0.5 GB free tier (`DEPLOYMENT.md` → *Free-tier
headroom*). Naming a version is how a user keeps it for ever.

### A run records the version it executed

`run.workflowVersion` — an **integer, not a foreign key**, for the same reason `ownerId` is
denormalised onto that table: a run survives as a record of what happened, and must stay true even
when the version row is gone. Null for every run recorded before Phase 18; **that is not claimed to
be v1**, it is unknown.

**It is load-bearing on resume.** A durable run redelivered after the workflow was edited executes
**the graph it started on**, read back from the snapshot — otherwise delivery 1 runs three nodes of
v4, an edit lands, and delivery 2 resumes from a cursor naming nodes that no longer exist. A run
with no recorded version, or whose snapshot was pruned, falls back to the live graph, which is
exactly the pre-Phase-18 behaviour.

### The diff

`diffGraphs(base, target)` returns per-node `added` | `removed` | `changed` | `moved` |
`unchanged`, per-edge `added` | `removed` | `unchanged`, and a summary.

- **Nodes are matched by `id`; edges by what they connect.** A node id is the node's identity
  everywhere else in the system and `nextNodeId` mints stable ones. An edge id is **not** stable —
  `nextEdgeId` returns the lowest free `eN`, so deleting `e1` and drawing an unrelated connection
  re-mints `e1`, and an id-matched diff would call two different edges "unchanged"
- **Substance outranks position.** A node reconfigured *and* dragged is `changed`, not `moved`
- **`changed` names its fields** — `type`, `label`, `config`, `policy`
- **The oldest version in a history window reports `changes: null`**, not a zeroed summary: its
  predecessor may simply have been pruned
- `diffGraph()` builds the renderable union. **A removed node keeps its base position only where
  that position is free** — delete the last node of a chain and add a new one and the canvas
  reuses the slot, which stacked the two and rendered the *added* node invisible. Found in a
  browser; no API check could see it

### Routes

| Route | Body | Returns |
|---|---|---|
| `GET /api/workflows/:id/versions` | — | The history, newest first, **without graphs**. Each entry carries `changes` against its predecessor |
| `GET /api/workflows/:id/versions/:number` | — | One version, **with** its graph |
| `PATCH /api/workflows/:id/versions/:number` | `{ label }` | Names it, or clears it with `null`. The label is the only part of a version that can change after the fact |
| `POST /api/workflows/:id/versions/:number/restore` | — | **The workflow**, at its new version. Writes that graph and name as a new version on top |
| `GET /api/workflows/:id/versions/compare?from=&to=` | — | `{ from, to, diff }` with **both graphs**. `to` defaults to the current version |

All five require a session and are workspace-scoped. A non-numeric or unknown version is a **404**, not
a coerced query; a non-numeric `from`/`to` on compare is a **400**.

A workflow now returns `version` alongside its other fields, and a run returns `workflowVersion`.

## Execution state machine — **DEFINED**

`src/lib/engine/types.ts`.

```
run:   queued ──▶ running ──▶ succeeded          all three terminal
                    ▲   ├──▶ failed
                    │   └──▶ cancelled
                    ▼
                 waiting ──▶ cancelled           Phase 26. Not terminal

step:  running ──▶ succeeded                     both terminal
               └──▶ failed
       skipped                                   entered directly, terminal
```

- **`waiting` — Phase 26.** A `core.delay` longer than `MAX_DELAY_MS` (10 s) does not sleep: the
  engine records its step with its output, leaves it `running`, queues its successors and stops; the
  caller writes the cursor (carrying `wait: { seq, until }`), sets `waiting` and `wakeAt`, **releases
  the lease**, makes the run `durable`, resets `attempt` to 0, and schedules a Cloud Tasks delivery to
  `POST /api/runs/dispatch` for `wakeAt`. That delivery claims the run back to `running` only once
  `wakeAt <= now()`; an early one is re-armed. The resumed engine finishes the paused step first —
  so its duration is the wait — then carries on. **A waiting run holds no lease and no container**,
  so the lease family (D78) does not apply to it, and the sweeper never touches it
- **Where nothing can wake it** — no `TASKS_QUEUE` — a long wait **fails its step** with a message
  saying so, rather than holding a request open
- **Stopping a waiting run** finishes it `cancelled` at once and fails its paused step with *"The run
  was cancelled while it was waiting."* — the one case where a cancel lands *inside* a step, so the
  step needs closing. A stop requested while the delay step was executing is seen by the suspend
  write, which finishes the run cancelled instead of putting it down

- **A run is created in `queued` and claimed into `running`** (Phase 17). `queued` was reserved for
  a future queue in Chapter 1 and never written; it is written now, and it means the run exists and
  nothing is executing it yet
- **A run may never be observable as permanently `running`.** Unchanged as a property; what changed
  is that satisfying it is no longer the same as losing the run. `sweepAbandonedRuns` fails only
  what nothing is coming back for — a `sync` run, a durable run whose deliveries are spent, or a
  durable run that was never delivered. A durable run *between deliveries* is left alone, and
  failing it would be the bug. Still called before listing runs rather than on a timer, because
  Cloud Run scales to zero; the cron tick also calls it across every owner
- **A node failure fails the run and stops execution** — but a node may now be **retried** first,
  under its own `policy`. A config failure is never retried: it is a property of the graph and
  cannot change between attempts
- **A run can be resumed.** A durable run whose lease lapsed is redelivered, claims the lapsed
  lease, and carries on from its `cursor`. Completed steps are not re-executed
- **Cancellation lands at a step boundary.** `POST /api/runs/:id/cancel` records the request; the
  engine acts on it at its next checkpoint. A node already in flight is not interrupted
- **An engine that loses its lease writes nothing** — no status and no cursor. Another worker owns
  the run and is mid-flight; stamping `failed` over it would report a lie

### Bounds — safety properties, not tuning knobs

| Bound | Value | Meaning |
|---|---|---|
| `MAX_NODE_EXECUTIONS` | 30 | One node may not run more times than this in a run |
| `MAX_STEPS` | 200 | Total steps in a run |
| `DEFAULT_DEADLINE_MS` | 120 000 | Wall clock **per attempt**, well under Cloud Run's request timeout. Per attempt rather than per run, or a resumed run could never finish because its first attempt spent the clock |
| `HARD_MAX_ITERATIONS` | 25 | A loop node's `maxIterations` cannot be configured above this |
| `LEASE_MS` | 180 000 | A claim's lifetime. **Above `DEFAULT_DEADLINE_MS` by design**, so a lease cannot lapse while a legitimate attempt is still inside its own budget |
| `SWEEP_GRACE_MS` | 120 000 | How long after a lease lapses before a run is declared abandoned. The queue's backoff is 5 s doubling to 60 s, so sweeping immediately would race a redelivery that was about to succeed |
| `MAX_DELIVERIES` | 5 | Deliveries a durable run may receive. Matches the queue's `maxAttempts`, so a queue recreated with the wrong flags cannot turn a poison run into an unbounded loop |
| `MAX_RETRIES` | 3 | A node's `policy.retries` ceiling |
| `DISPATCH_DEADLINE_SECONDS` | 300 | How long Cloud Tasks waits for the worker. **Above the engine's 120 s**, or the queue would abandon and redeliver a run that was still legitimately executing |
| `MAX_DELAY_MS` | 10 000 | **Phase 26.** The longest wait spent asleep inside a request. Above it, a `core.delay` suspends the run |
| `MAX_WAIT_MS` | 30 days | **Phase 26.** The longest a run may wait. Enforced by the node's schema **and** by the engine on the wait it is handed, as every bound here is |
| `TASK_HORIZON_MS` | 29 days | **Phase 26.** The furthest ahead a task is scheduled. Cloud Tasks refuses more than 30 days; a timer further out is armed at the horizon and re-armed on its early delivery |

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
| `forbidden` | 403 | **Phase 19B.** Signed in, a member of this workspace, and the role does not carry this action — see *Two refusals that mean different things* below |
| `invalid_request` | 400 | Body failed its schema; `details` lists path + message |
| `not_found` | 404 | No such record **in this workspace** — indistinguishable from a record in somebody else's, deliberately. 404 and never 403, so the reply does not confirm the id exists |
| `invalid_graph` | 422 | The graph cannot run; `details` is the problem list |
| `conflict` | 409 | A state the caller can see but not change by retrying the same request: the last owner of a workspace leaving, a spent invitation, a membership that moved underfoot |
| `internal` | 500 | Unexpected. The detail goes to the server log, never to the client |

### `details.recovery` — **DEFINED** (Phase 25)

An error whose fix is on a *different page* may carry a recovery hint inside `details`. It
**extends the surface, not the envelope** — a client that does not know about it ignores one
extra key, which is the rule at the top of this section.

```jsonc
{ "error": { "code": "invalid_request", "message": "...",
  "details": { "recovery": { "href": "/settings?tab=provider", "label": "Add a provider key" } } } }
```

| Field | Rule |
|---|---|
| `href` | **An in-app path, always.** Must begin `/` and must not begin `//`. A recovery is rendered as a button, and a button in a product's own error state that leaves for another origin is not a recovery |
| `label` | Non-empty. Imperative, and it names where it goes |

`recoveryOf` in `src/lib/api-error.ts` is the only reader, and it **drops** anything failing
those rules rather than trusting it: the value arrives in a response body and becomes something
a user can click. `ApiRequestError.recovery` on the client is its narrowed output.

It is deliberately **optional and rare**. The case it was built for is a new account pressing
*Generate workflow* with no provider key stored — a clear 400 that named Settings and still left
the user to go and find it. An error about the field already on screen does not get one, because
attaching a link everywhere makes the ones that matter invisible.

### Two refusals that mean different things — **read this before adding a route**

`403` and `404` are not interchangeable here, and the difference is the whole of the tenancy model:

- **`404`** — the resource is in **another workspace**. D20: answering 403 would confirm the id
  exists, so a workflow, run, version or workspace the caller is not in is indistinguishable from
  one that never existed.
- **`403`** — the resource is in **this caller's own workspace**, they can already see it, and
  their role does not carry the action. Hiding that behind a 404 would make a real permission
  boundary look like a bug.

`requireScope(minimumRole)` produces the first refusal by resolving no membership, and the second
through `assertRole`. Both are server-side and neither depends on the UI hiding anything.

### Routes

| Route | Body | Returns |
|---|---|---|
| `GET /api/nodes` | — | The registry, palette projection |
| `GET /api/workflows` | — | Workflow list, newest-updated first |
| `POST /api/workflows` | `{ name, description?, graph? }` | 201, the workflow |
| `POST /api/workflows/generate` | `{ prompt, name? }` | 201, `{ workflow, generation }` — see *Generation* |
| `GET /api/workflows/:id` | — | The workflow |
| `PATCH /api/workflows/:id` | `{ name?, description?, graph?, visibility?, active? }` | The workflow. `visibility` is **authorised separately** — its creator or an `admin`, not any editor — so the rest of the body may succeed on a request where it alone would be refused, and the 403 names why. `active` (Phase 26) is the **active switch**, `editor` like the graph, and **not a version** — see *Trigger shapes* |
| `POST /api/workflows/:id/share` | — | 201 / 200, the workflow with `shareUrl`. **`admin`** — see *Per-workflow sharing* |
| `DELETE /api/workflows/:id/share` | — | The workflow with `shareUrl: null`. **`admin`** |
| `GET /api/share/:token` | — | The redacted graph. **No session** — see *Per-workflow sharing* |
| `DELETE /api/workflows/:id` | — | `{ deleted: id }` |
| `GET /api/workflows/:id/versions` and the four routes beside it | — | Version history, restore and diff — see *Workflow versions* (Phase 18) |
| `POST /api/workflows/:id/runs` | `{ input?, mode? }` | `mode` defaults to `sync` → **201, the finished run with every step**. `mode: "durable"` → **202**, a `queued` run with no steps; it is executed by a Cloud Tasks delivery and watched over the stream. A durable request that could not reach the queue falls back to executing in-process and answers **201**, so the status code says which happened without a flag to interpret |
| `GET /api/workflows/:id/runs` | — | Run list for that workflow |
| `GET /api/runs?workflowId=` | — | Run list |
| `GET /api/runs/:id` | — | The run with its steps |
| `POST /api/runs/:id/cancel` | — | The run as it now stands. `cancelled` if nothing was executing it; otherwise still `running` with `cancelRequested: true` and the engine stopping at its next step boundary. Idempotent by construction |
| `GET /api/workflows/:id/stream` | — | **SSE.** The workflow's current run, live. `?runId=` pins one |
| `POST /api/webhook/:token` | any JSON object | 201, the finished run — or a `waiting` one, if it reached a long delay. **409 `conflict`** if the workflow is switched off. **No session** — see *Trigger shapes* |
| `POST /api/cron/fire` | `{ workflowId, scheduledFor, token }` | **Phase 26.** A schedule timer's delivery: the outcome. **No session**, `CRON_SECRET` **and** the slot's token required. Always 200 on a delivery it declines — see *Trigger shapes* |
| `POST /api/cron/tick` | — | The daily sweep's outcome. **No session**, `CRON_SECRET` required |
| `GET /api/workspaces` | — | Every workspace this **account** is in — the switcher's list |
| `POST /api/workspaces` | `{ name }` | 201, the workspace. Also **switches to it**, by setting the active-workspace cookie on the response |
| `POST /api/workspaces/active` | `{ workspaceId }` | The workspace, and sets the cookie. A workspace the caller is not in answers 404 |
| `PATCH /api/workspaces/:id` | `{ name }` | The workspace. **`admin`** |
| `GET /api/workspaces/:id/members` | — | `[{ userId, name, email, role, joinedAt, you }]`. Every member may read it |
| `DELETE /api/workspaces/:id/members/:userId` | — | `{ removed }`. Removing somebody else needs `admin`; removing **yourself** is leaving and needs only membership; the **last owner** cannot be removed by anybody |
| `PATCH /api/workspaces/:id/members/:userId` | `{ role }` | The member as they now are. **`admin`**, and `owner` at either end of the change needs `owner` — see *Changing a member's role* |
| `GET /api/workspaces/:id/invitations` | — | Every invitation with its state, newest first. **`admin`**. No token, ever |
| `POST /api/workspaces/:id/invitations` | `{ email, role? }` | 201, `{ invitation, url }`. **`admin`**. `role` defaults to `editor` and can never be `owner`. **The `url` is the only time the link exists** |
| `DELETE /api/workspaces/:id/invitations/:invitationId` | — | The revoked invitation. **`admin`**. Already accepted or already revoked answers 404 |
| `GET /api/invitations/:token` | — | `{ workspace, role }` and nothing else. **No session** — see *Invitations* |
| `POST /api/invitations/:token/accept` | — | The workspace, and switches to it. Session required; the **verified email** must match |
| `POST /api/runs/dispatch` | `{ runId, token }` | **No session** (Phase 17). `CRON_SECRET` **and** the run's own `dispatchToken` both required. Executes or resumes that one run. **Always 200 on a delivery it declines** — a 4xx/5xx tells Cloud Tasks to retry, and every declined case (already finished, already claimed, forged token, deliveries exhausted) is one where retrying is pointless or harmful; the body says which |

Every route above requires a session and is workspace-scoped, **except these**:
`GET /api/invitations/:token`, `GET /api/share/:token`, and the four machine endpoints
(`POST /api/webhook/:token`, `POST /api/cron/fire`, `POST /api/cron/tick`, `POST /api/runs/dispatch`).
`SECURITY.md` → *The unauthenticated surfaces* is the complete list, checked by
`scripts/verify-security.mjs`. The first two are
reached by a link holder who may have no account at all.

**`GET /api/share/:token` is the only one of them whose risk is in the response rather than in what
the request can cause** — a webhook starts a run, a tick fires schedules, an invitation preview names
one workspace; this one hands back content. That is why what it may carry is decided by an allowlist
in one place and not by field selection in the route. The tick and the webhook are specified under *Trigger shapes*; the dispatcher is
specified below.

A workflow is returned as `{ id, name, description, graph, runnable, problems, webhookUrl,
version, visibility, ownerId, shareUrl, sharedAt, webhookTokenRotatedAt, scheduleCron, scheduleNextAt,
scheduleLastFiredAt, scheduleArmed, active, createdAt, updatedAt }`. `scheduleArmed` and `active` are
Phase 26's: whether a Cloud Tasks timer was created for `scheduleNextAt`, and the active switch. The four Phase 20 fields are safe to send to a member of the workspace:
`visibility` is a setting they can already infer from seeing this at all, `ownerId` is who made it so
a client knows whether the viewer may change that setting, and `shareUrl` is a bearer URL granting a
*redacted* read of a graph every member can already read in full. This shape is **not** what the
public share link answers — that is `SharedWorkflow`, a different type with no ids and no tokens. `runnable` and
`problems` come from `validateGraph`, so a client can show what is wrong without the save having
failed. `webhookUrl` is null unless the **stored** graph holds a webhook trigger, and the three
`schedule*` fields are null unless it holds a schedule trigger (Phase 8).

**`POST /runs` is synchronous by default.** The request stays open until the run finishes, and its
response is the authoritative final state. Watching a run live is a *separate* concern —
`GET /api/workflows/:id/stream`, below. The client opens that stream before it POSTs, because a
request that does not return until the run is over cannot also tell you a run id to watch.

**`mode: "durable"` needed no new client protocol, and that is not a coincidence.** It answers 202
with a run id and no steps, which is exactly the situation the stream was already built for: a run
started by somebody else's request, which the browser follows by *workflow* rather than by a run id
it could not have known (D28). The Run button and the Queue button therefore differ in one line.

### `POST /api/runs/dispatch` — the third route with no session

*(Phase 20 added a fourth, `GET /api/share/:token`. This one is still the third machine endpoint.)*

Two independent things must hold, and only the second one actually authorises anything:

1. **The shared `CRON_SECRET`**, compared in constant time, carried in the task's headers — the same
   trust boundary Phase 8 accepted when Cloud Scheduler began carrying this secret for the tick.
2. **The run's own `dispatchToken`.** It names one run, so the most a holder can do is cause a run
   its owner already started to be resumed. It cannot start an arbitrary workflow, and it cannot
   start anything at all. The **lease** then makes even that harmless: a redelivery of a run
   somebody else is executing fails to claim it and does nothing.

The token's shape is checked before the database is touched, so a scan cannot become a stream of
queries — the same rule the webhook receiver follows.

**Why an OIDC token is not also demanded.** Cloud Tasks can sign a delivery with one, but this
service is `--allow-unauthenticated` — it has to be, it serves the app — so Cloud Run would not
check it and the app would have to verify the JWT itself against Google's rotating JWKS. That is a
meaningful amount of security-critical code sitting *outside* the per-run token that is already the
narrow thing here. If the worker is ever split onto a private endpoint, OIDC becomes the right
answer.

A client disconnecting does **not** kill a run: verified against Cloud Run by aborting a `POST
/runs` mid-flight and finding the run had still completed. So a mid-run reload recovers a run that
is genuinely still going, rather than one its own reload killed.

**Owner scoping is server-side on every route.** Every query filters on the session's user id;
there is no code path that reads a workflow or run by id alone. Another user's record answers 404,
not 403.

## SSE event messages — **DEFINED**

Shapes and framing live in `src/lib/engine/stream.ts`; the endpoint is
`GET /api/workflows/:id/stream`, workspace-scoped like every other route.

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
| `run` | `{ runId, status, attempt, cancelRequested, wakeAt, output, error, finishedAt, durationMs }` — never `steps` | The run's own fields changed. `wakeAt` is Phase 26's |
| `done` | `{ runId, reason }` — `finished` \| `waiting` \| `idle` \| `timeout` | The stream is over. **The client closes the `EventSource` on any reason** (and the canvas re-arms a fresh one). `waiting` is Phase 26's: the run it followed was put down until its wake time |
| `stream_error` | `{ message }` | The stream cannot continue. Named `stream_error` because an event named `error` arrives on an `EventSource` indistinguishably from a transport failure |

`attempt` and `cancelRequested` joined the patch in Phase 17, and they are in the run's
*fingerprint* too, because both are events worth reporting while the status is unchanged: a run that
resumed is still `running`, and so is a run that has just been asked to stop. Without them the
canvas would show "Running" through both and look like it had ignored the Stop button. A `snapshot`
also carries `mode`, which a client cannot infer and which is the one property of a run that only
matters once the server restarts.

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

**Phase 26 — a baseline that can wake.** A run that is `waiting` at the first poll is resting like a
finished one, so it becomes a baseline too — otherwise every reconnect during a two-day wait would
snapshot it and close at once. Unlike a finished baseline it comes back: the moment it is read as
anything other than `waiting`, it is followed and the baseline is dropped. `baselineWaiting` is the
one bit that tells the two kinds apart (`followDecision` in `lib/engine/stream.ts`).

### It is never idle for long

Cloud Run bills CPU for as long as a stream is open. A stream closes on a terminal or `waiting` run, after
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

### `checkpoint` — Phase 17 replaced `heartbeat`

```ts
checkpoint: (cursor: RunCursor) => Promise<{ cancelRequested: boolean; leaseHeld: boolean }>
```

`heartbeat()` bumped a timestamp and returned nothing. `checkpoint` does three things in **one**
`UPDATE ... RETURNING`: it writes the frontier, extends the lease, and reports what the run row now
says. One statement is the design, not an optimisation — on Neon's free tier a separate per-step
poll for cancellation would double the write cost of every run in the product, and `RETURNING` makes
the answer free.

Both returned fields can stop the engine, and the order matters:

- `leaseHeld: false` — a redelivery claimed the lapsed lease. The engine stops **writing nothing**:
  no status, no cursor. It wins over `cancelRequested`, because an engine with no lease has no
  standing to finish the run as anything.
- `cancelRequested: true` — the run ends `cancelled`, keeping its cursor so its progress stays
  legible, and **without** backfilling `skipped` steps: a skipped step means "the run reached its end
  and this was never on the path", and a cancelled run has not reached its end.

It is serialised on the same chain as the step writes, which is what guarantees a cursor is never
written *ahead* of the step it describes — a cursor naming outstanding work whose step row had not
landed would resume from a `fromSeq` with no output behind it.

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

**Phase 23D made that claim true by exercising it.** There are two implementations —
`lib/ai/gemini.ts` and `lib/ai/groq.ts` — and **nothing above this interface changed** to add the
second. What *did* change is below it: the retry, fallback, budget and circuit-breaker machinery
moved from `gemini.ts` into `lib/ai/chain.ts`, which both adapters share. A provider file now owns
exactly four things — how a request is built, how a 200 is read, how an error message is found, and
what its catalogue is.

**Which provider a workspace uses is a stored fact**, `workspace.llmProvider` (migration `0010`),
resolved by `lib/ai/provider.ts` in this order: the stored choice *if that provider holds a key*,
else the first provider in registry order that does, else the development environment key, else
`NoProviderKeyError`. `PROVIDERS[0]` is Google, so **a workspace that has never chosen behaves
exactly as it did before a second provider existed** — `null` in that column means "nobody has
chosen", not "not yet backfilled".

**The credential kind was already provider-qualified** and did not move: Google's rows are
`llm.google`, as they have been since Phase 6, and Groq's are `llm.groq`. No credential row was
rewritten, which `scripts/verify-providers.mjs` proves on the deployed database by comparing the
ciphertext, the wrapped key, the rotation count and `createdAt` before and after a provider switch.

**One rule is honoured more strictly than either provider requires.** `json: true` is sent only
when a request carries no tools. Gemini forbids the combination; Groq allows it. The stricter rule
is the contract, so a workflow behaves the same whichever provider runs it. The tool parameter
schema is narrowed the same way, by `toToolParameters`, for the same reason — Groq would accept
richer JSON Schema and is deliberately given the Gemini-compatible subset.

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

## Workspaces and membership — **DEFINED** (Phase 19A, extended in 19B)

Tables `workspace` and `workspace_member` in `src/db/schema.ts`. The scope type and its resolution
are `src/lib/workspace/`.

**A workspace is the tenant. Every resource belongs to one, and no query reads across the
boundary.** `workflow`, `run`, `workflow_version` and `credential` each carry a `workspaceId`, and
every store function filters on it.

### `workspace`

| Field | Notes |
|---|---|
| `id` | uuid |
| `name` | shown in the header. Backfilled as `<user>'s workspace` for accounts that predate this phase |
| `createdBy` | who made it. **Not an authorisation column** — membership is. `on delete set null`, so removing a person does not delete the workspace others are in |
| `personal` | the workspace created automatically for a user. A fact about origin, not a permission |
| `createdAt`, `updatedAt` | |

Unique partial index on `createdBy where personal` — **that index is the interlock**, not a code
check. `neon-http` has no transactions (D6), so "select, insert if absent" is a real race on a cold
account; the loser's insert conflicts and it re-reads.

### `workspace_member`

| Field | Notes |
|---|---|
| `workspaceId`, `userId` | composite primary key, so a person cannot be in one workspace twice |
| `role` | `owner` \| `admin` \| `editor` \| `viewer`. Written in Phase 19A, **enforced since Phase 19B** — see *What each role may do* |
| `createdAt` | |

### `WorkspaceScope` — what every store function takes

```ts
interface WorkspaceScope {
  workspaceId: string;   // what a row must belong to for this request to see it
  userId: string;        // who is doing this; written to `ownerId` on anything created
  role: WorkspaceRole;   // what this member may do. Checked by `requireScope(minimumRole)`
}
```

**It is an object rather than a string on purpose.** Phase 19A changed the meaning of the first
argument of about thirty functions from "the user" to "the workspace". Had both been `string`, every
call site missed in that sweep would have compiled, run, and read one tenant's rows under another
tenant's name. As a distinct type, a missed call site fails the typecheck — which is how all 43 of
them were found.

`requireScope(minimumRole)` in `src/lib/api.ts` resolves it for a route — and refuses when the role
falls short. `requireScopeFor(workspaceId, minimumRole)` does the same for the workspace-management
routes, which name a workspace in the path: a workspace the caller is not a member of answers 404.
`requirePageSession()` in
`src/lib/workspace/page.ts` does it for a page and redirects instead of answering 401.

### The three machine routes with no session get theirs from the row

`systemScope(workflow)` derives the scope from the workflow the webhook token, the cron tick or the
dispatch token resolved to. Nothing about the request can name a workspace, so those routes cannot
reach another tenant even if their own token check were wrong about *which* workflow.

The role it hands back is `owner`, and **Phase 20 re-examined that and kept it**, which was the
question `scope.ts` left open. These paths have nobody at the keyboard, so there is no membership to
look up; and per-workflow `visibility` deliberately does not gate them, because a trigger is not a
person — a private workflow still fires on its own webhook and its own schedule.

### What each role may do — **ENFORCED since Phase 19B**

Phase 19A wrote `role` and enforced nothing, which was inert while every member was the `owner` of
their own personal workspace. Invitations ended that, so `requireScope(minimumRole)` in
`src/lib/api.ts` now gates every route and `assertRole` in `src/lib/workspace/roles.ts` is the check.

**The default is `viewer`**, the least privilege — so a route that says nothing gets read access and
not write access, and a new mutating route that forgets the argument fails closed.

| Action | Needs |
|---|---|
| Read workflows, runs, versions, the members list, credential *status* | `viewer` |
| Create, edit, delete, run, cancel, generate, label and restore a version | `editor` |
| Store or delete a provider key, connect or disconnect an integration, **list provider models** | `admin` |
| Rename the workspace, invite, revoke, remove another member, **change a member's role** | `admin` |
| **Publish or revoke a workflow's public share link** (Phase 20) | `admin` |
| **Read the credential vault** — what is stored, when it was last rotated and used (Phase 21) | `viewer` |
| **Rotate a stored credential**, **rotate a workflow's webhook token** (Phase 21) | `admin` |
| **Re-key a workspace under the current root key** (Phase 21) | `owner` |
| Remove an **owner**, **grant or take away ownership** (Phase 20) | `owner` |
| **Change a workflow's visibility** (Phase 20) | its **creator**, or `admin` — not any editor |
| Leave the workspace | membership alone — and never the last owner |

Four entries look odd and are deliberate. **Listing provider models is `admin` although it is a
GET**: it spends the workspace's provider quota on an outbound call with the workspace's key, to
fill a picker beside a Save button no lesser role can press. **Running a workflow is `editor`, not
`viewer`**: a run sends mail, posts to Discord and writes to spreadsheets, so it is a write to the
outside world whatever it is to the database. **Publishing a share link is `admin`, not `editor`**,
although an editor may already do far less reversible things: the bar is about the *kind* of act,
not its size — everything else an editor does stays inside the workspace and is undone by editing,
and this one makes its content readable by anybody handed a URL. **Changing a workflow's visibility
is not a role at all** but a relationship — its creator, or an admin — for the reason
`lib/workflow/visibility.ts` sets out: an editor flipping a colleague's workflow to private would
hide it from the people it was shared with, which is a destructive act dressed as an edit.

**Phase 21 added three more, on the same principle.** *Reading* the vault is `viewer`, because
credential status already was and a viewer who cannot see whether a credential exists cannot
understand a failed run. *Rotating* one is `admin`, and so is rotating a webhook token: an editor
may already change everything about a workflow, and what they may not do is invalidate a secret
that systems outside this product are calling. *Re-keying* is `owner` — the only route besides
ownership itself that needs it — because it changes how every secret in the workspace is stored,
and "it is designed so a failure is safe" is exactly the claim a permission bar should not rest
on.

### Changing a member's role — **DEFINED** (Phase 20)

`PATCH /api/workspaces/:id/members/:userId` with `{ role }`. The rule is `roleChangeRefusal` in
`src/lib/workspace/roles.ts`, and it is applied in the order **authority → ownership → invariant**,
which is Phase 19B's bug fix carried across: a viewer aiming a demotion at the sole owner must be
told they may not do this, not that the workspace would be left ownerless.

| Refusal | HTTP | When |
|---|---|---|
| `not_allowed` | 403 | Changing anybody's role — **including your own** — needs `admin`. Unlike *leaving*, a self-demotion is not an escape hatch |
| `owner_only` | 403 | Only an owner may **grant** `owner`, and only an owner may change an owner's role. Both halves are needed, or `admin` is `owner` with extra steps |
| `last_owner` | 409 | The workspace would have no owner. The same invariant `removalRefusal` protects, reached by a different route |
| `no_change` | 409 | The target already holds that role — so the list the request was built from is stale |
| — | 400 | The value is not one of the four roles. The route's schema refuses it before the rule is reached |

**The handover is: promote the successor, then step down.** An owner may demote themselves once a
second owner exists, and that is the only way the sole owner of a shared workspace stops being one.

**A role change takes effect on the next request.** The role is read per request from the membership
row — there is no session to re-mint and no cache to wait out — which is asserted against the
deployed system rather than assumed.

---

## Invitations — **DEFINED** (Phase 19B)

Table `workspace_invitation`; the rules are `src/lib/workspace/invitations.ts` and the queries are
`src/lib/workspace/store.ts`.

**An invitation link is an unauthenticated bearer token that will be pasted into a chat window**, so
it is treated exactly like the webhook trigger token (D41), with one deliberate difference.

| Property | Value |
|---|---|
| Token | 32 bytes of CSPRNG, base64url — 256 bits in 43 characters. Wider than the webhook token's 192 bits because this grants a *workspace*, not one workflow start |
| Stored as | **`sha256(token)` hex, unique.** The plaintext is never written. The link is shown once, in one response; re-inviting the same address rotates it |
| Expiry | **7 days.** Short because delivery is by hand — the shorter the window, the fewer live bearer tokens sit in other people's message history |
| Single use | Enforced by the `where` on the accepting UPDATE, not by the read before it |
| Live at most once per address | Partial unique index on `(workspaceId, email)` where neither accepted nor revoked. **The index is the interlock** — `neon-http` has no transactions (D6), so re-inviting is an upsert, not a read-then-write |
| Role | `admin` \| `editor` \| `viewer`. **Never `owner`** — ownership does not arrive by link |
| Addressed to | An email, lower-cased and trimmed. Dots and `+tags` are **not** stripped: those are provider rules, and a normalisation the identity provider does not share would refuse a legitimate accept |

**Accepting needs two independent facts.** The token proves the holder was sent the link; the session
proves who they are. The membership is written for the address the **identity provider verified**,
never for anything in the URL — an `?email=` would make the invited address a claim by the caller.

**Every dead link answers identically.** Expired, revoked, already used, and never existed all return
the same 404 with the same message from `GET /api/invitations/:token`, and `/invite/:token` renders
the byte-identical page for each. The endpoint cannot be used to sort real tokens from invented ones.
A *signed-in* caller attempting to accept gets the specific reason, because only somebody holding a
real token and a real session can reach that path, and "wrong Google account" is the single most
likely failure in the flow.

**AgentForge does not send the email.** There is no mail provider on a zero-cost budget, so the API
returns one link and the inviter delivers it themselves. The settings panel says so rather than
implying a message was sent.

### The active workspace is a cookie — and it is a preference, never a permission

`af_workspace`, httpOnly, `SameSite=Lax`, `Secure` when `APP_BASE_URL` is https, one year.

It carries a workspace id and nothing else: no signature, no user id, no expiry check. **It does not
need them.** `chooseMembership` honours the id only if it appears in the memberships the database
returned for this user, so a forged cookie, one copied from another browser, and one naming a
workspace the user has since been removed from all fall back to their own personal workspace. The
server asks the database who you are on every request; the cookie only ever narrows an answer it
already has.

There is deliberately no `activeWorkspaceId` column: it would be a write on every switch against a
metered database, and it would make the choice global across every browser and tab.

---

## Per-workflow sharing — **DEFINED** (Phase 20)

Two columns on `workflow`, and they are **independent on purpose**. `visibility` is who among your
colleagues may open it; `shareToken` is whether anybody handed a URL may read it. A private workflow
with a live link is coherent — *not ready for my colleagues, ready for the person I am showing it
to* — and collapsing the two into one three-valued ladder would make "published" look like a kind of
privacy setting rather than the outward-facing act it is.

### `workflow.visibility`

| Value | Who can see it |
|---|---|
| `workspace` | Every member. **The default, and exactly what Phase 19A already did** — so the migration changes nothing anybody can observe |
| `private` | Its **creator** (`ownerId`), plus the workspace's `admin`s and `owner`s |

**Admins see private workflows, and that is a decision rather than a hole.** A private workflow still
runs with the *workspace's* credentials: it can send mail from the workspace's Gmail connection and
post to its Discord channel. An admin who cannot see it cannot account for what those credentials are
doing. `private` means *not yet shared with my colleagues*; it has never meant *hidden from the
workspace*, and the UI says so in those words.

**An invisible workflow answers 404, not 403** — D20 applied one level in. The fact that it exists is
what `private` hides, so confirming it with a 403 would defeat the column.

The filter is `visibleWorkflows(scope)` in `src/lib/workflow/visibility.ts`, applied in the `where`
of `listWorkflows` and `getWorkflow`. Every workflow-scoped route reaches its rows through one of
those two, so versions, per-workflow run lists, the stream and execution are covered without knowing
about it. **`getRun` and the unfiltered `listRuns` are the two exceptions** — they are addressed by
*run* id — and both join `workflow` and apply the same predicate, or a viewer would read the steps,
inputs and outputs of a workflow they cannot open.

**A trigger is not a person.** The webhook, the cron tick and the dispatcher derive their scope from
the workflow row (`systemScope`), so a private workflow still fires on its own triggers.

### The public share link

| Property | Value |
|---|---|
| Token | 24 bytes of CSPRNG, base64url — 192 bits in 32 characters, the same width as the webhook token (D41) and for the same reason: this is an unauthenticated surface and the token is the whole of its access control |
| Stored as | **Plaintext**, unlike an invitation's hash. The URL has to be displayable for as long as the link is live, exactly as the webhook URL is — which is why revoking is the only way to stop it |
| Uniqueness | A **partial** unique index on `shareToken where shareToken is not null`. One token names at most one workflow, enforced by the database rather than by the code that mints it (D6 — no transactions) |
| Minting | **Idempotent.** An already-shared workflow answers with the link it has. Rotating is deliberately `DELETE` then `POST`: a share URL gets pasted into a README, and re-minting it on every press of a Share button would break those silently |
| Revoking | The token is **discarded**, so the URL can never come back. Idempotent |
| Needs | `admin` to publish or revoke. Nobody needs anything to read one |

### What a share link may carry — **the allowlist**

`src/lib/workflow/share.ts` holds one table, `PUBLISHABLE`, keyed by node type, and **its default
publishes nothing**. A denylist — "strip `headers`, strip `to`" — is the obvious shape and it fails
open: the day somebody adds a node with a `token` field, the denylist does not know about it. This
one refuses to publish a field nobody has named, so the same mistake produces a share that says too
little, which somebody notices, rather than one that says too much, which nobody does.
`share.test.ts` asserts every registered node type has an entry, so adding a node fails the build
until its publishability is a decision somebody took.

**The line the table draws is: shape and settings are published, typed-in values are not.** Enums,
numbers, booleans and the *names* of object keys carry no authored content; a URL, a prompt, an email
address, a message body and a header value all can. So `integration.http` publishes its method and
its header **names** and withholds the URL, the body and every header value; `integration.gmail`
publishes nothing at all; `core.set` publishes its field names and none of their values.

Each shared node carries a `redacted` array naming what was withheld, and the page prints the count.
A reader who cannot tell *unconfigured* from *not shown to you* is being misled by omission, which is
the failure mode a share link has.

### Routes

| Route | Body | Returns |
|---|---|---|
| `POST /api/workflows/:id/share` | — | **201** the first time with `shareUrl` set, **200** if a link already existed. `admin` |
| `DELETE /api/workflows/:id/share` | — | The workflow with `shareUrl: null`. `admin`. Idempotent |
| `GET /api/share/:token` | — | `{ name, description, graph, version, updatedAt }`. **No session.** The token is pattern-checked before any query, and every dead or malformed token answers the identical 404 |

`/s/:token` renders the same thing as a page, `noindex`, reading the database directly rather than
fetching its own API — the redaction is the same function either way.

**The response is built field by field from an explicit list, never by spreading the row.** The
workflow row carries `webhookToken`, `shareToken`, `ownerId`, `workspaceId` and `visibility`, and a
column added to that table later would arrive in the response under any shape that started from the
row. Nothing about a run, a credential or a member of the workspace is reachable from that function
at all: it is handed one workflow and has nothing else to leak.

---

## Credential storage shape — **DEFINED**

The `credential` table landed in **Phase 3** because Phase 3 owns the schema. The encryption
helpers (`src/lib/crypto.ts`), the store (`src/lib/credentials.ts`) and the write-only API are
**Phase 6**.

Columns: `id`, `workspaceId`, `ownerId`, `kind`, `label`, `ciphertext`, `iv`, `authTag`,
**`wrappedKey`, `wrapIv`, `wrapAuthTag`, `keyVersion`, `rotatedAt`, `rotationCount`**,
`metadata`, `createdAt`, `updatedAt`. **Unique on `(workspaceId, kind, label)` since Phase 19A** —
it was `(ownerId, kind, label)`, and migration `0006` dropped the old index. GCM rather than CBC
because it authenticates: a row edited in the database fails to decrypt instead of yielding
plausible rubbish that then gets sent to a provider as an API key. A fresh IV per encryption,
generated inside `seal` rather than passed in.

### Envelope encryption — **Phase 21**, and it replaced a single key

Chapter 1 encrypted every secret directly under `ENCRYPTION_KEY` and shipped the accurate warning
that rotating it destroyed all of them. A key that cannot be rotated is not a control. Phase 21
added one layer of indirection:

```
   the secret  --AES-256-GCM-->  ciphertext      key: a fresh 256-bit DEK, one per credential
   that DEK    --AES-256-GCM-->  wrappedKey      key: the root key, versioned
```

| Column | What it holds |
|---|---|
| `ciphertext` / `iv` / `authTag` | The secret, under this credential's own data key |
| `wrappedKey` / `wrapIv` / `wrapAuthTag` | That data key, under the root key |
| `keyVersion` | Which root key wrapped it — `env`, or `sm:<n>` for a Secret Manager version |

**The four envelope columns are nullable, and that is the migration's whole safety argument.** A
row with `wrappedKey is null` is a Chapter 1 row whose ciphertext is directly under
`ENCRYPTION_KEY`; `openSecret` reads both shapes, so the previous revision kept serving while
`0009` was applied and the database was never in a state that only one revision could read.
`POST /api/credentials/rekey` performs the conversion.

**A fresh data key per write, always.** Two credentials never share one, and neither does a
credential and its own previous value — so rotating a secret in place leaves no key material in
common with what it replaced.

**Rotating the root key re-wraps ~60 bytes per credential and never touches `ciphertext`.** That
is what makes it an operation somebody performs rather than one the docs warn against. It is
resumable by construction: every row is an independent `UPDATE` naming the key that wraps it, so an
interrupted re-key leaves every row still readable.

`rotatedAt` and `rotationCount` track the **secret value**, distinct from `updatedAt`, which also
moves when only the metadata does. They are incremented inside the upsert's `DO UPDATE SET`, which
Postgres runs only on conflict — so an insert leaves them at `null`/`0` with no read-then-write to
race (D6).

**Nothing secret in this row ever reaches a client.** Not the value, not a prefix, not a masked
tail — a four-character hint is still key material. `configured: true` plus `updatedAt` is the
whole answer to "is a key stored". `describeCredential` never reads the six envelope columns into
its result, so a future spread cannot leak them, and a test serialises the projection and searches
it for every one of them.

**`keyVersion` does cross to the client, and it is not key material.** It names immutable bytes in
a key store and reveals nothing about them, and it is the only way an operator can tell that a
re-key moved anything — otherwise the phase's central claim would have to be taken on trust.

Phase 6 added one kind, `llm.google`, label `default`, `metadata: { model }`. Phase 9 added two
more — see *Integration nodes and their credentials* for `integration.discord` and `google.oauth`.
**Phase 23D added `llm.groq`, in the same shape**: one key, `metadata: { model }`, one per
workspace. The kinds are generated from `lib/ai/providers.ts`, so a third provider is a registry
row and no edit to the vault, the rotation table or `CREDENTIAL_KINDS`.

### A credential belongs to a workspace — **Phase 19A, and it widens a surface**

**Every member of a workspace can use every credential in it.** That is required rather than
incidental: a workflow shared with a teammate that cannot reach its Google credential fails at the
first integration node, at runtime, with an error about a connection the teammate never made.

The consequence has to be stated rather than discovered, and the sharpest case is `google.oauth`:
**connecting Google to a workspace lets every member of that workspace act as you within the scopes
you granted** — sending mail from your address, writing to your spreadsheets. The settings page says
so on the card where the connection is made, not only here.

`ownerId` is still written and still means *who connected it*, which is the name the UI needs when
somebody asks whose account a workflow is sending mail from. It is **not** an authorisation column
any more; nothing reads it to decide access.

**Two unique indexes existed between migrations `0005` and `0006`**, on `(ownerId, kind, label)` and
`(workspaceId, kind, label)`. That was deliberate: while two revisions were serving, one wrote each
column, and at that moment the two were in exact one-to-one correspondence, so keeping both was the
only state in which neither revision could write a duplicate. **The old one had to be gone before
any user could hold a second workspace**, or the same kind of credential in two of their workspaces
would be refused by an index measuring the wrong thing.

### The vault, rotation and re-keying — **DEFINED** (Phase 21)

| Route | Needs | Body | Returns |
|---|---|---|---|
| `GET /api/credentials` | `viewer` | — | The whole `Vault` — see below |
| `POST /api/credentials/<kind>/rotate` | `admin` | `{ secret }` | The whole `Vault`, refreshed |
| `POST /api/credentials/rekey` | `owner` | — | `{ rekey: RekeyOutcome, vault: Vault }` |
| `POST /api/workflows/<id>/webhook/rotate` | `admin` | — | The workflow projection, with the **new** `webhookUrl` |

`Vault` carries `entries` (every stored credential with its rotation and usage state),
`missing` (the kinds this workspace holds none of, each with a `connectHref`), `events` (the
audit log, newest first), `rootKey` (`provider` and the versions actually in use), `legacyCount`
and `retentionDays`.

**Reading is `viewer` and changing is `admin`**, which is the matrix already in *What each role
may do*: credential *status* has been a viewer action since Phase 19B, and a viewer who cannot
see whether a credential exists cannot understand a failed run. Re-keying is `owner` — rotating
one credential has a blast radius of one integration; this touches how every secret in the
workspace is stored.

**Rotation is per-kind, and two of the three kinds are not a text box.** `ROTATION_RULES` in
`src/lib/credentials/rotation.ts` is the table, and a test asserts it covers the credential
registry in both directions — a kind added later with no rule would silently become unrotatable
and nothing would break, so nobody would notice.

| Kind | `mode` | Rotation is |
|---|---|---|
| `llm.google` | `value` | A new API key, proved with one `models.list` call before anything is written |
| `llm.groq` | `value` | The same, against Groq. **Phase 23D wrote no rotation code for it** — the row is generated from the provider registry, which is the claim the generation was making |
| `integration.discord` | `value` | A new webhook URL, called before anything is written. **The old webhook is not deleted at Discord** — nothing here can do that |
| `google.oauth` | `reconnect` | Re-running the consent flow. A refresh token can only be minted by Google, so there is nothing to paste |

**Nothing is stored until the new secret has been proved against the provider.** Storing first
would give this route the failure mode *your workspace is now broken and the old secret is gone*,
and there is no undo, because the old secret is not kept. A refused rotation leaves the stored
envelope byte-identical, which the deployed suite asserts by comparing it either side.

**Refusals keep their own status codes.** An unknown kind is `404` (the vault builds its controls
from the table, so a kind it does not know is a reference to something that does not exist), a
`reconnect` kind sent a typed secret is `400`, a key the provider rejects is `400`, and a
throttled provider is `409` — the Phase 13 distinction, unchanged.

**Webhook token rotation has no grace period.** The old URL answers 404 from the moment the
request returns. A token that keeps working for an hour after being rotated is a token still live
for an hour after somebody rotated it *because it leaked*. `webhookTokenRotatedAt` on the workflow
row is `null` until the first rotation, and the workflow projection carries it.

### The credential audit log — **DEFINED** (Phase 21)

Table `credential_event`. **It records use, never content**: no secret, no prefix, no length, no
hash, and no request or response body from the service the secret authenticated to.

| Property | Value |
|---|---|
| Written from | `readSecret` — the single funnel every plaintext passes through. Four call sites would be four places to keep in step and a fifth added later without one |
| Events | `stored`, `rotated`, `revoked`, `used`, `rekeyed`. The first two are separate: a workspace's first Discord connection is not a rotation |
| Survives revocation | `credentialId` is `ON DELETE SET NULL` and `kind`/`label` are denormalised, so the history stays readable after the credential is gone |
| Attribution | `runId`/`nodeId`/`nodeType` for a use; `actorId` for a deliberate human act. **A use has no actor** — it happens inside a run that may have been started by a schedule or an unauthenticated webhook |
| `actorId` never reaches a client | Recorded, deliberately not projected. `describeEvent` is a pure function so that rule is asserted rather than maintained by hand |
| `detail` | One machine-readable word: a node's capability (`send-mail`, `append-row`, `post-message`, `generate`, `agent-loop`) or a root key version. Never a value or part of one |
| Retention | **30 days**, pruned by the cron tick, which reports `pruned` in its outcome |
| Never fails what it audits | An insert that throws is logged to stderr and swallowed. This log is **operational, not a compliance record**; if that changes, so does this line |

### Routes

| Route | Body | Returns |
|---|---|---|
| `GET /api/settings/provider` | — | `{ provider, configured, model, defaultModel, source, updatedAt, health }` |
| `PUT /api/settings/provider` | `{ apiKey?, model? }` | the same shape |
| `DELETE /api/settings/provider` | — | the same shape, `configured: false` |
| `GET /api/settings/provider/models` | — | `{ models, source }`, live from the provider |

**`health` was added in Phase 13** and is additive — every earlier field keeps its meaning. It is
an array of what *this instance* has observed of each model, healthiest first:

```ts
{ model, state, failures, openUntil, openings, lastStatus, lastError,
  lastLatencyMs, lastSuccessAt, lastFailureAt, successes, totalFailures }
```

`state` is `healthy` \| `degraded` \| `unavailable` \| `unknown`. **It is per process and empty on
a cold instance**, which is honest rather than a bug: health here is observed from real traffic,
never configured, and an instance that has made no model call knows nothing yet. A client must
treat an empty array as "no information", never as "everything is fine".

`source` is `user` \| `environment` \| `none` — whether a run would use the user's own key or the
server's development fallback. Surfaced deliberately: a demo silently running on
`GOOGLE_GENERATIVE_AI_API_KEY` would make the whole feature look tested when nobody's key had ever
been exercised.

**A failed check distinguishes two cases, and the status code is the contract** (Phase 13):

| What happened | Code | Status | Meaning |
|---|---|---|---|
| 400/404 from the provider | `invalid_request` | 400 | This key cannot run that model. Change the choice |
| **429/503** from the provider | `conflict` | 409 | The model is fine and the request was throttled. **Nothing was changed.** Retry |

Reporting the second as the first sends a user to change a setting that was correct — which is
exactly what happened before Phase 13, because `gemini-3-flash-preview` allows 20 free-tier
requests a minute.

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
| `core.schedule_trigger` | a cron slot comes due and its timer is delivered (Phase 26; the daily sweep catches a lost one) | `{ firedAt, cron, scheduledFor }` |

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
else's behalf. This is the one query in the codebase not scoped by `workspaceId` — the workspace
comes *out* of the row it finds, through `systemScope`, so a webhook cannot reach another tenant.

Order of checks, and it matters — everything before the run is cheap, because this endpoint can spend
a user's model quota:

1. The token must match `/^[A-Za-z0-9_-]{16,64}$/`, checked **before** the database is touched.
2. The workflow must exist **and** its stored graph must hold a webhook trigger. Both failures answer
   the same `404 "No webhook is registered at this URL."` — whoever holds the token learns nothing
   from the difference.
   - **Then the active switch (Phase 26).** A switched-off workflow answers **`409 conflict`** and
     writes nothing. Not 404, because the URL is right and "check your URL" is the wrong instruction;
     not 503, because nothing is unavailable and a sender that retries 5xx would retry for days.
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

### The active switch — **Phase 26**

`workflow.active`, default `true`. It governs only what runs a workflow **by itself**:

| | Switched off | Switched back on |
|---|---|---|
| Webhook | `409 conflict`, no run written | accepts again |
| Schedule | `scheduleNextAt` cleared, so nothing is due and any armed timer is declined as stale | `scheduleNextAt` recomputed **from now** and a timer armed. Slots missed while off are **not** caught up |
| Manual run | still works | still works |

Changed with `PATCH /api/workflows/:id { "active": false }`, `editor`. Not a version — like
visibility, it is a fact about the present, not about what the workflow is.

### Schedule timers — **Phase 26**

**A schedule fires when a Cloud Tasks task armed for its due time is delivered.** The task is armed
when the workflow is created or saved with a due time that has no timer, when it is switched on, and
by the firing itself for the next slot. `workflow.scheduleArmedFor` records the slot a timer was
created for; **the schedule is armed exactly when it equals `scheduleNextAt`**, so a save that moves
the due time disarms it with no second write. It records that a task was *created*, not that it still
exists — which is why the daily sweep re-arms anything due within 26 hours regardless.

**The D42 rule changed in one word.** When the expression is unchanged the stored due time is still
kept — but "kept" now means **the save does not write the column at all**. Writing back the value
the save had read is the same thing unless a timer claims the slot in between; then the save would
put the fired slot back and it would fire twice.

### `POST /api/cron/fire` — a timer's delivery, with no session

Two gates, as the dispatch route has (D82): `CRON_SECRET`, then `token` — an HMAC-SHA256 over
`(workflowId, scheduledFor)` keyed by `AUTH_SECRET`, pattern-checked (43 base64url characters)
before anything else. It authorises **one slot of one workflow**. Then, cheapest first:

| Outcome | When | Effect |
|---|---|---|
| `declined` / `forged` | the token does not verify | nothing; no query beyond none |
| `declined` / `gone` | the workflow no longer exists | nothing |
| `declined` / `stale` | switched off, or `scheduleNextAt` is no longer this slot | **zero runs** |
| `rearmed` | the slot is current but not yet due (beyond the horizon, or a clock) | a new timer |
| `fired` | due: claimed by compare-and-set, a **durable** run started, the next slot armed | one run |
| `skipped` / `cleared` | lost the claim to another delivery / the schedule trigger is gone | as in the sweep |

Always `200`, so Cloud Tasks never retries a decline. Every delivery is logged as
`schedule.delivered` with its outcome.

### `POST /api/cron/tick` — the second route with no session

Guarded by `CRON_SECRET` in the `x-cron-secret` header (`Authorization: Bearer` is also accepted),
compared in **constant time** — this endpoint acts across every owner, so a `===` leaking the
secret's length and prefix is not acceptable. Anything without the secret is `401`, and a signed-in
session is **not** a substitute: it is a machine endpoint. POST only.

Each tick selects at most `MAX_FIRES_PER_TICK` (25 since Phase 17; it was 3) **active** workflows
whose `scheduleNextAt` is due, ordered by due time, then for each one:

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

Response: `{ checkedAt, due, fired: [{ workflowId, runId, status, scheduledFor, queued }], skipped,
cleared, armed, woken, swept, pruned }`. Runs are attributed `trigger: "schedule"` and receive
`{ scheduledFor, firedAt, cron }` as input.

**Since Phase 26 this is a daily safety sweep, not the clock.** On top of firing what is due (now
only slots whose timer was lost), it arms every unarmed schedule and every schedule due within 26
hours (`armed`), re-schedules the wake of any `waiting` run more than ten minutes past `wakeAt`
(`woken`), sweeps abandoned runs and prunes the audit log.

The bound was 3 while runs were synchronous and in-process — the tick held its request open for the
sum of its runs, and three at the engine's 120 s ceiling was 360 s inside the job's 540 s deadline.
**Corrected in Phase 26, where this paragraph was found stale:** Phase 17 made scheduled runs durable,
so the tick only enqueues and the bound became 25. Anything still due stays due.

**Tick cadence is a cost decision, recorded in `DEPLOYMENT.md`:** once a day since Phase 26 (every
15 minutes before it). A cron expression's resolution is no longer the tick interval: a timer fires
at its slot, plus a cold start when the service is asleep.

## Integration nodes and their credentials — **DEFINED** (Phase 9, extended in Phase 23B)

Nine integrations, nine registry entries. Nothing else was added: no palette code, no config form,
no validator rule, no second tool list. `src/lib/integrations/` holds the protocol modules (no
database, no session — so they are asserted with no network) and `store.ts` holds the one module
that reads credentials.

| Node type | What it does | Agent-callable | Credential |
|---|---|---|---|
| `integration.http` | One HTTPS request, response into workflow data | **yes** | none |
| `integration.discord` | Posts a message to the connected channel | **yes** | `integration.discord` |
| `integration.sheets` | Appends one row to a Google Sheet | **yes** | `google.oauth` |
| `integration.gmail` | Sends one email as the connected account | **no** | `google.oauth` |
| `integration.slack` | Posts a message to the connected channel | **yes** | `integration.slack` |
| `integration.notion` | Appends to a page, or adds a database row | **yes** | `integration.notion` |
| `integration.github` | Files an issue, or comments on one | **yes** | `integration.github` |
| `integration.airtable` | Creates a record, or reads a page of them | **yes** | `integration.airtable` |
| `integration.postgres` | Reads rows from a Postgres database, or counts them. **Cannot write** | **yes** | `integration.postgres` |

**`integration.postgres` is the only node that speaks a protocol other than HTTPS** — Phase 23C,
and the reason it needed a phase of its own. Three things follow and all three are contract:

- **It is read-only by construction, and there is no SQL field.** A caller supplies a schema, a
  table, column names, an enumerated comparison and a limit; `buildSelect` assembles the only
  statement it knows how to write. Phase 23A's rule is unchanged — **no expression language,
  ever** — and a config field that accepted SQL would be arbitrary code execution under another
  name. The table is **always schema-qualified**, because an unqualified name is resolved through
  a `search_path` that a connection string can set
- **Its operators are the seven `core.branch` and `transform.filter` use**, translated to SQL to
  match `evaluate()`'s own semantics rather than approximately — `equals` casts to text because
  `evaluate` compares strings, `not_equals` is `is distinct from` so a NULL row is not silently
  dropped, `contains` is `strpos` because `LIKE` would make a `%` in a value a wildcard. The one
  deliberate divergence: `greater_than` and `less_than` compare using the **column's own type**,
  so they work on dates and text as well as numbers, which the in-process pair cannot
- **Its output follows Phase 23A's list convention**, `{ items, count }`, so `transform.filter`,
  `.sort` and `.aggregate` chain onto it with nothing in between

### The token-credential registry — **Phase 23B, extended in Phase 23C**

Phase 9's note on `nodes/integration/shared.ts` said it existed "so a fifth integration is a node
file and nothing else". That was true of the node and false of everything around it: Discord needed
its own API route, its own hand-written `ROTATION_RULES` entry, its own settings card and its own
three client methods. **`src/lib/integrations/tokens.ts` is the table that makes the original claim
true**, and everything derivable from it is derived:

| Derived | Where | Why it matters |
|---|---|---|
| `ROTATION_RULES` entries | `credentials/rotation.ts` spreads the table | Phase 21's obligation cannot be forgotten, because there is nowhere to forget it |
| The connect/revoke route | one dynamic `/api/integrations/[service]` | not four near-identical files |
| The settings cards | `TokenIntegrationCard`, rendered from the table | the component names no service |
| The vault entry | already derived from `ROTATION_RULES` | unchanged |

**Membership in that table is a criterion, not a convenience:** *a bearer secret the user can paste,
which one HTTPS request can prove.* Discord and Google are deliberately outside it — Discord's
status carries provider-supplied metadata this shape has no room for, and an OAuth refresh token is
something nobody can type, which is what `RotationRule`'s `reconnect` mode exists for. Bending
either in would make the table about its exceptions.

**`secretLabel` and `secretNoun` are two fields on purpose.** The first is a sentence-case input
label, the second a lower-case noun phrase for mid-sentence use. The first version derived the
second with `.toLowerCase()` and shipped "Slack incoming webhook url" into the vault: lower-casing a
string is wrong exactly as often as the string holds an acronym.

### Why Gmail is closed to the agent — **D44**

D19's default is `false` and every exception is argued. `core.branch` and `core.assert` were closed
in Phase 6 (D36) for much less than this.

The other three integrations act inside something the user owns: their channel, whose address is
fixed by the stored credential and is not in the config at all; their spreadsheet; an API they
named. A sent email leaves the account, reaches a third party, and **cannot be recalled**. Made
agent-callable, the recipient *and* the body would both be chosen by a model reading text that
arrived on an unauthenticated webhook endpoint — which is a "send mail as this user to anyone"
primitive, obtained by typing a sentence into a form.

`DEMO.md` needs nothing from it: Beat 8 is Discord and Sheets. It is still a first-class node that
an author places and wires, with its recipient visible in the graph. Flipping the boolean is a
one-line change; the reasoning lives on the definition so that it is re-made deliberately.

This is a **deliberate deviation** from `BUILD_PLAN.md` Phase 9's wording, which says all four are
available to the agent. Recorded rather than quietly passed over.

### The outbound guard on `integration.http` — **D45**

`BUILD_PLAN.md` says the HTTP node is not an agent escape hatch. `src/lib/integrations/guard.ts` is
what makes that true rather than aspirational, because `agentCallable: true` means a model chooses
the URL.

1. **Public addresses only.** Loopback, `0.0.0.0/8`, RFC 1918, `169.254.0.0/16`, CGNAT
   (`100.64.0.0/10`), benchmarking, multicast and broadcast are refused, as are `::`, `::1`,
   `fc00::/7`, `fe80::/10` and `ff00::/8` — **including the IPv4-mapped and NAT64 forms**, because
   `::ffff:169.254.169.254`, `::ffff:a9fe:a9fe` and `64:ff9b::a9fe:a9fe` are all the metadata
   server. `localhost`, `metadata.google.internal` and the `.internal` / `.local` / `.localhost`
   suffixes are refused by name before any lookup, and a trailing dot does not escape that.
   The rule is **every** resolved address must be public, not *any*: a name answering with one
   public and one loopback address would otherwise pass and then be connected to whichever `fetch`
   picked.
2. **https only.** This is the rule that actually matters on Cloud Run.
   `http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token` is one GET
   from a Google access token for this service's own identity, and the response would land in a step
   output. Rule 1 refuses it by address, but rule 1 checks DNS and `fetch` resolves again — a name
   answering publicly once and privately next time (DNS rebinding) defeats it. Requiring TLS closes
   the path properly, because the metadata server has no certificate.
3. **Redirects are reported, never followed.** Following one re-resolves a host the guard already
   cleared, handing the checked address to whoever controls the redirect. A 3xx returns
   `output.redirectedTo` and a warning on the step.
4. **Credentials in the URL are refused.** They belong in a header.

Not claimed: resistance to a valid certificate for a name resolving into a private range. There is
no VPC connector on this service, so there is nothing private to reach; pinning the resolved address
into the connection is post-hackathon.

`failOnError` defaults to **true** — a non-2xx fails the step carrying the API's own message. An
author who wrote an explicit API call wants a 404 to stop the run, not to succeed carrying an error
page as data. Set it false to route on `output.ok` instead.

### Credential kinds

`credential` gains two kinds alongside Phase 6's `llm.google`. The table, the envelope and the
write-only rule are unchanged — see *Credential storage shape*. **No new environment variable:**
the Google flow reuses `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `APP_BASE_URL`.

| `kind` | `label` | Secret | `metadata` |
|---|---|---|---|
| `integration.discord` | `default` | the webhook URL | `{ webhookName, channelId, guildId }` |
| `google.oauth` | `default` | the **refresh** token | `{ email, scopes: string[] }` |
| `integration.slack` | `default` | the incoming webhook URL | `{}` — see below |
| `integration.notion` | `default` | the internal integration secret | `{ botName, workspaceName }` |
| `integration.github` | `default` | the personal access token | `{ login }` |
| `integration.airtable` | `default` | the personal access token | `{ userId, email }` |
| `integration.postgres` | `default` | the whole connection string | `{ serverVersion }` — see below |

**Postgres stores only a server version, and that is the same rule as Slack's, reached from the
other direction.** The two facts a card would most like to show — the host and the database name —
are both *inside the connection string*, which is the secret, so neither may become metadata
however non-secret a hostname feels. The server's version number is the one identifying fact that
belongs to the server rather than to the string. `verify-postgres.mjs` asserts that no status
response contains the password, the host, the role or the database name.

**The criterion for membership in the token registry widened by one word in Phase 23C**, and it is
worth saying which. It read "a bearer secret the user pastes, which one HTTPS request can prove";
a connection string is proved over a TLS socket speaking a binary protocol. Nothing in the table's
shape was ever about the transport — not `schema`, not `verify`, not `detail` — so the criterion
was narrower than the mechanism, and the fifth member is what made that visible. It now reads:
**one secret string the user pastes, which one round trip to the service can prove.** What still
excludes Google is unchanged and is not about transport either: there is nothing for a user to
paste.

**Slack stores no metadata, and that is the write-only rule holding rather than a gap.** Every
identifying part of an incoming webhook — the team id, the hook id — is a path segment *of the
secret*, and Slack publishes no endpoint that describes one. There is therefore nothing to store
that would not be a fragment of key material, so the settings card says "Connected" and stops. The
other three report what their own API volunteers about the credential and nothing more.

**The Discord webhook URL is the credential**, not a setting: it carries its own bearer token in its
path, so anyone holding it can post. It is therefore encrypted at rest and never in a graph — D41's
rule a second time, since the graph is exactly where the generator writes.

**The stored Google secret is the refresh token, not an access token.** Access tokens last an hour,
which is shorter than the gap between setting a demo up and giving it — `BUILD_PLAN.md` calls an
expired token mid-demo the likeliest live failure. An access token is fetched per node execution and
deliberately **not cached**: one round trip is ~200 ms against a 120 s run budget, and a cache would
need invalidating on disconnect and reconnect, where a cache still serving a removed credential is a
worse failure than a slower node.

`metadata.scopes` records what Google **granted**, not what was asked for, because the consent screen
lets a user untick an individual scope. Every Google-backed node checks its own scope before calling,
so a Sheets-only connection tells the user to reconnect instead of producing a 403 from inside a run.

### Routes

| Route | Body | Returns |
|---|---|---|
| `GET /api/integrations/discord` | — | `{ configured, webhookName, channelId, updatedAt }` |
| `PUT /api/integrations/discord` | `{ webhookUrl }` | the same shape |
| `DELETE /api/integrations/discord` | — | the same shape, `configured: false` |
| `GET /api/integrations/google` | — | `{ connected, email, scopes, canAppendSheets, canSendMail, updatedAt }` |
| `DELETE /api/integrations/google` | — | the same shape, `connected: false` |
| `GET /api/integrations/google/connect` | — | `302` to Google, sets the state cookie |
| `GET /api/integrations/google/callback` | — | `302` to `/settings?google=<code>` |
| `GET /api/integrations/:service` | — | `{ slug, kind, service, configured, detail, updatedAt, … }` |
| `PUT /api/integrations/:service` | `{ secret }` | the same shape |
| `DELETE /api/integrations/:service` | — | the same shape, `configured: false` |

`:service` is the registry **slug** — `slack`, `notion`, `github`, `airtable` — never the credential
kind, which would make the path read `/api/integrations/integration.slack`. A slug the table does not
hold is a **404**, and so is a prototype key: the lookup is a `Map`, so `/api/integrations/__proto__`
cannot resolve to something off `Object.prototype`. All three are asserted over HTTP against the
deployed service by `verify-api.mjs`, because that class of bug is invisible to a unit test that
imports the table directly.

**A static segment takes precedence over the dynamic one**, so `/api/integrations/discord` still
reaches `discord/route.ts` and this route never sees it. That is documented for the Pages router and
merely conventional for the App router, so `verify-integrations.mjs` asserts it against the deployed
build rather than trusting it.

Write-only on the same terms as the provider key: **no response carries the webhook URL, any part of
it, the refresh token, or an access token.** A webhook is proved against Discord before it is stored
(the same rule Phase 6 set for a provider key), and the channel name it returns is what lets the UI
show *which* channel is wired up without the user trusting that they pasted the right URL.

### Incremental authorisation — **D46**

Sign-in asks for identity and nothing else. The Sheets and Gmail scopes are requested the first time
the user connects, through a flow this app owns end to end:

- `scope` is `…/auth/spreadsheets …/auth/gmail.send`, both in one consent screen.
- `access_type=offline` **with** `prompt=consent` is what returns a refresh token. Google omits
  `refresh_token` for a user who has already granted the scopes when `prompt` is absent — leaving a
  connection that works for exactly one hour and then fails inside a run. `storeGoogleConnection`
  therefore **refuses** a connection with no refresh token rather than storing a one-hour one.
- `include_granted_scopes=true` keeps what sign-in already holds instead of replacing it.
- Not done through Auth.js: it does not re-persist account tokens on a later sign-in, and widening
  the sign-in provider's scopes would put "Send email on your behalf" in front of every visitor
  before they had built anything.

**The callback's `state` is a CSRF control, not decoration.** It is a `GET` a third party can cause a
signed-in browser to make, so without it an attacker could deliver *their* authorization code and
have the victim's account store a refresh token for the attacker's Google account — after which
every appended row and every sent mail goes to the attacker. The state is 24 bytes of CSPRNG in a
`HttpOnly`, `SameSite=Lax`, path-scoped, 10-minute cookie, compared in constant time.
`SameSite=Lax` is required rather than chosen: the callback is a cross-site top-level navigation, and
`Strict` would withhold the cookie and break every attempt.

Every outcome is a redirect carrying a **fixed** code — `connected`, `denied`, `state`, `failed` —
never Google's own words and never anything from the query string, so nothing reflected can reach the
page. The settings page maps the code to its own text. This is the one authenticated route that
cannot answer a JSON envelope: the caller is a browser mid-navigation.

### Two fields are deliberately allowed to be empty

`integration.sheets.spreadsheetId` and `integration.gmail.to` have no minimum length. A request like
"log every one to my Google Sheet" (`DEMO.md` Beat 2) names no spreadsheet, so a `min(1)` would force
the model either to invent an id — a valid graph pointing at a stranger's document — or to fail the
whole generation. Empty is the honest third answer: the workflow generates, appears on the canvas
with a visibly blank field, and each node fails with its own sentence if run before it is filled in
("This node has no spreadsheet yet…"). `integration.http.url` is **not** in this category: a URL is
not something the user can supply from context later, so an absent one is rejected at validation.

---

## Design token names — **DEFINED** (Phase 14; two themes since Phase 27)

A contract because **every UI phase from 15 onward names these tokens**, and because a token that
quietly changes meaning breaks screens nobody touched in that session. The values may be tuned; the
**names and the register rule** may not drift without updating every consumer in the same session.

The full language is `DESIGN.md`. The live reference is `/design`. This section is the part that
must not move.

### The register rule

Every chromatic token exists twice:

| Name | Register | May be used as |
|---|---|---|
| `--color-x` | text | Text on any surface, and small graphics. **The default** |
| `--color-x-pop` | fill | A background **only**, with `--color-accent-ink` as its label, inside a `line` outline |

`text-accent` is correct; `text-accent-pop` is a bug. This holds for `accent`, the four status tones
and all five node categories.

### The names

| Group | Tokens |
|---|---|
| Surfaces | `canvas` `surface` `elevated` `sunken` |
| Ink and line | `ink` `muted` `faint` `line` (+ `line-soft`, alpha) `shade` `scrim` — the last two added in Phase 27 |
| Accent | `accent` `accent-pop` `accent-ink` `spark` |
| Status | `ok` `live` `warn` `bad`, each with `-pop` |
| Categories | `cat-trigger` `cat-agent` `cat-logic` `cat-transform` `cat-integration`, each with `-pop` |

`--color-accent-ink` is the label colour for **any** pop fill, not only the accent's. **Since Phase 27
every pop-fill label names it** rather than `ink`: the two are equal in Light and different in
Night, where `ink` is cream and the label stays near-black.

**What each ink role means — Phase 27 split them (D121), and a name may not change job:**

| Token | Job | Light | Night |
|---|---|---|---|
| `ink` | Body text, and the focus ring | near-black | cream |
| `accent-ink` | The label on a pop fill | near-black | near-black |
| `line` | The outline | near-black | cream |
| `shade` | The hard shadow — every `--shadow-*` draws in it | near-black | cream |
| `scrim` | A modal's backdrop, used translucent | near-black | deeper near-black |

### Themes

Every `--color-*` token has a value in each theme, and both are part of the contract:

| | Light | Toybox Night |
|---|---|---|
| Declared in | `@theme` | `:root { @variant dark { … } }` |
| Applies when | always, by default | `<html data-theme="dark">`, or `data-theme="system"` with `prefers-color-scheme: dark` |
| `color-scheme` | `light` | `dark` |

**The theme contract**, shared by the stylesheet, `src/lib/ui/theme.ts` and the tests:

| Name | Value | Why it cannot drift |
|---|---|---|
| `<html data-theme>` | `light` \| `dark` \| `system` | The stylesheet's `@custom-variant dark` matches these exact values; `tokens.test.ts` pins them |
| `localStorage` key | `agentforge:theme` | A reader's stored choice. Renaming it silently resets every reader to Light |
| Default | `light` | D110: Light even on a dark device. An absent, blocked or unknown value is Light |
| `dark:` variant | this project's, not Tailwind's | Follows `data-theme`; Tailwind's built-in follows the OS alone |

### Invariants the build enforces

`src/app/tokens.test.ts` fails the build on any of these, so they are properties rather than advice:

| Invariant | Why it exists |
|---|---|
**Per theme** — each runs once against Light and once against Toybox Night:

| Invariant | Why it exists |
|---|---|
| Every text-register tone clears **AA on all four surfaces** | The phase's own implementation note: saturated-on-cream is where AA fails |
| `accent-ink` clears **AA on every `-pop` fill** | A fill's label is always `accent-ink` — never white, never cream |
| The registers stay **2× apart in luminance** — fill the brighter in Light, text in Night | Stops the two collapsing into one ambiguous token |
| `ink` clears **3:1 on every surface and every fill** | Makes one focus ring legal everywhere (WCAG 2.2 SC 1.4.11) |
| The **outline** clears 3:1 on every fill and every surface, and some object is flat against the page | The outline carries the separation, not the lightness |
| The **shadow** clears 3:1 on every surface; the scrim is darker than the page | A shadow nobody can see is no thickness; a backdrop must recede |
| Every token is **inside sRGB** | A clamped channel means the rendered colour is not the measured colour |
| `palette.ts` and `globals.css` **agree in both directions** | The catalogue is a mirror, never a second source of truth |

**Across both themes:**

| Invariant | Why it exists |
|---|---|
| Night re-declares **every** colour token Light declares, and none is declared elsewhere | A forgotten token keeps its Light value on an indigo page, unmeasured |
| `color-scheme` is **`light`** on `:root`, **`dark`** in the Night block, and nowhere else | Native widgets otherwise render in the other theme |
| Every `--shadow-*` is a **hard offset in `shade`, no blur**, declared once | A blur turns Toybox into generic material elevation |
| The `dark` variant matches `data-theme`, and the OS only under `system` | Light is the default even on a dark device (D110) |
| The select chevron's stroke is each theme's ink | A data URI cannot read a CSS variable |
| **Every colour utility in `src/` compiles to CSS** (`utilities.test.ts`, D124) | A class naming a missing token builds to nothing, silently |
| `public/illustrations/*.svg` match a fresh export | Baked-in hex goes stale silently |

### Consumers

`src/app/globals.css` (declaration, both themes), `src/lib/design/palette.ts` (mirror + roles),
`src/lib/ui/theme.ts` (the theme contract and the `<head>` script),
`src/components/ui/*` (primitives), `src/components/canvas/context.ts` (`CATEGORY_STYLE`,
`STATUS_STYLE` — still the only domain-concept-to-colour mapping, D49), `src/app/design/*` (gallery),
and every Chapter 1 screen through the `@utility` classes.

**Adding a tone means adding both registers and a catalogue entry**, or CI fails on the drift gate.

---

## Observability and analytics — **DEFINED** (Phase 22)

### The log entry

Every line the product writes is one JSON object on stdout. **The reserved names are Cloud
Logging's, not this project's** — a typo in one silently demotes it to an ordinary payload field
that no filter and no alerting policy will ever see.

```ts
{
  severity: "INFO" | "WARNING" | "ERROR",
  message: string,                              // the collapsed line
  event: EventName,                             // the catalogue below
  "logging.googleapis.com/trace"?: string,      // Cloud Run's trace, when there is one
  "logging.googleapis.com/labels": { event },   // indexed; what every metric filters on
  userId?, workspaceId?, runId?, workflowId?,   // from the ambient context
  ...fields                                     // scalars only
}
```

**`src/lib/logging/events.ts` is the catalogue, and it is contract.** A log-based metric is a
filter string living in a GCP resource with nothing connecting it to this repository, so a renamed
event leaves its metric reporting zero forever — indistinguishable from a healthy system.
`logging.test.ts` asserts that the four names the metrics in `OPERATIONS.md` depend on still exist.

| `event` | Emitted when | Load-bearing fields |
|---|---|---|
| `run.started` | A run row is created | `trigger`, `mode`, `workflowVersion` |
| `run.finished` | **A run reaches a terminal status** | `status`, `durationMs`, `attempt`, `resumed` |
| `node.finished` | **One node finishes** | `nodeId`, `nodeType`, `status`, `durationMs` |
| `model.call` | **A `generate` resolves** | `requested`, `answered`, `fallback`, `attempts` |
| `queue.degraded` | A durable run could not be enqueued | `reason` |
| `queue.delivered` | A Cloud Tasks delivery is handled | `handled`, `status`, `retryCount` |
| `cron.tick` | The scheduler fires, **including when nothing is due** | `due`, `fired`, `skipped`, `cleared` |
| `api.error` | A request throws unexpectedly | `errorGroup`, `errorName` |
| `system.warning` | A refusal or repair nobody asked for | varies |

**Three rules a later phase must not break:**

1. **`run.finished` is emitted once per terminal outcome and never for a preemption.** A preempted
   run is still executing in another worker, which will emit its own; counting it here would
   double the volume metric and put a run with no status in neither bucket. Preemption is a
   `system.warning`.
2. **An `ApiError` is never logged.** A 404 for another workspace's workflow is the authorisation
   layer working, not a fault, and logging thousands of correct refusals at ERROR buries the real
   ones.
3. **No payload, prompt, completion, secret or ciphertext is ever a field.** Ids, registry names,
   statuses, counts and durations only.

### Error groups

`errorGroup` is eight hex characters of SHA-256 over a normalised template
(`src/lib/logging/fingerprint.ts`). **The same function produces the groups in the logs and the
groups on the analytics page** — that is what makes an id read off a chart paste-able into the Logs
Explorer, and it is the reason the module lives under `logging/` and is imported by `analytics/`
rather than being reimplemented there.

### `GET /api/analytics`

| Route | Needs | Query | Returns |
|---|---|---|---|
| `GET /api/analytics` | `viewer` | `range` ∈ `7 \| 30 \| 90`, default **30** | `Analytics` |

An unrecognised, absent or hostile `range` falls back to 30 rather than erroring — the window is a
bound on a query, so an unparsed value must never widen it.

```ts
interface Analytics {
  range, from, to,                        // the window, so a reader knows what "30 days" meant
  totals: { runs, succeeded, failed, cancelled, settled, successRate, medianMs, p95Ms },
  days:     DayBucket[],                  // one per day in the window, zeros included
  failures: FailureGroup[],               // distinct failures, most frequent first, capped at 8
  nodes:    NodeStat[],                   // per node type, capped at 10
  models:   ModelStat[],                  // by the model that ANSWERED, capped at 8
  queryMs,                                // what this page cost, reported on the page itself
}
```

**Four meanings that are contract, not implementation:**

- **`successRate` is `succeeded / settled`, and `settled` includes cancelled.** A cancellation is a
  run that did not do what it was asked to; excluding it would let a workspace that cancels half
  its runs report a perfect record. A run still in flight is in neither.
- **`successRate` is `null`, never `1`, when nothing has settled.** A workspace with no history has
  no success rate, and a fabricated 100% is the first number a new user would see.
- **Percentiles are nearest-rank**, so `p95Ms` is a duration that actually occurred. With eleven
  runs in a window — the realistic case here for some time — an interpolated p95 invents a latency
  no run ever took, and somebody eventually goes looking for it.
- **`models` is keyed by the model that answered, not the one requested.** After a fallback those
  differ, and the one that answered is the one that spent the quota.

`days` is filled for every day in `[from, to]` including the empty ones. A chart built only from
days that have rows draws a dense, healthy-looking week out of two runs three days apart.

**Scoping is doubled**, by workspace and by `visibleWorkflows`, on all three queries — the same rule
`getRun` and `listRuns` carry, for the same reason: a run names its workflow, so a viewer with no
access to a private workflow must not learn its failure rate from an aggregate.

### `GET /api/health` — extended, and the extension is additive

Phase 22 rewrote this route. **Every field the earlier suites assert on kept its name and meaning**,
because `verify-api.mjs`, `verify-durable.mjs`, `verify-vault.mjs` and `DEPLOYMENT.md` all read it:
`database`, `databaseLatencyMs`, `queue.configured` (Phase 17), `rootKey.provider` (Phase 21) and
`revision` are unmoved.

Added: `checks[]`, `migrations` and `registry`.

```ts
{ status: "ok" | "degraded" | "error",
  checks: { name, status: "ok" | "degraded" | "error", latencyMs?, detail? }[],
  migrations: number | null,   // what the database has applied
  registry: number }           // node types loaded
```

| `status` | HTTP | Meaning |
|---|---|---|
| `ok` | 200 | Everything a production deployment should have |
| `degraded` | **200** | Serving correctly, with a guarantee quietly missing |
| `error` | 503 | The database is unreachable |

**`degraded` answering 200 is the contract**, not an oversight: failing a health check would take a
working revision out of service over a configuration warning. An uptime check pages on 503; a human
reads `checks` for `degraded`. A developer machine with no Cloud Tasks and no Secret Manager is
*correctly* `degraded`, which is what makes the verdict worth having.

`detail` says what to do and never what a value is. The route is unauthenticated, so every field
added here is added to the public internet — the test for a new one is whether it helps an operator
more than it helps somebody mapping the system.
