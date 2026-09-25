# CONTRACT.md — AgentForge stable interfaces

Only interfaces that must stay consistent **across phases** live here. Once a section is filled, it
is stable: changing it means updating every consumer in the same session, and saying so in
`PROGRESS.md`.

**This file is deliberately mostly empty.** Contracts get defined by the phase that first needs
them, against real code — not invented in advance. Each section below names the phase that fills it.
Do not pre-empt them.

| Section | Status | Filled by |
|---|---|---|
| Environment variables | **DEFINED** | Phase 0 — verified against the chosen stack 2026-09-25 |
| Workflow / node / edge JSON | `NOT YET DECIDED` | Phase 3 |
| Node definition interface | `NOT YET DECIDED` | Phase 3 |
| Run and step records | `NOT YET DECIDED` | Phase 3 |
| Execution state machine | `NOT YET DECIDED` | Phase 3 |
| API request/response shapes | `NOT YET DECIDED` | Phases 3–4, extended after |
| SSE event messages | `NOT YET DECIDED` | Phase 5 |
| Agent tool-call schema | `NOT YET DECIDED` | Phase 6 |
| Credential storage shape | `NOT YET DECIDED` | Phase 6 |
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
| `DATABASE_URL_UNPOOLED` | Neon Postgres, **direct** endpoint | Migrations only. Pooling breaks session-level operations migrations need |
| `AUTH_SECRET` | Session/JWT signing secret | 32+ random bytes. Different per environment |
| `AUTH_URL` | Canonical app origin for OAuth callbacks | Must match the deployed origin **exactly**, or the Google callback fails in a way that looks like a bad client id |
| `GOOGLE_CLIENT_ID` | Google OAuth client id | From the Phase 0 OAuth client. Auth.js v5 *auto-infers* `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`, not these names — pass these explicitly into the Google provider config. Verified Phase 0 |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | Secret |
| `ENCRYPTION_KEY` | AES-256-GCM key for credentials at rest | 32 bytes, base64. **Rotating this makes every stored credential unreadable** |
| `APP_BASE_URL` | Public base URL | Used to build webhook URLs shown to the user |
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

## Workflow / node / edge JSON — `NOT YET DECIDED`

Filled by **Phase 3**. Must cover: workflow identity and ownership; the node list with type, id,
canvas position, and config; the edge list with source, target, and which output/branch it leaves
from; and a schema version. Positions are part of the contract — a workflow that reloads with a
scrambled layout is a broken round-trip.

## Node definition interface — `NOT YET DECIDED`

Filled by **Phase 3**. The interface every node implements, serving three consumers: engine
dispatch, canvas palette and config form, and the agent's tool set. See `ARCHITECTURE.md` → *The
node registry is the spine*. Must cover: type identifier, human label and description (the
description is what the agent reads, so it is contract, not decoration), config schema, input and
output shape, and the execute function's signature and error contract.

## Run and step records — `NOT YET DECIDED`

Filled by **Phase 3**. Must cover: run identity, workflow reference, trigger kind, status,
timestamps, and error; and per step the node reference, status, timing, input, output, error, and a
snapshot of the config it ran with. The snapshot matters — there is no workflow versioning, so
without it run history becomes misleading the first time a workflow is edited.

## Execution state machine — `NOT YET DECIDED`

Filled by **Phase 3**. Must enumerate run states and step states, the legal transitions, and which
are terminal. Constraint already fixed by `ARCHITECTURE.md`: a run interrupted by a Cloud Run
redeploy must be observable as failed, never left permanently `running`.

## API request/response shapes — `NOT YET DECIDED`

Filled by **Phases 3–4**, extended by later phases. Surface listed in `ARCHITECTURE.md` → *API
surface*. Fixed now: every route except the webhook receiver and the cron tick requires a session
and scopes its query to the owner, server-side.

## SSE event messages — `NOT YET DECIDED`

Filled by **Phase 5**. Must cover: event names, per-event payloads, node status transitions, log
lines, run completion, and how a client that connects mid-run or reconnects recovers correct state.

## Agent tool-call schema — `NOT YET DECIDED`

Filled by **Phase 6**. Must cover: how a registry node is projected into a tool definition, the
call and result shapes, how a tool error is returned to the model, and the iteration cap.
Constraints already fixed: tools come only from the registry, and there is no shell, filesystem, or
arbitrary-network tool.

## Credential storage shape — `NOT YET DECIDED`

Filled by **Phase 6**. Must cover: the stored record (owner, kind, encrypted payload, metadata), the
AES-256-GCM envelope, and the API shape — which is **write-only**: a client may set a credential and
see that one exists, never read its value back.

## Generation request/response — `NOT YET DECIDED`

Filled by **Phase 7**. Must cover: the request, the validated workflow returned, and the error shape
for output that fails validation. Fixed now: invalid model output is rejected and reported, never
persisted.

## Trigger shapes — `NOT YET DECIDED`

Filled by **Phase 8**. Must cover: the webhook receiver's URL form and token, how a request body
becomes trigger output, the schedule trigger's cron field, and the `/api/cron/tick` contract. Fixed
now: webhook tokens are cryptographically random, and the tick route rejects any request without
`CRON_SECRET`.
