import assert from "node:assert/strict";
import { test } from "node:test";

import { agentToolSet } from "@/lib/ai/tools";
import { TEST_SCOPE } from "@/lib/engine/fixtures";
import type { AgentWorkflow, CalledWorkflow, LogLevel, NodeContext, WorkflowAccess } from "@/lib/nodes/types";
import { readToolArgs, toolSpec, toolWireName, type WorkflowAgentTool } from "@/lib/workflow/tool";

import { invokeTool, resolveWorkflowTools } from "./agent";

/**
 * **Workflows as agent tools — Phase 39, task 2** (D186). A workflow is a tool only when somebody
 * marked it callable by agents *and* an agent lists it by id; what the model sees is a name, a
 * description and an input shape; and the call is a run of its own. The database half — who may see
 * a workflow, the marking itself — is verified on the deployed service; here the agent node's side.
 */

const REFUND: WorkflowAgentTool = {
  name: "issue_refund",
  description: "Refunds a customer's order. Use only when the customer has asked for their money back.",
  fields: [
    { name: "order_id", type: "string", description: "The order to refund", required: true },
    { name: "amount", type: "number", description: "", required: false },
  ],
};

function contextWith(workflows: Partial<WorkflowAccess> | null) {
  const lines: Array<{ message: string; level: LogLevel }> = [];
  const calls: Array<{ workflowId: string; input: unknown; via: string }> = [];
  const access: WorkflowAccess | undefined = workflows
    ? {
        tools: workflows.tools ?? (async () => []),
        call:
          workflows.call ??
          (async (request): Promise<CalledWorkflow> => {
            calls.push({ workflowId: request.workflowId, input: request.input, via: request.via });
            return { runId: "child-1", workflowId: request.workflowId, workflowName: "Refund", output: { refunded: true } };
          }),
      }
    : undefined;
  const context: NodeContext = {
    runId: "run-1",
    workflowId: "wf-1",
    scope: TEST_SCOPE,
    nodeId: "agent_1",
    nodeType: "ai.agent",
    iteration: 0,
    log: (message, level = "info") => lines.push({ message, level }),
    signal: new AbortController().signal,
    workflows: access,
  };
  return { context, lines, calls };
}

/** What `engine/run.ts` hands the node for a marked workflow: the name, the spec and the argument check. */
const offered = (id: string, tool: WorkflowAgentTool): AgentWorkflow => ({
  id,
  name: toolWireName(tool),
  spec: toolSpec(tool),
  read: (args) => readToolArgs(tool, args),
});

const available = (...found: AgentWorkflow[]) => async (ids: string[]) => found.filter((entry) => ids.includes(entry.id));

test("a listed workflow that is marked callable becomes a tool the model can see, by its declared name and inputs", async () => {
  const { context } = contextWith({ tools: available(offered("wf-refund", REFUND)) });
  const { specs, byName } = await resolveWorkflowTools(["workflow:wf-refund", "core.log"], new Map(), context);

  assert.equal(specs.length, 1);
  assert.equal(specs[0]!.name, "workflow_issue_refund");
  assert.equal(specs[0]!.description, REFUND.description);
  assert.deepEqual(specs[0]!.parameters, {
    type: "object",
    properties: { order_id: { type: "string", description: "The order to refund" }, amount: { type: "number" } },
    required: ["order_id"],
  });
  assert.equal(byName.get("workflow_issue_refund")!.id, "wf-refund");
});

test("a registry type among the entries is not a workflow, and an agent listing none offers none", async () => {
  const { context } = contextWith({ tools: available(offered("wf-refund", REFUND)) });
  assert.deepEqual((await resolveWorkflowTools(["core.log"], new Map(), context)).specs, []);
  assert.deepEqual((await resolveWorkflowTools([], new Map(), context)).specs, []);
});

test("a workflow the agent lists but cannot use is named in the log and left out — the model never hears of it", async () => {
  const { context, lines } = contextWith({ tools: available() });
  const { specs } = await resolveWorkflowTools(["workflow:wf-gone"], new Map(), context);

  assert.deepEqual(specs, []);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.level, "warn");
  assert.match(lines[0]!.message, /wf-gone.*not available to agents/);
});

test("with nothing to run a workflow, they are ignored with a warning rather than failing the agent", async () => {
  const { context, lines } = contextWith(null);
  const { specs } = await resolveWorkflowTools(["workflow:wf-refund"], new Map(), context);
  assert.deepEqual(specs, []);
  assert.match(lines[0]!.message, /nothing here can run one/);
});

test("two workflows that would present the same name are not both offered", async () => {
  const twin = offered("wf-two", { ...REFUND });
  const { context, lines } = contextWith({ tools: available(offered("wf-refund", REFUND), twin) });
  const { specs, byName } = await resolveWorkflowTools(["workflow:wf-refund", "workflow:wf-two"], new Map(), context);

  assert.equal(specs.length, 1);
  assert.equal(byName.get("workflow_issue_refund")!.id, "wf-refund", "the first listed wins");
  assert.match(lines[0]!.message, /Two tools are called "workflow_issue_refund"/);
});

test("a tool call to a workflow starts a child run with the model's arguments as its payload", async () => {
  const { context, calls, lines } = contextWith({});
  const { byName } = await resolveWorkflowTools(["workflow:wf-refund"], new Map(), contextWith({ tools: available(offered("wf-refund", REFUND)) }).context);

  const output = await invokeTool(
    { id: "c1", name: "workflow_issue_refund", args: { order_id: "A-17", amount: 12.5 } },
    agentToolSet({ allow: [] }),
    context,
    byName,
  );

  assert.deepEqual(output, { refunded: true });
  assert.deepEqual(calls, [{ workflowId: "wf-refund", input: { order_id: "A-17", amount: 12.5 }, via: "agent" }]);
  assert.match(lines[0]!.message, /\[workflow_issue_refund\] ran “Refund” as run child-1/);
});

test("arguments the workflow did not declare, or got wrong, are handed back to the model and start nothing", async () => {
  const { context, calls } = contextWith({});
  const byName = new Map([["workflow_issue_refund", offered("wf-refund", REFUND)]]);
  const tools = agentToolSet({ allow: [] });

  await assert.rejects(
    () => invokeTool({ id: "c1", name: "workflow_issue_refund", args: { amount: 5 } }, tools, context, byName),
    /order_id/,
  );
  await assert.rejects(
    () => invokeTool({ id: "c2", name: "workflow_issue_refund", args: { order_id: "A", note: "hi" } }, tools, context, byName),
    /unknown input note/,
  );
  await assert.rejects(
    () => invokeTool({ id: "c3", name: "workflow_issue_refund", args: { order_id: 7 } }, tools, context, byName),
    /order_id/,
  );
  assert.deepEqual(calls, [], "no child run was started for any of them");
});

test("a called workflow that fails becomes a tool error the model reads, not a failure of the agent", async () => {
  const { context } = contextWith({
    call: async () => {
      throw new Error("“Refund” failed: Order not found. (run child-1)");
    },
  });
  const byName = new Map([["workflow_issue_refund", offered("wf-refund", REFUND)]]);
  await assert.rejects(
    () => invokeTool({ id: "c1", name: "workflow_issue_refund", args: { order_id: "A" } }, agentToolSet({ allow: [] }), context, byName),
    /Order not found/,
  );
});

test("a workflow tool cannot be reached by a name the agent did not resolve", async () => {
  const { context } = contextWith({});
  await assert.rejects(
    () => invokeTool({ id: "c1", name: "workflow_issue_refund", args: { order_id: "A" } }, agentToolSet({ allow: [] }), context),
    /No tool named "workflow_issue_refund"/,
  );
});
