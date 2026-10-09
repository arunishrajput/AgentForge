# 0008 — Generation sees only the nodes a request needs, and is measured

**Status:** Accepted · **Date:** 2026-10-09 · **Phase:** 34 · **Decisions:** D112, D156, D157

## Context

The generator's prompt carried the full definition of every node — about 25,000 characters at 32
nodes — so each new node made every request slower, dearer and less accurate. D112 therefore
**froze the registry** until that was fixed. The product cannot grow, and its cheapest contribution
(a new integration) was closed.

## Decision

The prompt carries an **index line per node** (~116 characters) and a full definition only for the
nodes *selected for the request*: the common triggers and `ai.llm` always, and up to ten more chosen
deterministically by the request's words against each node's description and docs, with a synonym
table about language, not nodes. The model may use any indexed node; a retry carries the full
definition of one it reached from the index. A node's label must select it (`select.test.ts`).

Generation is **measured**: an eval set of 24 requests is scored on a live model and replayed offline
from recordings in CI. A change to the pipeline that makes a recorded case ask for a call it never
made marks it stale rather than passing it.

## Consequences

A new node costs every request ~116 characters, not a whole definition. 16,757 characters on average against
25,081 — and the number is asserted, so it cannot creep. The selector can miss; the eval set's
`--recall` mode measures it alone. Free-tier quota limits how often the live eval can run.

## Alternatives

- **Retrieval by embeddings.** Adds a provider call and a dependency to every generation.
- **Let the model ask for a definition.** A second round trip for every request.
- **Stay frozen.** Honest, and ends the project's growth.
