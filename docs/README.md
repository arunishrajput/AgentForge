# AgentForge documentation

Five pages. Each one answers a different question, and none of them repeats another.

| Page | Answers |
|---|---|
| [**Self-hosting**](./self-hosting.md) | *How do I run this?* Locally, in Docker, or on Cloud Run — and how to keep it free |
| [**Node reference**](./nodes.md) | *What can it actually do?* All 31 nodes, their configuration and their output shape |
| [**API reference**](./api.md) | *How do I call it?* Every route, its role, and how a request is authorised |
| [**How the agents work**](./agents.md) | *What is the model deciding, and what can it reach?* |
| [**Architecture**](./architecture.md) | *How is it built?* The orientation, and the one idea the rest follows from |

Then, outside this directory:

| | |
|---|---|
| [**Decision records**](../adr/) | *Why is it built that way?* Including one decision that was later reversed, kept as it was written |
| [`../SECURITY.md`](../SECURITY.md) | What is protected, how to rotate it, how to report a problem, and **what is not claimed** |
| [`../OPERATIONS.md`](../OPERATIONS.md) | Running it in production: the signals, the runbooks, the budget |
| [`../CONTRACT.md`](../CONTRACT.md) | The interfaces that must stay stable — graph shape, SSE events, environment |
| [`../DESIGN.md`](../DESIGN.md) | The Toybox design language. The living version is `/design` on the deployed app |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Setup, the opinions, and how to add a node |

---

## If you have fifteen minutes

1. **[Architecture](./architecture.md) → *The registry is the spine*.** One idea explains most of
   the codebase: a node is one object, and it feeds the engine, the canvas and the agent's tool
   set at once.
2. **[How the agents work](./agents.md) → *What the agent cannot reach*.** This is an agentic
   product, so a model picks what to call at runtime. That is a security boundary, and it is drawn
   in three places — none of them a prompt instruction.
3. **[ADR 0004](../adr/0004-no-queue.md), then [0005](../adr/0005-durable-runs-on-cloud-tasks.md).**
   A decision that was right, then stopped being right, and what replaced it. It is the clearest
   window into how this project makes calls.

## What is checked rather than claimed

Documentation rots quietly, so three things here are enforced by CI:

- **[`nodes.md`](./nodes.md) is generated** from the node registry by `scripts/build-docs.mjs`.
  Change a node without regenerating it and the build fails
- **[`api.md`](./api.md) is coverage-checked.** A route that exists and is not documented fails the
  build; so does a documented route that does not exist
- **Every relative link** in this directory, in `../adr/` and in the root documentation must
  resolve — file *and* heading anchor

`npm run docs:check` runs all three. It is part of `npm run check`.

## What is deliberately not here

**The exhaustive versions.** [`../ARCHITECTURE.md`](../ARCHITECTURE.md),
[`../DEPLOYMENT.md`](../DEPLOYMENT.md) and [`../CONTRACT.md`](../CONTRACT.md) are long, specific
and occasionally tedious, and that is correct for what they are. These five pages are the way in;
they link down rather than restate.

**The build plan and the status board.** [`../BUILD_PLAN.md`](../BUILD_PLAN.md) and
[`../PROGRESS.md`](../PROGRESS.md) describe how the project is *made*, not how the product works.
They are honest about what is unfinished, which is why they are worth reading — but they are not
documentation of the product.
