# SUBMISSION.md — AgentForge, Zero Origin (Devpost)

> **ARCHIVED — historical.** The Devpost submission, as submitted on 2026-09-26:
> <https://devpost.com/software/agentforge-kz832x>. Kept as a record. Current work is
> `BUILD_PLAN.md` → *Chapter 2*.

Everything the submission form asks for, written once so it is not re-improvised at the deadline.
**SUBMITTED 2026-09-26:** <https://devpost.com/software/agentforge-kz832x> — story, video, repo and
live link all verified present on the public page.

---

## The blanks only you can fill

| Field | Status |
|---|---|
| **Category / track** | **RESOLVED 2026-09-26.** One track, no sub-categories. Top prize is **"Impact Champion"**. **Round 1 — Ideate & Validate** marks *problem validation, affected users, innovative and feasible solution, and potential real-world impact* — **through the PPT and pitch video**, not the running software. Phases 0–12 assumed "best working product", which is wrong for Round 1. See `CLAUDE.md` → *Context* |
| **Demo video URL** | **DONE** — <https://www.youtube.com/watch?v=Suc4RV9LnLs> · 4:00 narrated pitch deck, with real screenshots of the deployed app including a run in flight. **This is not the Fallback B screen recording**, which is still un-recorded — see `DEMO.md` |
| **Team** | Arunish Rajput |
| **Licence** | Still deliberately open. MIT is the obvious default; it is your call because it governs whether others may commercialise this. `README.md` → *License* |

---

## Name and tagline

**AgentForge**

> Describe an automation in plain language. Get a real, executable, visually editable workflow
> whose agent nodes reason and decide while it runs.

Alternate, if a shorter field: *n8n, but the workflows are built and driven by AI agents rather than
hand-wired by you.*

---

## Live links

| What | Where |
|---|---|
| **Devpost project** | <https://devpost.com/software/agentforge-kz832x> |
| **Live app** | <https://agentforge-733000675212.asia-southeast1.run.app> |
| Repository | <https://github.com/arunishrajput/AgentForge> |
| Demo video | <https://www.youtube.com/watch?v=Suc4RV9LnLs> — 4:00 pitch video |

**Judges do not need to connect anything.** Sign-in asks for identity only. The Sheets and Gmail
scopes are a separate, later request the user makes from Settings, and the demo account is already
connected. The OAuth consent screen is in `Testing`, so **a judge who wants to sign in must be added
as a test user first** (cap 100) — the demo never asks them to.

---

## Elevator pitch (~200 words)

Workflow automation tools make you build the workflow. You pick nodes, wire them together, and
encode every decision as a rule up front. AgentForge does neither.

You type what you want — *"when my form webhook fires, summarise the submission, decide whether it's
urgent, post urgent ones to Discord, and log every one to my Google Sheet"* — and it builds a real
workflow on a canvas. Real nodes, real connections, saved to your account, editable field by field.
Not a mockup and not a chat transcript.

Then it runs, and this is the part that is not a flowchart: its **agent nodes call other nodes as
tools and decide what to do at runtime**. Nobody wrote a keyword rule for "urgent". The agent reads
the message, judges it, and the workflow takes that branch. Send a polite feature request instead and
it takes the other one.

While it runs, per-node status and the agent's own reasoning stream live to the canvas over SSE —
including for a run started by an external webhook while you are just watching.

It is deployed, public, and runs on free tiers: one Cloud Run container, Neon Postgres, Gemini.

---

## About the project — the Devpost field

**Paste everything between the two markers into Devpost's *About the project* box, verbatim.** The
seven headings are Devpost's own and are left at `##` so a copy-paste needs no fixing at the
deadline. It is written in the first person; Devpost's headings say "we" and those are theirs,
not a claim about the team.

Everything below is measured on the deployed system. Nothing in it is estimated, and every number
is reproducible with the scripts in `PROGRESS.md` → *How to verify the system, from a cold session*.

<!-- ─────────── DEVPOST: PASTE FROM HERE ─────────── -->

## Inspiration

Workflow automation tools are powerful and hostile. Building anything real in n8n, Zapier or Make
means knowing which of hundreds of nodes exist, what each one expects, and how to wire them
together — before you get any value at all. The tool assumes you already know the shape of the
solution.

Two things follow from that. The blank canvas is the hardest part, and most people who would benefit
from automation never get past it. And the workflows you *can* build are static: every branch has to
be anticipated and hand-wired at design time, so anything requiring actual judgement — *"is this
customer complaint urgent?"* — gets a brittle keyword rule, or a human.

I wanted to attack both at once. Describe the outcome, get a working workflow. And let the workflow
itself make the judgement call at runtime, instead of pretending a regex can.

## What it does

You type what you want in plain language — *"when my form webhook fires, summarise the submission,
decide whether it's urgent, post urgent ones to Discord, and log every one to my Google Sheet"* — and
AgentForge builds a real workflow on a canvas. Real nodes, real connections, saved to your account,
editable field by field. Not a mockup, not a chat transcript.

Then it runs, and this is the part that isn't a flowchart: **its agent nodes call other nodes as
tools and decide what to do at runtime.** Nobody wrote a rule for "urgent". The agent reads the
message, judges it, and the workflow takes that branch. Send a polite feature request instead and it
takes the other one.

Start it from a webhook, a schedule, or a click. While it runs, per-node status and the agent's own
reasoning stream live to the canvas over SSE — including for a run fired by an external webhook while
you are just sitting there watching.

**15 nodes** across triggers, AI, logic, transform and integrations. **Four integrations that reach
real services:** HTTP, Discord, Google Sheets, Gmail. It is deployed, public, and runs entirely on
free tiers.

## How we built it

One Next.js 16 container on Google Cloud Run serving both UI and API, Neon Postgres over Drizzle,
Auth.js v5 with Google OAuth, React Flow for the canvas, Gemini behind a provider-agnostic adapter,
and Cloud Scheduler for cron. **No queue** — the executor runs in-process. **Nine runtime
dependencies**, no Redis, no worker, no component library, no test framework (tests run on Node's
built-in runner).

The whole thing hangs on one design decision: **a single node registry feeds three consumers** — the
execution engine's dispatch table, the canvas palette, and the agent's tool set. Three things fall
out of that:

1. **Adding an integration automatically widens what the agent can do.** No separate tool
   definitions, nothing to keep in sync.
2. **It is the security boundary.** The agent can call registry entries and nothing else — no shell,
   no filesystem, no arbitrary network. Each node opts in explicitly (`agentCallable` defaults to
   false), so adding a node can never silently widen the agent's reach.
3. **The registry is the generator's entire vocabulary**, so a natural-language request cannot
   produce a workflow referencing something that does not exist. Whatever the model could not build
   is reported back in `unsupported` rather than faked.

Two deliberate omissions. **The Vercel AI SDK was adopted early and then dropped**: Gemini signs
every `functionCall` with a `thoughtSignature` and returns 400 for a history that has lost one, so a
tidy normalising abstraction passes its first tool call and fails on the second. The adapter carries
the provider's own content back verbatim instead. And **`{{ }}` is lookup, not an expression
language** — no eval, no operators, no function calls, because a config field is exactly where
arbitrary code execution would re-enter the product. A test asserts that `{{1+1}}` stays literal.

This was built one phase per session with the context window cleared between every single one, so
the repository — not the conversation — had to carry the whole state forward.

## Challenges we ran into

**A generated workflow can be valid and still do the wrong thing.** The graph validates, the run
succeeds, and the behaviour is wrong — the failure mode nothing reports. It happened three distinct
ways. A model wrote `{{steps.x.output}}` where it meant `{{steps.x.output.text}}`, so a branch
compared the string `"[object Object]"` and took the wrong path. The fix was making every node
declare its own output shape and feeding that to the generator. Then, found only by rehearsing the
demo in a browser: **5 of 12 generations wrote `maxIterations: 1` on the agent node** — schema-valid,
graph-valid, and a guaranteed failure the moment the agent reaches for a tool, because it spends one
call making the tool call and needs a second to read the result. Now 0 of 12.

**Testing the server is not testing the product.** A 178-check API suite and a ten-walk smoke test
both passed while a webhook-triggered run was **completely invisible on the canvas**. The page only
opened a stream if it happened to *load* mid-run — and the demo fires from a terminal while the
browser sits idle. The smoke script opens its own stream and fires 400 ms later, so it proved the
server streams and never that the canvas was still listening 25 seconds after it loaded. A whole
class of bug lived in that gap, and only driving a real browser found it.

**Retrying is easy; knowing what *not* to retry is the work.** The integrations shipped with no
retry, so a single Discord 429 would end the demo with an empty channel. But a blanket retry is worse
than none — a POST that creates may have taken effect before the response was lost, and two copies of
the same message on a shared screen is not recoverable. So retries are opt-in per call site, HTTP 500
is deliberately excluded as ambiguous, and eight of the thirteen tests assert what must *not* be
repeated.

**An agent that can call an HTTP node is SSRF by design.** Bounded by a guard rather than by trust:
HTTPS only, and **every** resolved address must be public — not *any*, or a split-DNS name passes the
check and `fetch` picks the other one.

**Deployment lied to me more than once.** A redirect built from `request.url` pointed at
`0.0.0.0:8080` inside the container, so every successful Google connection landed on
`ERR_CONNECTION_REFUSED` — invisible to curl, obvious in a browser. A model catalogue listed models
the key could not actually call. And a demo spreadsheet set up by hand had its id recorded nowhere,
and the Sheets scope grants no way to search Drive, so it was simply gone and had to be recreated.

## Accomplishments that we're proud of

**It is live, and it has been live and verified since day one** — every phase after the first deploy
ended with the deployed system proven to still work, or the phase was not finished.

**The demo path walks clean ten times in a row.** Ten consecutive full end-to-end walks, zero
failures, with the workflow generated correctly on the first attempt every time. Generation takes
~3 seconds; a six-node run completes in 3–5 seconds. 178 deployed API checks (176 pass, 0 fail, 2
skip by design) and 297 unit tests that need no database and no network.

**The agent genuinely decides.** It is not a scripted branch dressed up as reasoning — change the
tone of the input and the workflow takes the other path, live, on stage.

**Nine dependencies and one container.** No queue, no worker, no microservices, and still real
webhooks, real schedules, real streaming and four real integrations.

**No arbitrary code execution anywhere in the product**, not even "just for the demo" — and the
registry makes that a structural property rather than a promise.

**Rollback is tested, not assumed.** A traffic shift to the previous revision takes ~15 seconds and
I have actually done it.

## What we learned

**The repository is the memory.** Building with the context cleared between every session meant
anything not written down was genuinely gone. That turned documentation from overhead into the actual
mechanism — and the lesson landed hardest with the spreadsheet that could not be found again. Setup
that only exists in someone's terminal history is setup that is already lost. Everything that
replaced it is created by a script that can be re-run.

**Verify, never assume.** A deploy that exits zero is not a working deploy. A catalogue of models is
not the set of models your key can call. A demo script that has only ever been walked by a test
harness is not a demo script — rehearsing this one in a real browser found three beats that could not
have worked as written, including one that looked, from the terminal, like everything was fine.

**Validation proves a workflow *can* run, never that it does what was asked.** That gap is where
every hard bug in this project lived.

**Abstractions over LLM providers leak at exactly the wrong moment** — the second tool call, not the
first.

## What's next for AgentForge

- **Credential rotation** — the sharpest missing piece. A stored Discord webhook and a workflow's own
  webhook token can currently only be replaced by recreating the thing that holds them.
- **Human-in-the-loop approval nodes** for actions that leave the account, so an agent can draft the
  email and a person is still the one to send it.
- **More integrations** — and because of the registry, each one also widens what the agent can do,
  for free.
- **Workflow templates and a richer run-history view** than the current per-run inspector.
- **More providers behind the adapter** — the seam is already there, it just has one implementation
  today.

<!-- ─────────── DEVPOST: PASTE TO HERE ─────────── -->

---

## Supporting reference

**Not part of the paste.** Kept for the Devpost side fields, and for answering a judge who asks a
sharper question than the About box covers.

### The idea the whole thing hangs on

**One node registry feeds three consumers**: the execution engine's dispatch table, the canvas
palette, and the agent's tool set.

```
                     ┌──────────────────┐
                     │  node registry   │
                     └────────┬─────────┘
           ┌──────────────────┼──────────────────┐
           ▼                  ▼                  ▼
   engine dispatch      canvas palette      agent tool set
```

Three consequences fall out of that one decision, and they are what make the product coherent rather
than a pile of features:

1. **Adding an integration widens what the agent can do**, automatically. There are no separate tool
   definitions to write and nothing to keep in sync.
2. **It is the security boundary.** The agent can call registry entries and nothing else — no shell,
   no filesystem, no arbitrary network. Each node opts in explicitly (`agentCallable` defaults to
   false), so adding a node can never silently widen the agent's reach.
3. **The registry is the generator's entire vocabulary**, so a natural-language request cannot
   produce a workflow that references something that does not exist. What the model could not build
   is reported in `unsupported` rather than faked.

### The flow, in seven steps

1. Sign in with Google
2. Add a Gemini API key and pick a model
3. Describe the automation in plain language
4. A real workflow appears on the canvas — editable, not a picture
5. Start it from a webhook, a schedule, or a click
6. Watch per-node status and the agent's reasoning stream live
7. See the result land in Discord and in a Google Sheet

**15 nodes** across triggers, AI, logic, transform and integrations. **Four integrations** that reach
real services: HTTP, Discord, Google Sheets, Gmail.

### Built with

| Layer | Choice |
|---|---|
| Host | Google Cloud Run — one container, one region |
| Database | Neon Postgres, free tier, pooled connection |
| Framework | Next.js 16 App Router, React 19 — one container serving UI and API |
| Canvas | React Flow (`@xyflow/react`) |
| ORM | Drizzle + `@neondatabase/serverless` |
| Auth | Auth.js v5, Google OAuth |
| LLM | Google Gemini, behind a provider-agnostic adapter written here — **no AI SDK** |
| Engine | Written here. In-process work-list DAG walker, not borrowed |
| Cron | Cloud Scheduler → one authenticated endpoint |
| Queue | **None.** The executor runs in-process |

**Nine runtime dependencies**, verified against `package.json`: `next`, `react`, `react-dom`,
`next-auth`, `@auth/drizzle-adapter`, `drizzle-orm`, `@neondatabase/serverless`, `@xyflow/react`,
`zod`. Twelve phases in, that list is still the one from Phase 4. Tailwind v4 and TypeScript are
build-time only and never reach the runtime image.

**Devpost's "Built with" chips:** `next.js`, `react`, `typescript`, `google-cloud-run`, `postgresql`, `neon`, `drizzle-orm`, `react-flow`, `auth.js`, `google-gemini`, `google-sheets-api`, `gmail-api`, `discord`, `tailwindcss`, `server-sent-events`, `cloud-scheduler`, `docker`.

---

## Facts you can quote

Measured, on the deployed system, not estimated.

| Claim | Number |
|---|---|
| Natural language → running workflow | **~3 s** to generate, **~3–5 s** to run six nodes end to end |
| Demo path reliability | **10 consecutive clean walks**, 0 failures, generation correct on the first attempt every time |
| Deployed API checks | **178** — 176 pass, 0 fail, 2 skip by design |
| Unit tests | **297**, no database, no network, ~1.5 s |
| Registry | **15 nodes**, one source feeding engine, canvas and agent |
| Runtime dependencies | **9** |
| Cold start | **1.14 s** at 13½ minutes idle, 739 ms of it Neon waking; **184 ms** on the next request |
| Rollback | Traffic shift, **~15 s**, tested |
