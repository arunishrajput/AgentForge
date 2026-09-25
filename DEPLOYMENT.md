# DEPLOYMENT.md — AgentForge

How to deploy AgentForge and how to prove it actually works.

Every step is labelled **`AUTOMATED BY CLAUDE CODE`** or **`MANUAL HUMAN ACTION`**.

> **Never report a deployment successful because a command exited zero.** Deployment is complete
> when the deployed system behaves correctly. See *Verification*.

---

## Target platform

**Google Cloud Run (single container) + Neon Postgres.** Binding — see `ARCHITECTURE.md` →
*Hosting platform*. Railway and AWS are recorded at the end of this file as unimplemented fallbacks.

Why free: Cloud Run Always Free (no end date) covers 2M requests, 180,000 vCPU-seconds, 360,000
GiB-seconds and 1 GB North-America egress per month, and the $300 / 90-day welcome credit absorbs
any overage during the hackathon. Neon's free tier and Gemini's free tier cover the rest.

---

## Prerequisites

| Requirement | Check | Status as of 2026-09-25 |
|---|---|---|
| `gcloud` CLI | `gcloud --version` | Installed (580.0.0), **not authenticated** |
| `git` + `gh` | `gh auth status` | Authenticated as `arunishrajput` |
| `docker` | `docker --version` | Installed (29.7.2) — local container testing only; Cloud Build builds for deploys |
| Node toolchain | `node --version` | v26.8.2, npm 11.19.1, pnpm 11.21.0 |
| Google Cloud project with billing | `gcloud config get-value project` | **Not yet created** — Phase 0 |
| Neon project | a real query | **Not yet created** — Phase 0 |

`psql` is **not** installed. Use Neon's SQL editor, or the app's own migration tooling, rather than
adding a dependency.

---

## Services and resources

Filled in with real names during Phase 0. **Check whether a resource exists before creating it** —
across `/clear` boundaries this is how duplicate infrastructure gets created.

| Resource | Type | Provider | Purpose | Created by | Claude Code may manage |
|---|---|---|---|---|---|
| `UNKNOWN — VERIFY` | Project | Google Cloud | Hosts Cloud Run, OAuth client, Scheduler | Phase 0 | Yes, after auth |
| `agentforge` | Cloud Run service | Google Cloud | The whole application | Phase 2 | Yes |
| `UNKNOWN — VERIFY` | OAuth 2.0 Client | Google Cloud | Google sign-in | Phase 0 manual, updated Phase 2 manual | No — console only |
| `UNKNOWN — VERIFY` | Postgres project/branch | Neon | All persistence | Phase 0 | Partly — console for creation |
| `agentforge-cron` | Cloud Scheduler job | Google Cloud | Fires due schedule triggers | Phase 8 | Yes |
| Gemini API key | Credential | Google AI Studio | LLM calls | Phase 0 manual | No |
| Discord webhook URL | Credential | Discord | Demo output target | Phase 0 manual | No |
| `AgentForge` | Git repository | GitHub | Source + persistent memory | Bootstrap | Yes |

**Region.** Pick **one** region and use it everywhere. Recommended `asia-south1` (Mumbai) for
Cloud Run, with the geographically closest available Neon region — Neon's free-tier region list is
`UNKNOWN — VERIFY` at Phase 0. Keeping the database near the service matters: every node in a
workflow run makes database round-trips.

---

## Environment variables

`CONTRACT.md` → *Environment variables* is authoritative. `.env.example` mirrors it.

- **Local:** `.env`, never committed
- **Production:** set on the Cloud Run service. Secrets via `--set-env-vars` for the hackathon, or
  Secret Manager if time permits. Never baked into the image

```bash
# AUTOMATED BY CLAUDE CODE — set production env vars
gcloud run services update agentforge --region "$GCP_REGION" \
  --set-env-vars "NODE_ENV=production,AUTH_URL=$APP_BASE_URL,APP_BASE_URL=$APP_BASE_URL" \
  --set-env-vars "DATABASE_URL=$DATABASE_URL,DATABASE_URL_UNPOOLED=$DATABASE_URL_UNPOOLED" \
  --set-env-vars "AUTH_SECRET=...,GOOGLE_CLIENT_ID=...,GOOGLE_CLIENT_SECRET=..." \
  --set-env-vars "ENCRYPTION_KEY=...,CRON_SECRET=..."
```

Generate secrets locally, never by hand:

```bash
openssl rand -base64 32   # AUTH_SECRET, ENCRYPTION_KEY, CRON_SECRET
```

---

## One-time setup

### 1. Authenticate gcloud — **MANUAL HUMAN ACTION**

```text
MANUAL ACTION REQUIRED

Reason:
gcloud is installed but has no credentialed account. Without it nothing can be created or
deployed, and Phase 0 cannot complete.

Location:
Your terminal. The command opens a browser to accounts.google.com.

Steps:
1. In the Claude Code prompt, type:  ! gcloud auth login
2. Complete the Google sign-in in the browser that opens.
3. Then type:  ! gcloud auth application-default login

Values to enter:
Use the Google account that will own the project — arunishrajput7@gmail.com.

Expected result:
The terminal prints "You are now logged in as [arunishrajput7@gmail.com]".

Verification:
gcloud auth list

Resume by:
Saying "gcloud is authenticated".
```

### 2. Project, billing, and APIs — **MANUAL HUMAN ACTION** (billing) then **AUTOMATED**

Billing must be enabled even to use the Always Free tier. The $300 / 90-day credit covers this
build.

```text
MANUAL ACTION REQUIRED

Reason:
Cloud Run requires a billing account on the project, including for the Always Free tier. Without
it, deploys are rejected and Phase 2 cannot complete.

Location:
https://console.cloud.google.com/billing  →  Link a billing account to the project.

Steps:
1. Open the URL above.
2. If prompted, activate the free trial to receive the $300 / 90-day credit.
3. Link the billing account to the AgentForge project.

Values to enter:
None beyond the card details Google requires for trial activation.

Expected result:
The project appears under the billing account with status "Active".

Verification:
gcloud beta billing projects describe <PROJECT_ID>

Resume by:
Saying "billing is linked".
```

```bash
# AUTOMATED BY CLAUDE CODE — after billing is linked
gcloud projects create <PROJECT_ID> --name="AgentForge"     # or select an existing one
gcloud config set project <PROJECT_ID>
gcloud config set run/region <GCP_REGION>
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com cloudscheduler.googleapis.com
```

### 3. Neon Postgres — **MANUAL HUMAN ACTION** (creation), then **AUTOMATED**

```text
MANUAL ACTION REQUIRED

Reason:
All persistence lives in Neon. Without a database, auth cannot store a user and no phase past 1
can complete.

Location:
https://console.neon.tech  →  New Project.

Steps:
1. Sign in (Google sign-in with arunishrajput7@gmail.com is fine).
2. Create a project named "agentforge".
3. Pick the region geographically closest to the Cloud Run region (asia-south1 / Mumbai).
4. Open Connection Details and copy BOTH connection strings:
   - the POOLED one  (host contains "-pooler")
   - the DIRECT one  (no "-pooler")

Values to enter:
Project name: agentforge
Database name: the default is fine.

Expected result:
Two connection strings, both beginning postgresql:// and containing sslmode=require.

Verification:
Claude Code runs a real query through the app's database client and prints the server version.

Resume by:
Pasting both connection strings. They go into .env as DATABASE_URL (pooled) and
DATABASE_URL_UNPOOLED (direct) — never into a committed file.
```

### 4. Google OAuth client — **MANUAL HUMAN ACTION**, two passes

The production redirect URI cannot be registered before the deployed URL exists. Pass one in
Phase 1 with localhost; pass two in Phase 2 with the real URL.

```text
MANUAL ACTION REQUIRED   (pass 1 — Phase 1)

Reason:
Google sign-in is MVP-Critical (C1). Without an OAuth client there is no auth, and Phases 1 and 2
cannot complete.

Location:
https://console.cloud.google.com/apis/credentials
→ Configure the OAuth consent screen first if prompted, then Create Credentials
→ OAuth client ID → Web application.

Steps:
1. Consent screen: External, app name "AgentForge", your email as support and developer contact.
2. Add yourself as a Test user.
3. Create an OAuth client ID of type "Web application", named "AgentForge Web".
4. Add the authorised origin and redirect URI below.
5. Copy the client ID and client secret.

Values to enter:
Authorised JavaScript origin:
    http://localhost:3000
Authorised redirect URI:
    http://localhost:3000/api/auth/callback/google

Expected result:
A client ID ending in .apps.googleusercontent.com, and a client secret.

Verification:
Claude Code completes a real sign-in locally and confirms a user row in Neon.

Resume by:
Pasting the client ID and secret. They go into .env only.
```

```text
MANUAL ACTION REQUIRED   (pass 2 — Phase 2, after the first deploy)

Reason:
The OAuth callback must match the deployed origin exactly, or production sign-in fails. The
deployed URL does not exist until the first deploy, so this cannot be done earlier.

Location:
https://console.cloud.google.com/apis/credentials → the "AgentForge Web" client.

Steps:
1. Open the existing client.
2. Add the production origin and redirect URI below, keeping the localhost entries.
3. Save, and allow a few minutes for propagation.

Values to enter:
Authorised JavaScript origin:
    <THE DEPLOYED CLOUD RUN URL>
Authorised redirect URI:
    <THE DEPLOYED CLOUD RUN URL>/api/auth/callback/google
Claude Code will print both exact strings after the deploy.

Expected result:
Four entries total — two localhost, two production.

Verification:
Sign in on the deployed URL; Claude Code confirms the user row in the production database.

Resume by:
Saying "production redirect URI added".
```

### 5. Gemini API key — **MANUAL HUMAN ACTION**

```text
MANUAL ACTION REQUIRED

Reason:
Gemini is the only wired LLM provider. Without a key, Phases 6 and 7 — including the headline
NL→workflow feature — cannot be built or demonstrated.

Location:
https://aistudio.google.com/apikey  →  Create API key.

Steps:
1. Open the URL and sign in.
2. Create an API key, ideally in the same Google Cloud project as AgentForge.
3. Copy it.

Values to enter:
None.

Expected result:
A key beginning "AIza".

Expected cost:
Free tier. Stay on it; if a model is not free-tier eligible, pick a Flash tier instead.

Verification:
Claude Code makes one minimal model call and prints the model name from the response.

Resume by:
Pasting the key. It goes into .env as GOOGLE_GENERATIVE_AI_API_KEY (dev/demo fallback) — the
product's real path is users pasting their own key in-app.
```

### 6. Discord webhook — **MANUAL HUMAN ACTION**

```text
MANUAL ACTION REQUIRED

Reason:
The demo's final beat is a result landing in a real external service. The Discord node needs a
webhook URL. Without it, Phase 9 and the demo's payoff cannot be verified.

Location:
Discord → your server → target channel → Edit Channel → Integrations → Webhooks → New Webhook.

Steps:
1. Create a server if you do not have one (free, instant).
2. Create a channel named "agentforge-demo".
3. In that channel: Edit Channel → Integrations → Webhooks → New Webhook → Copy Webhook URL.

Values to enter:
Webhook name: AgentForge

Expected result:
A URL of the form https://discord.com/api/webhooks/<id>/<token>

Verification:
Claude Code posts one test message and you see it in the channel.

Resume by:
Pasting the webhook URL. Treat it as a secret — anyone holding it can post to the channel.
```

---

## Deployment order

1. Neon project exists and answers a query
2. Google Cloud project exists, billing linked, APIs enabled
3. OAuth client exists (localhost pass)
4. `Dockerfile` builds and runs locally
5. **Deploy** to Cloud Run
6. Add the production redirect URI (OAuth pass 2)
7. Set production environment variables
8. Run migrations against the production database
9. Verify behaviour
10. Cloud Scheduler job (from Phase 8)

There is no separate frontend deploy. **One container serves UI and API** — see `ARCHITECTURE.md` →
*Deployment topology*.

---

## Deploy — **AUTOMATED BY CLAUDE CODE**

```bash
gcloud run deploy agentforge \
  --source . \
  --region "$GCP_REGION" \
  --allow-unauthenticated \
  --min-instances 1 \
  --max-instances 3 \
  --memory 1Gi \
  --cpu 1 \
  --timeout 3600 \
  --port 8080
```

Notes:
- `--source .` makes Cloud Build build the `Dockerfile`. No local `docker push`, no ECR equivalent
- `--min-instances 1` removes cold starts during the hackathon, funded by the $300 credit. **Drop
  to 0 after the event** or it bills continuously beyond the Always Free allowance
- `--max-instances 3` is a cost guard, not a scaling strategy
- `--timeout 3600` is the 60-minute ceiling that lets long runs finish inside a request
- The container must listen on `$PORT` (8080). This is the most common first-deploy failure

Get the URL:

```bash
gcloud run services describe agentforge --region "$GCP_REGION" --format='value(status.url)'
```

---

## Migrations — **AUTOMATED BY CLAUDE CODE**

Run against `DATABASE_URL_UNPOOLED`. The pooled endpoint breaks session-level operations that
migrations need.

```bash
DATABASE_URL="$DATABASE_URL_UNPOOLED" <migration command>   # exact command set in Phase 3
```

Run migrations **after** the deploy that contains them, from a local shell against the production
database. Do not run migrations on container start — with more than one instance, concurrent
migrations race.

---

## Cloud Scheduler — **AUTOMATED BY CLAUDE CODE** (Phase 8)

```bash
gcloud scheduler jobs create http agentforge-cron \
  --location "$GCP_REGION" \
  --schedule "* * * * *" \
  --uri "$APP_BASE_URL/api/cron/tick" \
  --http-method POST \
  --headers "x-cron-secret=$CRON_SECRET"
```

The route must reject any request without the secret. Free tier covers a job at this frequency;
lengthen the schedule if usage becomes a concern.

---

## Verification

A deploy is verified only when all of these pass. Exit codes are not evidence.

```bash
# 1. Service and revision — AUTOMATED
gcloud run services describe agentforge --region "$GCP_REGION" \
  --format='value(status.url,status.latestReadyRevisionName)'

# 2. Health, from outside — AUTOMATED
curl -fsS "$APP_BASE_URL/api/health"

# 3. Logs, no startup errors — AUTOMATED
gcloud run services logs read agentforge --region "$GCP_REGION" --limit 50

# 4. Database, real query through the app's client — AUTOMATED
```

**5. Auth flow — MANUAL HUMAN ACTION.** In a browser, ideally on a machine that has never run the
project: load the URL, sign in with Google, reload and confirm the session persists. Claude Code
then confirms the user row in the production database.

**6. Realtime — AUTOMATED + browser.** From Phase 5: trigger a run on the deployed URL and confirm
per-node events arrive incrementally.

**7. One full workflow end to end on the deployed system.** From Phase 3 onward, every phase ends
with this.

---

## Logs and inspection

```bash
gcloud run services logs read agentforge --region "$GCP_REGION" --limit 100
gcloud run services logs tail agentforge --region "$GCP_REGION"
gcloud run revisions list --service agentforge --region "$GCP_REGION"
gcloud builds list --limit 5
gcloud builds log <BUILD_ID>          # when a deploy fails, read this before touching the Dockerfile
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Deploy fails during build | Dockerfile or dependency issue | `gcloud builds log <BUILD_ID>`. Read it; do not guess |
| "Container failed to start and listen on PORT" | App hardcodes a port | Listen on `process.env.PORT`, default 8080 |
| OAuth `redirect_uri_mismatch` | Production redirect URI missing, or `AUTH_URL` ≠ deployed origin | Complete OAuth pass 2; make `AUTH_URL` exactly the deployed origin, no trailing slash |
| Sign-in works locally, fails deployed | `AUTH_URL` / `AUTH_SECRET` not set in production | Check `gcloud run services describe --format=export` |
| Intermittent "too many connections" | Using the direct endpoint at runtime | Use the pooled `DATABASE_URL` for the app |
| Migrations hang or error oddly | Running through the pooler | Use `DATABASE_URL_UNPOOLED` |
| First request very slow | Cloud Run cold start + Neon autosuspend | `--min-instances 1`; warm up before demos |
| SSE arrives in one batch at the end | Response buffering or compression on the stream | Disable both on the SSE route |
| Scheduled workflows never fire | Expecting an in-process timer | Cloud Run scales to zero; Cloud Scheduler is the mechanism |
| Cron tick returns 401/403 | Secret mismatch | Compare the Scheduler header with `CRON_SECRET` |

---

## Rollback

Cloud Run keeps every revision. Rollback is a traffic shift, not a rebuild.

```bash
gcloud run revisions list --service agentforge --region "$GCP_REGION"
gcloud run services update-traffic agentforge --region "$GCP_REGION" \
  --to-revisions <PREVIOUS_REVISION>=100
```

Then verify the health endpoint and the demo path again.

**Caveat:** a rollback does **not** revert migrations. Prefer additive migrations so an older
revision still runs against the newer schema. Before demo day, avoid destructive schema changes
entirely.

---

## Demo-day considerations

Full checklist in `DEMO.md`. Deployment-specific:

1. **Do not deploy on demo day** unless something is broken. A redeploy replaces the revision and
   kills in-flight runs
2. **Confirm `min-instances 1`** so there is no cold start
3. **Warm both tiers** ~10 minutes before: hit the health endpoint, which wakes Cloud Run, and make
   one real query, which wakes Neon's compute
4. **Verify the Gemini key** has free-tier quota left
5. **Post one test message to Discord** and confirm the Sheet is reachable
6. Have `gcloud run services logs tail` ready in a second terminal
7. Know the rollback command without looking it up

---

## Fallbacks — documented, not implemented

Recorded so the reasoning survives. Do not implement unless Cloud Run genuinely fails.

**Railway** — `SUPERSEDED`. Docker-native and the simplest mental model, but the only candidate
that is not free through judging: Free gives $1/month of credits capped at 1 vCPU / 0.5 GB per
service, and the one-time $5 / 30-day trial is consumed in roughly 3 days by a four-service stack,
or ~10 days by one service plus external Postgres. Hobby is $5/month including $5 of credits. If
Cloud Run fails, this is the fastest escape: `railway init && railway up` with the same Dockerfile
and the same Neon database, plus `npm i -g @railway/cli`.

**AWS** — `SUPERSEDED`. The account exists and is authenticated (`hiveos-dev`, `890608337320`).
Rejected because no AWS container service has a meaningful always-free tier (App Runner and ECS
Fargate have none; Aurora Serverless v2's floor is ~$40/month), the free tier is now credit-based
($100 plus up to $100 more, expiring after 6 months with the account auto-closing), and a first
deploy costs ~1–2 hours of ECR, IAM, and RDS wiring with 5–10 minute deploys thereafter. The
viable shape would be App Runner from ECR plus the existing Neon database.

**docker-compose on a VPS** — last resort. Full control, but DNS, TLS, and process supervision
become the operator's problem, which is not a good use of hackathon hours.
