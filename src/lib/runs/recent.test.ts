import assert from "node:assert/strict";
import { test } from "node:test";

import type { StreamRun } from "@/lib/engine/stream";

import type { RunSummary } from "./history";
import { mergeRecent, summaryOf } from "./recent";

function streamed(id: string, overrides: Partial<StreamRun> = {}): StreamRun {
  return {
    id,
    workflowId: "wf-1",
    status: "running",
    trigger: "manual",
    mode: "sync",
    attempt: 1,
    cancelRequested: false,
    handled: 0,
    wakeAt: null,
    test: null,
    origin: null,
    workflowVersion: 3,
    input: { secret: "not in a summary" },
    output: null,
    error: null,
    startedAt: `2026-10-08T09:00:0${id.length}.000Z`,
    finishedAt: null,
    durationMs: null,
    steps: [],
    ...overrides,
  };
}

const listed = (id: string, startedAt: string): RunSummary => ({
  ...summaryOf(streamed(id, { status: "succeeded" }), "Daily digest"),
  startedAt,
});

test("a summary carries no input, output or steps", () => {
  const summary = summaryOf(streamed("r1"), "Daily digest") as unknown as Record<string, unknown>;
  assert.equal("input" in summary, false);
  assert.equal("output" in summary, false);
  assert.equal("steps" in summary, false);
  assert.equal(summary.workflowName, "Daily digest");
});

test("a run the list already holds is updated in place — a running row ends green", () => {
  const recent = [listed("new", "2026-10-08T10:00:00.000Z"), listed("old", "2026-10-08T09:00:00.000Z")];
  const merged = mergeRecent(recent, streamed("new", { status: "succeeded", durationMs: 1200 }), "Daily digest");
  assert.deepEqual(merged.map((run) => run.id), ["new", "old"]);
  assert.equal(merged[0].durationMs, 1200);
});

test("a run the list has not seen goes on top, and the list keeps its length", () => {
  const recent = Array.from({ length: 8 }, (_, index) =>
    listed(`r${index}`, `2026-10-0${8 - Math.floor(index / 4)}T0${index % 4}:00:00.000Z`),
  );
  const merged = mergeRecent(recent, streamed("fresh", { startedAt: "2026-10-09T00:00:00.000Z" }), "Daily digest");
  assert.equal(merged.length, 8);
  assert.equal(merged[0].id, "fresh");
});

test("nothing showing changes nothing, and neither does another workflow's run", () => {
  const recent = [listed("a", "2026-10-08T10:00:00.000Z")];
  assert.deepEqual(mergeRecent(recent, null, "Daily digest"), recent);
  assert.deepEqual(mergeRecent(recent, streamed("b", { workflowId: "wf-2" }), "Daily digest"), recent);
});

test("the first run of a workflow with no history starts the list", () => {
  assert.deepEqual(mergeRecent([], streamed("first"), "Daily digest").map((run) => run.id), ["first"]);
});
