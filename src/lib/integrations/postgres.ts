import createPostgres from "postgres";

import type { Operator } from "@/lib/nodes/core/branch";

import { assertPublicTarget, HttpTargetError, type AddressResolver } from "./guard";
import { IntegrationError } from "./net";

/**
 * **Postgres, over the wire — Phase 23C.**
 *
 * Every other integration in this folder is JSON over HTTPS and goes out through `fetch`.
 * This one speaks a binary protocol over a TLS socket, and that difference is why the
 * phase was split out of 23B rather than shipped with it (`BUILD_PLAN.md` → *Phase
 * 23B/23C, the second split*). Three things follow from it, and all three are decisions
 * rather than details:
 *
 * ### 1. One new runtime dependency, and it is the first since Phase 4
 *
 * `@neondatabase/serverless` is already installed and speaks only to Neon's own endpoints,
 * so "any Postgres" and "no new dependency" were in genuine conflict — `ARCHITECTURE.md`
 * → *A24* records how it was resolved and what was weighed. `postgres@3.4.9` adds **one**
 * entry to the lockfile and **zero** transitive dependencies, which is the property that
 * decided it against `pg`'s six.
 *
 * ### 2. `guard.ts` is written for URLs, and a connection string is not one of its URLs
 *
 * The address classification is reused exactly — `assertPublicTarget` only ever reads
 * `url.hostname`, so it is already protocol-agnostic. What could not be reused is
 * `parseTarget`, which requires `https:` and **refuses credentials in the URL**. A
 * connection string is a URL whose whole point is to carry credentials. So the parsing is
 * separate and the classification is shared, which is the division the phase brief asked
 * for.
 *
 * The DNS-rebinding argument also lands differently, and more kindly. For the HTTP node the
 * mitigation is "require TLS, because the metadata server has no certificate" — the attack
 * there is a plain `GET` returning this service's own access token. Here the worst a
 * rebound private address can do is accept a Postgres startup packet; the metadata server
 * answers HTTP and would simply reject it. The residual risk is stated in `SECURITY.md`
 * rather than claimed away.
 *
 * ### 3. Read-only has to be enforced by the server, and the obvious way does not work
 *
 * **Measured, on 2026-10-01, against the real Neon endpoint this product uses:** setting
 * `default_transaction_read_only` as a startup parameter connected cleanly and then
 * **allowed a `CREATE TABLE`**. A PgBouncer-style pooler does not pass unknown startup
 * GUCs through, and it does not say so — which would have produced a node that *claimed*
 * read-only and was not. The mechanism that actually bites is a read-only **transaction**:
 * `BEGIN READ ONLY` answers `25006 cannot execute INSERT in a read-only transaction`, on
 * the pooled and the direct endpoint alike. That is what this file uses, and it is why
 * there is a test that asserts the statement is wrapped rather than merely that it selects.
 *
 * Read-only is therefore true at two independent layers: this transaction, and whatever
 * the user's own role grants. The node's documentation tells them to rely on the second,
 * because it is the one this product cannot weaken.
 */

export const POSTGRES_CREDENTIAL_KIND = "integration.postgres";

/** Hard ceiling on rows returned. They land in a step's JSONB and stream to the browser. */
export const POSTGRES_MAX_ROWS = 200;

/** Postgres truncates an identifier past this, so accepting a longer one would mislead. */
const MAX_IDENTIFIER_BYTES = 63;

const ALLOWED_SCHEMES = new Set(["postgres:", "postgresql:"]);

/** Refused by name, before any lookup — the same list `guard.ts` refuses for HTTP. */
const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata", "metadata.google.internal"]);
const BLOCKED_SUFFIXES = [".localhost", ".internal", ".local"];

/* ------------------------------------------------------------------ *
 * The connection string
 * ------------------------------------------------------------------ */

export interface PostgresTarget {
  url: URL;
  /** What `sslmode` resolved to. Never `disable` — that is refused at parse time. */
  ssl: "require" | "verify-full";
}

/**
 * Parse and refuse, before anything is stored or dialled.
 *
 * **TLS is not optional and `sslmode=disable` is a refusal rather than a silent upgrade.**
 * Quietly connecting anyway would be the friendlier-looking choice and the worse one: a user
 * who wrote `disable` has said something about their expectations, and a product that
 * overrides it without a word has lied to them. A user who asks for `verify-full` gets it.
 */
export function parseConnectionString(raw: string): PostgresTarget {
  const trimmed = raw.trim();

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new HttpTargetError(
      "That is not a Postgres connection string. It should look like postgresql://user:password@host:5432/database?sslmode=require.",
    );
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new HttpTargetError(
      `A connection string must start with postgres:// or postgresql://; got "${url.protocol}//".`,
    );
  }

  if (url.hostname.length === 0) {
    throw new HttpTargetError("That connection string names no host.");
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(host) || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new HttpTargetError(
      `"${url.hostname}" is not a public host. This product connects to databases reachable on the internet, not to anything on its own network.`,
    );
  }

  const database = url.pathname.replace(/^\//, "");
  if (database.length === 0) {
    throw new HttpTargetError(
      "That connection string names no database. Add it after the host, e.g. …@host:5432/mydb.",
    );
  }

  const sslmode = (url.searchParams.get("sslmode") ?? "require").toLowerCase();
  if (sslmode === "disable" || sslmode === "allow" || sslmode === "prefer") {
    throw new HttpTargetError(
      `sslmode=${sslmode} would let this connection run unencrypted across the public internet. Use sslmode=require, or sslmode=verify-full if your server presents a certificate a public CA signed.`,
    );
  }

  return {
    url,
    ssl: sslmode === "verify-full" || sslmode === "verify-ca" ? "verify-full" : "require",
  };
}

/** Parse, then refuse unless every address the host resolves to is public. */
export async function checkConnectionString(
  raw: string,
  resolve?: AddressResolver,
): Promise<PostgresTarget> {
  const target = parseConnectionString(raw);
  await assertPublicTarget(target.url, resolve);
  return target;
}

/* ------------------------------------------------------------------ *
 * Identifiers
 * ------------------------------------------------------------------ */

/**
 * Quote an identifier, having first refused the ones worth refusing.
 *
 * Both halves matter and neither is redundant. The quoting is what makes an accepted name
 * safe — `"a"; drop table b --"` is one quoted identifier Postgres looks up and does not
 * find, which is measured rather than assumed. The refusal is what makes the *error* legible,
 * and it removes the only character that could end the quoting early.
 *
 * No expression language, ever (Phase 23A's rule): a table name is a name, not a fragment of
 * SQL, and this is the function that holds that line.
 */
export function quoteIdentifier(raw: string, what = "name"): string {
  const name = raw.trim();

  if (name.length === 0) {
    throw new IntegrationError(`A ${what} cannot be empty.`);
  }
  if (name.includes('"')) {
    throw new IntegrationError(`A ${what} cannot contain a double quote: ${name}`);
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(name)) {
    throw new IntegrationError(`A ${what} cannot contain control characters.`);
  }
  if (Buffer.byteLength(name, "utf8") > MAX_IDENTIFIER_BYTES) {
    throw new IntegrationError(
      `A ${what} cannot be longer than ${MAX_IDENTIFIER_BYTES} bytes; Postgres would truncate it. Got ${name.length} characters.`,
    );
  }

  return `"${name}"`;
}

/* ------------------------------------------------------------------ *
 * The query, built from enumerated parts
 * ------------------------------------------------------------------ */

export interface PostgresCondition {
  column: string;
  operator: Operator;
  value?: string;
}

export interface SelectSpec {
  schema: string;
  table: string;
  columns: string[];
  where: PostgresCondition[];
  orderBy: string;
  direction: "asc" | "desc";
  limit: number;
  /** `count` asks the server for the total rather than fetching and counting here. */
  mode: "rows" | "count";
}

export interface BuiltQuery {
  text: string;
  params: string[];
}

/**
 * Every operator the shared vocabulary has, in SQL.
 *
 * **The same seven `core.branch` and `transform.filter` use**, because `transform.filter`'s
 * documentation already promises a reader that "the operators behave identically", and a
 * database node with its own private dialect would quietly make that false. Each mapping was
 * chosen to match `evaluate()`'s in-process semantics and then checked against a real server:
 *
 *   `equals`        `col::text = $n`                 — `evaluate` compares `String(left)`
 *                                                      to `String(right)`, so the cast is the
 *                                                      faithful translation, not a shortcut.
 *                                                      It makes `population = "254000"` match
 *   `not_equals`    `col::text is distinct from $n`   — plain `<>` is NULL for a NULL row, so
 *                                                      "not equals" would silently drop every
 *                                                      row with no value. `is distinct from`
 *                                                      answers true, which is what `!looseEquals`
 *                                                      does in process
 *   `contains`      `strpos(col::text, $n) > 0`       — exactly `String.includes`. `LIKE` would
 *                                                      need `%` and `_` escaped in the value;
 *                                                      `strpos` has no metacharacters at all
 *   `greater_than`  `col > $n`                        — the parameter is sent untyped, so the
 *   `less_than`     `col < $n`                          server compares using the **column's own**
 *                                                      type. Measured: this works on integer,
 *                                                      date and text columns alike, which makes
 *                                                      these two more capable here than the
 *                                                      in-process pair, which coerce to number
 *   `is_empty`      `(col is null or col::text = '')` — `isEmpty()` treats null and "" alike
 *   `is_not_empty`  the negation                       and so does this
 */
const CONDITIONS: Record<Operator, (column: string, placeholder: string | null) => string> = {
  equals: (column, placeholder) => `${column}::text = ${placeholder}`,
  not_equals: (column, placeholder) => `${column}::text is distinct from ${placeholder}`,
  contains: (column, placeholder) => `strpos(${column}::text, ${placeholder}) > 0`,
  greater_than: (column, placeholder) => `${column} > ${placeholder}`,
  less_than: (column, placeholder) => `${column} < ${placeholder}`,
  is_empty: (column) => `(${column} is null or ${column}::text = '')`,
  is_not_empty: (column) => `(${column} is not null and ${column}::text <> '')`,
};

/** The two operators that read no value, so a missing one is not an error. */
const VALUELESS: ReadonlySet<Operator> = new Set<Operator>(["is_empty", "is_not_empty"]);

/**
 * `SelectSpec` → SQL text plus bind parameters.
 *
 * **Pure, and that is deliberate** (D18): the exact statement this node sends is asserted
 * character for character by `database.test.ts` with no database, no network and no
 * credential, which is the only way a claim like "it always wraps in a read-only
 * transaction" can be checked cheaply enough to check on every commit.
 *
 * The table is **always schema-qualified**, which is one line of defence nobody asks for:
 * an unqualified name is resolved through `search_path`, and a `search_path` is a thing a
 * connection string can set.
 */
export function buildSelect(spec: SelectSpec): BuiltQuery {
  const relation = `${quoteIdentifier(spec.schema, "schema name")}.${quoteIdentifier(spec.table, "table name")}`;

  const params: string[] = [];
  const clauses: string[] = [];

  for (const condition of spec.where) {
    const column = quoteIdentifier(condition.column, "column name");
    const build = CONDITIONS[condition.operator];
    if (!build) {
      throw new IntegrationError(`"${condition.operator}" is not an operator this node knows.`);
    }

    if (VALUELESS.has(condition.operator)) {
      clauses.push(build(column, null));
      continue;
    }

    params.push(condition.value ?? "");
    clauses.push(build(column, `$${params.length}`));
  }

  const where = clauses.length > 0 ? ` where ${clauses.join(" and ")}` : "";

  if (spec.mode === "count") {
    return { text: `select count(*)::bigint as count from ${relation}${where}`, params };
  }

  const projection =
    spec.columns.length > 0
      ? spec.columns.map((column) => quoteIdentifier(column, "column name")).join(", ")
      : "*";

  const order =
    spec.orderBy.trim().length > 0
      ? ` order by ${quoteIdentifier(spec.orderBy, "column name")} ${spec.direction === "desc" ? "desc" : "asc"}`
      : "";

  // The limit is an integer this module clamped, so it is interpolated rather than bound:
  // `LIMIT` takes a parameter happily, but keeping it out of `params` means the parameter
  // list contains nothing but user values, which is the property the test reads.
  const limit = Math.min(Math.max(Math.trunc(spec.limit), 1), POSTGRES_MAX_ROWS);

  return { text: `select ${projection} from ${relation}${where}${order} limit ${limit}`, params };
}

/* ------------------------------------------------------------------ *
 * Values coming back
 * ------------------------------------------------------------------ */

/**
 * A Postgres value as something a step's JSONB and a `{{ }}` reference can both hold.
 *
 * Without this the output is *nearly* right, which is worse than wrong: a `date` column
 * arrives as a JS `Date` that survives `JSON.stringify` and so looks fine in a step record,
 * while `{{steps.x.output.items.0.founded}}` interpolates whatever `String(Date)` gives —
 * "Wed Jan 29 1819 …" rather than the ISO date the row actually holds. `bigint` is the
 * sharper case: `JSON.stringify` **throws** on it, which would fail the step after the
 * query had already succeeded.
 */
export function toJsonValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return `\\x${Buffer.from(value).toString("hex")}`;
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = toJsonValue(inner);
    }
    return out;
  }
  return value;
}

export function toJsonRow(row: Record<string, unknown>): Record<string, unknown> {
  return toJsonValue(row) as Record<string, unknown>;
}

/* ------------------------------------------------------------------ *
 * Connecting
 * ------------------------------------------------------------------ */

export const POSTGRES_DEFAULT_TIMEOUT_MS = 10_000;
export const POSTGRES_MAX_TIMEOUT_MS = 30_000;

/** Postgres error codes worth a sentence of our own rather than the server's. */
const EXPLAINED: Record<string, (detail: string) => string> = {
  "42P01": (detail) => `${detail} Check the schema and table name, and that the role you connected with may see it.`,
  "42703": (detail) => `${detail} Check the column names against the table.`,
  "42501": (detail) => `${detail} The role in your connection string has not been granted that.`,
  "25006": () =>
    "The query tried to write. This node runs every statement inside a read-only transaction, so a write cannot succeed here.",
  "28P01": () => "The database refused the password in that connection string.",
  "3D000": () => "The database named in that connection string does not exist on that server.",
  "57014": () => "The query took longer than this node's timeout and was cancelled by the server.",
};

interface PostgresFailure {
  code?: unknown;
  message?: unknown;
}

/**
 * The server's own words where they help, ours where they do not.
 *
 * **Exported for its test, and it earns that.** These strings are what a user reads on a failed
 * step, and a `42P01` reaching them as "relation "public.city" does not exist" with no further
 * sentence sends somebody to check their spelling when the real cause is as often a role that
 * cannot see the table. Phase 23B's `token-http.test.ts` set the precedent: what a documented
 * failure answer is *taken to mean* is worth asserting, and it is the half a real-service test
 * cannot reach, because making a real server answer `57014` on demand is harder than it is worth.
 */
export function asIntegrationError(error: unknown): IntegrationError {
  if (error instanceof IntegrationError || error instanceof HttpTargetError) {
    return error instanceof IntegrationError ? error : new IntegrationError(error.message);
  }

  const failure = error as PostgresFailure;
  const code = typeof failure?.code === "string" ? failure.code : "";
  // `String(error)` is deliberately not the fallback: for anything thrown that is not an Error
  // it yields "[object Object]", and a step whose only explanation is "[object Object]." is
  // worse than one that admits it does not know. Only a real message is used as one.
  const raw = typeof failure?.message === "string" ? failure.message.trim() : "";
  // Postgres messages are lower-case and unpunctuated; they read as half a sentence
  // otherwise, and these reach a failed step where the user is the only reader.
  const detail =
    raw.length > 0
      ? `${raw.charAt(0).toUpperCase()}${raw.slice(1)}${/[.!?]$/.test(raw) ? "" : "."}`
      : "The database refused the query.";

  const explain = EXPLAINED[code];
  return new IntegrationError(explain ? explain(detail) : detail);
}

type Client = ReturnType<typeof createPostgres>;

function connect(target: PostgresTarget): Client {
  return createPostgres(target.url.toString(), {
    ssl: target.ssl,
    // One connection, opened for this step and closed with it. A pool would outlive the run
    // that is allowed to use the credential, and on Cloud Run with `min-instances 1` it would
    // also hold a user's database awake between runs — which is their bill, not ours to spend.
    max: 1,
    connect_timeout: 15,
    // A user may paste a pooled connection string, and a PgBouncer-style pooler in transaction
    // mode cannot keep a named prepared statement across statements. Off is the setting that
    // works on both kinds of endpoint; the cost is one extra parse per query.
    prepare: false,
    // Skips a catalogue round trip on connect. Built-in types still decode; a custom type
    // arrives as its text form, which `toJsonValue` passes through unchanged.
    fetch_types: false,
    connection: { application_name: "agentforge" },
    onnotice: () => {},
  });
}

/**
 * Run one read inside a read-only transaction, with the server enforcing the deadline too.
 *
 * `statement_timeout` is `SET LOCAL`, so it dies with the transaction and cannot leak into
 * another use of a pooled connection. It is interpolated because a `SET` is a utility
 * statement and takes no bind parameter — measured, not assumed, the same way the role
 * password in `scripts/setup-demo-db.mjs` had to be — so the value is clamped to an integer
 * here first and the clamp is what makes the interpolation safe.
 */
async function withReadOnly<T>(
  target: PostgresTarget,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  work: (tx: Parameters<Parameters<Client["begin"]>[1]>[0]) => Promise<T>,
): Promise<T> {
  const budget = Math.min(Math.max(Math.trunc(timeoutMs), 1_000), POSTGRES_MAX_TIMEOUT_MS);
  const sql = connect(target);

  try {
    const attempt = sql.begin("read only", async (tx) => {
      await tx.unsafe(`set local statement_timeout = ${budget}`);
      return work(tx);
    }) as Promise<T>;

    if (!signal) return await attempt;

    // The driver takes no AbortSignal, so cancellation is a race plus a closed socket. The
    // run is already over by then; what this prevents is a cancelled run holding a
    // connection to someone's database until the query finishes on its own.
    return await Promise.race([
      attempt,
      new Promise<never>((_resolve, reject) => {
        if (signal.aborted) reject(new IntegrationError("The run was cancelled.", undefined, { retryable: false }));
        signal.addEventListener(
          "abort",
          () => reject(new IntegrationError("The run was cancelled.", undefined, { retryable: false })),
          { once: true },
        );
      }),
    ]);
  } catch (error) {
    throw asIntegrationError(error);
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

export interface SelectResult {
  items: Record<string, unknown>[];
  count: number;
}

/** The node's read. `spec.mode` decides which of the two shapes comes back. */
export async function runSelect(
  secret: string,
  spec: SelectSpec,
  options: { signal?: AbortSignal; timeoutMs?: number; resolve?: AddressResolver } = {},
): Promise<SelectResult> {
  const target = await checkConnectionString(secret, options.resolve);
  const query = buildSelect(spec);

  return withReadOnly(
    target,
    options.timeoutMs ?? POSTGRES_DEFAULT_TIMEOUT_MS,
    options.signal,
    async (tx) => {
      const rows = (await tx.unsafe(query.text, query.params)) as unknown as Record<string, unknown>[];

      if (spec.mode === "count") {
        const total = Number(rows[0]?.count ?? 0);
        return { items: [], count: Number.isFinite(total) ? total : 0 };
      }

      const items = rows.map(toJsonRow);
      return { items, count: items.length };
    },
  );
}

export interface PostgresIdentity {
  /** `18.6` — the server's version number, which is not part of the connection string. */
  serverVersion: string;
}

/**
 * Prove a connection string against the real server before it is stored.
 *
 * **What comes back must not be any part of the secret.** The host and the database name are
 * both inside the connection string, so neither may become metadata however non-secret they
 * feel — `verify-integrations.mjs` asserts that a status response carries no fragment of a
 * stored credential, and the server version is the one identifying fact that is genuinely
 * the server's rather than the string's.
 */
export async function verifyConnectionString(
  secret: string,
  signal?: AbortSignal,
  resolve?: AddressResolver,
): Promise<PostgresIdentity> {
  const target = await checkConnectionString(secret, resolve);

  return withReadOnly(target, POSTGRES_DEFAULT_TIMEOUT_MS, signal, async (tx) => {
    const rows = (await tx.unsafe(
      "select current_setting('server_version') as version",
    )) as unknown as { version?: unknown }[];
    const version = typeof rows[0]?.version === "string" ? rows[0].version : "";
    return { serverVersion: version.split(" ")[0] ?? "" };
  });
}
