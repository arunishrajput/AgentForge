/**
 * Mints a real database session row for the first existing user and prints the
 * cookie value, so a browser can be pointed at the app without driving Google
 * OAuth by hand. Same mechanism as `verify-api.mjs` — a genuine session row read
 * by `auth()`, not a test-only bypass in the app.
 *
 *   node --env-file=.env scripts/mint-session.mjs           # mint, print token
 *   node --env-file=.env scripts/mint-session.mjs --revoke <token>
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);

if (process.argv[2] === "--revoke") {
  await sql.query('delete from "session" where "sessionToken" = $1', [process.argv[3]]);
  console.log("revoked");
  process.exit(0);
}

const [user] = await sql.query('select id, email from "user" order by "id" limit 1');
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
