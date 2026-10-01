# 0005 — Durable runs on Cloud Tasks; the in-process path is kept

**Status:** Accepted · **Date:** 2026-09-27 · **Phase:** 17
· **Supersedes:** [0004 — No queue](./0004-no-queue.md)

## Context

[ADR 0004](./0004-no-queue.md) declined a queue to avoid four specific costs: a second service, a
new dependency, deploy complexity, and another failure mode. It carried one risk explicitly —
**in-flight runs die on redeploy** — and that was acceptable for a demo.

Two things made it unacceptable for a product. A **scheduled** run is not user-initiated and has
nobody to press Run again. And a real user cannot be asked to live with a run that vanishes
because somebody deployed.

The question was therefore not "was 0004 wrong" but **"is there a queue that costs none of the
four things 0004 was avoiding?"**

Cloud Tasks is:

- **Not a service.** The worker is a route in the same container — `POST /api/runs/dispatch`
- **Not a dependency.** `@google-cloud/tasks` brings gRPC, so the adapter is one authenticated
  `fetch` against the REST API. The runtime dependency list stayed exactly as Phase 4 left it
- **Not deploy complexity.** One queue and one IAM binding, created once
- **Free.** 1,000,000 operations a month, against roughly three per run

## Decision

Durable runs go through Cloud Tasks to `POST /api/runs/dispatch`. **Synchronous runs keep
executing in the request that started them.** The in-process path is retained, not replaced.

Still no Redis, no BullMQ and no worker service. The engine runs in the web container either way;
the queue only decides *which request* runs it.

| Mode | Executed by | Survives a redeploy |
|---|---|---|
| `sync` | the request that started it | No |
| `durable` | a Cloud Tasks delivery | **Yes** |

Manual runs default to `sync` and the canvas offers "Queue a run"; **scheduled runs are always
durable**.

## Consequences

**`sync` had to stay, and that is a product constraint rather than caution.** `POST /runs`
answers with the finished run and every step. The canvas's Run button and every verification
script read that shape, and a request that returns before the run is over cannot have it.

**At-least-once delivery is made safe by a lease, not by deduplication.** A run is claimed with a
compare-and-set; a duplicate delivery finds the lease held and does nothing. The same primitive
claims a schedule before firing it, so a duplicate cron tick is equally harmless.

**The task carries a run id and that run's dispatch token — never a payload.** Cloud Tasks bills
per 32 KB chunk, and the graph is already in Postgres.

**Resuming came free, and that is the clearest vindication of the earlier design.**
`ARCHITECTURE.md` had predicted the recovery path as "step records already hold enough state to
resume later", and it was exactly true: the cursor stores only the frontier, because the outputs
were already there.

**The cron tick got cheaper.** It now enqueues instead of executing inline, so its bound rose
from 3 schedules per tick to 25 — the limit is database writes now, not the engine against Cloud
Scheduler's 540-second attempt deadline. It is also the sweeper's only scheduled caller across
every owner, so a run abandoned by a user who never returns does not stay `running` for ever.

**"Not configured" is a supported state, and that created the one real hazard.** There is no
metadata server on a developer machine and no queue in CI, so `enqueueRun` reports that and the
caller executes in-process — still leased, still checkpointed, still resumable, just not
redeliverable. The hazard is that the *deployed* service could do the same **silently**, so
`GET /api/health` reports `queue.configured` and the deployed verification asserts it.

**The dispatch route is a new unauthenticated surface**, and it is guarded twice: `CRON_SECRET`
compared in constant time, **plus** the run's own 192-bit dispatch token. The secret is the outer
gate; the token is what actually grants anything, and it grants exactly one run that its owner
already started.

## Alternatives

| Rejected | Why |
|---|---|
| **Redis + BullMQ + a worker** | Still a second service and a paid dependency. The thing 0004 refused, and the refusal still stands |
| **Postgres-as-a-queue with `SKIP LOCKED`** | Needs a poller, and a container that scales to zero cannot poll. It would also wake a database metered on time awake |
| **`@google-cloud/tasks`** | Brings gRPC and a large dependency tree for what is three REST calls. One authenticated `fetch` keeps the "no new dependency" property that made this affordable |
| **Replace the in-process path entirely** | Would break the response shape `POST /runs` is contracted to return, for no gain — a watched run does not need redelivery |
