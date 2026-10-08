# API reference

AgentForge's HTTP API is the same one its own interface uses. There is no second,
"public" API and no separate versioning scheme: the canvas, the run view and the
settings pages are clients of exactly these routes, which is why the list below is
complete rather than curated.

Coverage of this page is **checked in CI**. `npm run docs:check` fails if a route exists
under `src/app/api` and is not named here, or if this page names one that does not exist.

---

## How a request is authorised

Three mechanisms, and nothing else.

| Mechanism | Used by | What it establishes |
|---|---|---|
| **Session** | Everything a person does | Who you are — an Auth.js session cookie backed by a database row |
| **Workspace role** | Everything a person does | What you may do *here* — `viewer` → `editor` → `admin` → `owner` |
| **Bearer token in the path** | The five link- and machine-reached routes | One specific resource, and nothing else |

A session alone is never enough. Every route a person reaches resolves the caller's
**active workspace** and the role they hold in it, through one funnel — `requireScope()`
in [`src/lib/api.ts`](../src/lib/api.ts). Its default argument is `viewer`, so a new
mutating route that forgets to ask for a role fails closed rather than open.

Two rules cannot be expressed as a single ranking and live beside it as pure functions:
`roleChangeRefusal` decides who may move whom to what role, and `visibleWorkflows`
filters which rows a member may see rather than refusing outright.

**Scoping is server-side and total.** A resource in another workspace answers `404`, not
`403` — a `403` there would confirm the id exists. `403` is reserved for the honest case:
the resource is in *your* workspace, you can already see it, and your role does not carry
the action.

## Response envelope

Success is always `{ "data": … }`. Failure is always `{ "error": { "code", "message" } }`,
optionally with `details`.

```jsonc
// 200
{ "data": { "id": "wf_...", "name": "Triage inbound leads" } }

// 403
{ "error": { "code": "forbidden", "message": "Your role does not allow this." } }
```

| Code | HTTP | Means |
|---|---|---|
| `unauthenticated` | 401 | No session, or the session expired |
| `forbidden` | 403 | Signed in, a member here, and your role does not carry this action |
| `not_found` | 404 | No such resource — **or** one that exists in a workspace you are not in |
| `invalid_request` | 400 | The body failed its schema, or a parameter is malformed |
| `invalid_graph` | 422 | The workflow is syntactically fine and not a runnable graph |
| `conflict` | 409 | The resource changed underneath you, or the action is not legal in this state |
| `internal` | 500 | A fault. The message is generic; the detail is in the logs under the request's trace |

An unexpected throw never reaches the client as a stack. It is logged with the request's
trace id and answered as `internal` — see [`../OPERATIONS.md`](../OPERATIONS.md) for how
to find it again.

### `details.recovery` — a way forward

Some failures cannot be fixed on the page that raised them. Those carry a `recovery` in
`details`: an **in-app** path and a label, which the interface renders as a button beside
the message.

```jsonc
// 400 — generating a workflow with no model provider key stored
{
  "error": {
    "code": "invalid_request",
    "message": "No model provider key configured. Add one in Settings — it is encrypted before it is stored.",
    "details": {
      "recovery": { "href": "/settings?tab=provider", "label": "Add a provider key" }
    }
  }
}
```

It is optional and most errors do not carry one — a message about the field you are looking
at does not need a link to the field you are looking at. `href` is always a path beginning
`/`; a client should discard anything else rather than navigate to it.

---

## Workflows

| Method | Route | Role | What it does |
|---|---|---|---|
| `GET` | `/api/workflows` | viewer | Lists the workflows visible to you in the active workspace |
| `POST` | `/api/workflows` | editor | Creates one. Mints its webhook token |
| `GET` | `/api/workflows/[id]` | viewer | One workflow with its graph |
| `PATCH` | `/api/workflows/[id]` | editor | Renames it, replaces the graph, or changes its visibility. **Every save writes a version** |
| `DELETE` | `/api/workflows/[id]` | editor | Deletes it, its versions and its runs |
| `POST` | `/api/workflows/generate` | editor | **Natural language → a workflow.** Returns a validated graph, or `unsupported` with a reason |

The graph shape, and the rules a graph must satisfy to be runnable, are in
[`../CONTRACT.md`](../CONTRACT.md) → *Workflow graph*.

`GET /api/workflows` adds two fields to each workflow that a single read does not carry:
`tags` — `[{ id, name }]`, the tags it wears — and `starred`, whether **you** have starred it.
Both arrive on the same query as the list (Phase 32).

## The library — tags, stars, duplicate, export and import

Phase 32. How a workspace files its workflows, and how a workflow leaves and enters the product as
a file. **Tagging and starring are not edits**: neither writes a version or moves `updatedAt`.

| Method | Route | Role | What it does |
|---|---|---|---|
| `GET` | `/api/tags` | viewer | The workspace's tags, `[{ id, name }]`, by name |
| `POST` | `/api/tags` | editor | `{ name }` → 201, a tag. Names are 1–32 characters, trimmed, and unique in the workspace **ignoring case** — a clash is `409`. At most 100 tags a workspace |
| `PATCH` | `/api/tags/[id]` | editor | `{ name }` — renames it on every workflow wearing it, because it is one row |
| `DELETE` | `/api/tags/[id]` | editor | Deletes it and takes it off every workflow |
| `PUT` | `/api/workflows/[id]/tags` | editor | `{ tagIds }` — replaces the set the workflow wears, in one statement. At most 10. A tag id from another workspace is `404` |
| `PUT` | `/api/workflows/[id]/star` | **viewer** | Stars it for you. Idempotent |
| `DELETE` | `/api/workflows/[id]/star` | **viewer** | Unstars it. Idempotent |
| `POST` | `/api/workflows/[id]/duplicate` | editor | 201, a copy: its own webhook token, the same graph, visibility and tags, **switched off** if its trigger would run it by itself |
| `GET` | `/api/workflows/[id]/export` | viewer | The export envelope. **Pinned outputs are left out unless `?pinned=include`** |
| `POST` | `/api/workflows/import` | editor | The body is an export envelope → 201, a new workflow in **your active workspace**, switched off if its trigger would run it by itself |

A star is a personal preference that changes nothing anybody else sees, which is why a viewer may
star — the second write a viewer may make, beside finishing the first-run guide.

**The export envelope** is specified in [`../CONTRACT.md`](../CONTRACT.md) → *The workflow export*:

```jsonc
{
  "format": "agentforge/workflow",   // what it is — anything else is refused as "not an export"
  "version": 1,                      // a newer version is refused as newer, before its shape is read
  "exportedAt": "2026-10-08T12:00:00.000Z",
  "workflow": { "name": "…", "description": "…", "graph": { "version": 1, "nodes": [], "edges": [] } }
}
```

It carries the workflow and **nothing about where it lived** — no id, owner, workspace, token,
history, visibility, tags or stars. **No connection is ever in it**: a node finds its credential
by kind in the workspace that runs it, so an imported Discord node posts with *your* Discord
connection. A value typed into a node's config — a header, a URL — is part of the workflow and is
exported with it; keep secrets in Settings → Integrations, where they are encrypted.

An import is refused, and nothing is created, when the body is not JSON or not an export (`400`),
when it is a newer format (`400`, naming the version), when the workflow does not fit the graph's
shape or limits (`400`, with the failing paths), or when it uses a node type this deployment does
not have (`422`, **naming every one**). Any other problem — no trigger, a half-filled config — is
not a refusal: the workflow is created with `runnable: false` and its problems, because an export
of a half-built workflow should come back half-built.

```bash
# Export with a session cookie, keep the envelope, and import it into the active workspace.
curl -fsS "$APP_BASE_URL/api/workflows/$ID/export" -b "$COOKIE" | jq .data > weekly.agentforge.json
curl -fsS -X POST "$APP_BASE_URL/api/workflows/import" -b "$COOKIE" \
  -H 'content-type: application/json' --data-binary @weekly.agentforge.json
```

## Versions

Every save is a version. Nothing has to be "committed".

| Method | Route | Role | What it does |
|---|---|---|---|
| `GET` | `/api/workflows/[id]/versions` | viewer | The version list, newest first |
| `GET` | `/api/workflows/[id]/versions/[number]` | viewer | One version's full graph |
| `PATCH` | `/api/workflows/[id]/versions/[number]` | editor | Names a version, so it can be found later |
| `POST` | `/api/workflows/[id]/versions/[number]/restore` | editor | Restores it — as a **new** version, never by rewriting history |
| `GET` | `/api/workflows/[id]/versions/compare` | viewer | A structural diff of two versions: nodes and edges added, removed, changed |

## Runs

| Method | Route | Role | What it does |
|---|---|---|---|
| `POST` | `/api/workflows/[id]/runs` | editor | Starts a run. Records which version it executed. `target: { scope: "node" \| "path", nodeId }` tests one node, or the way to it, as a labelled test run (Phase 31) |
| `GET` | `/api/workflows/[id]/runs` | viewer | That workflow's run history |
| `GET` | `/api/runs` | viewer | Every run in the workspace |
| `GET` | `/api/runs/[id]` | viewer | One run with its per-node steps, logs and outputs |
| `POST` | `/api/runs/[id]/cancel` | editor | Asks a run to stop. The engine checks the signal between steps |
| `GET` | `/api/workflows/[id]/stream` | viewer | **SSE.** Per-node status and log lines, live |

The stream is `text/event-stream` and reconnects natively. Event names and payloads are
fixed in [`../CONTRACT.md`](../CONTRACT.md) → *SSE event contract* — they are a contract
precisely because a reconnecting client must be able to rejoin mid-run.

## Triggers

| Method | Route | Guard | What it does |
|---|---|---|---|
| `POST` | `/api/webhook/[token]` | 192-bit token | **No session.** Runs one workflow. Body capped at 64 KB and pattern-checked before the database is touched. A workflow that is switched off answers **409** and starts nothing |
| `POST` | `/api/workflows/[id]/webhook/rotate` | admin | Issues a new webhook token and refuses the old one immediately |
| `POST` | `/api/cron/fire` | `CRON_SECRET` **and** an HMAC token for one slot of one workflow | **No session.** A schedule timer's delivery: fires that slot, or arms it again if it is not yet due. A stale or duplicate timer starts nothing — the slot is claimed by compare-and-set. Cloud Tasks calls this |
| `POST` | `/api/cron/tick` | `CRON_SECRET`, compared in constant time | **No session.** The **daily** safety sweep: fires overdue schedules, re-arms timers, wakes lost waiting runs. Idempotent by compare-and-set. Cloud Scheduler calls this |
| `POST` | `/api/runs/dispatch` | `CRON_SECRET` **and** the run's own 192-bit dispatch token | **No session.** Resumes one run its owner already started — including a `waiting` run at its wake time. A duplicate delivery is harmless — the lease makes it so |

A workflow's automatic triggers have an **active switch**: `PATCH /api/workflows/[id]` with
`{ "active": false }` (editor) makes its webhook refuse and stops its schedule; manual runs
still work. Switching it back on schedules from now — missed slots are not caught up.

## Sharing

| Method | Route | Role | What it does |
|---|---|---|---|
| `POST` | `/api/workflows/[id]/share` | admin | Publishes a read-only link |
| `DELETE` | `/api/workflows/[id]/share` | admin | Revokes it |
| `GET` | `/api/share/[token]` | 192-bit token | **No session.** A **redacted** read of one graph |

What a share link may publish is an **allowlist that defaults to nothing**
(`PUBLISHABLE` in [`src/lib/workflow/share.ts`](../src/lib/workflow/share.ts)). The line
it draws: shape and settings are published, typed-in values are not. A test asserts the
allowlist covers the registry in both directions, so adding a node fails the build until
somebody decides what it may reveal.

## Workspaces and membership

| Method | Route | Role | What it does |
|---|---|---|---|
| `GET` | `/api/workspaces` | signed in | Every workspace you belong to |
| `POST` | `/api/workspaces` | signed in | Creates one. You become its owner |
| `PATCH` | `/api/workspaces/[id]` | admin | Renames it |
| `POST` | `/api/workspaces/active` | signed in | Switches the active workspace |
| `GET` | `/api/workspaces/[id]/members` | member | The member list with roles |
| `PATCH` | `/api/workspaces/[id]/members/[userId]` | member, then `roleChangeRefusal` | Changes a role. Promoting to admin needs `admin`; granting or removing ownership needs `owner`; demoting the sole owner is refused whoever asks |
| `DELETE` | `/api/workspaces/[id]/members/[userId]` | member, then the same rules | Removes a member, or leaves |
| `GET` | `/api/workspaces/[id]/invitations` | admin | Pending invitations |
| `POST` | `/api/workspaces/[id]/invitations` | admin | Mints a single-use invitation link at a fixed role |
| `DELETE` | `/api/workspaces/[id]/invitations/[invitationId]` | admin | Revokes one |
| `GET` | `/api/invitations/[token]` | 256-bit token | **No session.** What this invitation is for, so the page can say so before sign-in |
| `POST` | `/api/invitations/[token]/accept` | token **and** a session | Joins the workspace. Single use, 7-day expiry |

The invitation token is the only one stored hashed. A webhook URL and a share URL must
stay displayable for as long as they are live, because the URL *is* the feature; an
invitation is shown once, so the database has no reason to be able to hand a live one to
whoever reads it.

## Credentials and settings

No route returns a stored secret. Reads return presence, metadata and a redacted hint.

| Method | Route | Role | What it does |
|---|---|---|---|
| `GET` | `/api/credentials` | viewer | What is connected, when, and by whom — never a value |
| `POST` | `/api/credentials/[kind]/rotate` | admin | Replaces a secret in place. **Validates against the provider before it writes** |
| `POST` | `/api/credentials/rekey` | owner | Rotates the root key, re-wrapping each data key without decrypting a single secret. Resumable |
| `GET` | `/api/settings/provider` | viewer | The workspace's LLM provider and model |
| `PUT` | `/api/settings/provider` | admin | Sets the provider, model and key |
| `DELETE` | `/api/settings/provider` | admin | Disconnects it |
| `GET` | `/api/settings/provider/models` | admin | Models the stored key can actually reach, asked of the provider |
| `GET` | `/api/integrations/[service]` | viewer | One integration's connection state |
| `PUT` | `/api/integrations/[service]` | admin | Connects it |
| `DELETE` | `/api/integrations/[service]` | admin | Disconnects it |
| `GET` | `/api/integrations/discord` | viewer | Discord's connection state |
| `GET` | `/api/integrations/google` | viewer | Google's connection state |
| `DELETE` | `/api/integrations/google` | admin | Disconnects Google |
| `GET` | `/api/integrations/google/connect` | signed in | Starts Google's OAuth consent flow |
| `GET` | `/api/integrations/google/callback` | OAuth state | Google redirects here. Exchanges the code and stores the refresh token |

`/api/integrations/[service]` is the generic one and serves Slack, Notion, GitHub,
Airtable and Postgres from a single table. Discord and Google predate it and keep their
own routes. Full posture, and what is deliberately *not* claimed, in
[`../SECURITY.md`](../SECURITY.md).

## Catalogue and templates

| Method | Route | Role | What it does |
|---|---|---|---|
| `GET` | `/api/nodes` | signed in | The node registry as the palette sees it — every node, its config schema, its outputs |
| `GET` | `/api/templates` | viewer | The template gallery |
| `POST` | `/api/templates/[id]` | editor | Clones a template into a real, editable workflow |

`GET /api/nodes` is the same projection this repository's
[node reference](./nodes.md) is generated from.

## Operations

| Method | Route | Role | What it does |
|---|---|---|---|
| `GET` | `/api/health` | none | Five dependency checks: database, schema, queue, root key, registry. Plus the live revision, migration count and registry size |
| `POST` | `/api/onboarding` | viewer | Finishes the first-run guide for this workspace, for good. Idempotent, and takes no body |
| `GET` | `/api/analytics` | viewer | Runs over time, success rate, slowest nodes, model usage and grouped failures — computed on demand |

`/api/health` is deliberately unauthenticated and deliberately boring: it names which
dependency is unhealthy, and nothing about any account. The queue block reports
`location` and `queue` — both copied from environment variables, so both can be wrong —
and deliberately **not** the GCP project, which comes from the metadata server and
therefore cannot be. See [`../SECURITY.md`](../SECURITY.md) for the full list of surfaces
that answer without a session.

`POST /api/onboarding` is one of the two writes in the product that a `viewer` may make — the other
is starring a workflow. What each changes is the asker's own view; neither grants anything or
reveals anything.

## Auth

| Method | Route | What it does |
|---|---|---|
| `GET` `POST` | `/api/auth/[...nextauth]` | Auth.js v5's own handlers — sign-in, callback, sign-out, session, CSRF |

---

## Calling it from outside the browser

Every route above authorises a *session cookie*, not an API key — there is no personal
access token in this product yet. The two things that are callable without a browser are
the ones designed to be: a workflow's **webhook URL**, and the machine endpoints guarded
by `CRON_SECRET`.

```bash
# Trigger a workflow from anywhere. The URL is on the workflow's trigger node.
curl -fsS -X POST "$APP_BASE_URL/api/webhook/$WEBHOOK_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","message":"the rota is wrong again"}'

# Health, which needs nothing at all.
curl -fsS "$APP_BASE_URL/api/health" | python3 -m json.tool
```

If you are automating against your own deployment and want a session, mint one the way
the verification suites do — `scripts/mint-session.mjs` writes a genuine session row and
prints the cookie. It is a real session, not a test-only bypass, which is the point: there
is no code path in this product that authenticates differently for a test.
