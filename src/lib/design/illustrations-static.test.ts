import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { hex } from "./contrast";
import {
  ICON_PATH,
  renderIcon,
  renderStaticIllustrations,
  STATIC_ILLUSTRATION_DIR,
} from "./illustrations-static";
import { THEMES, tokenValue } from "./palette";

/**
 * The static SVGs in `public/illustrations/` are generated, and this is what stops
 * them going stale.
 *
 * The artwork in the app references `var(--color-*)`, so a palette change carries it
 * along automatically. These copies cannot — an `<img src>` in the README has no
 * access to a CSS variable — so their colours are baked in, and a baked-in colour is
 * a thing that silently becomes wrong. Regenerating in memory and comparing byte for
 * byte means a token change fails CI with the exact command to fix it.
 */

const rendered = renderStaticIllustrations();

test("every generated illustration is on disk and up to date", () => {
  for (const [name, expected] of rendered) {
    const file = path.join(process.cwd(), STATIC_ILLUSTRATION_DIR, name);
    let actual: string;
    try {
      actual = readFileSync(file, "utf8");
    } catch {
      assert.fail(`${STATIC_ILLUSTRATION_DIR}/${name} is missing — run \`npm run design:export\``);
    }
    assert.equal(
      actual,
      expected,
      `${STATIC_ILLUSTRATION_DIR}/${name} is stale, most likely because a colour token moved.\n` +
        `Run \`npm run design:export\` and commit the result.`,
    );
  }
});

test("each one is a complete, labelled SVG", () => {
  for (const [name, svg] of rendered) {
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, `${name} has no namespace`);
    assert.match(svg, /<\/svg>\n$/, `${name} is not closed`);
    // These are content images rather than decoration — they are the artwork a README
    // shows on its own — so unlike the in-app components they carry a name.
    assert.match(svg, /role="img"/, `${name} has no role`);
    assert.match(svg, /aria-label="[^"]{10,}"/, `${name} has no accessible name`);
    assert.match(svg, /<title>/, `${name} has no title`);
    assert.doesNotMatch(svg, /var\(--/, `${name} references a CSS variable it cannot resolve`);
  }
});

test("every colour in them is a resolved hex, not a token name or a gradient", () => {
  for (const [name, svg] of rendered) {
    for (const [, value] of svg.matchAll(/(?:fill|stroke)="([^"]+)"/g)) {
      if (value === "none") continue;
      assert.match(value, /^#[0-9a-f]{6}$/, `${name} has a colour "${value}" that is not plain hex`);
    }
    assert.doesNotMatch(svg, /Gradient/, `${name} uses a gradient — Toybox has no gradients in artwork`);
  }
});

test("every illustration is drawn in both themes, from each theme's own palette", () => {
  // Phase 28. A Night copy that quietly reused a Light colour would be a near-black
  // outline on GitHub's dark page — the exact failure the copies exist to prevent.
  const light = [...rendered.keys()].filter((name) => !name.endsWith("-dark.svg"));
  assert.ok(light.length >= 4, "the Light set is missing");
  for (const name of light) {
    const dark = name.replace(/\.svg$/, "-dark.svg");
    assert.ok(rendered.has(dark), `${name} has no Night copy, ${dark}`);
    const outline = (svg: string) => /stroke="(#[0-9a-f]{6})" stroke-width="3"/.exec(svg)?.[1];
    assert.equal(outline(rendered.get(name)!), hex(tokenValue("line", "light")), `${name}'s outline is not Light's line`);
    assert.equal(outline(rendered.get(dark)!), hex(tokenValue("line", "dark")), `${dark}'s outline is not Night's line`);
  }
});

test("the favicon is on disk, up to date, and carries both palettes", () => {
  const expected = renderIcon();
  assert.equal(
    readFileSync(path.join(process.cwd(), ICON_PATH), "utf8"),
    expected,
    `${ICON_PATH} is stale — run \`npm run design:export\` and commit the result`,
  );
  const style = /<style>([\s\S]*?)<\/style>/.exec(expected)?.[1] ?? "";
  const [light, dark] = style.split("@media (prefers-color-scheme:dark)");
  assert.ok(dark, "the favicon has no dark palette");
  for (const theme of THEMES) {
    const block = theme === "light" ? light : dark;
    for (const name of ["canvas", "line", "accent-pop", "live-pop", "ok-pop"]) {
      assert.ok(
        block.includes(hex(tokenValue(name, theme))),
        `the favicon's ${theme} palette does not use ${theme}'s ${name}`,
      );
    }
  }
  assert.doesNotMatch(expected, /(?:fill|stroke)="#/, "a colour attribute cannot follow the theme — use a class");
});
