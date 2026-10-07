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
