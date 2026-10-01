/**
 * Did the demo walk's run do its job?
 *
 * This exists because Beat 7 and Beat 8 of `smoke.mjs` disagreed with each other for
 * three phases. Beat 8 knows that the generated Sheets node is **deliberately born
 * empty** (`src/lib/nodes/integration/sheets.ts` throws rather than guessing a
 * spreadsheet), so without `SMOKE_SPREADSHEET_ID` it SKIPs its half. Beat 7 asked the
 * blunter question — `run.status === "succeeded"` — and so it FAILED for exactly the
 * reason Beat 8 had just excused, which made the whole script print FAILED against a
 * healthy deployment. The script's own header documented only the SKIP.
 *
 * That is the failure mode this project already wrote up about `verify-a11y.mjs`: an
 * audit that cries wolf is worse than no audit, because the next person turns it off.
 * And this is the script `PROGRESS.md` tells every session to run *first*.
 *
 * The excuse is kept deliberately narrow. It applies only when the sheet was never
 * configured, only when the run actually reached step execution, and only when every
 * failed step is the Sheets node failing for *that one reason*. A Sheets node that
 * fails on credentials, scope or a Google API error is a real failure and still fails —
 * which is the whole point of not simply ignoring the node.
 */

/**
 * A substring of the message in `sheets.ts`, not the whole sentence. Matching the
 * sentence would couple this to the node's copy; matching the substring survives a
 * reworded hint and still cannot match a credential or API error.
 */
export const UNCONFIGURED_SHEETS = "has no spreadsheet yet";

export const SHEETS_NODE = "integration.sheets";

/**
 * @param run           the run as `/api/runs/:id` returns it
 * @param spreadsheetId `SMOKE_SPREADSHEET_ID`, or "" when it was never set
 * @returns `acceptable` — whether Beat 7 should pass.
 *          `excused`    — true only when it passes *because* the sheet was unconfigured,
 *                         so the caller can say so instead of claiming a clean run.
 */
export function runOutcome(run, spreadsheetId) {
  if (run?.status === "succeeded") return { acceptable: true, excused: false };

  const failed = (run?.steps ?? []).filter((s) => s.status === "failed");

  const excused =
    spreadsheetId.length === 0 &&
    run?.status === "failed" &&
    failed.length > 0 &&
    failed.every(
      (s) => s.nodeType === SHEETS_NODE && (s.error ?? "").includes(UNCONFIGURED_SHEETS),
    );

  return { acceptable: excused, excused };
}

/* ------------------------------------------------------------------ *
 * Beat 1 — the cold-start reading
 * ------------------------------------------------------------------ */

/**
 * Warm enough that nobody watching would call it a stall.
 *
 * It was always 5 s and it stays 5 s. What changed is what a breach *means*.
 */
export const WARM_THRESHOLD_MS = 5000;

/**
 * Beat 1 measured the first interaction and **failed** past 5 s, advising "warm both
 * before demoing". That was sound while Cloud Run ran at `min-instances 1`, because
 * then Cloud Run could not be cold and the only sleeping tier was Neon — a slow first
 * request really did mean somebody had forgotten to warm the database.
 *
 * **M12 (2026-10-01) set `min-instances 0`**, so a cold first request is now the
 * *designed* steady state of an idle deployment rather than an oversight. Keeping the
 * hard failure would have made the script report FAILED on a correctly configured
 * system — the same cry-wolf failure that Beat 7 had, one beat earlier.
 *
 * So the reading is now a **measurement by default** and an **assertion on request**.
 * `--expect-warm` is what the pre-demo checklist passes, because fifteen minutes before
 * a demo "is it warm?" is a real question with a real answer. A session asking the
 * ordinary question — does the product still work end to end — gets the number and no
 * false alarm.
 *
 * @param elapsedMs  how long the first `/api/health` took
 * @param expectWarm whether the caller asserted this deployment should already be warm
 */
export function coldStartVerdict(elapsedMs, { expectWarm = false } = {}) {
  const warm = elapsedMs < WARM_THRESHOLD_MS;
  return {
    warm,
    // Only an explicit expectation can fail this.
    acceptable: warm || !expectWarm,
    // True when it was cold and the caller did not mind — worth printing, not failing.
    excused: !warm && !expectWarm,
  };
}
