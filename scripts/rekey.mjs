/**
 * Re-key every stored credential — **the operator path for a root key rotation.**
 *
 *   node --env-file=.env --import ./scripts/test-register.mjs scripts/rekey.mjs [options]
 *
 *   --dry-run     read and verify every row, write nothing. Always run this first
 *   --to-legacy   convert **back** to the Chapter 1 single-layer shape under
 *                 ENCRYPTION_KEY. Step 1 of rolling the deployment back past Phase 21,
 *                 and the only thing that makes `drizzle/rollback_0009.sql` survivable
 *
 * **Why a script when `POST /api/credentials/rekey` exists.** The route is scoped to one
 * workspace, because that is the only authority a signed-in user has. A root key is global,
 * so rotating it means moving *every* workspace's credentials — which is an operator action
 * against the database, with no session and no workspace. Both call the same
 * `rekeyCredentials`, so there is one implementation of the loop and one place the
 * verify-after-write lives.
 *
 * **It is safe to interrupt.** Every credential is an independent single-row `UPDATE` that
 * records which root key wraps it, so a run killed halfway leaves a database where some rows
 * are on the new version and some on the old — and every one of them still decrypts. Running
 * it again finishes the job. There is no window in which the database is inconsistent, which
 * is why this needs no maintenance mode.
 *
 * **It needs the root key it is moving *to*, and the one every row is moving *from*.**
 * `ENCRYPTION_KEY` comes from `.env`. Reaching Secret Manager from a machine with no metadata
 * server needs a token and a project supplied by hand:
 *
 *     ROOT_KEY_SECRET=agentforge-root-key \
 *     GCP_PROJECT=agentforge-hackathon-2026 \
 *     GCP_ACCESS_TOKEN="$(gcloud auth print-access-token)" \
 *     node --env-file=.env --import ./scripts/test-register.mjs scripts/rekey.mjs --dry-run
 *
 * If Secret Manager cannot be reached the script reports that and **writes nothing** — every
 * row stays readable under the key it already names.
 *
 * The full procedure, including where this sits in it, is `SECURITY.md` → *Rotating the root
 * key*.
 */
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const legacy = args.has("--to-legacy");

for (const arg of args) {
  if (!["--dry-run", "--to-legacy"].includes(arg)) {
    console.error(`Unknown option ${arg}. Supported: --dry-run, --to-legacy`);
    process.exit(2);
  }
}

// Run with `--import ./scripts/test-register.mjs`, which installs the resolve hook that lets
// Node load the TypeScript sources and their `@/` imports.
const { rekeyCredentials } = await import("../src/lib/credentials/rekey.ts");
const { rootKeyProvider } = await import("../src/lib/crypto/index.ts");

const direction = legacy ? "back to the Chapter 1 shape under ENCRYPTION_KEY" : "to the current root key";
console.log(`\nRe-keying every credential ${direction}.`);
console.log(`Root key provider: ${rootKeyProvider()}`);
if (dryRun) console.log("DRY RUN — nothing will be written.\n");
else console.log("");

let outcome;
try {
  outcome = await rekeyCredentials({ legacy, dryRun });
} catch (error) {
  // A failure here is the root key being unreachable, which is the one case where writing
  // nothing is unambiguously right: every row is still readable under the key it names.
  console.error(`\nCould not start: ${error instanceof Error ? error.message : error}`);
  console.error("\nNothing was written. Every credential is still readable under its current key.\n");
  process.exit(1);
}

console.log(`Target:     ${outcome.target}`);
console.log(`Examined:   ${outcome.examined}`);
console.log(`Re-wrapped: ${outcome.rewrapped}   (data key moved, ciphertext untouched)`);
console.log(`Converted:  ${outcome.converted}   (Chapter 1 row given a data key)`);
console.log(`Unchanged:  ${outcome.unchanged}   (already on the target)`);

if (outcome.failures.length > 0) {
  console.log(`\n${outcome.failures.length} FAILED:`);
  for (const failure of outcome.failures) {
    console.log(`  ✗ ${failure.kind}/${failure.label} — ${failure.reason}`);
  }
  // Deliberately not fatal-on-first: the other rows were done, and they are still readable.
  // What must not happen is exiting 0 with a row left behind that nobody was told about.
  console.log(
    "\nThe rows above are still on their previous key and still decrypt. Fix the cause and run again.\n",
  );
  process.exit(1);
}

console.log(
  dryRun
    ? "\nEvery credential decrypts and would move cleanly. Run again without --dry-run.\n"
    : "\nEvery credential was re-keyed and verified to decrypt to its original value.\n",
);
process.exit(0);
