import assert from "node:assert/strict";
import { test } from "node:test";

import type { StreamStep } from "@/lib/engine/stream";

import { testLabel, testOutcome } from "./test-run";

const names = new Map([
  ["fetch", "Fetch the issues"],
  ["shape", "Shape them"],
]);

const step = (nodeId: string, status: StreamStep["status"], extra: Partial<StreamStep> = {}): StreamStep => ({
  seq: 0,
  nodeId,
  nodeType: "core.set",
  iteration: 0,
  status,
  config: null,
  input: null,
  output: null,
  branch: null,
  logs: [],
  error: null,
  startedAt: null,
  finishedAt: null,
  ...extra,
});

test("a test run's chip says what was tested, by the node's name", () => {
  assert.equal(testLabel(null, names), null);
  assert.equal(testLabel({ scope: "workflow", nodeId: null }, names), "Test · pinned data");
  assert.equal(testLabel({ scope: "node", nodeId: "shape" }, names), "Test · Shape them alone");
  assert.equal(testLabel({ scope: "path", nodeId: "fetch" }, names), "Test · up to Fetch the issues");
  assert.equal(testLabel({ scope: "path", nodeId: "gone" }, names), "Test · up to gone");
});

test("a passing test counts what ran and what stood in with a pin", () => {
  const outcome = testOutcome(
    { status: "succeeded", error: null, durationMs: 1200, steps: [step("fetch", "pinned"), step("shape", "succeeded")] },
    "shape",
    names,
  );
  assert.deepEqual(outcome, {
    tone: "ok",
    title: "Tested Shape them",
    detail: "1 step ran, 1 used its pinned output in 1.2 s.",
  });
});

test("a failed test names the step that failed and its reason", () => {
  const outcome = testOutcome(
    { status: "failed", error: "x", durationMs: 10, steps: [step("fetch", "failed", { error: "404 from the API" })] },
    "shape",
    names,
  );
  assert.deepEqual(outcome, { tone: "bad", title: "Fetch the issues failed", detail: "404 from the API" });
});

test("a test whose target was never reached says so instead of claiming success", () => {
  for (const steps of [[step("fetch", "succeeded")], [step("fetch", "succeeded"), step("shape", "skipped")]]) {
    const outcome = testOutcome({ status: "succeeded", error: null, durationMs: 5, steps }, "shape", names);
    assert.equal(outcome.tone, "warn");
    assert.equal(outcome.title, "Shape them was not reached");
  }
});
