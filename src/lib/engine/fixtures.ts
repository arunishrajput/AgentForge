import { GRAPH_VERSION, type WorkflowGraph } from "@/lib/workflow/graph";
import type { WorkspaceScope } from "@/lib/workspace/scope";

/**
 * Graph builders shared by the critical-path tests. Kept out of the test files so
 * the same shapes can seed a demo workflow later without being redefined.
 */
let counter = 0;
const at = () => ({ x: (counter++ % 5) * 220, y: Math.floor(counter / 5) * 140 });

export function graph(
  nodes: Array<{ id: string; type: string; config?: Record<string, unknown> }>,
  edges: Array<{ source: string; target: string; sourceHandle?: string | null }>,
): WorkflowGraph {
  return {
    version: GRAPH_VERSION,
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: at(),
      config: node.config ?? {},
    })),
    edges: edges.map((edge, index) => ({
      id: `e${index}`,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? null,
    })),
  };
}

/** trigger → set → log. The simplest thing that proves output threading works. */
export const sequentialGraph = (): WorkflowGraph =>
  graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      {
        id: "shape",
        type: "core.set",
        config: { fields: { greeting: "hello {{input.name}}", count: 2 } },
      },
      { id: "say", type: "core.log", config: { message: "{{input.greeting}}" } },
    ],
    [
      { source: "trigger", target: "shape" },
      { source: "shape", target: "say" },
    ],
  );

/** trigger → branch → one of two logs. Proves routing and skip recording. */
export const branchGraph = (): WorkflowGraph =>
  graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      {
        id: "check",
        type: "core.branch",
        config: { left: "{{input.status}}", operator: "equals", right: "ok" },
      },
      { id: "happy", type: "core.log", config: { message: "status was ok" } },
      { id: "sad", type: "core.log", config: { message: "status was not ok" } },
    ],
    [
      { source: "trigger", target: "check" },
      { source: "check", target: "happy", sourceHandle: "true" },
      { source: "check", target: "sad", sourceHandle: "false" },
    ],
  );

/** trigger → loop ⇄ body, then done. Proves the loop terminates and closes a legal cycle. */
export const loopGraph = (maxIterations = 3): WorkflowGraph =>
  graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "each", type: "core.loop", config: { maxIterations } },
      { id: "body", type: "core.log", config: { message: "iteration {{input.index}}" } },
      { id: "after", type: "core.log", config: { message: "loop finished" } },
    ],
    [
      { source: "trigger", target: "each" },
      { source: "each", target: "body", sourceHandle: "loop" },
      { source: "body", target: "each" },
      { source: "each", target: "after", sourceHandle: "done" },
    ],
  );

/** trigger → assert that always fails. Proves failure is recorded with its message. */
export const failingGraph = (): WorkflowGraph =>
  graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      {
        id: "guard",
        type: "core.assert",
        config: {
          left: "{{input.missing}}",
          operator: "is_not_empty",
          message: "Expected a value and found none.",
        },
      },
      { id: "never", type: "core.log", config: { message: "unreachable" } },
    ],
    [
      { source: "trigger", target: "guard" },
      { source: "guard", target: "never" },
    ],
  );

/**
 * A workspace scope for tests — Phase 19A.
 *
 * Every test that builds a `NodeContext` or calls `executeWorkflow` needs one, and a
 * shared constant means a test asserting cross-workspace behaviour has to say so
 * explicitly by building a different one, rather than happening to differ.
 */
export const TEST_SCOPE = {
  workspaceId: "ws-1",
  userId: "owner-1",
  role: "owner",
} as const satisfies WorkspaceScope;

/** A second workspace, for the isolation tests. Same user is deliberately not a member. */
export const OTHER_SCOPE = {
  workspaceId: "ws-2",
  userId: "owner-2",
  role: "owner",
} as const satisfies WorkspaceScope;
