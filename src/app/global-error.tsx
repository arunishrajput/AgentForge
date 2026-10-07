"use client";

import { Geist } from "next/font/google";

import { ThemeSync } from "@/components/ui/theme";
import { DEFAULT_THEME, THEME_COLOR } from "@/lib/ui/theme";

import "./globals.css";

/**
 * **The last error surface — Phase 25.**
 *
 * `error.tsx` catches a failure inside a page. It cannot catch a failure in the **root
 * layout**, because it renders *inside* that layout — and when the layout is what threw,
 * there is nothing left to render into. Without this file that case falls through to Next's
 * own screen, which in production reads "Application error: a client-side exception has
 * occurred" on a blank white page: the exact failure `error.tsx` was written to avoid, still
 * reachable by the one route nobody tests.
 *
 * `BUILD_PLAN.md` → *Phase 25* asks that every failure the user can hit has a clear message
 * and a way forward. This is the least likely failure in the product and the worst looking,
 * so it is the last one to close.
 *
 * ## Three things it has to do differently, and they are all consequences of one fact
 *
 * It **replaces** the root layout rather than nesting inside it
 * (`node_modules/next/dist/docs/01-app/01-getting-started/10-error-handling.md` →
 * *Global errors*), so everything the layout normally provides is absent here:
 *
 *   1. **It renders its own `<html>` and `<body>`.** Required, and it also means `lang` has
 *      to be set here or the document has none — WCAG 3.1.1 applies to this page too.
 *   2. **It imports `globals.css` itself**, or the page is unstyled. Deliberately the whole
 *      stylesheet: a hand-written inline style would be a second, drifting copy of the
 *      design language, on the one page nobody looks at until it matters.
 *   3. **It loads one font, not two.** Geist Mono exists for node ids and JSON output, and
 *      there is none of either here. The variable is still declared so the stylesheet's
 *      `--font-mono` token resolves to its fallback rather than to nothing.
 *
 * ## Why it does not use `EmptyState` or `Button`
 *
 * They would work, and the reason to avoid them is that this component runs *after*
 * something in the application shell has already failed. Every import it takes is another
 * module that has to evaluate successfully for the error page itself to render, and a
 * crashing error page is a blank screen with no recourse at all. So it is plain elements and
 * the `btn` utility class from the stylesheet — which is exactly the case the Toybox system
 * put `btn` in CSS for rather than only in React (`components/ui/button.tsx` says so).
 *
 * ## It applies the reader's theme itself — Phase 28
 *
 * Replacing the root layout also replaces the `<head>` script that sets `data-theme`, so
 * until Phase 28 a root-layout failure was cream for every reader, Night included. The
 * fix is `ThemeSync`, not a copy of the script, and that is measured rather than assumed:
 * **Next 16 never server-renders this file.** When the root layout throws on the server,
 * Next sends its own bare `<html id="__next_error__">` shell (`app-render.js`) and renders
 * this component into it on the client — where an inline `<script>` React renders never
 * runs. `ThemeSync`'s layout effect applies the stored theme before this page first paints,
 * and recolours the `theme-color` below. Driven both ways on a probe build: a server-side
 * and a client-side throw in the root layout, each painted this page in Night. The one
 * frame before it on the server path is Next's unstyled shell — white, in either theme —
 * which nothing in the app can style. `src/lib/ui/theme.test.ts` checks every file that
 * renders an `<html>`.
 *
 * `error.message` is not rendered, for the same reason it is not in `error.tsx`: Next
 * replaces it with a generic string in production, and printing whatever leaked through
 * would put internal detail on screen. The digest is shown, because it is what makes
 * `gcloud run services logs read` able to find this exact request.
 */

const sans = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist-sans",
});

/**
 * **`retry`, not `reset`.** The installed `next@16` declares both on the error boundary's
 * props (`node_modules/next/dist/client/components/error-boundary.d.ts`) and its own docs
 * use `retry`, so that is the name used for new code here. `src/app/error.tsx` still takes
 * `reset`, which is still supported — they are the same function under two names, and
 * churning a working file to rename a prop is not a Phase 25 task.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en" data-theme={DEFAULT_THEME} className={sans.variable}>
      <head>
        <meta name="theme-color" content={THEME_COLOR.light} />
      </head>
      <body className="min-h-dvh antialiased">
        <ThemeSync />
        <main
          id="main"
          className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-16 text-center"
        >
          <h1 className="text-2xl font-bold tracking-tight">AgentForge could not start</h1>

          <p className="text-muted mt-2 text-sm text-pretty">
            Something failed before the page could be built.{" "}
            <strong className="text-ink font-semibold">Nothing of yours has changed</strong> —
            loading a page never saves or runs anything. Reload, and if it keeps happening the
            cause is in the logs under the code below.
          </p>

          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={() => retry()} className="btn btn-primary">
              Reload
            </button>
            {/* oxlint-disable-next-line nextjs/no-html-link-for-pages -- deliberate hard
                navigation, for a stronger reason here than in `error.tsx`. `retry()`
                re-renders the same broken tree, and this is the escape hatch for when that
                did not work: only a full document load discards the failing client state.
                `next/link` would also mean importing the router into the one component that
                has to render when the application shell has already failed. */}
            <a href="/workflows" className="btn btn-quiet">
              Back to workflows
            </a>
          </div>

          {error.digest && (
            <p className="text-faint mt-6 font-mono text-2xs">error {error.digest}</p>
          )}
        </main>
      </body>
    </html>
  );
}
