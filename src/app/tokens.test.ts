import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * The colour half of the Phase 10 design system, checked rather than asserted.
 *
 * `BUILD_PLAN.md` Phase 10 requires "adequate contrast". That is the one completion
 * criterion in the phase that can be *computed*, so it is, from the tokens in
 * `globals.css` themselves — not from a screenshot and not from an opinion. The
 * reason it is worth a test at all is that the failure mode is silent: darkening
 * `--color-muted` by a little to make a panel calmer is an easy change to make in a
 * later phase and an impossible one to notice by looking.
 *
 * Every colour in the stylesheet is `oklch()`, which is what makes this cheap: the
 * conversion below is Björn Ottosson's oklab → linear sRGB, and WCAG's relative
 * luminance is defined on exactly those linear values, so there is no gamma step.
 * Out-of-gamut channels are clamped, which is what a browser approximately does.
 */

const CSS = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

/** `--color-x: oklch(L C H)` → the three numbers. Alpha forms are skipped. */
function token(name: string): [number, number, number] {
  const match = CSS.match(
    new RegExp(`--color-${name}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\s*\\)`),
  );
  assert.ok(match, `token --color-${name} is not declared as a plain oklch() value`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** oklch → linear-light sRGB, clamped to gamut. */
function linearRgb([L, C, H]: [number, number, number]): [number, number, number] {
  const hr = (H * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);

  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function luminance(name: string): number {
  const [r, g, b] = linearRgb(token(name));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * What a tinted chip *would* score: the tone at 15% over a surface, with the
 * undiluted tone as its text. Kept because it is the measurement that decided
 * `STATUS_STYLE` — a self-tinted pill cannot carry red at AA, so chips use the
 * recessed neutral instead. This asserts the finding rather than restating it.
 */
function tintRatio(tone: string, behind: string, alpha = 0.15): number {
  const toneRgb = linearRgb(token(tone));
  const behindRgb = linearRgb(token(behind));
  const mixed = toneRgb.map((c, i) => c * alpha + behindRgb[i] * (1 - alpha));
  const tint = 0.2126 * mixed[0] + 0.7152 * mixed[1] + 0.0722 * mixed[2];
  const fg = 0.2126 * toneRgb[0] + 0.7152 * toneRgb[1] + 0.0722 * toneRgb[2];
  const [hi, lo] = fg > tint ? [fg, tint] : [tint, fg];
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ["canvas", "surface", "elevated"];

test("body text clears WCAG AAA on every surface", () => {
  for (const surface of SURFACES) {
    const r = ratio("ink", surface);
    assert.ok(r >= 7, `ink on ${surface} is ${r.toFixed(2)}:1, want >= 7`);
  }
});

test("secondary text clears WCAG AA on every surface", () => {
  // `text-muted` carries captions, log lines and help text at 11 and 12 px, which is
  // "normal" text for WCAG — 4.5:1, not the 3:1 large-text allowance.
  for (const surface of SURFACES) {
    const r = ratio("muted", surface);
    assert.ok(r >= 4.5, `muted on ${surface} is ${r.toFixed(2)}:1, want >= 4.5`);
  }
});

test("the faintest text token still clears WCAG AA on the surfaces it is used on", () => {
  // `faint` is placeholders, the error digest and the sign-in footnote. It is the
  // token most likely to be pushed too dark, which is exactly why it is asserted.
  for (const surface of ["canvas", "surface"]) {
    const r = ratio("faint", surface);
    assert.ok(r >= 4.5, `faint on ${surface} is ${r.toFixed(2)}:1, want >= 4.5`);
  }
});

test("a primary button's label clears WCAG AA on its own fill", () => {
  const r = ratio("accent-ink", "accent");
  assert.ok(r >= 4.5, `accent-ink on accent is ${r.toFixed(2)}:1, want >= 4.5`);
});

test("every status colour is readable as text on a card", () => {
  for (const tone of ["ok", "live", "warn", "bad"]) {
    for (const surface of SURFACES) {
      const r = ratio(tone, surface);
      assert.ok(r >= 4.5, `${tone} on ${surface} is ${r.toFixed(2)}:1, want >= 4.5`);
    }
  }
});

test("a status chip clears WCAG AA on the recessed pill it actually sits on", () => {
  for (const tone of ["ok", "live", "warn", "bad", "muted"]) {
    const r = ratio(tone, "sunken");
    assert.ok(r >= 4.5, `${tone} chip is ${r.toFixed(2)}:1, want >= 4.5`);
  }
});

test("a self-tinted chip could not have carried every tone — why STATUS_STYLE is neutral", () => {
  // The measurement that rejected `bg-<tone>/15`. If a later phase reverts to a
  // tinted pill because it looks softer, this is the number it has to answer for.
  const red = tintRatio("bad", "elevated");
  assert.ok(red < 4.5, `bad on its own 15% tint is ${red.toFixed(2)}:1 — revisit`);
});

test("the accent is readable as link and label text on a card", () => {
  for (const surface of SURFACES) {
    const r = ratio("accent", surface);
    assert.ok(r >= 4.5, `accent on ${surface} is ${r.toFixed(2)}:1, want >= 4.5`);
  }
});

test("the three surfaces are distinguishable from each other", () => {
  // Elevation in a dark UI is carried by these steps, so they must not collapse into
  // one another — a node card sitting invisibly on the canvas is the failure.
  assert.ok(luminance("surface") > luminance("canvas") * 1.4);
  assert.ok(luminance("elevated") > luminance("surface") * 1.3);
  assert.ok(luminance("canvas") > luminance("sunken"));
});
