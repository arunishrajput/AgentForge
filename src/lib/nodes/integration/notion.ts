import { z } from "zod";

import {
  appendParagraphs,
  createDatabasePage,
  dataSourceFor,
  normaliseId,
} from "@/lib/integrations/notion";
import { readTokenSecret } from "@/lib/integrations/store";
import { tokenIntegrationBySlug } from "@/lib/integrations/tokens";

import { defineNode, NodeError } from "../types";
import { asNodeError } from "./shared";

const notion = tokenIntegrationBySlug("notion")!;

/**
 * Write to Notion — append to a page, or add a row to a database.
 *
 * **One node with an `operation` enum rather than two nodes**, following `transform.text` and
 * `transform.aggregate` from Phase 23A. The registry is rendered into the generation prompt on
 * every call, and the prompt has a budget the registry test enforces; two nodes per service
 * across four services would have spent it on near-duplicate descriptions.
 *
 * **Agent-callable, bounded by Notion's own connection model.** A Notion integration sees only
 * the pages and databases a human has explicitly connected to it, so a model that invents a
 * page id gets a 404 rather than somebody else's document. That is the same shape of bound as
 * `integration.sheets`, where a spreadsheet id in config is safe because the connected account
 * is the limit.
 */
export const notionNode = defineNode({
  type: "integration.notion",
  label: "Write to Notion",
  description:
    "Writes to Notion using the workspace's connected integration. With operation \"appendToPage\" it adds paragraphs to the end of an existing page; with \"addDatabaseRow\" it creates a new page in a database, which is what adding a row means in Notion. Give target as the page or database id, or paste its Notion link.",
  kind: "action",
  category: "integration",
  outputs: [{ key: null, label: "Out" }],
  outputShape:
    "{ operation, pageId: the page appended to or created, url: its Notion link when Notion returns one, blocks: how many paragraphs were written }.",
  agentCallable: true,
  docs: {
    summary:
      "Records something in Notion, either by adding paragraphs to the bottom of a page you already have or by creating a new page inside a database — which is how a Notion database gets a new row. Useful as the last step of a workflow that should leave a written trail somebody can read later.",
    accepts:
      "Nothing in particular; it writes the title and body you configure. Use `{{ }}` references to pull in text an earlier step produced.",
    examples: [
      {
        title: "Append a run's findings to a log page",
        body: "operation: appendToPage · target: the page link · body: \"{{steps.summarise.output.text}}\"",
      },
      {
        title: "Add a row to a task database",
        body: "operation: addDatabaseRow · target: the database link · title: \"{{trigger.subject}}\" · titleProperty: Name",
      },
    ],
  },
  effect: { does: "write to a Notion page or database" },
  configSchema: z.object({
    operation: z.enum(["appendToPage", "addDatabaseRow"]).default("appendToPage"),
    /**
     * Allowed to be **empty**, for the reason `integration.sheets` documents at length: a
     * request like "write it to Notion" names no page, and a model obeying a `min(1)` here
     * would either invent an id or fail the whole generation. Empty generates a visibly blank
     * field and an error that says what it needs.
     */
    target: z.string().trim().max(400).default(""),
    /** The row's title. Only read by `addDatabaseRow`. */
    title: z.string().trim().max(200).default(""),
    /**
     * Which property holds the title. Notion calls it `Name` in a new database and users
     * rename it freely, which makes it the one part of a database's schema this node has to
     * be told rather than assume.
     */
    titleProperty: z.string().trim().min(1).max(100).default("Name"),
    /** Paragraph text. Blank lines start a new Notion paragraph. */
    body: z.string().max(8000).default(""),
  }),
  async execute({ config, context }) {
    if (config.target.length === 0) {
      throw new NodeError(
        config.operation === "addDatabaseRow"
          ? "This node has no database yet. Open it and paste the Notion database's link or id."
          : "This node has no page yet. Open it and paste the Notion page's link or id.",
      );
    }
    if (config.operation === "addDatabaseRow" && config.title.length === 0) {
      throw new NodeError("A Notion row needs a title. Open the node and give it one.");
    }
    if (config.operation === "appendToPage" && config.body.trim().length === 0) {
      throw new NodeError("There is nothing to append. Open the node and write the body text.");
    }

    try {
      const token = await readTokenSecret(context.scope, notion, {
        runId: context.runId,
        nodeId: context.nodeId,
        nodeType: context.nodeType,
        purpose: config.operation,
      });

      const target = normaliseId(config.target);

      if (config.operation === "appendToPage") {
        const result = await appendParagraphs(token, {
          pageId: target,
          body: config.body,
          ...(context.signal ? { signal: context.signal } : {}),
        });
        context.log(`Appended ${result.blocks} paragraph(s) to the Notion page.`);
        return { output: { operation: config.operation, ...result } };
      }

      // The extra hop the 2025-09-03 API requires — see `lib/integrations/notion.ts`.
      const dataSourceId = await dataSourceFor(token, target, context.signal);
      const result = await createDatabasePage(token, {
        dataSourceId,
        title: config.title,
        titleProperty: config.titleProperty,
        body: config.body,
        ...(context.signal ? { signal: context.signal } : {}),
      });

      context.log(
        `Created a Notion page titled “${config.title}”${result.blocks > 0 ? ` with ${result.blocks} paragraph(s)` : ""}.`,
      );

      return { output: { operation: config.operation, ...result } };
    } catch (error) {
      throw asNodeError(error);
    }
  },
});
