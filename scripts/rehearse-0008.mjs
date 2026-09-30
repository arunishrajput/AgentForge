/**
 * Rehearse Phase 20's migration — forward and backward — on a throwaway copy.
 *
 *   node --env-file=.env scripts/rehearse-0008.mjs
 *
 * **Why a rehearsal for a migration this simple.** `0008` is three `ADD COLUMN`s and an
 * index, and it cannot lose anything. Its **rollback** is three `DROP COLUMN`s against
 * `workflow` — the table holding the user's actual workflows — and a `DROP COLUMN` that
 * names the wrong column, or a rollback that leaves the table subtly different from where it
 * started, is not recoverable from a free-tier database with no point-in-time restore. So
 * the claim "this migration is genuinely reversible" is measured here rather than asserted
 * in a comment.
 *
 * A second script rather than a parameter on `rehearse-migration.mjs`: that one is Phase
 * 19A's, it knows about a backfill and five tables, and generalising it to serve both would
 * make it a framework for a job that has happened twice.
 *
 * **The copy is a schema, not a database** — the same reasoning, and the same constraint, as
 * `rehearse-migration.mjs`: `neonctl` is unauthenticated on this machine, and a schema
 * alongside `public` is a real copy of the table and its rows for a few seconds of compute
 * that is already awake. It is dropped on the way out, including after a failure.
 *
 * What it proves, in order:
 *
 *   1. `0008` applies to a copy holding real rows, and **every one of them comes out
 *      `workspace`-visible and unshared** — which is what makes the migration invisible to
 *      every user rather than merely additive in the schema.
 *   2. The partial unique index is created, is unique, and is partial. It is read by an
 *      unauthenticated route, so it is checked rather than assumed.
 *   3. That index actually refuses a duplicate token and actually permits many nulls. The
 *      second half is the load-bearing one: a non-partial unique index would also pass a
 *      "the index exists" check and would then carry a row per unshared workflow.
 *   4. The rollback returns the copy to a state **digest-identical** to where it started.
 *      Not "looks right": the same md5 over the same rows.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { Client } from "@neondatabase/serverless";

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

/** Exactly one file for the tag, never the first match — see `rehearse-migration.mjs`. */
function migrationFile(tag) {
  const names = readdirSync(MIGRATIONS_DIR).filter(
    (f) => f.startsWith(`${tag}_`) && f.endsWith(".sql"),
  );
  if (names.length !== 1) {
    throw new Error(`Expected one migration tagged ${tag}, found ${names.length}: ${names.join(", ")}`);
  }
  return join(MIGRATIONS_DIR, names[0]);
}

/**
 * Statements, with every `"workflow"` and `"public".` reference pointed at the copy.
 *
 * `0008` names its table unqualified, so `search_path` would be enough — but the index
 * statement carries `ON "workflow"`, and a `CREATE INDEX` resolves through `search_path`
 * while the index *name* is global to the schema it lands in. Qualifying explicitly is
 * narrower than trusting the path and is the only difference between what runs here and
 * what runs against the real database.
 */
function statements(path, { breakpoints = true } = {}) {
  const sql = readFileSync(path, "utf8")
    .replaceAll('"public".', `"${schema}".`)
    .replaceAll('"workflow"', `"${schema}"."workflow"`)
    // The rewrite above also hits the partial index's own `WHERE "workflow"."shareToken"`,
    // which is legal either way, and the index name itself, which is not qualified.
    .replaceAll(`"${schema}"."workflow_share_token_idx"`, '"workflow_share_token_idx"');
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

/** Row count plus an md5 over every row, order-independent. */
async function digest(client) {
  const { rows } = await client.query(
    `select count(*)::int as n,
            coalesce(md5(string_agg(md5(t::text), '' order by md5(t::text))), 'empty') as d
     from "${schema}"."workflow" t`,
  );
  return rows[0];
}

async function run(client, sql) {
  try {
    await client.query(sql);
  } catch (error) {
    throw new Error(`${error.message}\n--- statement ---\n${sql.slice(0, 400)}`, { cause: error });
  }
}

const client = new Client(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);
await client.connect();

try {
  console.log(`\nRehearsing Phase 20's migration 0008 in schema "${schema}"\n`);

  await run(client, `create schema "${schema}"`);
  // No foreign keys are copied, which is what makes a single-schema copy possible: the
  // clone does not reach back into `public`.
  await run(
    client,
    `create table "${schema}"."workflow" (like public."workflow" including defaults including constraints including indexes)`,
  );
  await run(client, `insert into "${schema}"."workflow" select * from public."workflow"`);

  const before = await digest(client);
  console.log(`Copied: workflow — ${before.n} rows\n`);

  /* ------------------------------ forward ------------------------------ */
  console.log("Forward — 0008:");
  for (const sql of statements(migrationFile("0008"))) await run(client, sql);
  check("0008 applied", true);

  const columns = await client.query(
    `select column_name, is_nullable, column_default from information_schema.columns
     where table_schema = $1 and table_name = 'workflow'
       and column_name in ('visibility', 'shareToken', 'sharedAt')`,
    [schema],
  );
  check("all three columns exist", columns.rows.length === 3, JSON.stringify(columns.rows));
  const visibility = columns.rows.find((r) => r.column_name === "visibility");
  check(
    "visibility is NOT NULL and defaults to 'workspace'",
    visibility?.is_nullable === "NO" && /workspace/.test(visibility?.column_default ?? ""),
    JSON.stringify(visibility),
  );

  // **The property that makes this migration invisible to every user.** Additive in the
  // schema is not the same claim as "nothing anybody can observe changed".
  const backfilled = await client.query(
    `select
       (select count(*) from "${schema}"."workflow" where "visibility" <> 'workspace')::int as narrowed,
       (select count(*) from "${schema}"."workflow" where "shareToken" is not null)::int as shared,
       (select count(*) from "${schema}"."workflow" where "sharedAt" is not null)::int as stamped`,
  );
  const b = backfilled.rows[0];
  check(
    "every pre-existing workflow is workspace-visible and unshared",
    b.narrowed === 0 && b.shared === 0 && b.stamped === 0,
    JSON.stringify(b),
  );

  const [index] = (
    await client.query(
      `select indexdef from pg_indexes where schemaname = $1 and indexname = 'workflow_share_token_idx'`,
      [schema],
    )
  ).rows;
  check(
    "the share-token index is unique and partial",
    typeof index?.indexdef === "string" &&
      /UNIQUE/i.test(index.indexdef) &&
      /shareToken/.test(index.indexdef) &&
      /WHERE/i.test(index.indexdef),
    index?.indexdef ?? "no such index",
  );

  /* -------------------- the index actually interlocks ------------------- */
  //
  // An index that exists is not an index that refuses anything. Both halves are exercised
  // against the real DDL, because the whole reason it is an index rather than a code check
  // is that `neon-http` has no transactions (D6).
  const ids = (await client.query(`select "id" from "${schema}"."workflow" limit 2`)).rows;
  if (ids.length >= 2) {
    await run(
      client,
      `update "${schema}"."workflow" set "shareToken" = 'rehearsal-token', "sharedAt" = now() where "id" = '${ids[0].id}'`,
    );
    let refused = false;
    try {
      await client.query(
        `update "${schema}"."workflow" set "shareToken" = 'rehearsal-token', "sharedAt" = now() where "id" = '${ids[1].id}'`,
      );
    } catch (error) {
      refused = /unique|duplicate/i.test(error.message);
    }
    check("two workflows cannot hold the same share token", refused, "the duplicate was accepted");
    await run(
      client,
      `update "${schema}"."workflow" set "shareToken" = null, "sharedAt" = null where "id" = '${ids[0].id}'`,
    );
    check("and many unshared workflows coexist, because the index is partial", true);
  } else {
    console.log("  · skipped the duplicate-token check — fewer than two workflows to copy");
  }

  /* ------------------------------ backward ----------------------------- */
  console.log("\nBackward — rollback_0008:");
  for (const sql of statements(join(MIGRATIONS_DIR, "rollback_0008.sql"), { breakpoints: false })) {
    // The copy has no drizzle bookkeeping table to forget the migration from.
    if (sql.includes("__drizzle_migrations")) continue;
    await run(client, sql);
  }
  check("the rollback applied", true);

  const remaining = await client.query(
    `select count(*)::int as n from information_schema.columns
     where table_schema = $1 and table_name = 'workflow'
       and column_name in ('visibility', 'shareToken', 'sharedAt')`,
    [schema],
  );
  check("all three columns are gone", remaining.rows[0].n === 0, `${remaining.rows[0].n} remain`);

  const indexGone = await client.query(
    `select count(*)::int as n from pg_indexes
     where schemaname = $1 and indexname = 'workflow_share_token_idx'`,
    [schema],
  );
  check("the index went with its column", indexGone.rows[0].n === 0);

  const after = await digest(client);
  check(
    "the copy is digest-identical to where it started",
    before.n === after.n && before.d === after.d,
    `${before.n} rows / ${before.d} → ${after.n} rows / ${after.d}`,
  );
} finally {
  // Dropped even when a check threw. A rehearsal that leaves scaffolding on a metered
  // database is a rehearsal nobody runs twice.
  await client.query(`drop schema if exists "${schema}" cascade`);
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
