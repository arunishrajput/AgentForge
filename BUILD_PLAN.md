# BUILD_PLAN.md — AgentForge

The phase roadmap. **One session, one phase.** Do not start a later phase while a required earlier
phase is incomplete. Current position is in `PROGRESS.md`, not here.

---

## The ladder

**Chapter 1 — the hackathon MVP. Phases 0–12, all COMPLETE and shipped.**

```
 0  Setup, prerequisites, and foundation decision                             ✅
 1  Application skeleton running locally with Google auth                     ✅
 2  FIRST DEPLOY — skeleton live on a public URL                              ✅
 3  Data model + node registry + execution engine core                        ✅
 4  Visual canvas — build, edit, save, load workflows                         ✅
 5  Live execution — per-node status and log streaming                        ✅
 6  Agent layer — LLM node, agent node with tool-calling                      ✅
 7  Natural language → workflow generation                                    ✅
 8  Triggers — webhook + schedule                                             ✅
 9  Integration nodes — Sheets, Gmail, Discord, HTTP                          ✅
10  UI/UX pass — design system, motion, responsiveness                        ✅
11  Hardening — demo-path reliability, critical-path tests                    ✅
12  Demo readiness and final ship                                             ✅
```

**Chapter 2 — the real product. Phases 13–25. THIS IS THE CURRENT WORK.**

```
13  Reset, verification, and professional foundations   ✅
14  Toybox — the design system                          ✅
15  UI rebuild I — the shell                            ✅
16  UI rebuild II — the canvas                          ✅
17  Durable execution — a real queue, resumable runs    ✅
18  Workflow versioning and diffing                     ✅
19A Workspaces — the data model and scoping             ✅
19B Membership — invitations and the switcher           ✅
20  Roles, permissions and sharing                      ✅
21  Credential vault and rotation                       ✅
22  Observability and run analytics                     ✅
23A Transform, control flow, templates, node docs       ✅
23B SaaS integrations — Slack, Notion, GitHub, Airtable ✅ (2 of 4 real-service proven)
23C The Postgres node                                   ✅
23D The second LLM provider                             ✅
24  Documentation and open-source readiness            ← START HERE
25  Launch polish
```

### Rules for this ladder

- **Phases 0–12 are history.** Do not reopen one. If Chapter 1 left a defect, it is an item inside a
  Chapter 2 phase, not a reason to re-run an old phase
- **Work them in order.** The dependencies are real: the design system precedes the UI rebuild, the
  execution rewrite precedes the data-model migration, and documentation comes after the thing it
  documents exists
- **Every phase ends with the deployed environment still working.** Unchanged from Chapter 1, and
  still the rule
- **The cost ceiling is still zero.** A phase that needs paid infrastructure stops and escalates —
  it does not quietly provision. See *The zero-cost problem*
- **Phases 14–16 and 19 are large.** Splitting one across sessions is expected, not a failure —
  record the split here when it happens
- **There is no cut line any more.** Chapter 1 had a demo to reach; Chapter 2 has no deadline, so
  quality is the constraint that binds instead of time

### Changes from the original brief's ladder

| Change | Reason |
|---|---|
| Node registry moved from Phase 8 into **Phase 3** | The agent's tool surface *is* the registry, so Phase 6 depended on Phase 8. The engine needs the dispatch table in Phase 3 anyway. See `ARCHITECTURE.md` → *The node registry is the spine* |
| Original Phase 8 split into **8 (triggers)** and **9 (integrations)** | Webhook + schedule + registry + four integrations cannot land in one session |
| UI/UX → 10, hardening → 11, ship → 12 | Consequence of the split. The old "stretch 13–14" slots were replaced wholesale by Chapter 2 |
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
- The redirect URI is the classic failure here: it cannot be registered before the URL exists —
  **except that it can.** `UNKNOWN — VERIFY` **resolved at Phase 2**: the deterministic
  `<service>-<project-number>.<region>.run.app` form *does* allow pre-registration, and the
  predicted URL matched the deployed one exactly
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

**Status: COMPLETE, 2026-09-26.** The Sheets and Gmail runtime, left open when the phase shipped,
was closed after Phase 10 once M8 landed: a real appended row (`Sheet1!A2:D2`, with `{{ }}` resolved
into cells) and a real sent mail (id `1a0dcf7f7df25cc8`), both through the deployed engine. Two
defects only reachable past Google's consent screen were found and fixed in the process — see D53 and
the `gcloud services enable gmail.googleapis.com sheets.googleapis.com` note in `DEPLOYMENT.md`.

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

# Chapter 2 — beyond the hackathon

**Phases 0–12 shipped a hackathon MVP. Phases 13–25 turn it into a real product.** The constraints
that shaped Chapter 1 — a demo script as the scope contract, "unbreakable" redefined as *the demo
path never fails*, no test suite, features cut for time — **are all lifted**. What replaces them is
in `CLAUDE.md` → *Operating model*.

**What did not change:** the cost ceiling is still **zero**, and everything below is designed to
respect it. That is a real constraint, not a leftover — see *The zero-cost problem* below.

---

## The zero-cost problem, stated honestly

Four things were restored into scope — teams, versioning, observability, a credential vault — and
the budget stayed at zero. Those pull against each other. **The resolution, per area:**

| Need | The paid answer | The zero-cost answer here | Risk |
|---|---|---|---|
| Durable background execution | Redis + BullMQ + a worker | **Cloud Tasks** → the existing authenticated HTTP endpoint. Generous free tier | Task payload and duration limits |
| Metrics and error tracking | Datadog / Sentry paid | **Cloud Logging** structured logs + log-based metrics, and run analytics computed from the `run`/`run_step` tables already written | Log volume caps; query cost on Neon |
| Credential encryption | Cloud KMS managed keys | **Envelope encryption** with the data key in Secret Manager. Cloud KMS is ~$0.06/key/month — *cheap, but not zero* | Rotation is hand-rolled |
| Multi-user load | Bigger Postgres | Neon free tier, with every new query measured against the budget | **This is the binding one** |

**Neon free tier is 100 CU-hours/month and autosuspend cannot be disabled.** Chapter 1 already had
to set the cron tick to `*/15` because anything touching the database more often than ~every 6
minutes pins it awake at 0.25 CU ≈ 180 CU-hours/month — over the allowance. Teams and analytics
both add query load to that same budget.

> **RESOLVED in Phase 13, 2026-09-26.** Every figure above was checked against the vendors' own
> pricing pages and this project's live consumption. The measured table, with the re-check commands,
> is in `DEPLOYMENT.md` → *Free-tier headroom*. In short:
>
> | Service | Free | Measured use | Verdict |
> |---|---|---|---|
> | Neon compute | 100 CU-hours/month, per project | ~61 committed to the `*/15` cron tick | **the binding one — ~39 spare** |
> | Cloud Tasks | 1,000,000 ops/month, per billing account | 0 | fine: ≈330k runs/month |
> | Cloud Logging | 50 GiB/month, per project | **6.34 MB / 30 days = 0.0118%** | fine: ~8,000× headroom |
> | Secret Manager | 6 versions · 10,000 access ops · **3 rotation notifications**/month | 0 | fits, but rotation is tight |
>
> **Two things changed the plan.** Phase 17 must enqueue a run *id*, not a payload — Cloud Tasks
> bills per 32 KB chunk. Phase 21 must not subscribe to Secret Manager rotation notifications —
> only 3/month are free, then $0.05 each, which would be this project's first non-zero line.
>
> **The last `UNKNOWN — VERIFY` — Neon CU-hours actually *consumed* — was READ on 2026-10-01:**
> **0.91**, a few hours into a fresh billing period, projecting to ~60 of 100 for a full month with
> the cron running. `PROGRESS.md` → M9 and `DEPLOYMENT.md` → *Free-tier headroom* carry the
> arithmetic. It is a **console-only** read on this plan: the consumption API is Scale-and-above and
> the legacy fields return `0`, which Phase 22 established — the earlier note here that `neonctl` was
> unauthenticated is **SUPERSEDED**, it is authenticated and still cannot see the number. Phases 19
> and 22 were in the end designed against the *rule* — never add a new reason to wake an idle
> database — rather than the balance, and each measured its own cost directly.

---

## Phase 13 — Reset, verification, and professional foundations

**Objective.** Close out the hackathon posture, prove the zero-cost headroom is real, fix the two
known defects carried out of Chapter 1, and put a genuine test-and-CI floor under everything that
follows.

**Dependencies.** None. This is the entry point for Chapter 2.

**Tasks.**
1. **Fix the agent fallback latency.** `PROGRESS.md` → *Known Issues* records two consecutive runs
   at ~95 s, of which `decide_urgency` was 91.9 s, because `gemini-3.5-flash-lite` was unavailable
   and the adapter retried twice before falling down the chain. Make the fallback cheap: shorter
   per-model budget, a circuit breaker that remembers a model is failing, and model health surfaced
   rather than buried in a step log.
2. **Verify the free-tier headroom** and write the real numbers into `DEPLOYMENT.md`: Neon CU-hours
   consumed to date and the ceiling; Cloud Tasks free-tier limits; Cloud Logging ingestion
   allowance; Secret Manager free tier. Replace every `UNKNOWN — VERIFY` above with a measured
   figure or an escalation.
3. **A real test suite floor.** Chapter 1 ran 297 tests on Node's built-in runner with no coverage
   measurement. Keep the runner; add coverage reporting, and raise critical-path coverage on the
   engine, the registry, the generator and the agent loop.
4. **CI on GitHub Actions** — typecheck, lint, test, build on every push and PR. Branch protection
   on `main`. This is the first phase where CI exists at all.
5. **Rotate the working model default** to whichever Gemini model the Phase 13 probe finds
   healthy, and record how to re-probe.

**Primary files.** `src/lib/providers/*`, `scripts/*`, `.github/workflows/ci.yml`, `DEPLOYMENT.md`,
`PROGRESS.md`, `package.json`.

**Implementation notes.** Do not start the design system before this lands — a red CI pipeline
during a full UI rewrite is how a project stops being recoverable. The circuit breaker belongs in
the provider adapter, not in the agent node, so every caller benefits.

**Validation steps.** CI green on a pull request. An agent run completes in the single-digit
seconds when the primary model is healthy, and degrades in **under 15 s**, not 92 s, when it is not.
Coverage report generated and committed to the run output.

**Completion criteria.** CI passes on `main`. The latency issue is closed in `PROGRESS.md` with a
measured before/after. Every free-tier figure in this file is a real number or an open escalation.

**Documentation updates.** `PROGRESS.md`, `DEPLOYMENT.md`, `ARCHITECTURE.md` (provider adapter).

**Commit.** `feat: complete phase 13 reset, verification and CI foundations`

---

## Phase 14 — Toybox: the design system

**Objective.** A complete, documented, playful design language — the thing every later UI phase is
built from. **This is the phase that changes what AgentForge looks like.**

**Dependencies.** Phase 13 (CI must be green before a rewrite of this size).

**The direction, decided and binding.** *Bright and playful, light-first.* Saturated colour, thick
dark outlines, chunky offset shadows, fat rounded corners, springy motion. The reference is a
well-made toy: tactile, friendly, obviously clickable. **Not** a dark IDE, which is what every
competing tool looks like.

**Tasks.**
1. **Tokens.** Replace the Chapter 1 dark palette in `src/app/globals.css` with the Toybox scale:
   a cream page (`#FFF6E5` family), near-black ink for outlines and text, and a saturated accent
   family per node category. Keep the existing `@theme` / `@utility` structure — it works, and no
   component library is being introduced.
2. **Primitives.** Button, input, select, card, badge, dialog, toast, tooltip, tab, menu — each
   with the outline-plus-hard-shadow treatment and a squish-on-press interaction.
3. **Motion.** A spring vocabulary: press, hover-lift, enter, exit, success, failure. Everything
   respects `prefers-reduced-motion`, which Chapter 1 already handles in two places and both must
   keep working.
4. **Illustration and character.** An empty-state illustration set and a simple mascot used in
   empty states, errors, and the agent "thinking" indicator.
5. **A living gallery** at `/design` rendering every token, primitive and motion state on one page.
   This is the reference for later phases and doubles as a screenshot source for the README.
6. **`DESIGN.md`** — the written spec: what the language is, when to use each primitive, the
   accessibility rules that constrain it.

**Primary files.** `src/app/globals.css`, `src/components/ui/*` (new), `src/app/design/*` (new),
`DESIGN.md` (new), `public/illustrations/*` (new).

**Implementation notes.** **Playful must not cost legibility.** Thick outlines and high-contrast
ink actually help contrast ratios — but saturated accent-on-cream is where AA fails, so check every
pairing. A cartoon look earns goodwill on the landing page and gets in the way in a settings form;
the system needs a quiet register as well as a loud one, and `DESIGN.md` must say which is which.
Do not ship a mascot that appears during error states in a way that reads as flippant when
someone's workflow just failed.

**Validation steps.** `/design` renders every primitive on the deployed URL. Contrast checked on
every token pair used for text. Reduced-motion verified. No regression in the existing app, which
will look broken-but-functional until Phases 15–16 land — that is expected and must be recorded.

**Completion criteria.** The gallery is complete and deployed, `DESIGN.md` is written, and every
primitive is keyboard-operable with a visible focus state.

**Documentation updates.** `DESIGN.md` (new), `ARCHITECTURE.md`, `PROGRESS.md`, `CONTRACT.md` if
any token name becomes a shared contract.

**Commit.** `feat: complete phase 14 toybox design system`

---

## Phase 15 — UI rebuild I: the shell

**Objective.** Everything except the canvas, rebuilt in Toybox: landing, sign-in, workflow list,
settings, navigation, empty and error states.

**Dependencies.** Phase 14.

**Tasks.** Rebuild the landing page as a real product page — what it is, what it does, a visible
demonstration, a call to action. Rebuild the workflow list with search, filter, sort and a genuinely
good empty state. Rebuild settings: provider config, integrations, account. Rebuild `error.tsx` and
`not-found.tsx` in the new language. Add a global toast system and a command palette.

**Primary files.** `src/app/page.tsx`, `src/app/workflows/page.tsx`, `src/app/settings/*`,
`src/components/*`.

**Implementation notes.** The landing page is the single most important screen for an open-source
showpiece — it is what a GitHub visitor sees first. Budget real time for it. Preserve every
accessibility property Chapter 1's Phase 10 established; do not regress keyboard operability while
chasing the look. The two client components that format dates must keep formatting in UTC with a
fixed locale or React throws hydration error #418.

**Validation steps.** Every route renders correctly on the deployed URL at 1920 px, 1024 px and
375 px. Keyboard-only walk of sign-in → list → settings. Zero console errors.

**Completion criteria.** No screen outside the canvas still uses a Chapter 1 style. Deployed and
verified in a real browser.

**Documentation updates.** `PROGRESS.md`, `DESIGN.md` if the system gained anything.

**Commit.** `feat: complete phase 15 shell rebuild in toybox`

---

## Phase 16 — UI rebuild II: the canvas

**Objective.** The screen the product exists for, rebuilt: node cards, edges, palette, inspector
and the live run panel.

**Dependencies.** Phase 15.

**Tasks.** Node cards as chunky outlined objects with a category colour, an icon and a legible
status. Edges with real weight and animated flow while running. A palette that is browsable and
searchable rather than a long list. An inspector that makes configuration feel like filling in a
form on a nice object. A run panel where agent reasoning is pleasant to read. Node status as
character: idle, thinking, succeeded, failed, skipped — each visually distinct at a glance and
without relying on colour alone.

**Primary files.** `src/components/canvas/*`, `src/lib/canvas/*`, `src/app/workflows/[id]/*`.

**Implementation notes.** **This is where playful earns or loses the product.** A node graph is
dense information; decoration that costs scanability is a net loss. Chapter 1 measured the
constraint precisely: two 280 px side panels leave an 880 px canvas at 1440 px, which forced a
0.39 zoom and an 88 px node card. Bigger, chunkier cards make that *worse* — so this phase must
solve the layout, probably with collapsible panels, not just restyle the cards. `prefers-reduced-motion`
is handled in `src/lib/canvas/motion.ts` for React Flow's JavaScript `fitView` and must stay.

**Validation steps.** Generate a workflow, edit a node, run it, watch statuses stream — in a real
browser on the deployed URL, at 1920 px and 1440 px. A six-node graph is legible without zooming
manually.

**Completion criteria.** The full demo path works end to end in the new canvas with no regression,
verified in a browser, not by an API suite. Chapter 1's lesson stands: **the API suites cannot see
the browser.**

**Documentation updates.** `PROGRESS.md`, `DESIGN.md`, screenshots refreshed.

**Commit.** `feat: complete phase 16 canvas rebuild in toybox`

---

## Phase 17 — Durable execution

**Objective.** Runs survive a deploy, a crash and a cold start. The in-process executor stops being
the only path.

**Dependencies.** Phase 13 (the free-tier verification gates the design).

**Tasks.** Move execution behind **Cloud Tasks** dispatching to an authenticated endpoint. Make
every run resumable from its last completed step. Replace `reapStaleRuns` with real lease-and-heartbeat
semantics. Surface retry and timeout configuration per node in the UI (`PRD.md` S6). Add a run
cancellation path.

**Primary files.** `src/lib/engine/*`, `src/app/api/runs/*`, `DEPLOYMENT.md`.

**Implementation notes.** Chapter 1 accepted "in-flight runs die on redeploy — no queue" as a
carried risk. This phase closes it. Keep the in-process path for short runs; Cloud Tasks is for
durability, not for every execution. The engine deadline is 120 s against Cloud Run's 3600 s, and
`STREAM_MAX_MS` (150 s) must be raised alongside it if that changes.

**Validation steps.** Start a long run, deploy mid-run, confirm it completes. Kill an instance
mid-run and confirm recovery. Cancel a run and confirm it stops.

**Completion criteria.** A run survives a redeploy on the deployed environment. Verified, not
asserted.

> **DONE, 2026-09-27 — and one validation step turned out to rest on a false premise.**
>
> "Deploy mid-run, confirm it completes" **passes trivially**: Cloud Run *drains*. A new revision
> taking 100% of traffic does not kill the old one's in-flight requests, and — tested directly —
> neither does **deleting the serving revision**, where the run finished on a revision that no
> longer existed. Chapter 1's carried risk "in-flight runs die on redeploy" was substantially
> wrong.
>
> "Kill an instance mid-run" therefore **cannot be done from outside** on Cloud Run. The resume
> path is verified instead by delivering the retry the queue would deliver: a run is put into the
> state a dead worker leaves and `POST /api/runs/dispatch` is called exactly as Cloud Tasks would.
> It resumed, `attempt` went to 2, and the already-completed steps kept their original timestamps.
>
> **The phase is still worth what it cost**, for the reasons the premise obscured: durability
> covers a crash, an OOM kill and an exhausted retry — the cases that *do* lose a run — and it is
> what let the cron tick stop executing its runs inline (`MAX_FIRES_PER_TICK` 3 → 25). It also
> bought resumability, cancellation and per-node retry, which were never about redeploys.
>
> Seven deployed checks in `scripts/verify-durable.mjs`; the measured figures are in
> `PROGRESS.md` → *Last Updated*.

**Documentation updates.** `ARCHITECTURE.md` (the no-queue decision is superseded — record why),
`CONTRACT.md`, `DEPLOYMENT.md`, `PROGRESS.md`.

**Commit.** `feat: complete phase 17 durable execution`

---

## Phase 18 — Workflow versioning and diffing

**Objective.** Every save is a version. Any version can be restored. Two versions can be compared
visually.

**Dependencies.** Phase 16 (the diff is a canvas feature).

**Tasks.** A `workflow_version` table and a migration. Auto-version on save with an optional label.
A history panel. Restore-to-version. A visual diff on the canvas: nodes added, removed, changed,
moved. A run records which version it executed.

**Primary files.** `drizzle/*`, `src/lib/workflows/*`, `src/components/canvas/diff/*`.

**Implementation notes.** Storage is the constraint on Neon's free tier — store a compact graph
snapshot, not a full row copy per keystroke. Debounce versioning to meaningful saves. Recording the
version on a run is what makes "this run behaved differently" diagnosable, so do not skip it.

**Validation steps.** Edit a workflow repeatedly, inspect history, restore an old version, diff two
versions, confirm a run references the right version.

**Completion criteria.** All of the above on the deployed URL, with storage growth measured against
the free-tier budget.

**Documentation updates.** `CONTRACT.md` (new table and API), `PRD.md`, `ARCHITECTURE.md`, `PROGRESS.md`.

**Commit.** `feat: complete phase 18 workflow versioning and diffing`

> **DONE, 2026-09-27.** Every save is a version, restore moves the history *forward* rather than
> rewinding it, and two versions compare on the canvas in a read-only diff mode. Four decisions
> worth carrying: the version number is a counter on `workflow.version` bumped by the save's own
> UPDATE, because `neon-http` has no transactions and `max(number) + 1` is a real race (D83); a
> save that changes nothing writes no snapshot, which is the debounce this phase asked for (D84);
> a run records `workflowVersion` **and a redelivered durable run executes that snapshot**, which
> closed a hole Phase 17 had opened (D86); and retention is 50 unlabelled versions per workflow,
> sized against measured numbers — 737 bytes per stored graph, 8.55 MiB of a 0.5 GB allowance.
>
> **Two defects were found only by driving a browser** and both have tests that fail without the
> fix: a removed node stacked exactly on top of an added one and hid it (D87), and the minimap
> rendered empty for the whole time a diff was on screen (D88). 185 deployed API checks had passed
> over both.
>
> 32 deployed checks in `scripts/verify-api.mjs`; storage figures in `DEPLOYMENT.md` →
> *Free-tier headroom*.

---

## Phase 19 — Workspaces and membership — **SPLIT into 19A and 19B**

**The split, decided 2026-09-27 at the start of the phase**, under the licence this phase always
carried: *"This is the largest and riskiest phase in Chapter 2 — expect to split it; record the
split here if so."*

**Why here.** The phase holds two things with different risk profiles and different ways of going
wrong. One is a **schema migration against a live, metered database holding real data**, plus a
scoping change that touches every query in the product — it is verified by row counts, an
isolation matrix and a rehearsed rollback. The other is **new product surface** — invitations, an
accept flow, a switcher — verified by driving it. Shipping both in one deploy means that if the
deployed system misbehaves afterwards, there is no way to tell which half did it, and the
expand/contract migration below *wants* a deploy of its own between its two steps.

**What did not change:** the objective, the completion criteria, or the scope. Everything Phase 19
listed is still built, in the same order, across two sessions.

---

## Phase 19A — Workspaces: the data model and scoping

**Objective.** Every resource in the product belongs to a **workspace** rather than directly to a
person, and no query can read across one. AgentForge is still single-user in practice — every user
has exactly one workspace and is its only member — but the *shape* is multi-tenant and proven so.

**Dependencies.** Phase 18.

**Tasks.**

- `workspace` and `workspace_member` tables. `workspace_member.role` is written now and
  **enforced in Phase 20** — see the handoff note below.
- A `workspaceId` column on `workflow`, `run`, `workflow_version` and `credential`, **added
  alongside `ownerId`, never replacing it.** `ownerId` keeps its own meaning — *who created this*,
  *who triggered this run* — and stays the reason a run survives as a record of what happened.
- An **expand/contract migration in two steps, with a hand-written rollback**: `0005` adds the
  tables and the columns **nullable** and backfills a personal workspace per user, so the previous
  revision keeps serving throughout; `0006` makes the columns `NOT NULL` and drops the superseded
  credential index, once the new revision is the only one running.
- **Rehearse the rollback on a copy before running either against the deployed database.**
- One request-scoped resolution of the active workspace, and a `WorkspaceScope` that every store
  function takes **instead of** an owner id — a distinct type, so a call site that was missed
  fails the typecheck rather than silently reading across a tenant.
- A personal workspace is created at first sign-in, and by the scope resolver if it is ever
  missing.
- The header names the active workspace.

**Primary files.** `drizzle/*`, `src/db/schema.ts`, `src/lib/workspace/*` (new), `src/lib/api.ts`,
`src/auth.ts`, every store module, every API route, `src/components/shell/app-header.tsx`.

**Implementation notes.**

- **The Neon budget is not the constraint it looks like.** Neon's free tier meters *compute time
  awake*, not statements, so a second query inside a request that already made one costs nothing —
  what costs is a **new reason to wake the database**. Workspaces add queries to requests that
  already exist and add no poller, no tick and no background job, so they are close to free against
  the ~39 CU-hour balance. Phase 22's analytics is the one that must be designed against the
  number, not this.
- **Credentials become workspace-scoped, and that is a widening of a security surface.** It is
  necessary — a workflow shared to a teammate that cannot reach its Google credential fails at the
  first integration node, at runtime, silently — but it means *connecting Google to a workspace
  lets every member of that workspace act as you on those scopes*. Say so where a user connects
  one, and record it in `CONTRACT.md`.
- **The unique index on `credential` moves from `(ownerId, kind, label)` to
  `(workspaceId, kind, label)`.** Both exist between `0005` and `0006` — the old one must be gone
  before any user can hold a second workspace, or storing the same kind in two of them is refused.

**Validation steps.** Row counts before and after the migration match, and every pre-existing row
has a workspace. Rollback rehearsed on a copy and the copy verified identical to where it started.
A second workspace with a second user sees none of the first's workflows, runs, versions or
credentials — asserted **at the API**, over HTTP, against the deployed system. The demo path still
runs end to end. A real browser, 0 console errors.

**Completion criteria.** Both migrations applied to the deployed database with **no data loss,
verified by row counts before and after**; the isolation matrix passes against the deployed URL;
CI green.

**Documentation updates.** `CONTRACT.md`, `ARCHITECTURE.md`, `PRD.md`, `DEPLOYMENT.md`,
`PROGRESS.md`.

**Commit.** `feat: complete phase 19a workspaces data model and scoping`

---

## Phase 19B — Membership: invitations and the switcher

**Objective.** More than one person in a workspace, and more than one workspace per person.

**Dependencies.** Phase 19A.

**Tasks.** Create and rename a workspace. Invitations by email — issue, accept, revoke, expire — on
a single-use unguessable token. A members list. A workspace switcher in the header that sets the
active workspace. The empty and single-workspace states designed, not defaulted.

**Primary files.** `drizzle/*`, `src/lib/workspace/*`, `src/app/api/workspaces/*` (new),
`src/components/shell/*`, `src/app/settings/*`.

**Implementation notes.**

- **An invitation token is a new unauthenticated surface.** Treat it exactly like the webhook
  trigger token: CSPRNG, single use, expiring, and an accept endpoint that leaks nothing about a
  workspace to a holder of a wrong token.
- **The handoff Phase 19A leaves, and it is load-bearing.** 19A writes `workspace_member.role` and
  **does not enforce it** — which is inert there, because every member it creates is the `owner` of
  their own personal workspace. **The moment this phase can create a member who is not an owner,
  that stops being true.** Either enforce the role here, or merge this phase with Phase 20. Do not
  ship an invitation that hands somebody a `viewer` badge and full write access.
- An invitation is addressed to an email, and the invitee may not have an account yet. Accept after
  sign-in, matching on the verified email from the identity provider — never on a claim in the URL.

**Validation steps.** A second real account is invited, accepts, and sees exactly the shared
workspace and nothing else. A revoked invitation cannot be accepted. An expired one cannot. The
switcher changes what the workflow list returns.

**Completion criteria.** Two accounts, one shared workspace, proven in a browser — and the second
account proven unable to reach the first's personal workspace through a crafted request.

**Documentation updates.** `CONTRACT.md`, `ARCHITECTURE.md`, `PRD.md`, `SECURITY.md` if it exists
by then, `PROGRESS.md`.

**Commit.** `feat: complete phase 19b workspace membership and invitations`

---

## Phase 20 — Roles, permissions and sharing

> **DONE, 2026-09-30.** Roles became administrable, a workflow became privatable, and a workflow
> became publishable read-only to anybody holding a URL. Seven decisions worth carrying: what a
> share link may publish is an **allowlist defaulting to nothing**, so a node added in Phase 23
> cannot widen an unauthenticated surface by existing (D98); `visibility` and `shareToken` are
> **independent columns, not one three-valued ladder**, because they answer different questions and
> "private with a live link" is a coherent thing to want (D99); an **admin can see a private
> workflow**, because it runs with the workspace's credentials and somebody has to account for that
> (D100); visibility filters rows **in the `where`** and is never checked after the read — and the
> two queries that do not pass through `getWorkflow` are the whole of the risk (D101); the public
> canvas is a **separate component**, because a boolean is not what should stand between an
> anonymous visitor and `api.updateWorkflow` (D102); minting a share link is **idempotent** while
> an invitation rotates, because a share URL gets pasted into a README (D103); and a region is made
> read-only by one **`<fieldset disabled>`** rather than a prop threaded through four components
> (D104).
>
> **Two defects came from the browser and nothing else**, while 394 deployed checks, 661 unit tests
> and a green typecheck all passed: a viewer's panel still offered a trigger input and a "Queue a
> run" button under a paragraph beginning *"Press **Run**"*, and the share page's title truncated
> to two words at 375 px. The lesson generalises — **a flag that makes one control honest does not
> make the region around it honest.**

**Objective.** Owner, admin, editor and viewer mean something, and a workflow can be shared.

**Dependencies.** Phase 19.

**Tasks.** A role model and a single server-side authorisation layer every route uses. Per-workflow
sharing inside a workspace. A read-only public share link for a workflow graph — no credentials, no
run data. UI that hides what the viewer cannot do and an API that refuses it regardless.

**Primary files.** `src/lib/auth/permissions.ts` (new), every API route, `src/components/*`.

**Implementation notes.** Authorisation is checked **server-side, once, in one place**. A hidden
button is not a permission. The public share link is a new unauthenticated surface — treat it with
the same suspicion as the webhook trigger token, and make sure it cannot leak a credential id, a
run payload or a workspace member list.

**Validation steps.** A matrix test: every role against every action, asserted at the API, not the
UI. Confirm a share link exposes the graph and nothing else.

**Completion criteria.** The matrix passes. A viewer cannot mutate anything through a crafted
request.

**Documentation updates.** `CONTRACT.md`, `ARCHITECTURE.md`, `PRD.md`, `PROGRESS.md`.

**Commit.** `feat: complete phase 20 roles, permissions and sharing`

---

## Phase 21 — Credential vault and rotation

**Objective.** Close the sharpest gap Chapter 1 left: there is no credential rotation, and replacing
a stored secret means recreating whatever holds it.

**Dependencies.** Phase 20 (rotation is permission-sensitive).

**Tasks.** Envelope encryption — per-credential data keys wrapped by a root key held in Secret
Manager, so the root can rotate without re-encrypting everything. Rotate a stored credential in
place. Rotate a workflow's webhook token without recreating the workflow. An audit log of credential
use: which run, which node, when. A re-key path for `ENCRYPTION_KEY`, which Chapter 1 correctly
flagged as "never rotate this, it destroys all stored credentials".

**Primary files.** `src/lib/crypto/*`, `src/lib/integrations/*`, `drizzle/*`.

**Implementation notes.** Managed Cloud KMS is the textbook answer and costs ~$0.06/key/month —
**not zero**. Secret Manager's free tier covers the root key, so that is the route unless Phase 13
found budget. Never log a secret value, never return one to a client, and make the audit log record
*use*, not content.

**Validation steps.** Rotate a Discord webhook credential and confirm workflows keep working.
Rotate a workflow webhook token and confirm the old one is refused. Re-key and confirm every stored
credential still decrypts.

**Completion criteria.** All three rotations work on the deployed environment, and the old secret is
provably refused afterwards.

**Documentation updates.** `ARCHITECTURE.md`, `CONTRACT.md`, `DEPLOYMENT.md`, `PROGRESS.md`,
`SECURITY.md` (new).

**Commit.** `feat: complete phase 21 credential vault and rotation`

---

## Phase 22 — Observability and run analytics

**Objective.** You can answer "what is this system doing, and what broke" without opening a database
client.

**Dependencies.** Phase 17.

**Tasks.** Structured JSON logging with a request and run correlation id throughout. Log-based
metrics in Cloud Logging for run volume, failure rate, node latency and model fallback rate — the
last one is what would have caught Chapter 1's 92 s regression. An in-app analytics view per
workspace: runs over time, failure breakdown, slowest nodes, model usage. Error grouping. A real
`/api/health` that reports dependency status rather than a bare `ok`.

**Primary files.** `src/lib/logging/*` (new), `src/lib/analytics/*` (new), `src/app/analytics/*` (new).

**Implementation notes.** Analytics are computed from the `run` and `run_step` rows the engine
already writes — no new event pipeline, and no third-party SDK. **Watch the Neon budget**: an
analytics page that polls is exactly the pattern that pins the database awake. Aggregate on write or
cache aggressively; do not poll.

**Validation steps.** Induce a failure and find it from the logs alone. Confirm the model-fallback
metric fires when a model degrades. Measure the analytics page's database cost.

**Completion criteria.** Metrics visible, analytics correct against a hand-checked sample, and the
CU-hour cost of the feature measured and recorded.

**Documentation updates.** `ARCHITECTURE.md`, `DEPLOYMENT.md`, `PROGRESS.md`, `OPERATIONS.md` (new).

**Commit.** `feat: complete phase 22 observability and run analytics`

---

## Phase 23 — Node catalogue and templates — **SPLIT into 23A, 23B, 23C and 23D**

**The split, decided 2026-09-30 at the start of the phase.**

**Why here.** The phase's completion bar is *"proven against real services, not mocks"*, and that
line divides its own task list cleanly in two. Richer transform and control-flow nodes, per-node
documentation and a template gallery reach **no service at all** — they are provable end to end the
day they are written, against the deployed app, with nothing asked of anybody. Slack, Notion,
GitHub, Airtable, a database node and a second LLM provider each need **an account and a credential
that only the user can create**, and until those exist not one of them can meet the bar.

Shipping them as one phase means the half that is finished sits inside a phase marked `BLOCKED`
behind six manual actions — which is precisely the "a phase that is half done is not done" failure
`CLAUDE.md` warns about, arrived at by sequencing rather than by sloppiness. Split, 23A completes
and 23B opens with **one** manual-action block listing every credential at once, so the user does
the account-creation work in a single sitting rather than six.

**What did not change:** the objective, the completion criteria, or the scope. Every node Phase 23
listed is still built, to the same bar, across two sessions.

---

## Phase 23A — Transform, control flow, templates, and node documentation

**Objective.** The registry grows the vocabulary a workflow needs to do real data work without
reaching any external service, the inspector explains every node in its own words, and the blank
canvas is gone.

**Dependencies.** Phase 16.

**Tasks.** Add the transform and control-flow nodes the catalogue is missing — multi-way switch,
filter, map, sort, aggregate, unique, JSON parse/stringify, text operations, date operations, field
pick. Add a `docs` field to the node definition and surface it in the inspector. Build a template
gallery that clones a known-good workflow into the workspace, with the templates executed by tests
so they cannot rot.

**Primary files.** `src/lib/nodes/core/*`, `src/lib/nodes/transform/*` (new),
`src/lib/templates/*` (new), `src/app/(app)/templates/*` (new), `src/components/canvas/inspector.tsx`.

**Implementation notes.** **The registry contract is the whole point** — every node added here
automatically widens the agent's tool surface and the generator's vocabulary. Each node must declare
an `outputShape` (Chapter 1's D38) and `agentCallable` must stay opt-in. **No expression language
and no code node**: a config field is exactly where arbitrary code execution would sneak back in, so
every new node uses a fixed, enumerated operator set the way `core.branch` already does. A template
is a graph literal in the repository, not a database row — it costs no table and cannot drift from
the registry, because a test builds and validates every one of them.

**Validation steps.** Every new node executes on the deployed app inside a real run. Every
agent-callable node is reachable as a tool and appears in generation. A template clones from the
gallery into a workspace and runs to `succeeded`. The inspector shows a node's documentation in a
real browser.

**Completion criteria.** All of the above, on the deployed URL.

**Documentation updates.** `CONTRACT.md`, `PRD.md`, `PROGRESS.md`.

**Commit.** `feat: complete phase 23a transform nodes templates and node docs`

---

## Phase 23B/23C — the second split, decided 2026-10-01

**Phase 23B as written held six deliverables, and four of them share one mechanism while
two do not.** Slack, Notion, GitHub and Airtable are each "a bearer secret and an HTTPS
JSON API" — the pattern `lib/integrations/shared.ts` was factored for in Phase 9, whose own
comment says a fifth integration should be "a node file and nothing else". Adding four of
them is additive work on a settled seam.

The other two are not additive. **The database node** reaches a wire protocol rather than
an HTTPS endpoint, which raises a dependency question (`ARCHITECTURE.md` must be consulted
before answering it) and needs its own SSRF argument, because `guard.ts` is written for
URLs. **The second provider** changes an existing subsystem rather than extending one:
`LLM_CREDENTIAL_KIND` is the literal `"llm.google"`, so a second provider touches the
credential kind scheme, `resolveProvider`, the model picker, the observed-health table and
the vault. Both are a *new mechanism behind an existing seam*; the four integrations are
*more of an existing mechanism*.

**So the seam is mechanism, and it is the same test that split Phase 23 itself.** 23A/23B
divided on "does it reach a real service"; 23B/23C divides on "does it change a subsystem
or extend one". Shipping all six together means the four that are additive wait on the two
that are structural, and the session ends with six services half-proven instead of four
proven.

**What did not change:** the objective, the completion criteria, or the scope. Every node
Phase 23 listed is still built, to the same bar. This is the third split in the ladder
(19, 23, 23B) and the pattern is worth naming rather than repeating quietly: **the
Chapter 2 ladder was written one phase per subject, and a subject is not a session.**

---

## Phase 23B — SaaS integrations: Slack, Notion, GitHub, Airtable

**Objective.** The four integrations a real user expects after Discord and Google, added on
a mechanism that makes the fifth one a table row rather than a copied route.

**Dependencies.** Phase 23A, and **the credentials in this phase's opening manual-action
block** — a Slack incoming webhook, a Notion internal integration token with one page and
one database shared with it, a GitHub fine-grained PAT, an Airtable PAT with a base.

**Tasks.** Slack, Notion, GitHub and Airtable nodes. A **token-credential registry** so
each one's kind, secret shape, provider verification, rotation rule and settings copy are
one entry in one table rather than four files apiece. One dynamic API route for connecting,
reading and revoking them. Templates that use them.

**Primary files.** `src/lib/integrations/{slack,notion,github,airtable,tokens}.ts`,
`src/lib/nodes/integration/*`, `src/app/api/integrations/[service]/route.ts`,
`src/components/settings/integrations-form.tsx`, `src/lib/templates/catalogue.ts`.

**Implementation notes.** Every new credential kind needs an entry in `ROTATION_RULES`
(Phase 21) and every new node type an entry in `PUBLISHABLE` (Phase 20) — the registry's
second and third obligations, both asserted by tests in both directions. **Generate both
from the token registry rather than hand-writing them**, so the obligations cannot be
forgotten instead of merely failing a test. A node that calls a model must put the model id
on its output as `model` and nothing else may use that field name (Phase 22's fourth
obligation) — none of these four is a model call, so none of them may carry the field. Read
each service's **current** API docs rather than recalling them: Slack cannot override a
webhook's channel or username, and Notion's `2025-09-03` version replaced a `database_id`
parent with a `data_source_id` that has to be resolved first.

**Validation steps.** Every new node executes against its real service from the deployed
app, and the object it created is asserted — a message in a channel, a Notion page, a
GitHub issue, an Airtable record. Every new node is reachable as an agent tool and appears
in generation. Each credential rotates on the deployed app. The four settings cards driven
in a real browser.

**Completion criteria.** All of the above, proven against real services, not mocks.

**Outcome — amended deliberately on 2026-10-01, and the amendment is the honest part.**
Slack and GitHub met that bar in full. **Notion and Airtable did not and now never will**,
because proving them needs accounts the user has decided not to create. Three options were
weighed: keep the phase `BLOCKED` forever (useless — nobody would ever unblock it), delete
the two integrations (a material scope cut, destroying built, tested, deployed and
documented work that a *stranger* using Notion would want), or **narrow the claim instead
of the code**. The third was taken. `README.md` now states which integrations have been run
against a real server and which have only been run against a stub, and points a Notion or
Airtable user at that gap first.

**`verify-integrations.mjs` was deliberately not weakened.** It still reports `2 skipped`
and still prints *skipped is not passed*. Making a tally look green by lowering the bar is
the one thing this project's verification rule exists to prevent, and the two services
genuinely were not verified.

**Commit.** `feat: complete phase 23b slack notion github and airtable integrations`

---

## Phase 23C/23D — the third split, decided 2026-10-01

**The same test that split 23 and then split 23B, applied once more, and it is the one
about credentials rather than the one about mechanism.**

23C as written held two deliverables. **The Postgres node needs no account anybody has to
create**: this project already owns a Postgres server — Neon — and a read-only role inside
it is four statements of SQL, so the phase's own bar, *"proven against real services, not
mocks"*, is reachable in the session that writes the code. **The second provider is not**:
it needs an API key from a provider the user must sign up to, and no amount of engineering
produces one.

Shipping them together would have put a finished, fully proven node inside a phase marked
`BLOCKED` behind a manual action — which is exactly the failure the 23A/23B split was
created to avoid, and the reasoning there is quoted rather than re-derived: *"a phase that
is half done is not done"*, arrived at by sequencing rather than by sloppiness. 23B is
already waiting on M10. Stacking a second blocked phase behind it would have left two
phases open, both complete in code, neither complete by its own definition.

**What did not change:** the objective, the completion criteria, or the scope. Both things
Phase 23 listed are still built, to the same bar.

**What this split cost, stated honestly:** the credential-kind migration that 23D carries
(`LLM_CREDENTIAL_KIND` is still the literal `"llm.google"`) would have been cheaper to do
in the same sitting as 23C's credential work, because both touch `tokens.ts` and
`rotation.ts`. That is a real cost and it was accepted, because the alternative was a node
that works, is deployed, and cannot be called finished.

---

## Phase 23C — The Postgres node ✅ COMPLETE

**Objective.** A read-only database node.

**Dependencies.** Phase 23A. (Not 23B: the token-credential registry it extends was built
in 23B and is already deployed, and nothing here needs 23B's four services to be
*connected*.)

**Tasks.** A Postgres node, read-only by construction. A connection-string credential in the
Phase 23B token registry. A template that uses it.

**Primary files.** `src/lib/integrations/postgres.ts`, `src/lib/nodes/integration/postgres.ts`,
`src/lib/integrations/tokens.ts`, `src/lib/templates/catalogue.ts`,
`scripts/setup-demo-db.mjs`, `scripts/verify-postgres.mjs`.

**Implementation notes.** The node reaches an arbitrary host and therefore needs `guard.ts`'s
address classification, which is written for URLs and had to be reached for a connection
string instead — the classification was reused exactly, the *parsing* is separate, because
`parseTarget` refuses credentials in a URL and a connection string exists to carry them. It
is **read-only by construction**: no SQL field exists, and Phase 23A's rule applies
unchanged — **no expression language, ever** — so the query is built from enumerated parts.
**The new runtime dependency was taken as an `ARCHITECTURE.md` decision** (A21): `postgres`
rather than `pg`, one lockfile entry and zero transitive dependencies.

**Validation steps.** The node reads a real table from the deployed app and is proved unable
to write. ✅

**Completion criteria.** All of the above, proven against a real server, not mocks. ✅
`scripts/verify-postgres.mjs` — **65 passed, 0 failed, 0 skipped** against
`agentforge-00057-8jx`.

**Documentation updates.** `ARCHITECTURE.md`, `CONTRACT.md`, `PRD.md`, `SECURITY.md`,
`DEPLOYMENT.md`, `PROGRESS.md`, per-node docs. ✅

**Commit.** `feat: complete phase 23c postgres node`

---

## Phase 23D — The second LLM provider ✅ COMPLETE

**Objective.** A second LLM provider behind the existing adapter, so "which provider" is a
stored fact rather than a literal.

**Dependencies.** Phase 23C, and **a second provider's API key** — Groq's free tier is the
intended one (<https://console.groq.com/keys>). Flagged to the user alongside M10 so both
sittings can be one.

**Tasks.** A second provider behind `LanguageModel` (`PRD.md` S1, C12), including the
credential-kind change that makes "which provider" a stored fact. Migrate the existing
`llm.google` rows. The model picker, the observed-health table and the vault all follow.

**Primary files.** `src/lib/ai/*`, `src/lib/credentials/*`,
`src/components/settings/provider-form.tsx`.

**Implementation notes.** **`LLM_CREDENTIAL_KIND` is the literal `"llm.google"`**, so
migrating existing rows is part of the work, not a follow-up — a workspace with a working
Gemini key must not lose it. The second provider must not quietly become the default. The
circuit breaker and `FALLBACK_MODELS` are per-provider concepts today and will have to
become per-provider facts rather than one global chain.

**Validation steps.** The second provider answers a real call **and a real tool call** — the
second is the one that matters, because Phase 13 found a model that answered prose in 1.4 s
and hung on tool calls. Existing `llm.google` credentials keep working across the change,
proved on the deployed database rather than asserted.

**Completion criteria.** All of the above, proven against real services, not mocks. ✅
`scripts/verify-providers.mjs` — **55 passed, 0 failed, 0 skipped** against
`agentforge-00058-q2z`, including a real completion, a real agent tool call, and the
existing `llm.google` row proved byte-for-byte unchanged on the deployed database.

**What the plan got wrong, recorded rather than quietly corrected.** This phase was
written expecting a credential migration, on the reading that `LLM_CREDENTIAL_KIND` was a
literal standing where a provider belonged. **The kind string was already
provider-qualified** — `llm.google`, not `llm.key` — so Google's rows keep their meaning,
Groq's are `llm.groq`, and **no credential row needed rewriting**. What genuinely had no
home was *which provider a workspace uses*: migration `0010`, one nullable column, no
backfill.

The split's stated cost was that 23D's credential-kind migration "would have been cheaper
to do in the same sitting as 23C's credential work". **That cost did not materialise**,
because the migration it referred to did not exist. The split was still right for its own
reason — 23C was provable without the user and 23D was not.

**What the plan under-estimated instead**, and this is the useful half: *"a second provider
is a new file implementing this interface; nothing above it changes"* was true above the
interface and wrong below it. The retry, fallback, budget and breaker machinery was inside
`gemini.ts`, and had to be lifted into `chain.ts` so both providers share one copy of
Phase 13's wedged-model fix. **An untested abstraction was approximately right**, and only
building the second implementation could show which half.

**Documentation updates.** `ARCHITECTURE.md` (A7 superseded, A26 added), `CONTRACT.md`,
`PRD.md` (the two-providers deviation CLOSED, C12 done), `SECURITY.md`, `OPERATIONS.md`,
`DEPLOYMENT.md`, `README.md`, `PROGRESS.md`. ✅

**Commit.** `feat: complete phase 23d second llm provider`

---

## Phase 24 — Documentation and open-source readiness ✅ COMPLETE

**Objective.** The repository reads like a serious open-source project to someone who arrives
knowing nothing.

**Dependencies.** Phases 13–23 (document what exists, not what is planned).

**Tasks.** Rewrite `README.md` as a real front page: what it is, a screenshot or GIF that sells it
immediately, quickstart, features, architecture diagram, badges. A `docs/` site covering
self-hosting, node reference, agent behaviour, API reference and architecture. `CONTRIBUTING.md`,
`CODE_OF_CONDUCT.md`, `SECURITY.md`, issue and PR templates. **Pick and apply a licence** — still
open per `PROGRESS.md`; MIT is the obvious default. Architecture Decision Records for the decisions
already made: the Foundation Decision, dropping the AI SDK, the registry spine, no-queue and its
reversal in Phase 17. A self-hosting guide that someone can actually follow.

**Primary files.** `README.md`, `docs/*` (new), `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`,
`.github/*`, `adr/*` (new).

**Implementation notes.** The ADRs largely exist already as prose in `ARCHITECTURE.md` and
`PROGRESS.md` — this is mostly extraction into a standard form, and the reasoning is already
written. The README screenshot is the highest-leverage asset in the repository; take it after Phase
16, not before.

**Validation steps.** A person who has never seen the project can run it locally from the README
alone. Every documented command is executed and confirmed to work.

**Completion criteria.** Docs build and deploy, licence applied, every README claim verified.

**Commit.** `docs: complete phase 24 documentation and open-source readiness`

### As built, 2026-10-01

**Licence: MIT**, chosen by the user — the oldest open decision in `PROGRESS.md`.

**"Docs build and deploy" was answered without a static-site generator**, deliberately. Markdown
in `docs/` renders on GitHub and deploys on every push, at zero cost and zero dependencies — which
is the same reasoning that keeps this project off a test framework and an LLM SDK. What *is* built
is the part that would otherwise rot: **`docs/nodes.md` is generated from the node registry**, and
`npm run docs:check` is a fifth CI gate that fails on a stale node reference, on an undocumented
or invented API route, and on any documentation link or heading anchor that does not resolve.
Each guard was proved to fail before being relied on.

**Validation found two defects, both in the new documentation**: the self-hosting guide showed an
all-`ok` local health response when a correct local install reports `degraded`, and
`verify-api.mjs` fails 18 checks against a local dev server for two environment reasons — stated
in `PROGRESS.md` → *Current Phase*. The deployed suite is ALL CHECKS PASSED throughout.

**No deploy.** `src/` is untouched, so `agentforge-00058-q2z` remains current and was re-verified
rather than replaced.

**Not done:** a screenshot of the authenticated canvas. The session-cookie step is blocked by a
safety classifier and the user chose to ship without it. The three screenshots that ship are real
pages of the deployed app. Carry into Phase 25.

---

## Phase 25 — Launch polish ✅ COMPLETE

**Objective.** The last pass. Onboarding, performance, accessibility, and the rough edges that
survive every rewrite.

**Dependencies.** Phase 24.

**Tasks.** A first-run onboarding flow that gets a new user to their first successful run. Every
empty state designed rather than defaulted. A full accessibility audit against WCAG AA — Chapter 1
explicitly did *not* do one. Performance: Core Web Vitals on the deployed URL, bundle analysis,
query optimisation. An error-recovery pass: every failure the user can hit has a clear message and a
way forward. Final security review of every unauthenticated surface.

**Primary files.** Across the app.

**Implementation notes.** "Unbreakable" was redefined in Chapter 1 as *the demo path never fails*.
**That redefinition is now retired** — this phase is where broad error handling actually gets built,
because there is no demo to protect any more, only users.

**Validation steps.** Full WCAG AA audit with findings fixed. Lighthouse on the deployed URL.
A new account taken from sign-up to first successful run without help.

**Completion criteria.** Audit clean or every exception recorded with a reason. Onboarding verified
with a genuinely fresh account.

**Documentation updates.** All, reconciled. `PROGRESS.md` marks Chapter 2 complete.

**Commit.** `feat: complete phase 25 launch polish`

### As built, 2026-10-01

**Onboarding is a guide on the page, not a wizard.** Three steps read live from the database —
a provider key, a workflow, a successful run — on `/workflows`, above the content.
A modal has to be dismissed before the product can be looked at, and a wizard that tracks its own
position lies to somebody who pasted a key in another tab. Migration `0011` adds
`workspace.onboardedAt`: completion is a **milestone, not a current fact**, so a workspace that
onboarded and later deleted every workflow is not handed the beginner's checklist again — and the
guide costs **zero statements** once it is finished with, because the column rides along on the
membership row the page already loads.

**The steps are presented in order and deliberately not gated in order**, which was proved rather
than asserted: in a browser, on a brand-new workspace with no key at all, a template was cloned and
run successfully, taking the guide to *2 of 3* with step 1 still open. A key is required for
generation, not for the product.

**The real find was the dead end at the end of the primary call to action.** A new account pressing
*Generate workflow* got a clear 400 naming Settings — and was then left to go and find Settings.
`details.recovery` (`CONTRACT.md`) now carries an in-app path and a label that the prompt box
renders as a button. The guard that reads it **drops anything that is not an in-app path**, and its
test caught a hole in the first version: `//evil.example` begins with `/` and is a different origin.

**The audits are enumerations, which is what makes them worth having.**

- `scripts/verify-a11y.mjs` — every page, WCAG 2.2 AA structure. **92 checks.** Its first run
  reported 6 failures; 4 were the *script's* blind spot (a control wrapped in its own `<label>` is
  correctly labelled, and `Labelled` does exactly that), so the reader learned to track label spans.
  An audit that cries wolf gets turned off. The 2 that survived were real: `/templates` skipped
  `h1 → h3`, and the canvas carried **two elements with `id="dialog-title"`**, so the version-history
  dialog was announced to a screen reader with the *share* dialog's name — live since Phase 14,
  invisible to every suite. Fixed with `useId`, and `primitives.test.ts` now fails on a literal `id`
  or a literal ARIA reference anywhere in `components/ui`.
- `scripts/verify-security.mjs` — **67 checks**, every route file under `src/app/api` called with no
  session. It found that `SECURITY.md`'s "complete list" of unauthenticated surfaces was missing
  **three**: `/api/health` and both Google OAuth legs. All three were already deliberate and already
  correct; none was written down. That is the failure mode of a hand-kept security inventory, and it
  is why the list is now derived and checked in both directions.

**One field was removed from the public internet.** `/api/health` published the GCP `project`
alongside `location` and `queue`. The last two earn their place — both are copied environment
variables, so both can point at the wrong queue while `configured` is true. `project` comes from the
metadata server and *cannot* be wrong, which is the documented reason `TASKS_PROJECT` is unset — so
it had no diagnostic value and was pure reconnaissance.

**Accessibility behaviour was driven in a browser, because the script cannot see it.** Focus order
through the guide is correct, every control shows a real focus ring (`boxShadow` measured `none` →
2 px on focus), and the step rows were **20 px tall against WCAG 2.5.8's 24 px minimum**. The
spacing exception technically rescued them; leaning on an exception for something one class fixes is
the wrong trade, so `min-h-6`, re-measured at 320 / 375 / 1440 px.

**`global-error.tsx` was the last unhandled failure.** `error.tsx` renders *inside* the root layout
and so cannot catch the root layout failing — that case fell through to Next's white
"Application error" page. It is the least likely failure in the product and the worst looking.

**Performance was measured, not guessed.** Cold-cache CWV on the deployed service: LCP 576–1112 ms
and **CLS 0** on every page, well inside Google's thresholds. The zero is the self-hosted-font
decision being paid back. Numbers in `DEPLOYMENT.md` → *Verification*.

**Not done, and stated rather than implied:** the validation step asks for "a new account taken from
sign-up to first successful run". What was driven was a **brand-new workspace** — no key, no
workflow, no runs, which is exactly the state the guide reads — on an existing Google account. Google
sign-up itself was last proved with two real accounts in Phase 19B. A second Google account was not
created for this.

---

## After Phase 25

Chapter 2 deliberately stops short of: a plugin marketplace with external publishing, mobile apps,
real-time multiplayer editing, billing, and a self-hosted installer beyond a documented Docker path.
When Phase 25 is done, re-plan rather than extending this ladder by reflex — and bring numbers.
