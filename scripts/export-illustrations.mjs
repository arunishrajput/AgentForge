/**
 * Write the standalone SVG copies of the mascot and the empty-state scene, in Light and
 * in Toybox Night, and the favicon (both palettes in one file) — Phase 28.
 *
 *   npm run design:export
 *
 * The artwork in the app references `var(--color-*)` so a token change carries it
 * along; an `<img src>` in the README cannot, so these are resolved to literal hex
 * from the palette catalogue. `illustrations-static.test.ts` regenerates them in
 * memory and compares, which means a token change FAILS CI until this is re-run —
 * that is the point, and the reason there is a script rather than four hand-drawn
 * files that quietly go stale.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

// Run with `--import ./scripts/test-register.mjs`, which installs the resolve hook that
// lets Node load the TypeScript sources and their extensionless relative imports.
const { ICON_PATH, renderIcon, renderStaticIllustrations, STATIC_ILLUSTRATION_DIR } = await import(
  "../src/lib/design/illustrations-static.ts"
);

const dir = path.join(process.cwd(), STATIC_ILLUSTRATION_DIR);
mkdirSync(dir, { recursive: true });

for (const [name, contents] of renderStaticIllustrations()) {
  writeFileSync(path.join(dir, name), contents, "utf8");
  console.log(`wrote ${STATIC_ILLUSTRATION_DIR}/${name}`);
}

writeFileSync(path.join(process.cwd(), ICON_PATH), renderIcon(), "utf8");
console.log(`wrote ${ICON_PATH}`);
