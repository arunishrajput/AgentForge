import { z } from "zod";

import { defineNode, NodeError } from "../types";

/**
 * **Calls another workflow and uses what it returns — Phase 39** (D185, `CONTRACT.md` →
 * *Calling a workflow*).
 *
 * The node only works out what to ask for. **The call itself goes through `context.workflows`**, the
 * engine's one door to another workflow, which applies everything that makes a call safe before a
 * single node of the callee runs: it must be in this workspace and visible to the workflow that is
 * calling (D101); it must not be one of the workflows already calling (a cycle, refused at save and
 * again here); the tree may not be more than three deep; and what it spends — steps, clock — comes
 * out of this run's own budget (D16 extended). This file holds none of that, so none of it can be
 * skipped by a node that forgets.
 *
 * The callee runs **inside this step**, as a run of its own that names this one — its own page, its
 * own steps, its own place in run history. It cannot pause: a delay over ten seconds or an approval
 * in a called workflow fails its step, saying why (D185 — a run waits for one thing at a time, and
 * the caller is already holding the attempt).
 *
 * **Not agent-callable.** An agent reaches a workflow through the workflow's own opt-in (D186), which
 * names it and describes its inputs; a generic "call any workflow by id" tool would hand a model every
 * workflow in the workspace.
 */
export const callWorkflowNode = defineNode({
  type: "core.call_workflow",
  label: "Call workflow",
  description:
    "Runs another workflow from this workspace and waits for it, then outputs what that workflow finished with. " +
    "Pass it data with Input; it defaults to what this step received. A called workflow cannot wait or ask a person.",
  kind: "action",
  category: "logic",
  outputs: [{ key: null, label: "Out" }],
  outputShape:
    "{ output: what the called workflow's last step produced, runId: the called run's id, workflowId, workflow: its name }.",
  agentCallable: false,
  // The called workflow may post, send or write, and which it does is not visible from here.
  effect: { does: "run another workflow, which may post or write" },
  configSchema: z.object({
    workflowId: z.string().trim().min(1).max(200),
    /** Left out, the call is handed what this step received. */
    input: z.unknown().optional(),
  }),
  docs: {
    summary:
      "Runs another workflow in this workspace as part of this one, waits for it to finish, and carries on with what it returned. " +
      "The other workflow starts at its own trigger, with Input as its payload; its run appears on its own page, linked to this one. " +
      "It cannot pause or ask a person, and workflows cannot call one another in a circle or more than three deep.",
    accepts: "anything — handed to the called workflow as its payload unless Input says otherwise",
    examples: [
      { title: "Use what it returned", body: "{{input.output.total}}" },
      { title: "Pass a mapped Input", body: '{ "email": "{{input.email}}", "plan": "pro" }' },
      { title: "Open the called run", body: "{{input.runId}}" },
    ],
  },
  async execute({ config, input, context }) {
    if (!context.workflows) {
      throw new NodeError("Nothing here can run another workflow.");
    }
    const given = config.input === undefined ? (input ?? null) : config.input;

    const called = await context.workflows.call({
      workflowId: config.workflowId,
      input: given,
      via: "node",
      signal: context.signal,
    });
    context.log(`Called “${called.workflowName}”: run ${called.runId} finished.`);

    return {
      output: {
        output: called.output,
        runId: called.runId,
        workflowId: called.workflowId,
        workflow: called.workflowName,
      },
    };
  },
});
