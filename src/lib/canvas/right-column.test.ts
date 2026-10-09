import assert from "node:assert/strict";
import { test } from "node:test";

import { COPILOT_PANEL, INSPECTOR_PANEL, controls } from "./right-column";

test("a control names its panel only while that panel is in the document", () => {
  // The defect `verify-a11y` found on 00086-wnj: Copilot's `aria-controls` with the inspector shown.
  assert.equal(controls("copilot", "inspector"), undefined);
  assert.equal(controls("inspector", "copilot"), undefined);
  assert.equal(controls("copilot", "copilot"), COPILOT_PANEL);
  assert.equal(controls("inspector", "inspector"), INSPECTOR_PANEL);
});
