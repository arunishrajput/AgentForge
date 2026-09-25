import assert from "node:assert/strict";
import { test } from "node:test";

import { graph, branchGraph, loopGraph, sequentialGraph } from "./fixtures";
import { validateGraph } from "./validate";

const codes = (candidate: Parameters<typeof validateGraph>[0]) =>
  validateGraph(candidate).problems.map((problem) => problem.code);

test("the seeded graphs are all valid", () => {
  for (const candidate of [sequentialGraph(), branchGraph(), loopGraph(2)]) {
    const result = validateGraph(candidate);
    assert.ok(result.valid, JSON.stringify(result.problems));
    assert.equal(result.triggerNodeId, "trigger");
  }
});

test("a cycle that does not pass through a loop node is rejected", () => {
  const cyclic = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "a", type: "core.log", config: { message: "a" } },
      { id: "b", type: "core.log", config: { message: "b" } },
    ],
    [
      { source: "trigger", target: "a" },
      { source: "a", target: "b" },
      { source: "b", target: "a" },
    ],
  );

  assert.ok(codes(cyclic).includes("illegal_cycle"));
});

test("a cycle closed by a loop node is allowed", () => {
  assert.ok(!codes(loopGraph(2)).includes("illegal_cycle"));
});

test("structural mistakes are each named", () => {
  assert.ok(codes(graph([{ id: "a", type: "core.log" }], [])).includes("no_trigger"));

  assert.ok(
    codes(
      graph(
        [
          { id: "t1", type: "core.manual_trigger" },
          { id: "t2", type: "core.manual_trigger" },
        ],
        [],
      ),
    ).includes("multiple_triggers"),
  );

  assert.ok(
    codes(
      graph([{ id: "trigger", type: "core.does_not_exist" }], []),
    ).includes("unknown_node_type"),
  );

  assert.ok(
    codes(
      graph(
        [{ id: "trigger", type: "core.manual_trigger" }],
        [{ source: "trigger", target: "ghost" }],
      ),
    ).includes("dangling_edge"),
  );

  assert.ok(
    codes(
      graph(
        [
          { id: "trigger", type: "core.manual_trigger" },
          { id: "note", type: "core.log", config: { message: "x" } },
        ],
        [
          { source: "trigger", target: "note" },
          { source: "note", target: "trigger" },
        ],
      ),
    ).includes("edge_into_trigger"),
  );

  assert.ok(
    codes(
      graph(
        [
          { id: "trigger", type: "core.manual_trigger" },
          { id: "note", type: "core.log", config: { message: "x" } },
        ],
        [{ source: "trigger", target: "note", sourceHandle: "nope" }],
      ),
    ).includes("unknown_output_handle"),
  );
});
