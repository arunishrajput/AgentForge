# 0004 — No queue; the executor runs in-process

**Status:** **Superseded** by [0005 — Durable runs on Cloud Tasks](./0005-durable-runs-on-cloud-tasks.md)
· **Date:** 2026-09-25 · **Phase:** 3 · **Superseded:** 2026-09-27, Phase 17

> This record is kept, not rewritten. The analysis below was **correct for what was being
> built**, and what changed was the product rather than the reasoning. That is the most useful
> thing an ADR directory can preserve, so it is preserved verbatim in substance.

## Context

A workflow engine conventionally has a queue and a worker: a run is enqueued, a separate process
picks it up, and the web tier returns immediately. The reference architecture is Redis plus
BullMQ plus a worker service.

Against that, three constraints:

- The deployment unit is **one Cloud Run container** ([0001](./0001-harvest-not-fork.md))
- The budget is **strictly zero**. Redis has no free tier that survives a month
- The runs being built for were **short and user-initiated** — somebody presses Run and watches
  it happen

## Decision

No queue. The execution engine runs in the web container, in the request that started the run.

## Consequences

**What it bought.** No service, no dependency, no deploy complexity, and no extra failure mode —
four costs avoided to buy durability that a demo did not need. `POST /runs` could answer with the
finished run and every step, which is the shape the canvas and every verification script read.

**What it cost, stated at the time as a carried risk:** *in-flight runs die on redeploy.*

**Why it stopped being right.** Two clauses of the justification expired when the product grew
past a demo:

1. **"Runs are user-initiated"** is false of a **scheduled** run. A workflow firing at 03:00 has
   nobody watching and nobody to press Run again.
2. **"The demo does not need durability"** stopped being the question once there were users
   rather than judges. "In-flight runs die on redeploy" is not something to ask a real user to
   live with.

Note what did *not* change: the analysis of what a queue costs was accurate. Phase 17 did not
conclude that Redis and a worker were affordable after all — it found a queue that costs none of
the four things this ADR was avoiding. See [0005](./0005-durable-runs-on-cloud-tasks.md).

## Alternatives

| Rejected at the time | Why |
|---|---|
| **Redis + BullMQ + a worker service** | A second service and a paid dependency. Fails the zero-cost ceiling outright |
| **Postgres-as-a-queue with `SKIP LOCKED`** | No new infrastructure, but still needs something to *poll* it, and a container that scales to zero cannot poll |
| **In-process timers for scheduled runs** | Cloud Run scales to zero, so `setInterval` does not fire. Cloud Scheduler was adopted instead, in Phase 8 |
