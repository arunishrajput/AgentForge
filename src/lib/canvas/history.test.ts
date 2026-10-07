import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GRAPH_VERSION,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowNote,
} from "@/lib/workflow/graph";

import {
  changeKey,
  COALESCE_MS,
  emptyHistory,
  gestureKey,
  HISTORY_LIMIT,
  record,
  redo,
  undo,
  type History,
} from "./history";

const node = (id: string, patch: Partial<WorkflowNode> = {}): WorkflowNode => ({
  id,
  type: "core.set",
  position: { x: 0, y: 0 },
  config: {},
  ...patch,
});

const graph = (...nodes: WorkflowNode[]): WorkflowGraph => ({
  version: GRAPH_VERSION,
  nodes,
  edges: [],
});

/** A graph distinguishable by one number, for the stack tests. */
const g = (n: number) => graph(node("a", { position: { x: n, y: 0 } }));

/** Records a sequence of edits g(0) → g(1) → … with the given keys, a second apart. */
function edits(keys: (string | null)[], start: History = emptyHistory()): History {
  return keys.reduce((history, key, index) => record(history, g(index), key, index * 10_000), start);
}

describe("undo and redo", () => {
  it("undo returns the graph from before the last edit, and redo the one after it", () => {
    const history = edits([null, null]); // g0 → g1 → g2, current g2

    const back = undo(history, g(2));
    assert.ok(back);
    assert.deepEqual(back.graph, g(1));

    const again = undo(back.history, back.graph);
    assert.ok(again);
    assert.deepEqual(again.graph, g(0));
    assert.equal(undo(again.history, again.graph), null, "nothing older than the load");

    const forward = redo(again.history, again.graph);
    assert.ok(forward);
    assert.deepEqual(forward.graph, g(1));
    const forwardAgain = redo(forward.history, forward.graph);
    assert.ok(forwardAgain);
    assert.deepEqual(forwardAgain.graph, g(2));
    assert.equal(redo(forwardAgain.history, forwardAgain.graph), null);
  });

  it("twenty mixed edits undo to the start and redo back to the end, exactly", () => {
    const keys = Array.from({ length: 20 }, (_, i) => (i % 3 === 0 ? null : `config:a:k${i}`));
    let history = edits(keys);
    let current = g(20);

    for (let step = 0; step < 20; step += 1) {
      const result = undo(history, current);
      assert.ok(result, `undo ${step + 1} of 20`);
      ({ history, graph: current } = result);
    }
    assert.deepEqual(current, g(0));

    for (let step = 0; step < 20; step += 1) {
      const result = redo(history, current);
      assert.ok(result, `redo ${step + 1} of 20`);
      ({ history, graph: current } = result);
    }
    assert.deepEqual(current, g(20));
  });

  it("a new edit discards what was undone", () => {
    const history = edits([null, null]);
    const back = undo(history, g(2));
    assert.ok(back);

    const edited = record(back.history, back.graph, null, 99_000);
    assert.equal(edited.future.length, 0);
    assert.equal(redo(edited, g(9)), null);
  });

  it(`keeps the newest ${HISTORY_LIMIT} entries and drops the oldest`, () => {
    const history = edits(Array.from({ length: HISTORY_LIMIT + 5 }, () => null));
    assert.equal(history.past.length, HISTORY_LIMIT);
    assert.deepEqual(history.past[0], g(5));
  });

  it("redo is bounded too", () => {
    let history = edits(Array.from({ length: HISTORY_LIMIT }, () => null));
    let current = g(HISTORY_LIMIT);
    const result = undo(history, current);
    assert.ok(result);
    ({ history, graph: current } = result);
    const forward = redo(history, current);
    assert.ok(forward);
    assert.equal(forward.history.past.length, HISTORY_LIMIT);
  });
});

describe("coalescing", () => {
  it("folds a keyed run into one entry that keeps the graph from before it", () => {
    let history = emptyHistory();
    history = record(history, g(0), "config:a:subject", 0);
    history = record(history, g(1), "config:a:subject", 200);
    history = record(history, g(2), "config:a:subject", 400);

    assert.equal(history.past.length, 1);
    const back = undo(history, g(3));
    assert.ok(back);
    assert.deepEqual(back.graph, g(0), "one undo rewinds the whole run of typing");
  });

  it("starts a new entry when the key changes — one entry per field", () => {
    let history = emptyHistory();
    history = record(history, g(0), "config:a:subject", 0);
    history = record(history, g(1), "config:a:body", 100);
    history = record(history, g(2), "config:a:subject", 200);
    assert.equal(history.past.length, 3);
  });

  it("never folds an unkeyed change, even into another unkeyed one", () => {
    let history = emptyHistory();
    history = record(history, g(0), null, 0);
    history = record(history, g(1), null, 1);
    assert.equal(history.past.length, 2);
  });

  it(`breaks a keyed run after ${COALESCE_MS} ms of quiet`, () => {
    let history = emptyHistory();
    history = record(history, g(0), "label:a", 0);
    history = record(history, g(1), "label:a", COALESCE_MS);
    assert.equal(history.past.length, 1, "at the window it still folds");
    history = record(history, g(2), "label:a", 2 * COALESCE_MS + 1);
    assert.equal(history.past.length, 2, "past it, a new entry");
  });

  it("measures the quiet from the latest keystroke, not the first", () => {
    let history = emptyHistory();
    for (let i = 0; i < 10; i += 1) history = record(history, g(i), "label:a", i * 1000);
    assert.equal(history.past.length, 1, "ten seconds of steady typing is one step");
  });

  it("folds a whole drag into one entry however long it pauses", () => {
    let history = emptyHistory();
    history = record(history, g(0), gestureKey(1), 0);
    history = record(history, g(1), gestureKey(1), 60_000);
    assert.equal(history.past.length, 1);
  });

  it("keeps two drags apart, even of the same node", () => {
    let history = emptyHistory();
    history = record(history, g(0), gestureKey(1), 0);
    history = record(history, g(1), gestureKey(2), 10);
    assert.equal(history.past.length, 2);
  });

  it("does not fold the first edit after an undo into the entry it just popped", () => {
    let history = emptyHistory();
    history = record(history, g(0), "label:a", 0);
    history = record(history, g(1), "label:a", 100);
    const back = undo(history, g(2));
    assert.ok(back);

    const typed = record(back.history, back.graph, "label:a", 200);
    assert.equal(typed.past.length, 1);
    const again = undo(typed, g(5));
    assert.ok(again);
    assert.deepEqual(again.graph, g(0), "the new typing undoes to where the undo left it");
  });
});

describe("changeKey — what an unlabelled change looks like from the graph", () => {
  const base = graph(
    node("a", { label: "First", config: { subject: "hi", body: "x" } }),
    node("b", { position: { x: 300, y: 0 } }),
  );
  const edit = (id: string, patch: Partial<WorkflowNode>): WorkflowGraph => ({
    ...base,
    nodes: base.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
  });

  it("names one field of one node's configuration", () => {
    const after = edit("a", { config: { subject: "hello", body: "x" } });
    assert.equal(changeKey(base, after), "config:a:subject");
  });

  it("names a field that was added or removed", () => {
    assert.equal(changeKey(base, edit("a", { config: { subject: "hi" } })), "config:a:body");
    assert.equal(
      changeKey(base, edit("a", { config: { subject: "hi", body: "x", to: "y" } })),
      "config:a:to",
    );
  });

  it("names a label and a policy", () => {
    assert.equal(changeKey(base, edit("a", { label: "Renamed" })), "label:a");
    assert.equal(changeKey(base, edit("a", { label: undefined })), "label:a");
    assert.equal(
      changeKey(base, edit("b", { policy: { retries: 2, backoffMs: 500 } })),
      "policy:b",
    );
  });

  it("names a move by the set of nodes moved, in a stable order", () => {
    const after: WorkflowGraph = {
      ...base,
      nodes: base.nodes.map((n) => ({ ...n, position: { x: n.position.x + 5, y: 0 } })),
    };
    assert.equal(changeKey(base, after), "move:a,b");
    assert.equal(changeKey(base, edit("b", { position: { x: 305, y: 0 } })), "move:b");
  });

  it("refuses to name anything that adds, removes, reconnects or touches two things", () => {
    assert.equal(changeKey(base, graph(base.nodes[0])), null, "a removal");
    assert.equal(changeKey(base, graph(...base.nodes, node("c"))), null, "an addition");
    assert.equal(
      changeKey(base, { ...base, edges: [{ id: "e1", source: "a", target: "b", sourceHandle: null }] }),
      null,
      "a connection",
    );
    assert.equal(
      changeKey(base, edit("a", { label: "x", config: { subject: "y", body: "x" } })),
      null,
      "two edits at once",
    );
    assert.equal(
      changeKey(base, edit("a", { config: { subject: "y", body: "z" } })),
      null,
      "two fields at once",
    );
    assert.equal(
      changeKey(base, edit("a", { label: "x", position: { x: 9, y: 9 } })),
      null,
      "an edit and a move",
    );
    assert.equal(
      changeKey(base, { ...base, nodes: base.nodes.toReversed() }),
      null,
      "a reorder",
    );
  });

  it("is null for no change at all", () => {
    assert.equal(changeKey(base, base), null);
  });
});

describe("changeKey — notes and the off switch (Phase 30)", () => {
  const sticky = (id: string, patch: Partial<WorkflowNote> = {}): WorkflowNote => ({
    id,
    position: { x: 0, y: -200 },
    size: { width: 240, height: 140 },
    text: "Hello",
    tone: "yellow",
    ...patch,
  });
  const base: WorkflowGraph = { ...graph(node("a")), notes: [sticky("note_1"), sticky("note_2")] };
  const withNote = (id: string, patch: Partial<WorkflowNote>): WorkflowGraph => ({
    ...base,
    notes: base.notes!.map((n) => (n.id === id ? { ...n, ...patch } : n)),
  });

  it("names typing in one note, so a sentence is one step of undo", () => {
    assert.equal(changeKey(base, withNote("note_1", { text: "Hello, world" })), "note:note_1");
    // And it folds: two keystrokes a moment apart are the same entry.
    let history = record(emptyHistory(), base, changeKey(base, withNote("note_1", { text: "Hello," })), 0);
    history = record(history, withNote("note_1", { text: "Hello," }), "note:note_1", 400);
    assert.equal(history.past.length, 1);
  });

  it("names a note nudged with the arrow keys as a move, together with any nodes", () => {
    const moved: WorkflowGraph = {
      ...withNote("note_2", { position: { x: 20, y: -200 } }),
      nodes: [node("a", { position: { x: 20, y: 0 } })],
    };
    assert.equal(changeKey(base, moved), "move:a,note_2");
  });

  it("makes a tone, a size, an added or a removed note a step of its own", () => {
    assert.equal(changeKey(base, withNote("note_1", { tone: "pink" })), null, "a tone");
    assert.equal(changeKey(base, withNote("note_1", { size: { width: 300, height: 140 } })), null, "a size");
    assert.equal(changeKey(base, { ...base, notes: [sticky("note_1")] }), null, "a removal");
    assert.equal(changeKey(graph(node("a")), { ...graph(node("a")), notes: [sticky("note_1")] }), null, "the first note");
  });

  it("makes switching a node off or on a step of its own, every time", () => {
    const off: WorkflowGraph = { ...base, nodes: [node("a", { disabled: true })] };
    assert.equal(changeKey(base, off), null);
    assert.equal(changeKey(off, base), null);
  });
});
