/**
 * Mints a real database session row for the verification account (`verify-user.mjs`: the
 * deployment's owner, or `VERIFY_USER_EMAIL`) and prints the
 * cookie value, so a browser can be pointed at the app without driving Google
 * OAuth by hand. Same mechanism as `verify-api.mjs` — a genuine session row read
 * by `auth()`, not a test-only bypass in the app.
 *
 *   node --env-file=.env scripts/mint-session.mjs           # mint, print token
 *   node --env-file=.env scripts/mint-session.mjs --revoke <token>
 */
import { neon } from "@neondatabase/serverless";
import { verificationUser } from "./verify-user.mjs";

const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);

if (process.argv[2] === "--revoke") {
  await sql.query('delete from "session" where "sessionToken" = $1', [process.argv[3]]);
  console.log("revoked");
  process.exit(0);
}

const user = await verificationUser(sql);
if (!user) {
  console.error('No user row exists — sign in through the browser once first.');
  process.exit(1);
}

const token = crypto.randomUUID() + crypto.randomUUID();
await sql.query(
  'insert into "session" ("sessionToken", "userId", "expires") values ($1, $2, $3)',
  [token, user.id, new Date(Date.now() + 2 * 60 * 60 * 1000)],
);

console.log(JSON.stringify({ token, user: user.email }));
