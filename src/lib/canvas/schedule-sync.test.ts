import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Workflow } from "./client";
import { isNewScheduledRun, withScheduleOf } from "./schedule-sync";

/**
 * The trigger panel on an open canvas, after a schedule fires — found on the deployed
 * service in Phase 26: both nodes ticked green at 16:41 while the panel still said
 * "Next run 16:41", because nothing refreshed the editor's copy of the workflow row.
 */

// Only the fields these functions read or must leave alone; the rest of `Workflow` is
// irrelevant to them, hence the cast.
const asOpened = {
  id: "w1",
  name: "Daily digest — renamed, not yet saved",
  graph: { version: 1, nodes: [], edges: [] },
  version: 2,
  active: true,
  scheduleNextAt: "2026-10-06T16:41:00.000Z",
  scheduleArmed: true,
  scheduleLastFiredAt: null,
} as unknown as Workflow;

const afterFiring = {
  ...asOpened,
  name: "Daily digest",
  graph: { version: 1, nodes: [{ id: "someone-elses-edit" }], edges: [] },
  version: 3,
  scheduleNextAt: "2026-10-07T16:41:00.000Z",
  scheduleArmed: true,
  scheduleLastFiredAt: "2026-10-06T16:41:00.112Z",
} as unknown as Workflow;

describe("re-reading the schedule when a schedule fires on an open canvas", () => {
  it("takes the next slot, the armed state and the last firing from the server", () => {
    const shown = withScheduleOf(asOpened, afterFiring);
    assert.equal(shown.scheduleNextAt, "2026-10-07T16:41:00.000Z");
    assert.equal(shown.scheduleArmed, true);
    assert.equal(shown.scheduleLastFiredAt, "2026-10-06T16:41:00.112Z");
  });

  it("leaves what unsaved changes are measured against untouched", () => {
    const shown = withScheduleOf(asOpened, afterFiring);
    assert.equal(shown.graph, asOpened.graph);
    assert.equal(shown.name, asOpened.name);
    assert.equal(shown.version, asOpened.version);
  });

  it("reports a timer that was not re-armed as not armed, rather than keeping the old answer", () => {
    const unarmed = { ...afterFiring, scheduleArmed: false } as Workflow;
    assert.equal(withScheduleOf(asOpened, unarmed).scheduleArmed, false);
  });
});

describe("which runs cause a re-read", () => {
  it("a schedule run the canvas has not seen", () => {
    assert.equal(isNewScheduledRun({ id: "r2", trigger: "schedule" }, "r1"), true);
    assert.equal(isNewScheduledRun({ id: "r1", trigger: "schedule" }, null), true);
  });

  it("not the same run again — the stream reports it on every poll", () => {
    assert.equal(isNewScheduledRun({ id: "r1", trigger: "schedule" }, "r1"), false);
  });

  it("not a manual or webhook run, which moves no schedule", () => {
    assert.equal(isNewScheduledRun({ id: "r2", trigger: "manual" }, null), false);
    assert.equal(isNewScheduledRun({ id: "r3", trigger: "webhook" }, null), false);
  });

  it("not when there is no run", () => {
    assert.equal(isNewScheduledRun(null, null), false);
  });
});
