import assert from "node:assert/strict";
import { test } from "node:test";

import { runStatesOf } from "./run-states";

const step = (nodeId: string, status: "succeeded" | "running" | "reused" | "failed", branch: string | null = null) => ({
  nodeId,
  status,
  branch,
  error: status === "failed" ? "nope" : null,
});

test("no run paints nothing", () => {
  assert.equal(runStatesOf(null).size, 0);
});

test("a looped node shows its latest pass and how many there were", () => {
  const states = runStatesOf({
    status: "succeeded",
    steps: [step("each", "succeeded", "loop"), step("each", "succeeded", "done")],
  });
  assert.deepEqual(states.get("each"), { status: "succeeded", executions: 2, branch: "done", error: null, paused: false });
});

test("a running step in a waiting run is paused; in a running run it is not", () => {
  assert.equal(runStatesOf({ status: "waiting", steps: [step("wait", "running")] }).get("wait")?.paused, true);
  assert.equal(runStatesOf({ status: "running", steps: [step("wait", "running")] }).get("wait")?.paused, false);
});

test("a retry's carried-over steps are painted as reused", () => {
  const states = runStatesOf({ status: "failed", steps: [step("trigger", "reused"), step("guard", "failed")] });
  assert.equal(states.get("trigger")?.status, "reused");
  assert.equal(states.get("guard")?.error, "nope");
});
