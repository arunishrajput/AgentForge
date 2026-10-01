import assert from "node:assert/strict";
import { test } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * **A static guard over the shared UI primitives — Phase 25.**
 *
 * No test in this project renders a component: Node's test runner has no DOM, and
 * `DESIGN.md` → *Traps* records the consequence (`.tsx` files never appear in the coverage
 * report, because no test loads one). The project's answer for a UI claim is to drive the
 * deployed app — `scripts/verify-a11y.mjs` and the browser pass at the end of each phase.
 *
 * This file is the narrow exception that earns its place: it reads the primitives as *text*
 * and asserts a property that is true of correct code regardless of rendering, and that a
 * reviewer cannot see by looking at one file. It exists because of a real defect.
 *
 * **The defect.** `Dialog` carried `aria-labelledby="dialog-title"` and an `<h2>` with that
 * same literal id, from Phase 14 until Phase 25. Correct for one dialog per document;
 * wrong for two. The canvas mounts two, and a closed `<dialog>` still renders its heading,
 * so the page held two elements with one id — and `aria-labelledby` resolves to the *first*
 * match, which meant the version-history dialog was announced to a screen reader with the
 * share dialog's name. Nothing looked wrong. `verify-a11y.mjs` found it as a duplicate id.
 *
 * **The rule.** A reusable primitive may not hardcode an `id`, because it cannot know it is
 * mounted once. It must use `useId`. That is a property of the whole directory rather than
 * of one component, which is exactly the kind of thing worth asserting mechanically.
 */

const UI = dirname(fileURLToPath(import.meta.url));

const sources = readdirSync(UI)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => ({ name, text: readFileSync(join(UI, name), "utf8") }));

test("there are primitives to check, so a glob that matched nothing cannot pass", () => {
  assert.ok(sources.length >= 8, `only found ${sources.length} primitives in ${UI}`);
  assert.ok(sources.some((file) => file.name === "dialog.tsx"), "dialog.tsx is missing");
});

/**
 * A literal `id` on a JSX element in a reusable component. `id={...}` is fine — that is a
 * caller's value or a `useId` — and so is an `id` inside a string of CSS or a comment, which
 * is why the pattern is anchored to JSX attribute position.
 */
test("no shared primitive hardcodes an element id", () => {
  const offenders = [];
  for (const { name, text } of sources) {
    for (const match of text.matchAll(/(?:^|\s)id="([^"]*)"/g)) {
      offenders.push(`${name}: id="${match[1]}"`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `a reusable component cannot know it is mounted once, so a literal id is a latent ` +
      `duplicate-id bug — use useId(). Offenders: ${offenders.join(", ")}`,
  );
});

/**
 * The other half of the same defect: a primitive that *points* at an id with an ARIA
 * reference must generate it, or it points at whichever element happened to render first.
 */
test("every ARIA id reference in a primitive is an expression, never a literal", () => {
  const REFS = ["aria-labelledby", "aria-describedby", "aria-controls", "aria-owns"];
  const offenders = [];
  for (const { name, text } of sources) {
    for (const attr of REFS) {
      for (const match of text.matchAll(new RegExp(`${attr}="([^"{}]*)"`, "g"))) {
        offenders.push(`${name}: ${attr}="${match[1]}"`);
      }
    }
  }
  assert.deepEqual(offenders, [], `ARIA references to a literal id: ${offenders.join(", ")}`);
});

/**
 * `Dialog` specifically, because it is the component the defect was in and the assertion
 * above would still pass if somebody removed the id entirely — which would leave the dialog
 * with no accessible name at all, a worse 4.1.2 failure than the one being fixed.
 */
test("Dialog names itself from a generated id", () => {
  const dialog = sources.find((file) => file.name === "dialog.tsx")?.text ?? "";
  assert.match(dialog, /useId\(\)/, "Dialog does not call useId");
  assert.match(dialog, /aria-labelledby=\{titleId\}/, "Dialog does not label itself with the id");
  assert.match(dialog, /<h2 id=\{titleId\}/, "Dialog's title does not carry the id");
});
