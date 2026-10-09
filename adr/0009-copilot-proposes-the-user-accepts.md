# 0009 — The copilot proposes; the person accepts

**Status:** Accepted · **Date:** 2026-10-09 · **Phase:** 35–36 · **Decisions:** D161–D172

## Context

Letting a model edit a workflow by conversation is the feature that makes the product feel like an
agent's, and the one that most easily destroys trust: an edit that is wrong and already applied.
Run data, which a diagnosis must read, is attacker-influenced text.

## Decision

The copilot **writes nothing**. `POST /api/workflows/[id]/copilot` returns a *proposal* — a graph —
which the canvas shows as a diff, with every value the model set stated in words. Nothing changes
until **Accept**, which is one step of undo and leaves the workflow unsaved. A proposal is validated
exactly as a generated graph, except that a problem the canvas already had is carried, not blamed on
the model (D162). The model owns what it changes; everything it did not touch is carried by id.

For *why did this fail*, run data is scrubbed per credential kind before it is cut, and reaches the
model as delimited data, never as instructions (D168). The answer is words; the fix is asked for as
an ordinary edit, which is again a proposal.

## Consequences

The model cannot save, run, delete or reach a credential. A mistaken proposal costs one rejected
click. The price is a step: nothing the copilot does is final until a person has seen it. Both
edits and diagnoses are measured by their own eval sets.

## Alternatives

- **Apply, then offer undo.** Faster; fails when the edit is saved by autosave or acted on by a
  schedule before anyone looks.
- **Give the model tools to edit nodes one at a time.** More surface, harder to validate as a whole.
