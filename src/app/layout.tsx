import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

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

export const metadata: Metadata = {
  title: "AgentForge",
  description:
    "Describe what you want in plain language. AgentForge builds a real, executable, visually editable workflow whose agent nodes reason at runtime.",
  applicationName: "AgentForge",
};

/**
 * `viewport-fit=cover` plus the safe-area padding in `globals.css` keeps the canvas
 * header clear of a phone's notch; `maximum-scale` is deliberately left alone,
 * because capping it stops a user zooming the canvas on a phone.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#15131c",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh antialiased">
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
        {children}
      </body>
    </html>
  );
}
