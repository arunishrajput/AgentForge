import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

import type { RunCursor } from "@/lib/engine/cursor";
import type { RunMode, RunStatus, StepStatus, TriggerKind } from "@/lib/engine/types";
import type { StepLog } from "@/lib/nodes/types";
import type { WorkflowGraph } from "@/lib/workflow/graph";
import type { WorkspaceRole } from "@/lib/workspace/roles";

/**
 * Auth tables (Phase 1) and the workflow domain (Phase 3).
 *
 * Auth column names are the ones `@auth/drizzle-adapter` documents (camelCase,
 * quoted in Postgres). They are the adapter's contract, not a style choice; the
 * Phase 3 tables follow the same casing for consistency.
 */
export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
  ],
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (verificationToken) => [
    primaryKey({
      columns: [verificationToken.identifier, verificationToken.token],
    }),
  ],
);

/* ------------------------------------------------------------------ *
 * Phase 19A — workspaces and membership
 * ------------------------------------------------------------------ */

/**
 * A workspace is **the unit every resource belongs to** — a workflow, a run, a version
 * and a credential all name one, and no query in the product reads across a workspace
 * boundary.
 *
 * It replaces "the user" as the tenant, and it does **not** replace `ownerId`. Those
 * two columns answer different questions and both are worth keeping: `workspaceId`
 * answers *who may see this*, `ownerId` answers *who made this happen*. Collapsing
 * them would cost the run history the only record it has of who triggered a run.
 *
 * `personal` marks the workspace created automatically for a user, which is the one
 * they land in and the one every pre-Phase-19 resource was backfilled into. It is a
 * fact about the row's origin, not a permission: a personal workspace is an ordinary
 * workspace in every other respect, and Phase 19B may invite somebody into one.
 */
export const workspaces = pgTable(
  "workspace",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    /**
     * Who created it. **Not an authorisation column** — membership is, and the check
     * is always against `workspace_member`. `set null` rather than `cascade`: deleting
     * the person who made a workspace must not delete the workspace out from under
     * everybody else in it.
     */
    createdBy: text("createdBy").references(() => users.id, { onDelete: "set null" }),
    personal: boolean("personal").notNull().default(false),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One personal workspace per creator, enforced rather than assumed: the scope
    // resolver creates one when it finds none, and two requests arriving together on a
    // cold account would otherwise both find none and both create one. `neon-http` has
    // no transactions (D6), so this index *is* the interlock — the loser of the race
    // gets a conflict and re-reads.
    uniqueIndex("workspace_personal_idx")
      .on(table.createdBy)
      .where(sql`${table.personal}`),
  ],
);

/**
 * Who is in a workspace, and as what.
 *
 * `(workspaceId, userId)` is the primary key, so a person cannot be in the same
 * workspace twice — the shape that makes an invitation idempotent in Phase 19B.
 *
 * **`role` is written here and enforced in Phase 20.** `lib/workspace/roles.ts` holds
 * that handoff in full; the short version is that Phase 19A only ever writes `owner`,
 * so there is nothing yet for an enforcement layer to refuse.
 */
export const workspaceMembers = pgTable(
  "workspace_member",
  {
    workspaceId: text("workspaceId")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<WorkspaceRole>().notNull().default("owner"),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    // Every request resolves the active workspace by asking "which workspaces is this
    // user in", so this is the hot index, not the primary key's.
    index("workspace_member_user_idx").on(table.userId),
  ],
);

/**
 * An invitation to join a workspace — Phase 19B.
 *
 * **This is a new unauthenticated surface, and it is treated like the webhook trigger
 * token** (D41): the token is minted from a CSPRNG, it expires, it is single use, and a
 * holder of the wrong one learns nothing. It differs from the webhook token in one
 * respect, deliberately: **only a SHA-256 hash of it is stored.** A webhook token has to
 * be displayable for ever, because the URL is the feature; an invitation token is shown
 * once, in one link, so there is no reason for the database to be able to hand a live
 * invitation to whoever reads it. Re-inviting the same address rotates the token rather
 * than revealing the old one.
 *
 * `email` is the address the invitation was *addressed to*, normalised to lower case.
 * **It is matched against the verified email from the identity provider at accept time,
 * never against a claim in the URL** — the link proves possession, the provider proves
 * identity, and both are required.
 *
 * The three `*At` columns are the state machine, and it is deliberately append-only:
 * an invitation is live when all three are null and it has not expired. Nothing is
 * deleted, so a revoked or accepted invitation stays as the record that it happened.
 *
 * `role` can never be `owner`. Ownership comes from creating a workspace or from Phase
 * 20's role management, not from a link — `issueInvitation` refuses it, and so does the
 * route's schema.
 */
export const workspaceInvitations = pgTable(
  "workspace_invitation",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspaceId")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Lower-cased at every boundary. `ada@x.com` and `Ada@X.com` are one invitation. */
    email: text("email").notNull(),
    role: text("role").$type<WorkspaceRole>().notNull().default("editor"),
    /**
     * `sha256(token)`, hex. Unique, so the lookup is an indexed equality on a value the
     * database never has the plaintext of. A leaked backup yields no usable links.
     */
    tokenHash: text("tokenHash").notNull().unique(),
    invitedBy: text("invitedBy").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("acceptedAt", { withTimezone: true }),
    /** Who accepted. Not necessarily findable from `email` later — an account can change it. */
    acceptedBy: text("acceptedBy").references(() => users.id, { onDelete: "set null" }),
    revokedAt: timestamp("revokedAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * **One live invitation per address per workspace, enforced by the database.**
     *
     * Partial, because the same address may be invited again after leaving, and every
     * accepted or revoked row stays as history. `neon-http` has no transactions (D6), so
     * this index is what makes re-inviting an atomic upsert that rotates the token
     * instead of a read-then-write race that can leave two live links — the same
     * argument `workspace_personal_idx` is built on.
     */
    uniqueIndex("workspace_invitation_live_idx")
      .on(table.workspaceId, table.email)
      .where(sql`${table.acceptedAt} is null and ${table.revokedAt} is null`),
    // The invitations list: one workspace's, newest first.
    index("workspace_invitation_workspace_idx").on(table.workspaceId, table.createdAt),
  ],
);

/* ------------------------------------------------------------------ *
 * Phase 3 — workflows, runs, steps, credentials
 * ------------------------------------------------------------------ */

/**
 * The graph lives in one `jsonb` column rather than node and edge tables. With
 * `drizzle-orm/neon-http` there are no transactions (D6), so a graph spread over
 * three tables could not be saved atomically — a single-row update is atomic for
 * free, and the canvas saves the whole graph at once anyway.
 */
export const workflows = pgTable(
  "workflow",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    ownerId: text("ownerId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * The workspace this workflow belongs to — Phase 19A, and **the scoping column**.
     * Every query the product makes filters on it.
     *
     * It sits *alongside* `ownerId` rather than replacing it, because the two answer
     * different questions: this one answers *who may see this*, `ownerId` answers
     * *who made this happen*.
     */
    workspaceId: text("workspaceId")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    graph: jsonb("graph").$type<WorkflowGraph>().notNull(),
    /**
     * The webhook URL's secret, on the row rather than in the graph (Phase 8, D41).
     * Minted in application code with 192 bits of CSPRNG; the database default
     * exists only so this column could be added while the previous revision — which
     * knows nothing about it — was still serving inserts.
     */
    webhookToken: text("webhookToken")
      .notNull()
      .unique()
      .default(sql`replace(gen_random_uuid()::text, '-', '')`),
    /**
     * When this workflow's schedule trigger is next due, in UTC; null when the graph
     * has no schedule trigger. Derived from the cron expression on every save, and
     * advanced by the cron tick, which claims a due schedule by compare-and-set on
     * exactly this column (D42).
     */
    scheduleNextAt: timestamp("scheduleNextAt", { withTimezone: true }),
    scheduleLastFiredAt: timestamp("scheduleLastFiredAt", { withTimezone: true }),
    /**
     * The current version number (Phase 18), and the reason versioning needs no
     * sequence table and no read-then-write race.
     *
     * `neon-http` has no transactions (D6), so `max(number) + 1` read from
     * `workflow_version` and inserted a moment later is a genuine race: two saves of
     * the same workflow can both read 4. Bumping this column **inside the same
     * single-row UPDATE that saves the graph** is atomic for free — the same primitive
     * D42 claims a cron slot with — and `RETURNING` hands back a number no other save
     * can have been given.
     */
    version: integer("version").notNull().default(1),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("workflow_owner_idx").on(table.ownerId, table.updatedAt),
    // The workflow list's query since Phase 19A — the owner index above no longer
    // serves it, because the list is "every workflow in this workspace", whoever made
    // each one. Kept side by side rather than replaced: `ownerId` is still a real
    // column with real reads, and an index on a two-row table costs nothing to keep.
    index("workflow_workspace_idx").on(table.workspaceId, table.updatedAt),
    // The cron tick's only query. Partial, because every workflow without a schedule
    // trigger is a null here and has no business being in the index.
    index("workflow_schedule_due_idx")
      .on(table.scheduleNextAt)
      .where(sql`${table.scheduleNextAt} is not null`),
  ],
);

/**
 * `ownerId` is denormalised from the workflow so every run query is owner-scoped
 * without a join, and so a run survives as a record of what happened.
 *
 * `heartbeatAt` is what makes an interrupted run observable: nothing else would ever
 * move an abandoned run out of `running` (ARCHITECTURE.md → "Execution engine
 * design").
 *
 * **Phase 17 added the seven columns below `heartbeatAt`, and they are one mechanism,
 * not seven features.** Together they answer: may this run be picked up again, by
 * whom, from where, and should it stop?
 *
 *   mode               `sync` cannot be redelivered; `durable` can. This is the only
 *                      thing that distinguishes "interrupted, lost" from
 *                      "interrupted, will resume", and therefore the only thing that
 *                      tells the sweeper whether failing a run is correct or a lie
 *   cursor             the frontier to carry on from (`lib/engine/cursor.ts`)
 *   attempt            deliveries so far, so a run that kills its container cannot
 *                      loop for ever at the queue's expense
 *   leaseOwner         who is executing it right now
 *   leaseExpiresAt     until when. **This is the correctness column.** Cloud Tasks is
 *                      at-least-once, so without a lease a redelivery would run a
 *                      workflow twice and post two Discord messages. A claim is a
 *                      compare-and-set against this, which is the only atomic
 *                      primitive `neon-http` offers (D42's shape, reused)
 *   cancelRequestedAt  somebody asked it to stop; the engine sees it at its next
 *                      checkpoint
 *   dispatchToken      192 bits of CSPRNG. The task carries it and the dispatch route
 *                      demands it, so that endpoint can only ever resume a run that
 *                      already exists — never start an arbitrary one
 */
export const runs = pgTable(
  "run",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workflowId: text("workflowId")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    ownerId: text("ownerId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * The workspace this run belongs to — Phase 19A, and **the scoping column**.
     * Every query the product makes filters on it.
     *
     * It sits *alongside* `ownerId` rather than replacing it, because the two answer
     * different questions: this one answers *who may see this*, `ownerId` answers
     * *who made this happen*.
     */
    workspaceId: text("workspaceId")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    status: text("status").$type<RunStatus>().notNull(),
    trigger: text("trigger").$type<TriggerKind>().notNull(),
    input: jsonb("input"),
    output: jsonb("output"),
    error: text("error"),
    startedAt: timestamp("startedAt", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finishedAt", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeatAt", { withTimezone: true }).notNull().defaultNow(),
    mode: text("mode").$type<RunMode>().notNull().default("sync"),
    cursor: jsonb("cursor").$type<RunCursor>(),
    attempt: integer("attempt").notNull().default(0),
    leaseOwner: text("leaseOwner"),
    leaseExpiresAt: timestamp("leaseExpiresAt", { withTimezone: true }),
    cancelRequestedAt: timestamp("cancelRequestedAt", { withTimezone: true }),
    dispatchToken: text("dispatchToken"),
    /**
     * Which version of the workflow this run executed (Phase 18). Null for every run
     * recorded before versioning existed, and for a run whose version row was pruned.
     *
     * A **number, not a foreign key**, for the same reason `ownerId` is denormalised
     * onto this table: a run survives as a record of what happened, and the record must
     * stay true even when the thing it refers to is gone. The number is immutable and
     * unique per workflow, so it identifies the version without a join and without
     * anything that can cascade.
     *
     * It is also load-bearing on resume: a durable run redelivered after the workflow
     * was edited executes the graph it *started* on, which it can only do because this
     * column says which one that was.
     */
    workflowVersion: integer("workflowVersion"),
  },
  (table) => [
    index("run_owner_idx").on(table.ownerId, table.startedAt),
    index("run_workspace_idx").on(table.workspaceId, table.startedAt),
    index("run_workflow_idx").on(table.workflowId, table.startedAt),
    index("run_status_idx").on(table.status, table.heartbeatAt),
    // The sweeper's query: unfinished runs whose lease has lapsed. Partial would be
    // tighter still, but Drizzle's `index()` has no `where` and the table is small.
    index("run_lease_idx").on(table.status, table.leaseExpiresAt),
  ],
);

/**
 * `config` is a snapshot of what the step actually ran with, **after template
 * resolution**. Phase 18 added workflow versioning, and it does not make this
 * redundant: the version says what the config *template* was, this says what the
 * template resolved to on this run. `{{input.subject}}` is the same in every version
 * and different in every run, and the resolved value is the one worth reading back.
 *
 * `(runId, seq)` is unique: steps are appended as they execute and `seq` is the
 * execution order, which is also how a looped node's passes stay distinguishable.
 */
export const runSteps = pgTable(
  "run_step",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    runId: text("runId")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    nodeId: text("nodeId").notNull(),
    nodeType: text("nodeType").notNull(),
    iteration: integer("iteration").notNull().default(0),
    status: text("status").$type<StepStatus>().notNull(),
    config: jsonb("config"),
    input: jsonb("input"),
    output: jsonb("output"),
    branch: text("branch"),
    logs: jsonb("logs").$type<StepLog[]>().notNull().default([]),
    error: text("error"),
    startedAt: timestamp("startedAt", { withTimezone: true }),
    finishedAt: timestamp("finishedAt", { withTimezone: true }),
  },
  (table) => [uniqueIndex("run_step_run_seq_idx").on(table.runId, table.seq)],
);

/**
 * A snapshot of a workflow as it was at one save — Phase 18.
 *
 * **A compact snapshot, not a row copy.** `webhookToken`, the schedule columns and the
 * timestamps are all properties of the workflow as it exists *now*, not of what it
 * looked like then; copying them per save would multiply the metered storage this
 * table spends for nothing anybody can read back. What a version is, is the `graph`
 * and the `name` — the two things a save can change and a restore must put back.
 *
 * `number` comes from `workflow.version`, bumped by the same UPDATE that wrote the
 * graph, so it is unique without a transaction. A gap in the sequence is possible and
 * is the honest outcome when a snapshot could not be written: the number is never
 * reused, so history never lies about the order things happened in.
 *
 * `label` is null for an ordinary save. A restore and a generation set one, because
 * those are the two versions somebody scrolling a history is actually looking for.
 */
export const workflowVersions = pgTable(
  "workflow_version",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workflowId: text("workflowId")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    ownerId: text("ownerId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * The workspace this version belongs to — Phase 19A, and **the scoping column**.
     * Every query the product makes filters on it.
     *
     * It sits *alongside* `ownerId` rather than replacing it, because the two answer
     * different questions: this one answers *who may see this*, `ownerId` answers
     * *who made this happen*.
     */
    workspaceId: text("workspaceId")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    label: text("label"),
    name: text("name").notNull(),
    graph: jsonb("graph").$type<WorkflowGraph>().notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Unique, so a number that two saves somehow contended for cannot become two
    // versions with the same name. It is also the history list's only query — newest
    // first for one workflow — so the same index serves both.
    uniqueIndex("workflow_version_workflow_number_idx").on(table.workflowId, table.number),
  ],
);

/**
 * Third-party credentials, AES-256-GCM encrypted at rest with `ENCRYPTION_KEY`.
 * The table lands here because Phase 3 owns the schema; the encryption helpers and
 * the write-only API are Phase 6, which fills CONTRACT.md → "Credential storage
 * shape".
 *
 * `ciphertext`, `iv` and `authTag` are the envelope, stored base64. Nothing in this
 * row may ever be returned to a client in plaintext; `label` and `metadata` exist
 * so the UI can show that a credential exists without reading it.
 */
export const credentials = pgTable(
  "credential",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    ownerId: text("ownerId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * The workspace this credential belongs to — Phase 19A, and **the scoping column**.
     * Every query the product makes filters on it.
     *
     * It sits *alongside* `ownerId` rather than replacing it, because the two answer
     * different questions: this one answers *who may see this*, `ownerId` answers
     * *who made this happen*.
     */
    workspaceId: text("workspaceId")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    authTag: text("authTag").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * **One credential per `(workspace, kind, label)` — Phase 19A**, and the index the
     * upsert in `lib/credentials.ts` targets.
     *
     * It supersedes `credential_owner_kind_label_idx` above, which is dropped by
     * migration `0006` rather than by `0005`. Both exist in between on purpose: while
     * two revisions are serving, one writes `ownerId` and the other writes
     * `workspaceId`, and at that moment the two are in exact one-to-one
     * correspondence, so keeping both is the only state in which neither revision can
     * write a duplicate.
     *
     * **The old one must be gone before any user can hold a second workspace** (Phase
     * 19B), or storing the same kind of credential in two of their workspaces is
     * refused by an index that is measuring the wrong thing.
     */
    uniqueIndex("credential_workspace_kind_label_idx").on(
      table.workspaceId,
      table.kind,
      table.label,
    ),
  ],
);

export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type WorkspaceInvitation = typeof workspaceInvitations.$inferSelect;
export type Workflow = typeof workflows.$inferSelect;
export type WorkflowVersion = typeof workflowVersions.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type RunStep = typeof runSteps.$inferSelect;
export type Credential = typeof credentials.$inferSelect;
