# DEMO.md — the 3-minute demo, used as a scope contract

**This file is a scope contract, not a script to be written at the end.** Anything not on this path
is MVP-Supporting or lower by default. When time runs short, the question is always: *does cutting
this break a beat below?*

Status: **PROPOSED.** Phase 0 validates and refines it; **Phase 7 has pinned the prompt** (Beat 2);
Phase 12 rehearses and finalises it.

> **Beat 2's prompt needs Phases 8 and 9.** It names a webhook trigger, Discord and Google Sheets,
> none of which are in the registry yet. Run against today's registry it builds the agent-decision
> spine and honestly reports the rest as unsupported — verified on the deployed URL, twice. The
> generator reads `describeNodes()`, so those parts start generating the moment the nodes are
> registered, with no change to any generation code. **Until Phase 9 lands, demo the Phase 7 prompt
> below.** Re-verify Beat 2's own prompt at Phase 9 and delete this note.

---

## The premise, in one line

*"You describe an automation in plain English. AgentForge builds it, runs it, and the workflow
itself decides what to do."*

---

## The script, beat by beat

Target: **3:00**. Times are cumulative.

### Beat 1 — the live product (0:00 → 0:20)

Load the deployed URL in a clean browser profile. Click **Sign in with Google**.

> "This is live, on the internet, right now — not a local dev server."

Land on the workflow list, signed in.
**Proves:** C15 deployed URL, C1 Google OAuth.

### Beat 2 — the ask (0:20 → 0:45)

Type into the prompt box (pre-written, pasted, not typed live).

**The target prompt, once Phases 8–9 land:**

```text
When my form webhook fires, summarise the submission, decide whether it's urgent,
post urgent ones to Discord, and log every one to my Google Sheet.
```

**The prompt that works today — pinned by Phase 7, verified on the deployed URL:**

```text
When I run this, summarise the support message I give it, decide whether it is urgent,
and log urgent ones as a warning.
```

Measured on the deployed app, `gemini-3.5-flash-lite`: **5/5 valid on the first attempt**, 2.5–3.6 s,
and every one produced `manual trigger → LLM summary → agent decides → branch → log`. That shape is
what Beats 3, 6 and 7 need. The second example button on the page is the loop workflow, if a judge
asks for another.

> "No node picking. No wiring. Just what I want."

**Proves:** the premise.

### Beat 3 — the generation (0:45 → 1:15) ★ HEADLINE

The workflow appears on the canvas: webhook trigger → agent node → branch → Discord / Sheets.

> "That's a real workflow. Real nodes, real connections, saved to my account."

**Proves:** C11 NL→workflow generation, C5 canvas, C2 data model.
**This is the moment the demo exists for.** Do not rush it; let the animation land.

### Beat 4 — it is real, not a picture (1:15 → 1:40)

Open the Discord node. Change the message template. Save.

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
| C13 Schedule trigger | *Not on the path* — mention verbally, show in the trigger picker |
| C14 Four integrations | 8 |
| C15 Deployed URL | 1 |
| C16 Responsive UI with motion | Throughout |

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
| 6 | Discord credential saved; `#agentforge-demo` channel open in a background tab, scrolled to the bottom |
| 7 | Google Sheet credential saved; target sheet open in a background tab |
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
| Google Sheet | "AgentForge Demo Log", headers in row 1, prior demo rows cleared |
| Urgent payload | The checkout-down message in Beat 5 |
| Non-urgent payload | A polite feature request, held in reserve to show the other branch if asked |
| Backup workflow | One already-generated, already-verified copy of the demo workflow saved in the account — see Fallback B |

---

## Fallbacks

Ordered by what fails. Rehearse A and B in Phase 12; knowing them is the point.

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

**E — Google credential expired mid-demo (Beat 8).**
Re-authorise in settings; it is a few clicks. Phase 11 makes this error legible specifically so it
is recoverable on stage rather than mysterious.

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

# 5. Smoke script (Phase 11) against production
```

Then, manually:

- [ ] Signed out in the demo browser profile
- [ ] Sign in works — then sign out again
- [ ] Backup workflow opens and looks correct
- [ ] One end-to-end run completes: Discord message posted, Sheet row appended
- [ ] Discord test post cleared, Sheet test row cleared
- [ ] Prompt text ready; `curl` staged with `WEBHOOK_URL` exported
- [ ] Both background tabs open and scrolled correctly
- [ ] Log tail running off-screen
- [ ] Recording fallback file present and playable
- [ ] Rehearsed once, inside 3:00
