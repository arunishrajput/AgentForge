/**
 * Rehearse Phase 21's migration — forward, then the rollback's refusal, then backward — on
 * a throwaway copy.
 *
 *   node --env-file=.env scripts/rehearse-0009.mjs
 *
 * **Why a rehearsal, when `0009` is one `CREATE TABLE` and seven additive columns.** Because
 * its rollback is not the mirror image of it. After a re-key, a credential's data key lives
 * in exactly one place — the `wrappedKey` column — so `DROP COLUMN "wrappedKey"` discards the
 * only copy of the key and leaves the ciphertext permanently unreadable. Every stored
 * credential in the product, destroyed by one statement that looks like the other six.
 *
 * `rollback_0009.sql` therefore opens with a `DO` block that counts enveloped rows and raises
 * rather than proceeding. **A guard that does not fire is worse than no guard**, because it
 * is trusted. So the third section below deliberately puts an envelope on a row and asserts
 * the rollback refuses to run at all.
 *
 * What it proves, in order:
 *
 *   1. `0009` applies to a copy holding the real `credential` and `workflow` rows, and
 *      **every one of them comes out in the Chapter 1 shape** — no envelope, no rotation
 *      count, no rotation timestamp. Additive in the schema is not the same claim as
 *      "nothing any user or any serving revision can observe changed".
 *   2. A write shaped the way the **previous revision** writes one — naming none of the new
 *      columns — still succeeds. That is what "the old revision kept serving" means, and it
 *      is a property of the defaults rather than of the code.
 *   3. `credential_event` exists with both its indexes, and `ON DELETE SET NULL` really
 *      keeps an event after the credential it describes is deleted. The audit log's whole
 *      value is that it survives a revocation.
 *   4. **The rollback refuses while any row is enveloped**, naming the count.
 *   5. With the envelopes cleared, the rollback runs and leaves `credential` and `workflow`
 *      **digest-identical** to where they started. Not "looks right": the same md5 over the
 *      same rows.
 *
 * The copy is a schema rather than a database, for `rehearse-migration.mjs`'s reasons:
 * `neonctl` is unauthenticated on this machine, and a schema alongside `public` is a real
 * copy of the tables and their rows for a few seconds of compute that is already awake. It
 * is dropped on the way out, including after a failure.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { Client } from "@neondatabase/serverless";

const MIGRATIONS_DIR = "drizzle";
const schema = `rehearsal_${createHash("sha256").update(String(Date.now())).digest("hex").slice(0, 10)}`;

/**
 * Every table `0009` or its rollback names, plus the three the new table's foreign keys
 * point at. FKs are **not** copied by `like ... including constraints`, which is what makes
 * a single-schema copy possible at all — the clone never reaches back into `public`.
 */
const COPIED = ["user", "workspace", "workflow", "run", "credential"];

/** The two whose rows must be byte-identical after the rollback. */
const COMPARED = ["credential", "workflow"];

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
    throw new Error(
      `Expected one migration tagged ${tag}, found ${names.length}: ${names.join(", ")}`,
    );
  }
  return join(MIGRATIONS_DIR, names[0]);
}

/**
 * Statements, with every reference pointed at the copy.
 *
 * Both files name their tables bare (`ALTER TABLE "credential"`) and their FK targets
 * qualified (`"public"."credential"`), so both forms are rewritten. Index *names* are global
 * to the schema they land in and must stay unqualified, which is why they are put back.
 */
function statements(path, { breakpoints = true } = {}) {
  // **The `"public".` prefix is stripped first, not rewritten.** Rewriting it and then
  // qualifying bare table names in a second pass double-qualifies the FK targets into
  // `"copy"."copy"."credential"`, which Postgres reads as a cross-database reference and
  // refuses. Stripping leaves every table name bare, so the loop below qualifies each one
  // exactly once.
  let sql = readFileSync(path, "utf8").replaceAll('"public".', "");
  for (const table of COPIED.concat("credential_event")) {
    sql = sql.replaceAll(`"${table}"`, `"${schema}"."${table}"`);
  }
  sql = sql
    // Index names are global to the schema they land in and must stay unqualified.
    .replaceAll(`"${schema}"."credential_event_workspace_idx"`, '"credential_event_workspace_idx"')
    .replaceAll(`"${schema}"."credential_event_credential_idx"`, '"credential_event_credential_idx"')
    // Constraint names embed the table names the loop just rewrote; so do the `DO` block's
    // own identifiers, which are bare SQL inside a string literal.
    .replace(/CONSTRAINT "[^"]*"/g, (match) => match.replaceAll(`"${schema}"."`, '"'));

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
async function digest(client, table) {
  const { rows } = await client.query(
    `select count(*)::int as n,
            coalesce(md5(string_agg(md5(t::text), '' order by md5(t::text))), 'empty') as d
     from "${schema}"."${table}" t`,
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
  console.log(`\nRehearsing Phase 21's migration 0009 in schema "${schema}"\n`);

  await run(client, `create schema "${schema}"`);
  for (const table of COPIED) {
    await run(
      client,
      `create table "${schema}"."${table}" (like public."${table}" including defaults including constraints including indexes)`,
    );
    await run(client, `insert into "${schema}"."${table}" select * from public."${table}"`);
  }

  const before = {};
  for (const table of COMPARED) before[table] = await digest(client, table);
  console.log(
    `Copied: ${COMPARED.map((t) => `${t} — ${before[t].n} rows`).join(", ")}\n`,
  );

  /* ------------------------------ forward ------------------------------ */
  console.log("Forward — 0009:");
  for (const sql of statements(migrationFile("0009"))) await run(client, sql);
  check("0009 applied", true);

  const columns = await client.query(
    `select column_name, is_nullable, column_default from information_schema.columns
     where table_schema = $1 and table_name = 'credential'
       and column_name in ('wrappedKey','wrapIv','wrapAuthTag','keyVersion','rotatedAt','rotationCount')`,
    [schema],
  );
  check("all six credential columns exist", columns.rows.length === 6, JSON.stringify(columns.rows));

  const count = columns.rows.find((r) => r.column_name === "rotationCount");
  check(
    "rotationCount is NOT NULL and defaults to 0",
    count?.is_nullable === "NO" && /0/.test(count?.column_default ?? ""),
    JSON.stringify(count),
  );
  check(
    "the four envelope columns are nullable — the reason the migration was safe",
    columns.rows
      .filter((r) => r.column_name !== "rotationCount")
      .every((r) => r.is_nullable === "YES"),
    JSON.stringify(columns.rows),
  );

  // **The property that makes this migration invisible.** Every existing credential must come
  // out in exactly the Chapter 1 shape, so the previous revision reads it unchanged.
  const untouched = (
    await client.query(
      `select
         (select count(*) from "${schema}"."credential" where "wrappedKey" is not null)::int as enveloped,
         (select count(*) from "${schema}"."credential" where "keyVersion" is not null)::int as versioned,
         (select count(*) from "${schema}"."credential" where "rotationCount" <> 0)::int as rotated,
         (select count(*) from "${schema}"."credential" where "rotatedAt" is not null)::int as stamped,
         (select count(*) from "${schema}"."workflow" where "webhookTokenRotatedAt" is not null)::int as webhooks`,
    )
  ).rows[0];
  check(
    "every pre-existing credential is still legacy, and no webhook token looks rotated",
    Object.values(untouched).every((n) => n === 0),
    JSON.stringify(untouched),
  );

  /* ------------- the previous revision can still write ------------------ */
  //
  // What "the old revision kept serving" actually means: a write naming none of the new
  // columns. That is a property of the defaults, not of the application code.
  const [owner] = (await client.query(`select "id" from "${schema}"."user" limit 1`)).rows;
  const [workspace] = (await client.query(`select "id" from "${schema}"."workspace" limit 1`)).rows;
  if (owner && workspace) {
    await run(
      client,
      `insert into "${schema}"."credential"
         ("id","ownerId","workspaceId","kind","label","ciphertext","iv","authTag","metadata")
       values ('rehearsal-cred','${owner.id}','${workspace.id}','rehearsal.kind','default','ct','iv','tag','{}')`,
    );
    const [written] = (
      await client.query(
        `select "rotationCount", "wrappedKey" from "${schema}"."credential" where "id" = 'rehearsal-cred'`,
      )
    ).rows;
    check(
      "a pre-Phase-21 shaped insert still succeeds, and lands legacy",
      written?.rotationCount === 0 && written?.wrappedKey === null,
      JSON.stringify(written),
    );
  } else {
    check("a pre-Phase-21 shaped insert still succeeds", false, "no user or workspace row to own it");
  }

  /* ---------------------- the audit log's indexes ----------------------- */
  const indexes = (
    await client.query(`select indexname, indexdef from pg_indexes where schemaname = $1 and tablename = 'credential_event'`, [schema])
  ).rows;
  check(
    "both credential_event indexes exist and are descending on `at`",
    ["credential_event_workspace_idx", "credential_event_credential_idx"].every((name) => {
      const found = indexes.find((i) => i.indexname === name);
      return found && /DESC/i.test(found.indexdef);
    }),
    JSON.stringify(indexes.map((i) => i.indexname)),
  );

  // The audit log's whole value is that it survives the thing it describes. `ON DELETE SET
  // NULL` plus the denormalised kind/label is what makes a revocation event still readable.
  if (workspace) {
    await run(
      client,
      `insert into "${schema}"."credential_event" ("id","credentialId","workspaceId","event","kind","label")
       values ('rehearsal-event','rehearsal-cred','${workspace.id}','used','rehearsal.kind','default')`,
    );
    await run(client, `delete from "${schema}"."credential" where "id" = 'rehearsal-cred'`);
    const [survivor] = (
      await client.query(
        `select "credentialId","kind","label" from "${schema}"."credential_event" where "id" = 'rehearsal-event'`,
      )
    ).rows;
    check(
      "an event outlives the credential it describes, still naming what it was",
      survivor?.credentialId === null && survivor?.kind === "rehearsal.kind",
      JSON.stringify(survivor),
    );
    await run(client, `delete from "${schema}"."credential_event" where "id" = 'rehearsal-event'`);
  }

  /* ------------- the rollback refuses while data is at risk ------------- */
  console.log("\nThe rollback's guard:");
  const [victim] = (await client.query(`select "id" from "${schema}"."credential" limit 1`)).rows;
  if (victim) {
    await run(
      client,
      `update "${schema}"."credential" set "wrappedKey" = 'x', "wrapIv" = 'y', "wrapAuthTag" = 'z', "keyVersion" = 'sm:1' where "id" = '${victim.id}'`,
    );

    let refused = null;
    try {
      for (const sql of statements("drizzle/rollback_0009.sql")) await run(client, sql);
    } catch (error) {
      refused = error.message;
    }
    check(
      "the rollback refuses while a credential is enveloped, and says how many",
      refused !== null && /still enveloped/i.test(refused),
      refused ?? "the rollback ran and would have destroyed a credential",
    );
    check(
      "and it dropped nothing — the guard aborts the whole script",
      (
        await client.query(
          `select count(*)::int as n from information_schema.columns
           where table_schema = $1 and table_name = 'credential' and column_name = 'wrappedKey'`,
          [schema],
        )
      ).rows[0].n === 1,
      "wrappedKey was dropped despite the guard",
    );

    // Step 1 of the documented rollback: back to the Chapter 1 shape.
    await run(
      client,
      `update "${schema}"."credential" set "wrappedKey" = null, "wrapIv" = null, "wrapAuthTag" = null, "keyVersion" = null`,
    );
  }

  /* ------------------------------ backward ----------------------------- */
  console.log("\nBackward — rollback_0009:");
  // `rotationCount` and `rotatedAt` are dropped too, so the pre-migration digest can only
  // match if nothing else about the rows moved. Reset them the way the documented procedure
  // leaves them untouched — they are dropped, not compared.
  for (const sql of statements("drizzle/rollback_0009.sql")) await run(client, sql);
  check("rollback applied", true);

  const gone = (
    await client.query(
      `select count(*)::int as n from information_schema.columns
       where table_schema = $1
         and ((table_name = 'credential' and column_name in ('wrappedKey','wrapIv','wrapAuthTag','keyVersion','rotatedAt','rotationCount'))
           or (table_name = 'workflow' and column_name = 'webhookTokenRotatedAt'))`,
      [schema],
    )
  ).rows[0];
  check("every added column is gone", gone.n === 0, JSON.stringify(gone));

  const table = (
    await client.query(
      `select count(*)::int as n from information_schema.tables where table_schema = $1 and table_name = 'credential_event'`,
      [schema],
    )
  ).rows[0];
  check("credential_event is gone", table.n === 0, JSON.stringify(table));

  for (const name of COMPARED) {
    const after = await digest(client, name);
    check(
      `${name} is digest-identical to where it started`,
      after.n === before[name].n && after.d === before[name].d,
      `before ${before[name].n}/${before[name].d.slice(0, 12)} after ${after.n}/${after.d.slice(0, 12)}`,
    );
  }
} finally {
  await client.query(`drop schema if exists "${schema}" cascade`);
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
