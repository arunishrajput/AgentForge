import {
  apiErrorMessage,
  IntegrationError,
  type ReadBody,
  readBody,
  request,
  RETRY_STATUSES,
} from "./net";

/**
 * Notion — Phase 23B.
 *
 * **The API version is pinned, and which version is a real decision rather than a default.**
 * Notion requires a `Notion-Version` header on every request and changes behaviour between
 * versions. `2025-09-03` introduced *data sources*: a database may hold several, and its
 * upgrade guide is explicit that `parent: { database_id }` is "no longer accepted" when
 * creating a page, replaced by `parent: { type: "data_source_id", data_source_id }`
 * (developers.notion.com → *Upgrade guide 2025-09-03*, read 2026-10-01).
 *
 * This module pins `2025-09-03` because it is the version whose shapes were read rather than
 * recalled. Pinning the newest available version instead would have been a guess about a
 * changelog nobody here has opened, and pinning the older `2022-06-28` would have bought
 * simplicity by depending on a deprecated parent shape. **Upgrading it is a deliberate act:**
 * change the constant, read that version's guide, and re-run `verify-integrations.mjs`.
 *
 * The cost of the modern shape is one extra GET per database write, because the user can only
 * copy a *database* id out of a Notion URL and the API wants a *data source* id. Paid on
 * purpose: the alternative is asking a user to fetch an id the interface never shows them.
 */

export const NOTION_CREDENTIAL_KIND = "integration.notion";

/** See the note above before changing this. */
export const NOTION_VERSION = "2025-09-03";

const API = "https://api.notion.com/v1";
const TIMEOUT_MS = 15_000;

/** Notion caps a single rich-text content string at 2000 characters. */
export const NOTION_TEXT_LIMIT = 2000;

function headers(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "notion-version": NOTION_VERSION,
    "content-type": "application/json",
  };
}

const DASHED_UUID = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
const BARE_ID = /^[0-9a-fA-F]{32}$/;

/**
 * A page or database id, from anything a user can actually copy.
 *
 * Notion's own URLs carry the id as 32 undashed hex characters after a slug made from the
 * page's title (`…/My-Tasks-1f2e3d…?v=…`), and the API accepts it either dashed or undashed.
 *
 * **Two traps, and the second one bites silently.**
 *
 * The first is the `?v=` view id: a database URL carries a *second* 32-hex id in its query
 * string, so the query has to go before anything is matched or the node addresses a view and
 * gets a 404 that reads like a permissions problem.
 *
 * The second is subtler and the first version of this function had it. Stripping every `-` to
 * cope with a dashed uuid also glues the slug to the id — and `a`–`f` are letters, so a page
 * called "Cafe", "Decade" or "Facade" ends in characters a hex match will happily eat. A
 * 32-character window starting one letter early consumes the `e` of "Cafe" and drops the id's
 * last digit, producing a well-formed id for a page that does not exist. Nothing about that
 * failure points at the parser.
 *
 * So the slug is separated *structurally* rather than by pattern: the `-` between the title
 * and the id is what Notion puts there, and splitting on it is what makes the last piece the
 * id. Dashes are never stripped globally.
 */
export function normaliseId(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new IntegrationError("No Notion page or database id was given.");
  }

  // The query string first, so a `?v=` view id can never win.
  const withoutQuery = trimmed.split("?")[0] ?? trimmed;

  // A dashed uuid is already unambiguous wherever it appears.
  const dashed = DASHED_UUID.exec(withoutQuery);
  if (dashed) return dash(dashed[0].replace(/-/g, ""));

  // Otherwise the id is the last dash-separated piece of the last path segment.
  const segment = withoutQuery.replace(/\/+$/, "").split("/").pop() ?? "";
  const candidate = segment.split("-").pop() ?? "";
  if (BARE_ID.test(candidate)) return dash(candidate);

  throw new IntegrationError(
    `"${trimmed.slice(0, 80)}" does not contain a Notion id. Copy the page or database link from Notion, or paste its 32-character id.`,
  );
}

function dash(id: string): string {
  const lower = id.toLowerCase();
  return `${lower.slice(0, 8)}-${lower.slice(8, 12)}-${lower.slice(12, 16)}-${lower.slice(16, 20)}-${lower.slice(20)}`;
}

export interface NotionIdentity {
  /** The integration's own name in Notion. */
  botName: string | null;
  /** The workspace it was installed into, when Notion reports one. */
  workspaceName: string | null;
}

/**
 * Prove the token, and learn which workspace it belongs to.
 *
 * `GET /users/me` needs no capability beyond existing, so it works for a freshly created
 * internal integration that has not yet been connected to a single page — which is the state
 * a user is in when they paste the token, and a verification that required a shared page
 * would refuse a perfectly good credential.
 */
export async function verifyToken(token: string, signal?: AbortSignal): Promise<NotionIdentity> {
  const response = await request(`${API}/users/me`, {
    headers: headers(token),
    timeoutMs: TIMEOUT_MS,
    ...(signal ? { signal } : {}),
    retry: { attempts: 2, on: RETRY_STATUSES, onTransportError: true },
  });

  const body = await readBody(response);
  if (!response.ok) throw notionError(body, response.status, "verify that token");

  const json = (body.json ?? {}) as {
    name?: unknown;
    bot?: { workspace_name?: unknown } | null;
  };

  return {
    botName: typeof json.name === "string" ? json.name : null,
    workspaceName:
      typeof json.bot?.workspace_name === "string" ? json.bot.workspace_name : null,
  };
}

/**
 * The data source behind a database id — the extra hop `2025-09-03` requires.
 *
 * Takes the first entry, and the upgrade guide says why that is correct rather than lazy:
 * "for existing single-source databases, there will only be one entry in this array". A
 * database somebody has deliberately given several data sources is out of scope here, and
 * saying so is better than silently writing to whichever one came back first — so a
 * multi-source database is reported rather than guessed at.
 */
export async function dataSourceFor(
  token: string,
  databaseId: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await request(`${API}/databases/${databaseId}`, {
    headers: headers(token),
    timeoutMs: TIMEOUT_MS,
    ...(signal ? { signal } : {}),
    retry: { attempts: 2, on: RETRY_STATUSES, onTransportError: true },
  });

  const body = await readBody(response);
  if (!response.ok) throw notionError(body, response.status, "open that database");

  const sources = (body.json as { data_sources?: { id?: unknown; name?: unknown }[] } | null)
    ?.data_sources;

  if (!Array.isArray(sources) || sources.length === 0) {
    throw new IntegrationError(
      "That Notion database reports no data sources, so there is nowhere to add a row. Check that it is a database rather than a page.",
    );
  }
  if (sources.length > 1) {
    throw new IntegrationError(
      `That Notion database has ${sources.length} data sources. This node writes to a single-source database; pick one that has only one.`,
    );
  }

  const id = sources[0]?.id;
  if (typeof id !== "string" || id.length === 0) {
    throw new IntegrationError("Notion returned a data source with no id.");
  }
  return id;
}

/** Notion's paragraph block, which is the only block shape this integration writes. */
function paragraph(text: string) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: [{ type: "text", text: { content: text } }] },
  };
}

/**
 * Split a body into Notion-sized paragraphs.
 *
 * Two splits, in order: on blank lines, because that is what a person means by a paragraph,
 * and then on `NOTION_TEXT_LIMIT`, because Notion rejects a rich-text content string longer
 * than that. Splitting only on the limit would turn a formatted note into one wall of text;
 * not splitting on the limit at all would 400 on a long one.
 */
export function toParagraphs(body: string): string[] {
  const blocks: string[] = [];
  for (const chunk of body.split(/\n\s*\n/)) {
    const text = chunk.trim();
    if (text.length === 0) continue;
    for (let at = 0; at < text.length; at += NOTION_TEXT_LIMIT) {
      blocks.push(text.slice(at, at + NOTION_TEXT_LIMIT));
    }
  }
  return blocks;
}

export interface NotionPageResult {
  pageId: string;
  /** Notion's own link to it, when the response carries one. */
  url: string | null;
  blocks: number;
}

/**
 * Append paragraphs to the end of an existing page.
 *
 * The version-stable half of this integration: a page id, a `PATCH`, and no database schema
 * anywhere near it. Not retried on a transport error — appending twice would duplicate the
 * text in somebody's document.
 */
export async function appendParagraphs(
  token: string,
  options: { pageId: string; body: string; signal?: AbortSignal },
): Promise<NotionPageResult> {
  const children = toParagraphs(options.body);
  if (children.length === 0) {
    throw new IntegrationError("There is no text to append to that Notion page.");
  }

  const response = await request(`${API}/blocks/${options.pageId}/children`, {
    method: "PATCH",
    headers: headers(token),
    body: JSON.stringify({ children: children.map(paragraph) }),
    timeoutMs: TIMEOUT_MS,
    ...(options.signal ? { signal: options.signal } : {}),
    retry: { attempts: 2, on: RETRY_STATUSES },
  });

  const body = await readBody(response);
  if (!response.ok) throw notionError(body, response.status, "append to that page");

  return { pageId: options.pageId, url: null, blocks: children.length };
}

/**
 * Create a page in a database — "add a row".
 *
 * **Title and body only, and that is a stated limitation rather than an oversight.** Writing
 * an arbitrary property means knowing its type: a `select` takes `{ name }`, a `number` takes
 * a number, a `date` takes `{ start }`, and getting it wrong is a 400 from inside a run. Doing
 * it properly means fetching the data source schema and mapping per property type, which is
 * a phase of its own — so this writes the one property every database has, and the node's
 * `docs` says to use `integration.http` for the rest.
 *
 * `titleProperty` is configurable because it is the one thing that genuinely varies: Notion
 * calls it `Name` in a new database and users rename it freely.
 */
export async function createDatabasePage(
  token: string,
  options: {
    dataSourceId: string;
    title: string;
    titleProperty: string;
    body: string;
    signal?: AbortSignal;
  },
): Promise<NotionPageResult> {
  const children = toParagraphs(options.body);

  const response = await request(`${API}/pages`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({
      parent: { type: "data_source_id", data_source_id: options.dataSourceId },
      properties: {
        [options.titleProperty]: {
          title: [{ type: "text", text: { content: options.title } }],
        },
      },
      ...(children.length > 0 ? { children: children.map(paragraph) } : {}),
    }),
    timeoutMs: TIMEOUT_MS,
    ...(options.signal ? { signal: options.signal } : {}),
    retry: { attempts: 2, on: RETRY_STATUSES },
  });

  const body = await readBody(response);
  if (!response.ok) throw notionError(body, response.status, "add a row to that database");

  const json = (body.json ?? {}) as { id?: unknown; url?: unknown };
  if (typeof json.id !== "string") {
    throw new IntegrationError("Notion created the page but returned no id for it.");
  }

  return {
    pageId: json.id,
    url: typeof json.url === "string" ? json.url : null,
    blocks: children.length,
  };
}

/**
 * Notion's own words, plus the one piece of advice its messages never contain.
 *
 * A 404 from Notion almost always means "the integration is not connected to this page"
 * rather than "this page does not exist" — the API deliberately cannot see anything that has
 * not been shared with it, and it reports both cases identically. A user reading only
 * Notion's text goes looking for a deleted page; the sentence added here is the thing that
 * actually fixes it.
 */
function notionError(
  body: ReadBody,
  status: number,
  attempt: string,
): IntegrationError {
  const message = apiErrorMessage(body, `HTTP ${status}`);
  if (status === 404) {
    return new IntegrationError(
      `Notion could not ${attempt}: ${message}. A Notion integration can only see what has been shared with it — open the page in Notion, then “…” → Connections → connect it.`,
      status,
    );
  }
  if (status === 401) {
    return new IntegrationError(`Notion rejected the token: ${message}.`, status);
  }
  return new IntegrationError(`Notion could not ${attempt}: ${message}.`, status);
}
