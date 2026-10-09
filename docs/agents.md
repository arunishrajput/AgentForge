# How the agents work

This is the part of AgentForge that is not n8n. Two things here are driven by a model rather
than by you: **generation**, which turns a sentence into a graph, and the **agent node**, which
reasons and calls tools while a run is in flight.

They share one provider adapter and one tool surface, and they fail in opposite directions —
which is the most useful thing to understand about them.

---

## The one idea underneath both

**The node registry is the agent's tool set.** Not a parallel list of tool definitions that
somebody keeps in sync — the same objects, filtered.

```
                  ┌──────────────────────┐
                  │   the node registry  │   30 nodes, one object each
                  └──────────┬───────────┘
            ┌────────────────┼────────────────┐
            ▼                ▼                ▼
    engine dispatch    canvas palette    agent tool set
   kind · schema ·   label · category ·   description ·
      execute          outputs            schema · agentCallable
```

Three consequences follow, and they are the reason the architecture is shaped this way:

1. **Adding an integration widens what the agent can do**, with no separate tool definition and
   nothing to keep in sync. Phases 8, 9 and 23C added nodes and touched neither the prompt
   catalogue nor the tool layer.
2. **A node's `description` is contract, not decoration.** The model reads it verbatim to decide
   what to call. It is written for a model — terse, imperative, about *when to call this*. The
   prose a person reads in the inspector is a [second field](./nodes.md), because one string
   written for both audiences served neither.
3. **It is the security boundary.** The agent can reach registry entries and nothing else. No
   shell, no filesystem, no arbitrary network.

---

## Generation — a sentence becomes a graph

```
your sentence
    │
    ▼  select — which nodes this request is shown in full (the rest: one index line each)
  model
    │
    ▼  parse — a model may emit nodes and edges, or `unsupported` with a reason
 assemble — the system supplies version, ids and layout positions, never the model
    │
    ▼  validate against the graph rules, and check every {{ }} reaches something —
    │  one retry with the problems, never a loop
  persist   ← only ever what validated
```

Five properties worth knowing:

**A broken workflow is never saved.** Nothing in `src/lib/generate/` touches the database; the
route inserts only what the pipeline returns as valid. That is structural, not a promise.

**The model is asked only for what it alone knows** — nodes and edges. Positions, edge ids and
the schema version are supplied by the system. A model cannot lay out a graph, and an
overlapping one reads as broken.

**`unsupported` is an answer, not a failure.** Asked for something no registered node can do,
the model is required to say so with a reason, and you get that sentence rather than a plausible
workflow that cannot work.

**The model sees every node, but only some of them in full.** Since Phase 34 the prompt carries
an *index* — one line for each of the registry's nodes — and full definitions (config fields,
outputs, output shape) only for the nodes selected for your request. Selection is deterministic:
words matched against each node's own description and docs, plus a small table of words that mean
the same thing to a person ("spreadsheet" and "sheet", "every Monday" and "schedule"). Every
trigger and the LLM node are always sent. Nothing about it spends a model call, and a node the
selector missed is still reachable: the model may use any indexed node, and if it gets that
node's config wrong, the retry is handed its full definition. The prompt fell from 25,081
characters to ~16,800 on average, and adding a node now costs every request one index line
(~116 characters) instead of a definition (~820).

**A valid graph can still be the wrong graph.** This is the honest limitation, and it is stated
here rather than buried: validation proves a workflow *can* run. It never proves it does what
you asked. The canvas is editable for exactly this reason — generation is a first draft you
correct, not an oracle.

### Measured, not eyeballed — the eval set

[`src/lib/generate/eval/`](../src/lib/generate/eval) holds 24 requests a stranger might type, each
with what a correct answer must contain: the trigger the request implies, the nodes it needs, none
it forbids, `unsupported` used honestly — and **every `{{ }}` reference resolving**
([`references.ts`](../src/lib/generate/references.ts)), which is the check that sees a valid graph
doing the wrong thing: `{{steps.summarise.output.summary}}` where the LLM node produces `text`, or
`{{input.reason}}` after a Branch, whose output is its own `{ matched, input }`.

```bash
npm run eval:generate                    # replay the recordings — offline, no key, what CI runs
npm run eval:generate -- --live          # a real model, scored; spends quota — sparingly
npm run eval:generate -- --recall        # the selector alone: did it choose what each case needs?
```

CI asserts two things on every push: the selector gives every case every node it requires, and
every recording of a live run replays through today's pipeline to the verdict it was recorded
with. The results that chose the selector are in `BUILD_PLAN.md` → *Phase 34*.

**The check runs in generation too.** A first answer that is a valid graph but whose references reach
nothing is sent back once, each reference named in the words above. The retry is the same one an
invalid answer gets — two attempts, never more — and if it comes back worse, the valid first graph is
kept: a workflow is never refused over a reference.

## The agent node — reasoning inside a run

Where generation runs once before anything executes, `ai.agent` runs *during* a run and decides
what to do as it goes.

```
objective + the data that reached this node
    │
    ▼
┌─▶ model proposes a tool call
│       │
│       ▼  the engine executes that registry node — a real step, streamed live
│   result is fed back into the conversation
└───────┘  until the model answers, or the cap stops it
    │
    ▼
{ decision, reason, text, toolCalls, iterations, model, usage }
```

### It is bounded, and the bound is real

**Default 5 model calls, hard maximum 8.** An agent that will not converge **fails its step**
with a message telling you to narrow the objective or raise the limit. It does not spend your
quota in a loop.

The loop is a pure function tested against a scripted model, so "a model that never stops
calling tools is stopped by the cap" is asserted in a millisecond rather than against a live
quota.

**An agent cannot call an agent.** Each nested run would carry its own fresh iteration budget,
so recursion would walk straight past every cap.

### Every tool call is a visible step

A tool call is not an internal detail of a model loop — it is a step in the run, with its own
status and its own log lines, streamed over SSE while it happens. You watch the agent think.

This is one of the four reasons this project has no LLM SDK: an SDK's internal loop would be a
second loop to reconcile with the engine's step recording.

### It decides, and the graph routes

Give the agent `choices` — say `["urgent", "normal"]` — and its `decision` is constrained to
one of them. A following `core.branch` routes on `{{input.decision}}`.

That split is deliberate. **The model decides; the graph routes.** Control flow stays visible on
the canvas and reviewable in a diff, instead of hiding inside a prompt.

### Narrowing what one agent may reach

`tools` on the agent node lists registry types this particular agent may call — **exactly those,
and an empty list means none.** An agent that only decides needs no tools. (Until Phase 34 an
empty list meant every agent-callable node, so a decision-only agent could post to Slack; least
privilege is the rule now, D160.)

**It can only ever narrow.** A type listed there that is not `agentCallable` is reported, never
granted — the allowlist cannot widen the boundary, only tighten it inside it.

---

## What the agent cannot reach

Three independent limits, and none of them is a prompt instruction.

**1. `agentCallable` defaults to `false`.** Registering a node does not make it a tool. Eleven of
the thirty are deliberately not callable — triggers (an agent runs *inside* a run), flow control
(that belongs to the graph), and `integration.gmail`, because a model deciding to send mail as
you is a blast radius rather than a feature. The full table is in the
[node reference](./nodes.md).

**2. A node's authority is its workspace, and it cannot widen it.** Everything a node may touch
arrives in its context. Its credential reach is the workspace whose workflow is running — there
is no ambient access to any other, and nothing in a node's config can change it. That is what
keeps an agent's tool-calling inside the tenant it started in.

**3. The destination is fixed by the credential, not chosen by the model.** This is the one that
makes integrations safe to hand an agent. A Slack incoming webhook cannot be pointed at another
channel. A Notion integration sees only the pages you connected it to. A fine-grained GitHub
token reaches only the repositories you picked. `integration.postgres` has no SQL field at all —
the statement is assembled from enumerated parts, inside a read-only transaction, under whatever
your own role grants.

`integration.http` is the one entry that reaches an arbitrary host, and it is bounded by code
rather than by trust: https only, public addresses only, redirects reported and never followed.

**There is no arbitrary code execution anywhere in this product.** Not sandboxed, not "just for
the demo". [`../SECURITY.md`](../SECURITY.md) → *The agent, and what it cannot reach* is the
full statement.

---

## Providers

Two, behind one interface: **Google Gemini** and **Groq**. Which one a workspace uses is stored
on the workspace; the key is the user's, encrypted at rest, and never returned to a client.

Adding the second provider is what proved the interface generalises. Groq is OpenAI-compatible,
so the same adapter serves any OpenAI-compatible gateway.

Three things the adapter does that are easy to underestimate:

- **A time budget.** One wedged model once cost a run 91.9 seconds. The budget lives in the
  adapter, so every caller gets it.
- **A model fallback chain.** A model answering 503 "experiencing high demand" falls to the next
  one. A *timed-out* attempt is never retried on the same model.
- **A circuit breaker keyed on `(provider, model)`.** With one provider that distinction was
  invisible. With two it is the difference between a working fallback and a broken one — Groq
  answers 429 on a free-tier burst, and a breaker shared by model name alone would let one
  company's rate limit reorder the other's chain.

All of it lives in one file with no provider in it, shared by both adapters rather than copied —
because a hard-won reliability fix is exactly the kind of thing that rots in duplicate.

---

## Where to look in the code

| File | What it holds |
|---|---|
| [`src/lib/ai/loop.ts`](../src/lib/ai/loop.ts) | The bounded tool-calling loop. Pure; tested against a fake model |
| [`src/lib/ai/tools.ts`](../src/lib/ai/tools.ts) | Registry → tool definitions, and the narrowing rule |
| [`src/lib/ai/chain.ts`](../src/lib/ai/chain.ts) | Retry, fallback, time budget, breaker. No provider in it |
| [`src/lib/ai/gemini.ts`](../src/lib/ai/gemini.ts) · [`groq.ts`](../src/lib/ai/groq.ts) | The two wire formats |
| [`src/lib/generate/`](../src/lib/generate) | The generation pipeline. Touches no database |
| [`src/lib/generate/select.ts`](../src/lib/generate/select.ts) | Which nodes a request is shown in full |
| [`src/lib/generate/eval/`](../src/lib/generate/eval) | The eval set, its scorer, and the recordings CI replays |
| [`src/lib/nodes/ai/agent.ts`](../src/lib/nodes/ai/agent.ts) | The agent node itself |

Deeper reasoning — including why there is no LLM SDK — is in
[`../ARCHITECTURE.md`](../ARCHITECTURE.md) → *Agent and tool-calling architecture*, and as
[ADR 0002](../adr/0002-no-llm-sdk.md).
