import { z } from "zod";

import {
  POSTGRES_DEFAULT_TIMEOUT_MS,
  POSTGRES_MAX_ROWS,
  POSTGRES_MAX_TIMEOUT_MS,
  runSelect,
} from "@/lib/integrations/postgres";
import { readTokenSecret } from "@/lib/integrations/store";
import { tokenIntegrationBySlug } from "@/lib/integrations/tokens";

import { operators } from "../core/branch";
import { defineNode, NodeError } from "../types";
import { asNodeError } from "./shared";

const postgresIntegration = tokenIntegrationBySlug("postgres")!;

/**
 * Read rows from the workspace's connected Postgres database.
 *
 * **Named for the server it speaks to, not for the category.** `integration.database` was the
 * first name and it was a promise this node does not keep: it talks the Postgres wire protocol
 * and nothing else, so a MySQL node later would either have to be bolted inside it or make the
 * generic name a lie. The credential registry's own test caught it — every credential kind there
 * matches `integration.<service>`, which is 23B's pattern of the kind naming the node that
 * needs it, and `db.postgres` did not fit. One service, one node, one credential kind, the same
 * shape as Slack and Airtable.
 *
 * **Read-only by construction, and "by construction" is meant literally.** There is no query
 * field. A caller supplies a table, some column names, an enumerated comparison and a limit,
 * and this node assembles the only statement it knows how to write — a `select`. Phase 23A's
 * rule is the reason: a config field that accepted SQL would be arbitrary code execution
 * wearing a different hat, and no amount of validating a string gets that back. So the node is
 * less capable than a SQL console on purpose, and the capability it gives up is the one this
 * product is not allowed to have.
 *
 * Three independent things have to fail before a write could happen: the absence of any
 * statement but `select`, the `BEGIN READ ONLY` every query runs inside, and the grants on the
 * role in the user's own connection string. The third is the only one outside this product's
 * control, which is exactly why the settings card tells the user to make it a `SELECT`-only
 * role — advice that costs them nothing and is worth more than the other two.
 *
 * **Agent-callable, and that is the same D19 argument the other integrations make rather than
 * a new one.** The server, the database and the privileges are fixed by the credential the user
 * created; the model chooses a table within them. `integration.gmail` is closed to the agent
 * because a sent mail reaches a third party and cannot be recalled — the test it failed. A read
 * of the user's own database leaves nothing and reaches nobody, so it passes the same test the
 * same way `integration.airtable` does with a read-only token.
 */
export const postgresNode = defineNode({
  type: "integration.postgres",
  label: "Postgres query",
  description:
    "Reads rows from the workspace's connected Postgres database. Give it schema (usually public), table, and optionally columns, a where list and an order. Operation \"select\" returns the matching rows as items; \"count\" returns only how many match, which is the one to use when the answer is a number. It can never write — every query runs in a read-only transaction. There is no SQL field; build the query from these parts.",
  kind: "action",
  category: "integration",
  outputs: [{ key: null, label: "Out" }],
  outputShape:
    "After select: { operation, table, items: one object per row keyed by column name, count: how many rows came back }. After count: { operation, table, items: [], count: the total number of matching rows }.",
  agentCallable: true,
  docs: {
    summary:
      "Reads from a Postgres database you have connected, and cannot write to it. Rows come back as items with the column names as keys, so a Filter, Sort or Aggregate node chains straight on. Use count when you want the total rather than the rows — it asks the server, so it is not capped by the limit.",
    accepts:
      "Nothing in particular. Everything it needs is in its own configuration, so it works as the first step after a trigger.",
    examples: [
      {
        title: "The ten largest cities",
        body: "table: city · orderBy: population · direction: desc · limit: 10",
      },
      {
        title: "Narrow it with a where list",
        body: 'where: [{ "column": "country", "operator": "equals", "value": "IN" }]',
      },
      {
        title: "How many rows match",
        body: 'operation: count · where: [{ "column": "notes", "operator": "is_not_empty" }]',
      },
    ],
  },
  configSchema: z.object({
    operation: z.enum(["select", "count"]).default("select"),
    /**
     * Always sent, and always qualifies the table. An unqualified name is resolved through
     * `search_path`, which a connection string can set — so "usually public" is a default
     * here rather than a thing the server decides later.
     */
    schema: z.string().trim().max(63).default("public"),
    /** Empty is allowed for the same reason `integration.airtable` allows an empty base id. */
    table: z.string().trim().max(63).default(""),
    /**
     * Empty means every column. Named columns are better for an agent — a `select *` on a wide
     * table spends a step's output on fields nothing reads — but guessing names it cannot see
     * is worse, so the default is honest rather than tidy.
     */
    columns: z
      .array(z.string().trim().max(63))
      .max(50)
      .default([])
      .describe("Column names to return. Leave empty for all of them."),
    /**
     * Conditions, combined with AND.
     *
     * An array of objects, which the inspector renders as a JSON field — the same control
     * `core.switch` gives its `cases`, and the `docs.examples` above carry a literal to copy.
     * The operators are **the seven `core.branch` and `transform.filter` use**, so somebody who
     * has configured a Filter node already knows this field. `is_empty` and `is_not_empty`
     * ignore `value`.
     */
    where: z
      .array(
        z.object({
          column: z.string().trim().max(63),
          operator: z.enum(operators).default("equals"),
          value: z.string().max(2000).default(""),
        }),
      )
      .max(10)
      .default([])
      .describe(
        'Conditions, all of which must hold. Each is { column, operator, value }, e.g. [{ "column": "country", "operator": "equals", "value": "IN" }].',
      ),
    orderBy: z.string().trim().max(63).default(""),
    direction: z.enum(["asc", "desc"]).default("asc"),
    limit: z.number().int().min(1).max(POSTGRES_MAX_ROWS).default(50),
    timeoutMs: z
      .number()
      .int()
      .min(1000)
      .max(POSTGRES_MAX_TIMEOUT_MS)
      .default(POSTGRES_DEFAULT_TIMEOUT_MS),
  }),
  async execute({ config, context }) {
    if (config.table.length === 0) {
      throw new NodeError(
        "This node has no table yet. Open it and give it the table name, and the schema if it is not public.",
      );
    }

    try {
      const secret = await readTokenSecret(context.scope, postgresIntegration, {
        runId: context.runId,
        nodeId: context.nodeId,
        nodeType: context.nodeType,
        purpose: config.operation,
      });

      const result = await runSelect(
        secret,
        {
          schema: config.schema.length > 0 ? config.schema : "public",
          table: config.table,
          columns: config.columns.filter((column) => column.length > 0),
          where: config.where.filter((condition) => condition.column.trim().length > 0),
          orderBy: config.orderBy,
          direction: config.direction,
          limit: config.limit,
          mode: config.operation === "count" ? "count" : "rows",
        },
        {
          timeoutMs: config.timeoutMs,
          ...(context.signal ? { signal: context.signal } : {}),
        },
      );

      context.log(
        config.operation === "count"
          ? `Counted ${result.count} row(s) in ${config.schema}.${config.table}.`
          : `Read ${result.count} row(s) from ${config.schema}.${config.table}.`,
      );

      return {
        output: {
          operation: config.operation,
          table: `${config.schema}.${config.table}`,
          items: result.items,
          count: result.count,
        },
      };
    } catch (error) {
      throw asNodeError(error);
    }
  },
});
