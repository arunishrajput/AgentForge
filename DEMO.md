# DEMO.md — the 3-minute demo, used as a scope contract

**This file is a scope contract, not a script to be written at the end.** Anything not on this path
is MVP-Supporting or lower by default. When time runs short, the question is always: *does cutting
this break a beat below?*

Status: **FINAL — walked end to end on the deployed URL in Phase 12.** Phase 0 validated it,
Phase 7 pinned the prompt, Phase 9 promoted Beat 2's target prompt to the real one, and **Phase 12
rehearsed it in a browser and found three beats that could not have worked as written.** All three
are fixed below and the fixes are proven, not asserted. The one thing still owed is a human
run-through against a stopwatch — see *What Phase 12 could not rehearse*.

> **Beat 2's target prompt is now the demo prompt.** Phase 9 registered the Discord and Sheets nodes
> and the two `unsupported` lines disappeared, which was the phase's acceptance test. Measured
> **3/3 valid on the first attempt**, each producing the full spine
> `webhook trigger → LLM → agent → branch → Discord + Sheets` with `unsupported: []`. The Phase 7
> prompt is kept below as the fallback, because its trigger is the manual one and it needs no
> credentials at all.

---

## The premise, in one line

*"You describe an automation in plain English. AgentForge builds it, runs it, and the workflow
itself decides what to do."*

---

## The script, beat by beat

Target: **3:00**. Times are cumulative.

### Beat 1 — the live product (0:00 → 0:20)

Load the deployed URL in a clean browser profile. Click **Continue with Google** — that is the
button's exact wording, checked by the smoke script, because a presenter reading this aloud should
name what is on screen.

> "This is live, on the internet, right now — not a local dev server."

Land on the workflow list, signed in.
**Proves:** C15 deployed URL, C1 Google OAuth.

### Beat 2 — the ask (0:20 → 0:45)

Type into the prompt box (pre-written, pasted, not typed live).

**The prompt — verified against the deployed URL at Phase 9:**

```text
When my form webhook fires, summarise the submission, decide whether it's urgent,
post urgent ones to Discord, and log every one to my Google Sheet.
```

Measured on `gemini-3.5-flash-lite`: **3/3 valid on the first attempt**, `unsupported: []` every
time, each producing `webhook trigger → LLM summary → agent decides → branch → Discord + Sheets` —
which is every one of Beats 3, 6, 7 and 8. The model routes the sheet off **both** branch outputs
unprompted, because the request said "log *every* one".

**Fallback prompt, if the integrations are not connected** (Phase 7's, still verified 5/5 in Phase 8
— it needs no credentials and its trigger is the manual one, so Beat 5 becomes a **Run** click and
Beat 4's spreadsheet paste is not needed):

```text
When I run this, summarise the support message I give it, decide whether it is urgent,
and log urgent ones as a warning.
```

The second example button on the page is the loop workflow, if a judge asks for another.

> "No node picking. No wiring. Just what I want."

**Proves:** the premise.

### Beat 3 — the generation (0:45 → 1:15) ★ HEADLINE

The workflow appears on the canvas: webhook trigger → agent node → branch → Discord / Sheets.

> "That's a real workflow. Real nodes, real connections, saved to my account."

**Proves:** C11 NL→workflow generation, C5 canvas, C2 data model.
**This is the moment the demo exists for.** Do not rush it; let the animation land.

### Beat 4 — it is real, not a picture (1:15 → 1:40)

Click the **Log to Sheet** node. In the inspector, paste the demo spreadsheet id into
**Spreadsheet id** (it is in *Seed data* below, and in the clipboard). **Save.**

> "This isn't a screenshot of a workflow — I can open any node and change it."

**This beat is load-bearing, not decorative.** The generated Sheets node is **born with an empty
`spreadsheetId` on purpose**: the prompt never names a spreadsheet, so the model is told to leave it
blank rather than invent one. Until it is filled in, Beat 8's second payoff fails with *"This node
has no spreadsheet yet."* and the whole run is marked failed.

Until Phase 12 this beat edited the **Discord** node's Message field instead, and the spreadsheet id
was listed as something to have done *"before the demo begins"* — which is impossible, because the
node does not exist until Beat 3 generates it. Rehearsing it produced exactly the predicted failure:

```
HTTP 201  run failed  6 steps · branch "true" · 2809 ms
  integration.sheets  This node has no spreadsheet yet. Open it and paste the Google Sheet's URL or id.
```

If there is time, open the **Post to Discord** node afterwards and show its Message template with the
`{{ }}` references in it — that is the better line about editing, and it is now the optional half.

**Proves:** C5 editing, C3 registry-driven config forms, C2 persistence.

### Beat 5 — fire it (1:40 → 2:00)

Run the **pre-staged** command from a terminal already open beside the browser:

```bash
# PRE-STAGED — never typed live
node --env-file=.env scripts/demo-fire.mjs "$APP_BASE_URL"
```

It prints the workflow it is firing, the HTTP status, and the branch the run took. **It never prints
the webhook URL** — not on success, not in an error.

**Why this is not a `curl`.** It used to be, against a `$WEBHOOK_URL` exported before the demo
started. That cannot work, and Phase 12's rehearsal is what proved it: `createWorkflow` mints a fresh
192-bit `webhookToken` for **every** workflow at creation (D41), so the URL Beat 5 must POST to did
not exist when the demo began. The two obvious repairs are both worse on stage:

- **Copy it out of the inspector live.** It is a bearer secret — anyone holding it can start runs and
  spend model quota — and the inspector would be on the shared screen.
- **Fire a pre-exported URL from some earlier workflow.** This is the worst outcome available: the
  call answers **201**, a run really does execute — on the *other* workflow — and the canvas the
  audience is watching never moves, because the stream is workflow-scoped (D28). A green terminal
  beside a dead canvas.

So the script resolves the newest workflow's URL at fire time, the same way nothing else about this
beat is left to chance. It also **fits the payload to the graph the model just wrote**: the trigger's
`requiredFields` are the model's choice, and in **5 of 10** measured walks it wanted a field
(`submission`) that Beat 5's fixed JSON did not send — a **400** two beats before the payoff. The
fitting is reported when it happens, so the variance is visible rather than hidden.

`--payload calm` sends the reserve message instead, and the agent takes the **false** branch. That is
the answer to *"what if it isn't urgent?"*, and it is one pre-staged command, not an edit.

**Proves:** C12 webhook trigger.

### Beat 6 — watch it think (2:00 → 2:30)

Switch to the browser. Nodes light up in sequence; logs stream into the panel.

> "Per-node status, live. Nothing is being refreshed."

**This beat was dead until Phase 12 fixed it, and the smoke script could not have told us.** The
canvas only opened a stream when the page happened to *load* mid-run, or when the user pressed Run.
A webhook-triggered run started while the page sat idle was therefore invisible: the run executed on
the server, finished, and the graph never moved. Rehearsed on the deployed URL, the canvas showed no
status change across nine seconds while a run completed behind it.

`smoke.mjs` passed throughout, because it opens the SSE stream itself over HTTP and fires 400 ms
later — it proves the **server** streams, never that the **canvas** is still listening 25 seconds
after it loaded, which is exactly how long Beat 4 takes. A whole class of bug lives in that gap.

The canvas now watches from the moment it opens and re-attaches when the server closes a quiet
connection, while the tab is visible. Re-verified in a browser: canvas loaded, left alone for
**25 seconds**, then fired from the terminal —

```
19s  Form Webhook Succeeded · Summarise Running
20s  Summarise Succeeded · Decide Urgency Running
22s  Decide Urgency Succeeded · Is Urgent? Succeeded → true · Post to Discord Running
22s  Post to Discord Succeeded · Log to Sheet Succeeded
```

**Proves:** C7 live streaming, C6 run history and per-node status, C4 engine.

### Beat 7 — the runtime decision (2:30 → 2:45)

The agent node's log shows it reasoning about the content and choosing the **urgent** branch.

> "Nobody wrote a keyword rule. The agent read it, judged it urgent, and picked that path. Send a
> polite feature request instead and it takes the other branch."

**Proves:** C9 agent tool-calling, C8 LLM node, C10 model config.
**This is the second-most important beat.** It is what separates AgentForge from a flowchart.

### Beat 8 — the payoff (2:45 → 3:00)

Show the Discord channel with the posted summary, then the Google Sheet with the new row.

> "Real message. Real spreadsheet. Built from one sentence, ninety seconds ago."

**Proves:** C14 integrations.

---

## Coverage check

Every MVP-Critical feature appears:

| Feature | Beat |
|---|---|
| C1 Google OAuth | 1 |
| C2 Workflow data model | 3, 4 |
| C3 Node registry | 4 (config form), 7 (agent tools) |
| C4 Execution engine | 6 |
| C5 Visual canvas | 3, 4 |
| C6 Run history, per-node status | 6 |
| C7 Live streaming | 6 |
| C8 LLM node | 7 |
| C9 Agent node with tool-calling | 7 |
| C10 In-app model selection | 7 (visible in settings if asked) |
| C11 NL → workflow | 3 |
| C12 Webhook trigger | 5 |
| C13 Schedule trigger | *Not on the path* — mention verbally, show in the trigger picker. It works: a Cloud Scheduler job sweeps due schedules every 15 min (Phase 8) |
| C14 Four integrations | 8 — Discord and Sheets on the path; Gmail and generic HTTP are in the palette and in the same registry, shown if asked |
| C15 Deployed URL | 1 |
| C16 Responsive UI with motion | Throughout — **delivered in Phase 10.** The two beats it is most visible in are 3 (the prompt box's sweep and elapsed clock, then the generated graph staggering in) and 6–7 (the running node's pulse, and the run's path left lit on the canvas with the untaken branch dark). Usable down to 375 px, where the canvas's side panels become drawers |

**C13 is the only Critical feature not demonstrated live.** It is 30 seconds of unwatchable waiting.
It is still built, still shown in the UI, and mentioned in one sentence.

---

## Required setup state

Before the demo begins, all of this is true. **Everything here is genuinely possible before the
demo** — Phase 12 removed two items that were not, because they described a workflow that does not
exist until Beat 3 generates it.

| # | State |
|---|---|
| 1 | Deployed revision is the verified one. **No deploy on demo day** |
| 2 | Cloud Run `min-instances=1` |
| 3 | Both tiers warmed within the last 10 minutes — health endpoint hit (wakes Cloud Run) and one real query made (wakes Neon compute) |
| 4 | Demo Google account signed **out** in the demo browser profile, so Beat 1 shows a real sign-in |
| 5 | Gemini key saved in the demo account's settings, with free-tier quota confirmed remaining |
| 6 | Discord webhook saved at **Settings → Integrations** (the page shows the channel name back); `#agentforge-demo` open in a background tab, scrolled to the bottom, **and cleared of prior test posts** |
| 7 | **Google connected** at Settings → Integrations, with **both** capabilities showing ✓; the demo sheet open in a background tab, cleared to its header row |
| 8 | The prompt text and the **spreadsheet id** both reachable — prompt in the clipboard, id in a visible scratch file (Beat 4 pastes it) |
| 9 | A terminal open beside the browser, in the repo, with `APP_BASE_URL` exported and `scripts/demo-fire.mjs` **already run once** so its first call is not also its first connection |
| 10 | `gcloud run services logs tail` running in a second terminal, off-screen |
| 11 | Clean browser profile: no extensions, no bookmark bar clutter, zoom at 100% |
| 12 | **Screen at 1920×1080, not 1440×900.** Measured on the real generated graph: the six-node spine renders at **0.67 zoom / 150 px per node card** at 1920, against **0.39 / 88 px** at 1440 — the two side panels take a fixed 560 px, so everything left over is the graph's. This is the single largest legibility win available and it costs nothing |
| 13 | Notifications silenced |
| 14 | **The backup workflow exists and has been proved this session** — `scripts/seed-demo.mjs` does this and says so |

## Seed data

**`scripts/seed-demo.mjs` puts all of this in place and verifies it**, which is how it stops being a
list someone has to remember. Run it before the demo; it is idempotent and safe to re-run.

```bash
SEED_SPREADSHEET_ID=1iz8vjkGNvPQ1q1vpDvaWnQZ6648BNYHYauVXHHY2IBo \
  node --env-file=.env scripts/seed-demo.mjs "$APP_BASE_URL"

node --env-file=.env scripts/seed-demo.mjs "$APP_BASE_URL" --check   # report only, change nothing
```

| Item | Value |
|---|---|
| Demo account | `arunishrajput7@gmail.com` |
| Discord channel | `#agentforge-demo`, cleared of prior test posts |
| Google Sheet | "AgentForge Demo Log" — id `1iz8vjkGNvPQ1q1vpDvaWnQZ6648BNYHYauVXHHY2IBo`, owned by the demo account, tab `Sheet1`, headers `Received · From · Summary · Urgency` in row 1, everything below row 1 cleared. **Created in Phase 11** because the previous sheet's id was recorded nowhere and a cold session could not find it: the `spreadsheets` scope grants no way to search Drive |
| **Backup workflow** | **`DEMO BACKUP — form triage (verified)`** — a real generated copy of the demo workflow, Sheets node already pointed at the demo sheet, and **proved by an actual end-to-end run** when it was seeded. This is Fallback A, and Phase 12 is when it first existed |
| Urgent payload | The checkout-down message — `scripts/demo-fire.mjs`, default |
| Non-urgent payload | A polite feature request — `scripts/demo-fire.mjs --payload calm`. Verified to take the **false** branch |

**What the seed script cannot do, and says so when it finishes:** delete the Discord messages. A
webhook post can only be deleted by its own message id and the app has no reason to keep them, so
clearing `#agentforge-demo` is a human with a mouse. It also cannot sign the demo browser out.

## Fallbacks

Ordered by what fails. **A was rehearsed in Phase 12 and the backup workflow it depends on now
exists and has been run.** B still needs a recording — see *What Phase 12 could not rehearse*.
**The published pitch video is not Fallback B.** It is a narrated deck, so it proves nothing is
broken but shows no live product; do not reach for it when the network dies.

**Phase 11 added one retry to every outbound call on this path** — the Discord post, the Sheets
append and the Google token refresh — on the statuses that mean *nothing happened* (429, 502, 503,
504). A single blip no longer reaches these fallbacks. So if a step below fails in front of an
audience, it has already failed twice and the fallback is the right move rather than "try again".

**A — Generation produces something wrong or slow (Beat 3).**
Say *"let me show you the one I made earlier"*, open **`DEMO BACKUP — form triage (verified)`**, and
continue from Beat 5 — its Sheets node is **already pointed at the demo sheet**, so Beat 4's paste is
not needed and skipping it costs nothing. The demo loses its headline moment but survives. Retry
generation once at the end if time allows.

`demo-fire.mjs` fires the **newest** workflow, so once a generated one exists it would pick that
rather than the backup. Fire the backup explicitly:

```bash
node --env-file=.env scripts/demo-fire.mjs "$APP_BASE_URL" --list      # shows what it would pick
node --env-file=.env scripts/demo-fire.mjs "$APP_BASE_URL" --workflow <id>
```

**B — Everything live fails (network, Cloud Run, Google outage).**
Play the pre-recorded screen capture of a successful full run, recorded during Phase 12 and kept
locally, not streamed. Narrate over it and say plainly that it is a recording.

**C — Discord fails (Beat 8).**
The Google Sheet row is the payoff instead. Both are shown in Beat 8, so this is a graceful
degradation, not a failure. Same in reverse if Sheets fails.

**D — Gemini quota exhausted or the API errors (Beats 3, 7).**
Switch the model in settings to another Gemini tier — this is why in-app model selection exists.
If the whole provider is down, go to Fallback B.

**E — Google credential expired or revoked mid-demo (Beat 8).**
The Sheets step fails saying *"The Google connection has been revoked or expired. Reconnect it in
Settings → Integrations."* Do exactly that: **Settings → Integrations → Reconnect Google**, leave
both boxes ticked, come back and re-run. Built to read that way in Phase 9 precisely so it is
recoverable on stage rather than mysterious. A stored refresh token does not expire on a schedule, so
this is unlikely — but unticking a scope produces the same class of failure, and the settings page
shows a ✗ against the capability that is missing.

**F — `demo-fire.mjs` fails (Beat 5).**
Press **Run** on the canvas instead. The only beat lost is the webhook trigger itself, and the canvas
is already watching, so Beats 6 and 7 are unaffected. The script prints this reminder itself when it
fails.

---

## Do not touch before demoing

- **Do not deploy.** A new revision kills in-flight runs and replaces a verified build
- **Do not run migrations**
- **Do not change the Gemini model** already configured and verified
- **Do not rotate any secret**, and above all not `ENCRYPTION_KEY` — every stored credential becomes
  unreadable
- **Do not edit the backup workflow**
- **Do not clear the browser profile** after warming and signing out
- **Do not start a stretch phase** on demo day

---

## Pre-demo verification checklist

Run this ~15 minutes before. Every line must pass.

```bash
export APP_BASE_URL=https://agentforge-733000675212.asia-southeast1.run.app
export GCP_REGION=asia-southeast1

# 1. Right revision live, and taking 100% of traffic
gcloud run services describe agentforge --region "$GCP_REGION" \
  --format='value(status.latestReadyRevisionName,status.traffic)'

# 2. Health from outside
curl -fsS "$APP_BASE_URL/api/health"

# 3. min-instances is 1
gcloud run services describe agentforge --region "$GCP_REGION" \
  --format='value(spec.template.metadata.annotations)' | grep -o 'minScale[^,]*'

# 4. No errors in recent logs
gcloud run services logs read agentforge --region "$GCP_REGION" --limit 30

# 5. The account is in the state this script assumes: credentials connected, the
#    backup workflow present and PROVED by a real run, the sheet cleared to its header.
SEED_SPREADSHEET_ID=1iz8vjkGNvPQ1q1vpDvaWnQZ6648BNYHYauVXHHY2IBo \
  node --env-file=.env scripts/seed-demo.mjs "$APP_BASE_URL"

# 6. The demo path itself, walked end to end. ~10 s. Every beat, in order.
#    It posts one real Discord message and appends one real Sheet row.
SMOKE_SPREADSHEET_ID=1iz8vjkGNvPQ1q1vpDvaWnQZ6648BNYHYauVXHHY2IBo \
  node --env-file=.env scripts/smoke.mjs "$APP_BASE_URL"

# 7. Re-clear the sheet after 5 and 6 both wrote to it, and warm the model.
node --env-file=.env scripts/seed-demo.mjs "$APP_BASE_URL" --check
```

`scripts/smoke.mjs` is the pre-demo check, not `verify-api.mjs`. It walks the eight beats in order
and names the beat that broke; the 178-check suite is the regression test for a code change and
takes ~2 minutes. `--loop 10` is what Phases 11 and 12 signed off against.

Then, manually:

- [ ] Signed out in the demo browser profile
- [ ] Sign in works — then sign out again
- [ ] Backup workflow opens and looks correct
- [ ] **Discord test posts cleared, Sheet cleared to its header row** — steps 5 and 6 each add one
- [ ] Prompt text in the clipboard; **spreadsheet id** in a visible scratch file for Beat 4
- [ ] `APP_BASE_URL` exported and `demo-fire.mjs` run once already
- [ ] Both background tabs open and scrolled correctly
- [ ] Log tail running off-screen
- [ ] **Screen at 1920×1080** (setup state 12 — worth 70% on node legibility)
- [ ] Recording fallback file present and playable
- [ ] Rehearsed once, out loud, inside 3:00

---

## What Phase 12 could not rehearse

Recorded honestly rather than claimed. **Everything below is a human action, not a missing feature.**

**1. A stopwatch rehearsal with narration.** Every beat was executed against the deployed URL and
each one's machine time is measured (below), but the pacing of a person speaking over it was not,
and cannot be by anything but a person. The measured total is **~26 s of machine time inside a
3:00 budget**, so the margin is narration, not latency.

| Beat | Measured, on the deployed URL |
|---|---|
| 1 | health **184 ms** warm; **1.14 s** after 13½ min idle, 739 ms of it Neon waking |
| 3 | generation **2.5 – 5.4 s**, 6 nodes, first attempt in 10 of 10 walks |
| 4 | a node edit saves and survives a reload — no perceptible wait |
| 5 | webhook accepted **201**, run starts immediately |
| 6–7 | run **3.1 – 5.7 s** end to end, first node status visible **~1 s** in |
| 8 | Discord message and Sheet row both land inside the run |

**2. A real Google sign-in (Beat 1).** It needs a human at a consent screen. The signed-out landing
page, the **Continue with Google** button by name, and the 307 on a signed-out `/workflows` are all
asserted by the smoke script every walk; the click itself is yours.

**3. The Fallback B recording.** Nothing in this repository can record a screen. It is the last
un-built fallback and the only one that covers a total outage. **Still outstanding.** The pitch
video published at https://www.youtube.com/watch?v=Suc4RV9LnLs does not replace it — that is a
narrated slide deck, and Fallback B has to be the product itself, running.

```text
MANUAL ACTION REQUIRED

Reason:
Fallback B is the only recovery from a total failure — no network, Cloud Run down, Google
outage. Every other fallback assumes the deployed system is reachable. Without it a dead
network ends the demo with nothing to show.

Location:
Your own machine, screen recorder of choice (macOS: Cmd-Shift-5, or QuickTime →
File → New Screen Recording).

Steps:
1. Complete the pre-demo checklist above so the account is in its demo state.
2. Start recording the browser window at 1920x1080.
3. Perform Beats 1-8 exactly as scripted, including the terminal for Beat 5.
4. Stop at the Discord message and the Sheet row.
5. Save it locally as agentforge-demo-fallback.mov — do NOT commit it (it shows the
   demo account and the workflow list), and do not rely on streaming it.

Values to enter:
Prompt text, Beat 2:
When my form webhook fires, summarise the submission, decide whether it's urgent,
post urgent ones to Discord, and log every one to my Google Sheet.

Spreadsheet id, Beat 4:
1iz8vjkGNvPQ1q1vpDvaWnQZ6648BNYHYauVXHHY2IBo

Expected result:
A single take, under 3 minutes, ending on a real Discord message and a real spreadsheet row.

Verification:
Play it back full-screen with the sound off and confirm every beat is legible at 1920x1080.

Resume by:
Saying "recording done" — no code depends on it, so nothing needs re-verifying.
```

**4. Adding judges as OAuth test users.** Only needed if a judge signs in themselves, which the
script never asks them to do. The consent screen is in `Testing` and **must stay there** — Phase 9's
Sheets and Gmail scopes are sensitive, and publishing would require Google verification that takes
days. Cap is 100 test users.
