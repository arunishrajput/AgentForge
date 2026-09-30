import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

import { db, schema } from "@/db";
import { logError } from "@/lib/logging";
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
  events: {
    /**
     * A new account gets a personal workspace before it ever loads a page — Phase 19A.
     *
     * **It is a convenience, not a correctness requirement**, and that is on purpose.
     * If this event fails, or Auth.js changes its payload across a beta upgrade, the
     * scope resolver creates the workspace on the first request instead
     * (`lib/workspace/store.ts` → `ensurePersonalWorkspace`). Doing it here as well
     * means the common path is one fewer write on a metered database, and doing it
     * there as well means a failure here is invisible rather than fatal.
     *
     * Throwing from an event would fail the sign-in, so this swallows and logs. A user
     * who cannot sign in because a *workspace* could not be written would be a bad
     * trade for a thing the next request repairs by itself.
     */
    async createUser({ user }) {
      if (!user.id) return;
      try {
        const { createPersonalWorkspaceForNewUser } = await import("@/lib/workspace/store");
        await createPersonalWorkspaceForNewUser(user.id);
      } catch (error) {
        logError(
          "system.warning",
          "Could not create a personal workspace for a new user.",
          error,
          { userId: user.id },
        );
      }
    },
  },
  // Cloud Run terminates TLS at the proxy, so the forwarded host must be trusted.
  // AUTH_URL still wins as the canonical origin for callbacks.
  trustHost: true,
  pages: { signIn: "/" },
}));
