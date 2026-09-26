# BUILD_PLAN.md — AgentForge

The phase roadmap. **One session, one phase.** Do not start a later phase while a required earlier
phase is incomplete. Current position is in `PROGRESS.md`, not here.

---

## The ladder

```
 0  Setup, prerequisites, and foundation decision
 1  Application skeleton running locally with Google auth
 2  FIRST DEPLOY — skeleton live on a public URL, auth working in production   ← NON-NEGOTIABLE
 3  Data model + node registry + execution engine core
 4  Visual canvas — build, edit, save, load workflows
 5  Live execution — per-node status and log streaming to the UI
 6  Agent layer — LLM node, agent node with tool-calling, in-app provider/model config
 7  Natural language → workflow generation                                     ← HEADLINE FEATURE
 8  Triggers — webhook + schedule
 9  Integration nodes — Google Sheets, Gmail, Discord, generic HTTP
10  UI/UX pass — design system, motion, responsiveness, accessibility          ← DONE
11  Hardening — demo-path reliability, critical-path tests, error surfaces
12  Demo readiness and final ship
──────────────────── CUT LINE: the project is submittable here ────────────────────
13  STRETCH — voice input + i18n scaffolding
14  STRETCH — additional integrations and templates
```

### Rules for this ladder

- **Phase 2 is non-negotiable and must not slip.** If the deployment is not live and reachable at
  the end of Phase 2, stop and tell the user. Do not proceed to Phase 3
- **Phase 7 is the headline demo feature.** If time pressure forces cuts, cut from Phases 10, then
  9, then 8 — never from 6 or 7
- **Every phase from 2 onward ends with the deployed environment still working**, or the phase is
  not complete
- **Phases 13–14 are optional.** Never start one until Phase 12 is complete and the deployment is
  verified. After any stretch phase, re-run Phase 12's verification
- If a phase turns out too large for one session, split it and record the split here. If several
  are trivially small, merge them

### Changes from the original brief's ladder

| Change | Reason |
|---|---|
| Node registry moved from Phase 8 into **Phase 3** | The agent's tool surface *is* the registry, so Phase 6 depended on Phase 8. The engine needs the dispatch table in Phase 3 anyway. See `ARCHITECTURE.md` → *The node registry is the spine* |
| Original Phase 8 split into **8 (triggers)** and **9 (integrations)** | Webhook + schedule + registry + four integrations cannot land in one session |
| UI/UX → 10, hardening → 11, ship → 12, stretch → 13–14 | Consequence of the split |
| Cut order restated as **10 → 9 → 8** | The brief said "cut 8–9 before 6–7"; these are the same phases after renumbering |

---

## Phase 0 — Setup, prerequisites, and foundation decision

**Objective.** A verified working environment, a decided and recorded foundation, and every cloud
resource the build needs either provisioned or explicitly blocked on a named manual action.

**Dependencies.** None. The docs and the GitHub repo already exist.

**Tasks.**

*Part A — Foundation decision (do first, timebox ~2 h)*
1. Evaluate the candidates in `ARCHITECTURE.md` → *Foundation Decision* against the six criteria
2. **Verify licences from source**, including whether n8n's Sustainable Use License still restricts
   hosting a competing product
3. Choose fork / harvest / build lean. Bias toward whatever reaches a deployed, demoable state
   fastest
4. Record the decision, the alternatives, and the reasoning in `ARCHITECTURE.md`. Remove the
   `NOT YET DECIDED` marker. **The decision becomes binding**

*Part B — Repository and environment*
5. Confirm the repo, remote, and that push and pull both work (test, do not assume)
6. Confirm `.gitignore` covers the chosen stack's build output and dependency directories
7. Verify runtimes and CLIs with actual version checks

*Part C — Cloud and service prerequisites*
8. `gcloud auth login`, create or select the Google Cloud project, confirm billing is enabled
9. Enable the APIs: Cloud Run, Cloud Build, Artifact Registry, Cloud Scheduler
10. Create the Neon project and database; verify with a real query
11. Create the Google OAuth client with **localhost redirect URIs only** (manual action)
12. Obtain a Gemini API key (manual action)
13. Create a Discord webhook URL for the demo target channel (manual action)
14. Record every resource in `PROGRESS.md` → *Cloud Resource Inventory* and `DEPLOYMENT.md`

*Part D — Resource strategy*
15. Before creating anything, check whether it already exists. Record naming conventions, region,
    and dependencies between resources

*Part E — Verification*
16. Prove the environment works: versions print, `gcloud` is authenticated, the database answers a
    query, git pushes

**Primary files/areas.** `ARCHITECTURE.md`, `PROGRESS.md`, `DEPLOYMENT.md`, `.gitignore`, `.env`
(local, never committed).

**Implementation notes.**
- Do not install application dependencies or write application code. That is Phase 1
- `gcloud` is installed but has **no credentialed account** — expect an interactive login
- Cloud Run needs a billing account even for the Always Free tier. The $300 / 90-day credit covers
  everything in this build
- Pick **one region** and record it. Everything else follows it
- Neon gives two connection strings. The pooled one is the app's; the direct one is for migrations

**Validation steps.**
```bash
gcloud auth list                      # a credentialed account
gcloud config get-value project       # the project id
gcloud services list --enabled | grep -E 'run|cloudbuild|scheduler'
git push --dry-run                    # remote reachable
```
Plus one real query against Neon.

**Completion criteria.** Foundation decision recorded and binding. Every CLI authenticated. Project,
APIs, and database exist and respond. Manual actions either done and verified, or recorded in
`PROGRESS.md` with exact steps. `.env.example` matches what the chosen stack actually needs.

**Documentation updates.** `ARCHITECTURE.md` (Foundation Decision, now binding), `PROGRESS.md`
(inventory, manual actions, next action), `DEPLOYMENT.md` (real resource names and region),
`.env.example` if the stack changed what is needed.

**Commit.** `chore: complete phase 00 environment setup and foundation decision`

---

## Phase 1 — Application skeleton running locally with Google auth

**Objective.** The chosen foundation runs locally, and a real Google sign-in works end to end
against the Neon database.

**Dependencies.** Phase 0 complete. OAuth client with localhost redirect. Neon reachable.

**Tasks.**
1. Scaffold or clone-and-strip per the Phase 0 decision
2. Wire the database connection using the pooled URL; migrations use the unpooled URL
3. Auth: Google provider, session persistence, user records in Postgres
4. A minimal authenticated shell: sign in, see a page that only a signed-in user can see, sign out
5. A `Dockerfile` that builds and runs the app — **written now, not in Phase 2**
6. A health endpoint that checks the database
7. `README.md`: real local setup and run instructions

**Primary files/areas.** App scaffold, auth configuration, database client and schema/migrations,
`Dockerfile`, health route, `README.md`.

**Implementation notes.**
- Build the `Dockerfile` here so Phase 2 is a deploy, not a deploy *plus* a containerisation
  debugging session. Cloud Run needs the container to listen on `$PORT`
- Keep the schema to what auth needs. Workflow tables are Phase 3
- Do not build the canvas, the engine, or any styling beyond what is legible

**Validation steps.**
```bash
docker build -t agentforge . && docker run -p 8080:8080 --env-file .env agentforge
curl -fsS localhost:8080/api/health
```
Then sign in with Google in a browser and confirm a user row exists in Neon.

**Completion criteria.** App runs locally and in a local container. Google sign-in completes, a
session persists across reload, and a user row is written. Health endpoint reports the database as
reachable.

**Documentation updates.** `PROGRESS.md`; `ARCHITECTURE.md` if the Phase 0 decision changed the
stack; `CONTRACT.md` → env var contract if variables changed; `README.md`.

**Commit.** `feat: complete phase 01 application skeleton with google auth`

---

## Phase 2 — FIRST DEPLOY: skeleton live on a public URL, auth working in production

**Objective.** A publicly reachable HTTPS URL running the Phase 1 skeleton, with Google sign-in
working **in production**.

**NON-NEGOTIABLE.** If this is not live and reachable at the end of the session, stop and tell the
user. Do not proceed to Phase 3.

**Dependencies.** Phase 1 complete, including a working `Dockerfile`.

**Tasks.**
1. Deploy: `gcloud run deploy agentforge --source . --region <REGION> --allow-unauthenticated`
2. Capture the real service URL
3. **Manual action:** add the production redirect URI to the OAuth client, and the production
   origin to authorised origins
4. Set production environment variables on the service, including `AUTH_URL` / `APP_BASE_URL` set
   to the real URL
5. Run migrations against the production database
6. Set `min-instances=1` for the hackathon window to remove cold starts
7. Verify behaviour, not exit codes
8. Write the real deploy and verify commands into `DEPLOYMENT.md`, with a rollback procedure

**Primary files/areas.** `DEPLOYMENT.md`, Cloud Run service configuration, OAuth client settings,
possibly `Dockerfile` if the build fails on Cloud Build.

**Implementation notes.**
- The redirect URI is the classic failure here: it cannot be registered before the URL exists.
  Whether the deterministic `<service>-<project-number>.<region>.run.app` form allows
  pre-registration is `UNKNOWN — VERIFY` — check it, and record the answer
- `AUTH_URL` must match the deployed origin exactly, or the OAuth callback fails in a way that
  looks like a client-ID problem
- Secrets go in via `--set-env-vars` or Secret Manager; never baked into the image
- If Cloud Build fails, read the build log rather than guessing at the Dockerfile

**Validation steps.**
```bash
gcloud run services describe agentforge --region <REGION> --format='value(status.url)'
curl -fsS <URL>/api/health
gcloud run services logs read agentforge --region <REGION> --limit 50
```
Then, **in a browser from a machine that has never run the project**: load the URL, sign in with
Google, reload to confirm the session persists, and confirm the user row appears in the production
database.

**Completion criteria.** The public URL serves the app. Google sign-in completes in production. A
session survives a reload. The production database has the user row. Logs are readable. Rollback
is documented and understood.

**Documentation updates.** `DEPLOYMENT.md` (real commands, URL, env vars, rollback),
`PROGRESS.md` (*Deployed State* with the URL and last-verified timestamp, inventory),
`README.md` (the live URL).

**Commit.** `feat: complete phase 02 first deploy with production google auth`

---

## Phase 3 — Data model + node registry + execution engine core

**Objective.** Workflows persist, the node registry exists, and the engine executes a stored
workflow end to end with recorded per-node results.

**Dependencies.** Phase 2 deployed and verified.

**Tasks.**
1. Schema: workflows, nodes, edges (embedded JSON or relational — decide and record), runs,
   run_steps, credentials
2. Fill `CONTRACT.md`: workflow/node/edge JSON, run and step record shapes, the node definition
   interface, the execution state machine
3. Build the **node registry**: the node definition interface plus a registration table. Seed it
   with two or three trivial nodes (manual trigger, a transform, a no-op/log node)
4. Build the engine: topological order, sequential execution, a branch node, a bounded loop node,
   output threading, step records, failure handling
5. Workflow CRUD API, owner-scoped
6. A run-trigger API and a run-history read API
7. Critical-path tests: save/load round-trip, sequential run, branch run, bounded loop terminates,
   failure recorded
8. Deploy and verify on the live URL

**Primary files/areas.** Schema and migrations, `CONTRACT.md`, registry module, engine module,
workflow and run API routes, tests.

**Implementation notes.**
- Design the registry for **three** consumers from the start: engine dispatch, canvas palette, and
  agent tool set. Getting this interface right now is what makes Phases 6 and 9 cheap
- The loop cap is a safety property, not just a guard. Make it explicit and non-configurable-to-∞
- Step records should snapshot the node config they ran with — there is no workflow versioning, and
  this is what keeps run history meaningful after an edit
- No UI in this phase. Trigger runs over the API

**Validation steps.** Critical-path tests pass. A workflow created over the API, run over the API,
returns correct per-node step records — first locally, then **against the deployed URL**.

**Completion criteria.** Schema migrated locally and in production. Save/load round-trips
losslessly. The engine runs sequential, branch, and loop workflows and records steps. Failures are
recorded with the error. `CONTRACT.md` is filled for everything this phase introduced. Deployed and
verified.

**Documentation updates.** `CONTRACT.md` (substantial), `ARCHITECTURE.md` (ORM decision, entity
list), `PROGRESS.md`.

**Commit.** `feat: complete phase 03 data model node registry and execution engine`

---

## Phase 4 — Visual canvas: build, edit, save, load workflows

**Objective.** A user can build a workflow visually and it persists correctly.

**Dependencies.** Phase 3 complete. Registry populated enough to render a palette.

**Tasks.**
1. Canvas with nodes and connections (React Flow, per the Phase 0 leaning)
2. Node palette driven by the **registry**, not a hardcoded list
3. Add, connect, move, delete nodes
4. A per-node configuration panel, its form driven by the node definition's schema
5. Save and load against the Phase 3 API; a workflow list page
6. Trigger a run from the canvas, and show the resulting per-node status (static, post-run — live
   streaming is Phase 5)
7. Deploy and verify

**Primary files/areas.** Canvas components, palette, node config panel, workflow list, client data
layer.

**Implementation notes.**
- The palette and the config forms come from the registry. Hardcoding either means every Phase 9
  integration needs UI work, which is exactly what the registry design exists to prevent
- Round-tripping matters more than looking good here. Styling is Phase 10
- Store node positions — a workflow that reloads with a scrambled layout reads as broken

**Validation steps.** Build a workflow in the browser, save, hard-reload, confirm it returns
identically including positions. Run it from the canvas and see per-node outcomes. Repeat on the
deployed URL.

**Completion criteria.** Workflows can be built, edited, saved, and loaded from the browser without
loss. The palette comes from the registry. Runs can be triggered from the canvas. Deployed and
verified.

**Documentation updates.** `CONTRACT.md` if the canvas needed shape changes, `PROGRESS.md`.

**Commit.** `feat: complete phase 04 visual workflow canvas`

---

## Phase 5 — Live execution: per-node status and log streaming to the UI

**Objective.** While a workflow runs, the canvas shows per-node status transitions and log lines as
they happen.

**Dependencies.** Phases 3 and 4 complete.

**Tasks.**
1. Define the SSE event shapes in `CONTRACT.md`
2. Emit events from the engine at each node transition and log line
3. An SSE endpoint per run, owner-scoped — **refined during Phase 5 to per *workflow*, with an
   optional `?runId=` pin.** A webhook-triggered run (Beat 6) is started by somebody else's
   request, so the browser has no run id to open a stream for. See `CONTRACT.md` → *SSE event
   messages*
4. Client subscribes on run start, renders node status on the canvas and a log panel
5. Close the stream when the run ends; fall back to fetching the run record when no stream is open
6. Verify streaming works **through Cloud Run**, not only locally
7. Deploy and verify

**Primary files/areas.** Engine event emission, SSE route, client subscription hook, canvas status
rendering, log panel, `CONTRACT.md`.

**Implementation notes.**
- SSE, not WebSocket — see `ARCHITECTURE.md` → *Realtime transport*
- Cloud Run bills CPU while a stream is open. Open on run start, close on run end, never idle
- Disable response buffering/compression on the SSE route or events arrive in batches, which looks
  exactly like a broken stream
- A mid-run page reload must recover correct state from the run record

**Validation steps.** Run a multi-node workflow on the **deployed URL** and watch statuses and logs
arrive incrementally. Reload mid-run and confirm state is still correct. Confirm the stream closes.

**Completion criteria.** Per-node status and logs stream live on the deployed URL. Streams close on
completion. Reload mid-run recovers. Deployed and verified.

**Documentation updates.** `CONTRACT.md` (SSE events), `ARCHITECTURE.md` if anything changed,
`PROGRESS.md`.

**Commit.** `feat: complete phase 05 live execution streaming`

---

## Phase 6 — Agent layer: LLM node, agent node with tool-calling, provider config

**Objective.** An LLM node and an agent node work inside a workflow, using a user-supplied Gemini
key, with a model chosen in-app.

**Dependencies.** Phase 3 (registry, engine), Phase 5 (so agent steps are visible live).

**Tasks.**
1. Provider adapter interface; implement Gemini
2. Settings UI: paste an API key, choose a model. Key encrypted at rest (AES-256-GCM via
   `ENCRYPTION_KEY`), **never returned to the client in plaintext**
3. LLM node: prompt template with upstream data interpolation, model call, output forward
4. Agent node: tool set derived from the registry, bounded tool-calling loop, each tool call
   surfaced as a visible step
5. Define the agent tool-call schema in `CONTRACT.md`
6. Critical-path tests: adapter contract, tool-call loop terminates at the cap, credential
   encryption round-trip, plaintext never leaves the server
7. Deploy and verify with a real key

**Primary files/areas.** Provider adapter, credential encryption utility, settings UI and routes,
LLM node, agent node, `CONTRACT.md`, tests.

**Implementation notes.**
- Tools come from the registry, filtered to what the workflow may use. **No shell, no filesystem,
  no arbitrary network beyond the explicit HTTP node**
- Cap tool-calling iterations hard. An agent that will not converge fails its step rather than
  burning the user's quota
- Never log key material, not even truncated, not even in a dev branch
- Stub or cache model calls while iterating so development costs nothing

**Validation steps.** On the deployed URL: add a key, pick a model, run a workflow with an LLM node,
then one with an agent node that must choose between tools. Confirm the key is never present in any
API response. Confirm the iteration cap fires on a deliberately non-converging prompt.

**Completion criteria.** LLM and agent nodes execute in deployed workflows. Model selection works
in-app. Keys are encrypted at rest and never returned in plaintext. Tool-calling is bounded and
restricted to the registry. Deployed and verified.

**Documentation updates.** `CONTRACT.md` (tool-call schema, credential shape),
`ARCHITECTURE.md` (adapter as built), `PROGRESS.md`.

**Refinements made while building it, deliberately.**
- Task 4 said "each tool call surfaced as a visible step". Tool calls are surfaced as **streamed log
  lines on the agent's own step**, not as separate `run_step` rows. A step row is keyed by a graph
  `nodeId`; a tool has none, so inventing one would break the canvas's node→step mapping and the
  skipped-node accounting. The visibility is identical — the lines appear while the node is still
  running (D30) — and the full list is also on `output.toolCalls`
- Task 2 said the key is encrypted and never returned. It is also **verified against the provider
  before being stored**, and a model choice is verified with a real call (D34), because the
  catalogue lists models a key cannot serve
- An agent node routes through `output.decision` plus a branch node rather than through its own
  output handles (D37), because handles come from the registry entry and cannot depend on a run

**Commit.** `feat: complete phase 06 agent layer and provider configuration`

---

## Phase 7 — Natural language → workflow generation

**Objective.** A plain-language request produces a real, valid, executable workflow on the canvas.
**This is the headline demo moment.**

**Dependencies.** Phases 3, 4, 6.

**Tasks.**
1. A prompt-entry surface on the workflow list or canvas
2. Generation: request + registry-derived node catalogue → structured workflow JSON
3. **Validate hard** against the `CONTRACT.md` schema before persisting. Reject invalid output with
   a clear message; never save a broken workflow
4. Persist, then render on the canvas with a sensible auto-layout
5. Make the generated workflow immediately runnable and immediately editable
6. Critical-path tests: the demo prompt produces a valid workflow; malformed model output is
   rejected; generated workflows round-trip
7. Deploy and verify

**Primary files/areas.** Generation route, prompt assembly, schema validation, auto-layout, prompt
UI, tests.

**Implementation notes.**
- Feed the model the registry's node catalogue so it can only reference nodes that exist
- Use structured output / schema-constrained generation rather than parsing prose
- Retry once on invalid output, then fail with a readable message. Do not attempt repair loops
- Auto-layout does not need to be clever, but it must not overlap nodes — an overlapping graph
  reads as broken on stage
- **This is the phase least eligible for cuts.** Protect its time

**Validation steps.** On the deployed URL, run the exact `DEMO.md` prompt several times and confirm
a valid, runnable workflow every time. Confirm an intentionally impossible request fails cleanly.
Confirm a generated workflow can be edited and re-saved.

**Completion criteria.** The demo prompt reliably produces a valid, runnable, editable workflow on
the deployed URL. Invalid output is rejected rather than persisted. Deployed and verified.

**Documentation updates.** `CONTRACT.md` (generation request/response), `DEMO.md` (the exact prompt
that works), `PROGRESS.md`.

**Commit.** `feat: complete phase 07 natural language workflow generation`

---

## Phase 8 — Triggers: webhook + schedule

**Objective.** Workflows start from an external HTTP call and on a schedule.

**Dependencies.** Phase 3. Phase 5 for visibility. Cloud Scheduler enabled in Phase 0.

**Tasks.**
1. Webhook trigger node with a per-trigger **unguessable** URL
2. Webhook receiver: validate the payload, create a run, pass the body as trigger output
3. Schedule trigger node with a cron expression
4. `POST /api/cron/tick`, guarded by `CRON_SECRET`, firing all due schedules
5. Create the Cloud Scheduler job pointing at it
6. Surface both in the UI: show the webhook URL with a copy button; show the next scheduled time
7. Deploy and verify both against the live URL

**Primary files/areas.** Trigger node definitions, webhook route, cron tick route, Cloud Scheduler
job, trigger UI, `DEPLOYMENT.md`.

**Implementation notes.**
- Unguessable means a cryptographically random token in the path. Not a sequential id, not a hash
  of the workflow id
- The cron tick endpoint must reject anything without the shared secret, and must be idempotent
  enough that a duplicate tick does not double-fire a schedule
- Cloud Scheduler's free tier covers this. Record the job in the inventory

**Validation steps.**
```bash
curl -X POST <URL>/api/webhook/<token> -d '{"...":"..."}'   # a run appears
curl -X POST <URL>/api/cron/tick                            # rejected without the secret
```
Then confirm a scheduled workflow fires on its own from Cloud Scheduler.

**Completion criteria.** A webhook call creates and runs a workflow on the deployed URL with the
payload available to nodes. A scheduled workflow fires from Cloud Scheduler. The tick endpoint
rejects unauthenticated calls. Deployed and verified.

**Documentation updates.** `CONTRACT.md` (trigger shapes, webhook payload), `DEPLOYMENT.md` (the
Scheduler job, `CRON_SECRET`), `PROGRESS.md` (inventory).

**Commit.** `feat: complete phase 08 webhook and schedule triggers`

---

## Phase 9 — Integration nodes: Google Sheets, Gmail, Discord, generic HTTP

**Objective.** Four genuinely working integrations, each a registry entry, therefore each also an
agent tool.

**Dependencies.** Phases 3, 6. Credentials from Phase 0 / Phase 6.

**Tasks.**
1. **Generic HTTP node** — method, URL, headers, body, response into workflow data. Build first: it
   is the simplest and it de-risks the node-authoring path
2. **Discord node** — post to a stored webhook URL. Credential encrypted at rest
3. **Google Sheets node** — append a row. Incremental OAuth scope on top of sign-in
4. **Gmail node** — send a message. Same OAuth path as Sheets
5. Credential management UI for each, write-only
6. Confirm each new node appears automatically in the palette *and* the agent tool set
7. Critical-path test per node against the real service
8. Deploy and verify each one live

**Primary files/areas.** Four node definitions, Google API client and incremental scope flow,
credential UI, tests.

**Implementation notes.**
- Incremental authorisation for Sheets and Gmail: request the extra scopes when the user first uses
  the node, not at sign-in. Asking for Gmail send access at sign-in is alarming and hurts the demo
- Store Google refresh tokens encrypted, and handle expiry — an expired token mid-demo is the
  likeliest live failure
- If a node cannot be finished, cut **Gmail** first: Sheets plus Discord already satisfies "the
  result lands in an external service"
- The HTTP node is not an agent escape hatch: it is a registry entry with a schema, and the agent
  reaches it the same way it reaches any other node

**Validation steps.** On the deployed URL, run a workflow that posts to Discord, then one that
appends to a Sheet, then one that sends mail, then one that calls an arbitrary API. Confirm all four
appear as agent tools and that an agent node can choose one unprompted.

**Completion criteria.** Four integrations work from the deployed app against real services.
Credentials are encrypted and never returned in plaintext. All four are available to the agent.
Deployed and verified.

**Documentation updates.** `CONTRACT.md` (node definitions, credential shapes), `DEMO.md` (confirm
the spine's services work), `PROGRESS.md`.

**Commit.** `feat: complete phase 09 sheets gmail discord and http integrations`

---

## Phase 10 — UI/UX pass: design system, motion, responsiveness, accessibility

**Objective.** The product looks and feels built on purpose — modern, playful, animated, not an
enterprise CRUD app.

**Dependencies.** Phases 4–9 functionally complete. **First candidate for cuts under time pressure.**

**Tasks.**
1. A design system: colour, type scale, spacing, elevation, dark mode
2. Real motion design: node appearance during generation, execution pulse travelling the graph,
   status transitions, page transitions. Honour `prefers-reduced-motion`
3. Responsiveness from ~375 px up. The canvas may degrade gracefully; nothing may break
4. Accessibility: keyboard-operable primary flows, visible focus, labelled controls, adequate
   contrast
5. Empty states, loading states, and readable error states
6. Deploy and verify on a real phone and a real desktop

**Primary files/areas.** Global styles and tokens, shared components, canvas visuals, motion
utilities, layout.

**Implementation notes.**
- The generation moment and the execution animation are what a judge remembers. Spend the motion
  budget there, not on incidental hover effects
- Do not restructure working components for aesthetics. Style what exists
- Animate transforms and opacity. Animating layout on a canvas of many nodes will stutter

**Validation steps.** Walk the whole `DEMO.md` path on the deployed URL at phone and desktop widths.
Keyboard-only pass of sign-in → generate → run. Confirm nothing regressed functionally.

**Completion criteria.** Consistent design system applied. Motion present on the demo path and
reduced-motion respected. Usable at 375 px. Primary flows keyboard-operable. No functional
regression. Deployed and verified.

**Documentation updates.** `PROGRESS.md`, `ARCHITECTURE.md` if component structure changed.

**Commit.** `feat: complete phase 10 design system motion and responsive pass`

**Status: COMPLETE, 2026-09-26** — `agentforge-00017-5k2`. All six tasks landed and were verified on
the deployed URL in a browser at 1440 px and 375 px. Two refinements worth carrying:

- Task 1's "dark mode" was resolved as **one dark theme, declared** (D48), not a second light theme.
  The real work it implied was `color-scheme: dark` for native controls
- Task 5's loading states were **partly reverted**: a route `loading.tsx` over a page whose first act
  is an auth redirect turns the 307 into a 200 (D51). Empty, error and 404 states all shipped; the
  navigation skeletons did not

---

## Phase 11 — Hardening: demo-path reliability, critical-path tests, error surfaces

**Objective.** The `DEMO.md` path does not fail. Failures elsewhere are legible instead of silent.

**Dependencies.** Phases 1–10.

**Tasks.**
1. Walk the demo path repeatedly on the deployed URL and fix every failure and rough edge found
2. Make every critical-path test pass reliably: save/load, engine, tool-calling, generation
3. Timeouts and a single retry where an external call can hang the demo
4. Replace every silent failure on the demo path with a visible, readable error
5. Handle the credential-expiry case for Google integrations
6. Confirm cold start and Neon wake-up do not break the first interaction
7. A smoke script that exercises the deployed app end to end
8. Deploy and verify

**Primary files/areas.** Engine error handling, node error surfaces, client error states, tests,
smoke script.

**Implementation notes.**
- Harden **the demo path**, not every code path. That distinction is the whole point of this phase
- Fix narrowly. Do not rewrite working code to chase a bug
- Ten consecutive clean demo-path runs is the bar. Anything flaky at this stage will be flaky on
  stage

**Validation steps.** Ten consecutive clean runs of the full demo path on the deployed URL. All
critical-path tests green. Smoke script passes against production.

**Completion criteria.** The demo path runs repeatedly without failure. Critical-path tests pass.
Demo-path errors are visible and readable. Smoke script exists and passes. Deployed and verified.

**Documentation updates.** `PROGRESS.md` (*Known Issues*, honestly), `DEMO.md` (fallbacks),
`README.md`.

**Commit.** `fix: complete phase 11 demo path hardening and critical path tests`

---

## Phase 12 — Demo readiness and final ship

**Objective.** The project is submittable. The demo is rehearsed, the deployment is verified, and
the repository stands on its own.

**Dependencies.** Phases 0–11.

**Tasks.**
1. Seed the demo account: example workflows, the Discord channel, the target Sheet
2. Rehearse the full demo end to end on the deployed URL, timed to 3 minutes
3. Complete `DEMO.md`: beat-by-beat script, setup state, pre-staged commands, fallbacks, the
   pre-demo checklist, and what must not be touched
4. Final `README.md`: live URL, what it does, how to run it, how to deploy it
5. Confirm `min-instances=1` and warm-up behaviour
6. Full deployment verification per `DEPLOYMENT.md`
7. Reconcile every doc against reality; resolve or honestly record every `UNKNOWN — VERIFY`
8. Confirm no secrets anywhere in the repository or its history
9. Record the submission material needed by the hackathon (category still `UNKNOWN — VERIFY`)

**Primary files/areas.** `DEMO.md`, `README.md`, `PROGRESS.md`, all docs, seed data.

**Implementation notes.**
- The demo must not depend on anything fragile being typed live. Pre-stage every command
- Have a fallback for every external service, including a recording of a successful run
- This phase is not a feature phase. Resist adding anything

**Validation steps.** A timed 3-minute rehearsal on the deployed URL, twice, from a machine that has
never run the project. Full `DEPLOYMENT.md` verification. `git log` and a secret scan.

**Completion criteria.** Demo rehearsed inside 3 minutes and reliable. `DEMO.md` complete with
fallbacks. Deployment verified. Docs match reality. No secrets. **The project is submittable.**

**Documentation updates.** All of them, reconciled.

**Commit.** `docs: complete phase 12 demo readiness and final ship`

---

## Phase 13 — STRETCH: voice input + i18n scaffolding

**Do not start until Phase 12 is complete and the deployment is verified.**

**Objective.** Speak a workflow request instead of typing it; the UI is translation-ready with two
languages.

**Dependencies.** Phase 12 complete and verified.

**Tasks.** Voice input in one language feeding the Phase 7 prompt box, with a visible recording
state and a typed fallback. i18n scaffolding, strings extracted, two languages, a language switcher.

**Implementation notes.** Browser speech recognition where available, degrading to typing —
never block the demo path on microphone permission. Extract strings only on the demo path; a
half-translated settings screen is worse than an untranslated one. Voice **output** / TTS is
Post-Hackathon and stays out.

**Validation steps.** Voice input produces a workflow on the deployed URL. Switching language
changes the demo-path UI. **Re-run Phase 12's verification.**

**Completion criteria.** Both work on the deployed URL, nothing regressed, Phase 12 verification
re-run and passing.

**Documentation updates.** `PRD.md` (S2, S3 delivered), `PROGRESS.md`, `DEMO.md` if the script
changes.

**Commit.** `feat: complete phase 13 voice input and i18n scaffolding`

---

## Phase 14 — STRETCH: additional integrations and templates

**Do not start until Phase 12 is complete and the deployment is verified.**

**Objective.** A broader node catalogue and a template gallery that removes the blank canvas.

**Dependencies.** Phase 12 complete and verified. Phase 13 optional.

**Tasks.** Additional registry nodes chosen for demo value per hour. A template gallery of
pre-built workflows that clone into the user's account. A second LLM provider if a key appears
(`PRD.md` S1). Retry/timeout configuration surfaced in the UI (S6).

**Implementation notes.** Each new node is additive by design — if one costs more than about an
hour, drop it. Templates should be the workflows already used in the demo, so they are known-good.

**Validation steps.** Each new node runs on the deployed URL. A template clones and runs.
**Re-run Phase 12's verification.**

**Completion criteria.** New nodes work and appear as agent tools. Templates clone and run. Phase 12
verification re-run and passing.

**Documentation updates.** `PRD.md`, `CONTRACT.md`, `PROGRESS.md`.

**Commit.** `feat: complete phase 14 additional integrations and template gallery`
