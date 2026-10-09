import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

/**
 * **A scroll container is positioned — Phase 35.**
 *
 * `.sr-only` text is `position: absolute`. An absolutely positioned element is clipped by an
 * `overflow: auto` ancestor **only if that ancestor is in its containing-block chain** — which
 * means positioned. Otherwise it escapes the scroller, sits at its static position somewhere in the
 * scrolled-away content, and stretches the *document*. Found in a browser on the deployed canvas:
 * a long copilot conversation put a "You:" label 200 px below the viewport, the whole page gained a
 * scrollbar, and every control shifted 9 px left. Nothing else could have seen it — every gate on
 * colour, every unit test and `verify-a11y` passed.
 *
 * So every element that scrolls carries a position class in the same class list. Read from the
 * source, like `utilities.test.ts`: a class literal that names `overflow-auto`, `overflow-y-auto`,
 * `overflow-x-auto` or a `-scroll` must also name `relative`, `absolute`, `fixed` or `sticky`.
 */

const ROOTS = ["src/components", "src/app"];
const SCROLLS = /\boverflow-(?:x-|y-)?(?:auto|scroll)\b/;
/** Unprefixed: `max-lg:fixed` positions it at one breakpoint and leaves the trap open at the rest. */
const POSITIONED = /(?:^|\s)(?:relative|absolute|fixed|sticky)(?=\s|$)/;

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(full, found);
    else if (entry.name.endsWith(".tsx") && !entry.name.includes(".test.")) found.push(full);
  }
  return found;
}

/** Every string or template literal in a file, with the line it starts on. */
function literals(text: string): { value: string; line: number }[] {
  const found: { value: string; line: number }[] = [];
  const pattern = /"([^"\n]*)"|`([^`]*)`/g;
  for (const match of text.matchAll(pattern)) {
    found.push({ value: match[1] ?? match[2] ?? "", line: text.slice(0, match.index).split("\n").length });
  }
  return found;
}

test("every class list that scrolls is positioned, so nothing absolute inside it escapes to the page", () => {
  const offenders: string[] = [];
  let scrollers = 0;
  for (const root of ROOTS) {
    for (const file of sources(path.join(process.cwd(), root))) {
      for (const { value, line } of literals(readFileSync(file, "utf8"))) {
        if (!SCROLLS.test(value)) continue;
        scrollers += 1;
        if (!POSITIONED.test(value)) offenders.push(`${path.relative(process.cwd(), file)}:${line} "${value}"`);
      }
    }
  }
  assert.ok(scrollers >= 10, `found only ${scrollers} scroll containers — has the scan stopped reading the source?`);
  assert.deepEqual(offenders, [], "a scroll container without a position class — add `relative`");
});

test("the rule's own patterns mean what they say", () => {
  assert.ok(SCROLLS.test("min-h-0 flex-1 overflow-y-auto p-3"));
  assert.ok(SCROLLS.test("max-h-56 overflow-auto"));
  assert.ok(!SCROLLS.test("overflow-hidden truncate"));
  assert.ok(POSITIONED.test("relative min-h-0 overflow-y-auto"));
  assert.ok(POSITIONED.test("overflow-y-auto sticky"));
  assert.ok(!POSITIONED.test("overflow-y-auto max-lg:fixed"));
  assert.ok(!POSITIONED.test("overflow-y-auto relative-ish"));
});
