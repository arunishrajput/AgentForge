import { sql } from "drizzle-orm";
import {
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

import type { RunStatus, StepStatus, TriggerKind } from "@/lib/engine/types";
import type { StepLog } from "@/lib/nodes/types";
import type { WorkflowGraph } from "@/lib/workflow/graph";

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
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("workflow_owner_idx").on(table.ownerId, table.updatedAt),
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
 * `heartbeatAt` is what makes an interrupted run observable. Execution is
 * in-process, so a Cloud Run redeploy kills a run mid-flight; nothing would ever
 * move it out of `running`. `reapStaleRuns` fails anything whose heartbeat has
 * gone quiet (ARCHITECTURE.md → "Execution engine design").
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
    status: text("status").$type<RunStatus>().notNull(),
    trigger: text("trigger").$type<TriggerKind>().notNull(),
    input: jsonb("input"),
    output: jsonb("output"),
    error: text("error"),
    startedAt: timestamp("startedAt", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finishedAt", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeatAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("run_owner_idx").on(table.ownerId, table.startedAt),
    index("run_workflow_idx").on(table.workflowId, table.startedAt),
    index("run_status_idx").on(table.status, table.heartbeatAt),
  ],
);

/**
 * `config` is a snapshot of what the step actually ran with, after template
 * resolution. There is no workflow versioning, so without the snapshot run history
 * becomes misleading the first time the workflow is edited.
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
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    authTag: text("authTag").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("credential_owner_kind_label_idx").on(table.ownerId, table.kind, table.label)],
);

export type Workflow = typeof workflows.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type RunStep = typeof runSteps.$inferSelect;
export type Credential = typeof credentials.$inferSelect;
