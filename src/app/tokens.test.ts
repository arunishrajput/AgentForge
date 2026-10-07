import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  contrast,
  contrastOfLuminance,
  declarations,
  hex,
  inGamut,
  luminance as luminanceOf,
  mixLuminance,
  parseTokens,
} from "../lib/design/contrast";
import { ALL_TOKENS, PALETTE, THEME_LABEL, THEMES, type Theme } from "../lib/design/palette";

/**
 * The colour half of the Toybox design system (Phase 14), checked rather than
 * asserted — and since Phase 27, checked **once per theme**.
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
 * one that is safe as text, and a `-pop` one that is a fill with the `accent-ink`
 * label. Most of what follows is that rule, made mechanical:
 *
 *   - every text-register token clears AA on all four surfaces
 *   - the label clears AA on every `-pop` fill, so a label on a fill is always readable
 *   - the two registers stay far enough apart that neither drifts into the other
 *   - ink clears 3:1 against every surface and every fill, which is what makes one
 *     ink focus ring legal everywhere (WCAG 2.2 SC 1.4.11)
 *   - some object sits flat against the page, so the OUTLINE is what separates it —
 *     asserted, because it is the reason no object may ever be drawn without one
 *
 * **Toybox Night is held to every one of these** (`DECISIONS.md` D110: "the gates run
 * per theme rather than being relaxed for one"). Four statements genuinely differ
 * between a cream page and an indigo one, and they are declared once, in `RULES`
 * below, rather than loosened inside a test. Everything else is the same assertion
 * against the other block of `globals.css`.
 *
 * The maths lives in `src/lib/design/contrast.ts` rather than here, because the
 * gallery at `/design` prints the same numbers next to every swatch. One
 * implementation means the figure on the screen is the figure in this gate.
 */

const CSS = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

/** The block each theme's tokens are declared in, as `declarations()` names it. */
const SCOPE: Record<Theme, string> = {
  light: "@theme",
  dark: ":root > @variant dark",
};

const TOKENS: Record<Theme, ReturnType<typeof parseTokens>> = {
  light: parseTokens(CSS, SCOPE.light),
  dark: parseTokens(CSS, SCOPE.dark),
};

/** The four surfaces. Everything readable must be readable on all of them. */
const SURFACES = ["canvas", "surface", "elevated", "sunken"];

/** Every token in the text register — the ones a component may use as text. */
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

/** Every fill. `accent-ink` is the only legal label on any of them. */
const POP_FILLS = TEXT_TONES.map((t) => `${t}-pop`).concat("spark");

/**
 * What honestly differs between the themes — and nothing else does.
 *
 *   `surfaces`         a light page sits near the top of the luminance range, a dark
 *                      one near the bottom
 *   `brighter`         which register is the brighter half of each pair. In Light the
 *                      fill is the bright one and the text tone the dark one; in Night
 *                      the text has to be bright to read on indigo, so it is the other
 *                      way round. Either way they stay 2x apart
 *   `flat`             the objects that sit almost flat against the page, so that only
 *                      the outline separates them. In Light that is the pop fills
 *                      (amber and lime are ~1.3:1 off cream). In Night the fills stand
 *                      off the indigo by themselves, and it is the cards and nodes —
 *                      `surface` and `elevated` — that would vanish without their outline
 *   `colorScheme`      what native widgets are told to draw
 */
const RULES: Record<
  Theme,
  {
    surfaces: (luminance: number) => boolean;
    surfacesAre: string;
    brighter: "fill" | "text";
    flat: string[];
    colorScheme: "light" | "dark";
  }
> = {
  light: {
    surfaces: (l) => l > 0.75,
    surfacesAre: "near the top of the range",
    brighter: "fill",
    flat: POP_FILLS,
    colorScheme: "light",
  },
  dark: {
    surfaces: (l) => l < 0.05,
    surfacesAre: "near the bottom of the range",
    brighter: "text",
    flat: ["surface", "elevated"],
    colorScheme: "dark",
  },
};

for (const theme of THEMES) {
  /** `--color-x` → its parsed triple in this theme, asserting the token exists at all. */
  const token = (name: string) => {
    const value = TOKENS[theme].get(name);
    assert.ok(value, `token --color-${name} is not declared as a plain oklch() value in ${theme}`);
    return value;
  };
  const luminance = (name: string) => luminanceOf(token(name));
  const ratio = (foreground: string, background: string) =>
    contrast(token(foreground), token(background));

  /**
   * What a tinted panel scores: a tone at `alpha` over a surface, with the undiluted
   * tone as its text. Chapter 1 built six places exactly this way — `bg-warn/10
   * text-warn` — and Phases 15–16 replaced every one with a `Notice`, because a tint
   * on cream reads as a smudge. The gate stays, in both themes: it is what makes the
   * idiom safe to reach for if it ever comes back, and on an indigo page — where a
   * tint is a perfectly good idiom — it is the likeliest thing to come back.
   */
  const tintRatio = (tone: string, behind: string, alpha = 0.12) =>
    contrastOfLuminance(luminance(tone), mixLuminance(token(tone), token(behind), alpha));

  const rules = RULES[theme];

  describe(`${THEME_LABEL[theme]} (${theme})`, () => {
    test("every token is inside sRGB, so the browser renders what is measured here", () => {
      // A clamped channel means the rendered colour is not the declared one, which would
      // make every ratio in this file a measurement of something nobody sees.
      for (const name of TOKENS[theme].keys()) {
        assert.ok(inGamut(token(name)), `--color-${name} is outside sRGB and will be clamped`);
      }
    });

    test(`every surface is ${rules.surfacesAre}`, () => {
      for (const surface of SURFACES) {
        assert.ok(
          rules.surfaces(luminance(surface)),
          `${surface} has luminance ${luminance(surface).toFixed(3)} — not ${rules.surfacesAre}`,
        );
      }
    });

    test("the four surfaces are ordered, and deliberately close together", () => {
      // Toybox separates an object from the page with an outline and a hard shadow, not
      // by making it a paler shade — so these steps are SMALL on purpose, in both
      // themes. The Chapter 1 dark palette asserted a 1.4x luminance step between
      // surfaces; asserting that here would be asserting the wrong design. What must
      // hold is the ordering, and that no two steps collapse into the same value.
      const order = ["sunken", "canvas", "surface", "elevated"];
      for (let i = 1; i < order.length; i++) {
        assert.ok(
          luminance(order[i]) > luminance(order[i - 1]),
          `${order[i]} is not lighter than ${order[i - 1]}`,
        );
      }
      // …and a lifted object is visibly not the page, or the step is decoration
      // nobody sees.
      assert.ok(ratio("elevated", "canvas") > 1.05);
    });

    test("body text clears WCAG AAA on every surface", () => {
      for (const surface of SURFACES) {
        const r = ratio("ink", surface);
        assert.ok(r >= 7, `ink on ${surface} is ${r.toFixed(2)}:1, want >= 7`);
      }
    });

    test("secondary text clears WCAG AA on every surface", () => {
      // `text-muted` carries captions, log lines and help text at 11 and 12 px, which
      // is "normal" text for WCAG — 4.5:1, not the 3:1 large-text allowance.
      for (const surface of SURFACES) {
        const r = ratio("muted", surface);
        assert.ok(r >= 4.5, `muted on ${surface} is ${r.toFixed(2)}:1, want >= 4.5`);
      }
    });

    test("the faintest text token clears WCAG AA on all four surfaces", () => {
      // `faint` is placeholders, the error digest and the sign-in footnote. In the
      // Chapter 1 dark palette this token did not clear AA on `elevated` and was
      // documented as "decorative only". That exemption is gone, in both themes.
      for (const surface of SURFACES) {
        const r = ratio("faint", surface);
        assert.ok(r >= 4.5, `faint on ${surface} is ${r.toFixed(2)}:1, want >= 4.5`);
      }
    });

    test("every text-register tone clears WCAG AA on all four surfaces", () => {
      // The Phase 14 implementation note turned into a gate. It covers the accent, the
      // four status tones and all five node categories — 40 pairings per theme.
      for (const tone of TEXT_TONES) {
        for (const surface of SURFACES) {
          const r = ratio(tone, surface);
          assert.ok(r >= 4.5, `${tone} on ${surface} is ${r.toFixed(2)}:1, want >= 4.5`);
        }
      }
    });

    test("the label clears WCAG AA on every pop fill", () => {
      // Why a pop fill never needs a white — or, in Night, a cream — label. The label is
      // `accent-ink`, and it is the one ink role that does not change with the theme.
      for (const fill of POP_FILLS) {
        const r = ratio("accent-ink", fill);
        assert.ok(r >= 4.5, `accent-ink on ${fill} is ${r.toFixed(2)}:1, want >= 4.5`);
      }
    });

    test("the two registers stay far apart, so neither drifts into the other", () => {
      // The whole palette turns on a tone having a text half and a fill half. If a later
      // phase moves one toward the other, the two collapse into one ambiguous token and
      // every rule above becomes unenforceable. A 2x luminance gap is the line — and
      // which half is the brighter one is a property of the theme, stated in `RULES`.
      for (const tone of TEXT_TONES) {
        const text = luminance(tone);
        const fill = luminance(`${tone}-pop`);
        const [bright, dim] = rules.brighter === "fill" ? [fill, text] : [text, fill];
        assert.ok(
          bright > dim * 2,
          `${tone} (${text.toFixed(3)}) and ${tone}-pop (${fill.toFixed(3)}) are not 2x apart with the ${rules.brighter} brighter`,
        );
      }
    });

    test("one ink focus ring is legal on every surface and every fill", () => {
      // WCAG 2.2 SC 1.4.11 wants 3:1 for a focus indicator against what surrounds it.
      // The accent fill is only 2.6:1 against cream, which is why the ring is ink — and
      // this is the assertion that makes that a system property rather than a choice.
      // In Night the ring is cream, and the fills were fitted so it still clears 3:1 on
      // every one of them.
      for (const behind of [...SURFACES, ...POP_FILLS]) {
        const r = ratio("ink", behind);
        assert.ok(r >= 3, `an ink focus ring on ${behind} is ${r.toFixed(2)}:1, want >= 3`);
      }
    });

    test("the outline is what separates an object from the page, not its lightness", () => {
      // The computable form of `DESIGN.md`'s hardest rule: an object is never drawn
      // without its outline. Which objects would vanish without one is the theme's
      // business (`RULES.flat`); that some do is asserted from this side, and that the
      // outline always shows is asserted from the other.
      const flattest = Math.min(...rules.flat.map((f) => ratio(f, "canvas")));
      assert.ok(flattest < 2, `nothing in [${rules.flat.join(", ")}] is flat against the page
        (${flattest.toFixed(2)}:1) — if every object now carries itself, this test has
        stopped describing the system and the outline rule should be re-derived`);

      for (const behind of [...POP_FILLS, ...SURFACES]) {
        assert.ok(ratio("line", behind) >= 3, `the outline is invisible on ${behind}`);
      }
    });

    test("the hard shadow reads as a solid edge on every surface", () => {
      // Phase 27 gave the shadow its own token because in Night a near-black one would
      // vanish into the indigo. 3:1 is the non-text bar: the shadow is the object's
      // thickness, and a thickness nobody can see is no thickness.
      for (const surface of SURFACES) {
        const r = ratio("shade", surface);
        assert.ok(r >= 3, `the shadow on ${surface} is ${r.toFixed(2)}:1, want >= 3`);
      }
    });

    test("the scrim darkens the page it covers", () => {
      // A modal's backdrop must recede in both themes. Ink would have done in Light and
      // become a cream fog in Night, which is why the backdrop has its own name.
      assert.ok(luminance("scrim") < luminance("sunken"), "the scrim is not darker than the page");
    });

    test("a tinted panel carries its own tone as text at AA", () => {
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

    test("the palette catalogue and the stylesheet agree, in both directions", () => {
      // `src/lib/design/palette.ts` is what the gallery at `/design` reads, so it can
      // print a role and a measured ratio beside every swatch. It is a MIRROR of the
      // stylesheet, and this is what stops it becoming a second source of truth: a
      // token added to one and not the other, or a value changed in one and not the
      // other, fails here rather than quietly making the gallery lie.
      for (const spec of ALL_TOKENS) {
        const declared = TOKENS[theme].get(spec.name);
        assert.ok(declared, `the catalogue lists --color-${spec.name}, the ${theme} block does not`);
        assert.deepEqual(
          declared,
          spec[theme],
          `--color-${spec.name} in ${theme}: stylesheet has ${JSON.stringify(declared)}, catalogue has ${JSON.stringify(spec[theme])}`,
        );
      }

      const catalogued = new Set(ALL_TOKENS.map((t) => t.name));
      for (const name of TOKENS[theme].keys()) {
        assert.ok(
          catalogued.has(name),
          `--color-${name} is declared but missing from the palette catalogue, so it will not appear in the gallery`,
        );
      }
    });

    test("the catalogue's registers match what the tokens can actually do", () => {
      // A token marked `text` must be readable as text; a token marked `fill` must carry
      // the label — that is what the registers mean, and mislabelling one in the
      // catalogue would put a misleading badge in the gallery next to a correct colour.
      for (const spec of ALL_TOKENS) {
        if (spec.register === "text" || spec.register === "ink") {
          const worst = Math.min(...SURFACES.map((s) => ratio(spec.name, s)));
          assert.ok(
            worst >= 4.5,
            `--color-${spec.name} is catalogued as ${spec.register} but is ${worst.toFixed(2)}:1 at worst`,
          );
        }
        if (spec.register === "fill") {
          assert.ok(
            ratio("accent-ink", spec.name) >= 4.5,
            `--color-${spec.name} is catalogued as a fill but its label is not readable on it`,
          );
        }
        if (spec.register === "line") {
          const worst = Math.min(...SURFACES.map((s) => ratio(spec.name, s)));
          assert.ok(worst >= 3, `--color-${spec.name} is catalogued as a line but is ${worst.toFixed(2)}:1`);
        }
      }
    });
  });
}

describe("both themes", () => {
  const all = declarations(CSS);
  const token = (theme: Theme, name: string) => {
    const value = TOKENS[theme].get(name);
    assert.ok(value, `--color-${name} is missing from ${theme}`);
    return value;
  };
  const colourNames = (scope: string) =>
    new Set(
      all
        .filter((d) => d.scope === scope && d.property.startsWith("--color-"))
        .map((d) => d.property),
    );

  test("Night re-declares every colour token Light declares, and invents none", () => {
    // A token Night forgets keeps its LIGHT value on an indigo page — a near-black label
    // where cream was meant, say — and nothing else would notice. `line-soft` and the
    // other alpha tokens count here even though they are never measured.
    assert.deepEqual([...colourNames(SCOPE.dark)].sort(), [...colourNames(SCOPE.light)].sort());
  });

  test("no colour token is declared anywhere but the two theme blocks", () => {
    // The trap the selector-aware parser exists for: a `--color-*` in some third block
    // would override one theme or the other with nothing in this file measuring it.
    const stray = all.filter(
      (d) =>
        d.property.startsWith("--color-") && d.scope !== SCOPE.light && d.scope !== SCOPE.dark,
    );
    assert.deepEqual(stray, []);
  });

  test("each theme declares its own colour scheme, and nothing else declares one", () => {
    // Without it the native `<select>`, the checkbox and the scrollbars render in the
    // other theme's widgets. Chapter 1 declared `dark` on `:root`; a later phase copying
    // that snippet back is exactly the regression this catches.
    const schemes = all
      .filter((d) => d.property === "color-scheme")
      .map(({ scope, value }) => ({ scope, value }));
    assert.deepEqual(schemes, [
      { scope: ":root", value: RULES.light.colorScheme },
      { scope: SCOPE.dark, value: RULES.dark.colorScheme },
    ]);
  });

  test("every elevation shadow is a hard offset in `shade`, with no blur, declared once", () => {
    // The hard edge is what makes an object read as a solid thing on the page rather
    // than a floating card. A blur radius would quietly turn Toybox back into the
    // material-elevation look every competing tool has — and a dark theme is exactly
    // where a soft glow tries to come back (`DESIGN.md` → *Traps*). The shadow is
    // declared once, in `@theme`; it follows the theme through `shade`, so a Night
    // block that redeclared a shadow would be a second place for a blur to hide.
    const shadows = all.filter((d) => d.property.startsWith("--shadow-"));
    assert.ok(shadows.length >= 5, "the shadow scale is missing");
    for (const { property, value, scope } of shadows) {
      assert.equal(scope, SCOPE.light, `${property} is declared in ${scope}`);
      assert.match(
        value,
        /^-?\d+px -?\d+px 0 0 var\(--color-shade\)$/,
        `${property} is "${value}" — want "<x>px <y>px 0 0 var(--color-shade)"`,
      );
    }
  });

  test("the `dark` variant follows the reader's choice, and the OS only when they chose System", () => {
    // These attribute values are the contract with the script in `layout.tsx`
    // (`src/lib/ui/theme.ts`). If the variant fell back to Tailwind's built-in — the OS
    // alone — Night would arrive uninvited for every visitor whose OS is dark, which is
    // the one thing D110 rules out: Light is the default even then.
    const variant = /@custom-variant dark \{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? "";
    assert.match(variant, /&:where\(\[data-theme="dark"\], \[data-theme="dark"\] \*\)/);
    assert.match(
      variant,
      /@media \(prefers-color-scheme: dark\)\s*\{\s*&:where\(\[data-theme="system"\], \[data-theme="system"\] \*\)/,
    );
  });

  test("the select chevron is drawn in each theme's own ink", () => {
    // A data URI cannot read `var(--color-ink)`, so the arrow carries the hex itself —
    // which is exactly how it stayed near-black on an indigo well until Phase 27. This
    // ties each copy to the palette, so a moved ink fails here rather than in a browser.
    const chevron = (scope: string) =>
      all.find((d) => d.scope === scope && d.property === "background-image")?.value ?? "";
    const stroke = (theme: Theme) => `stroke='%23${hex(token(theme, "ink")).slice(1)}'`;
    assert.ok(chevron("@utility select-chevron").includes(stroke("light")), "the Light chevron is not Light's ink");
    assert.ok(
      chevron("@utility select-chevron > @variant dark").includes(stroke("dark")),
      "the Night chevron is not Night's ink",
    );
  });

  test("every catalogue group explains itself, and every token has a role", () => {
    for (const spec of ALL_TOKENS) {
      assert.ok(spec.role.length > 3, `--color-${spec.name} has no role`);
    }
    for (const group of PALETTE) {
      assert.ok(group.note.length > 20, `the "${group.title}" group has no note`);
    }
  });
});
