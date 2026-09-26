import { z } from "zod";

import { SHEETS_SCOPE } from "@/lib/integrations/google";
import { appendRow } from "@/lib/integrations/sheets";
import { googleAccessToken } from "@/lib/integrations/store";

import { defineNode, NodeError } from "../types";
import { asNodeError, cellValue } from "./shared";

/**
 * Append a row to a Google Sheet.
 *
 * `DEMO.md` Beat 8's second payoff. Agent-callable: the connected Google account
 * bounds what it can reach, and a model must already hold a spreadsheet id to name
 * one — it cannot enumerate them, because the node only ever appends.
 *
 * `values` is one row, cell by cell. It renders as a raw JSON editor on the canvas —
 * the documented array fallback in `src/lib/canvas/schema.ts` — which is acceptable
 * here and a Phase 10 polish item, not a Phase 9 one.
 */
export const sheetsNode = defineNode({
  type: "integration.sheets",
  label: "Append to Google Sheet",
  description:
    "Appends one row to a Google Sheet using the user's connected Google account. Use it to record something the workflow produced. Give the spreadsheet id (or its URL), the sheet tab name, and the row's cells in order.",
  kind: "action",
  category: "integration",
  outputs: [{ key: null, label: "Out" }],
  outputShape:
    "{ appended: true, spreadsheetId, updatedRange: where the row landed e.g. Sheet1!A7:E7, updatedRows, values: the row that was written }.",
  agentCallable: true,
  configSchema: z.object({
    /**
     * An id or a pasted sheet URL; `spreadsheetIdFrom` accepts either.
     *
     * Deliberately allowed to be **empty**, which is not laxity. A request like "log
     * every one to my Google Sheet" (DEMO.md Beat 2) names no spreadsheet, so a model
     * obeying a `min(1)` here would either invent an id — a valid graph pointing at
     * somebody else's document — or fail the whole generation. Empty is the honest
     * third answer: the workflow generates, appears on the canvas with a visibly blank
     * field, and says exactly what it needs if it is run before being filled in.
     */
    spreadsheetId: z.string().trim().max(200).default(""),
    /** The tab name. Google's default first tab is `Sheet1`. */
    sheet: z.string().trim().max(200).default("Sheet1"),
    values: z.array(cellValue).min(1).max(50),
    /**
     * `USER_ENTERED` parses what a person typing it would get — a date becomes a
     * date, `=SUM(...)` becomes a formula. That last part is why `RAW` is offered:
     * a cell built from webhook text beginning with `=` would otherwise be stored
     * as a formula in the user's own spreadsheet.
     */
    valueInputOption: z.enum(["USER_ENTERED", "RAW"]).default("RAW"),
  }),
  async execute({ config, context }) {
    if (config.spreadsheetId.length === 0) {
      throw new NodeError(
        "This node has no spreadsheet yet. Open it and paste the Google Sheet's URL or id.",
      );
    }

    try {
      const accessToken = await googleAccessToken({
        ownerId: context.ownerId,
        requiredScopes: [SHEETS_SCOPE],
        capability: "edit your spreadsheets",
        signal: context.signal,
      });

      const result = await appendRow({
        accessToken,
        spreadsheetId: config.spreadsheetId,
        range: config.sheet,
        values: config.values,
        valueInputOption: config.valueInputOption,
        signal: context.signal,
      });

      context.log(
        `Appended ${config.values.length} cell(s) to ${result.updatedRange ?? config.sheet}.`,
      );

      return {
        output: {
          appended: true,
          spreadsheetId: result.spreadsheetId,
          updatedRange: result.updatedRange,
          updatedRows: result.updatedRows,
          values: config.values,
        },
      };
    } catch (error) {
      throw asNodeError(error);
    }
  },
});
