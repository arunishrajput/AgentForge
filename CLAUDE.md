# CLAUDE.md — How to work on AgentForge

Read this first, then `PROGRESS.md`, then `BUILD_PLAN.md` → *Chapter 2*. **Before implementing
anything, read all three.** The current work is **Chapter 2, phases 13–25** — the hackathon is
over. Then read only the further docs the phase actually needs: `CONTRACT.md` before
touching a shared schema or protocol, `DEPLOYMENT.md` before any cloud work, `ARCHITECTURE.md`
before adding a component or a dependency, `DESIGN.md` before touching the interface.

This project is built one phase per session with `/clear` between every session. **Chat memory is
disposable. This repository is the only persistent memory.** Everything a cold session needs to
continue must live in these files.

---

## The loop

```
Read state → identify the next incomplete phase → implement exactly that one phase
  → verify (deployed, from Phase 2 onward) → update docs → commit → push → stop
```

Do not silently begin the next phase in the same session. Stop and say `/clear`.

---

## Project identity

**AgentForge** is an agentic workflow automation platform — *n8n, but the workflows are built and
driven by AI agents rather than hand-wired by the user.*

**One sentence:** describe what you want in plain language, and AgentForge builds a real,
executable, visually editable workflow whose agent nodes reason and decide at runtime.

A user types a natural-language request. The system produces a genuine workflow on a canvas —
nodes, connections, editable configuration — not a mockup. It runs, streams per-node status and
logs live, and its agent nodes use tool-calling to decide what to do at runtime instead of
following a fixed script.

**Context: the hackathon is over and Chapter 2 has begun.** AgentForge was built in 13 phases
(0–12) for the Zero Origin hackathon and submitted on 2026-09-26
(<https://devpost.com/software/agentforge-kz832x>). That chapter is closed and is not reopened.

**The work now is turning a shipped MVP into a real, professional, open-source product.** The
roadmap is `BUILD_PLAN.md` → *Chapter 2*, phases 13–25. The goal, chosen deliberately, is an
**open-source showpiece**: a repository that a stranger lands on and immediately takes seriously.

**Four decisions are settled and binding.** Do not re-litigate them without flagging it:

| Decision | Value |
|---|---|
| **Budget** | **Still strictly zero.** Free tiers only. A phase needing paid infrastructure stops and escalates |
| **Visual direction** | **Toybox — bright, playful, light-first.** Saturated colour, thick dark outlines, chunky offset shadows, springy motion. Not a dark IDE |
| **Restored scope** | Teams/roles/sharing, workflow versioning and diffing, observability and metrics, and a credential vault with rotation are all **back in scope** |
| **Purpose** | Open-source showpiece. Prioritise what a stranger reading the repo notices |

---

## Product objective

**A genuinely good, genuinely professional product that happens to be free to run.**

Chapter 1's metric was "a working, publicly deployed, reliably demonstrable product", and it was
met. Chapter 2's metric is different:

- The product works for a **real user who was never given a script**, not just along a demo path
- The repository is **legible to a stranger** — documented, tested, CI-checked, licensed
- The interface is **distinctive and delightful**, not a template
- It stays **free to operate**

There is no deadline. **Quality is the binding constraint now, not time.** A phase that is half
done is not done, and there is no longer any reason to cut corners to reach one.

---

## Core constraints

| Constraint | Value |
|---|---|
| Time | **No deadline.** Quality binds, not time. Do not rush a phase |
| Developer | Operating Claude Code directly. No review process, no parallel agents |
| Host | Google Cloud Run (single container) — **binding**, see `ARCHITECTURE.md` |
| Database | Neon Postgres, free tier, pooled connection string |
| Queue | In-process today. **Phase 17 replaces this with Cloud Tasks** — free tier, durable runs |
| LLM | Google Gemini, behind a provider-agnostic adapter. A second provider lands in Phase 23 |
| Cost | **Zero, still binding.** Cloud Run Always Free + Neon free + Gemini free tier. Escalate rather than provision anything paid |
| Deployment | Live and reachable, and must stay live. Every phase ends with it working |

---

## Documentation map

| File | What it is | Read it when |
|---|---|---|
| `CLAUDE.md` | This file — how to work here | Always, first |
| `PROGRESS.md` | Current execution state. The status board | Always, second |
| `BUILD_PLAN.md` | The phase roadmap and every phase definition | Always, third |
| `PRD.md` | What the product must do, and must not | Before adding or cutting a feature |
| `ARCHITECTURE.md` | How it is built, and the binding Foundation Decision | Before adding a component or dependency |
| `CONTRACT.md` | Interfaces that must stay stable across phases | Before touching a shared schema or protocol |
| `DEPLOYMENT.md` | How to deploy and verify, resource inventory | Before any cloud work |
| `DESIGN.md` | The Toybox design language. **Created in Phase 14** | Before any UI work |
| `DEMO.md` | **ARCHIVED.** The hackathon demo script. Historical only — no longer a scope contract | Rarely |
| `SUBMISSION.md` | **ARCHIVED.** Devpost submission copy as submitted | Rarely |
| `SECURITY.md` | Security posture and disclosure. **Created in Phase 21** | Before touching auth or crypto |
| `OPERATIONS.md` | Running it in production. **Created in Phase 22** | Before an operational change |
| `docs/`, `adr/` | The docs site and decision records. **Created in Phase 24** | When documenting |
| `README.md` | Practical entry point | When orienting from scratch |

### Framework docs — read them, do not recall them

**Next 16 is not the Next.js in your training data.** APIs, conventions and file structure
changed. The version's own docs ship inside the repo at `node_modules/next/dist/docs/` — read the
relevant page there before writing framework code. `01-app/02-guides/upgrading/version-16.md` lists
the breaking changes.

Already bitten us: request APIs are async, `middleware` is renamed `proxy` (no edge runtime),
`next lint` is removed, and Turbopack is the default builder. The same rule applies to
`next-auth@5` beta and Drizzle — check the installed package's own types, not memory.

`next dev` wants to append a generated block to this file; `agentRules: false` in `next.config.ts`
disables it, because this file is hand-authored and must not churn.

---

## Source of truth

When sources disagree, higher wins:

1. **Repository implementation** — what actually exists in code
2. **Deployed state** — what is actually running on Cloud Run and in Neon
3. **`CONTRACT.md`** — interfaces that must not drift
4. **`PRD.md`** — what the product must do
5. **`ARCHITECTURE.md`** — how it is intentionally built
6. **`BUILD_PLAN.md`** — how the work is phased
7. **`PROGRESS.md`** — current execution state
8. Other documentation
9. **Conversation history** — background only, never an override

Never assume documentation is current. On a discrepancy: detect it, determine what actually
exists, determine what was intended, correct the appropriate source, record material ones in
`PROGRESS.md`, and say so out loud. Escalate rather than guess when the gap materially changes
scope, security, cost, or core architecture.

---

## Session workflow

When the user says **"Start the next phase"** (or runs `/next-phase`), do all of this without
being asked:

1. Inspect the repository
2. `git status` — check for uncommitted or unpushed work
3. Read `CLAUDE.md`, `PROGRESS.md`, `BUILD_PLAN.md`
4. Read only the further docs the next phase needs
5. **Verify the actual state.** Does the deployed URL respond? Does the database have the
   expected tables? Do not trust the docs
6. Determine: current phase, whether the previous phase genuinely completed, what remains,
   blockers, branch, deployment state
7. Summarise that understanding briefly
8. Begin implementing the **next incomplete phase**

Do not ask "what should I work on?" unless the repository genuinely cannot answer it.

---

## Phase workflow

One session, one phase. Do not jump ahead because a later phase looks more interesting.

Every phase in `BUILD_PLAN.md` carries: Objective, Dependencies, Tasks, Primary Files/Areas,
Implementation Notes, Validation Steps, Completion Criteria, Documentation Updates, Commit
Requirement. Work the phase as written; if the phase is mis-sized or wrong, say so and adjust
`BUILD_PLAN.md` deliberately rather than drifting.

### End-of-phase protocol

```
1.  Finish implementation
2.  Run verification (including deployed verification from Phase 2 onward)
3.  Inspect the git diff — never commit blindly
4.  Update PROGRESS.md
5.  Update any documentation the phase invalidated
6.  Confirm no secrets are staged
7.  Commit
8.  Push
9.  Confirm the push actually succeeded
10. Report the phase completion summary
11. Stop and tell the user to run /clear
```

### A phase is done when all of these are true

- Implementation exists
- Configuration exists
- Checks and critical-path tests pass
- The integration actually works end to end
- Deployment is updated and verified (Phase 2 onward)
- Documentation is updated
- `PROGRESS.md` is updated
- The git diff has been inspected
- Changes are committed, pushed, and the push is confirmed

**Code written is not done.** Do not mark a phase complete because most of it is finished.

### If a phase cannot be completed

1. Diagnose the blocker
2. Fix it if that is safely in scope
3. If it needs the user, emit a `MANUAL ACTION REQUIRED` block
4. Update `PROGRESS.md`: what is blocked, why, the exact action needed, the verification command
5. Commit and push the valid work
6. Mark the phase `BLOCKED`
7. Explain what must happen before the next session can continue

Do not fake completion.

---

## PROGRESS.md requirements

`PROGRESS.md` is the most important operational file — a fresh session reads it and immediately
knows where things stand. Keep it **concise and operational**: a status board, not a diary.
Prune stale detail rather than appending forever.

Update it at the end of every phase, and mid-phase whenever the project state materially changes
(a resource created, a blocker found, a decision made).

---

## Git workflow

**Work directly on `main`.** Use a short-lived phase branch only when a phase is
genuinely risky — a large refactor, or a deployment experiment that could break a working deploy —
and merge it in the same session.

- Meaningful commits; inspect the diff before committing
- Push completed work; keep GitHub synchronised
- Never commit secrets or credentials
- Never force-push unless it is explicitly safe and necessary

Commit convention:

```
feat: complete phase 06 agent layer and provider configuration
fix: correct sse reconnect on deployed environment
docs: update progress and deployment state for phase 04
```

**GitHub is the persistent backup.** At the end of every phase, code + docs + `PROGRESS.md` +
deployment state must be pushed, so a fresh session recovers entirely from the repository.

---

## Deployment workflow

Full commands live in `DEPLOYMENT.md`. The shape:

```bash
gcloud run deploy agentforge --source . --region <REGION> --allow-unauthenticated
```

**Never report "deployment successful" because a command exited zero.** Verify through:

- Service status and revision (`gcloud run services describe`)
- Logs (`gcloud run services logs read`)
- HTTP requests against the live URL
- The auth flow completed against the deployed app
- Database queries against the deployed database
- A realtime connection established from a browser
- At least one full workflow executed end to end on the deployed system

Deployment is complete when the deployed system **actually behaves correctly**.

Every phase after Phase 2 ends with the deployed environment still working, or the phase is not
complete.

---

## Manual action rules

Some things genuinely require the user: OAuth consent screens, billing, account creation,
third-party authorisation. Never say "configure this in the console." Emit exactly this:

```text
MANUAL ACTION REQUIRED

Reason:
<why this is needed and what breaks without it>

Location:
<exact site, exact page, exact menu path>

Steps:
1. ...
2. ...
3. ...

Values to enter:
<exact strings, URLs, scopes, redirect URIs — literal, copy-pasteable>

Expected result:
<what the user should see on screen when it worked>

Verification:
<the exact command Claude Code will run to confirm it>

Resume by:
<what the user types back>
```

Then **continue automatically with everything that does not depend on it.** If it genuinely
blocks the phase, mark the phase `BLOCKED — WAITING FOR MANUAL ACTION` in `PROGRESS.md`, commit
and push the valid work, and stop.

After the user confirms, the next session **verifies the result** rather than assuming it worked.

---

## Testing expectations

**Chapter 1's "no large test suite" rule is retired.** It was correct for a 13-phase sprint and is
wrong for a product people are meant to trust and contribute to.

From Phase 13 onward:

- **CI is mandatory and must stay green.** Typecheck, lint, test and build on every push and PR.
  A red pipeline is a stop-work condition, not a note for later
- **Every bug fixed gets a test that fails without the fix.** No exceptions
- **Critical paths carry real coverage**: the execution engine, the node registry, the generator,
  the agent loop, authorisation, and encryption
- **Tests still run on Node's built-in runner.** It works, it is fast, and it costs no dependency.
  Do not introduce a heavier framework without a concrete reason

Still true, and learned the hard way in Chapter 1:

1. **The API suites cannot see the browser.** 178 deployed checks and ten clean smoke walks all
   passed while a webhook-triggered run was invisible on the canvas. **Drive a real browser before
   believing a UI claim**
2. **Deployment verification is not optional.** A green local suite says nothing about production
3. **A generated graph can be valid and still do the wrong thing.** Validation proves a workflow
   *can* run, never that it does what was asked

---

## Scope control

**The hackathon scope rules are retired.** `DEMO.md` is no longer the scope contract, "unbreakable"
no longer means *only the demo path*, and the MVP-Critical / Post-Hackathon classification in
`PRD.md` has been rewritten for Chapter 2.

**`BUILD_PLAN.md` Chapter 2 is the scope contract now.** A feature that is not in a phase is not
in scope; if it should be, add it to a phase deliberately and say so.

Priority ordering, applied to every decision:

```
Correct, working software
  > a product a stranger can actually use
  > clear architecture and documentation
  > visual craft and delight
  > feature count
```

Note what moved. Documentation went from last to third, because the purpose is an open-source
showpiece. Feature count is still last.

**Still avoid:** speculative abstraction, premature optimisation, infrastructure for imagined scale,
microservices, and enterprise process. **Now welcome**, where a phase calls for it: real tests, real
error handling, real observability, a real authorisation layer, and the time to build them properly.

**Build for the stranger reading this repository**, not for a judge watching a three-minute demo.

---

## Security rules

Never commit secrets, API keys, or credentials. Never hardcode credentials. Never log secret
values. Never disable a security mechanism to make something work. Never make destructive
infrastructure changes without understanding the impact. Never delete resources casually.

Specific to AgentForge:

- **Third-party integration credentials are encrypted at rest** and never returned to the client
  in plaintext
- **User-supplied LLM API keys are secrets** — same rules
- **Webhook trigger endpoints must be unguessable** and validated
- **Agent tool-calling reaches only the explicitly registered node set** — never arbitrary shell,
  filesystem, or network access
- **No arbitrary user code execution.** Not in any form, not sandboxed, not "just for the demo"

For destructive or high-impact operations, explain the intended action and get confirmation first.
Prefer safe, reversible operations.

---

## Cost rules

Hosting and LLM costs stay at zero. Prefer free tiers and small instances. Avoid always-on
resources that serve no purpose. Cache or stub LLM calls during development where that does not
reduce fidelity. Do not add infrastructure for theoretical scale.

Before provisioning anything, **check whether it already exists.** Across `/clear` boundaries this
is critical — do not recreate a database because the previous session's context is gone. The
inventory is in `PROGRESS.md` and `DEPLOYMENT.md`. Reuse and update; create only when genuinely
necessary.

---

## Never do

- Never mark a phase complete when it is not
- Never report a deployment successful without verifying behaviour
- Never start a later phase while a required earlier phase is incomplete
- Never reopen a Chapter 1 phase (0–12). A defect left behind is an item inside a Chapter 2 phase
- Never provision paid infrastructure. The zero-cost ceiling binds — escalate instead
- Never commit secrets
- Never re-litigate the Foundation Decision or the hosting platform without flagging it to the
  user as a material change
- Never invent a contract, an interface, or a fact. Use the markers below
- Never build anything on the Out of Scope list in `PRD.md`
- Never implement arbitrary code execution

---

## Recovering from an incomplete session

If a previous session ended mid-phase:

1. `git status` and `git log --oneline -5` — find what landed and what did not
2. Read `PROGRESS.md` → *Current Phase Tasks*, *Blocked Tasks*, *Manual Actions Pending*
3. **Verify the real state** rather than trusting the notes: does the deployed URL respond, do the
   expected tables exist, does the build pass
4. If the working tree has uncommitted work, understand it before touching it — it may be
   half-finished, and the diff is the record of what the previous session was doing
5. Reconcile `PROGRESS.md` with what you actually found, then resume the same phase from the
   first genuinely incomplete task

---

## Handling uncertainty

Do not invent details. Use these markers, in the docs and in conversation:

- `UNKNOWN — VERIFY` — information needed but not yet confirmed
- `NOT YET DECIDED` — a decision deliberately deferred to a later phase
- `SUPERSEDED` — previously considered, now replaced (keep the reason)

Known unknowns carried forward, all for Phase 13 to resolve with measured numbers: **how much
Neon CU-hour headroom actually remains**; **the real Cloud Tasks, Cloud Logging and Secret Manager
free-tier limits**; and whether the deterministic
Cloud Run URL form allows pre-registering the OAuth redirect URI; the Foundation Decision until
Phase 0 resolves it.

When plan and reality diverge: identify the discrepancy, explain the practical impact on the
product and the roadmap, choose the simplest solution that preserves the product goal, update the affected
docs and `PROGRESS.md`, and continue if the change is safe. **Stop for the user's input only when
the change materially affects product scope, security, cost, or core architecture** — including
any change to the Foundation Decision or the hosting platform.
