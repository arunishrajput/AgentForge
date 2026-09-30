import {
  apiErrorMessage,
  IntegrationError,
  type ReadBody,
  readBody,
  request,
  RETRY_STATUSES,
} from "./net";

/**
 * Airtable — Phase 23B.
 *
 * The only one of this phase's four integrations that **reads** as well as writes, which is
 * why it is the one that has to obey Phase 23A's list convention: a node returning a list
 * returns `{ items, count }`, so `integration.airtable` in list mode chains straight into
 * `transform.filter` and `transform.sort` with nothing between them (`CONTRACT.md` → *Node
 * definition interface*).
 *
 * **The token's own scopes and base selection are the boundary.** An Airtable personal access
 * token is minted against selected bases with selected scopes, so `data.records:read` without
 * `data.records:write` makes this node genuinely read-only no matter what its config says —
 * which is a property worth knowing about, and the node's `docs` tells the user they can have
 * it.
 */

export const AIRTABLE_CREDENTIAL_KIND = "integration.airtable";

const API = "https://api.airtable.com/v0";
const TIMEOUT_MS = 15_000;

/**
 * **AgentForge's cap on one create call.** Airtable's own documentation for the endpoint does
 * not state a maximum (read 2026-10-01), so this is not a quoted limit — it is a bound chosen
 * to keep one node call to one HTTP request, which is what makes the failure legible when
 * something is rejected.
 */
export const AIRTABLE_MAX_CREATE = 10;

/** A cap on a read, for the same reason `net.ts` caps a response body. */
export const AIRTABLE_MAX_READ = 100;

/** Airtable base ids are `app` followed by an opaque id. */
const BASE_PATTERN = /^app[A-Za-z0-9]{10,20}$/;

function headers(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

export function normaliseBaseId(raw: string): string {
  const trimmed = raw.trim();
  // A pasted URL is the common mistake: https://airtable.com/appXXXX/tblYYYY/viwZZZZ
  const fromUrl = /\/(app[A-Za-z0-9]{10,20})(?:\/|$)/.exec(trimmed);
  const candidate = fromUrl?.[1] ?? trimmed;

  if (!BASE_PATTERN.test(candidate)) {
    throw new IntegrationError(
      `"${trimmed.slice(0, 80)}" is not an Airtable base id. It starts with "app" and you can copy it from the base's URL.`,
    );
  }
  return candidate;
}

/**
 * The table's path segment.
 *
 * Airtable accepts either a table id (`tbl…`) or its **name**, and a name is what a user can
 * actually see in the interface — so a name has to work, and a name can contain spaces,
 * slashes and question marks. Encoded here rather than at the call site: a table called
 * `Q3/Q4 plan` interpolated raw would address a different path entirely.
 */
function tableSegment(table: string): string {
  const trimmed = table.trim();
  if (trimmed.length === 0) {
    throw new IntegrationError("No Airtable table was given.");
  }
  return encodeURIComponent(trimmed);
}

export interface AirtableIdentity {
  userId: string;
  /** Only present when the token carries `user.email:read`. */
  email: string | null;
}

/**
 * Prove the token. `GET /meta/whoami` requires **no scopes at all** (Airtable's own docs,
 * read 2026-10-01), so it verifies a minimally scoped token rather than demanding a
 * permission the product does not need.
 */
export async function verifyToken(token: string, signal?: AbortSignal): Promise<AirtableIdentity> {
  const response = await request(`${API}/meta/whoami`, {
    headers: headers(token),
    timeoutMs: TIMEOUT_MS,
    ...(signal ? { signal } : {}),
    retry: { attempts: 2, on: RETRY_STATUSES, onTransportError: true },
  });

  const body = await readBody(response);
  if (!response.ok) throw airtableError(body, response.status, "check that token");

  const json = (body.json ?? {}) as { id?: unknown; email?: unknown };
  if (typeof json.id !== "string") {
    throw new IntegrationError("Airtable accepted the token but returned no user id.");
  }
  return {
    userId: json.id,
    email: typeof json.email === "string" ? json.email : null,
  };
}

export interface AirtableRecord {
  id: string;
  createdTime: string | null;
  fields: Record<string, unknown>;
}

/**
 * Create one or more records.
 *
 * `typecast` is offered and defaults on at the node, because without it a value Airtable has
 * to coerce — a date written as text, a new option for a single-select — is rejected rather
 * than converted, and every one of those is a value that arrived from a webhook or a model as
 * a string.
 *
 * Not retried on a transport error: duplicate rows in somebody's base.
 */
export async function createRecords(
  token: string,
  options: {
    baseId: string;
    table: string;
    records: Record<string, unknown>[];
    typecast: boolean;
    signal?: AbortSignal;
  },
): Promise<AirtableRecord[]> {
  if (options.records.length === 0) {
    throw new IntegrationError("There are no fields to write to Airtable.");
  }
  if (options.records.length > AIRTABLE_MAX_CREATE) {
    throw new IntegrationError(
      `This node writes at most ${AIRTABLE_MAX_CREATE} records in one call; it was given ${options.records.length}.`,
    );
  }

  const response = await request(
    `${API}/${options.baseId}/${tableSegment(options.table)}`,
    {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({
        records: options.records.map((fields) => ({ fields })),
        typecast: options.typecast,
      }),
      timeoutMs: TIMEOUT_MS,
      ...(options.signal ? { signal: options.signal } : {}),
      retry: { attempts: 2, on: RETRY_STATUSES },
    },
  );

  const body = await readBody(response);
  if (!response.ok) {
    throw airtableError(body, response.status, `write to ${options.table}`);
  }

  return readRecords(body.json);
}

/**
 * List records. One page, deliberately: following `offset` until Airtable runs out would let
 * one node call spend an unbounded number of requests and land an unbounded `jsonb` in Neon,
 * and `maxRecords` is the honest way to say how much a workflow wants.
 */
export async function listRecords(
  token: string,
  options: {
    baseId: string;
    table: string;
    maxRecords: number;
    view?: string;
    signal?: AbortSignal;
  },
): Promise<AirtableRecord[]> {
  const query = new URLSearchParams({
    maxRecords: String(Math.min(Math.max(1, options.maxRecords), AIRTABLE_MAX_READ)),
  });
  if (options.view && options.view.trim().length > 0) query.set("view", options.view.trim());

  const response = await request(
    `${API}/${options.baseId}/${tableSegment(options.table)}?${query.toString()}`,
    {
      headers: headers(token),
      timeoutMs: TIMEOUT_MS,
      ...(options.signal ? { signal: options.signal } : {}),
      // A GET creates nothing, so repeating it is safe.
      retry: { attempts: 2, on: RETRY_STATUSES, onTransportError: true },
    },
  );

  const body = await readBody(response);
  if (!response.ok) {
    throw airtableError(body, response.status, `read ${options.table}`);
  }

  return readRecords(body.json);
}

function readRecords(json: unknown): AirtableRecord[] {
  const records = (json as { records?: unknown } | null)?.records;
  if (!Array.isArray(records)) {
    throw new IntegrationError("Airtable answered without a records array.");
  }

  return records.map((entry) => {
    const record = (entry ?? {}) as {
      id?: unknown;
      createdTime?: unknown;
      fields?: unknown;
    };
    return {
      id: typeof record.id === "string" ? record.id : "",
      createdTime: typeof record.createdTime === "string" ? record.createdTime : null,
      fields:
        record.fields && typeof record.fields === "object"
          ? (record.fields as Record<string, unknown>)
          : {},
    };
  });
}

/**
 * Airtable's own words, plus the advice its messages omit.
 *
 * `NOT_FOUND` and `INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND` are the two answers a user cannot
 * act on unaided: both mean "either the name is wrong or this token was not given that base",
 * and the token's *scopes* are a third possibility the message never mentions. Saying all
 * three is the difference between a fixable error and a mysterious one.
 */
function airtableError(
  body: ReadBody,
  status: number,
  attempt: string,
): IntegrationError {
  const message = apiErrorMessage(body, `HTTP ${status}`);

  if (status === 401) {
    return new IntegrationError(`Airtable rejected the token: ${message}.`, status);
  }
  if (status === 403 || status === 404) {
    return new IntegrationError(
      `Airtable could not ${attempt}: ${message}. Check the base id and the exact table name, and that the token was given access to that base with the data.records scopes it needs.`,
      status,
    );
  }
  if (status === 422) {
    return new IntegrationError(
      `Airtable refused the data: ${message}. A field name must match the column exactly, including its capitals.`,
      status,
    );
  }
  return new IntegrationError(`Airtable could not ${attempt}: ${message}.`, status);
}
