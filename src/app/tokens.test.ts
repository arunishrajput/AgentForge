import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  contrast,
  contrastOfLuminance,
  inGamut,
  luminance as luminanceOf,
  mixLuminance,
  parseTokens,
} from "../lib/design/contrast";
import { ALL_TOKENS, PALETTE } from "../lib/design/palette";

/**
 * The colour half of the Toybox design system (Phase 14), checked rather than
 * asserted.
 *
 * `BUILD_PLAN.md` Phase 14 says *playful must not cost legibility*, and names the
 * exact place it usually does: "saturated accent-on-cream is where AA fails, so
 * check every pairing". That is a computation, so it is computed — from the tokens
 * in `globals.css` themselves, not from a screenshot and not from an opinion. The
 * reason it is worth a test is that the failure mode is silent: brightening an
 * accent to make a panel livelier is an easy change to make in a later phase and
 * an impossible one to notice by looking.
 *
 * The system's central rule is that every chromatic token comes in two registers —
 * a dark one that is safe as text, and a bright `-pop` one that is a fill with an
 * ink label. Most of what follows is that rule, made mechanical:
 *
 *   - every text-register token clears AA on all four surfaces
 *   - ink clears AA on every `-pop` fill, so a label on a fill is always readable
 *   - the two registers stay far enough apart that neither drifts into the other
 *   - ink clears 3:1 against every surface and every fill, which is what makes one
 *     ink focus ring legal everywhere (WCAG 2.2 SC 1.4.11)
 *   - a `-pop` fill can be as little as 1.3:1 off the cream page, so the ink
 *     OUTLINE is what separates an object from the page — asserted, because it is
 *     the reason no pop fill may ever be drawn without one
 *
 * The maths lives in `src/lib/design/contrast.ts` rather than here, because the
 * gallery at `/design` prints the same numbers next to every swatch. One
 * implementation means the figure on the screen is the figure in this gate.
 */

const CSS = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
const TOKENS = parseTokens(CSS);

/** `--color-x` → its parsed triple, asserting the token exists at all. */
function token(name: string) {
  const value = TOKENS.get(name);
  assert.ok(value, `token --color-${name} is not declared as a plain oklch() value`);
  return value;
}

const luminance = (name: string) => luminanceOf(token(name));
const ratio = (foreground: string, background: string) =>
  contrast(token(foreground), token(background));

/**
 * What a tinted panel scores: a tone at `alpha` over a surface, with the undiluted
 * tone as its text. Six places in the Chapter 1 screens are built exactly this way
 * — `bg-warn/10 text-warn`, `bg-bad/10 text-bad` — so this measures real markup
 * rather than a hypothetical.
 */
function tintRatio(tone: string, behind: string, alpha = 0.12): number {
  return contrastOfLuminance(
    luminance(tone),
    mixLuminance(token(tone), token(behind), alpha),
  );
}

/** The four surfaces, lightest last. Everything readable must be readable on all. */
const SURFACES = ["canvas", "surface", "elevated", "sunken"];

/** Every token in the dark register — the ones a component may use as text. */
const TEXT_TONES = [
  "accent",
  "ok",
  "live",
  "warn",
  "bad",
  "cat-trigger",
  "cat-agent",
  "cat-logic",
  "cat-transform",
  "cat-integration",
];

/** Every bright fill. Ink is the only legal label on any of them. */
const POP_FILLS = TEXT_TONES.map((t) => `${t}-pop`).concat("spark");

test("every token is inside sRGB, so the browser renders what is measured here", () => {
  // A clamped channel means the rendered colour is not the declared one, which would
  // make every ratio in this file a measurement of something nobody sees.
  for (const name of [...SURFACES, "ink", "muted", "faint", ...TEXT_TONES, ...POP_FILLS]) {
    assert.ok(inGamut(token(name)), `--color-${name} is outside sRGB and will be clamped`);
  }
});

test("the system is light-first: every surface is near the top of the range", () => {
  for (const surface of SURFACES) {
    assert.ok(
      luminance(surface) > 0.75,
      `${surface} has luminance ${luminance(surface).toFixed(3)} — that is not a light surface`,
    );
  }
});

test("the four surfaces are ordered, and deliberately close together", () => {
  // Toybox separates an object from the page with an outline and a hard shadow, not
  // by making it a paler shade — so these steps are SMALL on purpose. The Chapter 1
  // dark palette asserted a 1.4x luminance step between surfaces; asserting that
  // here would be asserting the wrong design. What must hold is the ordering, and
  // that no two steps collapse into literally the same value.
  const order = ["sunken", "canvas", "surface", "elevated"];
  for (let i = 1; i < order.length; i++) {
    assert.ok(
      luminance(order[i]) > luminance(order[i - 1]),
      `${order[i]} is not lighter than ${order[i - 1]}`,
    );
  }
  // …and the page is visibly not white, or the cream is decoration nobody sees.
  assert.ok(ratio("elevated", "canvas") > 1.05);
});

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

test("the faintest text token clears WCAG AA on all four surfaces", () => {
  // `faint` is placeholders, the error digest and the sign-in footnote. In the
  // Chapter 1 dark palette this token did not clear AA on `elevated` and was
  // documented as "decorative only". On cream it clears everywhere, so the
  // exemption is gone and this asserts the stronger promise.
  for (const surface of SURFACES) {
    const r = ratio("faint", surface);
    assert.ok(r >= 4.5, `faint on ${surface} is ${r.toFixed(2)}:1, want >= 4.5`);
  }
});

test("every text-register tone clears WCAG AA on all four surfaces", () => {
  // This is the phase's implementation note turned into a gate. It covers the
  // accent, the four status tones and all five node categories — 40 pairings.
  for (const tone of TEXT_TONES) {
    for (const surface of SURFACES) {
      const r = ratio(tone, surface);
      assert.ok(r >= 4.5, `${tone} on ${surface} is ${r.toFixed(2)}:1, want >= 4.5`);
    }
  }
});

test("ink clears WCAG AA as the label on every pop fill", () => {
  // Why a pop fill never needs a white label, and why `--color-accent-ink` is ink.
  for (const fill of POP_FILLS) {
    const r = ratio("ink", fill);
    assert.ok(r >= 4.5, `ink on ${fill} is ${r.toFixed(2)}:1, want >= 4.5`);
  }
});

test("the two registers stay far apart, so neither drifts into the other", () => {
  // The whole palette turns on a tone having a dark half and a bright half. If a
  // later phase brightens a text tone to make it livelier, or darkens a fill to
  // make it "readable", the two collapse into one ambiguous token and every rule
  // above becomes unenforceable. A 2x luminance gap is the line.
  for (const tone of TEXT_TONES) {
    const dark = luminance(tone);
    const bright = luminance(`${tone}-pop`);
    assert.ok(
      bright > dark * 2,
      `${tone}-pop (${bright.toFixed(3)}) is not clearly brighter than ${tone} (${dark.toFixed(3)})`,
    );
  }
});

test("one ink focus ring is legal on every surface and every fill", () => {
  // WCAG 2.2 SC 1.4.11 wants 3:1 for a focus indicator against what surrounds it.
  // The accent fill is only 2.6:1 against cream, which is why the ring is ink — and
  // this is the assertion that makes that a system property rather than a choice.
  for (const behind of [...SURFACES, ...POP_FILLS]) {
    const r = ratio("ink", behind);
    assert.ok(r >= 3, `an ink focus ring on ${behind} is ${r.toFixed(2)}:1, want >= 3`);
  }
});

test("the ink outline is what separates a pop fill from the page, not its lightness", () => {
  // Several pop fills sit barely off the cream page — the lime and the amber are
  // around 1.3:1 — so an unoutlined pop object would float invisibly. The outline
  // carries it, on both sides. This is the computable form of "a pop fill is never
  // drawn without its ink outline", which is `DESIGN.md`'s hardest rule.
  const flattest = Math.min(...POP_FILLS.map((f) => ratio(f, "canvas")));
  assert.ok(flattest < 2, `no pop fill is flat against cream (${flattest.toFixed(2)}:1) — if the
    palette has changed so that every fill carries itself, this test has stopped
    describing the system and the outline rule should be re-derived`);

  for (const fill of POP_FILLS) {
    assert.ok(ratio("line", fill) >= 3, `the outline is invisible on ${fill}`);
  }
  assert.ok(ratio("line", "canvas") >= 3, "the outline is invisible on the page");
});

test("a tinted panel carries its own tone as text at AA", () => {
  // `bg-warn/10 text-warn` and friends — six live call sites across the inspector,
  // the generate form and the settings page.
  for (const tone of ["accent", "ok", "live", "warn", "bad"]) {
    for (const behind of ["canvas", "surface", "elevated"]) {
      const r = tintRatio(tone, behind);
      assert.ok(r >= 4.5, `${tone} on its own 12% tint over ${behind} is ${r.toFixed(2)}:1`);
    }
  }
});

test("a status chip clears WCAG AA on the recessed pill it actually sits on", () => {
  for (const tone of ["ok", "live", "warn", "bad", "muted"]) {
    const r = ratio(tone, "sunken");
    assert.ok(r >= 4.5, `${tone} chip is ${r.toFixed(2)}:1, want >= 4.5`);
  }
});

test("the stylesheet declares a light colour scheme", () => {
  // Without it the native `<select>`, the checkbox and the scrollbars render as dark
  // widgets in a cream interface. Chapter 1 declared `dark` here; a later phase
  // copying an old snippet back is exactly the regression this catches.
  assert.match(CSS, /color-scheme:\s*light/);
  assert.doesNotMatch(CSS, /color-scheme:\s*dark/);
});

test("every elevation shadow is a hard ink offset, with no blur", () => {
  // The hard edge is what makes an object read as a solid thing on the page rather
  // than a floating card. A blur radius would quietly turn Toybox back into the
  // material-elevation look every competing tool has.
  const shadows = [...CSS.matchAll(/--shadow-([a-z]+):\s*([^;]+);/g)];
  assert.ok(shadows.length >= 5, "the shadow scale is missing");
  for (const [, name, value] of shadows) {
    assert.match(
      value.trim(),
      /^-?\d+px -?\d+px 0 0 var\(--color-ink\)$/,
      `--shadow-${name} is "${value.trim()}" — want "<x>px <y>px 0 0 var(--color-ink)"`,
    );
  }
});

test("the palette catalogue and the stylesheet agree, in both directions", () => {
  // `src/lib/design/palette.ts` is what the gallery at `/design` reads, so it can
  // print a role and a measured ratio beside every swatch. It is a MIRROR of the
  // stylesheet, and this is what stops it becoming a second source of truth: a token
  // added to one and not the other, or a value changed in one and not the other,
  // fails here rather than quietly making the gallery lie.
  for (const spec of ALL_TOKENS) {
    const declared = TOKENS.get(spec.name);
    assert.ok(declared, `the catalogue lists --color-${spec.name}, the stylesheet does not`);
    assert.deepEqual(
      declared,
      spec.value,
      `--color-${spec.name}: stylesheet has ${JSON.stringify(declared)}, catalogue has ${JSON.stringify(spec.value)}`,
    );
  }

  const catalogued = new Set(ALL_TOKENS.map((t) => t.name));
  for (const name of TOKENS.keys()) {
    assert.ok(
      catalogued.has(name),
      `--color-${name} is declared but missing from the palette catalogue, so it will not appear in the gallery`,
    );
  }

  // Every token carries a role, or the gallery renders a swatch nobody can act on.
  for (const spec of ALL_TOKENS) {
    assert.ok(spec.role.length > 3, `--color-${spec.name} has no role`);
  }
  for (const group of PALETTE) {
    assert.ok(group.note.length > 20, `the "${group.title}" group has no note`);
  }
});

test("the catalogue's registers match what the tokens can actually do", () => {
  // A token marked `text` must be readable as text; a token marked `fill` must not
  // be — that is what the two registers mean, and mislabelling one in the catalogue
  // would put a misleading badge in the gallery next to a correct colour.
  for (const spec of ALL_TOKENS) {
    if (spec.register === "text") {
      const worst = Math.min(...SURFACES.map((s) => ratio(spec.name, s)));
      assert.ok(
        worst >= 4.5,
        `--color-${spec.name} is catalogued as a text register but is ${worst.toFixed(2)}:1 at worst`,
      );
    }
    if (spec.register === "fill") {
      assert.ok(
        ratio("ink", spec.name) >= 4.5,
        `--color-${spec.name} is catalogued as a fill but ink is not readable on it`,
      );
    }
  }
});
