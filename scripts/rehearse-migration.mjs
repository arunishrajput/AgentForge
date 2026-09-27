/**
 * Rehearse Phase 19A's migration — forward and backward — on a throwaway copy.
 *
 *   node --env-file=.env scripts/rehearse-migration.mjs
 *
 * `BUILD_PLAN.md` → *Phase 19A* requires the rollback to be rehearsed on a copy before
 * either migration is applied to the deployed database. This is that rehearsal, and it
 * is a script rather than a session's worth of hand-typed SQL so it can be re-run by
 * anybody, including on the next migration that needs the same treatment.
 *
 * **The copy is a schema, not a database.** Neon's own answer would be a branch, but
 * `neonctl` on this machine is unauthenticated (`PROGRESS.md` M9) and authenticating it
 * needs a browser. A schema alongside `public` on the same database is a genuine copy
 * of the tables and their data, costs a few seconds of compute that is already awake,
 * and needs no credential this repository does not already have. It is dropped on the
 * way out, including after a failure.
 *
 * **What it proves, in order:**
 *
 *   1. `0005` applies to a copy holding real rows, and backfills every one of them.
 *   2. After it, every resource is in exactly its owner's personal workspace — checked
 *      by joining back to `ownerId`, not by trusting the row count.
 *   3. `0006` applies on top, so the `NOT NULL` the application assumes is reachable.
 *   4. The rollback returns the copy to a state **digest-identical** to where it
 *      started. Not "looks right": the same md5 over the same rows.
 *
 * A session-based client is used rather than the `neon-http` driver the app uses,
 * because `search_path` has to survive across statements and every HTTP statement is
 * its own session.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

import { Client } from "@neondatabase/serverless";

/** The tables Phase 19A touches, plus `user`, which the backfill reads. */
const TABLES = ["user", "workflow", "run", "workflow_version", "credential"];

const MIGRATIONS_DIR = "drizzle";
const schema = `rehearsal_${createHash("sha256").update(String(Date.now())).digest("hex").slice(0, 10)}`;

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * The one migration file carrying this tag.
 *
 * It insists on exactly one match rather than taking the first, because taking the
 * first is how this script spent its first run applying `0005_0006_rollback.sql` — a
 * name that sorted ahead of the real `0005` — as the forward migration. Every
 * statement in a rollback is `IF EXISTS`, so it succeeded, changed nothing, and the
 * failure surfaced three checks later as a column that did not exist. The file has
 * since been renamed `rollback_0005_0006.sql`; this throws either way.
 */
function migrationFile(tag) {
  const names = readdirSync(MIGRATIONS_DIR).filter(
    (f) => f.startsWith(`${tag}_`) && f.endsWith(".sql"),
  );
  if (names.length !== 1) {
    throw new Error(
      `Expected exactly one migration file tagged ${tag}, found ${names.length}: ${names.join(", ")}`,
    );
  }
  return join(MIGRATIONS_DIR, names[0]);
}

/**
 * Split a migration into statements and point every explicit `"public".` reference at
 * the rehearsal schema.
 *
 * Splitting on drizzle's own `--> statement-breakpoint` rather than on `;` matters:
 * `0006` contains a `DO $$ ... $$` block full of semicolons, and a naive split would
 * cut it in half.
 *
 * The rewrite is one narrow substitution, and it is the only difference between what
 * runs here and what runs against the real database. Unqualified names resolve through
 * `search_path`; the qualified ones appear only in drizzle's generated `REFERENCES`
 * clauses, which would otherwise reach back into `public` and make the copy not a copy.
 */
function statements(path, { breakpoints = true } = {}) {
  const sql = readFileSync(path, "utf8").replaceAll('"public".', `"${schema}".`);
  const parts = breakpoints ? sql.split("--> statement-breakpoint") : sql.split(/;\s*\n/);
  return parts
    .map((part) =>
      part
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("--"))
        .join("\n")
        .trim()
        .replace(/;$/, ""),
    )
    .filter((part) => part.length > 0);
}

/**
 * A content digest per table: the row count, and an md5 over the md5 of every row,
 * aggregated in a sorted order so it does not depend on physical row order.
 *
 * `t::text` is the whole row, so a changed value anywhere in any column changes the
 * digest. That is the property the rollback claim rests on.
 */
async function digest(client) {
  const out = {};
  for (const table of TABLES) {
    const { rows } = await client.query(
      `select count(*)::int as n,
              coalesce(md5(string_agg(md5(t::text), '' order by md5(t::text))), 'empty') as d
       from "${schema}"."${table}" t`,
    );
    out[table] = rows[0];
  }
  return out;
}

/**
 * Give the cloned indexes the names the originals have.
 *
 * **`LIKE ... INCLUDING INDEXES` copies an index's definition and not its name** — the
 * clone gets a fresh auto-generated one. That makes the copy unfaithful in exactly the
 * way this rehearsal exists to catch: `0006` runs
 * `DROP INDEX "credential_owner_kind_label_idx"` by name, and against an
 * auto-named clone it fails with "index does not exist" — a failure of the rehearsal,
 * not of the migration. Found by running it.
 *
 * Indexes are matched on their definition rather than their position: everything after
 * `ON <table>` is the index's actual shape, and two indexes on one table cannot share
 * it.
 */
async function renameIndexes(client, table) {
  const shape = (indexdef) =>
    indexdef.replace(/^CREATE (UNIQUE )?INDEX \S+ ON \S+ /, (_, unique) => (unique ? "U " : "N "));

  const original = await client.query(
    `select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = $1`,
    [table],
  );
  const clone = await client.query(
    `select indexname, indexdef from pg_indexes where schemaname = $1 and tablename = $2`,
    [schema, table],
  );

  const byShape = new Map(clone.rows.map((row) => [shape(row.indexdef), row.indexname]));

  for (const row of original.rows) {
    const current = byShape.get(shape(row.indexdef));
    if (current && current !== row.indexname) {
      await run(client, `alter index "${schema}"."${current}" rename to "${row.indexname}"`);
    }
  }
}

async function run(client, sql) {
  try {
    await client.query(sql);
  } catch (error) {
    throw new Error(`${error.message}\n--- statement ---\n${sql.slice(0, 400)}`, {
      cause: error,
    });
  }
}

const client = new Client(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);
await client.connect();

try {
  console.log(`\nRehearsing Phase 19A's migration in schema "${schema}"\n`);

  /* ---------------------------------------------------------------- *
   * The copy
   * ---------------------------------------------------------------- */
  await run(client, `create schema "${schema}"`);
  await client.query(`set search_path to "${schema}", public`);

  for (const table of TABLES) {
    // `LIKE ... INCLUDING` copies the columns, defaults, checks and indexes but never
    // foreign keys, which is what makes a single-schema copy possible at all: the
    // clones do not reach back into `public`, and the migration adds its own.
    await run(
      client,
      `create table "${schema}"."${table}" (like public."${table}" including defaults including constraints including indexes)`,
    );
    await run(client, `insert into "${schema}"."${table}" select * from public."${table}"`);
    await renameIndexes(client, table);
  }

  const before = await digest(client);
  console.log("Copied:");
  for (const table of TABLES) console.log(`  ${table.padEnd(18)} ${before[table].n} rows`);

  /* ---------------------------------------------------------------- *
   * Forward
   * ---------------------------------------------------------------- */
  console.log("\nForward — 0005 (expand + backfill):");
  for (const sql of statements(migrationFile("0005"))) await run(client, sql);
  check("0005 applied", true);

  const nulls = await client.query(
    `select
       (select count(*) from "${schema}"."workflow" where "workspaceId" is null)::int as workflow,
       (select count(*) from "${schema}"."run" where "workspaceId" is null)::int as run,
       (select count(*) from "${schema}"."workflow_version" where "workspaceId" is null)::int as version,
       (select count(*) from "${schema}"."credential" where "workspaceId" is null)::int as credential`,
  );
  const n = nulls.rows[0];
  check(
    "every pre-existing row was backfilled",
    n.workflow === 0 && n.run === 0 && n.version === 0 && n.credential === 0,
    JSON.stringify(n),
  );

  const counts = await client.query(
    `select
       (select count(*) from "${schema}"."user")::int as users,
       (select count(*) from "${schema}"."workspace" where "personal")::int as personal,
       (select count(*) from "${schema}"."workspace_member" where "role" = 'owner')::int as owners`,
  );
  const c = counts.rows[0];
  check(
    "one personal workspace and one owner membership per user",
    c.users === c.personal && c.users === c.owners,
    JSON.stringify(c),
  );

  // The row counts above would also pass if every resource had been put into the
  // *wrong* workspace. This is the check that says they went to their own owner's.
  const misplaced = await client.query(
    `select count(*)::int as n from (
       select t."ownerId", t."workspaceId" from "${schema}"."workflow" t
       union all select t."ownerId", t."workspaceId" from "${schema}"."run" t
       union all select t."ownerId", t."workspaceId" from "${schema}"."workflow_version" t
       union all select t."ownerId", t."workspaceId" from "${schema}"."credential" t
     ) r
     join "${schema}"."workspace" w on w."id" = r."workspaceId"
     where w."createdBy" is distinct from r."ownerId" or not w."personal"`,
  );
  check(
    "every resource landed in its own owner's personal workspace",
    misplaced.rows[0].n === 0,
    `${misplaced.rows[0].n} misplaced`,
  );

  // The backfill is re-applied to prove it is idempotent — a migration that cannot be
  // run twice cannot be resumed after a failure halfway through.
  for (const sql of statements(migrationFile("0005"))) {
    if (/^(insert|update)/i.test(sql)) await run(client, sql);
  }
  const again = await client.query(
    `select count(*)::int as n from "${schema}"."workspace" where "personal"`,
  );
  check("the backfill is idempotent", again.rows[0].n === c.personal, `${again.rows[0].n} workspaces`);

  console.log("\nForward — 0006 (contract):");
  for (const sql of statements(migrationFile("0006"))) await run(client, sql);
  check("0006 applied, NOT NULL reachable", true);

  // Named explicitly rather than "every column called workspaceId": `workspace_member`
  // has one too, it was born NOT NULL, and counting it made this check pass at 5 of 4.
  const scoped = ["workflow", "run", "workflow_version", "credential"];
  const notNull = await client.query(
    `select table_name from information_schema.columns
     where table_schema = $1 and column_name = 'workspaceId'
       and is_nullable = 'NO' and table_name = any($2)`,
    [schema, scoped],
  );
  check(
    "all four scoped columns are NOT NULL",
    notNull.rows.length === scoped.length,
    `only ${notNull.rows.map((r) => r.table_name).join(", ") || "none"}`,
  );

  const oldIndex = await client.query(
    `select count(*)::int as n from pg_indexes
     where schemaname = $1 and indexname = 'credential_owner_kind_label_idx'`,
    [schema],
  );
  check("the superseded credential index is gone", oldIndex.rows[0].n === 0);

  /* ---------------------------------------------------------------- *
   * Backward
   * ---------------------------------------------------------------- */
  console.log("\nBackward — the rollback:");
  for (const sql of statements(join(MIGRATIONS_DIR, "rollback_0005_0006.sql"), {
    breakpoints: false,
  })) {
    // The copy has no drizzle bookkeeping table to forget the migrations from.
    if (sql.includes("__drizzle_migrations")) continue;
    await run(client, sql);
  }
  check("the rollback applied", true);

  const after = await digest(client);
  const identical = TABLES.every(
    (t) => before[t].n === after[t].n && before[t].d === after[t].d,
  );
  check(
    "the copy is digest-identical to where it started",
    identical,
    TABLES.filter((t) => before[t].d !== after[t].d).join(", "),
  );

  const leftovers = await client.query(
    `select count(*)::int as n from information_schema.tables
     where table_schema = $1 and table_name in ('workspace', 'workspace_member')`,
    [schema],
  );
  check("both workspace tables are gone", leftovers.rows[0].n === 0);

  const restored = await client.query(
    `select count(*)::int as n from pg_indexes
     where schemaname = $1 and indexname = 'credential_owner_kind_label_idx'`,
    [schema],
  );
  check("the pre-19A credential index is back", restored.rows[0].n === 1);
} finally {
  // Dropped even when a check threw. A rehearsal that leaves its scaffolding behind on
  // a metered database is a rehearsal nobody runs twice.
  await client.query(`drop schema if exists "${schema}" cascade`);
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
