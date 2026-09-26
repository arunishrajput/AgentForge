import { auth } from "@/auth";
import { authorizeUrl } from "@/lib/integrations/google";
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
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.redirect(new URL("/", request.url), 302);
  }

  const state = mintState();
  const secure = new URL(request.url).protocol === "https:";

  return new Response(null, {
    status: 302,
    headers: {
      location: authorizeUrl(googleOAuthConfig(), state),
      "set-cookie": stateCookie(state, secure),
      // The redirect carries a one-time state; a cached copy would replay a spent one.
      "cache-control": "no-store",
    },
  });
}
