import assert from "node:assert/strict";
import { test } from "node:test";

import { graph } from "@/lib/engine/fixtures";

import { calleesOf, callProblem, MAX_CALL_DEPTH, type CalledWorkflow } from "./calls";
import { toolRef } from "./tool";

/**
 * **The static half of the call bounds — Phase 39** (D185). Cycles and depth are refused at save,
 * over what the graph says; `engine/run.ts` refuses them again over what happened. This file is the
 * first: pure, with the other workflows handed in.
 */

const calling = (...ids: string[]) =>
  graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      ...ids.map((id, index) => ({ id: `call${index}`, type: "core.call_workflow", config: { workflowId: id } })),
    ],
    ids.map((_, index) => ({ source: "trigger", target: `call${index}` })),
  );

const quiet = graph([{ id: "trigger", type: "core.manual_trigger" }], []);

const world = (entries: Record<string, { name: string; calls?: string[] }>) => {
  const map = new Map<string, CalledWorkflow>(
    Object.entries(entries).map(([id, entry]) => [id, { name: entry.name, graph: entry.calls ? calling(...entry.calls) : quiet }]),
  );
  return async (ids: string[]) => new Map([...map].filter(([id]) => ids.includes(id)));
};

test("a graph's callees are its Call workflow nodes' ids and the workflows its agents list", () => {
  const g = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "c", type: "core.call_workflow", config: { workflowId: "wf-a" } },
      { id: "agent", type: "ai.agent", config: { objective: "x", tools: ["core.log", toolRef("wf-b"), toolRef("wf-a")] } },
    ],
    [],
  );
  assert.deepEqual(calleesOf(g).sort(), ["wf-a", "wf-b"]);
});

test("a switched-off node calls nothing, and a reference that is not a literal id is left to run time", () => {
  const g = calling("wf-a", "{{input.which}}");
  g.nodes.find((node) => node.id === "call0")!.disabled = true;
  assert.deepEqual(calleesOf(g), []);
  assert.deepEqual(calleesOf(calling("{{input.which}}", "")), []);
});

test("a workflow that calls itself is a cycle", async () => {
  const problem = await callProblem({ workflowId: "wf-a", name: "A", graph: calling("wf-a"), load: world({}) });
  assert.equal(problem?.code, "call_cycle");
  assert.match(problem!.message, /A → A/);
});

test("a cycle through other workflows is found, and named from the saver round to the saver", async () => {
  // Saving A (calls B); B calls C; C calls A.
  const load = world({ "wf-b": { name: "B", calls: ["wf-c"] }, "wf-c": { name: "C", calls: ["wf-a"] } });
  const problem = await callProblem({ workflowId: "wf-a", name: "A", graph: calling("wf-b"), load });
  assert.equal(problem?.code, "call_cycle");
  assert.match(problem!.message, /A → B → C → A/);
});

test("a cycle between two other workflows does not loop the walk, and is not this save's to refuse", async () => {
  const load = world({ "wf-b": { name: "B", calls: ["wf-c"] }, "wf-c": { name: "C", calls: ["wf-b"] } });
  assert.equal(await callProblem({ workflowId: "wf-a", name: "A", graph: calling("wf-b"), load }), null);
});

test("a chain exactly as deep as the bound is allowed, and one deeper is refused", async () => {
  const chain = { "wf-1": { name: "One", calls: ["wf-2"] }, "wf-2": { name: "Two", calls: ["wf-3"] }, "wf-3": { name: "Three" } };
  assert.equal(MAX_CALL_DEPTH, 3);
  // A → One → Two → Three is three levels below A.
  assert.equal(await callProblem({ workflowId: "wf-a", name: "A", graph: calling("wf-1"), load: world(chain) }), null);

  const deeper = { ...chain, "wf-3": { name: "Three", calls: ["wf-4"] }, "wf-4": { name: "Four" } };
  const problem = await callProblem({ workflowId: "wf-a", name: "A", graph: calling("wf-1"), load: world(deeper) });
  assert.equal(problem?.code, "call_too_deep");
  assert.match(problem!.message, /3 levels deep/);
});

test("a callee the saver cannot see ends the walk there rather than failing the save", async () => {
  // The loader answers only what the caller may see; an absent workflow is the run-time check's.
  const problem = await callProblem({ workflowId: "wf-a", name: "A", graph: calling("wf-hidden"), load: world({}) });
  assert.equal(problem, null);
});

test("a graph that calls nothing never asks the database", async () => {
  let asked = 0;
  const problem = await callProblem({
    workflowId: "wf-a",
    name: "A",
    graph: quiet,
    load: async () => {
      asked += 1;
      return new Map();
    },
  });
  assert.equal(problem, null);
  assert.equal(asked, 0);
});

test("the database is asked once a level, not once a workflow", async () => {
  let asked = 0;
  const base = world({ "wf-1": { name: "One" }, "wf-2": { name: "Two" }, "wf-3": { name: "Three" } });
  await callProblem({
    workflowId: "wf-a",
    name: "A",
    graph: calling("wf-1", "wf-2", "wf-3"),
    load: async (ids) => {
      asked += 1;
      return base(ids);
    },
  });
  assert.equal(asked, 1);
});
