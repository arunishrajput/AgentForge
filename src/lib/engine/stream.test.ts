import assert from "node:assert/strict";
import { test } from "node:test";

import {
  emptyStreamState,
  followDecision,
  formatComment,
  formatEvent,
  reconcile,
  type StreamRun,
  type StreamRunPatch,
  type StreamStep,
} from "./stream";

/**
 * Critical-path tests for the streaming protocol. The reconcile/framing logic is
 * pure, so what a client actually receives is asserted here with no database, no
 * HTTP and no browser — the route is then only plumbing around this.
 */

let seq = 0;

function step(overrides: Partial<StreamStep> = {}): StreamStep {
  return {
    seq: seq++,
    nodeId: "a",
    nodeType: "core.log",
    iteration: 0,
    status: "running",
    config: null,
    input: null,
    output: null,
    branch: null,
    logs: [],
    error: null,
    startedAt: "2026-09-26T00:00:00.000Z",
    finishedAt: null,
    ...overrides,
  };
}

function run(overrides: Partial<StreamRun> = {}): StreamRun {
  return {
    id: "run_1",
    workflowId: "wf_1",
    status: "running",
    trigger: "manual",
    input: null,
    output: null,
    error: null,
    startedAt: "2026-09-26T00:00:00.000Z",
    finishedAt: null,
    durationMs: null,
    steps: [],
    ...overrides,
  };
}

test("no run yet means no events, and the stream keeps waiting", () => {
  const result = reconcile(emptyStreamState(), null);
  assert.deepEqual(result.events, []);
  assert.equal(result.terminal, false);
});

test("a run the stream has not seen is sent whole, as one snapshot", () => {
  seq = 0;
  const first = run({ steps: [step({ status: "succeeded" }), step()] });
  const result = reconcile(emptyStreamState(), first);

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].event, "snapshot");
  assert.equal(result.events[0].data, first);
  assert.equal(result.state.runId, "run_1");
  assert.equal(result.state.steps.size, 2);
});

test("a reconnect resends the whole run rather than replaying events", () => {
  // Which is the entire recovery story: a fresh state always produces a snapshot,
  // so a client that reconnects mid-run cannot end up with a partial view.
  seq = 0;
  const mid = run({ steps: [step({ status: "succeeded" }), step()] });
  const reconnected = reconcile(emptyStreamState(), mid);
  assert.equal(reconnected.events[0].event, "snapshot");
  assert.deepEqual((reconnected.events[0].data as StreamRun).steps?.length, 2);
});

test("an unchanged run produces nothing at all", () => {
  seq = 0;
  const current = run({ steps: [step()] });
  const { state } = reconcile(emptyStreamState(), current);
  assert.deepEqual(reconcile(state, current).events, []);
});

test("a step that starts, then finishes, is two events", () => {
  seq = 0;
  const started = step();
  let state = reconcile(emptyStreamState(), run({ steps: [] })).state;

  const afterStart = reconcile(state, run({ steps: [started] }));
  assert.deepEqual(
    afterStart.events.map((event) => event.event),
    ["step"],
  );
  state = afterStart.state;

  const afterFinish = reconcile(
    state,
    run({
      steps: [{ ...started, status: "succeeded", finishedAt: "2026-09-26T00:00:01.000Z" }],
    }),
  );
  assert.deepEqual(
    afterFinish.events.map((event) => event.event),
    ["step"],
  );
  assert.equal(
    (afterFinish.events[0].data as { step: StreamStep }).step.status,
    "succeeded",
  );
});

test("a log line written while the step is still running is streamed on its own", () => {
  // This is what makes an agent node watchable: the step has not finished, only its
  // log tail grew, and that alone has to reach the client.
  seq = 0;
  const running = step();
  const state = reconcile(emptyStreamState(), run({ steps: [running] })).state;

  const logged: StreamStep = {
    ...running,
    logs: [{ at: "2026-09-26T00:00:00.500Z", level: "info", message: "Waiting 2000 ms." }],
  };
  const result = reconcile(state, run({ steps: [logged] }));

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].event, "step");
  assert.equal(
    (result.events[0].data as { step: StreamStep }).step.logs?.[0].message,
    "Waiting 2000 ms.",
  );
});

test("every final step status is sent before the run is declared over", () => {
  seq = 0;
  const running = step();
  const state = reconcile(emptyStreamState(), run({ steps: [running] })).state;

  const result = reconcile(
    state,
    run({
      status: "succeeded",
      finishedAt: "2026-09-26T00:00:02.000Z",
      durationMs: 2000,
      steps: [{ ...running, status: "succeeded", finishedAt: "2026-09-26T00:00:02.000Z" }],
    }),
  );

  assert.deepEqual(
    result.events.map((event) => event.event),
    ["step", "run"],
  );
  assert.equal(result.terminal, true);
  assert.equal((result.events[1].data as StreamRunPatch).status, "succeeded");
});

test("a run event carries the run's own fields and never its steps", () => {
  seq = 0;
  const state = reconcile(emptyStreamState(), run({ steps: [] })).state;
  const result = reconcile(state, run({ status: "failed", error: "boom", steps: [] }));

  const patch = result.events.at(-1)!.data as StreamRunPatch & { steps?: unknown };
  assert.equal(patch.runId, "run_1");
  assert.equal(patch.error, "boom");
  assert.equal("steps" in patch, false);
});

test("a different run replaces the one being followed", () => {
  seq = 0;
  const state = reconcile(emptyStreamState(), run({ steps: [step()] })).state;
  const result = reconcile(state, run({ id: "run_2", steps: [] }));

  assert.equal(result.events[0].event, "snapshot");
  assert.equal(result.state.runId, "run_2");
  assert.equal(result.state.steps.size, 0);
});

test("a run that is already terminal on connect is terminal immediately", () => {
  const result = reconcile(
    emptyStreamState(),
    run({ status: "succeeded", finishedAt: "2026-09-26T00:00:01.000Z", steps: [] }),
  );
  assert.equal(result.events[0].event, "snapshot");
  assert.equal(result.terminal, true);
});

test("a run still in flight is followed, however long it has been going", () => {
  const decision = followDecision(
    { id: "run_1", status: "running" },
    { baselineRunId: null, firstPoll: true },
  );
  assert.deepEqual(decision, { follow: true, baselineRunId: null });
});

test("a run that was already finished when the stream first looked is history", () => {
  // The bug this exists to prevent: the client opens the stream and only then
  // triggers the run, so on the first poll the newest run is often the previous one.
  // Reporting it would snapshot the wrong run and close the stream immediately —
  // which is exactly what happened the first time this ran against Cloud Run.
  const first = followDecision(
    { id: "previous", status: "succeeded" },
    { baselineRunId: null, firstPoll: true },
  );
  assert.deepEqual(first, { follow: false, baselineRunId: "previous" });

  // It stays ignored on every later poll, too.
  const again = followDecision(
    { id: "previous", status: "succeeded" },
    { baselineRunId: "previous", firstPoll: false },
  );
  assert.equal(again.follow, false);

  // And the run the client was actually waiting for is reported, even though it
  // finished before the stream got to it.
  const next = followDecision(
    { id: "fresh", status: "succeeded" },
    { baselineRunId: "previous", firstPoll: false },
  );
  assert.deepEqual(next, { follow: true, baselineRunId: "previous" });
});

test("no run at all leaves the baseline alone and reports nothing", () => {
  const decision = followDecision(null, { baselineRunId: null, firstPoll: true });
  assert.deepEqual(decision, { follow: false, baselineRunId: null });
});

test("a run that appears after the stream opened is followed even if it is already over", () => {
  const decision = followDecision(
    { id: "fast", status: "succeeded" },
    { baselineRunId: null, firstPoll: false },
  );
  assert.equal(decision.follow, true);
});

test("a pinned run is the only run followed, whatever its state", () => {
  assert.equal(
    followDecision(
      { id: "run_1", status: "running" },
      { pinnedRunId: "run_9", baselineRunId: null, firstPoll: true },
    ).follow,
    false,
  );
  assert.equal(
    followDecision(
      { id: "run_9", status: "succeeded" },
      { pinnedRunId: "run_9", baselineRunId: null, firstPoll: true },
    ).follow,
    true,
  );
});

test("framing puts data on one line even when the payload contains newlines", () => {
  // A raw newline inside `data:` ends the frame early and the client sees a truncated
  // event. JSON.stringify escaping it is what makes one data line always safe.
  const frame = formatEvent({
    event: "step",
    data: { message: "line one\nline two", quote: '"' },
  });

  const lines = frame.split("\n");
  assert.equal(lines[0], "event: step");
  assert.match(lines[1], /^data: /);
  assert.equal(lines[2], "");
  assert.equal(lines[3], "");
  assert.deepEqual(JSON.parse(lines[1].slice("data: ".length)), {
    message: "line one\nline two",
    quote: '"',
  });
});

test("a comment frame is a valid, ignorable keepalive", () => {
  assert.equal(formatComment("ping"), ": ping\n\n");
});
