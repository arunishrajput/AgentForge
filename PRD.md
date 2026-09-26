# PRD.md — AgentForge

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

## Product objective

**Chapter 1 (phases 0–12, shipped):** a working, publicly deployed, reliably demonstrable MVP.
Met, and closed.

**Chapter 2 (phases 13–25, current):** a real product and a serious open-source repository — one a
stranger can run, understand, trust and contribute to, that still costs nothing to operate.

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

## Chapter 2 scope — restored and planned

**Everything below was deferred or cut under hackathon constraints. It is now in scope**, each
mapped to the phase that delivers it. `BUILD_PLAN.md` is the contract; this is the index.

| # | Capability | Phase | Was |
|---|---|---|---|
| C1 | Playful light-first design system (Toybox) | 14 | Not conceived — Chapter 1 shipped dark |
| C2 | Full UI rebuild, shell and canvas | 15–16 | MVP styling only |
| C3 | Durable execution, resumable runs, a real queue | 17 | Carried risk: "in-flight runs die on redeploy" |
| C4 | Retry and timeout configuration in the UI | 17 | S6, never built |
| C5 | Workflow versioning, restore, visual diff | 18 | Post-Hackathon |
| C6 | Workspaces, membership, invitations | 19 | Post-Hackathon |
| C7 | Roles, permissions, sharing | 20 | Post-Hackathon |
| C8 | Credential vault, rotation, audit log | 21 | Post-Hackathon. Rotation was the sharpest known gap |
| C9 | Observability, metrics, run analytics | 22 | Post-Hackathon |
| C10 | Node catalogue well beyond 15 nodes | 23 | S5, capped for time |
| C11 | Template gallery | 23 | S4, never built |
| C12 | A second LLM provider | 23 | S1, blocked on a key |
| C13 | Real test suite, coverage, CI | 13 | Explicitly excluded |
| C14 | Docs site, ADRs, contributing guide, licence | 24 | Did not exist |
| C15 | Onboarding, full a11y audit, broad error handling | 25 | Explicitly excluded |

**Deferred again, deliberately.** Not because they are bad, but because they need the above first:
voice input and i18n (old S2/S3 — low value until the UI settles); a plugin marketplace with
external publishing; real-time multiplayer editing; mobile apps.

---

## Out of scope

Will not be built, in any form.

- **Arbitrary untrusted code execution** — not sandboxed, not "just for a demo", not ever. This is
  the one line the registry architecture exists to hold
- Parity with n8n's integration catalogue
- Billing, subscriptions, usage metering
- Enterprise SSO beyond Google
- Any guarantee framed as uptime, SLA, or "unbreakable"
- **Anything that costs money to run.** The zero-cost ceiling is a product constraint, not a
  temporary one

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
| Accessibility | WCAG AA, audited in Phase 25. Keyboard-operable throughout, visible focus, labelled controls, contrast verified on every token pair — which the Toybox palette makes non-trivial |
| Performance | Page interactive in < 3 s on the deployed URL. Node status updates visible in < 1 s of the transition. A trivial workflow completes in < 5 s excluding model latency |
| Reliability | Runs survive deploys and crashes (Phase 17). Every user-reachable failure has a clear message and a way forward (Phase 25). **The Chapter 1 carve-out for "demo path only" is withdrawn** |
| Cost | **Zero, and binding.** Free tiers only. Escalate rather than provision anything paid |
| Security | See `CLAUDE.md` → Security rules. Credentials encrypted at rest; agent tools restricted to the registry; no arbitrary code execution |

---

## Demo requirements — RETIRED

`DEMO.md` was the scope contract for Chapter 1 and is now **archived and historical**. It is not a
constraint on Chapter 2 work. The script is kept because it documents a path known to work end to
end, which is still useful as a smoke test — but nothing is descoped for failing to appear on it.

---

## Success criteria

Ranked. Earlier items are not tradeable for later ones.

1. **A stranger can run it.** Clone, follow the README, and have it working locally
2. **A new user succeeds unguided** — sign-up to first successful run with no script
3. **Runs are durable.** A deploy mid-run does not lose the run
4. **The agent is reliable**, and when a model degrades it fails fast and visibly rather than
   silently costing 90 seconds
5. **Multi-user works correctly** — a workspace member sees exactly what they should, enforced
   server-side
6. **The interface is memorable.** Someone who sees a screenshot remembers it
7. **The repository reads as professional** — tests, CI, docs, ADRs, licence
8. **It still costs nothing to run**

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
