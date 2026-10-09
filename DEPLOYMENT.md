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
| Revision | **`agentforge-00089-t45`** — 100% of traffic, **Phase 36** (2026-10-09; `00088-b2x` shipped the phase, `00089-t45` the browser walk's fixes). No migration and nothing stored: **rolling back past `00088-b2x` removes explain and diagnose and loses nothing** — neither writes anything (the copilot route's two new `kind`s). Past `00089-t45` a diagnosis can withhold a fix it could work out, a stale highlight can return and every sentence press zooms the canvas. Past `00085-cff` the copilot goes entirely (D164 — nothing of it was stored). Past `00084-4hb`, "an empty agent `tools` list means every callable node" returns (D160). **Rollback targets are the revisions behind the five kept images (D120)** — after the next prune `00089-t45`, `00088-b2x` (Phase 36), `00087-544`, `00086-wnj` and `00085-cff` (Phase 35); list them with the commands in *Rollback*. Rolling back past `00081-trs` hides run history and stops pruning it (*Rollback*); never roll back past `00072-n8v` while a workflow uses a note or a switched-off node. Cold start measured **6.38 s** on `00061-lwl`, warm 0.58–0.76 s |
| Scaling | **`min-instances 0`** (M12, 2026-10-01 — was 1 through the hackathon window), `max-instances 3`, 1 vCPU / 1 GiB, 3600 s timeout |
| Root key | **Secret Manager `agentforge-root-key`, version `1`.** Every credential's data key is wrapped by it; `GET /api/health` reports `rootKey.provider` so a deployment silently on `ENCRYPTION_KEY` cannot hide |
| Database | Neon `super-mountain-39872886`, `aws-ap-southeast-1` — **16 tables**, migrations `0000`–`0015` applied. **Phase 33 added `0015`**: one nullable column, `run.origin` — applied 2026-10-08 ahead of the deploy. **Phase 32 added `0014`**: three new tables, `tag`, `workflow_tag` and `workflow_star`, nothing existing altered — applied 2026-10-08 ahead of the deploy. **Phase 31 added `0013`**: one nullable column, `run.test`. **Phase 26 added `0012`**, all additive: `workflow.active` (default `true`), `workflow.scheduleArmedFor`, `run.wakeAt` and the partial index `run_wake_idx`. ~12 MB of 0.5 GB, run history ~1.2 MB of it and **pruned by retention since Phase 33** (30 days, or a workflow's newest 200). Each earlier migration's story is in *Migrations* below |
| Observability | **Structured JSON logging on stdout, five log-based metrics (`agentforge_generations` added in Phase 34, and given a `mode` label — `create` or `edit` — in Phase 35; Phase 36's `explain` and `diagnose` arrive as new values of the same label, no metric change), and `/api/health` reporting five dependency checks.** `OPERATIONS.md` is the runbook |
| Last verified | **2026-10-09, Phase 36** — acting as the owner (`scripts/verify-user.mjs`), on `agentforge-00089-t45`: `verify-api` **534 passed / 0 failed / 4 skipped** (by environment: no `VERIFY_GEMINI_KEY` or `VERIFY_DISCORD_WEBHOOK`), including a run diagnosed, its fix proposed, saved and retried to `succeeded` through the API; `verify-security` 84, `verify-a11y` 118, `verify-templates` 47, `verify-integrations` 60 / 2 skipped (M10), `verify-postgres` 65, `verify-providers` 55, `verify-vault` passed, `verify-observability` passed / 1 structural skip, `verify-timers` 34, `verify-retention` passed, `verify-durable.mjs all` passed, `smoke.mjs` **clean, all eight beats, first walk**. In a real browser in Light and Night: three induced failures diagnosed, fixed and run again to `succeeded`; explain with highlighting; contrast audit clean in both. Local `npm run check`: **1541 passing**, coverage 90.67 / 92.49 / 86.02 |

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
| Google Cloud project with billing | `gcloud config get-value project` | `agentforge-hackathon-2026`, on a **paid** billing account since M13 (the trial account closed 2026-10-06) |
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
| `cloud-run-source-deploy` | Artifact Registry repo | Google Cloud | Images built by `--source .`. **Cleanup policy since 2026-10-06 (D120): keep the newest 5, delete the rest once a day old** | **Phase 2 — auto-created** | Yes |
| `run-sources-agentforge-hackathon-2026-asia-southeast1` | Cloud Storage bucket | Google Cloud | The source zip each `--source .` deploy uploads. **Lifecycle since 2026-10-06 (D120): objects deleted after 7 days** — `asia-southeast1` has no Cloud Storage free tier | **Phase 2 — auto-created** | Yes |
| "AgentForge zero" (`72b470cc-…`) | Billing budget | Google Cloud | ₹100/month on `017EB5-0D8A5E-F212CC`, e-mail alerts at 50 / 90 / 100 % of actual spend — the tripwire D113 asks for | **Phase 26 — EXISTS**, 2026-10-06 | Yes |
| "AgentForge Web" (`733000675212-…ntm7`) | OAuth 2.0 Client | Google Cloud | Google sign-in | Phase 0 manual, updated Phase 2 manual | No — console only |
| `agentforge` / `production` / `neondb` | Postgres project/branch | Neon | All persistence | Phase 0 | Partly — console for creation |
| `agentforge-cron` | Cloud Scheduler job | Google Cloud | **The daily safety sweep**, `0 4 * * *` UTC — re-arms timers, fires a slot whose timer was lost, sweeps abandoned runs. Fired schedules every 15 min until Phase 26 | Phase 8 | Yes |
| `agentforge-runs` | Cloud Tasks queue | Google Cloud | Carries durable runs to `POST /api/runs/dispatch` | **Phase 17 — EXISTS**, `asia-southeast1` | Yes |
| `agentforge-root-key` | Secret Manager secret | Google Cloud | The **root key** that wraps every credential's data key | **Phase 21 — EXISTS**, version `1` enabled, user-managed replication in `asia-southeast1` | Yes |
| `agentforge_demo` + role `agentforge_demo_reader` | Postgres database + role | Neon — **same project, same compute endpoint** | **Verification scaffolding for `integration.postgres`.** A separate database rather than a schema in `neondb`, so the application's own 13 tables are unreachable from this credential; the role is granted `SELECT` on one table and nothing else. **Costs nothing**: same compute, a 5-row table | **Phase 23C — EXISTS**, `scripts/setup-demo-db.mjs` | Yes — the script is idempotent |
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
TASKS_QUEUE: "agentforge-runs"
TASKS_LOCATION: "asia-southeast1"
EOF

gcloud run services update agentforge --region "$GCP_REGION" \
  --env-vars-file "$SCRATCH/run-env.yaml"

rm -f "$SCRATCH/run-env.yaml"
```

On the **first** deploy these go on `gcloud run deploy` itself with the same flag — see *Deploy*.
A revision that boots without them exits 1 by design (`PROGRESS.md` → *Decisions*, D7), so the deploy fails.

**To add or change one variable, use `--update-env-vars` instead — it merges.** That is how Phase 17
added the two `TASKS_*` values without restating the other nine, and without handling their values at
all:

```bash
gcloud run deploy agentforge --source . --region "$GCP_REGION" \
  --update-env-vars TASKS_QUEUE=agentforge-runs,TASKS_LOCATION=asia-southeast1
```

It is safe for these two because neither value contains a `,` or an `=`. **Secrets still go in a
file** — the flag treats both characters as delimiters and would put the value in shell history and
the process list.

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

Billing must be enabled even to use the Always Free tier. The $300 / 90-day credit covered the
build — **and then it ended.**

> **The trial closes after 90 days, and it takes the service down with it — learned 2026-10-06
> (M13).** The Free Trial billing account closes itself when the credit is spent *or* 90 days pass,
> whichever is first, and billing is disabled on every linked project: Cloud Run answers every
> request with a 503 and Cloud Tasks, Scheduler, Secret Manager and Artifact Registry refuse every
> call. There is a **30-day grace period**, after which the project's resources are deleted —
> including `agentforge-root-key`, which nothing else holds. The fix is to **upgrade the account to
> a paid one**: Always Free usage is still billed at zero, and D113 records the decision and the
> guard — a **₹100/month budget alert** (50 / 90 / 100 %), because a paid account no longer stops
> at zero by itself. Anyone running a fork on a trial: upgrade before day 90, not after.

**Once the account is paid — run 2026-10-06, after M13.** The budget, then the two standing rules
that keep the build leaks at zero (D120):

```bash
# The budget alert (D113). Its API is off by default; --billing-project names the quota project.
gcloud services enable billingbudgets.googleapis.com
gcloud billing budgets create --billing-account 017EB5-0D8A5E-F212CC \
  --billing-project agentforge-hackathon-2026 --display-name "AgentForge zero" \
  --budget-amount 100INR --threshold-rule percent=0.5 --threshold-rule percent=0.9 \
  --threshold-rule percent=1.0

# Artifact Registry: keep the newest five images, delete the rest once a day old.
cat > /tmp/ar-cleanup.json <<'JSON'
[ { "name": "keep-newest-5", "action": { "type": "Keep" },
    "mostRecentVersions": { "packageNamePrefixes": ["agentforge"], "keepCount": 5 } },
  { "name": "delete-older-than-a-day", "action": { "type": "Delete" },
    "condition": { "tagState": "any", "olderThan": "1d" } } ]
JSON
gcloud artifacts repositories set-cleanup-policies cloud-run-source-deploy \
  --location asia-southeast1 --policy /tmp/ar-cleanup.json --no-dry-run

# The source-upload bucket: a zip is a build input, never read again.
echo '{ "rule": [ { "action": { "type": "Delete" }, "condition": { "age": 7 } } ] }' > /tmp/gcs-lifecycle.json
gcloud storage buckets update gs://run-sources-agentforge-hackathon-2026-asia-southeast1 \
  --lifecycle-file /tmp/gcs-lifecycle.json
```

The first prune was done by hand the same day: 53 of 58 images deleted, by digest, keeping exactly
the images behind `00062` (new), `00061`/`00060`, `00059`, `00058` and `00057`; and 38 source zips
older than seven days. **The bucket shrank at once (687 → 411 MB, a week of uploads); the registry's
reported size did not** — 926.9 MB straight after, with 6 images left. Whether that is lag before
unreferenced layers are reclaimed is `UNKNOWN — VERIFY` (`PROGRESS.md` → *Cloud Resource Inventory*).

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

**The Phase 9 integrations need two more APIs, and this was missed until the first real run.**
A user granting Sheets and Gmail scopes through OAuth is *not* sufficient — the **project** that owns
the OAuth client must also have the APIs turned on, or every call comes back
`Gmail API has not been used in project <number> before or it is disabled`. The node surfaces that
message verbatim, which is how it was diagnosed, but nothing before a live call can detect it:
consent succeeds, the credential stores, both capabilities show ✓, and only the run fails.

```bash
# AUTOMATED BY CLAUDE CODE — required before integration.gmail or integration.sheets can run
gcloud services enable gmail.googleapis.com sheets.googleapis.com
```

Allow a minute or two to propagate; Google's own error says so and it was ready on the first retry.

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

```text
MANUAL ACTION REQUIRED   (pass 3 — Phase 9, incremental authorisation)

Reason:
Sheets and Gmail need OAuth scopes sign-in does not carry. BUILD_PLAN.md Phase 9 requires
incremental authorisation — ask for them when the node is first used, not at sign-in, because
asking for Gmail send access at sign-in is alarming and hurts the demo. That means a second
OAuth flow with its own callback path, and Google rejects any redirect_uri that is not
registered on the client. Without this, Connect Google returns Error 400:
redirect_uri_mismatch and neither Sheets nor Gmail can run.

There is no gcloud command for this. `gcloud alpha iap oauth-clients` manages IAP brands, not
a Web-application client, and Google exposes no API for a client's redirect URIs — checked,
not assumed.

Location:
https://console.cloud.google.com/apis/credentials → project agentforge-hackathon-2026
  → OAuth 2.0 Client IDs → the existing "AgentForge Web" client.

Steps:
1. Open the "AgentForge Web" client.
2. Under "Authorised redirect URIs", ADD URI twice with both values below.
   Keep all four existing entries — replace nothing.
3. Save, and allow ~90 s to propagate (this is real; see the note above).

Values to enter:
    http://localhost:3000/api/integrations/google/callback
    https://agentforge-733000675212.asia-southeast1.run.app/api/integrations/google/callback

Expected result:
Six authorised redirect URIs in total: two /api/auth/callback/google, two
/api/integrations/google/callback, plus the two JavaScript origins already present.

Verification:
Claude Code opens the deployed /settings page, clicks Connect Google, confirms the consent
screen lists the Sheets and Gmail-send scopes, and confirms a credential row of kind
google.oauth in Neon after approval.

Resume by:
Saying "integration redirect URIs added".
```

**The scopes are `sensitive`, not `restricted`** — `…/auth/spreadsheets` and `…/auth/gmail.send`.
Two consequences, both for demo day rather than for this phase:

- The consent screen **stays in `Testing`**, and each judge who needs to sign in is added as a test
  user (cap 100). *Publishing* the app now requires Google verification for the sensitive scopes,
  which takes days — so "publish the app" is **no longer an available option** and the Known Issue in
  `PROGRESS.md` saying either is out of date. Adding test users is the path.
- **The judge never connects Google.** Sign-in (Beat 1) asks for identity only; the presenter's own
  account is already connected before the demo. The consent friction is paid once, by the presenter.

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
8. ✅ Cloud Scheduler job `agentforge-cron` — created Phase 8, verified by a real invocation (HTTP 200)

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
npm run db:generate     # schema change -> a new drizzle/NNNN_*.sql
npm run db:migrate      # applies every pending migration to DATABASE_URL_UNPOOLED
npm run db:studio       # browse the live data
```

Do not run migrations on container start — with more than one instance, concurrent migrations race.
They are run from a local shell against the production database.

### Check for drift first, and afterwards

```bash
node --env-file=.env scripts/verify-schema.mjs
```

**Phase 19A added this because the repository and the database had silently disagreed for days, in
two ways at once, and nothing in the test suite could see either.** `credential_owner_kind_label_idx`
was declared by migration `0001` and simply absent from the database — which made every credential
*write* answer HTTP 500, because `putCredential`'s `ON CONFLICT` names that index and Postgres will
not plan the statement without it. Separately, `drizzle.__drizzle_migrations` held three rows while
five migrations were physically applied, so the next `db:migrate` would have tried to re-apply
`0003` and failed on `CREATE TABLE ... already exists`. Run this before and after any migration.

### An additive migration, and one that is not

An **additive** migration — new table, new nullable column, new column with a default — can be
applied while the previous revision is still serving, which is what Phases 17, 18, 19B and 20 did.
`0007` adds one table and alters nothing, so it went in before the deploy and the old revision, which
knows nothing about `workspace_invitation`, kept serving throughout. `0008` is the same shape in the
other form: three columns on an existing table, each nullable or defaulted, so the previous revision
kept inserting correctly against a table it did not know the shape of. `0009` is both at once — one
`CREATE TABLE` plus seven columns, every one of them nullable or defaulted — and its row counts were
identical before and after.

A migration that **tightens** a constraint cannot. A `NOT NULL` column with no default makes every
insert from the previous revision fail for the length of the deploy. Phase 19A is the worked
example, and the pattern to copy:

| Step | What | Why |
|---|---|---|
| 1 | `node --env-file=.env scripts/rehearse-migration.mjs` | Applies both halves **and the rollback** to a throwaway schema holding a copy of the real rows, and asserts the copy is digest-identical to where it started. The copy is a schema rather than a Neon branch because `neonctl` here is unauthenticated (M9) |
| 2 | Record the row counts of every affected table | The completion criterion is *no data loss, verified by counts before and after* |
| 3 | Apply the **expand** half only — columns nullable, data backfilled | The old revision keeps serving. Temporarily withhold the contract half's entry from `drizzle/meta/_journal.json` so `db:migrate` stops after it |
| 4 | Deploy, and verify the new revision is the only one serving | |
| 5 | Restore the journal and `npm run db:migrate` again — the **contract** half | `NOT NULL`, and drop whatever the new shape supersedes |
| 6 | `scripts/verify-schema.mjs`, then the API and durable suites | |

**Write the rollback by hand and keep it.** Drizzle has no down migrations. Phase 19A's is
`drizzle/rollback_0005_0006.sql`, Phase 19B's is `drizzle/rollback_0007.sql`, Phase 20's is
`drizzle/rollback_0008.sql`, Phase 21's is `drizzle/rollback_0009.sql`, Phase 23D's is
`drizzle/rollback_0010.sql`, Phase 25's is `drizzle/rollback_0011.sql` and Phase 26's is
`drizzle/rollback_0012.sql` — **safe only once no run is `waiting`**, because a pre-26 revision can
neither resume nor sweep one (the file says how to check, and how to close them). Phase 31's is
`drizzle/rollback_0013.sql`, Phase 32's `drizzle/rollback_0014.sql`, and Phase 33's
`drizzle/rollback_0015.sql` — let any retry still queued or waiting finish first, as that file says.
Each is applied with a SQL
client and each also removes its ledger row, so a later `db:migrate` re-applies rather than believing
the work is already done.

**`0010` and `0011` are the class that needs no rehearsal, and saying why is the point.** Each is a
single nullable `ADD COLUMN` with no backfill, no index and no constraint: the previous revision never
selects the column, so it keeps serving correctly while the migration runs, and each rollback is one
`DROP COLUMN` of a column nothing else references. `0011` adds `workspace.onboardedAt` — whether a
workspace has finished the first-run guide — so its rollback loses one preference per workspace and no
credential, no workflow and no run. Compare `0009`, three paragraphs down, whose rollback can destroy
every credential in the product: the distinction is whether the column is the **only copy** of
something, and these two are not.

**Rehearse anything the SQL cannot obviously be read as safe.** `0007` is one `CREATE TABLE`, which
looks trivial and carries one real risk: its **partial** unique index is the conflict target of the
upsert that issues an invitation, and Postgres will not *plan* `ON CONFLICT` without an index it can
match — the same 42P10 failure that made every credential write a 500 before Phase 19A found it. So
it was rehearsed on a throwaway schema first, and the ten checks included issuing, re-issuing,
revoking and re-inviting through the real DDL. The permanent version of that proof is in
`verify-api.mjs`, which exercises the same upsert against the deployed system every phase.

**Sometimes the risk is entirely in the rollback, and it is still worth rehearsing.** Phase 20's
`0008` is three `ADD COLUMN`s and cannot lose anything — but `rollback_0008.sql` is three
`DROP COLUMN`s against `workflow`, the table holding the user's actual workflows, on a free-tier
database with no point-in-time restore. `scripts/rehearse-0008.mjs` applies both directions to a copy
and asserts the copy is digest-identical afterwards, and it additionally proves the **partial** unique
index refuses a duplicate token and permits many nulls, against the real DDL. An index that exists is
not an index that refuses anything, and this one is read by an unauthenticated route.

**Phase 21's rollback is the first that can destroy data, and the first that refuses to.** `0009` is
purely additive, so applying it was safe with the previous revision serving. Reversing it is **not
symmetric**: after a re-key, a credential's data key exists in exactly one place — the `wrappedKey`
column — so `DROP COLUMN "wrappedKey"` discards the only copy of the key and leaves the ciphertext
permanently unreadable. Every stored credential in the product, destroyed by one statement that looks
like the other six.

Three things follow, and all three are implemented rather than described:

1. **The safe rollback does not touch the schema at all.** Shift Cloud Run traffic to the previous
   revision and leave the columns in place — a revision that knows nothing about them reads the rows
   it understands. The only prerequisite is converting the rows back:
   `scripts/rekey.mjs --to-legacy`, which re-seals every credential in the Chapter 1 single-layer
   shape under `ENCRYPTION_KEY` and verifies each one decrypts afterwards.
2. **`rollback_0009.sql` opens with a guard** that counts enveloped rows and `RAISE EXCEPTION`s
   rather than proceeding, naming the count. It is only for removing the columns *after* step 1.
3. **`scripts/rehearse-0009.mjs` puts an envelope on a row and asserts the guard fires** — 15 checks,
   including that the guard aborts the whole script and drops nothing, and that the copy is
   digest-identical after a clean rollback. **A guard that does not fire is worse than no guard**,
   because it is trusted. It also proves the migration is invisible to a serving revision: every
   pre-existing credential comes out legacy, and a write naming none of the new columns still
   succeeds.

> **There is one Neon database.** Local development and production share `super-mountain-39872886`
> / `production` / `neondb`. A migration applied from a developer machine is **immediately live**.
> There is no staging copy to practise on — which is what `scripts/rehearse-migration.mjs` is for:
> it makes one, inside a throwaway schema, and drops it afterwards. Read a destructive migration
> twice, and never run one on demo day. This also means Phase 2 had no separate "migrate production" step — the Phase 1
> migration was already applied.

---

## Cloud Scheduler — **CREATED** (Phase 8), **DAILY SINCE PHASE 26**

The job `agentforge-cron` exists in `asia-southeast1`. **Phase 26 changed what it is for**: schedules
no longer fire from it. Each due time has its own Cloud Tasks timer (`ARCHITECTURE.md` → *Queue* →
*Timers*), so the job is now a **once-a-day safety sweep** — it fires any slot whose timer was lost,
re-arms timers, re-schedules a lost wake, sweeps abandoned runs and prunes the audit log. It was
`PAUSED` by M12 on 2026-10-01 and was **resumed on the daily cadence by Phase 26 on 2026-10-06** —
`ENABLED`, `0 4 * * *`. Its first run (forced by hand with `jobs run`) answered 200 and logged *"The
sweep fired 3 of 3 overdue schedules and armed 6"* — the three slots overdue since 2026-10-02, all
read-only, caught up by D42's rule:

```bash
gcloud scheduler jobs update http agentforge-cron --location asia-southeast1 --schedule "0 4 * * *"
gcloud scheduler jobs resume agentforge-cron --location asia-southeast1
gcloud scheduler jobs describe agentforge-cron --location asia-southeast1 --format='value(state,schedule)'
# ENABLED	0 4 * * *
```

**04:00 UTC** because one of the standing scheduled workflows already fires then, so the two share a
single Neon wake; any hour would do. **Do not shorten it** — a sweep is a wake, and the whole point
of Phase 26 is that the product stops waking Neon to ask whether there is work.

It was originally created with:

```bash
# Read the secret into a variable rather than pasting it — it must not reach a
# shell history, a log, or a transcript.
SECRET="$(node --env-file=.env -e 'process.stdout.write(process.env.CRON_SECRET)')"

gcloud scheduler jobs create http agentforge-cron \
  --location asia-southeast1 \
  --schedule "*/15 * * * *" \
  --time-zone "Etc/UTC" \
  --uri "https://agentforge-733000675212.asia-southeast1.run.app/api/cron/tick" \
  --http-method POST \
  --headers "x-cron-secret=$SECRET" \
  --attempt-deadline 540s \
  --max-retry-attempts 1
```

### Why every 15 minutes and not every minute — **corrected in Phase 8, SUPERSEDED in Phase 26**

> **History.** The cadence below was the right answer while the tick was the only thing that fired
> schedules. Phase 26 replaced it with per-slot timers and a daily sweep; the arithmetic is in
> *Free-tier headroom* → *Neon*. Kept because the reasoning is still how a cadence is chosen.

This file previously specified `* * * * *`. That is wrong on cost, and the numbers are the reason:

| | Every minute | Every 15 minutes |
|---|---|---|
| Neon autosuspend (fixed at 5 min idle on the free plan, **cannot be disabled**) | never reached | reached between ticks |
| Compute awake | 24/7 → 720 h/month | ~5 min per tick → ~240 h/month |
| At the free plan's 0.25 CU floor | **~180 CU-hours** | **~60 CU-hours** |
| Against the free plan's **100 CU-hours/month** | **blows it, mid-month** | fits, with room for the app |

An every-minute tick would suspend the database partway through the month — during a hackathon whose
whole premise is a live demo. 15 minutes leaves ~40 CU-hours for actual use.

**The trade-off, stated honestly:** the effective resolution of a user's cron expression is the tick
interval. A workflow scheduled for 09:00 runs at 09:00–09:15, never on the second. Schedule triggers
are not on the demo path (`DEMO.md` — C13 is mentioned verbally), so this costs the demo nothing.

To change it: `gcloud scheduler jobs update http agentforge-cron --location asia-southeast1
--schedule "*/5 * * * *"`. Shortening it below ~6 minutes re-pins Neon awake, so do it only
briefly and put it back.

`--max-retry-attempts 1` is safe because the tick claims each schedule by compare-and-set before
running it (`CONTRACT.md` → D42), so a retry cannot double-fire. `--attempt-deadline 540s` is above
the worst case of 3 runs × the engine's 120 s ceiling.

### Verifying it

```bash
# 1. The route rejects anything without the secret.
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$APP_BASE_URL/api/cron/tick"    # 401

# 2. Cloud Scheduler itself can reach it. This is a real invocation of the job.
gcloud scheduler jobs run agentforge-cron --location asia-southeast1

# 3. Confirm the ATTEMPT, not just the exit code. Scheduler logs its own HTTP result.
gcloud logging read \
  'resource.type="cloud_scheduler_job" AND resource.labels.job_id="agentforge-cron"' \
  --limit 5 --freshness=1h \
  --format='value(timestamp,severity,httpRequest.status)'                          # 200

# 4. And the app's own side of it — the `cron.tick` event, once a day since Phase 26.
gcloud logging read 'jsonPayload.event="cron.tick"' --limit 3 --freshness=2d \
  --format='value(timestamp,jsonPayload.message)'
#   The sweep fired 0 of 0 overdue schedules and armed 3.
```

### The timers themselves — Phase 26

A schedule fires when its Cloud Tasks task is delivered to `POST /api/cron/fire`. The task sits in
the existing `agentforge-runs` queue — no new resource — so the queue's settings below apply to it.
To see what is armed and what fired:

```bash
gcloud tasks list --queue agentforge-runs --location asia-southeast1 \
  --format='table(name.basename(),scheduleTime,dispatchCount)'        # pending timers and wakes
gcloud logging read 'jsonPayload.event="schedule.delivered"' --limit 10 --freshness=1d \
  --format='value(timestamp,jsonPayload.outcome,jsonPayload.reason,jsonPayload.workflowId)'
#   fired · rearmed · declined stale (an edited or switched-off schedule) · declined gone
```

`scripts/verify-timers.mjs` is the end-to-end check: a schedule firing on time, an edited one's old
timer starting zero runs, the active switch, a two-minute durable wait, and a deleted timer re-armed
by the sweep (~7 minutes).

**Cloud Run's request log lags Scheduler's by a minute or more.** In Phase 8 the Scheduler log showed
the 200 well before the matching Cloud Run entry appeared. Read the Scheduler log for "did it fire",
the Cloud Run log for "what did it do" — and do not conclude a failure from the Cloud Run log alone.

### After judging ends — **BOTH DONE, 2026-10-01 (M12)**

`min-instances 0` is not the only thing to turn down. **Pause the job too**, or it keeps Neon awake
for 240 hours a month for nothing:

```bash
gcloud scheduler jobs pause agentforge-cron --location asia-southeast1
gcloud run services update agentforge --region asia-southeast1 --min-instances 0
```

**Both were run on 2026-10-01**, five days later than they should have been — the roadmap closed
without performing its own turndown, which is why it is now a tracked item (`PROGRESS.md` → M12)
rather than a line of advice. Verified: the job reports `PAUSED`, the `minScale` annotation is gone,
and revision `agentforge-00061-lwl` answers `/api/health` with `status: ok` and 5/5 checks.

**What this cost, stated plainly — true until Phase 26.** A **schedule trigger did not fire** while
the job was paused — `/api/cron/tick` was then the only clock in the product. *(Phase 26 resumed it
daily and moved firing to per-slot timers, which is what closed this.)* The `cron.tick` heartbeat stops too, so
`OPERATIONS.md` → *Is the scheduler alive* expects four an hour and will see none; that expectation
is **suspended, not broken**, and there is no alert policy on it (0 in the project). Cloud Run's own
cold start is now reachable at **6.38 s**.

**To bring it back:**

```bash
gcloud scheduler jobs resume agentforge-cron --location asia-southeast1
gcloud run services update agentforge --region asia-southeast1 --min-instances 1
```

---

## Cloud Tasks queue — **CREATED AND VERIFIED** (Phase 17)

Carries durable runs. `ARCHITECTURE.md` → *Queue* is why it exists; this is how it was made.

```bash
gcloud services enable cloudtasks.googleapis.com

gcloud tasks queues create agentforge-runs \
  --location "$GCP_REGION" \
  --max-attempts 5 \
  --min-backoff 5s \
  --max-backoff 60s \
  --max-doublings 2 \
  --max-concurrent-dispatches 3 \
  --max-dispatches-per-second 5

# The service account the Cloud Run service already runs as.
gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
  --member "serviceAccount:733000675212-compute@developer.gserviceaccount.com" \
  --role roles/cloudtasks.enqueuer --condition=None
```

Every flag is a decision, not a default:

| Flag | Value | Why |
|---|---|---|
| `--max-attempts` | 5 | Matches `MAX_DELIVERIES` in `lib/engine/lease.ts`. The app fails the run on the fifth delivery rather than leaving it to the sweeper, and the two numbers agreeing is what keeps a poison run from looping |
| `--min-backoff` / `--max-backoff` | 5 s / 60 s | A redeploy takes about two minutes, so a redelivery should arrive comfortably inside `SWEEP_GRACE_MS` (120 s) and not hammer a service that is still starting |
| `--max-concurrent-dispatches` | 3 | Matches `--max-instances 3`. **This is a Neon decision, not a Cloud Run one**: every concurrent run spends from the same 100 CU-hours |
| `--max-dispatches-per-second` | 5 | Nothing needs more, and a burst of durable runs waking Neon is the cost that matters |

Then the two variables on the service. `--update-env-vars` **merges**, unlike `--env-vars-file`,
which replaces the whole set — so this adds two without restating the other nine:

```bash
gcloud run deploy agentforge --source . --region "$GCP_REGION" \
  --update-env-vars TASKS_QUEUE=agentforge-runs,TASKS_LOCATION=asia-southeast1
```

`TASKS_PROJECT` is deliberately **not** set: `queueConfig()` reads the project from the metadata
server, which cannot be wrong in the way a copied variable can.

### Verifying it

**`/api/health` reports the queue, and that is the check that matters.** Durable execution degrades
silently by design — with no queue configured, `enqueueRun` falls back to executing in-process,
which is correct locally and a no-op in production that nothing would otherwise report:

```bash
curl -fsS "$APP_BASE_URL/api/health" | python3 -m json.tool
# "queue": { "configured": true, "project": "...", "location": "...", "queue": "agentforge-runs" }
```

`configured: false` on the deployed service means Phase 17 is not actually doing anything.

```bash
gcloud tasks queues describe agentforge-runs --location "$GCP_REGION"   # state: RUNNING
gcloud run services logs read agentforge --region "$GCP_REGION" --limit 30 | grep dispatch
# [dispatch] run=<id> retry=0 status=succeeded
```

### After judging ends

Nothing to pause — an empty queue costs nothing, and Cloud Tasks bills per operation rather than per
hour. Leave it.

---

## Free-tier headroom — **MEASURED in Phase 13, 2026-09-26**

Chapter 2 restored four things into scope — teams, versioning, observability, a credential vault —
on a budget that stayed at zero. `BUILD_PLAN.md` carried every one of the figures below as
`UNKNOWN — VERIFY`, because Phases 17, 19, 21 and 22 are designed on top of them and
**a remembered free-tier number is worth nothing.** These are fetched from the vendors' own
pricing pages and measured against this project's live consumption.

### The summary

| Service | Free allowance | Scope | Measured use | Verdict |
|---|---|---|---|---|
| **Neon compute** | **100 CU-hours/month** | per project | ~60 CU-hours committed to the cron tick until Phase 26; **~0.6** for the daily sweep since | **BINDING**, and since Phase 26 almost entirely available for real work |
| **Cloud Tasks** | **1,000,000 operations/month** | per **billing account** | 0 — not yet used | Not a constraint. ~330k runs/month |
| **Cloud Logging** | **50 GiB/project/month** | per **project** | **6.34 MB / 30 days = 0.0118%** | Not a constraint. ~8,000× headroom |
| **Secret Manager** | **6 active versions, 10,000 access ops/month, 3 rotation notifications** | per **billing account** | 0 — API not yet enabled | Fits, but **rotation notifications are tight** |

**Read the scope column.** Cloud Logging's allowance is per *project*; Cloud Tasks' and Secret
Manager's are per *billing account* and are shared with every other project on
`Billing - AgentForge`. Neon's is per *project*. A limit that resets per account is one another
project can spend on your behalf.

### Neon — the one that actually binds

Confirmed against Neon's own documentation on 2026-09-26: the Free plan is **100 CU-hours per
project per month**, scale-to-zero is fixed at **5 minutes of inactivity and cannot be disabled**,
and the compute floor is **0.25 CU**. 100 CU-hours buys roughly **400 hours awake at 0.25 CU**,
against a ~730-hour month.

The arithmetic that sets the cron tick, now verified rather than assumed:

| Tick | Awake per month | CU-hours at 0.25 CU | Against 100 |
|---|---|---|---|
| `* * * * *` | 730 h (never suspends) | **~182** | **blows it mid-month** |
| `*/15 * * * *` — **current, confirmed `ENABLED`** | ~243 h (4 × 5 min per hour) | **~61** | fits, ~39 spare |

**~39 CU-hours/month was the entire budget for real usage** while the tick ran every 15 minutes —
about 156 hours of additional awake time, or roughly 5 hours a day of genuine activity on top of it.

#### Phase 26 — the tick became a daily sweep, and the clock moved into Cloud Tasks

Computed the same way, with the same 5-minute autosuspend at the same 0.25 CU floor. A wake costs
the request plus five minutes awake, so **one wake ≈ 0.021 CU-hours**:

| What wakes Neon | Wakes per month | Awake per month | CU-hours |
|---|---|---|---|
| `*/15` tick — **before Phase 26** | ~2,920 | ~243 h | **~61** |
| Daily sweep — **since Phase 26** | ~30 | ~2.5 h | **~0.6** |
| A schedule that fires **daily** | ~30 | ~2.5 h | ~0.6 each |
| A schedule that fires **hourly** | ~730 | ~61 h | ~15 |
| A schedule every 15 minutes | ~2,920 | ~243 h | ~61 — exactly the old tick |

So the **idle product** — nobody signed in, no schedules — now costs **~0.6 CU-hours a month**
instead of ~61, and a schedule costs what its own cadence costs and nothing when it is not due.
The database standing today carries three daily schedules (two at 09:00, one at 04:00 sharing the
sweep's wake), so its real floor is **~1.3 CU-hours a month**. **That is the M12 consequence
closed**: schedules fire again, and they no longer pay ~60 CU-hours to do it.

The trade the old table made — "a run starts at or shortly after its slot, within 15 minutes" — is
gone too: a timer fires at its slot, plus a cold start (~6.4 s) when the service is asleep.

**What this does not fix.** A user who schedules something every five minutes keeps the database
awake, and that is their workflow's honest cost, not the platform's. Nothing caps it today; if that
ever matters, the cap belongs on the cron expression's minimum interval (`lib/triggers/cron.ts`).

> **Sharpened in Phase 19A, and it changes which features are expensive.** Neon meters **compute
> time awake**, not statements. A second query inside a request that has already woken the database
> is therefore close to free, and what actually spends the budget is a **new reason to wake an idle
> database** — a poller, a tick, a background job.
>
> Workspaces were designed against that reading and cost essentially nothing: `requireScope()` adds
> one query to requests that already make one, and Phase 19A added no poller, no tick and no
> background job. **Phase 22's analytics is the phase that must be designed against the number** —
> anything that aggregates on a schedule is spending awake time rather than borrowing it.
>
> **RESOLVED, Phase 22, and it cost almost nothing.** The analytics page runs **three statements on
> demand**, when a signed-in person opens it — and a signed-in person has already woken the database.
> There is no rollup job, no materialised view, no cache warmer and no polling: the window selector
> is three links, so a new window is a navigation somebody asked for. **Measured on the deployed
> service, 2026-09-30: 21–27 ms of database time per page view**, over 46 runs and ~200 steps.
> A 30-second auto-refresh on one open tab would instead have cost 120 wakes an hour — that is the
> trade, in numbers. Every query opens on `run_workspace_idx`, present since Phase 19A; Phase 22
> added no index, no column and no migration.

Measured live while writing this: a first query after idle took **917 ms** and the next **103 ms**,
so scale-to-zero is demonstrably active and the wake cost is ~0.9 s. The database is **8,488 kB**
with 1 user, 1 workflow, 1 run, 6 run steps and 3 credentials — storage is nowhere near a limit;
**compute time is the only Neon resource in play.**

#### Storage, re-measured in Phase 18 — versioning does not move the needle

Phase 18 writes a graph snapshot per save, which is the first feature in this project whose cost is
*storage* rather than compute. Measured on the deployed database, 2026-09-27:

| Figure | Measured |
|---|---|
| Whole database | **8.55 MiB** of the **0.5 GB** free allowance — **1.7 %** |
| Stored graph, average | **737 bytes** (`pg_column_size`, so after TOAST compression) |
| Stored graph, the six-node demo workflow | **1,097 bytes** |
| `VERSION_LIMIT` — unlabelled versions kept per workflow | **50** |
| Worst case per fully-edited workflow | ~50 × 1.1 KB ≈ **60 KB** |

At 60 KB per capped workflow, the remaining ~503 MB is several thousand heavily-edited workflows.
**Storage is still not the binding Neon resource; compute is.** The cap exists because unbounded
history is a slow leak with no ceiling, not because the current numbers are close to one — and
because a user who *names* a version is exempt from it, so the thing they meant to keep is kept.

The queries that re-measure it:

```bash
# per-table size and the whole database
psql "$DATABASE_URL_UNPOOLED" -c "select relname, pg_size_pretty(pg_total_relation_size(c.oid)) \
  from pg_class c join pg_namespace n on n.oid = c.relnamespace \
  where n.nspname='public' and c.relkind='r' order by pg_total_relation_size(c.oid) desc"
psql "$DATABASE_URL_UNPOOLED" -c "select pg_size_pretty(pg_database_size(current_database()))"

# what a stored snapshot actually costs
psql "$DATABASE_URL_UNPOOLED" -c "select count(*), avg(pg_column_size(graph))::int, \
  max(pg_column_size(graph)) from workflow_version"
```

> **CU-hours actually consumed — READ 2026-10-01, and it is comfortable.** **0.91 CU-hours**, in a
> billing period that began that same day, so it is a *baseline, not a balance*. Storage 42.44 MB,
> history 16.62 MB, transfer 20.4 MB — all far inside 0.5 GB. The cron costs ~1.97 a day, so a full
> month projects to `0.91 + (1.97 × 30) ≈ 60` against the 100 ceiling: **~40 spare**, which matches
> the budget this section already carried. `PROGRESS.md` → M9 shows the arithmetic. The ~40 is
> headroom for *work*, not licence for a new always-awake reason to keep the database up.
>
> **Why it stays a manual read — Phase 22 sharpened this.** `neonctl` **is** authenticated now, so
> the Phase 13 note that it was not is superseded. The balance still cannot be read from a terminal,
> for a different and more permanent reason: `GET /consumption_history/projects` answers *"This
> endpoint is not available. It is included with Scale plans and above"*, and the legacy
> `compute_time_seconds` / `active_time_seconds` fields on `/projects/{id}` and `/branches` all read
> `0` on the free plan. **It is console-only** — do not spend another session scripting it.
> <https://console.neon.tech> → `agentforge` (`super-mountain-39872886`) → Usage. Tracked as M9.
>
> It did not block Phase 22, because the phase was designed against the *rule* rather than the
> balance — do not add a new reason to wake an idle database — and the feature's own cost was then
> measured directly at 21–27 ms per page view.

### Cloud Tasks — Phase 17's dependency, and it is fine

> **BUILT, Phase 17.** The queue exists and is `RUNNING`. Everything the estimate below predicted
> held: the task carries a run id rather than a payload, so one run is two operations, and the
> runtime dependency list is unchanged because the adapter is one authenticated `fetch` rather than
> `@google-cloud/tasks` and its gRPC stack. Creation and IAM are under *Cloud Tasks queue* below.

$0.40 per million operations after the first **1,000,000 per month free**. A billable operation is
**an API call or a push delivery attempt**, chunked at **32 KB**.

What that means for Phase 17's design:

- One durable run ≈ **2 operations** (one `CreateTask`, one push delivery). A retry adds one more.
- 1,000,000 ops/month ÷ ~3 ops ≈ **330,000 runs/month** free. Nothing this product will do soon.
- **Keep task payloads under 32 KB.** A 96 KB payload is billed as 3 operations, not 1. Phase 17
  should enqueue a run *id*, not a run *payload* — which is the right design anyway, because the
  graph is already in Postgres.
- `ListTasks` is charged per task returned, and an empty list still costs one operation. Do not
  build a polling loop over the queue.
- **Phase 26's timers**: a schedule firing is ~5 operations (create + deliver the timer, create +
  deliver the run, create the next timer) and a durable wait is 2 (create + deliver the wake). The
  daily sweep adds at most one duplicate timer per schedule due within 26 hours. A daily schedule
  is therefore ~180 operations a month — **~5,500 daily schedules** fit in the free million.

`cloudtasks.googleapis.com` is **not yet enabled** on `agentforge-hackathon-2026`. Phase 17 enables it.

### Cloud Logging — Phase 22's dependency, and it is very fine

> **BUILT, Phase 22.** Structured logging ships, four log-based metrics exist, and the prediction
> below held: the constraint was Neon, not Logging. The application added **no dependency** to do
> it — Cloud Run's runtime parses a JSON line on stdout into a `LogEntry`, so the whole transport is
> `console.log`.

$0.50/GiB after the first **50 GiB per project per month**, which includes 30 days of retention,
querying and analysis at no extra charge. Log Router and Log Analytics add nothing. Retention
beyond 30 days is $0.01/GiB/month.

**Measured over the 30 days to 2026-09-26: 6,339,545 bytes — 0.0059 GiB, or 0.0118% of the
allowance.** Phase 22 could increase log volume by three orders of magnitude and still be free.

**The log-based metrics — four created 2026-09-30**, all four confirmed collecting real points on
the deployed service, **and a fifth, `agentforge_generations`, in Phase 34:**

```bash
gcloud logging metrics list --format='table(name,filter)'
```

| Metric | Filter | What it is for |
|---|---|---|
| `agentforge_runs` | `jsonPayload.event="run.finished"` | Volume and failure rate, labelled `status`/`trigger`/`mode` |
| `agentforge_node_latency` | `jsonPayload.event="node.finished"` | A `durationMs` distribution, labelled `nodeType`/`status` |
| `agentforge_model_fallbacks` | `event="model.call" AND jsonPayload.fallback=true` | **The one that matters** — see `OPERATIONS.md` |
| `agentforge_errors` | `severity>=ERROR AND jsonPayload.errorGroup!=""` | Errors labelled by group, so repeats are one line |
| `agentforge_generations` | `jsonPayload.event="generation.finished"` | **Phase 34.** Which attempt produced a generated graph, labelled `outcome`/`selector` |

**They are free.** Log-based metrics bill against Cloud Monitoring's chargeable-metrics allowance
(150 MiB per billing account per month); this project produces a handful of time series with a few
points each. Nothing here is close to a limit.

### Secret Manager — Phase 21's dependency, with one sharp edge

| Item | Free | Beyond |
|---|---|---|
| Active secret versions | **6** | $0.000082192 / version / hour |
| Access operations | **10,000/month** | $0.03 / 10,000 |
| Management operations | **unlimited** | — |
| **Rotation notifications** | **3/month** | **$0.05 each** |

**ENABLED 2026-09-30, Phase 21.** `agentforge-root-key` holds **one** version, and the numbers above
are comfortable at this shape:

- **Versions.** Envelope encryption needs one *root* key, not one per credential — the per-credential
  data keys live in Postgres, wrapped. So the 6-version allowance is a rotation *history*, not a
  capacity limit. A version is retained until destroyed, so the procedure in `SECURITY.md` ends with
  **disabling** the superseded version and destroying it once nothing names it; six rotations without
  ever destroying one is the only way this starts billing.
- **Access operations.** The app caches a version's bytes for the life of the instance — a version is
  immutable, so the cache can never be stale — and caches the `latest` lookup for five minutes.
  Accessing `latest` returns the *resolved* version name, so **sealing costs one access and no
  `versions.list` call**. At `min-instances 1` / `max-instances 3` that is single digits per day:
  measured at **4 accesses** across the whole of Phase 21's verification, against 10,000/month.
- **Rotation notifications are not used at all**, which removes the sharp edge this section
  originally flagged. The 3/month free allowance applies to Secret Manager's own Pub/Sub rotation
  schedule; AgentForge rotates on a procedure the operator runs (`SECURITY.md` → *Rotating the root
  key*) and subscribes to nothing. **There is still nothing in this project that is not free.**

**IAM is scoped to the one secret, not the project:**

```bash
gcloud secrets add-iam-policy-binding agentforge-root-key \
  --member="serviceAccount:733000675212-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

Without it the app answers `RootKeyError` on every credential read and `/api/health` reports
`rootKey.provider` as `secret-manager` while nothing decrypts — which is why the deployed suite
asserts a real decrypt rather than the configuration alone.

### Re-checking these numbers

```bash
# Cloud Logging ingestion over the last 30 days, against the 50 GiB allowance.
TOKEN=$(gcloud auth print-access-token)
curl -sG "https://monitoring.googleapis.com/v3/projects/$GCP_PROJECT_ID/timeSeries" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'filter=metric.type="logging.googleapis.com/billing/bytes_ingested"' \
  --data-urlencode "interval.startTime=$(date -u -v-30d +%Y-%m-%dT%H:%M:%SZ)" \
  --data-urlencode "interval.endTime=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --data-urlencode 'aggregation.alignmentPeriod=86400s' \
  --data-urlencode 'aggregation.perSeriesAligner=ALIGN_SUM' \
  --data-urlencode 'aggregation.crossSeriesReducer=REDUCE_SUM'

# The cron tick is what spends the Neon budget. Confirm it is still */15.
gcloud scheduler jobs describe agentforge-cron --location "$GCP_REGION" \
  --format='value(schedule,state)'                       # */15 * * * *   ENABLED

# Neon CU-hours consumed — MANUAL, see PROGRESS.md M9. neonctl needs a browser:
#   neonctl auth   &&   neonctl consumption projects --project-id super-mountain-39872886
```

**Vendors change free tiers.** Every figure above carries the date it was read. Re-read them before
any phase designs against them, rather than trusting this table a year from now.

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

**5b. The two Phase 25 audits — AUTOMATED.** Both derive what they check from the repository, so
neither can go stale as routes and pages are added:

```bash
APP_BASE_URL="<the canonical url>" node --env-file=.env scripts/verify-a11y.mjs
APP_BASE_URL="<the canonical url>" node --env-file=.env scripts/verify-security.mjs
```

`verify-a11y.mjs` fetches every page and asserts the WCAG 2.2 AA **structure** — `lang`, one `h1`,
no skipped heading level, the `main` landmark and the skip link, accessible names on every control,
no duplicate id, no dangling ARIA reference, no positive `tabindex`. It does **not** check colour
(already gated by `npm run check`) or behaviour (driven in a browser, below).
`verify-security.mjs` enumerates every route file under `src/app/api`, calls each with no session,
and fails if anything outside `SECURITY.md`'s table answers — **or** if anything inside it stops
answering.

**Core Web Vitals, measured on the deployed service, cold cache, India → Singapore, 2026-10-01**
(revision `agentforge-00060-z9v`):

| Page | TTFB | FCP | LCP | CLS | JS | Total |
|---|---|---|---|---|---|---|
| `/` | 202 ms | 1112 ms | **1112 ms** | **0** | 153 KB | 242 KB |
| `/workflows` | 300 ms | 576 ms | **576 ms** | **0** | 153 KB | 242 KB |
| `/workflows/[id]` (canvas) | 372 ms | 652 ms | **652 ms** | **0** | 455 KB | 548 KB |

Every page is inside Google's "good" thresholds (LCP < 2.5 s, CLS < 0.1) with room to spare, and
**CLS is literally zero** — which is the self-hosted-font decision in `src/app/layout.tsx` being
paid back: no webfont request, so no swap, so no shift. The canvas carries 455 KB of JavaScript
because React Flow is on it; that is the heaviest page in the product and it is the one page whose
whole job is the graph. Measured with `PerformanceObserver` in a real browser rather than with
Lighthouse, which would have meant installing a toolchain to learn numbers the browser already
holds.

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

**178 checks** (33 when this line was written at Phase 3, and never updated until Phase 12):
auth gating, owner scoping, graph round-trip, a sequential run, both sides of a branch,
a bounded loop, the failure path, invalid-graph rejection, stale-run reaping, and delete cascade.
It exits non-zero if any check fails, so "it deployed" and "it works" stay different claims.

How it authenticates without a browser: sessions are database-backed, so there is no API token to
mint. The script inserts a real `session` row for an existing user, drives the API with that cookie
exactly as a browser would — the same path `auth()` takes — and deletes the row afterwards. **There
is no test-only bypass in the application.** It needs `DATABASE_URL_UNPOOLED` from `.env`, and a
user row must already exist, so sign in once before running it against a fresh database.

**8. The subsystem suites — AUTOMATED.** One per phase whose subject was one subsystem, so each can
be re-run on its own when that subsystem changes.

```bash
node --env-file=.env scripts/verify-schema.mjs                      # repo schema vs. the live database
APP_BASE_URL="$APP_BASE_URL" node --env-file=.env scripts/verify-durable.mjs all   # Phase 17
node --env-file=.env scripts/verify-vault.mjs "$APP_BASE_URL"       # Phase 21
node --env-file=.env scripts/verify-observability.mjs "$APP_BASE_URL"   # Phase 22
APP_BASE_URL="$APP_BASE_URL" node --env-file=.env scripts/verify-templates.mjs   # Phase 23A
APP_BASE_URL="$APP_BASE_URL" node --env-file=.env scripts/verify-integrations.mjs # Phase 23B
node --env-file=.env scripts/verify-postgres.mjs "$APP_BASE_URL"    # Phase 23C
APP_BASE_URL="$APP_BASE_URL" node --env-file=.env scripts/verify-providers.mjs    # Phase 23D
```

> **Run all of them every phase, not just the one you changed.** Phase 23C found
> `verify-observability.mjs` had been red since 23A on a stale registry count, and Phase 23D found
> `verify-vault.mjs` had been red since 23B on a stale assertion that used `integration.slack` as a
> stand-in for "a kind this product does not store" — which Phase 23B made into a real kind. **A
> suite that is not part of the per-phase routine rots silently**, and then fails in whichever phase
> happens to run it next, looking exactly like that phase's regression.

> **The scripts disagree about where the base URL comes from**, and it is worth checking before
> assuming a connection refused is an outage. `verify-templates.mjs` and `verify-durable.mjs` read
> `APP_BASE_URL`; `verify-api.mjs`, `verify-vault.mjs` and `verify-observability.mjs` read the first
> argument and **default to `http://localhost:3000`**, so passing the deployed URL as an env var
> silently tests a laptop that is not running. `verify-postgres.mjs` and `verify-providers.mjs`
> accept **either**, which is the pattern to copy.
>
> **`node --env-file=.env` overrides a shell `export`.** `.env` sets `APP_BASE_URL=http://localhost:3000`,
> so `export APP_BASE_URL=https://… && node --env-file=.env …` runs against localhost. Measured in
> Phase 23D, where it read as `TypeError: fetch failed`. Pass the URL as an argument where the script
> accepts one.

`verify-vault.mjs` proves the three rotations Phase 21 exists for, and three claims that would
otherwise be taken on trust: that the vault's response contains no part of any stored envelope
(searched for against the real ciphertext, read out of the database), that a refused rotation
leaves the stored secret byte-identical, and that every rotation mints a fresh data key. **It
re-keys the real workspace**, which is unavoidable — re-keying is a property of the whole workspace
and cannot be rehearsed on a throwaway one that holds nothing — and every operation it performs is
idempotent and safe to repeat.

`verify-templates.mjs` proves the four things Phase 23A could not prove locally. That the
**deployed build carries the widened registry** and that every node's `docs` survives
`describeNode`'s JSON round trip to the client. That a template's graph **survives Postgres `jsonb`
and comes back with its positions intact** — a template that reloads with a scrambled layout is a
broken template. That the arithmetic is right rather than merely non-throwing: it asserts the exact
string `4 of 5 scored over 50: Katherine, Ada, Grace, Edsger` and all three `core.switch` routes.
And that **the container has full ICU time-zone data** — `transform.date` formats through `Intl`,
whose zone database is a property of the *image*, and a slim Node base ships `small-icu`, where
`Europe/London` silently degrades to UTC. It deletes every workflow it creates, pass or fail.

`verify-observability.mjs` proves the three things Phase 22 would otherwise be taking on trust. It
**recomputes every analytics figure from SQL independently** and compares — the only check that can
catch an aggregate which is merely plausible. It **creates its own workflow, fails it twice on
purpose, and then finds those failures in Cloud Logging** rather than in the database, which is the
phase's objective stated as a test. And it **measures what the page costs** and prints the number.
It deletes what it made.

> **Running `verify-api.mjs` twice inside a minute reports four failures that are not regressions.**
> It makes real Gemini calls and the free tier allows 20 requests a minute per model; the four are
> all generation checks, and `jsonPayload.detail` says *"Quota exceeded"* in the provider's own
> words. Wait a minute and re-run before believing it.

**9. A real browser — NOT OPTIONAL.** `CLAUDE.md` records why, and Phase 21 was the seventh time:
393 API checks and 61 vault checks all passed over a log list whose dividers were full-strength ink
rules, an empty-state paragraph describing secrets that were not there, and a "Not connected" list
that offered a way to connect for one kind out of three. **No suite in this repository can see any
of that.**

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

**But only the newest five images are kept (D120, since 2026-10-06)**, so a revision older than
those five deploys has no image and cannot take traffic. List the live rollback targets by image,
not by revision name — two revisions can share one image (`00060-z9v` and `00061-lwl` do):

```bash
gcloud artifacts docker images list \
  asia-southeast1-docker.pkg.dev/agentforge-hackathon-2026/cloud-run-source-deploy/agentforge \
  --format='value(version,createTime)'
gcloud run revisions list --service agentforge --region "$GCP_REGION" --limit 8 \
  --format='value(metadata.name,spec.containers[0].image.basename())'
```

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

**TESTED 2026-09-26 (Phase 12), and it works exactly as written above.** Traffic was shifted from
`agentforge-00021-v4s` to `agentforge-00020-rcr`, confirmed by `/api/health` reporting the older
revision, **the whole demo path was walked clean on it**, and `--to-latest` restored the newest
revision. **Each shift took ~15 seconds** and neither required a rebuild.

**Never roll back past `agentforge-00072-n8v` (Phase 30) while any workflow uses a sticky note or a
switched-off node** (D134). Neither is a migration — both are optional fields inside the graph's
`jsonb` — so nothing in the database stops an older revision serving them, and that is the hazard: a
revision from before Phase 30 does not know either field, **runs a switched-off node** (a Discord post
someone switched off is sent), and drops both fields from any graph it saves. Check first:

```sql
select count(*) from workflow
where graph->'notes' is not null or jsonb_path_exists(graph, '$.nodes[*] ? (@.disabled == true)');
```

**Rolling back past `agentforge-00076-pv6` (Phase 31) is safe, and loses pins.** A pinned output is
a field inside the graph's `jsonb` like a note, so an older revision serves it unknowingly — but in the
safe direction: it does not know pins, so it **executes every node for real** in every run, which is
what every production run does anyway (D139). What it costs is the pins themselves, dropped from any
graph that revision saves, and the test label: an older revision never writes `run.test`, and counts
earlier test runs in analytics again. To see what would be lost:

```sql
select count(*) from workflow where jsonb_path_exists(graph, '$.nodes[*].pinned');
```

**Rolling back past `agentforge-00078-ktw` (Phase 32) is safe, and hides the library.** Migration
`0014` only added tables an older revision never reads, so tags and stars stay in the database and
simply stop showing; duplicated and imported workflows are ordinary workflows and keep working —
including their `active: false`, which every revision since Phase 26 honours. Nothing to count first.

**Rolling back past `agentforge-00081-trs` (Phase 33) is safe, and hides run history.** Migration
`0015` only added `run.origin`, which an older revision never reads, so `/runs` and the run pages go,
retries are no longer offered, and **the daily sweep stops pruning runs** — storage then grows as it
did before Phase 33 (~7.7 KB a run). An older revision does not know the `reused` step status: it
draws such a step without a look of its own, and **a retry still queued or waiting when it takes over
would be resumed by a worker that does not read a reused step's output**. Check first, and let them
finish:

```sql
select count(*) from run where origin is not null and status in ('queued', 'running', 'waiting');
```

**Caveat:** a rollback does **not** revert migrations. Prefer additive migrations so an older
revision still runs against the newer schema. Before demo day, avoid destructive schema changes
entirely. Phase 3's migration is purely additive, so `agentforge-00001-h4k` still runs correctly
against the current schema — which is what makes it a valid rollback target.

**Two things worth knowing before you need this in a hurry:**

- `--to-latest` restores the `latestRevision: True` setting, not a pin to a named revision. Verify
  with `--format='value(status.traffic)'` and expect `latestRevision` back in the output — a pinned
  service silently ignores the next deploy's traffic.
- The demo path was re-walked **on the rolled-back revision**, not just `/api/health`. A health check
  proves the container starts; it does not prove the product works. Roll back, then run
  `scripts/smoke.mjs`.

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
