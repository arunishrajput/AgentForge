# 0001 — Build fresh in one Next.js app; borrow libraries, not a codebase

**Status:** Accepted · **Date:** 2026-09-25 · **Phase:** 0

## Context

AgentForge had to be a working, publicly deployed workflow automation platform, built solo, on a
hard zero-cost ceiling, against a hackathon deadline. The obvious shortcut was to fork a mature
open-source platform — n8n, Activepieces, Flowise, Windmill, Langflow, Typebot — and bend it.

Two constraints decided it, and both were measured rather than assumed:

**The deployment unit is one Cloud Run container.** Every fork candidate is a multi-service
monorepo: Activepieces is NestJS + Angular, Flowise is Express + a Vite SPA, Windmill is Rust +
Svelte. A fork's *first* task would be collapsing its topology — hours of work producing nothing
anybody can look at.

**The cold-start cost was measured on 2026-09-25**, from each repository: n8n 123 MB of
TypeScript, Activepieces 49 MB, Windmill 17 MB of Rust plus 12 MB of Svelte, Langflow 32 MB of
Python, Flowise 8.3 MB. The MVP's engine — a DAG walk, a branch, a bounded loop, step records —
is a few hundred lines. **Reading enough of any candidate to modify it safely costs more than
writing that.**

Licences were verified by reading each repository's own LICENSE file, not by trusting GitHub's
detected label — five of nine resolve to `NOASSERTION` under GitHub's detection, so the label is
not usable evidence. That exercise also corrected the brief: the claim that n8n's licence
"restricts hosting a competing product" is **false** — the Sustainable Use License contains no
such clause. n8n stayed excluded on three real grounds instead (the SUL forecloses future
commercial use, `master` is the only licensed branch, and it is the worst cold-start cost of any
candidate). The conclusion survived; the reasoning had to be replaced.

## Decision

**Harvest.** Build fresh in a single Next.js App Router application. Borrow **React Flow**
(MIT) for the canvas and **Auth.js** (ISC) for Google OAuth. Write the execution engine, the node
registry, the generation layer and the provider adapter ourselves.

No borrowed codebase. No fork to strip.

## Consequences

**What it bought.** One container, as the host requires, with no topology to collapse first. An
engine shaped around the product's actual needs — in particular that the agent's tool surface
*is* the node registry ([0003](./0003-node-registry-is-the-spine.md)), which no candidate's data
model would have given for free. Dependencies measured in single digits.

**What it cost.** The integration catalogue starts **empty**. This was accepted explicitly: the
requirement was four integrations, not four hundred. It reached nine real services by Phase 23C,
each one additive because of the registry.

**What it keeps open.** Nothing copyleft or source-available is inherited, so this project's own
licence was an unconstrained choice when Phase 24 came to make it. Every adopted dependency is
permissive — Next.js, React, React Flow, Zod and Tailwind MIT; Auth.js ISC; Drizzle Apache-2.0;
postgres.js public domain. That is a direct consequence of this decision and would not have held
under a Windmill fork, which imposes AGPL on everything derived.

**One part of this record was wrong for six phases.** The original named the Vercel AI SDK among
the libraries to borrow. It was superseded in Phase 6 and never installed
([0002](./0002-no-llm-sdk.md)), but *this* text kept saying otherwise until Phase 12's
reconciliation caught it. The lesson is recorded rather than tidied away: a decision marked
superseded in one document stays wrong in every other document that restates it.

## Alternatives

| Rejected | Why |
|---|---|
| **Fork Flowise** | Best-licensed and smallest TS candidate (Apache-2.0, 8.3 MB), but Express + Vite SPA is two services to collapse, and a chatflow model is not automation with triggers |
| **Fork Activepieces** | MIT core and the closest conceptual match, but Angular + NestJS + 49 MB is the wrong stack at the wrong size |
| **Fork Windmill / Langflow** | Rust and Python; both break the single-JS-container premise. Windmill additionally imposes AGPL on everything derived |
| **Fork n8n** | See above — excluded on commercial foreclosure, branch licensing, and 123 MB of cold start |
| **Build with no borrowed libraries at all** | Hand-writing a canvas or an OAuth flow is a day each, and neither is a differentiator |
