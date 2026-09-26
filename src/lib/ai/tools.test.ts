import assert from "node:assert/strict";
import { test } from "node:test";

import { getNode, listNodes } from "@/lib/nodes";

import { agentToolSet, projectTool, toToolName } from "./tools";

test("tool names are the registry type with dots replaced", () => {
  assert.equal(toToolName("core.log"), "core_log");
  assert.equal(toToolName("integration.google.sheets"), "integration_google_sheets");
});

test("a tool's description is the node's own, verbatim", () => {
  const node = getNode("core.log")!;
  assert.equal(projectTool(node).description, node.description);
});

test("the tool set is exactly the agentCallable nodes", () => {
  const expected = listNodes()
    .filter((node) => node.agentCallable === true)
    .map((node) => toToolName(node.type))
    .sort();
  const actual = [...agentToolSet().byName.keys()].sort();
  assert.deepEqual(actual, expected);
});

test("a node that is not agentCallable cannot be reached, even by asking for it", () => {
  // The security boundary: `allow` narrows, it never widens.
  const notCallable = listNodes().filter((node) => node.agentCallable !== true);
  assert.ok(notCallable.length > 0, "every node is agent-callable — check D19");

  const set = agentToolSet({ allow: notCallable.map((node) => node.type) });
  assert.equal(set.specs.length, 0);
  assert.equal(set.byName.size, 0);
  assert.deepEqual(set.rejected.sort(), notCallable.map((node) => node.type).sort());
});

test("allow narrows to a subset", () => {
  const set = agentToolSet({ allow: ["core.log"] });
  assert.deepEqual([...set.byName.keys()], ["core_log"]);
  assert.deepEqual(set.rejected, []);
});

test("an empty allow list means the full callable set, not nothing", () => {
  assert.equal(agentToolSet({ allow: [] }).specs.length, agentToolSet().specs.length);
});

test("no agent tool is a trigger, a loop, or an agent", () => {
  // A trigger as a tool would start a second run; an agent as a tool would recurse.
  for (const node of agentToolSet().byName.values()) {
    assert.notEqual(node.kind, "trigger", `${node.type} is a trigger`);
    assert.notEqual(node.kind, "loop", `${node.type} is a loop`);
    assert.notEqual(node.category, "agent", `${node.type} is an agent`);
  }
});
