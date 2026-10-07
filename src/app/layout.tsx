import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { ThemeSync } from "@/components/ui/theme";
import { ToastProvider } from "@/components/ui/toast";
import { DEFAULT_THEME, THEME_COLOR, themeScript } from "@/lib/ui/theme";

import "./globals.css";

/**
 * Geist and Geist Mono, self-hosted by `next/font` — no request leaves the browser
 * for a font file and there is no layout shift on first paint. Only the `latin`
 * subset is fetched, and only the variable axis, which is two files in total.
 *
 * Both are exposed as CSS variables rather than class names so `globals.css` can
 * point Tailwind's `--font-sans` and `--font-mono` tokens at them, and `font-sans`
 * / `font-mono` keep working as ordinary utilities everywhere else.
 *
 * Mono is load-bearing here, not decoration: node ids, node types, `{{ }}`
 * references, cron expressions, webhook URLs and JSON output are all monospaced,
 * and a proportional fallback made the canvas read as a form rather than a tool.
 */
const sans = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist-sans",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist-mono",
});

const DESCRIPTION =
  "Describe what you want in plain language. AgentForge builds a real, executable, " +
  "visually editable workflow whose agent nodes reason and decide at runtime.";

/**
 * `metadataBase` resolves the relative URLs in the cards below. It falls back to the
 * canonical deployment rather than reading `required("APP_BASE_URL")`, because
 * `next build` runs in CI with no environment at all and a throw here would fail the
 * build for a link preview.
 */
export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.APP_BASE_URL ?? "https://agentforge-733000675212.asia-southeast1.run.app",
  ),
  title: {
    default: "AgentForge — agentic workflow automation",
    template: "%s · AgentForge",
  },
  description: DESCRIPTION,
  applicationName: "AgentForge",
  openGraph: {
    type: "website",
    siteName: "AgentForge",
    title: "AgentForge — agentic workflow automation",
    description: DESCRIPTION,
    url: "/",
  },
  twitter: { card: "summary", title: "AgentForge", description: DESCRIPTION },
};

/**
 * `viewport-fit=cover` plus the safe-area padding in `globals.css` keeps the canvas
 * header clear of a phone's notch; `maximum-scale` is deliberately left alone,
 * because capping it stops a user zooming the canvas on a phone.
 *
 * No `themeColor` here since Phase 27: the chrome colour depends on the reader's theme,
 * which only the browser knows, so it is a `<meta>` in `<head>` below that the theme
 * script recolours before the first paint.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    /* `data-theme="light"` is what the server can know; the script below replaces it
       with the reader's stored choice before anything paints, which is why the
       element carries `suppressHydrationWarning` — the DOM is right and the payload
       is stale, by design (Next's *Preventing flash before hydration* guide). */
    <html
      lang="en"
      data-theme={DEFAULT_THEME}
      suppressHydrationWarning
      className={`${sans.variable} ${mono.variable}`}
    >
      <head>
        {/* The page colour, so a phone's browser chrome continues the page rather than
            ending it in a band of the other theme. Light here; the script recolours it.
            It must come BEFORE the script, which finds it during parsing. */}
        <meta name="theme-color" content={THEME_COLOR.light} />
        {/* Blocking and inline on purpose: it has to run during parsing, before the
            first paint and long before React, or a Night reader sees cream first. The
            source is `themeScript()` in `src/lib/ui/theme.ts`, tested as shipped. */}
        <script dangerouslySetInnerHTML={{ __html: themeScript() }} />
      </head>
      <body className="min-h-dvh antialiased">
        <ThemeSync />
        {/* The first thing in the tab order on every page. The canvas puts a lot of
            palette buttons between the top of the document and the graph.

            Parked above the viewport rather than hidden with `sr-only`: Tailwind's
            `not-sr-only` sets `padding: 0`, which strips the `btn` padding and leaves
            a skip link that is focusable but unreadable. A transform keeps it in the
            tab order, off screen, and fully styled. */}
        <a
          href="#main"
          className="btn btn-primary fixed top-3 left-3 z-50 -translate-y-20 transition-transform focus:translate-y-0"
        >
          Skip to content
        </a>
        {/* Mounted at the root so any page can raise a toast, and so the live region
            exists in the document before the first message rather than arriving with
            it — a region a screen reader was not already observing announces nothing
            (`DESIGN.md` → *The live region exists before the first message*). */}
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
