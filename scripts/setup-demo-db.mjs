/**
 * Create the read-only demo database `integration.database` is verified against — Phase 23C.
 *
 * **It provisions nothing new.** The database and the role live inside the Neon project this
 * product already uses, on the same compute endpoint, so they add no resource, no second
 * connection to keep awake and nothing to the bill (`CLAUDE.md` → *Cost rules*). What they add
 * is isolation, and the isolation is the point:
 *
 *   • a **separate database** rather than a schema in `neondb`, so the application's own 13
 *     tables are not reachable from the credential at all — not by grant, not by mistake, and
 *     not by a model that guessed a table name. `drizzle` and `/api/health` never see it
 *   • a **SELECT-only role** rather than `neondb_owner`, so "proved unable to write" is true at
 *     two independent layers: the node's read-only transaction, and the server's own grants.
 *     The first is this product's promise; the second is what a user's own database enforces
 *     whatever this product does, which is what the node's documentation tells them to rely on
 *
 * Idempotent. Run it again and it resets the password and re-seeds the rows.
 *
 * Usage — the admin URL is Neon's unpooled string, because `CREATE DATABASE` cannot run
 * through a pooler or inside a transaction:
 *
 *   DATABASE_URL_UNPOOLED=… DEMO_DB_PASSWORD=… node scripts/setup-demo-db.mjs
 *
 * It prints the connection string **with the password masked**. Read the real one out of the
 * `DEMO_DATABASE_URL` it writes nowhere: you pass the password in, so you already have it.
 */
import postgres from "postgres";

const ADMIN_URL = process.env.DATABASE_URL_UNPOOLED;
const PASSWORD = process.env.DEMO_DB_PASSWORD;

const DB = "agentforge_demo";
const ROLE = "agentforge_demo_reader";
const TABLE = "city";

if (!ADMIN_URL) throw new Error("DATABASE_URL_UNPOOLED is required (Neon's unpooled string).");
if (!PASSWORD || PASSWORD.length < 24) {
  throw new Error("DEMO_DB_PASSWORD is required and must be at least 24 characters.");
}

/** Identifiers here are literals in this file, but quoting them is still the habit. */
const q = (name) => `"${name.replace(/"/g, '""')}"`;

/**
 * `CREATE ROLE … PASSWORD $1` is a **syntax error** — a utility statement takes no bind
 * parameters, which is measured rather than assumed: Postgres answered `42601` at the
 * placeholder's own character offset. So the password has to reach the statement as a literal,
 * and the only safe way to write a literal is to let the server write it: `quote_literal`
 * escapes it by exactly the rules the parser then reads it by. Hand-rolling the quoting here
 * would be the one place this script could be injected into.
 */
async function quoteLiteral(sql, value) {
  const [{ lit }] = await sql`select quote_literal(${value}) as lit`;
  return lit;
}

const admin = postgres(ADMIN_URL, { max: 1, ssl: "require", connect_timeout: 30 });

try {
  const [{ u }] = await admin`select current_user as u`;
  console.log(`admin role          : ${u}`);

  /* ---- the role ---------------------------------------------------------- */
  const secret = await quoteLiteral(admin, PASSWORD);
  const existingRole = await admin`select 1 from pg_roles where rolname = ${ROLE}`;
  if (existingRole.length === 0) {
    await admin.unsafe(`create role ${q(ROLE)} with login password ${secret}`);
    console.log(`role                : ${ROLE} created`);
  } else {
    await admin.unsafe(`alter role ${q(ROLE)} with login password ${secret}`);
    console.log(`role                : ${ROLE} password reset`);
  }
  // Belt and braces: whatever it was, it may not create databases or roles of its own.
  // `NOSUPERUSER` is deliberately absent — altering that attribute needs a superuser, which
  // `neondb_owner` is not, and a statement that cannot succeed does not belong in a script
  // whose job is to be re-runnable.
  await admin.unsafe(`alter role ${q(ROLE)} nocreatedb nocreaterole`);

  /* ---- the database ------------------------------------------------------ */
  const existingDb = await admin`select 1 from pg_database where datname = ${DB}`;
  if (existingDb.length === 0) {
    await admin.unsafe(`create database ${q(DB)}`);
    console.log(`database            : ${DB} created`);
  } else {
    console.log(`database            : ${DB} already present`);
  }
} finally {
  await admin.end({ timeout: 10 });
}

/* ---- the table, inside the demo database ------------------------------- */
const demoAdminUrl = new URL(ADMIN_URL);
demoAdminUrl.pathname = `/${DB}`;
const demo = postgres(demoAdminUrl.toString(), { max: 1, ssl: "require", connect_timeout: 30 });

try {
  await demo.unsafe(`
    create table if not exists ${q(TABLE)} (
      id          integer primary key,
      name        text    not null,
      country     text    not null,
      population  integer not null,
      founded     date,
      notes       text
    )
  `);

  await demo.unsafe(`truncate table ${q(TABLE)}`);
  await demo`
    insert into ${demo(TABLE)} ${demo(
      [
        { id: 1, name: "Singapore", country: "SG", population: 5917600, founded: "1819-01-29", notes: "where this service runs" },
        { id: 2, name: "Bengaluru", country: "IN", population: 13608000, founded: "1537-01-01", notes: null },
        { id: 3, name: "Reykjavík", country: "IS", population: 139875, founded: "0874-01-01", notes: "non-ASCII on purpose" },
        { id: 4, name: "Valparaíso", country: "CL", population: 296655, founded: "1536-01-01", notes: "" },
        { id: 5, name: "Hobart", country: "AU", population: 254000, founded: "1804-02-21", notes: null },
      ],
      "id", "name", "country", "population", "founded", "notes",
    )}
  `;

  /* ---- the grants: SELECT and nothing else ------------------------------ */
  await demo.unsafe(`grant connect on database ${q(DB)} to ${q(ROLE)}`);
  await demo.unsafe(`grant usage on schema public to ${q(ROLE)}`);
  await demo.unsafe(`grant select on table ${q(TABLE)} to ${q(ROLE)}`);
  // Postgres 15+ already withholds CREATE on `public` from PUBLIC; said out loud anyway,
  // because this script is also the documentation of what the role may do.
  await demo.unsafe(`revoke create on schema public from public`);
  await demo.unsafe(`revoke create on schema public from ${q(ROLE)}`);

  const [{ n }] = await demo.unsafe(`select count(*)::int as n from ${q(TABLE)}`);
  const grants = await demo`
    select privilege_type from information_schema.table_privileges
    where grantee = ${ROLE} and table_name = ${TABLE} order by privilege_type
  `;
  console.log(`table               : public.${TABLE}, ${n} rows`);
  console.log(`grants to ${ROLE}: ${grants.map((g) => g.privilege_type).join(", ") || "none"}`);
} finally {
  await demo.end({ timeout: 10 });
}

const readerUrl = new URL(ADMIN_URL);
readerUrl.pathname = `/${DB}`;
readerUrl.username = ROLE;
readerUrl.password = PASSWORD;
readerUrl.searchParams.set("sslmode", "require");

const masked = new URL(readerUrl.toString());
masked.password = "********";
console.log(`\nDEMO_DATABASE_URL   : ${masked.toString()}`);
console.log("Put the real one in .env as DEMO_DATABASE_URL — it is a secret.");
