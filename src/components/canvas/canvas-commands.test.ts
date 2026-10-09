import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CANVAS_NODE_TYPE, type CanvasNode } from "@/lib/canvas/bridge";
import type { NodeSummary } from "@/lib/canvas/client";
import { rankCommands } from "@/lib/ui/command";

import { buildCanvasCommands } from "./canvas-commands";

const node = (id: string, nodeType: string, label?: string): CanvasNode => ({
  id,
  type: CANVAS_NODE_TYPE,
  position: { x: 0, y: 0 },
  data: { nodeType, config: {}, ...(label === undefined ? {} : { label }) },
});

/** Only the fields the builder reads; the rest of a summary is irrelevant here. */
const summary = (type: string, label: string, category: string) =>
  ({ type, label, category }) as unknown as NodeSummary;

const registry = new Map<string, NodeSummary>([
  ["integration.gmail", summary("integration.gmail", "Send email", "integration")],
  ["ai.agent", summary("ai.agent", "AI Agent", "agent")],
]);

const nodes = [node("gmail", "integration.gmail", "Send the summary"), node("agent_2", "ai.agent")];

function build(options: { editable: boolean; comparing: boolean; copilot?: boolean }, found: string[] = []) {
  return buildCanvasCommands({
    nodes,
    registry,
    platform: "apple",
    editable: options.editable,
    comparing: options.comparing,
    actions: {
      undo: () => {},
      redo: () => {},
      arrange: () => {},
      fit: () => {},
      selectAll: () => {},
      shortcuts: () => {},
      find: (id) => found.push(id),
      addNote: () => {},
      ...(options.copilot ? { copilot: () => {} } : {}),
    },
  });
}

const ids = (commands: { id: string }[]) => commands.map((command) => command.id);

describe("the canvas's commands in ⌘K", () => {
  it("offers an editor undo, redo, arrange, a note, fit, select-all, the shortcuts, then every node", () => {
    assert.deepEqual(ids(build({ editable: true, comparing: false })), [
      "canvas:undo",
      "canvas:redo",
      "canvas:arrange",
      "canvas:add-note",
      "canvas:fit",
      "canvas:select-all",
      "canvas:shortcuts",
      "node:gmail",
      "node:agent_2",
    ]);
  });

  it("offers the copilot after the editing actions when the editor provides it — and in a proposal's diff mode", () => {
    assert.deepEqual(ids(build({ editable: true, comparing: false, copilot: true })).slice(3, 6), [
      "canvas:add-note",
      "canvas:copilot",
      "canvas:fit",
    ]);
    assert.deepEqual(ids(build({ editable: false, comparing: true, copilot: true })), [
      "canvas:copilot",
      "canvas:fit",
      "canvas:shortcuts",
    ]);
  });

  it("offers a viewer nothing that writes, and still finds nodes", () => {
    assert.deepEqual(ids(build({ editable: false, comparing: false })), [
      "canvas:fit",
      "canvas:select-all",
      "canvas:shortcuts",
      "node:gmail",
      "node:agent_2",
    ]);
  });

  it("finds no nodes in diff mode, where nothing on screen is the editing graph", () => {
    assert.deepEqual(ids(build({ editable: false, comparing: true })), ["canvas:fit", "canvas:shortcuts"]);
  });

  it("prints each action's own shortcut", () => {
    const hints = Object.fromEntries(
      build({ editable: true, comparing: false }).map((command) => [command.id, command.hint]),
    );
    assert.equal(hints["canvas:undo"], "⌘Z");
    assert.equal(hints["canvas:redo"], "⇧⌘Z");
    assert.equal(hints["canvas:fit"], "F");
    assert.equal(hints["canvas:shortcuts"], "?");
  });

  it("finds a node by its label, its type or its id, and running it selects that node", () => {
    const found: string[] = [];
    const commands = build({ editable: true, comparing: false }, found);

    for (const query of ["send the", "gmail", "agent_2", "ai.agent"]) {
      const top = rankCommands(commands, query)[0];
      assert.ok(top?.id.startsWith("node:"), `${query} → ${top?.id}`);
      void top.run();
    }
    assert.deepEqual(found, ["gmail", "gmail", "agent_2", "agent_2"]);
  });

  it("names a node without a label by its registry label, and says what kind it is", () => {
    const agent = build({ editable: true, comparing: false }).find((command) => command.id === "node:agent_2")!;
    assert.equal(agent.title, "AI Agent");
    assert.match(agent.subtitle ?? "", /ai\.agent/);
  });
});
