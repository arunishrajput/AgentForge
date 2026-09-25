# PRD.md — AgentForge MVP

What the MVP must do, and what it deliberately will not. This is the scope authority. When a
feature is not on the MVP-Critical list, it is not in the MVP.

---

## Product

**AgentForge** is an agentic workflow automation platform. *n8n, but the workflows are built and
driven by AI agents rather than hand-wired by the user.*

A user describes what they want in natural language. AgentForge produces a real, executable,
visually editable workflow — and its agent nodes reason, call tools, and make decisions at
runtime rather than following a fixed script.

---

## Problem

Workflow automation tools are powerful and hostile. Building anything real in n8n, Zapier, or
Make means knowing which of hundreds of nodes exist, what each one expects, and how to wire them
together correctly before you get any value. The tool assumes you already know the shape of the
solution.

Two things follow. First, the blank canvas is the hardest part — most people who would benefit
from automation never get past it. Second, the workflows you can build are static: every branch
must be anticipated and hand-wired at design time, so anything requiring judgement ("is this
customer complaint urgent?") either gets a brittle keyword rule or a human in the loop.

AgentForge attacks both. You describe the outcome and get a working workflow. And the workflow
itself can reason at runtime, so judgement becomes something the automation does rather than
something it routes around.

---

## Target user

Someone technical enough to want automation and too busy to hand-wire it: an indie developer,
a founder, an ops or growth person at a small company. They have a Google account, they can paste
an API key, and they will abandon a tool that takes an afternoon to understand.

Not targeted at MVP: enterprise teams, non-technical users needing hand-holding, anyone
requiring on-premise or compliance guarantees.

---

## MVP objective

**A working, publicly deployed, reliably demonstrable product.**

Not a production-scale platform. The strongest realistic MVP that can be deployed and
demonstrated without failure inside 72 hours.

---

## Core user journey

1. Land on the public URL, sign in with Google
2. Add a Gemini API key in settings and pick a model
3. Type a request in plain language: *"When my form webhook fires, summarise the submission,
   decide if it's urgent, post urgent ones to Discord and log every one to a Google Sheet"*
4. Watch a real workflow appear on the canvas
5. Open a node, change its configuration, save
6. Trigger the workflow and watch per-node status and logs stream live
7. See the agent node reason about the content and take one branch rather than another
8. See the result land in Discord and in the Google Sheet

---

## MVP-Critical features

Required for the core demo or for deployment. If one of these is missing, the MVP is incomplete.

| # | Feature | Phase |
|---|---|---|
| C1 | Google OAuth sign-in | 1–2 |
| C2 | Workflow data model — workflows, nodes, edges, persisted | 3 |
| C3 | Node registry — the node-type definition interface and dispatch table | 3 |
| C4 | Execution engine — DAG traversal, sequential + branch + basic loop | 3 |
| C5 | Visual canvas — create, edit, connect, save, load workflows | 4 |
| C6 | Manual run, run history, per-node status and logs | 3–5 |
| C7 | Live execution streaming to the UI | 5 |
| C8 | LLM node | 6 |
| C9 | Agent node with tool-calling over the registered node set | 6 |
| C10 | In-app model selection with a user-supplied API key, encrypted at rest | 6 |
| C11 | **Natural language → workflow generation** — the headline demo moment | 7 |
| C12 | Webhook trigger | 8 |
| C13 | Schedule trigger | 8 |
| C14 | Four working integrations: Google Sheets, Gmail, Discord webhook, generic HTTP | 9 |
| C15 | Publicly deployed URL that works from any machine | 2, maintained after |
| C16 | Modern responsive UI with real motion design | 10 |

---

## MVP-Supporting features

Build only if genuinely ahead of schedule. Never at the expense of a Critical item.

| # | Feature | Notes |
|---|---|---|
| S1 | A second LLM provider (OpenAI / Anthropic / OpenRouter) | The adapter already supports it; only a key and a config entry are missing. See *Deviations* |
| S2 | Voice input, single language | Phase 13 |
| S3 | i18n scaffolding + 2 languages | Phase 13 |
| S4 | Workflow template gallery | Phase 14 |
| S5 | Integrations beyond the first four | Phase 14 |
| S6 | Retry and timeout configuration surfaced in the UI | Engine may support it before the UI does |

---

## Post-Hackathon

Explicitly deferred. Do not build now.

Multilingual voice output / TTS. Third-party plugin marketplace with external publishing. Teams,
roles, permissions, sharing. Workflow versioning, branching, diffing. Credential vault with
managed KMS. Self-hosted installer. Mobile apps. Observability and metrics stack.

---

## Out of Scope

Will not be built, in any form.

- Arbitrary untrusted code execution — not sandboxed, not "just for the demo"
- Parity with n8n's integration catalogue
- Billing, subscriptions, usage metering
- Enterprise SSO beyond Google
- Any guarantee framed as uptime, SLA, or "unbreakable"

---

## Functional requirements

**Auth.** Google OAuth only. A session survives a page reload. Every workflow, run, and credential
is scoped to its owner, enforced server-side.

**Workflows.** Create, rename, delete. A workflow is a set of nodes and directed edges with
per-node configuration. Save and load must round-trip losslessly — a saved workflow reloads
identically. Canvas supports add, connect, move, delete, and per-node config editing.

**Execution.** A run is triggered manually, by webhook, or by schedule. The engine walks the DAG,
executes each node through the registry, passes output forward, and records a step record per node
with status, timing, input, output, and error. Supports sequential chains, conditional branches,
and a bounded loop. A failed node fails its run with the error surfaced in the UI.

**Live view.** While a run is active the UI shows per-node status transitions and log lines as
they happen, without a manual refresh.

**Agent nodes.** An LLM node calls the configured model with a prompt built from upstream output.
An agent node is given a tool set derived from the node registry, and decides at runtime which
tools to call and in what order, within a bounded number of steps. Tool-calling can reach only
registered nodes.

**Generation.** A natural-language request produces a valid, persisted, executable workflow that
appears on the canvas. Invalid model output is rejected and reported rather than saved broken.

**Configuration.** Model and provider selection in-app. The user supplies their own API key, which
is encrypted at rest and never returned to the client in plaintext. Integration credentials follow
the same rule.

**Triggers.** Each webhook trigger has an unguessable URL that validates its payload. Schedule
triggers fire on a cron expression.

---

## Non-functional requirements

| Area | Requirement |
|---|---|
| Deployment | Publicly reachable HTTPS URL, working from any machine, live from Phase 2 onward |
| Responsiveness | Usable from ~375 px to desktop. The canvas may degrade on very small screens but must not break |
| Accessibility | Keyboard-operable primary flows, visible focus, labelled controls, sufficient contrast. Not a full WCAG audit |
| Performance | Page interactive in < 3 s on the deployed URL. Node status updates visible in < 1 s of the transition. A trivial workflow completes in < 5 s excluding model latency |
| Reliability | The demo path in `DEMO.md` does not fail. Broad error handling elsewhere is explicitly not a goal |
| Cost | Zero. Cloud Run Always Free + $300/90-day credit, Neon free tier, Gemini free tier |
| Security | See `CLAUDE.md` → Security rules. Credentials encrypted at rest; agent tools restricted to the registry; no arbitrary code execution |

---

## Demo requirements

The demo is a scope contract. `DEMO.md` holds the script; the requirements on it:

- Runs **end to end on the deployed URL**, not locally
- Fits in 3 minutes
- Does not depend on anything fragile being typed live
- Exercises every MVP-Critical feature
- Has a documented fallback for each external service it touches

---

## Success criteria

Ranked. Earlier items are not tradeable for later ones.

1. The deployed URL works from a machine that has never seen the project
2. Google sign-in works in production
3. A natural-language request produces a real workflow on the canvas
4. That workflow runs, and per-node status and logs stream live
5. An agent node makes a visible runtime decision
6. A result lands in a real external service
7. The UI is something a judge would call well-made
8. The repository is complete enough that a stranger can run it

---

## Deviations from the original brief

Recorded so no future session treats these as oversights.

**Two LLM providers → one.** The brief required at least two providers so model selection would be
a real feature. Only Gemini keys are available. Rather than ship a dropdown with one entry and
call it provider-agnostic: the adapter layer is genuinely provider-agnostic, Gemini is the only
provider wired at MVP, and model selection is real across Gemini tiers (Pro / Flash / Flash-Lite).
A second provider is **S1**, reachable in well under an hour once a key exists.
*Cost:* provider-agnosticism is architectural at MVP, not demonstrated.
*Benefit:* Gemini's free tier holds LLM spend at zero.

**Slack → Discord.** The brief's demo spine posted to Slack. A Slack workspace cannot be
authorised for this build; Discord webhooks need no app review. Same demo beat, same shape, no
approval dependency.
