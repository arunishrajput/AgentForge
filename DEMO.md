# DEMO.md — the 3-minute demo, used as a scope contract

**This file is a scope contract, not a script to be written at the end.** Anything not on this path
is MVP-Supporting or lower by default. When time runs short, the question is always: *does cutting
this break a beat below?*

Status: **PROPOSED.** Phase 0 validates and refines it; **Phase 7 pinned the prompt** and **Phase 9
promoted Beat 2's target prompt to the real one**; Phase 12 rehearses and finalises it.

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
— it needs no credentials and its trigger is the manual one, so Beat 5's `curl` becomes a Run click):

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

Open the Discord node. Change its **Message** field — the template with `{{ }}` references in it.
Save.

> "This isn't a screenshot of a workflow — I can open any node and change it."

**Proves:** C5 editing, C3 registry-driven config forms, C2 persistence.

### Beat 5 — fire it (1:40 → 2:00)

Run the **pre-staged** `curl` from a terminal already open beside the browser:

```bash
# PRE-STAGED — never typed live
curl -X POST "$WEBHOOK_URL" \
  -H 'content-type: application/json' \
  -d '{"name":"Priya","email":"priya@example.com","message":"Our production checkout has been down for 40 minutes and we are losing orders."}'
```

**Where `$WEBHOOK_URL` comes from** (Phase 8): select the webhook trigger node on the canvas and use
**Copy URL** in the inspector. Export it in the terminal **before** the demo starts — anyone holding
that URL can start a run, so it must not appear on a shared screen. That is also why the beat is a
pre-staged `curl` rather than a copy-paste performed live.

**Proves:** C12 webhook trigger.

### Beat 6 — watch it think (2:00 → 2:30)

Switch to the browser. Nodes light up in sequence; logs stream into the panel.

> "Per-node status, live. Nothing is being refreshed."

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

Before the demo begins, all of this is true:

| # | State |
|---|---|
| 1 | Deployed revision is the verified one. **No deploy on demo day** |
| 2 | Cloud Run `min-instances=1` |
| 3 | Both tiers warmed within the last 10 minutes — health endpoint hit (wakes Cloud Run) and one real query made (wakes Neon compute) |
| 4 | Demo Google account signed **out** in the demo browser profile, so Beat 1 shows a real sign-in |
| 5 | Gemini key saved in the demo account's settings, with free-tier quota confirmed remaining |
| 6 | Discord webhook saved at **Settings → Integrations** (the page shows the channel name back); `#agentforge-demo` open in a background tab, scrolled to the bottom |
| 7 | **Google connected** at Settings → Integrations, with **both** capabilities showing ✓; the target sheet (id in *Seed data* below) open in a background tab, and that id pasted into the generated Sheets node — it is born empty on purpose, because the prompt names no spreadsheet |
| 8 | The prompt text in the clipboard or a visible scratch file |
| 9 | The `curl` command pre-staged in a terminal beside the browser, `WEBHOOK_URL` already exported |
| 10 | `gcloud run services logs tail` running in a second terminal, off-screen |
| 11 | Clean browser profile: no extensions, no bookmark bar clutter, zoom at 100% |
| 12 | Notifications silenced |

---

## Seed data

| Item | Value |
|---|---|
| Demo account | `arunishrajput7@gmail.com` |
| Discord channel | `#agentforge-demo`, cleared of prior test posts |
| Google Sheet | "AgentForge Demo Log" — id `1iz8vjkGNvPQ1q1vpDvaWnQZ6648BNYHYauVXHHY2IBo`, owned by the demo account, headers `Received · From · Summary · Urgency` in row 1, prior demo rows cleared. **Created in Phase 11** because the previous sheet's id was recorded nowhere and a cold session could not find it: the `spreadsheets` scope grants no way to search Drive |
| Urgent payload | The checkout-down message in Beat 5 |
| Non-urgent payload | A polite feature request, held in reserve to show the other branch if asked |
| Backup workflow | One already-generated, already-verified copy of the demo workflow saved in the account — see Fallback B |

---

## Fallbacks

Ordered by what fails. Rehearse A and B in Phase 12; knowing them is the point.

**Phase 11 added one retry to every outbound call on this path** — the Discord post, the Sheets
append and the Google token refresh — on the statuses that mean *nothing happened* (429, 502, 503,
504). A single blip no longer reaches these fallbacks. So if a step below fails in front of an
audience, it has already failed twice and the fallback is the right move rather than "try again".

**A — Generation produces something wrong or slow (Beat 3).**
Say *"let me show you the one I made earlier"*, open the saved backup workflow, and continue from
Beat 4. The demo loses its headline moment but survives. Retry generation once at the end if time
allows.

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

**F — The webhook `curl` fails (Beat 5).**
Trigger the run manually from the canvas. The only beat lost is the webhook trigger itself.

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
# 1. Right revision live
gcloud run services describe agentforge --region "$GCP_REGION" \
  --format='value(status.url,status.latestReadyRevisionName)'

# 2. Health from outside
curl -fsS "$APP_BASE_URL/api/health"

# 3. min-instances is 1
gcloud run services describe agentforge --region "$GCP_REGION" \
  --format='value(spec.template.metadata.annotations)' | grep -o 'minScale[^,]*'

# 4. No errors in recent logs
gcloud run services logs read agentforge --region "$GCP_REGION" --limit 30

# 5. The demo path itself, walked end to end. ~10 s. Every beat, in order.
#    It posts one real Discord message and appends one real Sheet row — clear both after.
SMOKE_SPREADSHEET_ID=1iz8vjkGNvPQ1q1vpDvaWnQZ6648BNYHYauVXHHY2IBo \
  node --env-file=.env scripts/smoke.mjs "$APP_BASE_URL"
```

`scripts/smoke.mjs` is the pre-demo check, not `verify-api.mjs`. It walks the eight beats below in
order and names the beat that broke; the 178-check suite is the regression test for a code change
and takes ~2 minutes. `--loop 10` is what Phase 11 signed off against.

Then, manually:

- [ ] Signed out in the demo browser profile
- [ ] Sign in works — then sign out again
- [ ] Backup workflow opens and looks correct
- [ ] One end-to-end run completes: Discord message posted, Sheet row appended
- [ ] Discord test post cleared, Sheet test row cleared
- [ ] Prompt text ready; `curl` staged with `WEBHOOK_URL` **already exported** and the inspector closed
- [ ] Both background tabs open and scrolled correctly
- [ ] Log tail running off-screen
- [ ] Recording fallback file present and playable
- [ ] Rehearsed once, inside 3:00
