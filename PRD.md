# PRD.md — AgentForge

What the product must do, and what it deliberately will not. `BUILD_PLAN.md` is the phase-level
scope contract; this file is the index of capabilities and the line drawn around them — the
*Out of scope* list below binds every chapter.

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

**A small team is now in scope**, as of Chapter 2 — a workspace with a handful of people in it, not
an org chart. Phase 19A made every resource belong to a workspace rather than to a person; Phase 19B
lets somebody be invited into one. "Enterprise teams" stays out: no SSO, no SCIM, no audit export,
no compliance posture.

---

## Product objective

**Chapter 1 (phases 0–12, shipped):** a working, publicly deployed, reliably demonstrable MVP.
Met, and closed.

**Chapter 2 (phases 13–25, shipped):** a real product and a serious open-source repository — one a
stranger can run, understand, trust and contribute to, that still costs nothing to operate. Met, and
closed on 2026-10-01.

**Chapter 3 (phases 26–42, current):** a product people **use every day**. It is easier to build
with: undo, copy and paste, notes, and a test loop. It is safer to rely on: run history, retries,
error paths and alerts. It can be changed by asking: a copilot that edits and repairs workflows. And
it can automate work that needs waiting, people and other workflows. It looks right in Light and
Dark, and it still costs nothing to operate.

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

**The daily-use journey Chapter 3 adds**, on top of the one above:

9. Choose Light, Dark or System, and have it stick — with no flash on load
10. Ask the copilot to *"also post the urgent ones to Slack"*, review the change as a diff, accept
    it — and undo it if it was wrong
11. Pin a node's output and run one node at a time while building
12. Find last Tuesday's failed run, ask *why did this fail?*, accept the proposed fix, and retry from
    the failed step
13. Be told about a failure — in the app's inbox, and through an error workflow posting to the
    channel of your choice
14. Build a workflow that waits a day, asks a person to approve, or calls another workflow
15. Tag, star, duplicate, export and import workflows; drive them from a script with a token

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
| C1 | Playful light-first design system (Toybox) | 14 — **DONE** | Not conceived — Chapter 1 shipped dark |
| C2 | Full UI rebuild, shell and canvas | 15–16 — **DONE** | MVP styling only |
| C3 | Durable execution, resumable runs, a real queue | 17 — **DONE** | Carried risk: "in-flight runs die on redeploy" |
| C4 | Retry and timeout configuration in the UI | 17 — **DONE** | S6, never built |
| C5 | Workflow versioning, restore, visual diff | 18 — **DONE** | Post-Hackathon |
| C6a | Workspaces: the data model and scoping | 19A — **DONE** | Post-Hackathon |
| C6b | Membership: invitations and the switcher | 19B — **DONE** | Post-Hackathon |
| C7 | Roles, permissions, sharing | 20 — **DONE** | Post-Hackathon |
| C8 | Credential vault, rotation, audit log | 21 — **DONE** | Post-Hackathon. Rotation was the sharpest known gap |
| C9 | Observability, metrics, run analytics | 22 — **DONE** | Post-Hackathon |
| C10a | Transform and control-flow nodes — registry to 25 | 23A — **DONE** | S5, capped for time |
| C10b | Integration nodes: Slack, Notion, GitHub, Airtable — registry to 29 | 23B — **DONE** | S5. Each needs an account |
| C10c | A Postgres node, read-only — registry to 30 | 23C — **DONE** | S5. Reaches a wire protocol, not an HTTPS API. **Read-only by construction: no SQL field, and every query runs in a read-only transaction** |
| C11 | Template gallery | 23A — **DONE** | S4, never built |
| C12 | A second LLM provider | 23D | **DONE 2026-10-01.** Groq, behind the same adapter. Proved on the deployed app with a real completion *and* a real tool call; existing `llm.google` credentials proved unchanged on the deployed database |
| C16 | Per-node documentation in the inspector | 23A — **DONE** | New in Chapter 2 |
| C13 | Real test suite, coverage, CI | 13 | Explicitly excluded |
| C14 | Docs site, ADRs, contributing guide, licence | 24 | Did not exist |
| C15 | Onboarding, full a11y audit, broad error handling | 25 | Explicitly excluded |

**Deferred again, deliberately.** Not because they are bad, but because they need the above first:
voice input and i18n (old S2/S3 — low value until the UI settles); a plugin marketplace with
external publishing; real-time multiplayer editing; mobile apps.

---

## Chapter 3 scope — planned

**Planned with the user on 2026-10-06; phases 26–38 are done.** `BUILD_PLAN.md` → *Chapter 3* is
the contract; this is the index. Numbered `C3-n` so the Chapter 1 and Chapter 2 `C` numbers above
keep their meaning.

| # | Capability | Phase |
|---|---|---|
| C3-1 | **Schedules that fire** without a frequent cron; durable long waits; a per-workflow on/off switch | 26 — **DONE** |
| C3-2 | **Themes: Light (default), Dark ("Toybox Night") and System**, every contrast gate held per theme | 27–28 — **DONE** |
| C3-3 | Undo/redo, copy/paste/duplicate, bulk actions, auto-arrange, keyboard shortcuts with a help dialog, find on canvas | 29 — **DONE** |
| C3-4 | Sticky notes and disabled nodes | 30 — **DONE** |
| C3-5 | Pinned output data, run one node, run up to here, a manual-trigger input form | 31 — **DONE** |
| C3-6 | Tags, favourites, duplicate, import/export JSON, linkable list views | 32 — **DONE** |
| C3-7 | **Run history**, a run detail page, re-run, retry from the failed step, retention | 33 — **DONE** |
| C3-8 | Generation that scales past 30 nodes, measured by an eval set | 34 — **DONE** |
| C3-9 | **A copilot that edits a workflow by conversation**, shown as a diff the user accepts | 35 — **DONE** |
| C3-10 | The copilot explains a workflow and diagnoses a failed run with a proposed fix | 36 — **DONE** |
| C3-11 | Per-node error handling, an error-trigger workflow, an in-app notification inbox | 37 — **DONE** |
| C3-12 | **Human approval steps** — decided in the app or by a signed single-use link | 38 — **DONE** |
| C3-13 | **Sub-workflows, workflows as agent tools, a merge/join node** | 39 — **DONE** |
| C3-14 | A hosted form trigger; custom webhook responses | 40 |
| C3-15 | **A public API** with personal access tokens | 41 |
| C3-16 | Chapter 3 launch polish — a11y and security in both themes, docs, onboarding | 42 |

**Still deferred after Chapter 3:**
- i18n and voice input
- a plugin marketplace
- real-time multiplayer editing
- mobile apps
- parallel node execution
- folders (Phase 32 builds tags instead)

**The copilot, forms and API tokens add no code execution.** The copilot proposes registry nodes
only, as a diff a person must accept. A form submits data to a run. A token calls the same routes a
browser does. **An error workflow is an ordinary workflow** (Phase 37): it is started by another's
failure and handed that failure as data, and it can reach only the registry, like any other.

**What C3-11 means, precisely** (Phase 37, D173–D177). A step's failure can be planned for — stop
the run, carry on with the error as its output, or take an Error path — and a run that planned for
every failure it met **succeeded**, saying how many it handled. A failure nobody planned for, in a run
nobody was watching (a webhook's, a schedule's), reaches **every member who may see the workflow** in
an in-app inbox and starts the workspace's **error workflows**, which is how it reaches Slack, Discord
or Gmail. A run somebody pressed Run on is told on the canvas instead; a test is told to nobody. No
mail provider and no poll — the inbox is read when a page loads.

**What C3-12 means, precisely** (Phase 38, D178–D182). A workflow can stop and **ask a person**, then
carry on with their answer — hours or days later. The approval step sends its link down its **Ask**
path through a Discord, Slack or Gmail step the workspace already has, and waits; the run holds no
container while it does. The people it names — or, naming nobody, any editor — decide in their inbox,
on the canvas or on the run's page; **whoever holds the link decides without signing in**, once. If
nobody does before the timeout, the step's own rule decides: reject (the default), approve, or fail the
run. The run then carries on down **Approved** or **Rejected**, with who decided and their comment.
A link cannot be decided by opening it — only by pressing a button — and is stored only as a hash.

**What C3-13 means, precisely** (Phase 39, D183–D188). Workflows can be built from other workflows. A
**Call workflow** step runs another workflow of the workspace as part of this one, waits for it, and
carries on with what it returned; the called run has its own page, linked both ways. Calls are bounded
as one tree — three levels deep, never in a circle, sharing the caller's steps and clock — and a called
workflow cannot pause the run it is inside. **A workflow can be offered to agents** as a tool — a name,
a sentence, typed inputs — and an agent that lists it can call it, each call a run of its own; it takes
two deliberate acts, so offering a workflow hands it to no agent. A **Merge** step joins branches that
run side by side and runs once, closing the oldest simplification in `ARCHITECTURE.md`. Not in scope: a
called workflow that waits (D183), a generator that writes calls (D188).

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

**Auth.** Google OAuth only. A session survives a page reload. Sign-in answers *who is this* and
nothing else — every authorisation question is answered by workspace membership.

**Workspaces.** Every workflow, run, version and credential belongs to a **workspace**, enforced
server-side on every query; nothing reads across the boundary, and a resource in another workspace
answers 404 rather than 403 so the reply does not confirm it exists. A new account is given a
personal workspace automatically. **Credentials belong to the workspace**, which is what makes a
shared workflow runnable — and means connecting Google lets every member act as you within the
scopes you granted, said plainly where the connection is made.

**Membership.** A person can be in more than one workspace and a workspace can hold more than one
person. Anybody may create a workspace and is its owner. An admin invites by email and gets **one
link to deliver themselves** — there is no mail provider on a zero-cost budget, and the product says
so rather than implying a message was sent. A link is single use, expires in seven days, works only
for the address it names, and can be revoked. The header carries a switcher; a member may leave, and
the last owner may not.

**Roles mean something.** `viewer` reads, `editor` builds and runs, `admin` also invites, connects
credentials, changes other members' roles and publishes share links, `owner` also grants and removes
ownership. **Enforced server-side on every route**, not by hiding buttons — a viewer who crafts the
request is refused with a 403 that names the role required, and the UI additionally withholds the
control, which is a courtesy rather than the enforcement. An admin can move an existing member
between roles; ownership moves only by an owner's hand, and the last owner can neither be removed nor
demoted, so a workspace can never become unadministrable.

**Per-workflow sharing.** A workflow is visible to everybody in its workspace by default, and its
creator or an admin can narrow it to *just me, and the admins* — admins included deliberately,
because a workflow runs with the workspace's credentials and somebody has to be able to account for
that. A workflow narrowed this way is **404 to everybody else**, including its runs and its history,
so its existence is hidden rather than merely its contents. Its own triggers still fire: visibility
governs people, not machines.

**A public share link.** An admin can publish a read-only page for one workflow that anybody with the
URL can open, signed in or not, and revoke it in one press — after which the URL is dead and cannot
come back. The page shows the **shape** of the workflow: its nodes, how they are wired, and every
setting that cannot carry a secret. It withholds **every value the author typed** — URLs, prompts,
message bodies, email addresses, request headers — and says so on the page, with a count of what was
hidden. It carries no run, no credential, no id and nothing about the workspace or who is in it.
What may be published is an allowlist that defaults to publishing nothing, so a node added later
cannot widen it by existing.

**Workflows.** Create, rename, delete. A workflow is a set of nodes and directed edges with
per-node configuration. Save and load must round-trip losslessly — a saved workflow reloads
identically. Canvas supports add, connect, move, delete, and per-node config editing.

**The library** (Phase 32). A workspace files its workflows under **tags** — shared words, one
level, many to a workflow, renamed in one place — and each person **stars** their own. The list
filters by tag and by star, and its whole view (search, filters, sort, tag) lives in the URL, so a
filtered list is a link. A workflow can be **duplicated** on the server (its own webhook URL, the
original's visibility, switched off if it would run by itself), **exported** as a versioned JSON
file that carries the workflow and nothing about where it lived — never a credential, and pinned
test data only when asked — and **imported** into any workspace, which refuses a newer format and
names any node type it does not have rather than dropping it. Folders are deliberately not built.

**Versioning.** Every save that changes the graph or the name is a version, kept with a compact
snapshot. Any version can be read, named and restored; two can be compared on the canvas, showing
nodes added, removed, changed and moved. **Restoring moves the history forward rather than
rewinding it**, so a past run still refers to the graph it actually executed. Every run records
its workflow version, and a resumed durable run executes the graph it started on.

**Run history** (Phase 33). Every run is findable — a workspace-wide list filtered by status,
trigger, workflow and day, paginated on the server — and openable: the graph at the version it
executed with its statuses, every step's logs, and each step's input, config and output on request.
A finished run can be **re-run** with the same input, and a failed one **retried from the step that
failed** once its cause is fixed: the steps that finished are carried over and **not executed
again**, so a retry does not repeat what the original already did to the world. Both run the
workflow as it is saved now. History is kept 30 days, or a workflow's newest 200 runs, and pruned by
the daily sweep — never a run still going or waiting.

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

**The copilot** (Phase 35). An editor can ask for a change to the workflow on the canvas in plain
language. The answer is a **proposal**: validated exactly as a generated workflow is, shown as a diff
with every value it sets, and applied only when the person presses Accept — as one step of undo,
unsaved until they save. It can be refined in the same conversation, rejected without a trace, and
it says what it could not do. Unchanged steps keep their place and settings; an edit never sends run
data to the model; a viewer cannot use it.

**Explain and repair** (Phase 36). The copilot explains a workflow as a walkthrough whose sentences
point at their steps on the canvas, and answers *why did this run fail?* — from the canvas or the
run's page — with a diagnosis that says what failed, the likely cause and what to do, and, where the
fix is a change to the workflow, that fix drafted as an ordinary proposal. Accepted, the fix is saved
and the run retried from the failed step, or re-run when a retry would reuse a step the fix changed.
The run's record reaches the model bounded, scrubbed of anything shaped like a stored credential, and
as data it is told never to follow.

**Configuration.** Model and provider selection in-app. The user supplies their own API key, which
is encrypted at rest and never returned to the client in plaintext. Integration credentials follow
the same rule.

**Triggers.** Each webhook trigger has an unguessable URL that validates its payload. Schedule
triggers fire on a cron expression.

**Approvals** (Phase 38). A step can ask a person to approve or reject, with a message built from the
run's data, and wait up to 30 days. It is decided by a member it allows — named people, or any editor
— in the inbox, on the canvas or on the run's page; or by anybody holding its single-use link, signed
out; or by its timeout. The decision, the decider and a comment are what the next step reads. The
link is never stored in a usable form and never decided by a GET.

---

## Non-functional requirements

| Area | Requirement |
|---|---|
| Deployment | Publicly reachable HTTPS URL, working from any machine, live from Phase 2 onward |
| Responsiveness | Usable from ~375 px to desktop. The canvas may degrade on very small screens but must not break |
| Accessibility | WCAG AA, audited in Phase 25. Keyboard-operable throughout, visible focus, labelled controls, contrast verified on every token pair — which the Toybox palette makes non-trivial. **From Phase 27, in every theme** |
| Theming | Light, Dark and System from Phase 27. **Light is the default** even when the OS is dark (D110). The preference is applied before first paint — no flash — and is stored per browser |
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

**Chapter 3 adds three, ranked after the eight above:**

9. **A person can live in it** — every mistake undoable, every run findable, every failure announced
10. **A schedule fires when it says it will** — and the product says so when it will not
11. **A change can be asked for** — the copilot edits a workflow, and nothing changes without Accept
12. **A failure explains itself** — the copilot says why a run failed and drafts the fix; retrying it
    is one press

---

## Deviations from the original brief

Recorded so no future session treats these as oversights.

**~~Two LLM providers → one.~~ CLOSED at Phase 23D, 2026-10-01.** The brief required at least two
providers so model selection would be a real feature. At MVP only Gemini keys were available, so
rather than ship a dropdown with one entry and call it provider-agnostic, the adapter layer was
made genuinely provider-agnostic with Gemini the only implementation wired.

**Groq is now the second**, behind the same `LanguageModel` interface, chosen for its free tier
and because it is OpenAI-compatible — so the adapter also serves any OpenAI-compatible gateway.
Which provider a workspace uses is stored, per workspace, and a workspace that has never chosen
still gets Gemini: the second provider was not allowed to become the default by arriving.

*What the deviation actually cost, now that it is closed:* the claim "a second provider is a new
file; nothing above the interface changes" was half right, and the half that was wrong was only
discoverable by doing it. Nothing above the interface changed. **Below it, the retry, fallback,
budget and circuit-breaker machinery was sitting inside `gemini.ts`** and had to be lifted into a
shared `chain.ts`, because two copies of Phase 13's wedged-model fix would have drifted. An
untested abstraction was *approximately* right, which is the honest general lesson.

**Slack → Discord.** The brief's demo spine posted to Slack. A Slack workspace cannot be
authorised for this build; Discord webhooks need no app review. Same demo beat, same shape, no
approval dependency.

> **Reversed in Phase 23B.** Slack is in, and the original reason turned out to be the wrong shape
> of obstacle: an *incoming webhook* needs no app review either, only an app the user creates in
> their own workspace. Discord stays — the two sit side by side, and Slack's webhook is the
> stricter of the two, because Slack refuses to let a caller override the channel, username or icon
> where Discord permits a username.
