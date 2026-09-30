# SECURITY.md — AgentForge

**What this system protects, how, and what it does not protect.** Written in Phase 21 alongside
the credential vault, because a product that stores other people's API keys owes its readers a
straight answer about how.

This file is deliberately specific. A security document that says "we take security seriously"
tells a reader nothing they can check; every claim below names the file that implements it, so a
stranger can disagree with us from the evidence.

---

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

| | |
|---|---|
| **Where** | Use GitHub's private vulnerability reporting: **Security → Report a vulnerability** on <https://github.com/arunishrajput/AgentForge> |
| **What to include** | What you did, what happened, what you expected, and the deployed URL or commit you tested against |
| **Response** | This is a single-maintainer project with no on-call. Expect an acknowledgement within **7 days** and an assessment within **14** |
| **Disclosure** | Coordinated. Once a fix is deployed and the reporter agrees, the finding is written up in an ADR under `adr/` and credited unless the reporter asks otherwise |
| **Scope** | The deployed application, this repository, and the infrastructure described in `DEPLOYMENT.md` |

**Out of scope, and why:** anything requiring physical access to the maintainer's machine; the
security of the free-tier providers themselves (Google Cloud, Neon, Google's Gemini API);
denial of service against a free-tier deployment, which has no capacity claim to break; and
findings in the `/design` gallery, which is a static page holding nothing belonging to any
account.

**Safe harbour.** Testing against the deployed URL with your own account is welcome. Do not
test against another user's workspace, do not exfiltrate data that is not yours, and do not run
load or denial-of-service tests.

---

## What is at risk here

Ranked by what an attacker would actually want, which is not the same as ranked by how
interesting the code is.

| Asset | Where it lives | Worst case |
|---|---|---|
| **A user's LLM API key** | `credential` row, kind `llm.google` | Somebody else spends their quota, or their money if the key is a paid one |
| **A Google refresh token** | `credential` row, kind `google.oauth` | Mail sent as them; their spreadsheets written to. **The sharpest asset in the product** |
| **A Discord webhook URL** | `credential` row, kind `integration.discord` | Messages posted to their channel as their bot |
| **A workflow's webhook trigger token** | `workflow.webhookToken` | Arbitrary runs of one workflow started by anybody holding the URL |
| **A workspace invitation token** | `workspace_invitation.tokenHash` | Membership of a workspace, at the invited role |
| **A public share token** | `workflow.shareToken` | A redacted read of one workflow's graph |
| **Workflow graphs and run history** | `workflow`, `run`, `run_step` | Disclosure of what somebody automates and the data that flowed through it |

---

## Secrets at rest — envelope encryption

`src/lib/crypto/`. **Phase 21 replaced Chapter 1's single-key scheme**, and the reason is worth
stating plainly: Chapter 1 encrypted every secret directly under `ENCRYPTION_KEY` and shipped
with the accurate warning *never rotate this, it destroys all stored credentials*. A key you
cannot rotate is not a control; it is a liability with a comment next to it.

```
   the secret  --AES-256-GCM-->  ciphertext      key: a fresh 256-bit DEK, one per credential
   that DEK    --AES-256-GCM-->  wrappedKey      key: the root key, versioned
```

Seven columns on a `credential` row: `ciphertext`/`iv`/`authTag` for the secret,
`wrappedKey`/`wrapIv`/`wrapAuthTag` for its data key, and `keyVersion` naming the root key that
wrapped it.

| Decision | Why |
|---|---|
| **AES-256-GCM, not CBC** | It authenticates. A row edited in the database fails to decrypt instead of yielding plausible bytes that then get sent to a provider as an API key |
| **A fresh IV per encryption, generated inside `seal`** | IV reuse under GCM is a key-recovery break, so there is no signature by which a caller could supply one |
| **A fresh data key per write** | Rotating a secret in place leaves **no key material in common** with what it replaced. That is most of what rotation is supposed to buy, and it costs 32 bytes of CSPRNG |
| **The root key lives in Secret Manager**, `agentforge-root-key` | Versioned, so a rotation is additive; access is granted to one secret, not project-wide, and only to the service account Cloud Run already runs as |
| **Secret Manager and not Cloud KMS** | KMS is the textbook answer for envelope encryption and costs ~$0.06 per key per month plus operations. **The zero-cost ceiling binds** (`CLAUDE.md` → *Cost rules*). See *What we do not claim* below for what that costs us |
| **A `latest` access resolves the version and returns its number** | So sealing needs no `versions.list` call — one access operation, cached, against a free tier of 10,000 a month |
| **Refusing beats falling back** | If `ROOT_KEY_SECRET` is set and Secret Manager is unreachable, a write **fails**. A silent fallback to `ENCRYPTION_KEY` would seal new credentials under a key the operator believes is retired, leaving rows a later rotation would skip |

### Nothing in a credential row reaches a client

`describeCredential` in `src/lib/credentials/index.ts` is the only projection that may cross to
a browser. It carries metadata, timestamps, counts and the root key **version label** — and no
value, no prefix, and **no masked tail**, because a four-character hint is still key material.
The envelope columns are never read into the returned object, so a future spread cannot leak
them by accident. A test serialises the projection and searches it for every one of the six
secret columns.

A version label such as `sm:1` is not key material: it names immutable bytes in a key store and
reveals nothing about them. It crosses to the client because it is the only way an operator can
tell that a re-key actually moved anything.

---

## Rotation

Three things can be rotated, and they are deliberately three separate operations.

### A stored credential

`POST /api/credentials/<kind>/rotate` — **`admin`**.

**Nothing is written until the new secret has been proved against the provider**, by the same
code that proved the original: a key with one `models.list` call, a webhook with one call to
Discord. The alternative is a route whose failure mode is *your workspace is now broken and the
old secret is gone*, and there is no undo for that, because the old secret is not kept.

Rotation is per-kind, and two of the three kinds are not a text box:

| Kind | Mode | Rotation is |
|---|---|---|
| `llm.google` | `value` | Supply a new API key. Checked against the provider first |
| `integration.discord` | `value` | Supply a new webhook URL. Called first. **The old webhook is not deleted at Discord** — nothing here can do that, and the vault says so |
| `google.oauth` | `reconnect` | Re-run the consent flow. A refresh token can only be minted by Google, so there is nothing to paste and the vault offers a link instead of a control that could not work |

`ROTATION_RULES` in `src/lib/credentials/rotation.ts` is the table, and **a test asserts it
covers the credential registry in both directions** — so a kind added in a later phase fails the
build until somebody decides what rotating it means. Without that, a new kind would silently
become unrotatable and nothing would break, so nobody would notice.

### A workflow's webhook token

`POST /api/workflows/<id>/webhook/rotate` — **`admin`**.

**The old URL is refused from the moment the request returns.** There is no grace period, and
that is the decision: a token that keeps working for an hour after being rotated is a token that
is still live for an hour after somebody rotated it *because it leaked*, which is the case
rotation exists for. Whatever was calling the old URL stops working until it is given the new
one, so the canvas makes it a confirmed action that states exactly that.

`admin` rather than `editor`, matching the public share link. An editor may already change
everything about a workflow; what they may not do is invalidate a secret that systems outside
this product are calling.

### The root key

**This is the procedure. Read it before starting.**

1. **Add a version.** `gcloud secrets versions add agentforge-root-key --data-file=-`, with 32
   bytes of base64 (`openssl rand -base64 32`). Nothing changes yet: existing rows name the
   version that wraps them and keep decrypting.
2. **Re-key.** Either the in-product path per workspace — `POST /api/credentials/rekey`,
   **`owner`** — or the operator path over every workspace:

   ```bash
   ROOT_KEY_SECRET=agentforge-root-key \
   GCP_PROJECT=<project> \
   GCP_ACCESS_TOKEN="$(gcloud auth print-access-token)" \
   node --env-file=.env --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
        --import ./scripts/test-register.mjs scripts/rekey.mjs --dry-run
   ```

   Run `--dry-run` first; it reads and verifies every row and writes nothing. Then run it again
   without the flag.
3. **Confirm.** The vault's *Root key in use* reads the new version and *Not yet enveloped* is
   zero. In SQL: `select distinct "keyVersion" from credential;`
4. **Disable the old version** once nothing names it: `gcloud secrets versions disable
   agentforge-root-key --version=<n>`. Disable rather than destroy — a disabled version can be
   re-enabled if a row was missed, and a destroyed one cannot.

**Why re-keying is safe to run against production with no maintenance window.** Every credential
is an independent single-row `UPDATE` that records which root key wraps it, so a run interrupted
halfway leaves some rows on the new version and some on the old — and **every one of them still
decrypts**. Running it again finishes the job. For an enveloped row the ciphertext is not read,
not rewritten and not in scope; only the 32-byte data key moves. And every row is re-opened
after it is written and checked to decrypt to the same plaintext, because the failure that would
otherwise go undetected is silent and unrecoverable.

### Rolling back past Phase 21

**Migration `0009` is additive, so its rollback is not symmetric, and getting this wrong destroys
every stored credential.** After a re-key, a data key exists in exactly one place — the
`wrappedKey` column — so dropping that column discards the only copy of the key and leaves the
ciphertext permanently unreadable.

**The safe rollback does not touch the schema at all.** Shift Cloud Run traffic to the previous
revision and leave the columns in place: a revision that knows nothing about them reads the rows
it understands. The only thing needed first is to convert the rows back:

```bash
node --env-file=.env --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
     --import ./scripts/test-register.mjs scripts/rekey.mjs --to-legacy
```

`drizzle/rollback_0009.sql` — for removing the columns afterwards — **refuses to run while any
row is still enveloped**, naming the count. `scripts/rehearse-0009.mjs` puts an envelope on a row
and asserts that refusal, because a guard that does not fire is worse than no guard: it is
trusted.

---

## The audit log

`credential_event`, and `src/lib/credentials/audit.ts`. **It records use, never content.**

Worth spelling out what that rules out, because each one is tempting while debugging: no secret,
no prefix of one, no length, no hash, and no request or response body from the service the secret
authenticated to. The only free text on a row is `detail`, and the values it may hold are a union
in that file — a node's capability (`send-mail`, `append-row`) or a root key version.

| Property | Value |
|---|---|
| **Written from** | `readSecret` — the single funnel every plaintext passes through. Recording at the call sites would be four places to keep in step and a fifth added later without one, and a use this log missed is worse than no log, because a log is trusted |
| **Events** | `stored`, `rotated`, `revoked`, `used`, `rekeyed`. `stored` and `rotated` are separate although both write the same columns: the first time a workspace connects Discord is not a rotation |
| **Survives revocation** | `credentialId` is `ON DELETE SET NULL` and `kind`/`label` are denormalised onto the row — so the history stays readable after the credential is gone, which is exactly when somebody wants to read it |
| **Attribution** | `runId`/`nodeId`/`nodeType` for a use; `actorId` for a deliberate human act. A use has **no** actor, because it happens inside a run that may have been started by a schedule or an unauthenticated webhook, and naming the workflow's owner would invent a person who did not act |
| **`actorId` never reaches a client** | Recorded, deliberately not projected: a workspace member cannot act on it, and a user id on a page about secrets is one identifier too many |
| **Retention** | **30 days**, pruned by the cron tick. Long enough to answer *what used this before I rotated it*, short enough that the table cannot become the largest thing in a 0.5 GB free-tier database |
| **Never fails the thing it audits** | An insert that throws is logged to stderr and swallowed. A Neon hiccup mid-run must not turn a successful Discord post into a failed step. **That trade is only acceptable because this log is operational, not a compliance record** — if it ever becomes the latter, this line is where the decision changes |

---

## Authentication and authorisation

| | |
|---|---|
| **Identity** | Google OAuth via `next-auth@5`, database sessions. No passwords are stored, because none are collected |
| **Session storage** | The `session` table. Not JWTs — a database session can be revoked, and the role check below reads the membership row per request so a role change takes effect on the next request with no cache to wait out |
| **No middleware** | Next 16 renamed `middleware` to `proxy` with no edge runtime, and a database session cannot be read from the edge. **Route protection is a server-side `auth()` check in every route** (D9) |
| **One funnel** | `requireScope(minimumRole)` in `src/lib/api.ts` establishes every authenticated route's authority. Its default is **`viewer`** — the least privilege — so a mutating route added later that forgets the argument fails **closed** |
| **Tenancy** | Every query filters on `scope.workspaceId`. There is no code path that reads a workflow by id alone |
| **404 versus 403** | Another workspace's resource is **404**, because 403 would confirm the id exists (D20). Insufficient role inside a workspace you *are* in is **403** — you already know it exists, and hiding behind a 404 would make a real permission boundary look like a bug |

The role matrix is `CONTRACT.md` → *What each role may do*, and the rules a ranking cannot
express — who may change whose role, which workflow rows a member may see — are pure functions
with unit tests in `src/lib/workspace/roles.ts` and `src/lib/workflow/visibility.ts`.

### Credentials are shared by a workspace, and that is a deliberate widening

**Every member of a workspace can use every credential in it.** This is required rather than
incidental: a workflow shared with a teammate that cannot reach its Google credential fails at
the first integration node, at runtime, with an error about a connection the teammate never made.

The consequence is stated rather than left to be discovered, and the sharpest case is
`google.oauth`: **connecting Google to a workspace lets every member of that workspace act as you
within the scopes you granted** — sending mail from your address, writing to your spreadsheets.
The settings page says so on the card where the connection is made. Adding or removing a
credential is `admin`.

---

## The unauthenticated surfaces

Four routes and two pages answer with no session. Each one is listed here because the complete
list is the thing worth auditing.

| Surface | Guard | Blast radius of the token |
|---|---|---|
| `POST /api/webhook/<token>` | 192-bit token on the workflow row | Runs **one** workflow. Body capped at 64 KB, pattern-checked before the database is touched |
| `POST /api/cron/tick` | `CRON_SECRET`, compared in constant time | Fires due schedules. Idempotent by compare-and-set |
| `POST /api/runs/dispatch` | `CRON_SECRET` **plus** the run's own 192-bit `dispatchToken` | Resumes **one** run its owner already started. The lease makes a duplicate delivery harmless (D82) |
| `GET /api/share/<token>` + `/s/<token>` | 192-bit share token | A **redacted** read of one graph. The only surface whose risk is in the *response* |
| `GET /api/invitations/<token>` + `/invite/<token>` | 256-bit token, stored only as `sha256` | Membership of one workspace at the invited role. 7-day expiry, single use |
| `/` and `/design` | none | Static. Nothing belonging to any account |

**Token widths are chosen, not copied.** 192 bits for a webhook and a share link, 256 for an
invitation — wider because it grants a *workspace* rather than one workflow. All are CSPRNG,
base64url, and never a hash of a known input: a hash of a known input is a guess away from being
the input.

**Only the invitation token is hashed at rest**, and the asymmetry is deliberate. A webhook URL
and a share URL must stay displayable for as long as they are live, because the URL *is* the
feature. An invitation is shown once, in one link, so the database has no reason to be able to
hand a live invitation to whoever reads it. Plain SHA-256, not bcrypt or argon2: those exist to
make a *low-entropy* secret expensive to guess, and there is nothing to slow down at 256 bits of
CSPRNG.

### What a share link may publish is an allowlist that defaults to nothing

`PUBLISHABLE` in `src/lib/workflow/share.ts`. A denylist — strip `headers`, strip `to` — is the
obvious shape and it **fails open**: the day a node with a `token` field is added, the denylist
does not know about it and the link starts publishing it. The allowlist refuses to publish a
field nobody has named, so the same mistake produces a share that says too *little*. The line it
draws is **shape and settings are published, typed-in values are not**. A test asserts the table
covers the node registry in both directions, so adding a node fails the build until somebody
decides.

---

## The agent, and what it cannot reach

This is an agentic product, so an LLM chooses what to call at runtime. That is a security
boundary, and it is drawn in three places.

| Rule | Where |
|---|---|
| **An agent reaches only explicitly registered nodes** | `src/lib/nodes/index.ts`. There is no shell, no filesystem and no arbitrary network access in the tool set |
| **`agentCallable` defaults to `false`** | `src/lib/nodes/types.ts`. Widening the agent's reach is a deliberate act per node, never a side effect of adding one |
| **`integration.gmail` is closed to the agent**; HTTP, Discord and Sheets are open | A sent email leaves the account, reaches a third party and cannot be recalled — and an agent-callable Gmail means a model chooses **both** recipient and body from text that may have arrived on an unauthenticated webhook (D44) |
| **A node's authority is its run's workspace and nothing else** | `NodeContext.scope` is the whole of it. Nothing a node's config says can widen it, which is what keeps tool-calling inside the tenant it started in |
| **No arbitrary user code execution** | Not in any form, not sandboxed, not for a demo. `PRD.md` → *Out of scope*, and it is not negotiable |
| **Template references are lookups, not an expression language** | `{{steps.x.output}}` resolves a path. There is no `eval` anywhere in the request path (D17) |

**Outbound requests are guarded.** `src/lib/integrations/net.ts` refuses plain `http`, refuses
credentials in a URL, and refuses the cloud metadata server by address, by name and by scheme —
which is the SSRF that matters on Cloud Run, because that endpoint mints service-account tokens.
The HTTP node is the reason this exists: its URL comes from a graph a model may have written.

---

## Secrets in the deployment

| Rule | How |
|---|---|
| **No secret is committed** | `.env` is gitignored; `.env.example` holds names and shapes only. `.gcloudignore` is committed so what leaves the machine is reviewed |
| **No secret is logged** | A key-length failure reports the length, never the value. Provider errors pass the provider's own words through and never echo the key |
| **A misconfigured container exits rather than serving** | `src/instrumentation.ts` calls `process.exit(1)` in production. When `register()` merely throws, Next keeps listening and answers 500 to everything while Cloud Run reads the open port as healthy (D7) |
| **`DATABASE_URL_UNPOOLED` is not set on the service** | Only `drizzle.config.ts` reads it; setting it would widen the production secret surface for nothing (D13) |
| **`GCP_ACCESS_TOKEN` is never set on the service** | It is a script's input for reaching Secret Manager from a machine with no metadata server. On Cloud Run the token comes from the metadata server, which is short-lived by construction |
| **Least-privilege IAM** | `roles/secretmanager.secretAccessor` is bound to **the one secret**, not to the project, and to the service account Cloud Run already runs as |

---

## What we do not claim

The honest limits. Each one is a real gap, not a hedge.

1. **The root key is in this process's memory.** Cloud KMS would keep it inside Google's HSM and
   never hand it over; Secret Manager hands us the bytes, which we hold for the life of the
   instance. That is a genuine difference and it is the price of the zero-cost ceiling. A heap
   dump of a running container would contain the root key, and the data keys of every credential
   read since it started.
2. **A compromised container reads everything the workspace can.** The credentials are decrypted
   by this process by design — a workflow that sends mail must have the token. Envelope
   encryption protects the data *at rest* and makes the key rotatable; it does not protect
   against code execution inside the app.
3. **No rate limiting.** The webhook and share endpoints are unauthenticated and unthrottled.
   Cloud Run's `max-instances 3` is a cost ceiling, not a security control.
4. **No MFA and no session-device binding.** Identity is whatever Google says; if a user's Google
   account is compromised, so is their workspace.
5. **The audit log is operational, not tamper-evident.** It is rows in the same database as the
   data, writable by the same credentials, pruned after 30 days, and its insert failures are
   swallowed rather than fatal.
6. **One Neon database serves local development and production.** Convenient, and it means a
   mistake on a developer machine reaches real data. `DEPLOYMENT.md` records it.
7. **No penetration test and no third-party audit.** Everything here is one maintainer's
   reasoning, which is exactly why it is written down in this much detail.
8. **The OAuth consent screen is in Testing.** Only listed test users can sign in to the
   deployed app, which is a limit on availability rather than on security, but it is the reason
   you may not be able to reproduce a finding.

---

## Where this is implemented

| Concern | File |
|---|---|
| The cipher | `src/lib/crypto/aes.ts` |
| Root key and versions | `src/lib/crypto/root-key.ts`, `src/lib/gcp/secret-manager.ts` |
| Envelope encryption | `src/lib/crypto/envelope.ts` |
| Re-keying | `src/lib/credentials/rekey.ts`, `scripts/rekey.mjs` |
| The credential store | `src/lib/credentials/index.ts` |
| The audit log | `src/lib/credentials/audit.ts` |
| Rotation rules | `src/lib/credentials/rotation.ts` |
| Authorisation | `src/lib/api.ts`, `src/lib/workspace/roles.ts`, `src/lib/workflow/visibility.ts` |
| What a share link publishes | `src/lib/workflow/share.ts` |
| Outbound request guard | `src/lib/integrations/net.ts` |
| Trigger tokens | `src/lib/triggers/webhook.ts`, `src/lib/triggers/secret.ts` |
| Env contract | `src/lib/env.ts`, `CONTRACT.md` → *Environment variables* |

---

**Last reviewed:** 2026-09-30, Phase 21.
