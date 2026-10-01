import assert from "node:assert/strict";
import { test } from "node:test";

import { operators } from "@/lib/nodes/core/branch";

import { HttpTargetError } from "./guard";
import { IntegrationError } from "./net";
import {
  asIntegrationError,
  buildSelect,
  checkConnectionString,
  parseConnectionString,
  POSTGRES_MAX_ROWS,
  quoteIdentifier,
  type SelectSpec,
  toJsonValue,
} from "./postgres";

/**
 * The Postgres integration's decisions, asserted with no database and no network — D18.
 *
 * Everything here is reachable because `buildSelect` is pure: the exact statement the node
 * sends is a return value rather than a side effect, so "it is always a select", "the table is
 * always schema-qualified" and "a valueless operator binds no parameter" are *checkable*
 * properties instead of claims in a comment. The two things these tests cannot reach — that
 * the statement runs inside `BEGIN READ ONLY`, and that the server refuses a write — are
 * proved against a real server by `scripts/verify-postgres.mjs`, because that is the only
 * place a server's behaviour can honestly be established.
 */

/** `assert.throws` returns nothing, and some of these assert on the message itself. */
function caught(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new assert.AssertionError({ message: "expected a throw, got none" });
}

const spec = (overrides: Partial<SelectSpec> = {}): SelectSpec => ({
  schema: "public",
  table: "city",
  columns: [],
  where: [],
  orderBy: "",
  direction: "asc",
  limit: 50,
  mode: "rows",
  ...overrides,
});

/* ------------------------------------------------------------------ *
 * The connection string
 * ------------------------------------------------------------------ */

test("a well-formed connection string parses, and defaults to requiring TLS", () => {
  const target = parseConnectionString("  postgresql://u:p@db.example.com:5432/shop  ");
  assert.equal(target.url.hostname, "db.example.com");
  assert.equal(target.url.port, "5432");
  assert.equal(target.url.pathname, "/shop");
  assert.equal(target.ssl, "require");
});

test("postgres:// and postgresql:// are both accepted, and nothing else is", () => {
  assert.equal(parseConnectionString("postgres://u:p@h.example.com/d").ssl, "require");
  assert.equal(parseConnectionString("postgresql://u:p@h.example.com/d").ssl, "require");
  for (const bad of [
    "https://h.example.com/d",
    "mysql://u:p@h.example.com/d",
    "postgresql+ssl://u:p@h.example.com/d",
    "redis://h.example.com",
  ]) {
    assert.throws(() => parseConnectionString(bad), HttpTargetError, bad);
  }
});

test("a string that is not a URL at all is refused with an example, not a stack", () => {
  const error = caught(() => parseConnectionString("host=db user=me"));
  assert.ok(error instanceof HttpTargetError);
  assert.match(error.message, /postgresql:\/\//);
});

test("sslmode=verify-full is honoured rather than downgraded", () => {
  assert.equal(
    parseConnectionString("postgres://u:p@h.example.com/d?sslmode=verify-full").ssl,
    "verify-full",
  );
  assert.equal(
    parseConnectionString("postgres://u:p@h.example.com/d?sslmode=verify-ca").ssl,
    "verify-full",
  );
});

test("every sslmode that would run unencrypted is refused, not silently upgraded", () => {
  // A user who wrote `disable` has said something about their expectations. Connecting
  // anyway over TLS would be friendlier-looking and would have lied to them.
  for (const mode of ["disable", "allow", "prefer", "DISABLE"]) {
    const error = caught(() => parseConnectionString(`postgres://u:p@h.example.com/d?sslmode=${mode}`));
    assert.ok(error instanceof HttpTargetError, mode);
    assert.match(error.message, /sslmode=/, mode);
  }
});

test("a connection string with no database or no host is refused", () => {
  assert.throws(() => parseConnectionString("postgres://u:p@h.example.com"), HttpTargetError);
  assert.throws(() => parseConnectionString("postgres://u:p@h.example.com/"), HttpTargetError);
  assert.throws(() => parseConnectionString("postgres:///shop"), HttpTargetError);
});

test("the hosts guard.ts refuses by name are refused here too", () => {
  for (const host of [
    "localhost",
    "metadata",
    "metadata.google.internal",
    "db.localhost",
    "anything.internal",
    "printer.local",
    "METADATA.GOOGLE.INTERNAL",
    "metadata.google.internal.", // a trailing dot is the same name
  ]) {
    assert.throws(
      () => parseConnectionString(`postgres://u:p@${host}/d`),
      HttpTargetError,
      host,
    );
  }
});

test("credentials in the string are allowed here, unlike an HTTP target", () => {
  // `parseTarget` refuses them outright — a key in a URL is a key in a log. A connection
  // string is the one URL in this product whose whole purpose is to carry them, which is
  // why the two parsers are separate and only the address classification is shared.
  const target = parseConnectionString("postgres://admin:s3cret@h.example.com/d");
  assert.equal(target.url.username, "admin");
  assert.equal(target.url.password, "s3cret");
});

test("a host resolving to a private address is refused, with no network touched", async () => {
  const resolve = async () => ["10.0.0.5"];
  await assert.rejects(
    () => checkConnectionString("postgres://u:p@db.example.com/d", resolve),
    HttpTargetError,
  );
});

test("a host resolving publicly passes, and the resolver is the only thing consulted", async () => {
  let asked = "";
  const resolve = async (hostname: string) => {
    asked = hostname;
    return ["93.184.216.34"];
  };
  const target = await checkConnectionString("postgres://u:p@db.example.com/d", resolve);
  assert.equal(asked, "db.example.com");
  assert.equal(target.ssl, "require");
});

test("one public and one private address is still a refusal", async () => {
  // `assertPublicTarget`'s *every*, not *any* — a name answering with both would otherwise
  // pass and then be connected to whichever the driver picked.
  await assert.rejects(
    () => checkConnectionString("postgres://u:p@db.example.com/d", async () => ["93.184.216.34", "127.0.0.1"]),
    HttpTargetError,
  );
});

/* ------------------------------------------------------------------ *
 * Identifiers
 * ------------------------------------------------------------------ */

test("an identifier comes back double-quoted", () => {
  assert.equal(quoteIdentifier("city"), '"city"');
  assert.equal(quoteIdentifier("  city  "), '"city"');
  assert.equal(quoteIdentifier("Mixed_Case$1"), '"Mixed_Case$1"');
  // Quoting is what makes a name with a space or a non-ASCII letter work at all.
  assert.equal(quoteIdentifier("order items"), '"order items"');
  assert.equal(quoteIdentifier("naïve"), '"naïve"');
});

test("an identifier that could end its own quoting is refused", () => {
  const error = caught(() => quoteIdentifier('city"; drop table users --', "table name"));
  assert.ok(error instanceof IntegrationError);
  assert.match(error.message, /table name/);
  assert.match(error.message, /double quote/);
});

test("an empty, control-character or over-long identifier is refused", () => {
  assert.throws(() => quoteIdentifier("   ", "column name"), IntegrationError);
  assert.throws(() => quoteIdentifier("a\u0000b"), IntegrationError);
  assert.throws(() => quoteIdentifier("a\nb"), IntegrationError);
  // 63 bytes is Postgres's own limit; a longer name would be silently truncated, so
  // accepting one would mean querying a table the user did not name.
  assert.equal(quoteIdentifier("a".repeat(63)), `"${"a".repeat(63)}"`);
  assert.throws(() => quoteIdentifier("a".repeat(64)), IntegrationError);
  // Bytes, not characters: a 32-character name of two-byte letters is 64 bytes.
  assert.throws(() => quoteIdentifier("é".repeat(32)), IntegrationError);
});

/* ------------------------------------------------------------------ *
 * The statement
 * ------------------------------------------------------------------ */

test("the simplest read is a select, schema-qualified, with its limit inline", () => {
  const query = buildSelect(spec());
  assert.equal(query.text, 'select * from "public"."city" limit 50');
  assert.deepEqual(query.params, []);
});

test("the table is always schema-qualified, so search_path cannot redirect it", () => {
  // A connection string can set `search_path`, so an unqualified name is a name somebody
  // else gets to resolve.
  const query = buildSelect(spec({ schema: "reporting", table: "orders" }));
  assert.match(query.text, /from "reporting"\."orders"/);
});

test("named columns are projected, quoted, in the order given", () => {
  const query = buildSelect(spec({ columns: ["name", "population", "Mixed Case"] }));
  assert.equal(
    query.text,
    'select "name", "population", "Mixed Case" from "public"."city" limit 50',
  );
});

test("an order clause takes a direction and only the two it knows", () => {
  assert.match(buildSelect(spec({ orderBy: "population", direction: "desc" })).text, /order by "population" desc limit/);
  assert.match(buildSelect(spec({ orderBy: "name", direction: "asc" })).text, /order by "name" asc limit/);
  // Nothing to order by means no clause at all, rather than an invented one.
  assert.doesNotMatch(buildSelect(spec({ orderBy: "   " })).text, /order by/);
});

test("the limit is clamped to the registry's ceiling and to at least one row", () => {
  assert.match(buildSelect(spec({ limit: 10_000 })).text, new RegExp(`limit ${POSTGRES_MAX_ROWS}$`));
  assert.match(buildSelect(spec({ limit: 0 })).text, /limit 1$/);
  assert.match(buildSelect(spec({ limit: -5 })).text, /limit 1$/);
  assert.match(buildSelect(spec({ limit: 12.9 })).text, /limit 12$/);
});

test("count mode asks the server for the total and ignores limit and order", () => {
  const query = buildSelect(spec({ mode: "count", limit: 10, orderBy: "name", columns: ["name"] }));
  assert.equal(query.text, 'select count(*)::bigint as count from "public"."city"');
  assert.doesNotMatch(query.text, /limit|order by/);
});

test("every statement this node can build is a select — nothing else exists to build", () => {
  // The property that makes "read-only by construction" more than a slogan: there is no code
  // path here that emits any other verb, whatever the configuration says.
  const shapes: SelectSpec[] = [
    spec(),
    spec({ mode: "count" }),
    spec({ columns: ["a", "b"], orderBy: "a", direction: "desc", limit: 200 }),
    ...operators.map((operator) => spec({ where: [{ column: "c", operator, value: "v" }] })),
  ];
  for (const shape of shapes) {
    assert.match(buildSelect(shape).text, /^select /, JSON.stringify(shape.where));
  }
});

/* ------------------------------------------------------------------ *
 * Conditions — the shared operator vocabulary, in SQL
 * ------------------------------------------------------------------ */

test("every operator core.branch has is expressible here", () => {
  // The coupling is deliberate: `transform.filter`'s documentation promises a reader that the
  // operators behave identically, so an operator added to `core.branch` with no mapping here
  // must fail the build rather than fail a run.
  for (const operator of operators) {
    const query = buildSelect(spec({ where: [{ column: "country", operator, value: "IN" }] }));
    assert.match(query.text, / where /, operator);
    assert.match(query.text, /"country"/, operator);
  }
});

test("each operator translates the way evaluate() compares, not approximately", () => {
  const clause = (operator: (typeof operators)[number], value = "IN") =>
    buildSelect(spec({ where: [{ column: "country", operator, value }] })).text;

  // `evaluate` compares String(left) to String(right), so the cast is the faithful
  // translation: it is what makes population = "254000" match an integer column.
  assert.match(clause("equals"), /where "country"::text = \$1 limit/);
  // Plain `<>` is NULL for a NULL row, which would silently drop every row with no value.
  // `is distinct from` answers true, which is what `!looseEquals` does in process.
  assert.match(clause("not_equals"), /where "country"::text is distinct from \$1 limit/);
  // strpos is exactly String.includes, and has no metacharacters to escape — unlike LIKE,
  // where a value containing % or _ would quietly become a wildcard.
  assert.match(clause("contains"), /where strpos\("country"::text, \$1\) > 0 limit/);
  // Untyped parameters, so the server compares using the column's own type. Measured to
  // work on integer, date and text columns alike, which makes these two more capable here
  // than the in-process pair, which coerce to number.
  assert.match(clause("greater_than"), /where "country" > \$1 limit/);
  assert.match(clause("less_than"), /where "country" < \$1 limit/);
  // isEmpty() treats null and "" alike, and so does this.
  assert.match(clause("is_empty"), /where \("country" is null or "country"::text = ''\) limit/);
  assert.match(clause("is_not_empty"), /where \("country" is not null and "country"::text <> ''\) limit/);
});

test("a valueless operator binds no parameter, so later placeholders do not shift", () => {
  // The bug this prevents: if `is_empty` pushed an unused parameter, every $n after it
  // would be off by one and the query would compare the wrong column to the wrong value —
  // while still running, and still returning rows.
  const query = buildSelect(
    spec({
      where: [
        { column: "notes", operator: "is_empty" },
        { column: "country", operator: "equals", value: "IN" },
        { column: "name", operator: "is_not_empty" },
        { column: "population", operator: "greater_than", value: "1000" },
      ],
    }),
  );
  assert.equal(
    query.text,
    'select * from "public"."city" where ("notes" is null or "notes"::text = \'\')' +
      ' and "country"::text = $1' +
      ' and ("name" is not null and "name"::text <> \'\')' +
      ' and "population" > $2 limit 50',
  );
  assert.deepEqual(query.params, ["IN", "1000"]);
});

test("conditions are combined with and, in the order given", () => {
  const query = buildSelect(
    spec({
      where: [
        { column: "country", operator: "equals", value: "IN" },
        { column: "population", operator: "greater_than", value: "1000000" },
      ],
    }),
  );
  assert.equal(query.params.length, 2);
  assert.deepEqual(query.params, ["IN", "1000000"]);
  assert.equal(query.text.split(" and ").length, 2);
});

test("a missing value binds an empty string rather than undefined", () => {
  // `undefined` reaching the driver would be sent as NULL, and `col::text = NULL` is never
  // true — a condition that silently matches nothing is worse than one that matches "".
  const query = buildSelect(spec({ where: [{ column: "country", operator: "equals" }] }));
  assert.deepEqual(query.params, [""]);
});

test("a value is never interpolated, however hostile it is", () => {
  const nasty = "'; drop table city; --";
  const query = buildSelect(spec({ where: [{ column: "country", operator: "equals", value: nasty }] }));
  assert.doesNotMatch(query.text, /drop/i);
  assert.deepEqual(query.params, [nasty]);
});

test("a hostile identifier is refused rather than quoted into the statement", () => {
  assert.throws(
    () => buildSelect(spec({ table: 'city" where 1=1 --' })),
    IntegrationError,
  );
  assert.throws(
    () => buildSelect(spec({ columns: ['name", (select password from users) as x --'] })),
    IntegrationError,
  );
  assert.throws(
    () => buildSelect(spec({ where: [{ column: 'a"', operator: "equals", value: "x" }] })),
    IntegrationError,
  );
  assert.throws(() => buildSelect(spec({ orderBy: 'name"; drop table city --' })), IntegrationError);
  assert.throws(() => buildSelect(spec({ schema: 'public"' })), IntegrationError);
});

test("an operator outside the vocabulary is refused, not defaulted", () => {
  assert.throws(
    () =>
      buildSelect(
        spec({ where: [{ column: "a", operator: "regex" as (typeof operators)[number], value: "x" }] }),
      ),
    IntegrationError,
  );
});

/* ------------------------------------------------------------------ *
 * Values coming back
 * ------------------------------------------------------------------ */

test("a date becomes an ISO string, not whatever String(Date) gives", () => {
  // The failure without this is subtle: the step record looks right because JSON.stringify
  // serialises a Date, while `{{steps.x.output.items.0.founded}}` interpolates
  // "Wed Jan 29 1819 …" — a workflow that runs and quietly carries the wrong text.
  assert.equal(toJsonValue(new Date("1819-01-29T00:00:00.000Z")), "1819-01-29T00:00:00.000Z");
});

test("a bigint becomes a string, because JSON.stringify throws on one", () => {
  // The sharper case: this would fail the step *after* the query had already succeeded.
  assert.equal(toJsonValue(9_007_199_254_740_993n), "9007199254740993");
  assert.doesNotThrow(() => JSON.stringify(toJsonValue({ total: 10n })));
});

test("bytea becomes Postgres's own hex notation rather than a key-by-index object", () => {
  // `JSON.stringify(Uint8Array)` gives {"0":222,"1":173} — technically lossless and
  // unreadable by anything.
  assert.equal(toJsonValue(new Uint8Array([0xde, 0xad, 0xbe, 0xef])), "\\xdeadbeef");
});

test("null, undefined and nested structures all come back JSON-safe", () => {
  assert.equal(toJsonValue(null), null);
  assert.equal(toJsonValue(undefined), null);
  assert.deepEqual(toJsonValue({ a: [1, new Date(0)], b: { c: 2n } }), {
    a: [1, "1970-01-01T00:00:00.000Z"],
    b: { c: "2" },
  });
  // Scalars pass through untouched — the common case must not be reshaped.
  assert.equal(toJsonValue("Hobart"), "Hobart");
  assert.equal(toJsonValue(254_000), 254_000);
  assert.equal(toJsonValue(true), true);
});

/* ------------------------------------------------------------------ *
 * What a failure is taken to mean
 * ------------------------------------------------------------------ */

test("a Postgres error code becomes a sentence that says what to do about it", () => {
  // These strings are what a user reads on a failed step. The server's own message is kept —
  // it names the relation or the column, which is the useful half — and a sentence is added
  // where the message alone sends somebody to the wrong place.
  const message = (code: string, raw: string) =>
    asIntegrationError(Object.assign(new Error(raw), { code })).message;

  // The commonest failure, and the one whose cause is most often misread: a missing table and
  // a table the role cannot see are the same answer from Postgres.
  const missing = message("42P01", 'relation "public.city" does not exist');
  assert.match(missing, /Relation "public\.city" does not exist\./);
  assert.match(missing, /role you connected with may see it/);

  assert.match(message("42703", 'column "nope" does not exist'), /column names against the table/);
  assert.match(message("42501", "permission denied for table city"), /has not been granted that/);
  assert.match(message("28P01", "password authentication failed"), /refused the password/);
  assert.match(message("3D000", 'database "nope" does not exist'), /does not exist on that server/);
  assert.match(message("57014", "canceling statement"), /longer than this node's timeout/);

  // `25006` is the one case where the server's words are replaced rather than extended:
  // "cannot execute INSERT in a read-only transaction" is true but reads like a defect, when
  // it is this node working exactly as designed.
  const readOnly = message("25006", "cannot execute INSERT in a read-only transaction");
  assert.match(readOnly, /read-only transaction, so a write cannot succeed/);
  assert.doesNotMatch(readOnly, /cannot execute INSERT/);
});

test("an unrecognised code keeps the server's own words, punctuated", () => {
  // Postgres messages are lower-case and unpunctuated, so they read as half a sentence in a
  // step that otherwise speaks English.
  const out = asIntegrationError(Object.assign(new Error("something odd happened"), { code: "XX000" }));
  assert.equal(out.message, "Something odd happened.");
  assert.ok(out instanceof IntegrationError);
});

test("an error this module already shaped is passed through, not re-wrapped", () => {
  const mine = new IntegrationError("Postgres is not connected.");
  assert.equal(asIntegrationError(mine), mine);
  // A guard refusal keeps its own sentence too — it explains a decision made before dialling.
  const guard = new HttpTargetError('"db.internal" is not a public host.');
  assert.match(asIntegrationError(guard).message, /not a public host/);
});

test("something with no usable message admits it rather than inventing one", () => {
  // `String(error)` is not the fallback on purpose: for a plain object it yields
  // "[object Object]", and a failed step reading "[object Object]." is worse than one that
  // says plainly that the database refused the query. Found by this test.
  assert.equal(asIntegrationError({}).message, "The database refused the query.");
  assert.equal(asIntegrationError(null).message, "The database refused the query.");
  assert.equal(asIntegrationError({ message: "   " }).message, "The database refused the query.");
  assert.ok(asIntegrationError(undefined) instanceof IntegrationError);
});

test("a message that is already a sentence does not get a second full stop", () => {
  assert.equal(asIntegrationError(new Error("Connection terminated.")).message, "Connection terminated.");
  assert.equal(asIntegrationError(new Error("connection terminated")).message, "Connection terminated.");
});
