# SUBMISSION.md — AgentForge, Zero Origin (Devpost)

Everything the submission form asks for, written once so it is not re-improvised at the deadline.
**Copy from here into Devpost.** Anything marked `UNKNOWN — VERIFY` needs the entrant, not the code.

---

## The blanks only you can fill

| Field | Status |
|---|---|
| **Category / track** | `UNKNOWN — VERIFY` — carried since Phase 0. Every phase has assumed a general "best working product" rubric. If the real rubric weights something specific (design, agents, social impact, a named sponsor's API), say so and the emphasis below can be re-cut in minutes |
| **Demo video URL** | `UNKNOWN — VERIFY` — not recorded yet. See `DEMO.md` → *What Phase 12 could not rehearse* for the manual action and the exact script |
| **Team** | Solo — Arunish Rajput |
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
| **Live app** | <https://agentforge-733000675212.asia-southeast1.run.app> |
| Repository | <https://github.com/arunishrajput/AgentForge> |
| Demo video | `UNKNOWN — VERIFY` |

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

## The idea the whole thing hangs on

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

---

## What it does

1. Sign in with Google
2. Add a Gemini API key and pick a model
3. Describe the automation in plain language
4. A real workflow appears on the canvas — editable, not a picture
5. Start it from a webhook, a schedule, or a click
6. Watch per-node status and the agent's reasoning stream live
7. See the result land in Discord and in a Google Sheet

**15 nodes** across triggers, AI, logic, transform and integrations. **Four integrations** that reach
real services: HTTP, Discord, Google Sheets, Gmail.

---

## How it is built

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

**Nine runtime dependencies.** No queue, no Redis, no worker, no component library, no test
framework — tests run on Node's built-in runner. Ten phases in, the dependency list is still the one
from Phase 4.

Two deliberate omissions worth mentioning if asked:

- **The Vercel AI SDK was adopted on licence grounds at Phase 0 and then dropped at Phase 6.** Gemini
  signs every `functionCall` part with a `thoughtSignature` and answers **400** to a history that has
  lost one, so a tidy normalising adapter passes its first tool call and fails on the second. The
  adapter carries the provider's own content back verbatim instead.
- **`{{ }}` is lookup, not an expression language.** No eval, no operators, no function calls. A
  config field is exactly where arbitrary code execution would re-enter the product, and a test
  asserts that `{{1+1}}` stays literal.

---

## Challenges

Real ones, with the evidence still in the repository.

**A generated workflow can be valid and still do the wrong thing.** The graph validates, the run
succeeds, and the behaviour is wrong — which is the failure mode nothing reports. It happened three
distinct ways. A model wrote `{{steps.x.output}}` where it meant `{{steps.x.output.text}}`, so a
branch compared `"[object Object]"` and took the wrong path; the fix was to make each node declare
its own output shape and feed that to the generator. Then, found only by rehearsing the demo in a
browser: **5 of 12 generations wrote `maxIterations: 1` on the agent node** — schema-valid, graph-valid,
and a guaranteed failure the moment the agent reaches for a tool, because it spends one call making
the tool call and needs another to read the result. Now 0 of 12.

**Testing the server is not testing the product.** A 178-check API suite and a ten-walk smoke test
both passed while a webhook-triggered run was **invisible on the canvas** — the page only opened a
stream if it happened to load mid-run, and the demo fires from a terminal while the browser sits
idle. The smoke script opens its own stream and fires 400 ms later, so it proved the server streamed
and never that the canvas was still listening 25 seconds after it loaded. A whole class of bug lived
in that gap, and only driving a real browser found it.

**Retrying is easy; knowing what *not* to retry is the work.** The integrations had no retry at all,
so one Discord 429 ended the demo with an empty channel. But a blanket retry is worse than none — a
POST that creates may have taken effect before the answer was lost, and two copies of the message on
a shared screen is not recoverable. So retries are opt-in per call site, HTTP 500 is deliberately
excluded as ambiguous, and eight of the thirteen tests assert what must *not* be repeated.

**An agent that can call an HTTP node is SSRF by design.** Bounded by a guard rather than by trust:
HTTPS only, and **every** resolved address must be public — not any, or a split-DNS name passes the
check and `fetch` picks the other one. `https` is the rule that actually holds, because the guard
resolves DNS and `fetch` resolves again, whereas the metadata server has no certificate.

---

## What I learned

The repository is the memory. This was built one phase per session with the context cleared between
every one, so anything not written down was genuinely gone. That turned documentation from overhead
into the mechanism — and the lesson landed hardest when a demo spreadsheet set up by hand had its id
recorded nowhere, and the Sheets scope grants no way to search Drive, so it could not be found again.
It had to be recreated. Everything that replaced it is now created by a script that can be re-run.

The corollary: **verify, never assume.** A deploy that exits zero is not a working deploy, a catalogue
of models is not the set of models a key can call, and a demo script that has only ever been walked
by a test harness is not a demo script. Rehearsing this one in a browser found three beats that could
not have worked as written — including one that would have looked, from the terminal, like everything
was fine.

---

## What is next

- Workflow templates and a run-history view richer than the current per-run inspector
- More integrations — the registry means each one also widens what the agent can do
- Human-in-the-loop approval nodes for actions that leave the account
- Credential rotation, which is the sharpest missing piece: the Discord webhook and the workflow's
  own webhook token can both be replaced only by recreating the thing that holds them

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
