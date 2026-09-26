/**
 * The colour maths behind the Toybox palette.
 *
 * Two callers, and that is the reason this is a module rather than a helper inside
 * the test: `src/app/tokens.test.ts` uses it to fail the build when a token drops
 * below WCAG AA, and `src/app/design/page.tsx` uses it to print the measured ratio
 * next to every swatch in the gallery. One implementation means the number on the
 * screen is the number in the gate — a gallery that quoted ratios from a hand-kept
 * table would be wrong within one phase.
 *
 * Every colour in `globals.css` is `oklch()`, which is what makes this cheap. The
 * conversion is Björn Ottosson's oklab → linear sRGB, and WCAG's relative luminance
 * is defined on exactly those linear values, so there is no gamma step in between.
 */

/** A parsed `oklch(L C H)` triple: lightness 0–1, chroma, hue in degrees. */
export type Oklch = [L: number, C: number, H: number];

/**
 * Pull every `--color-*: oklch(L C H)` declaration out of a stylesheet.
 *
 * Alpha forms (`oklch(L C H / A)`) are deliberately skipped: a token with alpha has
 * no fixed contrast, because it depends on what is behind it, so there is nothing
 * honest to measure. Those tokens are hairlines and tints, never text.
 */
export function parseTokens(css: string): Map<string, Oklch> {
  const found = new Map<string, Oklch>();
  const pattern = /--color-([\w-]+):\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)\s*;/g;
  for (const [, name, l, c, h] of css.matchAll(pattern)) {
    found.set(name, [Number(l), Number(c), Number(h)]);
  }
  return found;
}

/** oklch → linear-light sRGB, unclamped, so out-of-gamut values stay detectable. */
export function rawRgb([L, C, H]: Oklch): [number, number, number] {
  const hr = (H * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);

  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/**
 * Is the colour inside sRGB?
 *
 * This matters more than it looks. An out-of-gamut oklch value is clamped by the
 * browser, so the colour rendered is not the colour declared — and every ratio
 * computed from the declaration would be a measurement of something nobody sees.
 * The whole palette was fitted to stay inside the gamut for this reason.
 */
export function inGamut(colour: Oklch): boolean {
  return rawRgb(colour).every((v) => v >= -0.001 && v <= 1.001);
}

/** …and clamped, which is approximately what a browser does with the rest. */
export function linearRgb(colour: Oklch): [number, number, number] {
  const [r, g, b] = rawRgb(colour);
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return [clamp(r), clamp(g), clamp(b)];
}

/** WCAG relative luminance. */
export function luminance(colour: Oklch): number {
  const [r, g, b] = linearRgb(colour);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio between two colours, 1–21. */
export function contrast(a: Oklch, b: Oklch): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * A tone at `alpha` over a background, as a flat colour.
 *
 * Returned in linear sRGB rather than as an `Oklch`, because a mix of two oklch
 * colours is not itself expressible as one — `luminanceOf` takes it from here. This
 * is what measures the `bg-warn/10 text-warn` panels the app is full of.
 */
export function mixLuminance(tone: Oklch, behind: Oklch, alpha: number): number {
  const a = linearRgb(tone);
  const b = linearRgb(behind);
  const mixed = a.map((c, i) => c * alpha + b[i] * (1 - alpha));
  return 0.2126 * mixed[0] + 0.7152 * mixed[1] + 0.0722 * mixed[2];
}

/** The contrast ratio between two already-computed luminances. */
export function contrastOfLuminance(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** sRGB hex, for the gallery's swatch captions and the static illustration files. */
export function hex(colour: Oklch): string {
  return (
    "#" +
    linearRgb(colour)
      .map((c) => {
        const encoded = c <= 0.003_130_8 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
        return Math.round(Math.min(1, Math.max(0, encoded)) * 255)
          .toString(16)
          .padStart(2, "0");
      })
      .join("")
  );
}

/**
 * Which WCAG grade a ratio reaches, for normal-sized text.
 *
 * Large text (18.66px bold or 24px) is allowed 3:1, but nothing in this system
 * relies on that allowance — the smallest tokens carry 10 and 11px captions, so the
 * gallery grades everything against the stricter bar and says so.
 */
export function grade(ratio: number): "AAA" | "AA" | "fail" {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  return "fail";
}
