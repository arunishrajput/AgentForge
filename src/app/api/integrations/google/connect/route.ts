import { auth } from "@/auth";
import { required } from "@/lib/env";
import { readActiveWorkspaceId } from "@/lib/workspace/active";
import { atLeast } from "@/lib/workspace/roles";
import { resolveScope } from "@/lib/workspace/store";
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
 *
 * **`admin`, since Phase 19B**, because what this flow ends in is a credential stored
 * against the *workspace* — and every member of that workspace can then act as the
 * connecting account within the scopes granted. Refused as a redirect carrying a fixed
 * code rather than as a 403 body, for the same reason every other outcome here is a
 * redirect: the caller is a navigation, not a client.
 */
export async function GET() {
  const app = appReturn(required("APP_BASE_URL"), "/");

  const session = await auth();
  if (!session?.user?.id) {
    return Response.redirect(app.location, 302);
  }

  const scope = await resolveScope(
    { id: session.user.id, name: session.user.name, email: session.user.email },
    await readActiveWorkspaceId(),
  );
  if (!atLeast(scope.role, "admin")) {
    return Response.redirect(appReturn(required("APP_BASE_URL"), "/settings?google=forbidden").location, 302);
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
