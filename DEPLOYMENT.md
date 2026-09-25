# DEPLOYMENT.md — AgentForge

How to deploy AgentForge and how to prove it actually works.

Every step is labelled **`AUTOMATED BY CLAUDE CODE`** or **`MANUAL HUMAN ACTION`**.

> **Never report a deployment successful because a command exited zero.** Deployment is complete
> when the deployed system behaves correctly. See *Verification*.

---

## Live

**https://agentforge-733000675212.asia-southeast1.run.app**

| Field | Value |
|---|---|
| Service | `agentforge`, Cloud Run, `asia-southeast1` |
| Revision | `agentforge-00002-zdg` — 100% of traffic. Last known-good before it: `agentforge-00001-h4k` |
| Scaling | `min-instances 1`, `max-instances 3`, 1 vCPU / 1 GiB, 3600 s timeout |
| Database | Neon `super-mountain-39872886`, `aws-ap-southeast-1` |
| Last verified | 2026-09-25 — health, gating, a full Google sign-in / reload / sign-out cycle, and 33 API checks including a workflow executed end to end |

The service also answers on a legacy hashed URL. Do not use it — see *Deploy*.

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
| `gcloud` CLI | `gcloud --version` | Installed (580.0.0), **authenticated**, project + region set |
| `git` + `gh` | `gh auth status` | Authenticated as `arunishrajput` |
| `docker` | `docker --version` | Installed (29.7.2) — local container testing only; Cloud Build builds for deploys |
| Node toolchain | `node --version` | v26.8.2, npm 11.19.1, pnpm 11.21.0 |
| Google Cloud project with billing | `gcloud config get-value project` | `agentforge-hackathon-2026`, billing **active** |
| Neon project | a real query | `super-mountain-39872886`, **answers queries** |

`psql` is **not** installed. Use Neon's SQL editor, or the app's own migration tooling, rather than
adding a dependency.

---

## Services and resources

Filled in with real names during Phase 0. **Check whether a resource exists before creating it** —
across `/clear` boundaries this is how duplicate infrastructure gets created.

| Resource | Type | Provider | Purpose | Created by | Claude Code may manage |
|---|---|---|---|---|---|
| `agentforge-hackathon-2026` (number `733000675212`) | Project | Google Cloud | Hosts Cloud Run, OAuth client, Scheduler | Phase 0 | Yes |
| `agentforge` | Cloud Run service | Google Cloud | The whole application | **Phase 2 — EXISTS** | Yes |
| `cloud-run-source-deploy` | Artifact Registry repo | Google Cloud | Images built by `--source .` | **Phase 2 — auto-created** | Yes |
| "AgentForge Web" (`733000675212-…ntm7`) | OAuth 2.0 Client | Google Cloud | Google sign-in | Phase 0 manual, updated Phase 2 manual | No — console only |
| `agentforge` / `production` / `neondb` | Postgres project/branch | Neon | All persistence | Phase 0 | Partly — console for creation |
| `agentforge-cron` | Cloud Scheduler job | Google Cloud | Fires due schedule triggers | Phase 8 | Yes |
| Gemini API key | Credential | Google AI Studio | LLM calls | Phase 0 manual | No |
| Discord webhook URL | Credential | Discord | Demo output target | Phase 0 manual | No |
| `AgentForge` | Git repository | GitHub | Source + persistent memory | Bootstrap | Yes |

**Region — decided, Phase 0 Part D, 2026-09-25. Use it everywhere.**

| Tier | Region | Pricing tier |
|---|---|---|
| Cloud Run | **`asia-southeast1`** (Singapore) | Tier 2 |
| Neon | **`aws-ap-southeast-1`** (Singapore) | free plan |

App and database are co-located deliberately: every node in a workflow run makes database
round-trips, so cross-region latency multiplies by node count. Mumbai (`asia-south1`) is Tier 1
and was the earlier recommendation, but Neon has no Mumbai region — the pair would have cost
~50–70 ms per query. Full reasoning and the rejected alternatives are in `ARCHITECTURE.md` →
*Hosting platform* → *Region*.

`GCP_REGION=asia-southeast1` in `.env`. Set it once with `gcloud config set run/region`.

---

## Environment variables

`CONTRACT.md` → *Environment variables* is authoritative. `.env.example` mirrors it.

- **Local:** `.env`, never committed
- **Production:** set on the Cloud Run service. Secrets via `--env-vars-file` for the hackathon, or
  Secret Manager if time permits. Never baked into the image

**`DATABASE_URL_UNPOOLED` is deliberately NOT set on the service.** Only `drizzle.config.ts` reads
it; the running container never opens the direct endpoint. Setting it would widen the production
secret surface for a variable the app does not use. See `CONTRACT.md`.

**Do not build the command with `--set-env-vars`.** Connection strings and base64 secrets contain
`,` and `=`, which that flag treats as delimiters, and every value would land in shell history and
in the process list. Use a file, written outside the repository:

```bash
# AUTOMATED BY CLAUDE CODE — set production env vars from a file, never inline.
# Write it to a scratch directory outside the repo, chmod 600, delete it afterwards.
cat > "$SCRATCH/run-env.yaml" <<'EOF'
NODE_ENV: "production"
AUTH_URL: "https://agentforge-733000675212.asia-southeast1.run.app"
APP_BASE_URL: "https://agentforge-733000675212.asia-southeast1.run.app"
DATABASE_URL: "<pooled Neon URL>"
AUTH_SECRET: "<secret>"
GOOGLE_CLIENT_ID: "<client id>"
GOOGLE_CLIENT_SECRET: "<client secret>"
ENCRYPTION_KEY: "<secret>"
CRON_SECRET: "<secret>"
EOF

gcloud run services update agentforge --region "$GCP_REGION" \
  --env-vars-file "$SCRATCH/run-env.yaml"

rm -f "$SCRATCH/run-env.yaml"
```

On the **first** deploy these go on `gcloud run deploy` itself with the same flag — see *Deploy*.
A revision that boots without them exits 1 by design (`PROGRESS.md` → *Decisions*, D7), so the deploy fails.

`--env-vars-file` **replaces** the entire set rather than merging, so the file must always list
every variable. Confirm the names landed without printing any value:

```bash
gcloud run services describe agentforge --region "$GCP_REGION" \
  --format='value(spec.template.spec.containers[0].env[].name)'
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

**Phase 0 finding:** billing gates **API enablement**, not just deploying. `gcloud services enable`
for `run`, `cloudbuild`, `artifactregistry` and `cloudscheduler` fails with
`UREQ_PROJECT_BILLING_NOT_FOUND` until a billing account is linked. `apikeys` and
`generativelanguage` enable without it.

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
3. Set the region to **AWS Asia Pacific (Singapore) — `aws-ap-southeast-1`**. This must match
   the Cloud Run region; do not accept the default. If Singapore is not offered on the free plan,
   stop and say so — the region pair needs re-deciding, not substituting.
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
    https://agentforge-733000675212.asia-southeast1.run.app
Authorised redirect URI:
    https://agentforge-733000675212.asia-southeast1.run.app/api/auth/callback/google

Expected result:
Four entries total — two localhost, two production.

Verification:
Sign in on the deployed URL; Claude Code confirms the user row in the production database.

Resume by:
Saying "production redirect URI added".
```

**✅ DONE 2026-09-25.** Production sign-in completed end to end against the deployed URL.

**Propagation is real and it is not instant.** The first attempt immediately after saving returned
`Error 400: redirect_uri_mismatch` even though the registered URI was character-identical to the
one the app sent. It succeeded ~90 seconds later with no further change. Wait and retry before
suspecting a typo.

**Do not "verify" this with curl.** Fetching the Google authorization URL without a Google session
returns the ordinary sign-in page, *not* an error — Google validates `redirect_uri` only after it
has identified the account. A clean curl is a false positive. The only valid check is a real
browser sign-in with a session.

### 5. Gemini API key — **MANUAL HUMAN ACTION**

```text
MANUAL ACTION REQUIRED

Reason:
Gemini is the only wired LLM provider. Without a key, Phases 6 and 7 — including the headline
NL→workflow feature — cannot be built or demonstrated.

**Phase 0 finding: this no longer needs a browser.** `gcloud services api-keys create` exists and
is verified present in gcloud 580.0.0, so once M1 is done Claude Code can create the key itself:

```bash
gcloud services enable generativelanguage.googleapis.com
gcloud services api-keys create --display-name="AgentForge Gemini" \
  --api-target=service=generativelanguage.googleapis.com
gcloud services api-keys get-key-string <KEY_ID>   # from the create output
```

Prefer that path. The console route below is the fallback if the API-key command is refused on the
project.

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

**Phase 0 finding — model names.** `gemini-2.0-flash` is **retired** (HTTP 404, the API points to
`gemini-3.8-flash`). Do not hardcode a model name from memory; list models first:

```bash
curl -sS -H "x-goog-api-key: $GOOGLE_GENERATIVE_AI_API_KEY" \
  'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200'
```

Verified working 2026-09-25: **`gemini-flash-latest`** (resolves to `gemini-3.8-flash`). The pinned
name `gemini-3.8-flash` returned **503 "high demand"** in the same second the alias succeeded, so
the provider adapter should retry and fall back across models rather than trusting one name.

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

1. ✅ Neon project exists and answers a query
2. ✅ Google Cloud project exists, billing linked, APIs enabled
3. ✅ OAuth client exists (localhost pass)
4. ✅ `Dockerfile` builds and runs locally
5. ✅ **Deploy** to Cloud Run — *with* the environment variables, not before them
6. ✅ Add the production redirect URI (OAuth pass 2), then allow ~90 s to propagate
7. ✅ Verify behaviour in a browser, against the database
8. ⬜ Cloud Scheduler job (Phase 8)

Steps 5 and 7 swapped places relative to the original plan, and the old step 8 is gone. Both
follow from facts found in Phase 2: a revision missing a variable exits 1, so variables cannot come
after the deploy; and there is **one** Neon database serving local and production alike, so
migrations applied locally are already live. There is no separate production migration step.

There is no separate frontend deploy. **One container serves UI and API** — see `ARCHITECTURE.md` →
*Deployment topology*.

---

## Deploy — **AUTOMATED BY CLAUDE CODE**

This is the exact command that produced revision `agentforge-00001-h4k` on 2026-09-25.
Environment variables go on the **first** deploy too, not afterwards — see below.

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
  --port 8080 \
  --env-vars-file "$SCRATCH/run-env.yaml"
```

**A later redeploy that changes no variable omits `--env-vars-file` entirely:**

```bash
gcloud run deploy agentforge --source . --region "$GCP_REGION"
```

The new revision inherits every variable from the current service configuration. Verified on the
Phase 3 deploy — all 9 names were present on `agentforge-00002-zdg` without being passed again.
Pass the file only when a variable actually changes, and remember it **replaces** the whole set.

Notes:
- `--source .` makes Cloud Build build the `Dockerfile`. No local `docker push`, no ECR equivalent
- **`--env-vars-file` belongs on the first deploy.** A revision with a missing variable calls
  `process.exit(1)` by design (`PROGRESS.md` → *Decisions*, D7), so deploying bare and configuring afterwards
  fails the deploy instead of producing a service to configure
- The first `--source` deploy prompts to create the Artifact Registry repository
  `cloud-run-source-deploy` in the region. Answer yes; it is created once and reused
- `--min-instances 1` removes cold starts during the hackathon, funded by the $300 credit. **Drop
  to 0 after the event** or it bills continuously beyond the Always Free allowance
- `--max-instances 3` is a cost guard, not a scaling strategy
- `--timeout 3600` is the 60-minute ceiling that lets long runs finish inside a request
- The container must listen on `$PORT` (8080). This is the most common first-deploy failure
- `.gcloudignore` controls what is uploaded to Cloud Build. It is committed deliberately so the
  upload is reviewable; without it gcloud writes an untracked one on first deploy

### The service has two URLs — know which one is canonical

**Verified 2026-09-25.** Cloud Run issued both, and both serve the same revision:

| Form | URL | Use |
|---|---|---|
| **Deterministic — CANONICAL** | `https://agentforge-733000675212.asia-southeast1.run.app` | Everything: `AUTH_URL`, OAuth, the demo, the README |
| Legacy hashed | `https://agentforge-i5d2u66boa-as.a.run.app` | Nothing. Works, but do not publish it |

**`--format='value(status.url)'` returns the LEGACY one.** Following the obvious command would
have put the wrong origin in `AUTH_URL` and broken production sign-in. Both are listed in the
`run.googleapis.com/urls` annotation, deterministic first:

```bash
# The canonical URL. Do not use status.url for this.
gcloud run services describe agentforge --region "$GCP_REGION" \
  --format='value(metadata.annotations."run.googleapis.com/urls")' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)[0])'
```

**`UNKNOWN — VERIFY` resolved: the deterministic URL CAN be pre-registered before the first
deploy.** It is `https://<service>-<project-number>.<region>.run.app`, both parts knowable in
advance (`gcloud projects describe <project> --format='value(projectNumber)'`). The predicted URL
matched the deployed one exactly. A future rebuild can therefore register OAuth before deploying.

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

> **There is one Neon database.** Local development and production share `super-mountain-39872886`
> / `production` / `neondb`. A migration applied from a developer machine is **immediately live**.
> There is no staging copy to practise on, so read a destructive migration twice, and never run one
> on demo day. This also means Phase 2 had no separate "migrate production" step — the Phase 1
> migration was already applied.

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
# 1. Revision ready and taking 100% of traffic — AUTOMATED
gcloud run services describe agentforge --region "$GCP_REGION" \
  --format='value(status.latestReadyRevisionName,spec.traffic)'

# 2. Health, from outside — AUTOMATED. Use the CANONICAL url, not status.url.
curl -fsS "$APP_BASE_URL/api/health"

# 3. Logs, no startup errors — AUTOMATED
gcloud run services logs read agentforge --region "$GCP_REGION" --limit 50

# 4. Route gating without a session — AUTOMATED. Must be 307 to /.
curl -sS -o /dev/null -w '%{http_code} -> %{redirect_url}\n' "$APP_BASE_URL/dashboard"

# 5. Env var NAMES landed, without printing any value — AUTOMATED
gcloud run services describe agentforge --region "$GCP_REGION" \
  --format='value(spec.template.spec.containers[0].env[].name)'
```

**6. Auth flow — browser required.** Load the canonical URL, sign in with Google, reload to confirm
the session persists, then sign out. Claude Code proves each step against the database rather than
trusting the screen: count `session` rows before and after. A production sign-in on an account that
already exists must add **one session row and zero user rows** — a second user row would mean
account linking is broken. Sign-out must delete that session row and leave `user` and `account`
intact.

Result on 2026-09-25: sessions 1 → 2 on sign-in, same `userId`, users stayed 1; sign-out returned
`POST 200 /dashboard` and took it back to 1.

**6. Realtime — AUTOMATED + browser.** From Phase 5: trigger a run on the deployed URL and confirm
per-node events arrive incrementally.

**7. One full workflow end to end on the deployed system — AUTOMATED.** From Phase 3 onward, every
phase ends with this.

```bash
node --env-file=.env scripts/verify-api.mjs "$APP_BASE_URL"
```

33 checks: auth gating, owner scoping, graph round-trip, a sequential run, both sides of a branch,
a bounded loop, the failure path, invalid-graph rejection, stale-run reaping, and delete cascade.
It exits non-zero if any check fails, so "it deployed" and "it works" stay different claims.

How it authenticates without a browser: sessions are database-backed, so there is no API token to
mint. The script inserts a real `session` row for an existing user, drives the API with that cookie
exactly as a browser would — the same path `auth()` takes — and deletes the row afterwards. **There
is no test-only bypass in the application.** It needs `DATABASE_URL_UNPOOLED` from `.env`, and a
user row must already exist, so sign in once before running it against a fresh database.

---

## Logs and inspection

```bash
gcloud run services logs read agentforge --region "$GCP_REGION" --limit 100
gcloud run services logs tail agentforge --region "$GCP_REGION"
gcloud run revisions list --service agentforge --region "$GCP_REGION"
gcloud builds list --region="$GCP_REGION" --limit 5   # builds are REGIONAL; without it you see nothing
gcloud builds log <BUILD_ID>          # when a deploy fails, read this before touching the Dockerfile
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Deploy fails during build | Dockerfile or dependency issue | `gcloud builds log <BUILD_ID>`. Read it; do not guess |
| "Container failed to start and listen on PORT" | App hardcodes a port | Listen on `process.env.PORT`, default 8080 |
| OAuth `redirect_uri_mismatch` | Production redirect URI missing, or `AUTH_URL` ≠ deployed origin | Complete OAuth pass 2; make `AUTH_URL` exactly the deployed origin, no trailing slash |
| `redirect_uri_mismatch` when the URI *is* registered correctly | Google has not propagated the change | **Wait ~90 s and retry.** Seen 2026-09-25. Do not start editing a correct entry |
| Auth works on one URL, mismatches on another | The service has two URLs; `status.url` returns the legacy one | Use the deterministic URL everywhere — see *Deploy* |
| `gcloud builds list` shows nothing after a successful deploy | Builds are regional | `gcloud builds list --region=$GCP_REGION` |
| A raw SQL string throws "can now be called only as a tagged-template function" | `@neondatabase/serverless` v1 | Use `sql.query(text, params)`; the tagged template is for interpolated values |
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
# 1. List revisions, newest first. Pick the last known-good one.
gcloud run revisions list --service agentforge --region "$GCP_REGION" \
  --format='table(name,active,creationTimestamp)'

# 2. Shift all traffic to it. Seconds, no rebuild.
gcloud run services update-traffic agentforge --region "$GCP_REGION" \
  --to-revisions <PREVIOUS_REVISION>=100

# 3. Confirm the shift actually happened.
gcloud run services describe agentforge --region "$GCP_REGION" \
  --format='value(status.traffic)'

# 4. Re-verify: health, then the demo path.
curl -fsS "$APP_BASE_URL/api/health"
```

To return to the newest revision afterwards:

```bash
gcloud run services update-traffic agentforge --region "$GCP_REGION" --to-latest
```

**As of 2026-09-25 there is exactly one revision (`agentforge-00001-h4k`), so there is nothing to
roll back to.** The procedure is understood and the commands are correct, but it is untested and
cannot be tested until a second revision exists. First opportunity: the Phase 3 deploy.

**Caveat:** a rollback does **not** revert migrations. Prefer additive migrations so an older
revision still runs against the newer schema. Before demo day, avoid destructive schema changes
entirely. Phase 3's migration is purely additive, so `agentforge-00001-h4k` still runs correctly
against the current schema — which is what makes it a valid rollback target.

**⚠️ This procedure is still UNTESTED.** Two revisions exist as of Phase 3, so it is now possible to
test. Do it once, by hand, before demo day — shift to `agentforge-00001-h4k`, confirm
`/api/health`, then shift back to the newest revision. An untested rollback is not a rollback plan.

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
