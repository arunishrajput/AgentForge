import { getNode } from "@/lib/nodes";
import type { WorkflowGraph } from "@/lib/workflow/graph";

/**
 * Structural checks a graph must pass before it can run. Kept separate from
 * execution so the canvas (Phase 4) and the generator (Phase 7) can reject a bad
 * graph at save time with the same rules the engine applies at run time.
 */
export interface GraphProblem {
  code:
    | "no_trigger"
    | "multiple_triggers"
    | "unknown_node_type"
    | "duplicate_node_id"
    | "dangling_edge"
    | "edge_into_trigger"
    | "unknown_output_handle"
    | "illegal_cycle"
    | "invalid_config";
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface ValidationResult {
  valid: boolean;
  problems: GraphProblem[];
  triggerNodeId: string | null;
}

/**
 * A cycle is legal only when it runs through a loop node. Removing every edge
 * leaving a loop node's `loop` output breaks exactly those cycles, so anything
 * still cyclic afterwards is one the engine could not terminate.
 */
function findIllegalCycle(graph: WorkflowGraph): string[] | null {
  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) adjacency.set(node.id, []);

  for (const edge of graph.edges) {
    const source = graph.nodes.find((node) => node.id === edge.source);
    const definition = source ? getNode(source.type) : undefined;
    const isLoopBodyEdge =
      definition?.kind === "loop" && (edge.sourceHandle ?? null) === "loop";
    if (isLoopBodyEdge) continue;
    adjacency.get(edge.source)?.push(edge.target);
  }

  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];

  const walk = (nodeId: string): string[] | null => {
    state.set(nodeId, "visiting");
    stack.push(nodeId);

    for (const next of adjacency.get(nodeId) ?? []) {
      if (state.get(next) === "visiting") return [...stack.slice(stack.indexOf(next)), next];
      if (!state.has(next)) {
        const cycle = walk(next);
        if (cycle) return cycle;
      }
    }

    stack.pop();
    state.set(nodeId, "done");
    return null;
  };

  for (const node of graph.nodes) {
    if (state.has(node.id)) continue;
    const cycle = walk(node.id);
    if (cycle) return cycle;
  }

  return null;
}

export function validateGraph(graph: WorkflowGraph): ValidationResult {
  const problems: GraphProblem[] = [];
  const seen = new Set<string>();

  for (const node of graph.nodes) {
    if (seen.has(node.id)) {
      problems.push({
        code: "duplicate_node_id",
        message: `Two nodes share the id "${node.id}".`,
        nodeId: node.id,
      });
    }
    seen.add(node.id);

    const definition = getNode(node.type);
    if (!definition) {
      problems.push({
        code: "unknown_node_type",
        message: `Node "${node.id}" has unknown type "${node.type}".`,
        nodeId: node.id,
      });
      continue;
    }

    // Config is validated with templates still in it, so a field that will hold a
    // number at run time may be a "{{...}}" string now. Only non-template values
    // are checked here; the engine re-parses after resolution.
    const hasTemplate = JSON.stringify(node.config ?? {}).includes("{{");
    if (!hasTemplate) {
      const parsed = definition.configSchema.safeParse(node.config ?? {});
      if (!parsed.success) {
        problems.push({
          code: "invalid_config",
          message: `Node "${node.id}" has invalid config: ${parsed.error.issues
            .map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`)
            .join("; ")}`,
          nodeId: node.id,
        });
      }
    }
  }

  const triggers = graph.nodes.filter((node) => getNode(node.type)?.kind === "trigger");
  if (triggers.length === 0) {
    problems.push({ code: "no_trigger", message: "The workflow has no trigger node." });
  } else if (triggers.length > 1) {
    problems.push({
      code: "multiple_triggers",
      message: `The workflow has ${triggers.length} trigger nodes; exactly one is allowed.`,
    });
  }

  for (const edge of graph.edges) {
    const source = graph.nodes.find((node) => node.id === edge.source);
    const target = graph.nodes.find((node) => node.id === edge.target);

    if (!source || !target) {
      problems.push({
        code: "dangling_edge",
        message: `Edge "${edge.id}" refers to a node that does not exist.`,
        edgeId: edge.id,
      });
      continue;
    }

    if (getNode(target.type)?.kind === "trigger") {
      problems.push({
        code: "edge_into_trigger",
        message: `Edge "${edge.id}" points into trigger node "${target.id}". A trigger starts the run and cannot be a target.`,
        edgeId: edge.id,
      });
    }

    const definition = getNode(source.type);
    if (definition) {
      const handle = edge.sourceHandle ?? null;
      if (!definition.outputs.some((output) => output.key === handle)) {
        problems.push({
          code: "unknown_output_handle",
          message: `Edge "${edge.id}" leaves node "${source.id}" through output "${handle ?? "default"}", which "${definition.type}" does not have.`,
          edgeId: edge.id,
        });
      }
    }
  }

  const cycle = findIllegalCycle(graph);
  if (cycle) {
    problems.push({
      code: "illegal_cycle",
      message: `The workflow contains a cycle that is not a loop: ${cycle.join(" → ")}. Only a Loop node may close a cycle.`,
    });
  }

  return {
    valid: problems.length === 0,
    problems,
    triggerNodeId: triggers.length === 1 ? triggers[0].id : null,
  };
}
