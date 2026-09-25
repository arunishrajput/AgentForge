import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

import { db, schema } from "@/db";
import { required } from "@/lib/env";

/**
 * Google OAuth only, database-backed sessions.
 *
 * Lazy config (the function form) keeps the database client out of module scope so
 * `next build` can import the route handler without a populated environment.
 *
 * `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are passed explicitly: Auth.js v5
 * auto-infers `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`, which are not the names in
 * CONTRACT.md. Verified in Phase 0.
 */
export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  adapter: DrizzleAdapter(db(), {
    usersTable: schema.users,
    accountsTable: schema.accounts,
    sessionsTable: schema.sessions,
    verificationTokensTable: schema.verificationTokens,
  }),
  session: { strategy: "database" },
  providers: [
    Google({
      clientId: required("GOOGLE_CLIENT_ID"),
      clientSecret: required("GOOGLE_CLIENT_SECRET"),
    }),
  ],
  // Cloud Run terminates TLS at the proxy, so the forwarded host must be trusted.
  // AUTH_URL still wins as the canonical origin for callbacks.
  trustHost: true,
  pages: { signIn: "/" },
}));
