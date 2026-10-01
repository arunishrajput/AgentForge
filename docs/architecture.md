# Architecture

**One container, one database.** No worker, no broker, no second service. That is not a
simplification made for a demo — it is the constraint the whole design is bent around, because
the project has a hard zero-cost ceiling and a free tier is what one container and one database
fit inside.

This page is the orientation. [`../ARCHITECTURE.md`](../ARCHITECTURE.md) is the exhaustive
version — every decision, every rejected alternative, and what each one costs. The decisions
that have outlived their phase are extracted as [ADRs](../adr/).

---

## The picture

```
                        Browser
            ┌───────────────────────────────┐
            │  Canvas (React Flow)          │
            │  Natural-language prompt      │
            │  Live run view (SSE)          │
            └──────────────┬────────────────┘
                           │ HTTPS + SSE
        ┌──────────────────▼──────────────────────────┐
        │   Cloud Run — one container, scales to zero │
        │                                             │
        │   ┌─────────────────────────────────────┐   │
        │   │ Web / API                           │   │
        │   │  auth · workflows · runs · stream   │   │
        │   │  webhook · cron tick · dispatch     │   │
        │   └────────────┬────────────────────────┘   │
        │                │                            │
        │   ┌────────────▼────────────┐  ┌──────────┐ │
        │   │ Execution engine        │──│   Node   │ │
        │   │  resumable DAG walker   │  │ registry │ │
        │   └────────────┬────────────┘  └────┬─────┘ │
        │                │                    │       │
        │   ┌────────────▼────────────┐       │       │
        │   │ Agent layer             │───────┘       │
        │   │  provider adapter       │ tools ARE     │
        │   │  bounded tool loop      │ registry rows │
        │   └────────────┬────────────┘               │
        └────────────────┼────────────────────────────┘
                         │
        ┌────────────────┼──────────────────┬──────────────────┐
        ▼                ▼                  ▼                  ▼
  Neon Postgres    Gemini · Groq    Slack · GitHub ·    Cloud Tasks
   (pooled)                          Sheets · Gmail ·   (durable runs)
                                     Notion · Airtable ·
                                     Postgres · any HTTP

  Cloud Scheduler ──▶ POST /api/cron/tick     (schedule triggers)
```

---

## The registry is the spine

If you read one thing about how this is built, read this one.

A node is **one object** carrying its type, its label, the description the *model* reads, its
config schema, its outputs, and its execute function. That single object feeds three consumers:

| Consumer | Reads |
|---|---|
| The **engine**'s dispatch table | `kind`, `configSchema`, `execute` |
| The **canvas** palette and config forms | `label`, `category`, `outputs`, `configSchema` |
| The **agent**'s tool set | `description`, `configSchema`, `agentCallable` |

So adding an integration widens what the agent can do, what the generator can produce, and what
the palette offers — in one place, with no drift. Phase 23C added the Postgres node and wrote
**no route, no settings card, no rotation rule and no vault entry**, which is the claim being
tested rather than asserted.

It is also the security boundary: the agent can reach registry entries and nothing else.

One caveat, recorded because the looser version was nearly written: registering a node is not
*always* enough. Phase 9 had to edit the generation prompt's surrounding prose, which named
specific capabilities as unsupported. **A prompt that names specifics dates like code, and
nothing type-checks prose.**

Generated reference: [node reference](./nodes.md) · How agents use it: [agents](./agents.md)

---

## The execution engine

Sequential, resumable, and indifferent to which process is running it.

1. A trigger creates a `run` row in `queued`
2. A worker **claims** it — a compare-and-set on a lease
3. Execution order is resolved **as it runs**, from the edges. A work list, not a static
   topological sort, because branch and loop outputs mean the order is only known as you go. A
   topological pass is still used for *validation*, to reject any cycle that does not close
   through a loop node
4. Each node writes a step record, resolves its config, executes under its retry and timeout
   policy, and emits an event
5. **One `UPDATE … RETURNING` checkpoints the frontier, extends the lease, and reads back
   whether a cancellation was requested.** One statement, because on a metered free database a
   separate per-step cancellation poll would double the cost of every run in the product
6. A run ends `succeeded`, `failed` or `cancelled` — **or the engine stops without writing a
   status at all**, because it lost its lease and the run belongs to someone else now

### Two modes

| Mode | Executed by | Survives a redeploy |
|---|---|---|
| `sync` | the request that started it | No |
| `durable` | a Cloud Tasks delivery | **Yes** |

`sync` exists because `POST /runs` answers with the finished run and all its steps — the canvas
Run button and every verification script read that shape, and a request that returns before the
run is over cannot have it. **Scheduled runs are always durable**, because nobody is watching at
03:00 and nobody will press Run again.

The lease is what makes at-least-once delivery safe: a duplicate delivery of the same task finds
the lease held and does nothing.

---

## Data

Neon Postgres, through Drizzle. The application uses the **pooled** endpoint; migrations use the
**direct** one, and they are not interchangeable.

Every workflow, run, version and credential belongs to a **workspace**, not to a person. One
funnel establishes a route's authority — see [API reference](./api.md) → *How a request is
authorised*.

Two storage decisions worth knowing:

- **Every save is a version.** Nothing has to be committed, a run records which version it
  executed, and restoring writes a *new* version rather than rewriting history
- **Secrets are envelope-encrypted.** Each credential has its own data key; the data key is
  wrapped by a versioned root key held in Secret Manager. Rotating the root key re-wraps the
  small keys **without decrypting a single secret**

---

## Realtime

Server-Sent Events, not WebSocket. One direction suffices, there is no affinity to configure,
and reconnection is native to the browser. The event names and payloads are a contract precisely
because a reconnecting client has to be able to rejoin a run already in flight.

---

## Observability

Logging is `console.log` of a JSON line. No client library, no exporter, no agent.

Cloud Run's runtime already turns a JSON line on stdout into a structured log entry, and an
exporter would add a dependency, a background flush, and a way to lose exactly the entries
written while a container is being recycled — which is when they matter most. The correlation id
is Cloud Run's own trace, so our lines join its request records for free.

Identical failures fold into one **error group** by a fingerprint the logs and the analytics page
share — two fingerprinters would mean a group id read off a chart could not be pasted into the
log explorer, which is the only thing that makes either useful.

[`../OPERATIONS.md`](../OPERATIONS.md) is the runbook.

---

## The shape of the dependency list

This project has very few dependencies, and each absence was a decision:

| Not installed | Instead | Why |
|---|---|---|
| An LLM SDK (`ai`, `@ai-sdk/google`) | One file of wire format over `fetch` | [ADR 0002](../adr/0002-no-llm-sdk.md) — four reasons, each found by calling the real API |
| A queue client | One authenticated `fetch` to Cloud Tasks | [ADR 0005](../adr/0005-durable-runs-on-cloud-tasks.md) |
| A test framework | Node's built-in runner | It works, it is fast, it costs nothing |
| ESLint | oxlint | 2 packages against 305 |
| A telemetry exporter | A JSON line on stdout | See above |
| A component library | Native elements plus `src/components/ui/` | Zero new dependencies; the native elements carry most of it |

The pattern is **package count**, deliberately. The one place it was overruled — the Postgres
driver — is written down with the measurement that overruled it, because hand-rolling
SCRAM-SHA-256 over TLS to avoid one dependency would have been the worse call.

---

## Read next

- [ADRs](../adr/) — the decisions, in standard form, with their consequences
- [`../ARCHITECTURE.md`](../ARCHITECTURE.md) — the full version, including
  *What is intentionally simplified, and what it costs*
- [`../CONTRACT.md`](../CONTRACT.md) — the interfaces that must stay stable
- [`../SECURITY.md`](../SECURITY.md) — the posture, and what is **not** claimed
