/**
 * The regression this file exists for: `smoke.mjs` printed FAILED against a healthy
 * deployed service whenever `SMOKE_SPREADSHEET_ID` was unset — which is the default,
 * because the variable is in no committed `.env.example` and the generated Sheets node
 * is born empty on purpose. The first case below fails against the old Beat 7, which
 * asked only `run.status === "succeeded"`.
 *
 * The rest of the file is the guard: every way the excuse could be made to swallow a
 * real failure. An excuse that is too wide is worse than the bug it fixes, because it
 * turns the smoke script into one that cannot fail.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  coldStartVerdict,
  runOutcome,
  SHEETS_NODE,
  UNCONFIGURED_SHEETS,
  WARM_THRESHOLD_MS,
} from "./smoke-outcome.mjs";

const BORN_EMPTY = `This node ${UNCONFIGURED_SHEETS}. Open it and paste the Google Sheet's URL or id.`;

const step = (nodeType, status, error) => ({ nodeType, status, error });

describe("runOutcome", () => {
  it("accepts a clean run, and does not call it excused", () => {
    const outcome = runOutcome({ status: "succeeded", steps: [] }, "");
    assert.deepEqual(outcome, { acceptable: true, excused: false });
  });

  it("accepts a run whose only failure is the deliberately unconfigured Sheets node", () => {
    const outcome = runOutcome(
      {
        status: "failed",
        steps: [
          step("integration.discord", "succeeded"),
          step(SHEETS_NODE, "failed", BORN_EMPTY),
        ],
      },
      "",
    );
    assert.deepEqual(outcome, { acceptable: true, excused: true });
  });

  it("refuses the excuse once a spreadsheet was configured", () => {
    const outcome = runOutcome(
      { status: "failed", steps: [step(SHEETS_NODE, "failed", BORN_EMPTY)] },
      "1ABC_real_sheet_id",
    );
    assert.deepEqual(outcome, { acceptable: false, excused: false });
  });

  it("refuses a Sheets node that failed for any other reason", () => {
    for (const error of [
      "Google refused the request: 403 insufficient scope",
      "The spreadsheet could not be found.",
      "",
    ]) {
      const outcome = runOutcome(
        { status: "failed", steps: [step(SHEETS_NODE, "failed", error)] },
        "",
      );
      assert.equal(outcome.acceptable, false, `excused: ${error}`);
    }
  });

  it("refuses the excuse when any other node also failed", () => {
    const outcome = runOutcome(
      {
        status: "failed",
        steps: [
          step(SHEETS_NODE, "failed", BORN_EMPTY),
          step("integration.discord", "failed", "Discord returned 401"),
        ],
      },
      "",
    );
    assert.equal(outcome.acceptable, false);
  });

  it("refuses a run that failed before any step did", () => {
    // run.error set, no failed step — the excuse must not be reachable by an empty
    // `every()`, which is vacuously true on an empty array.
    const outcome = runOutcome({ status: "failed", steps: [], error: "boom" }, "");
    assert.equal(outcome.acceptable, false);
  });

  it("refuses any status that is neither succeeded nor failed", () => {
    for (const status of ["running", "queued", "cancelled", undefined]) {
      const outcome = runOutcome(
        { status, steps: [step(SHEETS_NODE, "failed", BORN_EMPTY)] },
        "",
      );
      assert.equal(outcome.acceptable, false, `excused: ${status}`);
    }
  });

  it("tolerates a run with no steps array at all", () => {
    assert.equal(runOutcome({ status: "failed" }, "").acceptable, false);
    assert.equal(runOutcome(null, "").acceptable, false);
  });
});

describe("coldStartVerdict", () => {
  /**
   * The regression: the real walk at 2026-10-01 15:5x took **11446 ms** on its first
   * `/api/health` because M12 had just set `min-instances 0` and both tiers were
   * asleep. The old Beat 7 fix had made the walk clean; this made it FAILED again, on
   * a deployment that was configured exactly as intended.
   */
  it("accepts the 11446 ms cold start that M12 made the designed steady state", () => {
    const verdict = coldStartVerdict(11446);
    assert.deepEqual(verdict, { warm: false, acceptable: true, excused: true });
  });

  it("still fails a cold start when the caller asserted the deployment is warm", () => {
    const verdict = coldStartVerdict(11446, { expectWarm: true });
    assert.deepEqual(verdict, { warm: false, acceptable: false, excused: false });
  });

  it("passes a warm reading either way, and never calls it excused", () => {
    for (const expectWarm of [false, true]) {
      assert.deepEqual(coldStartVerdict(761, { expectWarm }), {
        warm: true,
        acceptable: true,
        excused: false,
      });
    }
  });

  it("puts the boundary where the threshold says, not a millisecond either side", () => {
    assert.equal(coldStartVerdict(WARM_THRESHOLD_MS - 1).warm, true);
    assert.equal(coldStartVerdict(WARM_THRESHOLD_MS).warm, false);
  });

  it("keeps 5 s as the threshold — the number did not change, its meaning did", () => {
    assert.equal(WARM_THRESHOLD_MS, 5000);
  });
});
