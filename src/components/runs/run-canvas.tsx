"use client";

import { Background, Controls, MarkerType, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { useMemo } from "react";

import { CanvasContext, INERT_NOTES } from "@/components/canvas/context";
import { NoteView } from "@/components/canvas/note-node";
import { WorkflowNodeView } from "@/components/canvas/workflow-node";
import { useTheme } from "@/components/ui/theme";
import { CANVAS_NODE_TYPE, CANVAS_NOTE_TYPE, toFlow, type CanvasEdge, type CanvasNode, type CanvasNote } from "@/lib/canvas/bridge";
import type { NodeSummary } from "@/lib/canvas/client";
import { runStatesOf } from "@/lib/canvas/run-states";
import { edgeRunLook } from "@/lib/canvas/status";
import type { RunStatus, StepStatus } from "@/lib/engine/types";
import type { WorkflowGraph } from "@/lib/workflow/graph";

/**
 * **A run, drawn on the graph it executed — Phase 33.** The run page's picture: every node in the
 * state the run left it, and the path the run took lit through the edges it crossed.
 *
 * **Read-only by construction, as the share page's canvas is** (`share/shared-canvas.tsx`): it
 * imports no client, no store and no mutation, and every React Flow edit handler is absent rather
 * than disabled, so nothing here can move the graph away from the one the run executed. It reuses
 * how a node *looks* — `WorkflowNodeView`, `NoteView`, the edge treatment and `edgeRunLook` — so a
 * run reads the same here as on the editor's canvas.
 *
 * Clicking a node is the one interaction: it hands the node to the page, which opens that node's
 * step in the list below. The step list is the keyboard path to the same thing.
 */
const nodeTypes = { [CANVAS_NODE_TYPE]: WorkflowNodeView, [CANVAS_NOTE_TYPE]: NoteView };

const FIT = { padding: 0.18, maxZoom: 1 } as const;

const EDGE_MARKER = {
  type: MarkerType.ArrowClosed,
  width: 18,
  height: 18,
  color: "var(--color-ink)",
} as const;

export function RunCanvas({
  graph,
  registry,
  run,
  onSelectNode,
}: {
  graph: WorkflowGraph;
  registry: NodeSummary[];
  run: {
    status: RunStatus;
    steps: readonly { nodeId: string; status: StepStatus; branch: string | null; error: string | null }[];
  };
  onSelectNode: (nodeId: string) => void;
}) {
  const { theme } = useTheme();
  const flow = useMemo(() => toFlow(graph), [graph]);
  const flowNodes = useMemo(
    () => [...flow.notes, ...flow.nodes] as (CanvasNode | CanvasNote)[],
    [flow.notes, flow.nodes],
  );

  const runStates = useMemo(() => runStatesOf(run), [run]);
  const lookup = useMemo(() => new Map(registry.map((node) => [node.type, node])), [registry]);
  const entryOrder = useMemo(() => {
    const order = new Map<string, number>();
    [...flow.nodes]
      .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)
      .forEach((node, index) => order.set(node.id, index));
    return order;
  }, [flow.nodes]);

  const edges: CanvasEdge[] = useMemo(() => {
    const running = run.status === "running";
    return flow.edges.map((edge) => {
      const base = { ...edge, type: "smoothstep" as const, markerEnd: EDGE_MARKER };
      const look = edgeRunLook(runStates.get(edge.source)?.status, runStates.get(edge.target)?.status, running);
      if (look === "live") return { ...base, animated: true, className: "edge-live" };
      if (look === "traversed") return { ...base, className: "edge-traversed" };
      return base;
    });
  }, [flow.edges, run.status, runStates]);

  const value = useMemo(
    () => ({
      registry: lookup,
      runStates,
      diffStates: new Map(),
      entryOrder,
      noteDiffStates: new Map(),
      notes: INERT_NOTES,
    }),
    [lookup, runStates, entryOrder],
  );

  return (
    <CanvasContext value={value}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={flowNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={(_event, node) => {
            if (node.type === CANVAS_NODE_TYPE) onSelectNode(node.id);
          }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          deleteKeyCode={null}
          colorMode={theme}
          fitView
          minZoom={0.15}
          fitViewOptions={FIT}
          proOptions={{ hideAttribution: false }}
        >
          <Background gap={20} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
    </CanvasContext>
  );
}
