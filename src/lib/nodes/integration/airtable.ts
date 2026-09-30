import { z } from "zod";

import {
  AIRTABLE_MAX_READ,
  createRecords,
  listRecords,
  normaliseBaseId,
} from "@/lib/integrations/airtable";
import { readTokenSecret } from "@/lib/integrations/store";
import { tokenIntegrationBySlug } from "@/lib/integrations/tokens";

import { defineNode, NodeError } from "../types";
import { asNodeError, jsonRecord } from "./shared";

const airtable = tokenIntegrationBySlug("airtable")!;

/**
 * Add a record to Airtable, or read a page of them.
 *
 * **The one integration in this phase that reads**, which means it owes Phase 23A's list
 * convention: `listRecords` returns `{ items, count }`, so it chains straight into
 * `transform.filter`, `transform.sort` and `transform.aggregate` with nothing between them
 * (`CONTRACT.md` → *Node definition interface*). `items` is the records' `fields` with `id` and
 * `createdTime` folded in, rather than Airtable's envelope, because a filter reading
 * `fields.Status` through a wrapper is the sort of papercut that makes a chain not work.
 *
 * **Agent-callable, bounded by the token's base selection and scopes.** A token granted only
 * `data.records:read` makes this node read-only however it is configured, which is a property
 * the user can choose and the docs point at.
 */
export const airtableNode = defineNode({
  type: "integration.airtable",
  label: "Airtable record",
  description:
    "Reads or writes Airtable records using the workspace's connected token. Operation \"createRecord\" adds one row from the fields given; \"listRecords\" returns a page of rows as items. Give baseId (it starts with app) and the exact table name. It can only reach the bases the stored token was granted.",
  kind: "action",
  category: "integration",
  outputs: [{ key: null, label: "Out" }],
  outputShape:
    "After createRecord: { operation, recordId, fields: the row as Airtable stored it }. After listRecords: { operation, items: one object per row with its id, createdTime and fields, count }.",
  agentCallable: true,
  docs: {
    summary:
      "Uses an Airtable base as a workflow's memory — write a row when something happens, or read a page of rows to work through. In list mode it returns items and count like every other list node, so a filter or a sort can follow it directly with nothing in between.",
    accepts:
      "Nothing in particular. In createRecord mode the fields object is what gets written, and every key must match an Airtable column name exactly, capitals included.",
    examples: [
      {
        title: "Log a webhook into a base",
        body: "operation: createRecord · fields: { \"Name\": \"{{trigger.name}}\", \"Email\": \"{{trigger.email}}\" }",
      },
      {
        title: "Read rows, then narrow them",
        body: "operation: listRecords · maxRecords: 50, then a Filter node on field \"fields.Status\"",
      },
    ],
  },
  configSchema: z.object({
    operation: z.enum(["createRecord", "listRecords"]).default("createRecord"),
    /** Empty is allowed for the same reason `integration.sheets` allows an empty id. */
    baseId: z.string().trim().max(200).default(""),
    table: z.string().trim().max(200).default(""),
    /**
     * `jsonRecord` rather than a plain object, and the reason is the agent: Gemini's schema
     * subset cannot express an open-ended object, so the model sends one as a JSON string.
     * Accepting both makes its first attempt work — see `./shared.ts`.
     */
    fields: jsonRecord(
      "The row's cells, as a JSON object of column name to value. Column names must match Airtable exactly.",
    ),
    /** Only read by `listRecords`. */
    maxRecords: z.number().int().min(1).max(AIRTABLE_MAX_READ).default(20),
    /** Airtable applies the view's own filters and sort order. Optional. */
    view: z.string().trim().max(200).default(""),
    /**
     * On by default, because most values reaching this node came from a webhook or a model as
     * a string, and without typecast Airtable rejects a date or a new select option rather
     * than converting it.
     */
    typecast: z.boolean().default(true),
  }),
  async execute({ config, context }) {
    if (config.baseId.length === 0 || config.table.length === 0) {
      throw new NodeError(
        "This node has no base or table yet. Open it and give it the base id and the exact table name.",
      );
    }

    try {
      const baseId = normaliseBaseId(config.baseId);

      const token = await readTokenSecret(context.scope, airtable, {
        runId: context.runId,
        nodeId: context.nodeId,
        nodeType: context.nodeType,
        purpose: config.operation,
      });

      if (config.operation === "listRecords") {
        const records = await listRecords(token, {
          baseId,
          table: config.table,
          maxRecords: config.maxRecords,
          ...(config.view.length > 0 ? { view: config.view } : {}),
          ...(context.signal ? { signal: context.signal } : {}),
        });

        context.log(`Read ${records.length} record(s) from ${config.table}.`);

        return {
          output: {
            operation: config.operation,
            items: records.map((record) => ({
              id: record.id,
              createdTime: record.createdTime,
              fields: record.fields,
            })),
            count: records.length,
          },
        };
      }

      if (Object.keys(config.fields).length === 0) {
        throw new NodeError(
          "There are no fields to write. Open the node and give it at least one column and value.",
        );
      }

      const [record] = await createRecords(token, {
        baseId,
        table: config.table,
        records: [config.fields],
        typecast: config.typecast,
        ...(context.signal ? { signal: context.signal } : {}),
      });

      if (!record) {
        throw new NodeError("Airtable accepted the write but returned no record.");
      }

      context.log(`Created ${record.id} in ${config.table}.`);

      return {
        output: {
          operation: config.operation,
          recordId: record.id,
          fields: record.fields,
        },
      };
    } catch (error) {
      throw asNodeError(error);
    }
  },
});
