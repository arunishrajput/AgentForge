import assert from "node:assert/strict";
import { test } from "node:test";

import {
  contrast,
  contrastOfLuminance,
  declarations,
  grade,
  hex,
  inGamut,
  luminance,
  mixLuminance,
  parseOklch,
  parseTokens,
  rawRgb,
} from "./contrast";

test("parses plain oklch tokens and skips the alpha forms", () => {
  const tokens = parseTokens(
    `@theme {
      --color-ink: oklch(0.205 0.024 272);
      --color-line-soft: oklch(0.205 0.024 272 / 0.16);
      --color-elevated: oklch(1 0 0);
      --radius-lg: 0.75rem;
    }`,
    "@theme",
  );
  assert.deepEqual([...tokens.keys()], ["ink", "elevated"]);
  assert.deepEqual(tokens.get("ink"), [0.205, 0.024, 272]);
  // An alpha token has no fixed contrast, so there is nothing honest to measure.
  assert.equal(tokens.has("line-soft"), false);
});

test("a later block never overwrites an earlier one — each theme is read from its own", () => {
  // The trap Phase 27 fixed: the first parser let the Night block, later in the file,
  // replace every light value, so every gate would have measured the wrong theme.
  const css = `
    @theme { --color-ink: oklch(0.2 0.02 272); --color-canvas: oklch(0.97 0.03 88); }
    :root {
      color-scheme: light;
      @variant dark { --color-ink: oklch(0.96 0.02 88); color-scheme: dark; }
    }
  `;
  assert.deepEqual(parseTokens(css, "@theme").get("ink"), [0.2, 0.02, 272]);
  assert.deepEqual(parseTokens(css, ":root > @variant dark").get("ink"), [0.96, 0.02, 88]);
  // A token the dark block does not redeclare is absent from it, not inherited — so a
  // gate can tell "Night forgot this token" from "Night kept the light value".
  assert.equal(parseTokens(css, ":root > @variant dark").has("canvas"), false);
});

test("declarations carry their scope, and at-rule statements and comments are not declarations", () => {
  const found = declarations(`
    @import "tailwindcss";
    /* --color-ghost: oklch(1 0 0); a commented-out token is not a token */
    @theme { --shadow-card: 3px 3px 0 0 var(--color-shade); }
    @utility btn {
      border: var(--stroke) solid var(--color-line);
      &:hover:not(:disabled) { transform: translate3d(-1px, -1px, 0); }
    }
  `);
  assert.deepEqual(found, [
    { property: "--shadow-card", value: "3px 3px 0 0 var(--color-shade)", scope: "@theme" },
    { property: "border", value: "var(--stroke) solid var(--color-line)", scope: "@utility btn" },
    {
      property: "transform",
      value: "translate3d(-1px, -1px, 0)",
      scope: "@utility btn > &:hover:not(:disabled)",
    },
  ]);
});

test("parseOklch reads the opaque form only", () => {
  assert.deepEqual(parseOklch("oklch(0.5 0.1 200)"), [0.5, 0.1, 200]);
  assert.deepEqual(parseOklch("  oklch( 1 0 0 ) "), [1, 0, 0]);
  assert.equal(parseOklch("oklch(0.5 0.1 200 / 0.4)"), null);
  assert.equal(parseOklch("var(--color-ink)"), null);
});

test("white and black are the extremes of the scale", () => {
  const white = luminance([1, 0, 0]);
  const black = luminance([0, 0, 0]);
  assert.ok(Math.abs(white - 1) < 0.001, `white is ${white}`);
  assert.ok(black < 0.001, `black is ${black}`);
  // 21:1 is the maximum a WCAG ratio can reach, and it is black on white.
  assert.ok(Math.abs(contrast([1, 0, 0], [0, 0, 0]) - 21) < 0.01);
});

test("contrast is symmetric, so argument order never changes a verdict", () => {
  const a: [number, number, number] = [0.205, 0.024, 272];
  const b: [number, number, number] = [0.968, 0.031, 88];
  assert.equal(contrast(a, b).toFixed(6), contrast(b, a).toFixed(6));
});

test("a colour has no contrast with itself", () => {
  assert.equal(contrast([0.5, 0.1, 200], [0.5, 0.1, 200]).toFixed(4), "1.0000");
});

test("out-of-gamut colours are detected rather than silently clamped", () => {
  assert.equal(inGamut([0.7, 0.19, 302]), true);
  // Chroma far past what sRGB can express at this lightness.
  assert.equal(inGamut([0.755, 0.34, 335]), false);
  const raw = rawRgb([0.755, 0.34, 335]);
  assert.ok(
    raw.some((v) => v > 1.001 || v < -0.001),
    "an out-of-gamut colour should have a channel outside 0..1",
  );
});

test("hex round-trips the two colours that have known answers", () => {
  assert.equal(hex([1, 0, 0]), "#ffffff");
  assert.equal(hex([0, 0, 0]), "#000000");
});

test("a mix sits between the two luminances it is made of", () => {
  const tone: [number, number, number] = [0.52, 0.2, 25];
  const behind: [number, number, number] = [0.968, 0.031, 88];
  const mixed = mixLuminance(tone, behind, 0.12);
  assert.ok(mixed > luminance(tone) && mixed < luminance(behind));
  // At alpha 0 the mix is the background; at 1 it is the tone.
  assert.ok(Math.abs(mixLuminance(tone, behind, 0) - luminance(behind)) < 1e-12);
  assert.ok(Math.abs(mixLuminance(tone, behind, 1) - luminance(tone)) < 1e-12);
});

test("contrastOfLuminance agrees with contrast", () => {
  const a: [number, number, number] = [0.205, 0.024, 272];
  const b: [number, number, number] = [0.993, 0.008, 90];
  assert.equal(
    contrastOfLuminance(luminance(a), luminance(b)).toFixed(6),
    contrast(a, b).toFixed(6),
  );
});

test("grades at the WCAG boundaries", () => {
  assert.equal(grade(21), "AAA");
  assert.equal(grade(7), "AAA");
  assert.equal(grade(6.99), "AA");
  assert.equal(grade(4.5), "AA");
  assert.equal(grade(4.49), "fail");
  assert.equal(grade(1), "fail");
});
