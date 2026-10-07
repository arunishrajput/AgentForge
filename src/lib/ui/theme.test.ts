import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";

import { hex } from "@/lib/design/contrast";
import { tokenValue } from "@/lib/design/palette";

import {
  applyTheme,
  DEFAULT_THEME,
  parsePreference,
  parseSnapshot,
  readPreference,
  resetThemeMemoryForTests,
  resolveTheme,
  SERVER_SNAPSHOT,
  snapshot,
  subscribe,
  THEME_ATTRIBUTE,
  THEME_COLOR,
  THEME_STORAGE_KEY,
  themeScript,
  writePreference,
} from "./theme";

/**
 * The theme preference — Phase 27. The decision these pin is D110's: Light is the
 * default even on a dark device, the preference is per browser, and a browser that
 * refuses storage still gets a working switch.
 */

/** A just-enough browser: an `<html>`, one theme-color meta, storage, and a media query. */
function fakeBrowser({
  stored = null as string | null,
  storageThrows = false,
  deviceDark = false,
} = {}) {
  const attributes = new Map<string, string>();
  const meta = { content: "#fdf4dd", setAttribute: (_: string, v: string) => (meta.content = v) };
  const store = new Map<string, string>(stored === null ? [] : [[THEME_STORAGE_KEY, stored]]);
  const windowListeners = new Map<string, Set<(event: unknown) => void>>();
  const mediaListeners = new Set<() => void>();
  const media = {
    matches: deviceDark,
    addEventListener: (_: string, fn: () => void) => mediaListeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => mediaListeners.delete(fn),
  };

  const localStorage = {
    getItem(key: string) {
      if (storageThrows) throw new Error("SecurityError");
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (storageThrows) throw new Error("SecurityError");
      store.set(key, value);
    },
  };
  const matchMedia = () => media;
  const document = {
    documentElement: {
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      getAttribute: (name: string) => attributes.get(name) ?? null,
    },
    querySelector: () => meta,
    querySelectorAll: () => [meta],
  };
  const window = {
    localStorage,
    matchMedia,
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      if (!windowListeners.has(type)) windowListeners.set(type, new Set());
      windowListeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: (event: unknown) => void) =>
      windowListeners.get(type)?.delete(fn),
  };

  return {
    window,
    document,
    localStorage,
    matchMedia,
    attributes,
    meta,
    store,
    media,
    /** Another tab wrote the preference. */
    storageEvent(key: string | null, value: string | null) {
      if (value === null) store.delete(THEME_STORAGE_KEY);
      else store.set(THEME_STORAGE_KEY, value);
      for (const fn of windowListeners.get("storage") ?? []) fn({ key });
    },
    /** The device switched between light and dark. */
    deviceSwitches(dark: boolean) {
      media.matches = dark;
      for (const fn of mediaListeners) fn();
    },
    listenerCount: () =>
      (windowListeners.get("storage")?.size ?? 0) + mediaListeners.size,
  };
}

/** Run the exact string `layout.tsx` ships, the way a browser parsing `<head>` would. */
function runScript(browser: ReturnType<typeof fakeBrowser>) {
  new Function("document", "localStorage", "matchMedia", "window", themeScript())(
    browser.document,
    browser.localStorage,
    browser.matchMedia,
    browser.window,
  );
}

describe("the blocking script in <head>", () => {
  test("a first visit is Light — even on a dark device", () => {
    // D110's binding half: System is a choice, never the fallback.
    const browser = fakeBrowser({ deviceDark: true });
    runScript(browser);
    assert.equal(browser.attributes.get(THEME_ATTRIBUTE), "light");
    assert.equal(browser.meta.content, THEME_COLOR.light);
  });

  test("a stored choice is applied before anything paints", () => {
    const browser = fakeBrowser({ stored: "dark" });
    runScript(browser);
    assert.equal(browser.attributes.get(THEME_ATTRIBUTE), "dark");
    assert.equal(browser.meta.content, THEME_COLOR.dark);
  });

  test("System sets the attribute to `system` and lets the stylesheet decide", () => {
    for (const deviceDark of [true, false]) {
      const browser = fakeBrowser({ stored: "system", deviceDark });
      runScript(browser);
      assert.equal(browser.attributes.get(THEME_ATTRIBUTE), "system");
      // The chrome colour cannot follow CSS, so the script resolves it itself.
      assert.equal(browser.meta.content, deviceDark ? THEME_COLOR.dark : THEME_COLOR.light);
    }
  });

  test("storage that throws, or a value this version does not know, is Light", () => {
    for (const browser of [
      fakeBrowser({ storageThrows: true, deviceDark: true }),
      fakeBrowser({ stored: "midnight" }),
      fakeBrowser({ stored: "" }),
    ]) {
      runScript(browser);
      assert.equal(browser.attributes.get(THEME_ATTRIBUTE), "light");
    }
  });

  test("it is plain ES5 with every value inlined — nothing for it to import", () => {
    const script = themeScript();
    assert.match(script, /^\(function\(\)\{[\s\S]*\}\)\(\)$/);
    assert.doesNotMatch(script, /=>|\blet\b|\bconst\b|`|import/);
    assert.ok(script.includes(JSON.stringify(THEME_STORAGE_KEY)));
  });
});

describe("the preference", () => {
  test("anything unrecognised is the default, and the default is Light", () => {
    assert.equal(DEFAULT_THEME, "light");
    for (const value of [null, undefined, "", "Dark", "auto", 1, {}]) {
      assert.equal(parsePreference(value), "light");
    }
    for (const value of ["light", "dark", "system"] as const) {
      assert.equal(parsePreference(value), value);
    }
  });

  test("only System consults the device", () => {
    assert.equal(resolveTheme("light", true), "light");
    assert.equal(resolveTheme("dark", false), "dark");
    assert.equal(resolveTheme("system", true), "dark");
    assert.equal(resolveTheme("system", false), "light");
  });

  test("the chrome colour is each theme's page, taken from the palette", () => {
    assert.equal(THEME_COLOR.light, hex(tokenValue("canvas", "light")));
    assert.equal(THEME_COLOR.dark, hex(tokenValue("canvas", "dark")));
    // The value `layout.tsx` hardcoded until Phase 27, now derived rather than typed.
    assert.equal(THEME_COLOR.light, "#fdf4dd");
  });

  test("a snapshot carries both halves, and the server's is Light", () => {
    assert.deepEqual(parseSnapshot("system/dark"), { preference: "system", theme: "dark" });
    assert.deepEqual(parseSnapshot(SERVER_SNAPSHOT), { preference: "light", theme: "light" });
    assert.deepEqual(parseSnapshot("garbage"), { preference: "light", theme: "light" });
  });
});

describe("the store", () => {
  const globals = globalThis as unknown as Record<string, unknown>;
  let browser: ReturnType<typeof fakeBrowser>;

  const install = (options?: Parameters<typeof fakeBrowser>[0]) => {
    browser = fakeBrowser(options);
    globals.window = browser.window;
    globals.document = browser.document;
  };

  beforeEach(() => {
    resetThemeMemoryForTests();
    install();
  });
  afterEach(() => {
    delete globals.window;
    delete globals.document;
  });

  test("the server, with no window, reads the default", () => {
    delete globals.window;
    assert.equal(readPreference(), "light");
  });

  test("a write is stored, applied to the page, and announced", () => {
    let heard = 0;
    const stop = subscribe(() => (heard += 1));
    writePreference("dark");
    assert.equal(browser.store.get(THEME_STORAGE_KEY), "dark");
    assert.equal(browser.attributes.get(THEME_ATTRIBUTE), "dark");
    assert.equal(browser.meta.content, THEME_COLOR.dark);
    assert.equal(readPreference(), "dark");
    assert.equal(snapshot(), "dark/dark");
    assert.equal(heard, 1);
    stop();
    assert.equal(browser.listenerCount(), 0, "unsubscribing removes every listener it added");
  });

  test("blocked storage still gives a switch that works for this tab", () => {
    install({ storageThrows: true });
    writePreference("system");
    assert.equal(readPreference(), "system");
    assert.equal(browser.attributes.get(THEME_ATTRIBUTE), "system");
  });

  test("a change made in another tab arrives here", () => {
    let heard = 0;
    const stop = subscribe(() => (heard += 1));
    browser.storageEvent(THEME_STORAGE_KEY, "dark");
    assert.equal(browser.attributes.get(THEME_ATTRIBUTE), "dark");
    assert.equal(heard, 1);
    // `key: null` is `localStorage.clear()` — back to the default.
    browser.storageEvent(null, null);
    assert.equal(browser.attributes.get(THEME_ATTRIBUTE), "light");
    // Somebody else's key is not ours.
    browser.storageEvent("agentforge:canvas:palette", "1");
    assert.equal(heard, 2);
    stop();
  });

  test("under System, the device switching re-renders and recolours the chrome", () => {
    writePreference("system");
    let heard = 0;
    const stop = subscribe(() => (heard += 1));
    assert.equal(snapshot(), "system/light");
    browser.deviceSwitches(true);
    assert.equal(snapshot(), "system/dark");
    assert.equal(browser.meta.content, THEME_COLOR.dark);
    assert.equal(heard, 1);
    stop();
  });

  test("applying is idempotent — it is what restores the attribute after a remount", () => {
    applyTheme("dark");
    applyTheme("dark");
    assert.equal(browser.attributes.get(THEME_ATTRIBUTE), "dark");
  });
});
