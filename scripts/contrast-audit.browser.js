/**
 * **Text contrast, measured on the rendered page — Phase 28.**
 *
 * Not a Node script: evaluate this file's contents in a page — the DevTools console,
 * Playwright's `page.evaluate`, or a browser-automation tool's "run JavaScript" — and it
 * returns every visible piece of text that misses WCAG 2.2 SC 1.4.3, as a list of strings.
 * An empty list is a pass. Run it in **both themes** on every screen a phase touches.
 *
 * ## Why it exists when the token gates already compute every pair
 *
 * `src/app/tokens.test.ts` proves that every legal pairing of tokens clears AA. It cannot
 * see which pair a component actually draws. Phase 28 found seven badges that used the
 * fill's label colour (`accent-ink`, near-black in both themes) with no fill behind it:
 * every token was legal, Light looked deliberate, and Toybox Night measured **1.06:1**.
 * This found it in one pass of the signed-in pages; the token gates and
 * `scripts/verify-a11y.mjs` (which reads HTML as text) both passed.
 *
 * ## What it does
 *
 * For each element that directly holds visible text it composites the backgrounds behind
 * it — walking up until one is opaque, layering any translucent ones — paints the text
 * colour over that with the element's opacity, reads both back as sRGB through a 1×1
 * canvas (so `oklch()`, `lab()` and `color-mix()` are resolved by the browser, not
 * re-implemented here), and computes the WCAG ratio. Large text (24px, or 18.66px bold)
 * needs 3:1, everything else 4.5:1.
 *
 * ## What it does not do
 *
 * It ignores disabled controls, which WCAG exempts, and `aria-hidden` subtrees and
 * `.sr-only` text, which nobody sees. It reads background *colours* only, so text over a
 * gradient or an image is measured against the colour beneath it — there is none of
 * either behind text in this product. It does not check non-text contrast (outlines,
 * focus rings); the token gates hold those, and the eye checks the rest.
 */
(() => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const paint = (layers) => {
    ctx.clearRect(0, 0, 1, 1);
    for (const [colour, alpha] of layers) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#000";
      ctx.fillStyle = colour;
      ctx.fillRect(0, 0, 1, 1);
    }
    ctx.globalAlpha = 1;
    return ctx.getImageData(0, 0, 1, 1).data;
  };
  const alphaOf = (colour) => paint([[colour, 1]])[3];

  const luminance = ([r, g, b]) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };

  /** The backgrounds behind an element, outermost first, down to the first opaque one. */
  const backdrop = (element) => {
    const layers = [];
    for (let e = element; e; e = e.parentElement) {
      const colour = getComputedStyle(e).backgroundColor;
      const alpha = alphaOf(colour);
      if (alpha > 0) {
        layers.push([colour, 1]);
        if (alpha === 255) break;
      }
    }
    if (layers.length === 0 || alphaOf(layers.at(-1)[0]) < 255) {
      layers.push([getComputedStyle(document.body).backgroundColor, 1]);
    }
    return layers.toReversed();
  };

  const failures = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent.trim();
    const element = walker.currentNode.parentElement;
    if (!text || !element || seen.has(element)) continue;
    seen.add(element);

    if (element.closest('[aria-hidden="true"], .sr-only, :disabled, [aria-disabled="true"]')) continue;
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || Number(style.opacity) === 0) continue;
    const box = element.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) continue;

    const layers = backdrop(element);
    const behind = paint(layers);
    const front = paint([...layers, [style.color, Number(style.opacity) || 1]]);
    const [hi, lo] = [luminance(front), luminance(behind)].sort((a, b) => b - a);
    const ratio = (hi + 0.05) / (lo + 0.05);

    const size = parseFloat(style.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    const needed = large ? 3 : 4.5;
    if (ratio < needed) {
      const classes = String(element.className?.baseVal ?? element.className).slice(0, 80);
      failures.push(
        `${ratio.toFixed(2)}:1 (needs ${needed}) "${text.slice(0, 40)}" <${element.tagName.toLowerCase()} class="${classes}">`,
      );
    }
  }
  return failures;
})();
