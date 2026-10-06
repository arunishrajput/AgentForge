# Self-hosting AgentForge

AgentForge is **one container and one Postgres database**. There is no worker, no Redis, no
message broker and no second service. That is the whole deployment, and it is why this page
is short.

It is designed to run for **nothing**: Cloud Run's always-free tier, Neon's free Postgres,
and an LLM provider's free tier. Nothing in this guide asks you to enable billing on a paid
product — where a paid service was the textbook answer, the trade is written down in
[`../SECURITY.md`](../SECURITY.md) rather than quietly taken.

**Two routes:**

- **[Locally](#run-it-locally)** — ~15 minutes. You need a database, a Google OAuth client and
  an LLM key.
- **[On Cloud Run](#deploy-it-to-cloud-run)** — the way the public instance runs.
  [`../DEPLOYMENT.md`](../DEPLOYMENT.md) is the exhaustive version with rollback and
  verification; this is the path through it.

Any host that runs a container and reaches Postgres will work. Cloud Run is what this is
proven on, and two features degrade gracefully elsewhere — see
[What you give up off Cloud Run](#what-you-give-up-off-cloud-run).

---

## Before you start

| You need | Free? | Why |
|---|---|---|
| **Node >= 20.9** | — | Next 16's floor. Developed on Node 26 |
| **A Postgres database** | Neon free tier | Everything is stored here. Neon is what this is tested against |
| **A Google OAuth client** | yes | Sign-in. There is no password auth, by design |
| **An LLM API key** | Gemini or Groq free tier | Generation and the agent nodes. Without one, everything except the AI nodes still works |
| **Docker** | — | Only if you want to run the production image locally |
| **`gcloud`** | — | Only for the Cloud Run route |

---

## Run it locally

### 1. Clone and install

```bash
git clone https://github.com/arunishrajput/AgentForge.git
cd AgentForge
npm install
```

### 2. Create a database

Any Postgres will do. On [Neon](https://neon.tech) the free tier is enough: create a project
and copy **both** connection strings from the dashboard.

They are not interchangeable, and this is the single most common setup mistake:

- **`DATABASE_URL`** — the **pooled** endpoint. Its host contains `-pooler`. The application
  uses this at runtime, because several container instances each open a pool and a free Neon
  compute has a low connection limit.
- **`DATABASE_URL_UNPOOLED`** — the **direct** endpoint, no `-pooler`. Migrations only. They
  need a session-level connection that the pooler breaks.

### 3. Create a Google OAuth client

In the [Google Cloud console](https://console.cloud.google.com/apis/credentials) →
**Credentials** → **Create credentials** → **OAuth client ID** → **Web application**.

Add this **exact** authorised redirect URI:

```
http://localhost:3000/api/auth/callback/google
```

Copy the client ID and secret. A mismatch here — a trailing slash, `http` against `https`,
the wrong port — fails in a way that looks like a bad client id rather than a bad URL.

### 4. Fill in `.env`

```bash
cp .env.example .env
```

**Eight variables are required.** The app validates them at startup and names *every* missing
one at once rather than failing on the first:

| Variable | What it is |
|---|---|
| `DATABASE_URL` | The pooled connection string |
| `AUTH_SECRET` | 32+ random bytes. `openssl rand -base64 32` |
| `AUTH_URL` | `http://localhost:3000` — the canonical origin, no trailing slash |
| `GOOGLE_CLIENT_ID` | From step 3 |
| `GOOGLE_CLIENT_SECRET` | From step 3 |
| `ENCRYPTION_KEY` | Exactly 32 bytes, base64. `openssl rand -base64 32` |
| `APP_BASE_URL` | `http://localhost:3000` — used to build the webhook URLs shown to users |
| `CRON_SECRET` | 16+ random bytes. Guards the two machine endpoints |

`DATABASE_URL_UNPOOLED` is required for migrations but deliberately **not** part of the
server's startup contract — the running container never opens the direct endpoint, so
requiring it would make the app refuse to boot over a variable it does not use.

**Leave `ROOT_KEY_SECRET` and `TASKS_QUEUE` empty.** Both are Cloud-only, and both have a
correct local fallback: `ENCRYPTION_KEY` becomes the root key, and a durable run executes
in-process — still leased, still checkpointed, still resumable, just not redeliverable.

Every remaining variable in `.env.example` is optional, and most are read only by the
verification scripts, never by the product.

### 5. Migrate and run

```bash
npm run db:migrate    # uses DATABASE_URL_UNPOOLED
npm run dev           # http://localhost:3000
```

Open <http://localhost:3000>, sign in with Google, and reload — the session should survive.

### 6. Prove it actually works

```bash
curl -fsS localhost:3000/api/health
```

Five dependency checks, not a bare `ok`. **Locally you should see `degraded`, and that is
correct** — two checks report the Cloud-only features you deliberately left unset:

```jsonc
{
  "status": "degraded",
  "database": "reachable",
  "databaseLatencyMs": 47,
  "checks": [
    { "name": "database", "status": "ok" },
    { "name": "schema",   "status": "ok" },
    { "name": "queue",    "status": "degraded",
      "detail": "TASKS_QUEUE is unset — runs execute in-process and do not survive a redeploy." },
    { "name": "rootKey",  "status": "degraded",
      "detail": "ROOT_KEY_SECRET is unset — the root key cannot be rotated without re-encrypting." },
    { "name": "registry", "status": "ok" }
  ],
  "migrations": 11,
  "registry": 30,
  "revision": "local"
}
```

Both are the documented local fallbacks, not misconfiguration. `database`, `schema` and
`registry` are the three that must be `ok` on a working local install — if any of those is not,
the `detail` says why.

On a correctly configured Cloud Run deployment all five report `ok` and `status` is `ok`. That is
the difference worth watching: a **deployed** service showing these two as degraded has silently
lost durable runs and root-key rotation, which is exactly why health reports them.

Then run the real suite — auth gating, workspace scoping, a graph round-trip, a sequential
run, both sides of a branch, a bounded loop, the failure path, live streaming, and the agent
layer:

```bash
node --env-file=.env scripts/verify-api.mjs http://localhost:3000
```

### Verifying a local install

**This suite was written to run against a deployed instance**, and two classes of check are
sensitive to the environment rather than to the product. Both were measured on 2026-10-01: the
same suite reports `ALL CHECKS PASSED` against the deployed URL and 18 failures against a local
`next dev` server pointed at the same database.

**1. Anything needing a stored credential, if your database belongs to another deployment.**
This is the one that will catch you, and it is worth understanding because it is the vault
working correctly.

Credentials are encrypted with a per-credential data key, and that key is wrapped by a **root
key**. A deployed service wraps under Secret Manager (`keyVersion = sm:1`); a local process with
`ROOT_KEY_SECRET` unset uses `ENCRYPTION_KEY` instead. So a local server pointed at a *deployed*
database can see that a key is stored and **cannot unwrap it** — every model call answers 500.

That is not a bug. A root key that a copy of the database could decrypt without it would not be a
root key. Three ways out:

- **Use your own database locally.** The cleanest, and what a fresh install does by default
- **Set `ROOT_KEY_SECRET`** and authenticate to the project that holds the secret
- **Connect a key in the local instance**, which stores it under the local root key

**2. Byte-for-byte page comparisons, under `next dev`.** A couple of checks assert that two error
pages render identically — for example that a revoked invitation and an invented one are
indistinguishable, which is a real security property. The *rendered text* is identical in both
environments; Next's development-mode React payload is not, so a byte comparison fails on a dev
server and passes on a production build. Run against `npm run build && npm start`, or against a
deployed instance, to assert it meaningfully.

**What should pass locally regardless:** auth gating, workspace scoping, the graph round-trip,
sequential runs, both sides of a branch, bounded loops, the failure path, live streaming,
sharing, versioning and every database invariant.

### 7. Add an LLM key

Sign in, then **Settings → Model**. Paste a key from either provider and pick a model:

- **Google Gemini** — <https://aistudio.google.com/apikey>, free tier, no card
- **Groq** — <https://console.groq.com/keys>, free tier, no card. Measured 2–7× faster than
  Gemini on the same probe

The key is stored encrypted and is never returned to a client. The server-side
`GOOGLE_GENERATIVE_AI_API_KEY` in `.env` exists for development and is **not** a substitute
for this — the product's real path is each workspace supplying its own.

You can now type a sentence on the dashboard and get a workflow.

---

## Run the production image

The same image Cloud Run runs. Port 8080 is mapped to 3000 so the OAuth redirect URI you
registered for local development still matches.

```bash
docker build -t agentforge .
docker run --rm --env-file .env -p 3000:8080 agentforge
curl -fsS localhost:3000/api/health
```

---

## Deploy it to Cloud Run

[`../DEPLOYMENT.md`](../DEPLOYMENT.md) is authoritative and covers rollback, verification and
the resource inventory. This is the shape.

### 1. Create the project resources

```bash
gcloud services enable run.googleapis.com cloudscheduler.googleapis.com \
  cloudtasks.googleapis.com secretmanager.googleapis.com

# The queue that carries durable runs.
gcloud tasks queues create agentforge-runs --location "$GCP_REGION"
```

**Put Cloud Run and the database in the same region.** Co-locating them beats chasing cheaper
regions; a cross-region hop is paid on every query, on every request, forever.

### 2. Deploy

Environment variables belong **on the deploy command**, not on a follow-up `update`. A
revision missing one exits 1 on purpose, so a bad deploy fails loudly instead of leaving a
half-configured service serving 500s.

```bash
gcloud run deploy agentforge --source . --region "$GCP_REGION" --allow-unauthenticated \
  --min-instances 1 --max-instances 3 --memory 1Gi --cpu 1 --timeout 3600 --port 8080 \
  --env-vars-file run-env.yaml
```

Set `AUTH_URL` and `APP_BASE_URL` to the deployed origin, and add that origin's
`/api/auth/callback/google` to the OAuth client's authorised redirect URIs.

> **The service has two URLs, and `--format='value(status.url)'` returns the wrong one.** The
> canonical one is the deterministic `https://<service>-<project-number>.<region>.run.app`.
> Use that everywhere, or OAuth will fail against the one you did not register.

### 3. Schedule the daily sweep

Scale-to-zero makes in-process timers non-functional, so the clock lives outside the app. **Each
schedule fires from its own Cloud Tasks timer**, armed for its exact due time on the queue you
created for durable runs — nothing extra to set up. What you do schedule is a once-a-day safety
sweep, which catches a lost timer or a lost wake and does the housekeeping:

```bash
gcloud scheduler jobs create http agentforge-cron \
  --location "$GCP_REGION" --schedule "0 4 * * *" \
  --uri "$APP_BASE_URL/api/cron/tick" --http-method POST \
  --headers "x-cron-secret=$CRON_SECRET"
```

Daily rather than every few minutes is a cost decision, not a taste one: Neon's free tier meters
**compute time awake**, and a frequent sweep keeps an idle database awake all month — every 15
minutes is ~61 of its 100 CU-hours; daily is ~0.6. Without a queue (`TASKS_QUEUE` unset) schedules
are not armed and fire only from this sweep, and a delay over 10 seconds is refused.

### 4. Migrate, then verify behaviour

```bash
npm run db:migrate                                   # against the deployed database
curl -fsS "$APP_BASE_URL/api/health"
node --env-file=.env scripts/verify-api.mjs "$APP_BASE_URL"
```

**A zero exit code is not a successful deployment.** Check the revision is serving traffic,
sign in through a browser, and run one workflow end to end. Every verification script in
`scripts/` takes a base URL and runs against a deployed instance for exactly this reason.

---

## What you give up off Cloud Run

Two features read their environment, and both degrade rather than break:

| Feature | On Cloud Run | Elsewhere |
|---|---|---|
| **Durable runs** | Cloud Tasks redelivers a run that died mid-flight | Falls back to in-process: still leased, still checkpointed, still resumable, **not** redeliverable if the container dies |
| **Schedules on time, and long waits** | Each schedule has a Cloud Tasks timer for its exact due time, and a `core.delay` over 10 s puts the run to sleep until a timer wakes it | Schedules fire only from the daily sweep — up to a day late — and a delay over 10 s fails its step with a message |
| **Rotatable root key** | Secret Manager holds a versioned root key; rotating re-wraps data keys without decrypting a secret | `ENCRYPTION_KEY` is the root key, version `env`. Rotating it makes rows still under it unreadable — run `scripts/rekey.mjs --dry-run` first |

Neither needs a cloud SDK — Cloud Tasks is one authenticated `fetch` — so porting either to
another provider's queue or secret store is a file, not a project.

The Vault tab reports which root key a deployment is actually using, because a deployment
silently on the environment key has the old problem back without the old warning.

---

## Operating it

- [`../OPERATIONS.md`](../OPERATIONS.md) — the signals, the runbooks, the budget, and how to
  verify a deploy
- [`../SECURITY.md`](../SECURITY.md) — what is protected, the rotation procedures, and
  **what this product does not claim**
- [`../DEPLOYMENT.md`](../DEPLOYMENT.md) — the full procedure, rollback included

### Keeping it free

Four things decide the bill:

1. **Neon meters compute time awake, not queries.** Nothing in this product polls, and
   analytics is computed on demand — no rollup job, no cache warmer. Measured at 21–27 ms of
   database time per page view. Do not add a new reason to wake an idle database
2. **The sweep is daily.** See above — and do not shorten it; schedules have their own timers
3. **`--min-instances 1` costs a little and buys a lot** (no cold start on the first request).
   `--min-instances 0` is free and is the right setting for an instance nobody is watching. The
   daily sweep can stay on: it wakes the database once a day, not all day
4. **A Google Cloud trial ends after 90 days, and takes the service down with it.** Upgrade the
   billing account to a paid one before then (Always Free usage stays at zero) and set a budget
   alert — this project learned it the hard way (`DEPLOYMENT.md` → *Project, billing, and APIs*)

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| App exits at startup listing variables | Working as designed. It names every missing one at once — fill them and restart |
| `redirect_uri_mismatch` on sign-in | `AUTH_URL` does not match the origin you reached, or that origin's callback is not on the OAuth client. Both must be exact, no trailing slash |
| Intermittent "too many connections" | `DATABASE_URL` is the **direct** endpoint. It must be the pooled one, whose host contains `-pooler` |
| Migrations hang or fail oddly | `DATABASE_URL_UNPOOLED` is the **pooled** endpoint. Migrations need the direct one |
| `/api/health` reports `queue` unconfigured on Cloud Run | `TASKS_QUEUE` is unset, so durable runs silently stopped surviving a redeploy. This is why health reports it |
| Generation returns `unsupported` | The model decided no registered node can do what you asked. The reason is in the response — it is an answer, not a failure |
| Every model call answers 500 locally, but a key *is* connected | Your `.env` points at a database whose credentials are wrapped under a **Secret Manager** root key, and this process is using `ENCRYPTION_KEY`. See [Verifying a local install](#verifying-a-local-install) |
| `/api/health` says `degraded` locally | Expected. `queue` and `rootKey` are the Cloud-only features; both have working local fallbacks |
| Nothing streams while a run executes | An intermediary is buffering the SSE response. The app sets the headers that ask it not to; a proxy in front may still need `proxy_buffering off` |
