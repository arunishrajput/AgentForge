import { auth } from "@/auth";
import { required } from "@/lib/env";
import { appReturn, authorizeUrl } from "@/lib/integrations/google";
import { mintState, stateCookie } from "@/lib/integrations/oauth-state";
import { googleOAuthConfig } from "@/lib/integrations/store";

export const dynamic = "force-dynamic";

/**
 * Starts Google incremental consent.
 *
 * A `GET` that answers `302`, because it is reached by a link the user clicks — the
 * browser has to leave for accounts.google.com, and that cannot be done from a
 * `fetch`. Signed out, it redirects home rather than answering a JSON 401, since the
 * caller here is a navigation and not a client.
 *
 * The origin and the cookie's `Secure` flag come from `APP_BASE_URL`, not from the
 * request — see `appReturn`. The request's own URL is the container's bind address.
 */
export async function GET() {
  const app = appReturn(required("APP_BASE_URL"), "/");

  const session = await auth();
  if (!session?.user?.id) {
    return Response.redirect(app.location, 302);
  }

  const state = mintState();

  return new Response(null, {
    status: 302,
    headers: {
      location: authorizeUrl(googleOAuthConfig(), state),
      "set-cookie": stateCookie(state, app.secure),
      // The redirect carries a one-time state; a cached copy would replay a spent one.
      "cache-control": "no-store",
    },
  });
}
