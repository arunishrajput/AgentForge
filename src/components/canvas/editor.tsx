"use client";

import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import "@xyflow/react/dist/style.css";

import {
  CANVAS_NODE_TYPE,
  fromFlow,
  graphsEqual,
  nextEdgeId,
  nextNodeId,
  toFlow,
  type CanvasEdge,
  type CanvasNode,
} from "@/lib/canvas/bridge";
import {
  ApiRequestError,
  api,
  type NodeSummary,
  type Run,
  type Workflow,
} from "@/lib/canvas/client";
import { useRunStream } from "@/lib/canvas/run-stream";
import { defaultConfig } from "@/lib/canvas/schema";

import { CanvasContext, type NodeRunState } from "./context";
import { Inspector } from "./inspector";
import { Palette } from "./palette";
import { WorkflowNodeView } from "./workflow-node";

/**
 * The workflow editor.
 *
 * The server component hands it the workflow as already read from the database, so
 * a reload renders the saved graph directly — which is what makes "build it, hard
 * reload, it comes back identical" a real check rather than a cache artefact.
 * Everything after that goes through the Phase 3 API.
 *
 * `ReactFlowProvider` wraps the inner component because the canvas needs the flow
 * instance to place a new node at the centre of the current viewport.
 */
export function Editor({
  workflow,
  registry: palette,
  liveRun = null,
}: {
  workflow: Workflow;
  registry: NodeSummary[];
  /** A run of this workflow still in flight when the page was rendered. */
  liveRun?: Run | null;
}) {
  return (
    <ReactFlowProvider>
      <EditorInner workflow={workflow} palette={palette} liveRun={liveRun} />
    </ReactFlowProvider>
  );
}

// Defined once at module scope: React Flow warns when `nodeTypes` is a new object
// on every render, and re-creates every node when it changes.
const nodeTypes = { [CANVAS_NODE_TYPE]: WorkflowNodeView };

function EditorInner({
  workflow,
  palette,
  liveRun,
}: {
  workflow: Workflow;
  palette: NodeSummary[];
  liveRun: Run | null;
}) {
  const initial = useMemo(() => toFlow(workflow.graph), [workflow.graph]);

  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<CanvasEdge>(initial.edges);

  const [name, setName] = useState(workflow.name);
  const [saved, setSaved] = useState<Workflow>(workflow);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { run, live, watch, stop, setRun } = useRunStream(workflow.id, liveRun);
  const [triggerInput, setTriggerInput] = useState("");
  const [busy, setBusy] = useState<null | "saving" | "running">(null);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(
    null,
  );

  const { fitView, screenToFlowPosition } = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);

  // The palette is the registry, delivered with the first render so every node
  // draws its real output handles immediately (see the page component).
  const registry = useMemo(
    () => new Map(palette.map((node) => [node.type, node])),
    [palette],
  );

  /** Per-node outcome of the last run. A looped node contributes several steps. */
  const runStates = useMemo(() => {
    const states = new Map<string, NodeRunState>();
    for (const step of run?.steps ?? []) {
      const existing = states.get(step.nodeId);
      states.set(step.nodeId, {
        status: step.status,
        executions: (existing?.executions ?? 0) + 1,
        branch: step.branch,
        error: step.error,
      });
    }
    return states;
  }, [run]);

  // A page loaded mid-run reattaches to that run, so a reload during execution
  // keeps showing it live instead of going blank until it finishes.
  const attached = useRef(false);
  useEffect(() => {
    if (attached.current || !liveRun) return;
    attached.current = true;
    watch({ runId: liveRun.id });
  }, [liveRun, watch]);

  const graph = useMemo(() => fromFlow(nodes, edges), [nodes, edges]);
  const dirty = !graphsEqual(graph, saved.graph) || name !== saved.name;

  const selected = nodes.find((node) => node.id === selectedId) ?? null;

  const onSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    setSelectedId(params.nodes.length === 1 ? params.nodes[0].id : null);
  }, []);

  const onConnect = useCallback(
    (connection: Connection) => {
      // Our own id, rather than React Flow's generated one: edge ids are persisted
      // and `e1`/`e2` read far better in a graph a person or a model has to follow.
      setEdges((current) =>
        addEdge(
          {
            ...connection,
            id: nextEdgeId(current.map((edge) => edge.id)),
            sourceHandle: connection.sourceHandle ?? null,
          },
          current,
        ),
      );
    },
    [setEdges],
  );

  const addNode = useCallback(
    (definition: NodeSummary) => {
      const bounds = wrapper.current?.getBoundingClientRect();
      const viewportPosition = bounds
        ? screenToFlowPosition({ x: bounds.x + 140, y: bounds.y + bounds.height / 2 })
        : { x: 0, y: 0 };

      setNodes((current) => {
        const id = nextNodeId(
          current.map((node) => node.id),
          definition.type,
        );

        // New nodes land to the right of the rightmost one, so clicking through
        // the palette builds a readable left-to-right chain instead of a stack.
        // NODE_WIDTH 224 + a 56px gutter.
        const rightmost = current.reduce<CanvasNode | null>(
          (furthest, node) =>
            furthest === null || node.position.x > furthest.position.x ? node : furthest,
          null,
        );
        const position = rightmost
          ? { x: rightmost.position.x + 280, y: rightmost.position.y }
          : { x: Math.round(viewportPosition.x), y: Math.round(viewportPosition.y) };

        return [
          ...current.map((node) => ({ ...node, selected: false })),
          {
            id,
            type: CANVAS_NODE_TYPE,
            position,
            selected: true,
            data: { nodeType: definition.type, config: defaultConfig(definition.configSchema) },
          } satisfies CanvasNode,
        ];
      });

      // The chain grows rightwards, so without this the fourth node a user adds
      // lands outside the visible canvas and the click looks like it did nothing.
      // Deferred a frame so React Flow has measured the node it is fitting to.
      requestAnimationFrame(() =>
        fitView({ padding: 0.25, maxZoom: 1, duration: 250 }),
      );
    },
    [fitView, screenToFlowPosition, setNodes],
  );

  const changeNode = useCallback(
    (id: string, data: Partial<CanvasNode["data"]>) => {
      setNodes((current) =>
        current.map((node) =>
          node.id === id ? { ...node, data: { ...node.data, ...data } } : node,
        ),
      );
    },
    [setNodes],
  );

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((current) => current.filter((node) => node.id !== id));
      setEdges((current) =>
        current.filter((edge) => edge.source !== id && edge.target !== id),
      );
      setSelectedId(null);
    },
    [setEdges, setNodes],
  );

  const selectNode = useCallback(
    (id: string) => {
      setNodes((current) =>
        current.map((node) => ({ ...node, selected: node.id === id })),
      );
      setSelectedId(id);
    },
    [setNodes],
  );

  /** One PATCH carrying the whole graph — a single atomic row update (D14). */
  const save = useCallback(async (): Promise<Workflow | null> => {
    setBusy("saving");
    setMessage(null);
    try {
      const updated = await api.updateWorkflow(workflow.id, {
        name: name.trim() === "" ? saved.name : name.trim(),
        graph: fromFlow(nodes, edges),
      });
      setSaved(updated);
      setName(updated.name);
      return updated;
    } catch (error) {
      setMessage({
        tone: "error",
        text:
          error instanceof ApiRequestError ? error.message : "Could not save the workflow.",
      });
      return null;
    } finally {
      setBusy(null);
    }
  }, [edges, name, nodes, saved.name, workflow.id]);

  /**
   * Running always runs what is *stored*, so unsaved edits are saved first. The
   * alternative — running a graph the server has not seen — makes the run history
   * describe a workflow that never existed.
   */
  const start = useCallback(async () => {
    const current = dirty ? await save() : saved;
    if (!current) return;

    if (!current.runnable) {
      setMessage({
        tone: "error",
        text: "Saved, but this workflow cannot run yet. See the problems on the right.",
      });
      return;
    }

    let input: unknown = null;
    if (triggerInput.trim() !== "") {
      try {
        input = JSON.parse(triggerInput);
      } catch {
        setMessage({ tone: "error", text: "Trigger input is not valid JSON." });
        return;
      }
    }

    setBusy("running");
    setMessage(null);
    setSelectedId(null);
    setNodes((all) => all.map((node) => ({ ...node, selected: false })));
    // Clear the previous run first. The stream's first snapshot is a few hundred
    // milliseconds away, and leaving the old run on screen means pressing Run shows
    // a canvas full of green "Succeeded" badges for something that has not started.
    setRun(null);

    // The stream opens *before* the run is triggered. It has to: `POST /runs` is
    // synchronous and does not return until the run is over, so a client that waited
    // for a run id would have nothing left to watch. The stream works out which run
    // is the new one by itself (D28).
    watch();

    try {
      // Authoritative, and it also covers the case where the stream never connected.
      setRun(await api.runWorkflow(workflow.id, input));
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof ApiRequestError ? error.message : "The run could not start.",
      });
    } finally {
      // The run is over by the time the POST resolves, so the stream has nothing
      // left to say and Cloud Run should stop billing for it.
      stop();
      setBusy(null);
    }
  }, [dirty, save, saved, setNodes, setRun, stop, triggerInput, watch, workflow.id]);

  const canvasValue = useMemo(() => ({ registry, runStates }), [registry, runStates]);

  return (
    <CanvasContext value={canvasValue}>
      <div className="flex h-dvh flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-2.5">
          <Link
            href="/workflows"
            className="text-muted hover:text-ink shrink-0 text-sm transition-colors"
          >
            ← Workflows
          </Link>

          <input
            aria-label="Workflow name"
            value={name}
            maxLength={200}
            onChange={(event) => setName(event.target.value)}
            className="focus:border-accent/60 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-medium outline-none"
          />

          {message && (
            <span
              className={`truncate text-[12px] ${message.tone === "error" ? "text-red-300" : "text-muted"}`}
            >
              {message.text}
            </span>
          )}

          <span className="text-muted shrink-0 text-[12px]">
            {busy === "saving"
              ? "Saving…"
              : dirty
                ? "Unsaved changes"
                : saved.runnable
                  ? "Saved"
                  : `Saved · ${saved.problems.length} problem${saved.problems.length === 1 ? "" : "s"}`}
          </span>

          <button
            type="button"
            onClick={save}
            disabled={busy !== null || !dirty}
            className="hover:bg-surface shrink-0 rounded-lg border border-white/15 px-3 py-1.5 text-[13px] transition-colors disabled:opacity-40"
          >
            Save
          </button>

          <button
            type="button"
            onClick={start}
            disabled={busy !== null}
            className="bg-accent text-canvas shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy === "running" ? "Running…" : "Run"}
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <Palette nodes={palette} onAdd={addNode} disabled={busy !== null} />

          <div ref={wrapper} className="min-w-0 flex-1">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onSelectionChange={onSelectionChange}
              deleteKeyCode={["Delete", "Backspace"]}
              colorMode="dark"
              fitView
              fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
              proOptions={{ hideAttribution: false }}
            >
              <Background gap={20} />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable className="!bg-surface" />
            </ReactFlow>
          </div>

          <Inspector
            node={selected}
            definition={selected ? registry.get(selected.data.nodeType) : undefined}
            workflow={saved}
            dirty={dirty}
            problems={saved.problems}
            run={run}
            live={live}
            triggerInput={triggerInput}
            onChangeTriggerInput={setTriggerInput}
            onChangeNode={changeNode}
            onDeleteNode={deleteNode}
            onSelectNode={selectNode}
          />
        </div>
      </div>
    </CanvasContext>
  );
}
