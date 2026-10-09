import type { WorkflowGraph } from "./graph";
import { workflowIdOf } from "./tool";

/**
 * **Which workflows a workflow calls — Phase 39** (D185), read off its graph.
 *
 * Two things in a graph name another workflow: a `core.call_workflow` node's `workflowId`, and an
 * `ai.agent` node whose `tools` lists `workflow:<id>`. Both are "calls" for the two bounds that
 * stop composition running away — a cycle, and a depth (`MAX_CALL_DEPTH`) — and both are checked
 * **twice**: here at save, over what the graph says, and at run time (`engine/run.ts`), over what
 * actually happened, because the save check cannot see a `{{ }}` reference, a workflow edited after
 * its caller was saved, or a tool call an agent decides to make.
 *
 * A switched-off node calls nothing, and a reference that is not a literal id (it holds `{{ }}`) is
 * unknowable here and ignored — the run-time check owns it.
 */

/** A parent may nest calls this deep: the root is depth 0, its callee 1, … and nothing past 3. */
export const MAX_CALL_DEPTH = 3;

export const CALL_NODE_TYPE = "core.call_workflow";
const AGENT_NODE_TYPE = "ai.agent";

export function calleesOf(graph: WorkflowGraph): string[] {
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (node.disabled) continue;
    const config = node.config ?? {};
    if (node.type === CALL_NODE_TYPE) {
      const id = (config as Record<string, unknown>).workflowId;
      if (typeof id === "string" && id.length > 0 && !id.includes("{{")) ids.add(id);
    } else if (node.type === AGENT_NODE_TYPE) {
      const tools = (config as Record<string, unknown>).tools;
      if (Array.isArray(tools)) {
        for (const entry of tools) {
          const id = typeof entry === "string" ? workflowIdOf(entry) : null;
          if (id) ids.add(id);
        }
      }
    }
  }
  return [...ids];
}

export interface CallProblem {
  code: "call_cycle" | "call_too_deep";
  message: string;
}

/** What the check needs to know about another workflow: its name for the message, its graph for the walk. */
export interface CalledWorkflow {
  name: string;
  graph: WorkflowGraph;
}

/**
 * Whether saving `graph` as workflow `workflowId` would make a cycle of calls or nest them too deeply.
 *
 * `load` answers the workflows that exist among the ids it is given — the caller applies the
 * workspace boundary and visibility, so a workflow it cannot see is simply absent, and an absent one
 * ends the walk there rather than failing it (a call to nothing is the run-time check's to refuse,
 * with a better message than a save can give).
 *
 * Breadth-first, a level at a time, so the database is asked at most `MAX_CALL_DEPTH + 1` times.
 */
export async function callProblem(options: {
  workflowId: string;
  name: string;
  graph: WorkflowGraph;
  load: (ids: string[]) => Promise<ReadonlyMap<string, CalledWorkflow>>;
}): Promise<CallProblem | null> {
  const { workflowId, name } = options;

  // Each frontier entry is a workflow reached and the path of names that reached it.
  let frontier = calleesOf(options.graph).map((id) => ({ id, path: [name] }));
  const visited = new Set<string>([workflowId]);

  for (let depth = 1; frontier.length > 0; depth += 1) {
    const closing = frontier.find((entry) => entry.id === workflowId);
    if (closing) {
      return {
        code: "call_cycle",
        message: `Saving this would make a workflow call itself: ${[...closing.path, name].join(" → ")}. A workflow cannot call one that calls it, however indirectly.`,
      };
    }
    if (depth > MAX_CALL_DEPTH) {
      const [first] = frontier;
      return {
        code: "call_too_deep",
        message: `Workflows can call each other ${MAX_CALL_DEPTH} levels deep and no further, and this would reach ${depth}: ${first.path.join(" → ")} → …. Flatten one of the calls.`,
      };
    }

    const fresh = frontier.filter((entry) => !visited.has(entry.id));
    for (const entry of fresh) visited.add(entry.id);
    const loaded = await options.load([...new Set(fresh.map((entry) => entry.id))]);

    const next: typeof frontier = [];
    for (const entry of fresh) {
      const called = loaded.get(entry.id);
      if (!called) continue;
      const path = [...entry.path, called.name];
      for (const id of calleesOf(called.graph)) next.push({ id, path });
    }
    frontier = next;
  }

  return null;
}
