"use client";

import { Background, Controls, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import { useMemo } from "react";

import { CanvasContext } from "@/components/canvas/context";
import { WorkflowNodeView } from "@/components/canvas/workflow-node";
import { useTheme } from "@/components/ui/theme";
import { CANVAS_NODE_TYPE, toFlow, type CanvasEdge } from "@/lib/canvas/bridge";
import type { NodeSummary, SharedWorkflow } from "@/lib/canvas/client";
import { GRAPH_VERSION } from "@/lib/workflow/graph";

/**
 * The canvas on a public share page — **Phase 20**.
 *
 * **A separate component rather than `Editor` with a `readOnly` flag, and that is the
 * security argument for the whole page.** The editor is eleven hundred lines that exist to
 * mutate a workflow: it holds a save function, a run function, the API client, the SSE
 * stream and the palette. Handing it a flag would mean the thing standing between an
 * anonymous visitor and `api.updateWorkflow` was a boolean. This file cannot save anything
 * because it has no code that could — it imports no client, no store and no mutation.
 *
 * What it does reuse is everything about how a node *looks*: `WorkflowNodeView`, the
 * registry summaries and the same edge treatment. A shared workflow that were drawn in a
 * second, plainer style would be a worse page and a second thing to keep in step.
 *
 * The context defaults cover run status and diff state — there is neither here — so only
 * `registry` and `entryOrder` are supplied.
 */
const nodeTypes = { [CANVAS_NODE_TYPE]: WorkflowNodeView };

const FIT = { padding: 0.18, maxZoom: 1 } as const;

const EDGE_MARKER = {
  type: MarkerType.ArrowClosed,
  width: 18,
  height: 18,
  color: "var(--color-ink)",
} as const;

export function SharedCanvas({
  graph,
  registry,
}: {
  graph: SharedWorkflow["graph"];
  registry: NodeSummary[];
}) {
  const { theme } = useTheme();

  /**
   * The redacted graph mapped onto the canvas through the **same** `toFlow` the editor
   * uses, so a shared node is positioned and handled identically to an edited one.
   *
   * `config` is the redacted object and nothing reads it here — `WorkflowNodeView` draws
   * from the registry entry for `data.nodeType`. It is carried anyway rather than dropped,
   * because `toFlow` is the one mapping and forking it for this page is how the two
   * eventually disagree about what a node is.
   */
  const flow = useMemo(
    () =>
      toFlow({
        version: GRAPH_VERSION,
        nodes: graph.nodes.map((node) => ({
          id: node.id,
          type: node.type,
          ...(node.label === undefined ? {} : { label: node.label }),
          position: node.position,
          config: node.config,
        })),
        edges: graph.edges,
      }),
    [graph],
  );

  const lookup = useMemo(() => new Map(registry.map((node) => [node.type, node])), [registry]);

  const entryOrder = useMemo(() => {
    const order = new Map<string, number>();
    [...flow.nodes]
      .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)
      .forEach((node, index) => order.set(node.id, index));
    return order;
  }, [flow.nodes]);

  const edges: CanvasEdge[] = useMemo(
    () => flow.edges.map((edge) => ({ ...edge, type: "smoothstep", markerEnd: EDGE_MARKER })),
    [flow.edges],
  );

  const value = useMemo(
    () => ({
      registry: lookup,
      runStates: new Map(),
      diffStates: new Map(),
      entryOrder,
    }),
    [lookup, entryOrder],
  );

  return (
    <CanvasContext value={value}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={flow.nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          // **Every handler is absent, not disabled.** React Flow reports edits through
          // `onNodesChange`; with no handler there is nothing for a drag to write to, so
          // the graph on screen cannot be moved away from the graph that was published.
          // Panning and zooming stay, because reading a graph of twenty nodes on a phone
          // needs them.
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          deleteKeyCode={null}
          // The reader's resolved theme, as on the editor's canvas.
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
