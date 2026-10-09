# Architecture Decision Records

A decision belongs here once it has **outlived the phase that made it** — when a later change
would have to argue with it rather than simply edit around it.

These are extractions, not new reasoning. Each one already existed as prose in
[`../ARCHITECTURE.md`](../ARCHITECTURE.md) and [`../PROGRESS.md`](../PROGRESS.md); what an ADR
adds is a standard shape, a status, and an honest *Consequences* section — including the ones
that turned out badly.

## The records

| # | Decision | Status |
|---|---|---|
| [0001](./0001-harvest-not-fork.md) | Build fresh in one Next.js app; borrow libraries, not a codebase | Accepted |
| [0002](./0002-no-llm-sdk.md) | No LLM SDK — the provider adapter is a `fetch` client we own | Accepted |
| [0003](./0003-node-registry-is-the-spine.md) | One node registry feeds the engine, the canvas and the agent's tools | Accepted |
| [0004](./0004-no-queue.md) | No queue; the executor runs in-process | **Superseded by [0005](./0005-durable-runs-on-cloud-tasks.md)** |
| [0005](./0005-durable-runs-on-cloud-tasks.md) | Durable runs on Cloud Tasks; the in-process path is kept | Accepted |
| [0006](./0006-timers-on-cloud-tasks.md) | Schedules fire from per-slot Cloud Tasks timers, not a polling cron | Accepted |
| [0007](./0007-three-themes-light-first.md) | Three themes, Light the default, every one held to the same gates | Accepted |
| [0008](./0008-catalogue-selection-and-eval-set.md) | Generation sees only the nodes a request needs, and is measured | Accepted |
| [0009](./0009-copilot-proposes-the-user-accepts.md) | The copilot proposes; the person accepts | Accepted |
| [0010](./0010-security-headers-without-script-src.md) | Anti-framing and a partial CSP, with no `script-src` | Accepted |

## Status values

- **Accepted** — in force. The code reflects it.
- **Superseded** — replaced. The record **stays**, with a pointer to what replaced it and why,
  because the reasoning that was right at the time is the most useful part of it.
- **Proposed** — written down, not yet decided.

An ADR is never edited to pretend a decision was always what it is now. 0004 is the reason this
directory is worth having: it was correct when it was made, it was wrong eighteen months of
product later, and both halves are true at once.

## Format

```markdown
# NNNN — Title

**Status** · **Date** · **Phase**

## Context      What was true that forced a decision
## Decision     What was decided, in the active voice
## Consequences What this bought, and what it cost
## Alternatives What was rejected, and why
```

New decisions get the next number. Numbers are never reused.
