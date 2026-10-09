import assert from "node:assert/strict";
import { test } from "node:test";

import { allInFrame } from "./motion";

const FRAME = { left: 100, right: 900, top: 50, bottom: 650 };
const box = (left: number, top: number, width = 224, height = 90) => ({ left, top, right: left + width, bottom: top + height });

test("steps already on screen keep the camera where it is — it moves only for one out of sight (D169)", () => {
  assert.equal(allInFrame([box(200, 200), box(500, 200)], FRAME), true);
  assert.equal(allInFrame([box(200, 200), box(800, 200)], FRAME), false, "the second runs off the right edge");
  assert.equal(allInFrame([box(200, 20)], FRAME), false, "clipped at the top");
  assert.equal(allInFrame([box(100, 50, 800, 600)], FRAME), true, "touching every edge is still inside");
});

test("a step or a frame that could not be measured is treated as out of sight", () => {
  assert.equal(allInFrame([box(200, 200), undefined], FRAME), false);
  assert.equal(allInFrame([box(200, 200)], undefined), false);
});
