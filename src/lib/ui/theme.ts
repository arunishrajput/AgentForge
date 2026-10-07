import { hex } from "@/lib/design/contrast";
import { tokenValue, type Theme } from "@/lib/design/palette";

/**
 * The reader's theme: Light, Toybox Night, or whatever their device says. Phase 27,
 * `DECISIONS.md` D110.
 *
 * Three facts shape everything here:
 *
 *   1. **Light is the default even when the OS is dark.** The cream page is the thing
 *      a stranger notices in the first second, so System is a choice a reader makes,
 *      never the fallback. No stored value, an unreadable store, or a value this
 *      version does not recognise all mean Light.
 *   2. **The preference lives in the browser, not the database.** A column would be a
 *      second copy to keep in step and a read on every page — a new reason to wake
 *      Neon for a value the browser already holds. And it could not prevent a flash
 *      anyway: `/design` is `force-static`, so no server read can reach it.
 *   3. **It must be applied before the first paint**, by a blocking script in
 *      `<head>`, or every page loads cream and then snaps to indigo. That script is
 *      `themeScript()` below, and the rest of this module is what keeps the page in
 *      step with it afterwards.
 *
 * `<html data-theme>` holds the PREFERENCE (`light` | `dark` | `system`), not the
 * resolved palette: the stylesheet resolves `system` itself, through
 * `prefers-color-scheme`, so an OS that switches at sunset takes the page with it
 * without a line of JavaScript. `globals.css` → `@custom-variant dark` is the other
 * half of that contract, and `tokens.test.ts` pins its attribute values.
 */

export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const DEFAULT_THEME: ThemePreference = "light";

/** Where the preference is kept, beside the canvas panels' `agentforge:canvas:*` keys. */
export const THEME_STORAGE_KEY = "agentforge:theme";

/** The `<html>` attribute the stylesheet's `dark` variant reads. */
export const THEME_ATTRIBUTE = "data-theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** What each choice is called where a person picks it, and what it does. */
export const THEME_CHOICES: { value: ThemePreference; label: string; hint: string }[] = [
  { value: "light", label: "Light", hint: "Cream and ink. The default." },
  { value: "dark", label: "Dark", hint: "Toybox Night — the same toy, after dark." },
  { value: "system", label: "System", hint: "Follow this device's setting." },
];

/**
 * The browser-chrome colour for each palette — the page itself, so a phone's address
 * bar continues the page rather than ending it in a band of the other theme. Derived
 * from the catalogue rather than typed in, so it moves when the token does.
 */
export const THEME_COLOR: Record<Theme, string> = {
  light: hex(tokenValue("canvas", "light")),
  dark: hex(tokenValue("canvas", "dark")),
};

/** Anything stored, read back as a preference — and anything unrecognised as Light. */
export function parsePreference(value: unknown): ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference)
    ? (value as ThemePreference)
    : DEFAULT_THEME;
}

/** The palette a preference shows, given whether the device asks for dark. */
export function resolveTheme(preference: ThemePreference, deviceIsDark: boolean): Theme {
  if (preference === "system") return deviceIsDark ? "dark" : "light";
  return preference;
}

/**
 * The blocking script for `<head>`, as a string.
 *
 * It runs during HTML parsing, before anything is painted and long before React, so it
 * is plain ES5 with no imports — every value it needs is inlined from the constants
 * above, which is what keeps it and this module from drifting apart. It reads the
 * stored preference (Light if storage throws, as it does in some private modes), sets
 * `data-theme`, and points `<meta name="theme-color">` — rendered just before it — at
 * the matching page colour. `theme.test.ts` runs this exact string against a fake
 * document.
 *
 * There is no Content-Security-Policy today. If one is ever added, allow this script
 * by its hash, never with a blanket `unsafe-inline`.
 */
export function themeScript(): string {
  const chosen = THEME_PREFERENCES.filter((p) => p !== DEFAULT_THEME)
    .map((p) => `s===${JSON.stringify(p)}`)
    .join("||");
  return (
    "(function(){" +
    `var d=document.documentElement,p=${JSON.stringify(DEFAULT_THEME)},s=null;` +
    `try{s=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}` +
    `if(${chosen})p=s;` +
    `d.setAttribute(${JSON.stringify(THEME_ATTRIBUTE)},p);` +
    `var k=p==="dark"||(p==="system"&&!!window.matchMedia&&matchMedia(${JSON.stringify(DARK_QUERY)}).matches);` +
    'var m=document.querySelector(\'meta[name="theme-color"]\');' +
    `if(m)m.setAttribute("content",k?${JSON.stringify(THEME_COLOR.dark)}:${JSON.stringify(THEME_COLOR.light)})` +
    "})()"
  );
}

// ---------------------------------------------------------------------------
// The store. `useSyncExternalStore` reads it; the switches write it.
//
// The same shape as the canvas panels' (`src/components/canvas/panel.tsx`, D74):
// `localStorage` is an external store, every access is guarded, and an in-memory
// fallback means a browser that refuses storage still gets a theme switch that works
// for as long as the tab is open, rather than a dead button.
// ---------------------------------------------------------------------------

/** Last resort when `localStorage` is unreachable. Lives as long as the tab. */
let memory: ThemePreference | null = null;
const listeners = new Set<() => void>();

function deviceIsDark(): boolean {
  try {
    return window.matchMedia?.(DARK_QUERY).matches ?? false;
  } catch {
    return false;
  }
}

export function readPreference(): ThemePreference {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored !== null) return parsePreference(stored);
  } catch {
    // Storage is blocked; the in-memory copy is the truth for this tab.
  }
  return memory ?? DEFAULT_THEME;
}

/**
 * Put a preference on the page: the attribute the stylesheet reads, and the chrome
 * colour. Idempotent, so it is safe to call on every change and on mount — which is
 * also what puts the attribute back after React's development-only Strict Mode
 * remount clears it (Next's *Preventing flash before hydration* guide).
 */
export function applyTheme(preference: ThemePreference): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute(THEME_ATTRIBUTE, preference);
  const colour = THEME_COLOR[resolveTheme(preference, deviceIsDark())];
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute("content", colour);
  }
}

export function writePreference(next: ThemePreference): void {
  memory = next;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Kept in memory instead, for this tab.
  }
  applyTheme(next);
  for (const listener of listeners) listener();
}

/**
 * Notified on the reader's own change, on a change made in another tab (the `storage`
 * event), and on the device switching between light and dark — the last only matters
 * under System, and only to the snapshot below and the chrome colour, because the
 * stylesheet already follows the device by itself.
 */
export function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);

  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    applyTheme(readPreference());
    onChange();
  };
  const onDevice = () => {
    applyTheme(readPreference());
    onChange();
  };

  window.addEventListener("storage", onStorage);
  let media: MediaQueryList | null = null;
  try {
    media = window.matchMedia?.(DARK_QUERY) ?? null;
  } catch {
    media = null;
  }
  media?.addEventListener("change", onDevice);

  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
    media?.removeEventListener("change", onDevice);
  };
}

/**
 * The snapshot `useSyncExternalStore` compares: the preference AND the palette it
 * resolves to, as one string. Both, because under System the device can change the
 * palette while the preference stays the same — and a snapshot of the preference alone
 * would compare equal and skip the re-render.
 */
export function snapshot(): string {
  const preference = readPreference();
  return `${preference}/${resolveTheme(preference, deviceIsDark())}`;
}

/** What the server renders, and what hydration starts from: Light, as the script's default. */
export const SERVER_SNAPSHOT = `${DEFAULT_THEME}/${resolveTheme(DEFAULT_THEME, false)}`;

export function parseSnapshot(value: string): { preference: ThemePreference; theme: Theme } {
  const [preference, theme] = value.split("/");
  return { preference: parsePreference(preference), theme: theme === "dark" ? "dark" : "light" };
}

/** Test seam: forget the in-memory fallback between cases. */
export function resetThemeMemoryForTests(): void {
  memory = null;
}
