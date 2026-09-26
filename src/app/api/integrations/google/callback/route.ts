import { auth } from "@/auth";
import { required } from "@/lib/env";
import { appReturn, exchangeCode, fetchEmail } from "@/lib/integrations/google";
import {
  clearedStateCookie,
  readCookie,
  STATE_COOKIE,
  stateMatches,
} from "@/lib/integrations/oauth-state";
import { googleOAuthConfig, storeGoogleConnection } from "@/lib/integrations/store";

export const dynamic = "force-dynamic";

/**
 * Google's redirect back. Exchanges the code, stores the refresh token encrypted, and
 * returns the user to Settings.
 *
 * Every outcome is a redirect to `/settings` carrying a **fixed** code in the query —
 * never a message from Google, and never anything from the query string it was given.
 * The settings page maps the code to its own text, so nothing reflected can reach the
 * page. The real cause is logged server-side.
 *
 * Unlike every other authenticated route this one cannot answer a JSON error: the
 * caller is a browser mid-navigation, and a 400 with an envelope would leave the user
 * looking at raw JSON. `handle()` is therefore deliberately not used here.
 *
 * Where it returns the browser to comes from `APP_BASE_URL` and never from the
 * request: inside the container `request.url` is the bind address, so resolving
 * against it sent every successful connection to `http://0.0.0.0:8080/settings`.
 * See `appReturn`. The *query string* is still read from the request, which is
 * correct — Google's `code`, `state` and `error` are on the incoming URL.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const appBase = required("APP_BASE_URL");
  const back = (status: string) => {
    const app = appReturn(appBase, `/settings?google=${status}`);
    return redirect(app.location, app.secure);
  };

  const session = await auth();
  if (!session?.user?.id) {
    const app = appReturn(appBase, "/");
    return redirect(app.location, app.secure);
  }

  // The user pressed Cancel, or unticked everything and Google refused.
  const denied = url.searchParams.get("error");
  if (denied) {
    console.warn("Google integration consent was not granted:", denied);
    return back("denied");
  }

  const expected = readCookie(request.headers.get("cookie"), STATE_COOKIE);
  if (!stateMatches(expected, url.searchParams.get("state"))) {
    console.warn("Google integration callback had a bad or missing state.");
    return back("state");
  }

  const code = url.searchParams.get("code");
  if (!code) return back("state");

  try {
    const tokens = await exchangeCode(googleOAuthConfig(), code);
    const email = await fetchEmail(tokens.accessToken);
    await storeGoogleConnection({
      ownerId: session.user.id,
      refreshToken: tokens.refreshToken,
      scopes: tokens.scopes,
      email,
    });
    return back("connected");
  } catch (error) {
    console.error("Google integration connection failed:", error);
    return back("failed");
  }
}

function redirect(location: string, secure: boolean): Response {
  return new Response(null, {
    status: 302,
    headers: {
      location,
      "set-cookie": clearedStateCookie(secure),
      "cache-control": "no-store",
    },
  });
}
