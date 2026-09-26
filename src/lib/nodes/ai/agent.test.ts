import assert from "node:assert/strict";
import { test } from "node:test";

import { agentToolSet } from "@/lib/ai/tools";
import { getNode } from "@/lib/nodes";
import type { LogLevel, NodeContext } from "@/lib/nodes/types";

import {
  buildObjective,
  buildSystemPrompt,
  invokeTool,
  matchDecision,
  stripDecisionLine,
} from "./agent";
import { stripCodeFence } from "./llm";

function fakeContext(): NodeContext & { lines: Array<{ message: string; level: LogLevel }> } {
  const lines: Array<{ message: string; level: LogLevel }> = [];
  return {
    runId: "run-1",
    workflowId: "wf-1",
    ownerId: "owner-1",
    nodeId: "agent_1",
    iteration: 0,
    log: (message: string, level: LogLevel = "info") => lines.push({ message, level }),
    signal: new AbortController().signal,
    lines,
  };
}

test("a tool call runs the registry node and returns its output", async () => {
  const context = fakeContext();
  const output = await invokeTool(
    { id: "c1", name: "core_log", args: { message: "from the agent", level: "info" } },
    agentToolSet(),
    context,
  );

  assert.deepEqual(output, null);
  // The node's own log line, tagged with the tool that produced it.
  assert.deepEqual(context.lines, [{ message: "[core_log] from the agent", level: "info" }]);
});

test("a tool's output is passed back, not swallowed", async () => {
  const output = await invokeTool(
    { id: "c1", name: "core_set", args: { fields: { status: "urgent" } } },
    agentToolSet(),
    fakeContext(),
  );
  assert.deepEqual(output, { status: "urgent" });
});

test("a tool the model invented is refused, with the real list", async () => {
  await assert.rejects(
    () => invokeTool({ id: "c1", name: "shell_exec", args: {} }, agentToolSet(), fakeContext()),
    (error: unknown) => {
      assert.match(String(error), /No tool named "shell_exec"/);
      assert.match(String(error), /core_log/);
      return true;
    },
  );
});

test("a node that exists but is not agent-callable cannot be reached", async () => {
  // core.delay is a real registered node. It is not a tool.
  assert.ok(getNode("core.delay"), "core.delay is no longer registered");
  await assert.rejects(
    () => invokeTool({ id: "c1", name: "core_delay", args: { ms: 5 } }, agentToolSet(), fakeContext()),
    /No tool named "core_delay"/,
  );
});

test("bad arguments are rejected against the node's own schema", async () => {
  await assert.rejects(
    () =>
      invokeTool(
        { id: "c1", name: "core_log", args: { message: "x", level: "shout" } },
        agentToolSet(),
        fakeContext(),
      ),
    (error: unknown) => {
      assert.match(String(error), /Invalid arguments for core_log/);
      assert.match(String(error), /level/);
      return true;
    },
  );
});

test("a tool cannot be addressed as a workflow step", async () => {
  // The synthetic id keeps {{steps.agent_1}} from resolving to something a tool wrote.
  const context = fakeContext();
  let seenNodeId = "";
  const set = agentToolSet();
  const logNode = set.byName.get("core_log")!;
  const original = logNode.execute;
  set.byName.set("core_log", {
    ...logNode,
    execute: async (invocation) => {
      seenNodeId = invocation.context.nodeId;
      return original(invocation);
    },
  });

  await invokeTool({ id: "c1", name: "core_log", args: { message: "x" } }, set, context);
  assert.equal(seenNodeId, "agent_1:core_log");
});

test("the decision sentinel is read out of the answer", () => {
  const choices = ["urgent", "normal"];
  assert.equal(matchDecision("Looks bad.\n\nDECISION: urgent", choices), "urgent");
  assert.equal(matchDecision("DECISION: NORMAL", choices), "normal");
  assert.equal(matchDecision("DECISION: **urgent**", choices), "urgent");
});

test("a decision stated without the sentinel is still read", () => {
  // Refusing this would fail a run over formatting.
  assert.equal(matchDecision("This is clearly urgent and needs a human.", ["urgent", "normal"]), "urgent");
});

test("an ambiguous answer yields no decision rather than a guess", () => {
  assert.equal(matchDecision("Could be urgent, could be normal.", ["urgent", "normal"]), null);
  assert.equal(matchDecision("I am not sure.", ["urgent", "normal"]), null);
});

test("a decision outside the allowed set is not accepted", () => {
  assert.equal(matchDecision("DECISION: catastrophic", ["urgent", "normal"]), null);
});

test("the decision line is stripped out of the reason", () => {
  assert.equal(
    stripDecisionLine("Checkout is down for 40 minutes.\n\nDECISION: urgent"),
    "Checkout is down for 40 minutes.",
  );
  assert.equal(stripDecisionLine("No sentinel here."), "No sentinel here.");
});

test("the system prompt names the choices and the exact format asked for", () => {
  const prompt = buildSystemPrompt(undefined, ["urgent", "normal"]);
  assert.match(prompt, /urgent, normal/);
  assert.match(prompt, /DECISION: <one of urgent \| normal>/);
  // The reason is asked for explicitly, or the model answers with the sentinel alone
  // and output.reason comes back empty.
  assert.match(prompt, /one sentence saying why/);

  const noChoices = buildSystemPrompt("Be terse.", []);
  assert.match(noChoices, /Be terse\./);
  assert.equal(noChoices.includes("DECISION:"), false);
});

test("upstream data is handed to the agent as data, not pasted into the objective", () => {
  const objective = buildObjective("Classify this.", { message: "checkout is down" });
  assert.match(objective, /^Classify this\./);
  assert.match(objective, /Data from the previous step:/);
  assert.match(objective, /checkout is down/);
  assert.equal(buildObjective("Just this.", null), "Just this.");
});

test("a fenced JSON answer is unwrapped", () => {
  assert.equal(stripCodeFence('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(stripCodeFence('```\n{"a":1}\n```'), '{"a":1}');
  assert.equal(stripCodeFence('{"a":1}'), '{"a":1}');
});

test("the agent and llm nodes are registered and closed to the agent", () => {
  for (const type of ["ai.agent", "ai.llm"]) {
    const node = getNode(type);
    assert.ok(node, `${type} is not registered`);
    assert.equal(node.agentCallable ?? false, false, `${type} must not be agent-callable`);
    assert.equal(node.category, "agent");
  }
});
