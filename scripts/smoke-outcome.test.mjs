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

import { runOutcome, SHEETS_NODE, UNCONFIGURED_SHEETS } from "./smoke-outcome.mjs";

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
