/**
 * Does the database actually match what this repository says it is?
 *
 *   node --env-file=.env scripts/verify-schema.mjs
 *   node --env-file=.env scripts/verify-schema.mjs --repair   # writes; see below
 *
 * **Written in Phase 19A because two silent drifts were found there, and neither was
 * detectable from the repository alone.** Both had been true for days, through several
 * phases that each reported themselves verified:
 *
 *   1. **`credential_owner_kind_label_idx` was missing from the deployed database**,
 *      although migration `0001` creates it and every other index in that migration was
 *      present. `putCredential` upserts with `ON CONFLICT ("ownerId", "kind", "label")`
 *      and Postgres needs a matching unique index to plan that statement at all, so
 *      **every credential write answered 42P10 → HTTP 500**: saving an API key,
 *      connecting Google, storing a Discord webhook. The API suites never caught it
 *      because they read credentials far more often than they write one, and the one
 *      route that does write reported the failure as "Could not reach Discord."
 *
 *   2. **`drizzle.__drizzle_migrations` held three rows while five migrations were
 *      physically applied.** `0003` and `0004` were in the database and not in the
 *      ledger, so the next `drizzle-kit migrate` would have tried to re-apply them and
 *      failed on `CREATE TABLE ... already exists` — with `0005` and `0006` behind it.
 *
 * The lesson is the Phase 12 lesson in a new place: **a green suite proves the code, and
 * says nothing about the shape of the database it is talking to.** This closes that gap
 * by comparing three things that should never disagree — drizzle's own final snapshot,
 * its migration journal, and `information_schema`.
 *
 * `--repair` does exactly one thing, and only when the evidence supports it: it inserts
 * the ledger rows for migrations whose DDL is **verified present in the database**. It
 * never runs DDL, never drops anything, and refuses to record a migration it cannot see
 * the effects of. Undo it by deleting the rows it names.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { neon } from "@neondatabase/serverless";

const MIGRATIONS_DIR = "drizzle";
const repair = process.argv.includes("--repair");

const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);

let passed = 0;
const failures = [];

function check(label, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label);
    console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`);
  }
}

/**
 * How drizzle identifies a migration it has run: sha256 over the raw file, and the
 * journal's `when` stored as `created_at`. Verified against the three rows that were
 * already in the ledger — all three matched, which is what makes `--repair` able to
 * write rows drizzle will accept rather than rows that merely look right.
 */
function migrationLedgerEntries() {
  const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8"));
  return journal.entries.map((entry) => {
    const file = readdirSync(MIGRATIONS_DIR).find((f) => f === `${entry.tag}.sql`);
    if (!file) throw new Error(`Journal names ${entry.tag} but no such .sql file exists`);
    return {
      tag: entry.tag,
      when: String(entry.when),
      hash: createHash("sha256").update(readFileSync(join(MIGRATIONS_DIR, file), "utf8")).digest("hex"),
    };
  });
}

/** The newest snapshot is what the schema currently declares. */
function latestSnapshot() {
  const names = readdirSync(join(MIGRATIONS_DIR, "meta"))
    .filter((f) => f.endsWith("_snapshot.json"))
    .sort();
  return JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta", names[names.length - 1]), "utf8"));
}

console.log("\nSchema drift check — repository vs. the live database\n");

/* ------------------------------------------------------------------ *
 * 1. The migration ledger
 * ------------------------------------------------------------------ */
console.log("Migration ledger:");

const expected = migrationLedgerEntries();
const applied = await sql`select id, hash, created_at from drizzle.__drizzle_migrations order by created_at`;
const appliedByHash = new Map(applied.map((row) => [row.hash, row]));

const missing = expected.filter((entry) => !appliedByHash.has(entry.hash));
check(
  `all ${expected.length} migrations are recorded as applied`,
  missing.length === 0,
  missing.length ? `not recorded: ${missing.map((m) => m.tag).join(", ")}` : undefined,
);

// A recorded hash with no file is the other direction of the same problem: an edited
// migration, or one deleted after it ran.
const unknown = applied.filter((row) => !expected.some((e) => e.hash === row.hash));
check(
  "every recorded migration matches a file in this repository",
  unknown.length === 0,
  unknown.length ? `${unknown.length} recorded hash(es) match no file — a migration was edited or removed after it ran` : undefined,
);

/* ------------------------------------------------------------------ *
 * 2. Tables, columns and indexes against the snapshot
 * ------------------------------------------------------------------ */
console.log("\nDeclared shape vs. information_schema:");

const snapshot = latestSnapshot();
const declared = Object.values(snapshot.tables).filter((t) => (t.schema || "public") === "public");

const liveColumns = await sql`
  select table_name, column_name, is_nullable
  from information_schema.columns where table_schema = 'public'`;
const liveIndexes = await sql`
  select tablename, indexname from pg_indexes where schemaname = 'public'`;

const columnKey = new Map();
for (const row of liveColumns) columnKey.set(`${row.table_name}.${row.column_name}`, row.is_nullable);
const indexNames = new Set(liveIndexes.map((row) => row.indexname));
const liveTables = new Set(liveColumns.map((row) => row.table_name));

const missingTables = declared.filter((t) => !liveTables.has(t.name)).map((t) => t.name);
check("every declared table exists", missingTables.length === 0, missingTables.join(", "));

const missingColumns = [];
const wrongNullability = [];
for (const table of declared) {
  if (!liveTables.has(table.name)) continue;
  for (const column of Object.values(table.columns)) {
    const key = `${table.name}.${column.name}`;
    const live = columnKey.get(key);
    if (live === undefined) {
      missingColumns.push(key);
      continue;
    }
    const declaredNullable = column.notNull ? "NO" : "YES";
    if (live !== declaredNullable) wrongNullability.push(`${key} is ${live === "NO" ? "NOT NULL" : "nullable"} in the database, declared ${declaredNullable === "NO" ? "NOT NULL" : "nullable"}`);
  }
}
check("every declared column exists", missingColumns.length === 0, missingColumns.join(", "));
check("every column's nullability matches", wrongNullability.length === 0, wrongNullability.join("\n      "));

// The check that would have caught the credential defect.
const missingIndexes = [];
for (const table of declared) {
  for (const index of Object.keys(table.indexes ?? {})) {
    if (!indexNames.has(index)) missingIndexes.push(`${table.name}.${index}`);
  }
}
check(
  "every declared index exists",
  missingIndexes.length === 0,
  missingIndexes.length
    ? `${missingIndexes.join(", ")}\n      An absent unique index does not merely slow a query down — an ON CONFLICT naming it fails to plan at all.`
    : undefined,
);

/* ------------------------------------------------------------------ *
 * 3. Repair, if asked and if the evidence supports it
 * ------------------------------------------------------------------ */
if (repair && missing.length > 0) {
  console.log("\nRepair — recording migrations whose effects are already in the database:");

  for (const entry of missing) {
    // Only ever recorded when the DDL is visibly present. A migration recorded without
    // its effects is worse than one that is merely unrecorded: the first silently never
    // runs, the second fails loudly.
    const evidence = {
      "0003_omniscient_norman_osborn": () => columnKey.has("run.dispatchToken"),
      "0004_wonderful_bloodscream": () => liveTables.has("workflow_version") && columnKey.has("workflow.version"),
    }[entry.tag];

    if (!evidence) {
      console.log(`  – ${entry.tag}: no evidence rule for this migration, leaving it alone`);
      continue;
    }
    if (!evidence()) {
      console.log(`  ✗ ${entry.tag}: its DDL is NOT present — run it rather than recording it`);
      continue;
    }

    await sql`
      insert into drizzle.__drizzle_migrations (hash, created_at)
      values (${entry.hash}, ${entry.when})`;
    console.log(`  ✓ ${entry.tag}: recorded (hash ${entry.hash.slice(0, 12)}…, created_at ${entry.when})`);
  }
} else if (missing.length > 0) {
  console.log("\n  Run with --repair to record migrations whose DDL is already present.");
}

console.log(`\n${passed} passed, ${failures.length} failed\n`);
process.exit(failures.length === 0 ? 0 : 1);
