import { apiErrorMessage, IntegrationError, readBody, request } from "./net";

/**
 * Google Sheets — append one row.
 *
 * Verified against the live discovery document (`sheets.googleapis.com/$discovery/
 * rest?version=v4`) rather than from memory, because two details here are easy to get
 * plausibly wrong and only fail at runtime:
 *
 *  • `ValueRange.values` is an **array of arrays** — rows, then cells. A flat array is
 *    accepted by the type system and writes one value per *row*, turning a five-field
 *    row into five rows in column A.
 *  • `range` is a **path** parameter, not a query one, and for an append it names the
 *    table to search rather than the cell to write. A sheet name is the whole of it.
 */

const SHEETS_ENDPOINT = "https://sheets.googleapis.com/v4/spreadsheets";

export type ValueInputOption = "RAW" | "USER_ENTERED";

export interface AppendRowOptions {
  accessToken: string;
  spreadsheetId: string;
  /** A sheet name, or any A1 range inside it. `Sheet1` is the common case. */
  range: string;
  /** One row. Cells are sent in order. */
  values: (string | number | boolean)[];
  valueInputOption?: ValueInputOption;
  signal?: AbortSignal;
}

export interface AppendRowResult {
  spreadsheetId: string;
  /** The range the row actually landed in, e.g. `Sheet1!A7:E7`. */
  updatedRange: string | null;
  updatedRows: number;
  updatedCells: number;
}

/**
 * A spreadsheet id, from an id or from a pasted browser URL.
 *
 * Accepting the URL is not sloppiness: the id is a 44-character opaque string that
 * nobody types, so every real user pastes the address bar. Silently storing a URL as
 * an id produces a 404 from inside a run.
 */
export function spreadsheetIdFrom(raw: string): string {
  const trimmed = raw.trim();
  const fromUrl = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const id = fromUrl ? fromUrl[1] : trimmed;
  if (!/^[a-zA-Z0-9-_]{10,}$/.test(id)) {
    throw new IntegrationError(
      `"${raw}" is not a spreadsheet id. Paste the sheet's URL, or the id from between /d/ and /edit in it.`,
    );
  }
  return id;
}

export async function appendRow(options: AppendRowOptions): Promise<AppendRowResult> {
  const spreadsheetId = spreadsheetIdFrom(options.spreadsheetId);
  const range = options.range.trim() || "Sheet1";

  const url = new URL(
    `${SHEETS_ENDPOINT}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append`,
  );
  url.searchParams.set("valueInputOption", options.valueInputOption ?? "USER_ENTERED");
  url.searchParams.set("insertDataOption", "INSERT_ROWS");
  url.searchParams.set("includeValuesInResponse", "false");

  const response = await request(url.toString(), {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.accessToken}`,
      "content-type": "application/json",
    },
    // One row. The nesting is the contract, not a style choice — see the note above.
    body: JSON.stringify({ values: [options.values] }),
    timeoutMs: 20_000,
    signal: options.signal,
  });

  const body = await readBody(response);
  if (!response.ok) {
    throw new IntegrationError(
      `Google Sheets refused the append: ${apiErrorMessage(body, `HTTP ${response.status}`)}`,
      response.status,
    );
  }

  const json = (body.json ?? {}) as Record<string, unknown>;
  const updates = (json.updates ?? {}) as Record<string, unknown>;
  return {
    spreadsheetId,
    updatedRange: typeof updates.updatedRange === "string" ? updates.updatedRange : null,
    updatedRows: typeof updates.updatedRows === "number" ? updates.updatedRows : 0,
    updatedCells: typeof updates.updatedCells === "number" ? updates.updatedCells : 0,
  };
}
