# OPERATIONS.md — running AgentForge in production

**Created in Phase 22.** `DEPLOYMENT.md` says how to get a change onto Cloud Run. This file says
what to do once it is there: what to look at, what each signal means, and what to do when one of
them goes wrong.

It assumes nothing except a terminal with `gcloud` authenticated against
`agentforge-hackathon-2026`. **Every question below is answerable without opening a database
client** — that is the objective Phase 22 was written against.

---

## The system in one paragraph

One Cloud Run service (`agentforge`, `asia-southeast1`, **`min-instances 0`** since the M12
turndown on 2026-10-01 — a cold first request costs ~6.4 s) serving a Next.js
application against one Neon Postgres database. Runs execute either inside the request that started
them or on a Cloud Tasks delivery. **Since Phase 26 a schedule fires from its own Cloud Tasks timer**,
armed for the exact due time and delivered to `/api/cron/fire`, and a run waiting on a long delay is
woken the same way. One Cloud Scheduler job pokes `/api/cron/tick` **once a day** (04:00 UTC) as a
safety sweep — lost timers, lost wakes, abandoned runs, expired rows. Credentials are sealed under a root key in
Secret Manager. There is no other moving part: no cache, no worker pool, no message bus, no
third-party observability agent.

**Everything it emits is one JSON object per line on stdout**, which Cloud Run turns into a Cloud
Logging entry at no cost. There is no exporter to fall over and nothing buffered to lose.

---

## The first five minutes

Run these in order. They take about thirty seconds and they answer "is it up, and is it whole".

```bash
export GCP_REGION=asia-southeast1
export APP_BASE_URL=https://agentforge-733000675212.asia-southeast1.run.app

# 1. Is it serving, and which revision?
gcloud run services describe agentforge --region "$GCP_REGION" \
  --format='value(status.url,status.latestReadyRevisionName,status.traffic)'

# 2. Is it whole? This is the one call that matters.
curl -fsS "$APP_BASE_URL/api/health" | python3 -m json.tool

# 3. Has anything errored in the last hour?
gcloud logging read \
  'resource.type=cloud_run_revision AND severity>=ERROR' \
  --limit 20 --freshness 1h --format='value(timestamp,jsonPayload.event,jsonPayload.message)'
```

### Reading `/api/health`

`status` is a rollup of the `checks` array and has three values:

| `status` | HTTP | What it means | What to do |
|---|---|---|---|
| `ok` | 200 | Everything a production deployment should have | Nothing |
| `degraded` | **200** | Serving correctly, with a guarantee quietly missing | Read `checks`, act on the `detail` |
| `error` | **503** | The database is unreachable | Below, *The database is unreachable* |

**`degraded` answers 200 on purpose.** Failing a health check would take a working revision out of
service over a configuration warning, which is a worse outcome than the warning. The distinction
exists so an uptime check can page on 503 and a human can notice `degraded`.

| Check | `ok` means | `degraded` means |
|---|---|---|
| `database` | A real `select 1` round trip returned | — (it is `error` or nothing) |
| `schema` | Drizzle's migration history was readable | No migration history — has `db:migrate` run? |
| `queue` | `TASKS_QUEUE` is set and its location is known | Runs execute in-process and **do not survive a redeploy** |
| `rootKey` | The root key comes from Secret Manager | It is `ENCRYPTION_KEY`, and **cannot be rotated** without re-encrypting |
| `registry` | The node registry loaded | — |

`migrations` is the count the database has applied; `registry` is the number of node types. Both are
numbers rather than verdicts, because this route says *what is*, and `verify-schema.mjs` says whether
that is *right*.

---

## The signals

### Log events

Every entry carries `severity`, `message`, `event`, and Cloud Run's own `trace` so it joins that
request's entry in Cloud Run's request log. The catalogue lives in `src/lib/logging/events.ts` and
**a test asserts that the five names the metrics below depend on still exist** — a renamed event
would otherwise leave a metric reporting zero forever, which looks exactly like a healthy system.

| `event` | Severity | When | Carries |
|---|---|---|---|
| `run.started` | INFO | A run row was created | `trigger`, `mode`, `workflowVersion` |
| `run.finished` | INFO / ERROR | A run reached a terminal status | `status`, `durationMs`, `attempt`, `resumed` |
| `node.finished` | INFO / ERROR | One node finished | `nodeId`, `nodeType`, `status`, `durationMs` |
| `model.call` | INFO / WARNING / ERROR | A `generate` resolved | `requested`, `answered`, `fallback`, `attempts` |
| `generation.finished` | INFO / WARNING | A workflow generation ended (Phase 34) — WARNING when neither attempt produced a valid graph | `outcome` (`first` · `second` · `failed`), `attempts`, `model`, `selector`, `selected`, `selectorFellBack`, `promptChars`, `unsupported`, `issues`, `durationMs` |
| `queue.degraded` | **ERROR** | A durable run could not be enqueued | `reason` |
| `queue.delivered` | INFO | A Cloud Tasks delivery was handled | `handled`, `status`, `retryCount` |
| `run.waiting` | INFO | A run paused at a long delay (Phase 26) | `wakeAt`, `trigger` |
| `schedule.delivered` | INFO | A schedule timer arrived (Phase 26) | `workflowId`, `scheduledFor`, `outcome`, `reason`, `runId` |
| `cron.tick` | INFO | The daily sweep ran | `due`, `fired`, `skipped`, `cleared`, `armed`, `woken`, `swept` |
| `api.error` | ERROR | A request threw unexpectedly | `errorGroup`, `errorName` |
| `system.warning` | WARNING / ERROR | A refusal or repair nobody asked for | varies |

**An `ApiError` is never logged.** A 404 for another workspace's workflow is the authorisation layer
working, not a fault; logging thousands of correct refusals at ERROR would bury the real ones.

### Log-based metrics

Four created in Phase 22, and a fifth in Phase 34. They are free: log-based metrics bill against
Cloud Monitoring's chargeable-metrics allowance, and this project's handful of time series is nowhere
near it.

```bash
gcloud logging metrics list --format='table(name,filter)'
```

| Metric | Answers |
|---|---|
| `agentforge_runs` | Run volume and failure rate — one metric, labelled `status`, `trigger`, `mode` |
| `agentforge_node_latency` | A distribution of `durationMs`, labelled `nodeType` and `status` |
| `agentforge_model_fallbacks` | **The important one.** Calls the requested model did not answer |
| `agentforge_errors` | Every ERROR, labelled by `errorGroup` — repeats are one line, not a rising count |
| `agentforge_generations` | Workflow generations, labelled `outcome` (`first`, `second`, `failed`) and `selector` — **which attempt produced the graph** (Phase 34) |

---

## `agentforge_model_fallbacks` — read this one first

**A fallback is a success from the outside.** The run finishes, the canvas streams, nothing errors.
That is the entire point of having a fallback chain, and it is exactly why Chapter 1 could spend
**92 seconds** on a single agent step for days without anybody noticing: the configured model had
started timing out, and every call was quietly being answered by the second model in the chain after
a wedged attempt. No other signal in this system moves when that happens.

So: **a sustained non-zero fallback rate means the head of the chain is degrading**, whatever the
success rate says.

```bash
# What is actually being asked for, and what is actually answering.
# `provider` was added in Phase 23D — ask it first, because with two providers the first
# question is whether the degradation is one vendor's or ours.
gcloud logging read \
  'resource.type=cloud_run_revision AND jsonPayload.event="model.call" AND jsonPayload.fallback=true' \
  --limit 20 --freshness 6h \
  --format='value(timestamp,jsonPayload.provider,jsonPayload.requested,jsonPayload.answered,jsonPayload.attempts,jsonPayload.durationMs)'
```

**The metric's filter did not change in Phase 23D** — it is still `jsonPayload.fallback=true` — so
the log-based metric kept collecting across the change rather than needing to be recreated.

**When it fires:**

1. **Look at `provider` first.** A fallback rate confined to one provider is that vendor degrading;
   a rate across both is far more likely to be us — a network path, a budget, or a deploy. The
   circuit breakers are per provider (`health.ts`), so one provider's outage cannot reorder the
   other's chain and the two signals are genuinely independent.
2. Check whether it is a quota wall rather than a dead model. **Gemini's free tier for
   `gemini-3-flash` is 20 requests a *day*** (the 429 said so on 2026-10-08:
   `generate_content_free_tier_requests, limit: 20`) — so the default model is spent by a morning of
   agent runs, and from then on `gemini-3.5-flash-lite` answers; Groq allows 1,000 requests and
   200,000 tokens a day per model, 8,000 tokens a minute. A burst of verification traffic hits
   either. `jsonPayload.detail` says so in the provider's own words.
3. If it persists, re-measure rather than guess: `npm run probe:models` makes real calls on both the
   text and tool-calling paths and prints a table. **Pass `--provider groq` for the other one** —
   it defaults to Google.
4. Move the healthy model to the front of that provider's chain — `FALLBACK_MODELS` in
   `src/lib/ai/gemini.ts`, or `GROQ_FALLBACK_MODELS` in `src/lib/ai/groq.ts`; `providers.ts` reads
   both rather than restating them — **from the
   measurement, never from memory**, and redeploy.

> **Observed 2026-09-30, on the deployed service, within minutes of this metric existing.**
> `gemini-3-flash-preview` — the configured default — was being answered by `gemini-3.5-flash-lite`
> on nearly every call, having hit its free-tier quota. Every affected run *succeeded*. This is the
> Chapter 1 regression, caught the first time the instrument existed to catch it.

---

## `agentforge_generations` — is generation getting worse?

**Phase 34.** Every `POST /api/workflows/generate` that got an answer from the model ends in one
`generation.finished` line: `outcome` is `first` when the first answer was a valid graph, `second`
when it took the retry, and `failed` when neither was (a WARNING, and a 422 to the user). A provider
failure — a bad key, a quota wall — is not an outcome; nothing was produced to judge, and
`model.call` records it.

```bash
gcloud logging read \
  'resource.type=cloud_run_revision AND jsonPayload.event="generation.finished"' \
  --limit 20 --freshness 7d \
  --format='value(timestamp,jsonPayload.outcome,jsonPayload.model,jsonPayload.selected,jsonPayload.promptChars,jsonPayload.durationMs)'
```

**A rising share of `second` or `failed` means generation is getting worse**, and the first
question is whether the model changed — a fallback answering (`model` differs from the default), a
preview model replaced — before the prompt. Then reproduce it offline-first: `npm run eval:generate`
replays the recorded eval set with no key; `-- --live` runs it against a real model and says which
cases fail and why. `selected` and `promptChars` are there to rule selection in or out: the eval set
asserts the selector gives every case what it needs, and `selectorFellBack` is only ever true for
the model selector, which is not shipped.

---

## Following one request

Cloud Run writes a request log for every request — method, path, status, latency — and charges
nothing for it. **AgentForge therefore does not log any of that a second time.** It emits Cloud Run's
own trace id on its entries instead, and the join is the query below. This is why there is no
`api.request` event.

```bash
# Everything, ours and Cloud Run's, for one trace.
TRACE=<the 32-hex trace from any entry>
gcloud logging read \
  "resource.type=cloud_run_revision AND trace:\"$TRACE\"" \
  --limit 50 --format=json --freshness 1h
```

### Following one run

```bash
gcloud logging read \
  'resource.type=cloud_run_revision AND jsonPayload.runId="<run id>"' \
  --limit 50 --freshness 24h \
  --format='value(severity,jsonPayload.event,jsonPayload.nodeId,jsonPayload.status,jsonPayload.durationMs,jsonPayload.detail)'
```

That returns `run.started`, one `node.finished` per step, and `run.finished` — which node failed,
with what message, and how long each took, **without opening the database.**

**Or open it**: `/runs/<run id>` is the run on the graph it executed, every step with its logs, and —
opened — what each step was given and produced (Phase 33). `/runs?status=failed&from=<day>` is a
day's failures, and each analytics failure group links to its newest run. A failed run there can be
**retried from the step that failed** once its cause is fixed: the steps before it are carried over,
not executed again, so a retry does not send the email it already sent.

### Chasing one failure group

The eight-character `errorGroup` shown on the analytics page is the same fingerprint the logs carry,
computed by the same function (`src/lib/logging/fingerprint.ts`). Paste it straight in:

```bash
gcloud logging read \
  'resource.type=cloud_run_revision AND jsonPayload.errorGroup="547deacf"' \
  --limit 50 --freshness 7d \
  --format='value(timestamp,jsonPayload.runId,jsonPayload.detail)'
```

---

## Runbooks

### The database is unreachable — `/api/health` answers 503

1. It is almost always Neon waking. Scale-to-zero is fixed at five minutes of inactivity on the free
   plan and **cannot be disabled**; the first query after idle takes ~0.9 s. Retry once before
   treating it as an incident.
2. If it persists, check Neon's own status and that the project is not suspended for exceeding
   100 CU-hours: <https://console.neon.tech> → `agentforge` (`super-mountain-39872886`) → Usage.
3. The application holds no state, so nothing needs restarting once the database returns.

### Runs stopped surviving redeploys — `queue` is `degraded`, or `queue.degraded` is firing

This is the failure mode with **no user-visible symptom**. Runs still execute, still checkpoint and
still finish; they simply stop being durable.

```bash
gcloud logging read 'resource.type=cloud_run_revision AND jsonPayload.event="queue.degraded"' \
  --limit 10 --freshness 24h --format='value(timestamp,jsonPayload.reason,jsonPayload.detail)'

gcloud tasks queues describe agentforge-runs --location asia-southeast1   # expect RUNNING
gcloud run services describe agentforge --region asia-southeast1 \
  --format='value(spec.template.spec.containers[0].env)' | tr ',' '\n' | grep TASKS_
```

- `reason: unconfigured` → `TASKS_QUEUE` is unset on the service. Re-set it with
  `--update-env-vars` (which **merges**; `--env-vars-file` replaces the whole set).
- Anything else → usually a missing `cloudtasks.enqueuer` binding on the runtime service account.

### A schedule did not fire

**Since Phase 26 two things fire a schedule**, so check them in this order.

**1. Its timer.** Every schedule has a Cloud Tasks task armed for its due time; the trigger panel
says *Timer: Armed* or *Not armed*. A delivery is logged as `schedule.delivered` whatever happened:

```bash
gcloud logging read 'jsonPayload.event="schedule.delivered" AND jsonPayload.workflowId="<ID>"' \
  --limit 10 --freshness 2d \
  --format='value(timestamp,jsonPayload.outcome,jsonPayload.reason,jsonPayload.scheduledFor)'
gcloud tasks list --queue agentforge-runs --location asia-southeast1 \
  --format='table(name.basename(),scheduleTime,dispatchCount)'
```

- `fired` — it worked; look at the run.
- `declined` / `stale` — the slot had moved (the expression was edited) or the workflow was
  switched off. Correct behaviour: a stale timer starts nothing by design.
- `declined` / `forged` — the token did not verify. **Expected for a day after `AUTH_SECRET` is
  rotated** (`SECURITY.md`); the daily sweep re-arms under the new key.
- no delivery at all, and *Not armed* — the arm failed. Look for `queue.degraded` with a
  `workflowId`: almost always a missing `cloudtasks.enqueuer` binding or billing (M13). Saving the
  workflow retries the arm; so does the sweep.

**2. The daily sweep.** It fires any slot that is due and was never fired, and it is logged on
**every** run, including one that finds nothing — that makes `cron.tick` a heartbeat rather than an
event. **Expect one a day, around 04:00 UTC.**

```bash
gcloud logging read 'resource.type=cloud_run_revision AND jsonPayload.event="cron.tick"' \
  --limit 5 --freshness 3d --format='value(timestamp,jsonPayload.fired,jsonPayload.armed,jsonPayload.woken)'

gcloud scheduler jobs describe agentforge-cron --location asia-southeast1 \
  --format='value(schedule,state)'    # 0 4 * * *   ENABLED
```

**Do not "fix" a late schedule by making the sweep more frequent.** The sweep is a safety net, not
the clock; a sweep every 15 minutes is ~61 CU-hours a month, which is the cost Phase 26 removed.
Fix the timer instead.

### A run is stuck in Waiting

A `waiting` run is paused at a long `core.delay` and holds no lease; its wake is a Cloud Tasks task
to `/api/runs/dispatch` scheduled for `wakeAt`. If `wakeAt` is in the past:

- **less than ten minutes past** — the queue may still be retrying the delivery. Wait.
- **more than ten minutes past** — the wake task was lost or never created (look for
  `queue.degraded` "is waiting but its wake could not be scheduled"). The next daily sweep
  re-schedules it (`woken` in `cron.tick`); to do it now, run the sweep:
  `gcloud scheduler jobs run agentforge-cron --location asia-southeast1`.

Stop on the canvas cancels a waiting run at once.

### A deploy went wrong

Traffic shift is about fifteen seconds and has been tested.

```bash
gcloud run revisions list --service agentforge --region asia-southeast1 --limit 5
gcloud run services update-traffic agentforge --region asia-southeast1 --to-revisions <REVISION>=100
curl -fsS "$APP_BASE_URL/api/health" | python3 -c 'import json,sys;print(json.load(sys.stdin)["revision"])'
# and back
gcloud run services update-traffic agentforge --region asia-southeast1 --to-latest
```

**A rollback across a migration is not a traffic shift.** Every migration in this project is additive
for exactly this reason: the previous revision keeps serving against the new schema. `0009` is the
one whose *schema* rollback can destroy data, and `drizzle/rollback_0009.sql` refuses to run while
any credential is enveloped. Its real rollback is `scripts/rekey.mjs --to-legacy`, then shift
traffic. `SECURITY.md` has the procedure.

### Credentials, keys and rotation

All of it — rotating a stored credential, rotating a webhook token, rotating the root key, and what
this product deliberately does **not** claim to protect against — is in `SECURITY.md`. It is not
duplicated here, because a rotation procedure that exists in two files is a rotation procedure that
will disagree with itself.

---

## The budget

**Zero, and it is binding.** The one that actually constrains anything is Neon.

| Service | Free allowance | Where it stands |
|---|---|---|
| **Neon compute** | **100 CU-hours/month** | **~0.6 committed by the daily sweep** since Phase 26 (D114), plus real use. It was ~61 of the 100 under the `*/15` tick — **the binding constraint** — and M14 measures the new figure. *Corrected in Phase 33: this row still described the paused tick of M12* |
| Neon storage | 0.5 GB | ~12 MB, of which run history ~1.2 MB (155 runs, 2026-10-08) — **bounded by retention since Phase 33** |
| Cloud Run | Always Free | **`min-instances 0`** since 2026-10-01 (M12); was `min-instances 1`, also inside it |
| Cloud Tasks | 1,000,000 ops/month | ~2 per durable run |
| Cloud Logging | 50 GiB/project/month | 6.34 MB per 30 days measured before Phase 22 |
| Secret Manager | 6 versions, 10,000 access ops/month | 1 version, single-digit accesses a day |

**Neon meters compute time *awake*, not statements.** A second query inside a request that has
already woken the database is close to free. What spends the budget is **a new reason to wake an idle
database** — a poller, a tick, a background job.

That is the whole reason the analytics page is built the way it is:

- It runs **three statements on demand**, when a person opens it. A person opening a page has already
  woken the database by signing in.
- It **does not poll, does not stream and does not refresh.** The window selector is three links, so
  a new window is a navigation somebody asked for.
- **Nothing aggregates on a schedule.** There is no rollup table and no cache warmer.
- **Test runs are in no figure** (Phase 31, `run.test`): one node tested alone, or a run that used
  pinned outputs, says nothing about how the workflow does for real. They are counted by a fourth
  statement in the same parallel round trip, and the page says how many it left out. A run that looks
  missing from the page is first a question of whether it was a test.

**Measured on the deployed service, 2026-09-30: 21 ms of database time per page view**, over 46 runs
and 200-odd steps. A 30-second auto-refresh on one open tab would have cost 120 wakes an hour
instead; that is the trade, stated in numbers.

### Run history and storage

**Run history is the one table that grows by itself**, so it is pruned (Phase 33, D153): a finished
run goes when it is **more than 30 days old, or when 200 newer runs of its workflow exist**. A run
that is queued, running or waiting is never pruned. The daily sweep does it — `prunedRuns` in its
`cron.tick` line — at most 5,000 a sweep, oldest first; nothing else runs on a clock for it.

Measured 2026-10-08: **~7.7 KB a run on disk** with its steps and indexes. A workflow at its cap is
~1.5 MB; at the worst a run can be (a 256 KB HTTP body), ~51 MB — a tenth of the plan. The
arithmetic for a workspace is *runs × 7.7 KB*, and *Settings → Workspace* shows the run count.

```bash
# Did the sweep prune? Its line carries the count.
gcloud logging read 'resource.type=cloud_run_revision AND jsonPayload.event="cron.tick"' \
  --limit 5 --freshness 7d --format='value(timestamp,jsonPayload.prunedRuns,jsonPayload.swept)'

# What the rule would delete now, across every workspace — a dry run, deleting nothing — and the
# rule itself proved against a throwaway workspace.
node --import ./scripts/test-register.mjs --env-file=.env scripts/verify-retention.mjs
```

If storage climbs faster than this predicts, the cause is large step bodies, not run count: one
workflow posting 256 KB HTTP responses fills its 200 runs fifty times faster than a log. Neon's
console → *Tables* shows `run_step` against the rest.

### Re-reading the meters

```bash
# Cloud Logging ingestion over 30 days, against 50 GiB.
TOKEN=$(gcloud auth print-access-token)
curl -sG "https://monitoring.googleapis.com/v3/projects/agentforge-hackathon-2026/timeSeries" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'filter=metric.type="logging.googleapis.com/billing/bytes_ingested"' \
  --data-urlencode "interval.startTime=$(date -u -v-30d +%Y-%m-%dT%H:%M:%SZ)" \
  --data-urlencode "interval.endTime=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --data-urlencode 'aggregation.alignmentPeriod=86400s' \
  --data-urlencode 'aggregation.perSeriesAligner=ALIGN_SUM'

# The sweep is the product's only standing reason to wake Neon. Confirm it is still daily.
gcloud scheduler jobs describe agentforge-cron --location asia-southeast1 --format='value(schedule,state)'
```

> **A paid billing account since M13 (D113)** — Always Free usage is billed at zero, and a budget
> alert at ₹100/month (50 / 90 / 100 %) is the tripwire. The two known leaks outside Always Free are
> Artifact Registry (0.5 GB free; every deploy adds an image) and Cloud Storage in
> `asia-southeast1` (its free tier covers only three US regions). **Both are held by standing rules
> since 2026-10-06 (D120)** — the registry keeps the newest five images, the source bucket deletes
> uploads after seven days — so neither should grow. Check them when the alert fires:
> `gcloud artifacts docker images list asia-southeast1-docker.pkg.dev/agentforge-hackathon-2026/cloud-run-source-deploy --include-tags`
> (expect 5) and `gcloud storage du -s gs://run-sources-agentforge-hackathon-2026-asia-southeast1`
> (expect a week of ~20 MB zips). More than that means a policy was removed.

> **Neon CU-hours consumed cannot be read from a terminal on the free plan.** `neonctl` is
> authenticated, but `/consumption_history/*` answers *"This endpoint is not available. It is
> included with Scale plans and above"*, and the legacy `compute_time_seconds` fields on
> `/projects/{id}` read 0. **Read it in the console**: <https://console.neon.tech> → `agentforge` →
> Usage. Tracked as M9 in `PROGRESS.md`.

---

## Verifying a deployment

Exit codes are not evidence. These four suites are.

```bash
node --env-file=.env scripts/verify-schema.mjs                                  #  6 checks
node --env-file=.env scripts/verify-api.mjs           "$APP_BASE_URL"           # ~390 checks
APP_BASE_URL="$APP_BASE_URL" node --env-file=.env scripts/verify-durable.mjs all
node --env-file=.env scripts/verify-vault.mjs         "$APP_BASE_URL"           # 61 checks
node --env-file=.env scripts/verify-observability.mjs "$APP_BASE_URL"           # Phase 22
```

`verify-observability.mjs` creates its own workflow, fails it twice on purpose, finds those failures
in Cloud Logging, checks the analytics figures against SQL computed independently, and deletes what
it made.

**Two things no suite can do.** `verify-api.mjs` makes real Gemini calls, so running it twice inside
a minute exhausts the 20-requests-per-minute free tier and reports four failures that are quota, not
regression — wait a minute and re-run before believing it. And **no API suite can see the browser**:
178 deployed checks passed in Chapter 1 while a webhook-triggered run was invisible on the canvas.
Drive a real browser before believing a UI claim.
