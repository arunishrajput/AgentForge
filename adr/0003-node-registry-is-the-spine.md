# 0003 — One node registry feeds the engine, the canvas and the agent's tools

**Status:** Accepted · **Date:** 2026-09-25 · **Phase:** 3

## Context

The original plan built the node registry in Phase 8, alongside the integrations, and the agent
layer in Phase 6. That ordering inverts the real dependency.

**The agent's tool surface *is* the catalogue of nodes.** An agent node decides at runtime which
node to call; the set it may call has to exist before the agent does. Building the agent first
would have meant writing a parallel list of tool definitions, then reconciling it with a registry
built two phases later — two sources of truth, created deliberately, in a codebase that would
then have to keep them in sync for ever.

The same question applies to the canvas palette and the engine's dispatch table. All three need
the same facts about a node.

## Decision

Build the registry in Phase 3, before anything that consumes it. A node is **one object**:

```ts
{ type, label, description, kind, category, outputs, outputShape, docs,
  configSchema, agentCallable, execute }
```

and that single object feeds three consumers:

| Consumer | Reads |
|---|---|
| Engine dispatch | `kind`, `configSchema`, `execute` |
| Canvas palette and config forms | `label`, `category`, `outputs`, `configSchema` |
| Agent tool set | `description`, `configSchema`, `agentCallable` |

The generation prompt's node catalogue is rendered from the same projection the palette uses.

## Consequences

**Adding an integration widens the agent, the generator and the palette at once.** Phases 8 and 9
registered nodes and touched nothing else. Phase 23C added the Postgres node and wrote **no
route, no settings card, no rotation rule and no vault entry** — that was the phase that existed
to test this claim rather than assert it.

**A node's `description` became a contract.** The agent reads it verbatim to decide what to call,
so it is written for a model — terse, imperative, about *when to call this*. Phase 23A had to add
a second field, `docs`, for the prose a person reads in the inspector, because one string written
for both audiences served neither. That is a direct consequence of this decision: the registry
entry is read by a model, and that imposes a style on it.

**It is the security boundary.** The agent can reach registry entries and nothing else — no
shell, no filesystem, no arbitrary network. `agentCallable` defaults to `false`, so widening the
agent's reach is a deliberate act per node rather than a side effect of registering one.

**It made the documentation generable.** `docs/nodes.md` is produced from the registry by
`scripts/build-docs.mjs`, and CI fails if it drifts. A hand-written node reference would have
been a fourth consumer, maintained by hand, out of date within a phase.

**Where the claim does not hold, recorded precisely.** Registering a node is not *always* enough.
Phase 9 had to edit the generation prompt's surrounding prose, which hardcoded "sending email,
posting to a chat service, writing to a spreadsheet" as examples of things to report as
unsupported. Registering those nodes did not stop the model believing that sentence. **A prompt
that names specifics dates like code, and nothing type-checks prose.**

## Alternatives

| Rejected | Why |
|---|---|
| **Registry in Phase 8, as originally planned** | Inverts the dependency. The agent would have needed a parallel tool list two phases before the registry existed |
| **Separate tool definitions for the agent** | A second source of truth by construction. The drift shows up as a model emitting config the engine rejects — at runtime, in front of a user |
| **A plugin system with dynamic registration** | Speculative abstraction for a catalogue that is a TypeScript array. It also dissolves the security boundary, which depends on the set being closed and known at build time |
