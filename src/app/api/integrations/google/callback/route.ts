import { auth } from "@/auth";
import { exchangeCode, fetchEmail } from "@/lib/integrations/google";
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
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const secure = url.protocol === "https:";
  const back = (status: string) => redirect(new URL(`/settings?google=${status}`, url), secure);

  const session = await auth();
  if (!session?.user?.id) return redirect(new URL("/", url), secure);

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

function redirect(location: URL, secure: boolean): Response {
  return new Response(null, {
    status: 302,
    headers: {
      location: location.toString(),
      "set-cookie": clearedStateCookie(secure),
      "cache-control": "no-store",
    },
  });
}
