import assert from "node:assert/strict";
import { test } from "node:test";

import {
  contrast,
  contrastOfLuminance,
  grade,
  hex,
  inGamut,
  luminance,
  mixLuminance,
  parseTokens,
  rawRgb,
} from "./contrast";

test("parses plain oklch tokens and skips the alpha forms", () => {
  const tokens = parseTokens(`
    --color-ink: oklch(0.205 0.024 272);
    --color-line-soft: oklch(0.205 0.024 272 / 0.16);
    --color-elevated: oklch(1 0 0);
    --radius-lg: 0.75rem;
  `);
  assert.deepEqual([...tokens.keys()], ["ink", "elevated"]);
  assert.deepEqual(tokens.get("ink"), [0.205, 0.024, 272]);
  // An alpha token has no fixed contrast, so there is nothing honest to measure.
  assert.equal(tokens.has("line-soft"), false);
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
