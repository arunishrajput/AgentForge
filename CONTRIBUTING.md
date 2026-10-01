# Contributing to AgentForge

Thanks for looking. This is a small project with a small number of strong opinions, and the
fastest way to have a good time here is to know what they are before you write anything.

**The short version:** open an issue before a large change, keep the dependency list short, and
every bug fix comes with a test that fails without the fix.

---

## Ways to help that are genuinely useful

**Use an integration that has never been proved against the real service.** Two of the nine —
**Notion and Airtable** — are unit-tested and have never had a real account pointed at them. If
you use either and something is wrong, that is the single most valuable issue you could file.
`README.md` says which seven *are* proven, and against what.

**Report a workflow the generator gets wrong.** A generated graph can be valid and still do the
wrong thing, and validation cannot catch that. The sentence you typed and the graph you got back
is a complete bug report.

**Add a node.** This is the cheapest contribution the architecture allows — see below.

**Improve an error message.** Every failure a user can hit should say what went wrong and what to
do next. Plenty still do not.

---

## Before you start

```bash
git clone https://github.com/arunishrajput/AgentForge.git
cd AgentForge
npm install
cp .env.example .env     # fill it in — docs/self-hosting.md walks through each variable
npm run db:migrate
npm run dev
```

[`docs/self-hosting.md`](./docs/self-hosting.md) is the full setup, including the two mistakes
everybody makes with Neon's two connection strings.

**Everything must pass before you push:**

```bash
npm run check    # lint · typecheck · test with coverage thresholds · docs
npm run build
```

That is the same gate CI runs. A red pipeline is a stop-work condition in this project, not a
note for later.

---

## The opinions

### Dependencies are a cost, and the unit is package count

This project has no LLM SDK, no test framework, no telemetry exporter, no queue client and no
component library — each one a decision with its reasoning written down in [`adr/`](./adr/).

**Adding a runtime dependency needs a reason in the PR.** Not a prohibition — the Postgres driver
was added in Phase 23C after measuring that the alternative was hand-rolling SCRAM-SHA-256 over
TLS, which nobody should do to avoid one package. But the default answer is no, and
"it is only a small package" is not an argument, because the small package has dependencies.

### Tests run on Node's built-in runner

No Jest, no Vitest. It works, it is fast, and it costs nothing.

One consequence to know **before** you write code: `npm test` runs the TypeScript sources
directly, and Node's strip-only mode rejects syntax that needs real transformation. In `src`,
that means **no constructor parameter properties, no enums, no namespaces, no decorators**.

Pure logic is tested by calling it. The engine takes its recorder as an argument and the agent
loop takes its model as an argument, specifically so the properties that matter — *a model that
never stops calling tools is stopped by the cap* — are asserted in milliseconds with no database,
no network and no quota.

### Every bug fix gets a test that fails without the fix

No exceptions. Write the failing test first, watch it fail, then fix it. A fix without a test is
a fix that comes back.

### Read the framework's own docs, not your memory of them

**Next 16 is not the Next.js most people have in their heads.** Request APIs are async,
`middleware` is renamed `proxy`, `next lint` is gone, and Turbopack is the default builder.

The version's own documentation ships inside the repository at `node_modules/next/dist/docs/`.
Read the relevant page there. The same rule applies to `next-auth@5` beta and Drizzle — check the
installed package's types, not a tutorial.

### Documentation is checked, not trusted

`npm run docs:check` runs in CI and fails if:

- `docs/nodes.md` does not match the node registry — it is **generated**, so run
  `npm run docs:build` after touching a node
- a route exists under `src/app/api` and is not named in `docs/api.md`, or `docs/api.md` names one
  that does not exist
- any relative link in the documentation points at a file or a heading that is not there

---

## Adding a node

This is the contribution the architecture is built for. A node is **one object** in
`src/lib/nodes/`, and registering it widens the canvas palette, the generator's catalogue **and**
the agent's tool set at once — there is no second place to update.

1. Write the definition. Copy a neighbour; `transform/filter.ts` is a good short one
2. Add it to the array in `src/lib/nodes/index.ts`
3. **Write `description` for a model, not for a tooltip.** The agent reads it verbatim to decide
   what to call. Terse, imperative, about *when to call this*
4. **Write `docs` for a person.** That is the separate field the inspector shows. Two or three
   sentences, what it accepts, and a worked example
5. Decide `agentCallable` **deliberately.** It defaults to `false`, and that default is a security
   property, not an oversight. If the node reaches a real service, the destination must be fixed
   by the credential rather than chosen by the model
6. `npm run docs:build`, then `npm run check`

If it reaches a third-party service, it also needs a row in the integrations table — one entry
gives it a credential kind, a rotation rule, a settings card and a vault entry. That table is the
point: a fifth integration was one row and no new files.

---

## Pull requests

- **Open an issue first for anything large.** A refactor that lands unannounced is hard to review
  and easy to decline
- **One concern per PR.** A fix and a reformat in the same diff hides the fix
- Commits read `feat:`, `fix:`, `docs:`, `ci:`, `refactor:`, `test:`
- Say in the description **what you verified and how**. "Tests pass" is weaker than "ran it
  against a real Notion database and the row appeared"
- Never commit a secret. `.env` is gitignored and must stay that way

### What gets a PR declined

Speculative abstraction. Infrastructure for imagined scale. A dependency without a reason.
Arbitrary code execution in any form — not sandboxed, not optional, not behind a flag. Anything
that weakens the boundary that the agent can reach registered nodes and nothing else.

---

## Security

**Do not open a public issue for a vulnerability.** [`SECURITY.md`](./SECURITY.md) has the
disclosure process, the current posture, and — worth reading before you report — the section
stating what this product deliberately does **not** claim to protect against.

---

## Where things are

| Looking for | Read |
|---|---|
| How it is built | [`docs/architecture.md`](./docs/architecture.md), then [`ARCHITECTURE.md`](./ARCHITECTURE.md) |
| Why it is built that way | [`adr/`](./adr/) |
| Every node | [`docs/nodes.md`](./docs/nodes.md) — generated |
| The HTTP API | [`docs/api.md`](./docs/api.md) |
| How the agents work | [`docs/agents.md`](./docs/agents.md) |
| Interfaces that must not drift | [`CONTRACT.md`](./CONTRACT.md) |
| Running it in production | [`OPERATIONS.md`](./OPERATIONS.md) |
| The design language | [`DESIGN.md`](./DESIGN.md), and `/design` on the live site |

By contributing, you agree your contributions are licensed under the
[MIT License](./LICENSE).
