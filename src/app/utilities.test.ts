import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";

/**
 * **Every colour utility the source names compiles to something.** Phase 27.
 *
 * Tailwind does not fail on a utility it cannot build: `bg-lift` is a perfectly good
 * class name, it simply produces no CSS. So when Phase 19A reached for a `--color-lift`
 * token that never existed, six elements across the workflow list, the share page, the
 * settings panel, the canvas header and the onboarding guide shipped with **no
 * background at all**, and nothing complained for eight phases. Chapter 3's planning
 * found it by reading; the same sweep that wrote this test found two more of the same
 * kind, live — `text-ok-ink` on the webhook "Rotated" message and `text-warn-ink` on the
 * vault's warning figure, both naming tokens that never existed, so both rendered in
 * whatever colour they inherited.
 *
 * The check asks Tailwind itself, so it cannot disagree with the build: its own
 * scanner extracts every candidate class from `src/`, its own compiler builds each
 * colour-utility candidate against the real `globals.css`, and a candidate that adds
 * nothing to the output is a class that does nothing in the browser. ~80 ms.
 *
 * Comments are stripped first, because the scanner reads prose as eagerly as markup —
 * "animation-fill-mode" in a comment is a perfectly plausible `fill-mode` candidate.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** A utility whose value is a colour: `bg-x`, `text-x`, `border-t-x`, `hover:bg-x/40`… */
const COLOUR_UTILITY =
  /^(?:[\w-]+:)*(?:bg|text|border(?:-[trblxyse])?|divide|ring|ring-offset|outline|fill|stroke|from|via|to|decoration|caret|accent|placeholder|shadow)-([a-z][a-z-]*?)(?:\/\d+)?$/;

/**
 * Strings that are not classes but look like one to the scanner, each with where it
 * comes from. Kept short on purpose, and checked for staleness below — an entry that no
 * longer appears in the source fails the test, so this list cannot quietly grow into a
 * place where real bugs hide.
 */
const NOT_CLASSES = new Map<string, string>([
  ["accent-pop", 'a token\'s own name as a string — `tokenValue("accent-pop")`, the palette catalogue'],
  ["stroke-dasharray", "an SVG attribute in markup written as text — `illustrations-static.ts`"],
  ["stroke-linecap", "an SVG attribute in markup written as text — the static illustrations, the select chevron's data URI"],
  ["stroke-linejoin", "an SVG attribute in markup written as text — the static illustrations, the select chevron's data URI"],
  ["stroke-width", "an SVG attribute in markup written as text — the static illustrations, the select chevron's data URI"],
]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    const extension = extname(entry.name);
    return (extension === ".ts" || extension === ".tsx") && !entry.name.endsWith(".test.ts")
      ? [path]
      : [];
  });
}

/** Line and block comments out, strings untouched. Approximate, and only has to be. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

test("every colour utility used in src/ compiles to CSS", async () => {
  const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");
  const compiler = await compile(css, { base: join(ROOT, "app"), onDependency() {} });

  const scanner = new Scanner({});
  const candidates = scanner.scanFiles(
    sourceFiles(ROOT).map((file) => ({
      content: withoutComments(readFileSync(file, "utf8")),
      extension: extname(file).slice(1),
    })),
  );

  const colour = [...new Set(candidates)].filter((c) => COLOUR_UTILITY.test(c)).sort();
  assert.ok(colour.length > 50, `only ${colour.length} colour utilities found — is the scan reading src/?`);

  // `build` is cumulative, so a candidate that adds nothing to the output is one Tailwind
  // could not turn into a rule.
  let size = compiler.build([]).length;
  const dead: string[] = [];
  for (const candidate of colour) {
    const next = compiler.build([candidate]).length;
    if (next === size) dead.push(candidate);
    size = next;
  }

  const real = dead.filter((c) => !NOT_CLASSES.has(c));
  assert.deepEqual(
    real,
    [],
    `these classes produce no CSS — each names a token globals.css does not declare: ${real.join(", ")}. ` +
      "If one is prose rather than a class, add it to NOT_CLASSES with where it comes from.",
  );

  const stale = [...NOT_CLASSES.keys()].filter((c) => !dead.includes(c));
  assert.deepEqual(stale, [], `NOT_CLASSES lists strings the source no longer contains: ${stale.join(", ")}`);
});

/**
 * **No control turns the one focus ring off.** Phase 28.
 *
 * `DESIGN.md` → *One focus ring, and it is ink* says no control sets `outline-none`, and
 * nothing checked it: the onboarding guide's step rows and the inspector's node-docs
 * toggle both replaced the ink ring with a 2px accent one. It happened to clear 3:1 in
 * both themes, so this was never a contrast failure — it was a second ring, the thing
 * Phase 27 restated the rule to rule out, and the way a third one would arrive is with
 * a colour that does not clear 3:1 in Night.
 *
 * A class that removes the outline is allowed only where it is listed here with the
 * reason, and a listing whose class has gone fails, as `NOT_CLASSES` does above.
 */
const RING_REMOVED = /(?:^|[\s"'`])(?:[\w-]+:)*outline-(?:none|hidden)(?=[\s"'`]|$)/gm;

const RING_EXCEPTIONS = new Map<string, string>([
  [
    "components/shell/command-palette.tsx",
    "the ⌘K search input. Focus never leaves it while the palette is open — the arrow keys move a virtual cursor (`DESIGN.md` → *The shell*) — so a ring would be permanent rather than an indicator",
  ],
]);

test("no control removes the focus ring, except where focus can never leave it", () => {
  const offenders: string[] = [];
  const seen = new Set<string>();
  for (const file of sourceFiles(ROOT)) {
    const relative = file.slice(ROOT.length);
    for (const match of withoutComments(readFileSync(file, "utf8")).matchAll(RING_REMOVED)) {
      if (RING_EXCEPTIONS.has(relative)) seen.add(relative);
      else offenders.push(`${relative}: ${match[0].trim()}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "these remove the ink focus ring, which `:focus-visible` in globals.css draws for every " +
      "control in both themes. Delete the class; if focus genuinely cannot leave the element, " +
      "list it in RING_EXCEPTIONS with the reason.",
  );
  const stale = [...RING_EXCEPTIONS.keys()].filter((f) => !seen.has(f));
  assert.deepEqual(stale, [], `RING_EXCEPTIONS lists files that no longer remove the ring: ${stale.join(", ")}`);
});

/**
 * **The label on a fill is never dimmed.** Phase 28.
 *
 * `accent-ink` is the one legal label on a `-pop` fill, and `tokens.test.ts` proves it
 * clears AA there — at full strength. Two places dimmed it for a secondary line, a count
 * on the active filter tab (`/70`) and a ⌘K subtitle (`/75`), and the first measured
 * **3.77:1** on the grape fill in Light, found by `scripts/contrast-audit.browser.js`.
 * In Night, where the label clears 4.95:1 at best, a dimmed one has no margin at all.
 * Secondary text on a fill is set apart by size or weight, never by opacity.
 */
test("the label on a fill never takes an opacity modifier", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(ROOT)) {
    for (const match of withoutComments(readFileSync(file, "utf8")).matchAll(/\btext-accent-ink\/\d+/g)) {
      offenders.push(`${file.slice(ROOT.length)}: ${match[0]}`);
    }
  }
  assert.deepEqual(offenders, [], "a dimmed fill label drops under AA — use the full text-accent-ink");
});
