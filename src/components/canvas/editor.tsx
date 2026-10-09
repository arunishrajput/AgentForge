"use client";

import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type NodeChange,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { CommandPalette } from "@/components/shell/command-palette";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/field";
import { usePlatform } from "@/components/ui/kbd";
import { useTheme } from "@/components/ui/theme";
import { useToast } from "@/components/ui/toast";
import {
  CANVAS_NODE_TYPE,
  CANVAS_NOTE_TYPE,
  fromFlow,
  graphsEqual,
  NOTE_DEFAULT_SIZE,
  nextEdgeId,
  nextNodeId,
  nextNoteId,
  readOnlyChanges,
  restoreEdges,
  restoreNodes,
  restoreNotes,
  toFlow,
  toFlowEdge,
  toFlowNode,
  toFlowNote,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNote,
  type CanvasNoteData,
} from "@/lib/canvas/bridge";
import type { FlowRect } from "@/lib/canvas/clipboard";
import {
  ApiRequestError,
  api,
  type NodeSummary,
  type Run,
  type RunSummary,
  type Workflow,
} from "@/lib/canvas/client";
import { allInFrame, tweenMs } from "@/lib/canvas/motion";
import type { AfterFix } from "@/lib/canvas/after-fix";
import { COPILOT_PANEL, INSPECTOR_PANEL, controls, type RightPanel } from "@/lib/canvas/right-column";
import { runStatesOf } from "@/lib/canvas/run-states";
import { ASK_HANDLE } from "@/lib/approvals/rules";
import { edgeRunLook } from "@/lib/canvas/status";
import { testOutcome } from "@/lib/canvas/test-run";
import { honouredPin, planTest, type TestScope } from "@/lib/engine/partial";
import { ERROR_HANDLE, readPolicy } from "@/lib/engine/policy";
import { checkManualInput, manualTrigger } from "@/lib/nodes/core/manual-trigger";
import { adoptStarted, useRunStream } from "@/lib/canvas/run-stream";
import { isNewScheduledRun, withScheduleOf } from "@/lib/canvas/schedule-sync";
import { DEFAULT_NOTE_TONE, noteName } from "@/lib/canvas/notes";
import { defaultConfig } from "@/lib/canvas/schema";
import { formatDuration } from "@/lib/format/duration";
import { mergeRecent } from "@/lib/runs/recent";
import { layout } from "@/lib/generate/layout";
import { formatUtc } from "@/lib/triggers/cron";
import { ERROR_TRIGGER_TYPE } from "@/lib/triggers/failure";
import { replaceAddress } from "@/lib/ui/url";
import { diffGraph, type GraphDiff, type NodeDiff, type NoteDiff } from "@/lib/workflow/diff";
import {
  jsonBytes,
  PIN_MAX_BYTES,
  PINNED_TOTAL_MAX_BYTES,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowNote,
} from "@/lib/workflow/graph";
import { mayChangeVisibility } from "@/lib/workflow/visibility";
import { atLeast, type WorkspaceRole } from "@/lib/workspace/roles";

import { CanvasContext, type NoteControls } from "./context";
import { buildCanvasCommands } from "./canvas-commands";
import { COPILOT_COMPOSER, CopilotPanel } from "./copilot-panel";
import { DiffBar } from "./diff/diff-bar";
import { History } from "./diff/history";
import { EditControls } from "./edit-controls";
import { Inspector } from "./inspector";
import { NoteView } from "./note-node";
import { Palette } from "./palette";
import { useCollapsed } from "./panel";
import { ShareDialog } from "./share-dialog";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { TestConfirmDialog } from "./test-confirm-dialog";
import { useClipboard } from "./use-clipboard";
import { useCopilot } from "./use-copilot";
import { useHistory } from "./use-history";
import { useShortcuts } from "./use-shortcuts";
import { WorkflowNodeView } from "./workflow-node";

/**
 * The workflow editor.
 *
 * The server component hands it the workflow as already read from the database, so a
 * reload renders the saved graph directly — which is what makes "build it, hard
 * reload, it comes back identical" a real check rather than a cache artefact.
 * Everything after that goes through the Phase 3 API.
 *
 * `ReactFlowProvider` wraps the inner component because the canvas needs the flow
 * instance to place a new node and to refit when the layout changes.
 */
export function Editor({
  workflow,
  registry: palette,
  liveRun = null,
  recentRuns = [],
  role,
  viewerUserId,
  diagnoseRunId = null,
}: {
  workflow: Workflow;
  registry: NodeSummary[];
  /** A run of this workflow still in flight when the page was rendered. */
  liveRun?: Run | null;
  /** This workflow's newest runs, as summaries — Phase 33's *Recent runs*. */
  recentRuns?: RunSummary[];
  /**
   * **Phase 36.** A failed run to diagnose on arrival — `/runs/[id]`'s *Why did this fail?* opens
   * the canvas with `?diagnose=<run>` (D170), because the fix is a proposal and a proposal needs a
   * canvas to be accepted on.
   */
  diagnoseRunId?: string | null;
  /**
   * The viewer's role in this workflow's workspace — **Phase 20**.
   *
   * It decides what this component *draws*, and it decides nothing else. Every control
   * hidden below is separately refused by the API, which is the only place authorisation
   * actually happens (`lib/api.ts` → `requireScope`). The reason to hide them anyway is
   * that Phase 19B shipped the honest version of this — a viewer saw Save, pressed it,
   * and was told "this needs the editor role" — and an affordance that can only ever
   * fail is a worse experience than none, not a safer one.
   */
  role: WorkspaceRole;
  /** Who is looking, so the canvas knows whether they created this workflow. */
  viewerUserId: string;
}) {
  return (
    <ReactFlowProvider>
      <EditorInner
        workflow={workflow}
        palette={palette}
        liveRun={liveRun}
        recentRuns={recentRuns}
        role={role}
        viewerUserId={viewerUserId}
        diagnoseRunId={diagnoseRunId}
      />
    </ReactFlowProvider>
  );
}

// Defined once at module scope: React Flow warns when `nodeTypes` is a new object on
// every render, and re-creates every node when it changes.
const nodeTypes = { [CANVAS_NODE_TYPE]: WorkflowNodeView, [CANVAS_NOTE_TYPE]: NoteView };

/** Stable empty maps, so leaving diff mode does not hand the context a new object. */
const EMPTY_DIFF: Map<string, NodeDiff> = new Map();
const EMPTY_NOTE_DIFF: Map<string, NoteDiff> = new Map();
/** Nothing on the editor's canvas is withheld — that is the share page's (`shared-canvas.tsx`). */
const NOTHING_WITHHELD: ReadonlySet<string> = new Set();

/** A node's data with its off switch set — the key present only while it is off (D134). */
function switched(data: CanvasNode["data"], off: boolean): CanvasNode["data"] {
  const { disabled: _previous, ...rest } = data;
  return off ? { ...rest, disabled: true } : rest;
}

/**
 * 0.18, not React Flow's 0.3. Padding is the one term in the fitView fraction worth
 * spending: Chapter 1 measured 0.39 → 0.46 zoom at 1440px from this change alone.
 * The larger share of that problem is now solved by the collapsible panels — see
 * `panel.tsx` — but the padding still earns its keep.
 */
const FIT = { padding: 0.18, maxZoom: 1 } as const;

/** Matches `NODE_WIDTH` in `workflow-node.tsx`. Read by the diff view's minimap fix. */
const NODE_WIDTH = 224;

/**
 * Edges as *drawn*, never as stored.
 *
 * `smoothstep` rather than the default bezier: a right-angled path with a fat corner
 * radius is the shape this language draws everywhere else, and on a dense graph an
 * orthogonal route is easier to follow with the eye than two crossing curves.
 *
 * The arrowhead matters more than it looks. A workflow graph is *directed* — the
 * whole meaning is which way data moves — and Chapter 1 drew it with an undecorated
 * 1px line, so direction was carried by nothing but node position. On a graph with a
 * loop edge running right to left that is genuinely ambiguous.
 *
 * `--color-ink` resolves here because it is declared on `:root`, and React Flow only
 * ever puts this string in a `fill` attribute inside its shared `<defs>`.
 */
const EDGE_MARKER = {
  type: MarkerType.ArrowClosed,
  width: 18,
  height: 18,
  color: "var(--color-ink)",
} as const;

function EditorInner({
  workflow,
  palette,
  liveRun,
  recentRuns,
  role,
  viewerUserId,
  diagnoseRunId,
}: {
  workflow: Workflow;
  palette: NodeSummary[];
  liveRun: Run | null;
  recentRuns: RunSummary[];
  role: WorkspaceRole;
  viewerUserId: string;
  diagnoseRunId: string | null;
}) {
  const initial = useMemo(() => toFlow(workflow.graph), [workflow.graph]);
  const toast = useToast();
  const { theme } = useTheme();

  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<CanvasEdge>(initial.edges);
  /**
   * **Sticky notes — Phase 30 — are a list of their own**, laid over the nodes only for React
   * Flow (`flowNodes` below). Every other part of this file reads `nodes` and means registry
   * nodes, with `node.data.nodeType` and a label; keeping notes out of that array is what
   * lets all of it stay true without a type check at every call site.
   */
  const [notes, setNotes, onNotesChange] = useNodesState<CanvasNote>(initial.notes);
  /** The note being typed into on the canvas (`note-node.tsx`). */
  const [editingNote, setEditingNote] = useState<string | null>(null);

  const [name, setName] = useState(workflow.name);
  const [saved, setSaved] = useState<Workflow>(workflow);

  /**
   * Two breakpoints, two behaviours, and no viewport measurement anywhere — CSS
   * decides which is in play (see `panel.tsx`).
   *
   *   `open`       below `lg`, where a panel is a drawer over the canvas
   *   `collapsed`  at `lg` and up, where it is a column that can rail itself
   *
   * The collapsed pair is what answers Phase 16's layout problem: two open columns
   * leave an 880px canvas at 1440px; two rails leave about 1360px.
   */
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [paletteCollapsed, setPaletteCollapsed] = useCollapsed("palette-collapsed");
  const [inspectorCollapsed, setInspectorCollapsed] = useCollapsed("inspector-collapsed");
  /**
   * **What the right-hand column shows — Phase 35 (D161).** The copilot takes the inspector's
   * column rather than adding a third, so `inspectorOpen` and `inspectorCollapsed` are the
   * column's, whichever is in it. Selecting a node gives it back to the inspector.
   */
  const [rightPanel, setRightPanel] = useState<RightPanel>("inspector");

  const closePanels = useCallback(() => {
    setPaletteOpen(false);
    setInspectorOpen(false);
  }, []);

  const { run, live, watch, stop: stopStream, setRun } = useRunStream(workflow.id, liveRun);
  const [triggerInput, setTriggerInput] = useState("");
  /** A test waiting on the author's yes, because it reaches a step that writes (Phase 31). */
  const [pendingTest, setPendingTest] = useState<{
    scope: Exclude<TestScope, "workflow">;
    nodeId: string;
    title: string;
    effects: { name: string; does: string }[];
    aimedOnly: boolean;
  } | null>(null);
  const [busy, setBusy] = useState<
    null | "saving" | "running" | "queueing" | "stopping" | "switching" | "restarting"
  >(null);

  /**
   * Version history and the diff mode it opens (Phase 18).
   *
   * `comparison` is the whole of diff mode: when it is set the canvas renders the
   * **union** of two versions instead of the editing graph, read-only. The editing
   * `nodes`/`edges` are untouched underneath, which is what makes leaving diff mode
   * free — there is nothing to restore, because nothing was replaced.
   */
  const [historyOpen, setHistoryOpen] = useState(false);
  const [comparison, setComparison] = useState<
    { from: number; to: number; diff: GraphDiff } | null
  >(null);

  const { fitView, screenToFlowPosition } = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  const paletteSearch = useRef<HTMLInputElement>(null);
  const platform = usePlatform();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // The palette is the registry, delivered with the first render so every node draws
  // its real output handles immediately (see the page component).
  const registry = useMemo(
    () => new Map(palette.map((node) => [node.type, node])),
    [palette],
  );

  /**
   * Left-to-right order of the graph as it was first loaded, used only to stagger each
   * node's entry animation. Sorted by position rather than array index so a generated
   * graph assembles in reading order, and derived from `initial` so a node added later
   * has no entry and therefore no delay.
   */
  const entryOrder = useMemo(() => {
    const order = new Map<string, number>();
    [...initial.nodes]
      .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)
      .forEach((node, index) => order.set(node.id, index));
    return order;
  }, [initial.nodes]);

  /** Per-node outcome of the last run. A looped node contributes several steps. */
  const runStates = useMemo(() => runStatesOf(run), [run]);

  /**
   * Node id → the name the canvas shows for it, so the run panel can say
   * "Decide the topic" where Chapter 1 said `agent_2`. Read from the live canvas
   * rather than from the run, because a step records the node's *type* and not the
   * label its owner gave it.
   */
  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of nodes) {
      map.set(
        node.id,
        node.data.label ||
          registry.get(node.data.nodeType)?.label ||
          node.data.nodeType,
      );
    }
    return map;
  }, [nodes, registry]);

  /**
   * The canvas watches from the moment it opens, not only when it happened to load
   * mid-run. A run started anywhere else — a webhook, a schedule — is a run this page
   * is supposed to show. Watching only `liveRun` meant the page had to already be
   * loaded *during* a run to ever see one.
   *
   * `runId` is still pinned when the page did load mid-run, so a reload during
   * execution reattaches to that exact run rather than adopting it by guesswork (D29).
   */
  const attached = useRef(false);
  useEffect(() => {
    if (attached.current) return;
    attached.current = true;
    watch(liveRun ? { runId: liveRun.id } : undefined);
  }, [liveRun, watch]);

  /**
   * A schedule that fires while this canvas is open moves its own next slot on the server,
   * and the trigger panel reads `saved` — so re-read the schedule once per firing seen,
   * or the panel goes on naming a time that has already passed (Phase 26, found on the
   * deployed service). `schedule-sync.ts` says why this is one request per firing and why
   * only the schedule fields are taken.
   */
  const scheduleReadFor = useRef<string | null>(null);
  useEffect(() => {
    if (!isNewScheduledRun(run, scheduleReadFor.current)) return;
    scheduleReadFor.current = run?.id ?? null;
    api
      .getWorkflow(workflow.id)
      .then((fresh) => setSaved((current) => withScheduleOf(current, fresh)))
      // The run itself is still shown; a failed re-read leaves the panel as it was.
      .catch(() => {});
  }, [run, workflow.id]);

  /**
   * Collapsing a panel hands the canvas a few hundred more pixels, and React Flow does
   * not refit on its own — so the graph would sit in the corner of the space it was
   * just given.
   *
   * Called from the collapse and expand handlers rather than from an effect watching
   * the two booleans. An effect keyed on a value it never reads is a lie about what it
   * depends on, and it would also have needed a ref to suppress the fit on mount that
   * the `fitView` prop has already done. The event that changed the layout is the
   * honest place to respond to it.
   *
   * One frame of delay, so the column is out of the layout before the viewport is
   * measured. `tweenMs` is 0 under `prefers-reduced-motion`: this tween is driven in
   * JavaScript, so the CSS media query in `globals.css` cannot reach it.
   */
  const refit = useCallback(() => {
    requestAnimationFrame(() => fitView({ ...FIT, duration: tweenMs(220) }));
  }, [fitView]);

  /**
   * The edges as *drawn*. `edges` itself stays exactly what will be saved — the run
   * highlight and the routing are a projection over it, never state — which is what
   * keeps `fromFlow(nodes, edges)` the clean inverse `bridge.ts` promises. React Flow
   * reports changes by id, so selection and deletion still apply to the real state.
   *
   * Two run states, and they are the execution animation the phase asks for: an edge
   * into the node currently working animates its flow, and every edge the run has
   * actually crossed stays lit. On a branch the untaken edge never lights, so when the
   * run ends the canvas is showing the path the agent chose.
   */
  const displayEdges = useMemo(() => {
    const running = run?.status === "running";
    return edges.map((edge) => {
      const base = {
        ...edge,
        type: "smoothstep" as const,
        markerEnd: EDGE_MARKER,
      };

      // The rule is `edgeRunLook`, tested: lit through every node that handed a value on —
      // succeeded, switched off (Phase 30) or standing in with its pin (Phase 31).
      const look = edgeRunLook(
        runStates.get(edge.source)?.status,
        runStates.get(edge.target)?.status,
        running,
        edge.sourceHandle === ASK_HANDLE,
      );
      if (look === "live") return { ...base, animated: true, className: "edge-live" };
      if (look === "traversed") return { ...base, className: "edge-traversed" };
      return base;
    });
  }, [edges, run?.status, runStates]);

  const graph = useMemo(() => fromFlow(nodes, edges, notes), [nodes, edges, notes]);

  /** The copilot's conversation, and the proposal it has open — Phase 35 (`use-copilot.ts`). */
  const fitProposal = useCallback(() => {
    // A frame, so the union graph is on the canvas before it is measured — as `compare` does.
    requestAnimationFrame(() => fitView({ ...FIT, duration: tweenMs(250) }));
  }, [fitView]);
  const copilot = useCopilot({ workflowId: workflow.id, graph, registry, onOpened: fitProposal });
  const {
    accept: takeProposal,
    reject: dropProposal,
    setAside: setCopilotAside,
    busy: copilotBusy,
    diagnose: diagnoseRun,
    markFollowed,
    setHighlight,
  } = copilot;
  const proposal = copilot.state.proposal;

  /**
   * What React Flow draws: the notes, then the nodes. Two memos, so dragging a node does not
   * hand React Flow fifty new note objects every frame. A note's accessible name is its text,
   * because a node's wrapper is what a keyboard user tabs to and React Flow names it from here.
   */
  const labelledNotes = useMemo(
    () => notes.map((note) => ({ ...note, ariaLabel: `Sticky note: ${noteName(note.data.text)}` })),
    [notes],
  );
  const flowNodes = useMemo(
    () => [...labelledNotes, ...nodes] as (CanvasNode | CanvasNote)[],
    [labelledNotes, nodes],
  );
  const noteIds = useMemo(() => new Set(notes.map((note) => note.id)), [notes]);
  const dirty = !graphsEqual(graph, saved.graph) || name !== saved.name;

  /**
   * **What this viewer may do here — Phase 20.** Three booleans, derived once, and every
   * one of them is a mirror of a `requireScope` argument on the server rather than a
   * decision made in the browser:
   *
   *   canEdit      `editor`. Save, Run, Stop, the palette, dragging, deleting. Running is
   *                deliberately on this side of the line and not with reading: a run sends
   *                mail and posts to Discord, so it is a write to the outside world
   *                whatever it is to the database (`CONTRACT.md` → the roles matrix)
   *   canShare     `admin`. Publishing to the internet is an administrative act, not an
   *                edit — the share route says why at length
   *   canSetVisibility  the creator, or an admin. Not any editor, because flipping a
   *                colleague's workflow to private hides it from the people it was
   *                shared with
   *
   * `mayChangeVisibility` is imported rather than re-expressed, so the button and the
   * store cannot disagree about who may press it.
   */
  const canEdit = atLeast(role, "editor");
  /**
   * Which panel the right-hand column actually holds — only that one is in the document (D161). The
   * copilot is an editor's. An expression, not a call: handing `canEdit` to a function makes the React
   * Compiler treat it as mutable and give up every memo that depends on it.
   */
  const column: RightPanel = rightPanel === "copilot" && canEdit ? "copilot" : "inspector";
  const canShare = atLeast(role, "admin");
  const canSetVisibility = mayChangeVisibility({
    actorRole: role,
    actorUserId: viewerUserId,
    workflowOwnerId: workflow.ownerId,
  });

  const [shareOpen, setShareOpen] = useState(false);

  /**
   * What the canvas draws in diff mode, and the per-node treatment that goes with it.
   *
   * The union graph is built once per comparison and handed to React Flow **in place
   * of** `nodes`/`edges`, with every interaction handler withheld below. That is what
   * keeps the mode safe: React Flow reports changes through `onNodesChange`, so a
   * draggable diff would feed nodes from a graph nobody ever saved straight back into
   * the editing state and the next Save would write it.
   */
  /**
   * The diff on screen: two versions being compared, or — Phase 35 — a copilot proposal against
   * the canvas. Both are the same mode with the same safety story; only the bar above differs.
   */
  const shownDiff = comparison?.diff ?? proposal?.diff ?? null;

  const diffView = useMemo(() => {
    if (!shownDiff) return null;

    const union = diffGraph(shownDiff, saved.graph.version);
    const flow = toFlow(union);

    // `diffGraph` emits the edges in the same order it was handed them, so the two
    // arrays line up by index. Zipping beats re-deriving the change from the rendered
    // id, which would mean reading meaning out of a string this file minted.
    const edges = flow.edges.map((edge, index) => {
      const change = shownDiff.edges[index]?.change ?? "unchanged";
      return {
        ...edge,
        type: "smoothstep" as const,
        markerEnd: EDGE_MARKER,
        ...(change === "unchanged" ? {} : { className: `edge-${change}` }),
      };
    });

    const states = new Map(shownDiff.nodes.map((entry) => [entry.id, entry]));

    /**
     * `initialWidth`/`initialHeight`, and they are not decoration.
     *
     * React Flow measures a rendered node and writes the result back into the
     * controlled array **through `onNodesChange`** — which diff mode withholds. So a
     * diff node never gains a `measured` field, and everything that reads one treats
     * it as having no dimensions: the **minimap renders empty** for the whole time a
     * diff is on screen. Found in a browser; invisible to every other kind of check.
     *
     * `initialWidth` satisfies that read without forcing the DOM size the way `width`
     * would, so the cards still lay themselves out and the minimap has something to
     * draw. The height is an estimate, which is all a minimap needs: 119px is a plain
     * card as React Flow measured one, and a ribbon adds a row.
     */
    const nodes = flow.nodes.map((node) => ({
      ...node,
      initialWidth: NODE_WIDTH,
      initialHeight: states.get(node.id)?.change === "unchanged" ? 119 : 147,
    }));

    // Notes carry their own width and height, so they need no estimate (Phase 30).
    const noteStates = new Map(shownDiff.notes.map((entry) => [entry.id, entry]));

    return {
      nodes: [...flow.notes, ...nodes] as (CanvasNode | CanvasNote)[],
      edges,
      states,
      noteStates,
    };
  }, [shownDiff, saved.graph.version]);

  const comparing = diffView !== null;

  /**
   * Whether this canvas takes edits: an editor, outside diff mode. Undo, paste, duplicate,
   * arrange and the palette shortcut all answer to this one flag, so the two read-only
   * states — a viewer, a comparison — are inert in exactly the same way (Phase 29).
   */
  const editable = canEdit && !comparing;

  /**
   * The selection, read off the nodes themselves. One opens the node's inspector; several
   * open the *N nodes selected* state (Phase 29) — before which a box selection looked, to
   * the inspector, exactly like no selection at all.
   *
   * **Derived, never a second copy in state.** Phase 29 first kept the ids in state, set from
   * `onSelectionChange` — which React Flow calls from an effect, a render *after* the click.
   * Found on the deployed canvas: a node clicked and ⌘D pressed straight after duplicated
   * the previous selection, or nothing. The nodes' `selected` flags change in the same
   * render as the click, so they are the one source of truth.
   */
  const selection = useMemo(() => nodes.filter((node) => node.selected), [nodes]);
  /** Selected notes (Phase 30). They select, copy, move and delete with the nodes. */
  const selectedNotes = useMemo(() => notes.filter((note) => note.selected), [notes]);
  const selectedIds = useMemo(
    () => [...selection.map((node) => node.id), ...selectedNotes.map((note) => note.id)],
    [selection, selectedNotes],
  );
  const selected = selection.length === 1 && selectedNotes.length === 0 ? selection[0] : null;
  const selectedNote = selectedNotes.length === 1 && selection.length === 0 ? selectedNotes[0] : null;

  /**
   * The note being typed into on the canvas, mirrored for `onSelectionChange` (Phase 30).
   * Below `lg` the inspector is a drawer over the canvas, and opening it for a note somebody is
   * typing into covered that note with a second field for the same text — found at 600 px in a
   * browser. A layout effect, so it is current before React Flow reports the selection, which
   * it does from a passive one.
   */
  const typingInPlace = useRef<string | null>(null);
  useLayoutEffect(() => {
    typingInPlace.current = editingNote;
  }, [editingNote]);

  const onSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    const ids = params.nodes.map((node) => node.id);
    if (ids.length === 1 && ids[0] === typingInPlace.current) {
      setInspectorCollapsed(false);
      return;
    }
    // Selecting a node has to bring the inspector into view, or tapping a node on a
    // phone appears to do nothing at all — and at `lg` and up, a railed inspector
    // would swallow the selection just as silently.
    //
    // Only for one node. A box selection reports a new set on every frame of the drag,
    // and expanding a railed inspector mid-drag would resize the canvas under the box;
    // the rail names the selection ("3 nodes selected") instead.
    if (ids.length === 1) {
      setRightPanel("inspector");
      // A copilot sentence's highlight goes with the sentence (D169) — back in the copilot, nothing
      // is pressed rather than an old ring reappearing over a conversation that scrolled on.
      setHighlight(null);
      setInspectorOpen(true);
      setInspectorCollapsed(false);
    }
  }, [setHighlight, setInspectorCollapsed]);

  /**
   * Undo and redo (Phase 29). The history watches `graph`; putting a step back on the
   * canvas keeps everything React Flow knows about a surviving node (`restoreNodes`).
   */
  const applyGraph = useCallback(
    (next: WorkflowGraph) => {
      setNodes((current) => restoreNodes(current, next));
      setEdges((current) => restoreEdges(current, next));
      setNotes((current) => restoreNotes(current, next));
    },
    [setEdges, setNodes, setNotes],
  );
  const history = useHistory({ graph, apply: applyGraph, enabled: editable });
  const { beginGesture, endGesture, mark, reset: resetHistory, undo, redo } = history;

  /**
   * **Accept — one step of undo, and unsaved** (Phase 35, task 4). Marked as a step of its own and
   * put on the canvas the way undo puts a graph back (`restoreNodes` keeps every surviving node's
   * React Flow state), so the history records the canvas from before the proposal and ⌘Z returns
   * to it exactly. Nothing is saved: the toolbar reads *Unsaved changes*, and Save makes it a version.
   */
  const acceptProposal = useCallback(() => {
    const accepted = takeProposal();
    if (!accepted) return;
    mark(null);
    applyGraph(accepted);
    requestAnimationFrame(() => fitView({ ...FIT, duration: tweenMs(250) }));
  }, [applyGraph, fitView, mark, takeProposal]);

  const rejectProposal = useCallback(() => {
    dropProposal();
    requestAnimationFrame(() => fitView({ ...FIT, duration: tweenMs(250) }));
  }, [dropProposal, fitView]);

  /** Open the copilot in the right-hand column and put the cursor in it. */
  const openCopilot = useCallback(() => {
    const wasCollapsed = inspectorCollapsed;
    setRightPanel("copilot");
    setInspectorCollapsed(false);
    setInspectorOpen(true);
    setPaletteOpen(false);
    if (wasCollapsed) refit();
    // A frame, so a drawer that was `invisible` — or a column not yet rendered — is focusable first.
    // By id rather than a ref: ⌘K's commands are built during render, and *Ask the copilot* is one
    // of them (`findNode` says why).
    requestAnimationFrame(() => document.getElementById(COPILOT_COMPOSER)?.focus());
  }, [inspectorCollapsed, refit, setInspectorCollapsed]);

  /**
   * React Flow reports nodes and notes through one callback; each list applies its own
   * changes. By id, which the graph schema keeps unique across the two (D134).
   */
  const route = useCallback(
    (changes: NodeChange<CanvasNode | CanvasNote>[]) => {
      const forNotes: NodeChange<CanvasNote>[] = [];
      const forNodes: NodeChange<CanvasNode>[] = [];
      for (const change of changes) {
        const id = change.type === "add" ? change.item.id : change.id;
        if (noteIds.has(id)) forNotes.push(change as NodeChange<CanvasNote>);
        else forNodes.push(change as NodeChange<CanvasNode>);
      }
      if (forNotes.length > 0) onNotesChange(forNotes);
      if (forNodes.length > 0) onNodesChange(forNodes);
    },
    [noteIds, onNodesChange, onNotesChange],
  );

  /**
   * React Flow's own edits, with the gesture boundaries the history needs. A drag: a
   * position change that is `dragging` is a frame of it, and the first that is explicitly
   * not ends it. A resize (Phase 30, a note's): dimension changes carry `resizing` from the
   * first frame to the last. Everything between is one step of undo, however long.
   *
   * `dragging === false`, not merely falsy: a resize from a note's top or left edge also
   * moves it, and those position changes carry no `dragging` at all — reading them as "the
   * drag ended" would split one resize into a step per frame.
   */
  const handleNodesChange = useCallback(
    (changes: NodeChange<CanvasNode | CanvasNote>[]) => {
      for (const change of changes) {
        if (change.type === "position") {
          if (change.dragging) beginGesture();
          else if (change.dragging === false) endGesture();
        } else if (change.type === "dimensions" && change.resizing !== undefined) {
          if (change.resizing) beginGesture();
          else endGesture();
        }
      }
      route(changes);
    },
    [beginGesture, endGesture, route],
  );

  /** A viewer selects and measures, and nothing else reaches the graph (`readOnlyChanges`). */
  const handleReadOnlyNodesChange = useCallback(
    (changes: NodeChange<CanvasNode | CanvasNote>[]) => route(readOnlyChanges(changes)),
    [route],
  );
  const handleReadOnlyEdgesChange = useCallback(
    (changes: Parameters<typeof onEdgesChange>[0]) => onEdgesChange(readOnlyChanges(changes)),
    [onEdgesChange],
  );

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
      // The drawer covers the canvas below `lg`, so leaving it open would hide the
      // node that was just added.
      setPaletteOpen(false);
      const bounds = wrapper.current?.getBoundingClientRect();
      const viewportPosition = bounds
        ? screenToFlowPosition({ x: bounds.x + 140, y: bounds.y + bounds.height / 2 })
        : { x: 0, y: 0 };

      // Minted against the notes as well: one id space on the canvas (D134).
      const noteIdList = notes.map((note) => note.id);
      setNodes((current) => {
        const id = nextNodeId(
          [...current.map((node) => node.id), ...noteIdList],
          definition.type,
        );

        // New nodes land to the right of the rightmost one, so clicking through the
        // palette builds a readable left-to-right chain instead of a stack.
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
            data: {
              nodeType: definition.type,
              config: defaultConfig(definition.configSchema),
            },
          } satisfies CanvasNode,
        ];
      });

      // The chain grows rightwards, so without this the fourth node a user adds lands
      // outside the visible canvas and the click looks like it did nothing. Deferred a
      // frame so React Flow has measured the node it is fitting to. `tweenMs` is 0
      // when the user asks for reduced motion: this tween is driven in JavaScript, so
      // the CSS media query in `globals.css` cannot reach it.
      requestAnimationFrame(() => fitView({ ...FIT, duration: tweenMs(250) }));
    },
    [fitView, notes, screenToFlowPosition, setNodes],
  );

  const changeNode = useCallback(
    (id: string, data: Partial<CanvasNode["data"]>) => {
      setNodes((current) =>
        current.map((node) =>
          node.id === id ? { ...node, data: { ...node.data, ...data } } : node,
        ),
      );
      /**
       * **Phase 37 (D174).** A node has an Error output only while its on-error policy routes, so a
       * policy changed away from route takes the edges that left by Error with it — in the same
       * step of undo, so undoing the change brings both back. Left behind, they would be edges from
       * a handle that is not drawn, and a problem the author did not make.
       */
      if ("policy" in data && readPolicy(data.policy).onError !== "route") {
        setEdges((current) =>
          current.some((edge) => edge.source === id && edge.sourceHandle === ERROR_HANDLE)
            ? current.filter((edge) => !(edge.source === id && edge.sourceHandle === ERROR_HANDLE))
            : current,
        );
      }
    },
    [setEdges, setNodes],
  );

  /** Delete nodes and notes, and every edge touching them — one step of undo, however many. */
  const removeNodes = useCallback(
    (ids: readonly string[]) => {
      const gone = new Set(ids);
      setNodes((current) => current.filter((node) => !gone.has(node.id)));
      setNotes((current) => current.filter((note) => !gone.has(note.id)));
      setEdges((current) =>
        current.filter((edge) => !gone.has(edge.source) && !gone.has(edge.target)),
      );
    },
    [setEdges, setNodes, setNotes],
  );

  const deleteNode = useCallback((id: string) => removeNodes([id]), [removeNodes]);

  /** Select exactly this node or note, and nothing else. */
  const selectNode = useCallback(
    (id: string) => {
      setNodes((current) => current.map((node) => ({ ...node, selected: node.id === id })));
      setNotes((current) => current.map((note) => ({ ...note, selected: note.id === id })));
    },
    [setNodes, setNotes],
  );

  /** A note's text or tone (Phase 30). Typing coalesces in the history (`note:<id>`). */
  const changeNote = useCallback(
    (id: string, patch: Partial<CanvasNoteData>) => {
      setNotes((current) =>
        current.map((note) => (note.id === id ? { ...note, data: { ...note.data, ...patch } } : note)),
      );
    },
    [setNotes],
  );

  /**
   * Switch nodes off, or back on — Phase 30. One click is one step of undo however many
   * nodes it touches. **A trigger is never switched off** (`disabled_trigger`): it is left
   * as it is and the author is told what they probably wanted, which is the Active switch.
   * Returns whether anything changed, so the D key stays unclaimed with nothing selected.
   */
  const setDisabled = useCallback(
    (ids: readonly string[], off: boolean): boolean => {
      const wanted = new Set(ids);
      const isTrigger = (node: CanvasNode) => registry.get(node.data.nodeType)?.kind === "trigger";
      const targets = nodes.filter((node) => wanted.has(node.id) && !isTrigger(node));
      if (targets.length === 0) {
        if (nodes.some((node) => wanted.has(node.id))) {
          toast({
            tone: "warn",
            title: "A trigger cannot be switched off",
            detail: "Every run starts at its trigger. To stop this workflow running by itself, use the Active switch.",
          });
          return true;
        }
        return false;
      }
      const changed = new Set(targets.map((node) => node.id));
      mark(null);
      setNodes((current) =>
        current.map((node) => (changed.has(node.id) ? { ...node, data: switched(node.data, off) } : node)),
      );
      if (off && targets.length < nodes.filter((node) => wanted.has(node.id)).length) {
        toast({ tone: "warn", title: "The trigger was left on", detail: "Every run starts at its trigger." });
      }
      return true;
    },
    [mark, nodes, registry, setNodes, toast],
  );

  /** D: if any selected node is on, switch them all off; if all are off, switch them on. */
  const toggleSelectionDisabled = useCallback((): boolean => {
    if (selection.length === 0) return false;
    const anyOn = selection.some((node) => !node.data.disabled);
    return setDisabled(selection.map((node) => node.id), anyOn);
  }, [selection, setDisabled]);

  /**
   * Add pasted or duplicated nodes as one step, selected — so the next thing a person
   * does (drag them, delete them, undo) applies to exactly what just arrived.
   */
  const insertNodes = useCallback(
    (added: WorkflowNode[], addedEdges: WorkflowEdge[], addedNotes: WorkflowNote[] = []) => {
      mark(null);
      setNodes((current) => [
        ...current.map((node) => (node.selected ? { ...node, selected: false } : node)),
        ...added.map((node) => ({ ...toFlowNode(node), selected: true })),
      ]);
      setNotes((current) => [
        ...current.map((note) => (note.selected ? { ...note, selected: false } : note)),
        ...addedNotes.map((note) => ({ ...toFlowNote(note), selected: true })),
      ]);
      setEdges((current) => [
        ...current.map((edge) => (edge.selected ? { ...edge, selected: false } : edge)),
        ...addedEdges.map(toFlowEdge),
      ]);
    },
    [mark, setEdges, setNodes, setNotes],
  );

  const selectAll = useCallback(() => {
    setNodes((current) => current.map((node) => (node.selected ? node : { ...node, selected: true })));
    setNotes((current) => current.map((note) => (note.selected ? note : { ...note, selected: true })));
  }, [setNodes, setNotes]);

  /** The inspector's arrow buttons. Repeated nudges of one selection are one step. */
  const moveSelection = useCallback(
    (dx: number, dy: number) => {
      const nudge = <T extends CanvasNode | CanvasNote>(item: T): T =>
        item.selected ? { ...item, position: { x: item.position.x + dx, y: item.position.y + dy } } : item;
      setNodes((current) => current.map(nudge));
      setNotes((current) => current.map(nudge));
    },
    [setNodes, setNotes],
  );

  /**
   * A new sticky note in the middle of the screen, selected and ready to type into — Phase
   * 30. One step of undo. Its id is minted against nodes and notes alike (D134).
   */
  const addNote = useCallback(() => {
    // The document, not `wrapper`: ⌘K's commands are built during render (`findNode` says
    // why), and *Add a sticky note* is one of them. `#main` is the element `wrapper` holds.
    const bounds = document.getElementById("main")?.getBoundingClientRect();
    const centre = bounds
      ? screenToFlowPosition({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 })
      : { x: 0, y: 0 };
    const id = nextNoteId([...nodes.map((node) => node.id), ...notes.map((note) => note.id)]);
    const note = toFlowNote({
      id,
      position: {
        x: Math.round(centre.x - NOTE_DEFAULT_SIZE.width / 2),
        y: Math.round(centre.y - NOTE_DEFAULT_SIZE.height / 2),
      },
      size: { ...NOTE_DEFAULT_SIZE },
      text: "",
      tone: DEFAULT_NOTE_TONE,
    });
    mark(null);
    setNodes((current) => current.map((node) => (node.selected ? { ...node, selected: false } : node)));
    setNotes((current) => [
      ...current.map((existing) => (existing.selected ? { ...existing, selected: false } : existing)),
      { ...note, selected: true },
    ]);
    setEditingNote(id);
  }, [mark, nodes, notes, screenToFlowPosition, setNodes, setNotes]);

  /**
   * Auto-arrange: the generator's own layout (D40) over the graph as it stands. Columns
   * by longest path, left to right — the shape a generated workflow arrives in, so an
   * arranged one reads the same way. One step of undo.
   */
  const arrange = useCallback(() => {
    const positions = layout(graph.nodes, graph.edges);
    mark(null);
    setNodes((current) =>
      current.map((node) => {
        const position = positions.get(node.id);
        return position ? { ...node, position } : node;
      }),
    );
    requestAnimationFrame(() => fitView({ ...FIT, duration: tweenMs(300) }));
  }, [fitView, graph, mark, setNodes]);

  const fit = useCallback(() => {
    fitView({ ...FIT, duration: tweenMs(250) });
  }, [fitView]);

  /** `/` — the palette's search, from anywhere on the canvas, opened if it was put away. */
  const focusPaletteSearch = useCallback(() => {
    const wasCollapsed = paletteCollapsed;
    setPaletteCollapsed(false);
    setPaletteOpen(true);
    setInspectorOpen(false);
    if (wasCollapsed) refit();
    // A frame, so a drawer that was `invisible` is visible — and focusable — first.
    requestAnimationFrame(() => paletteSearch.current?.focus());
  }, [paletteCollapsed, refit, setPaletteCollapsed]);

  /**
   * *Find a node* in ⌘K: select it, open it, bring it to the middle of the screen — and
   * **focus it**, so a keyboard user can move it with the arrows, delete it or duplicate
   * it straight away rather than tabbing through the palette to reach the canvas. The
   * command palette leaves focus where a command put it (`command-palette.tsx`).
   */
  const findNode = useCallback(
    (id: string) => {
      selectNode(id);
      setInspectorOpen(true);
      setInspectorCollapsed(false);
      // The document, not `wrapper`: this runs from a command built during render, and
      // a ref read there is what `react/refs` exists to refuse. There is one canvas a page.
      document
        .querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`)
        ?.focus({ preventScroll: true });
      requestAnimationFrame(() =>
        fitView({ nodes: [{ id }], padding: 0.6, maxZoom: 1, duration: tweenMs(300) }),
      );
    },
    [fitView, selectNode, setInspectorCollapsed],
  );

  /** The canvas on screen, in flow coordinates — where a paste of far-away nodes lands. */
  const visibleRect = useCallback((): FlowRect | undefined => {
    const bounds = wrapper.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0) return undefined;
    const from = screenToFlowPosition({ x: bounds.left, y: bounds.top });
    const to = screenToFlowPosition({ x: bounds.right, y: bounds.bottom });
    return { x: from.x, y: from.y, width: to.x - from.x, height: to.y - from.y };
  }, [screenToFlowPosition]);

  const clipboard = useClipboard({
    graph,
    selectedIds,
    registry,
    canCopy: !comparing,
    canEdit: editable,
    viewport: visibleRect,
    insert: insertNodes,
    remove: removeNodes,
    toast,
  });

  /** One PATCH carrying the whole graph — a single atomic row update (D14). */
  const save = useCallback(async (): Promise<Workflow | null> => {
    setBusy("saving");
    try {
      const updated = await api.updateWorkflow(workflow.id, {
        name: name.trim() === "" ? saved.name : name.trim(),
        graph,
      });
      setSaved(updated);
      setName(updated.name);
      return updated;
    } catch (error) {
      toast({
        tone: "bad",
        title: "Could not save the workflow",
        detail: error instanceof ApiRequestError ? error.message : undefined,
        // A failure worth acting on stays up until it is dismissed (WCAG 2.2.1).
        duration: null,
      });
      return null;
    } finally {
      setBusy(null);
    }
  }, [graph, name, saved.name, toast, workflow.id]);

  /**
   * Everything both Run buttons do before they diverge: save what is unsaved, refuse a
   * graph that cannot run, parse the trigger input, clear the previous run and open the
   * stream.
   *
   * Extracted in Phase 17 rather than copied, because the two paths differ in exactly one
   * thing — whether the POST waits for the run — and duplicating thirty lines around that
   * one difference is how the two drift apart.
   *
   * Running always runs what is *stored*, so unsaved edits are saved first. The
   * alternative — running a graph the server has not seen — makes the run history
   * describe a workflow that never existed.
   */
  const prepare = useCallback(async (
    /**
     * A test of part of the workflow — Phase 31. It may run on a canvas that is not runnable
     * as a whole (the server decides what it needs), it keeps the selection so the node being
     * tested stays in the inspector, and a node tested alone takes no trigger input.
     */
    test?: { scope: Exclude<TestScope, "workflow"> },
  ): Promise<{ input: unknown } | null> => {
    const current = dirty ? await save() : saved;
    if (!current) return null;

    if (!current.runnable && !test) {
      toast({
        tone: "warn",
        title: "Saved, but this workflow cannot run yet",
        detail: `${current.problems.length} problem${current.problems.length === 1 ? "" : "s"} to fix — they are listed in the inspector.`,
      });
      setInspectorCollapsed(false);
      setInspectorOpen(true);
      return null;
    }

    let input: unknown = null;
    if (triggerInput.trim() !== "" && test?.scope !== "node") {
      try {
        input = JSON.parse(triggerInput);
      } catch {
        toast({ tone: "bad", title: "Trigger input is not valid JSON" });
        return null;
      }
    }

    /**
     * **The manual trigger's declared fields — Phase 31.** Checked here as well as by the
     * trigger, so a missing required field is refused before anything is saved as a run. Not
     * for a node tested alone, which never runs the trigger, nor for a trigger standing in with
     * a pin — the trigger does not execute either way, so it checks nothing.
     */
    const trigger = current.graph.nodes.find((node) => registry.get(node.type)?.kind === "trigger");
    if (trigger?.type === manualTrigger.type && test?.scope !== "node") {
      const config = manualTrigger.configSchema.safeParse(trigger.config ?? {});
      const pinnedTrigger = honouredPin(trigger, registry.get(trigger.type)) !== undefined;
      const problem =
        config.success && !pinnedTrigger
          ? checkManualInput((config.data as { fields: Parameters<typeof checkManualInput>[0] }).fields, input)
          : null;
      if (problem) {
        toast({ tone: "warn", title: "The run needs its input", detail: problem });
        setInspectorCollapsed(false);
        setInspectorOpen(true);
        return null;
      }
    }

    if (!test) {
      setNodes((all) => all.map((node) => ({ ...node, selected: false })));
      setNotes((all) => all.map((note) => ({ ...note, selected: false })));
    }
    // Clear the previous run first. The stream's first snapshot is a few hundred
    // milliseconds away, and leaving the old run on screen means pressing Run shows a
    // canvas full of green "Succeeded" badges for something that has not started.
    setRun(null);

    // The stream opens *before* the run is triggered. It has to: `POST /runs` is
    // synchronous and does not return until the run is over, so a client that waited for
    // a run id would have nothing left to watch. The stream works out which run is the
    // new one by itself (D28) — which is also why a *durable* run needed no new client
    // protocol: it is the same "watch a run this browser did not start" path.
    watch();

    return { input };
  }, [dirty, registry, save, saved, setInspectorCollapsed, setNodes, setNotes, setRun, toast, triggerInput, watch]);

  const start = useCallback(async () => {
    const prepared = await prepare();
    if (!prepared) return;
    const { input } = prepared;

    setBusy("running");

    try {
      // Authoritative, and it also covers the case where the stream never connected.
      const finished = await api.runWorkflow(workflow.id, input);
      setRun(finished);

      /**
       * A run that *fails* resolves this promise perfectly happily — the request
       * succeeded, the run did not. Without this the only sign is a red node card and
       * a line in the inspector, which on a shared screen is a run that looks like it
       * worked.
       *
       * The failing step is named because "the run failed" sends the reader hunting;
       * "Append to Google Sheet failed" is something to act on.
       */
      if (finished.status === "failed") {
        const failed = finished.steps?.find((step) => step.status === "failed");
        const label = failed
          ? (names.get(failed.nodeId) ??
            registry.get(failed.nodeType)?.label ??
            failed.nodeType)
          : null;
        toast({
          tone: "bad",
          title: label ? `${label} failed` : "The run failed",
          detail: failed?.error ?? finished.error ?? "No reason was recorded.",
          duration: null,
        });
      } else if (finished.status === "waiting" && finished.waitingFor === "approval") {
        // Phase 38. It asked a person: the run panel shows the request, and whoever may decide can
        // do so there, in the inbox, or through the link its Ask path sent.
        toast({
          tone: "ok",
          title: "Waiting for a decision",
          detail: finished.wakeAt
            ? `The run asked a person and is paused until they decide, or until ${formatUtc(finished.wakeAt)}. You can close this page.`
            : "The run asked a person and is paused until they decide. You can close this page.",
        });
      } else if (finished.status === "waiting") {
        // Phase 26. The request came back, the run did not finish, and that is correct:
        // it reached a long delay and was put down until its wake time.
        toast({
          tone: "ok",
          title: finished.wakeAt ? `Waiting until ${formatUtc(finished.wakeAt)}` : "Waiting",
          detail: "The run reached a delay and is paused. It resumes on its own — you can close this page.",
        });
      } else if (finished.status === "succeeded") {
        // Phase 37: a run that got past a failure says which step it got past — the run worked as
        // planned, so the tone stays ok, and the step is named so it can be looked at.
        const handled = finished.steps?.find((step) => step.status === "handled");
        const handledName = handled
          ? (names.get(handled.nodeId) ?? registry.get(handled.nodeType)?.label ?? handled.nodeType)
          : null;
        toast({
          tone: "ok",
          // A run that used pinned outputs is a test (Phase 31), and says so where it ends.
          title: finished.test ? "Test run finished — pinned outputs used" : "Run finished",
          detail: [
            finished.durationMs === null
              ? null
              : `${finished.steps?.length ?? 0} steps in ${formatDuration(finished.durationMs)}.`,
            handled ? `${handledName} failed and its error was handled${(finished.handled ?? 0) > 1 ? `, with ${finished.handled - 1} more` : ""}.` : null,
          ]
            .filter(Boolean)
            .join(" ") || undefined,
        });
      }
    } catch (error) {
      toast({
        tone: "bad",
        title: "The run could not start",
        detail: error instanceof ApiRequestError ? error.message : undefined,
        duration: null,
      });
    } finally {
      // The run is over by the time the POST resolves, so the stream has nothing left
      // to say and Cloud Run should stop billing for it.
      stopStream();
      setBusy(null);
    }
    // `stopStream` is the one identifier the two lint rules disagree about, and they
    // genuinely contradict each other: `react-hooks/exhaustive-deps` reports it as a
    // MISSING dependency if it is left out, and `react/memo-dependencies` reports it
    // as an EXTRA one if it is put in. Both cannot be satisfied.
    //
    // It stays in, and the newer rule is suppressed, because `useRunStream` defines it
    // as `useCallback(..., [])` — stable for the component's lifetime, so listing it
    // cannot cost a render, while omitting it would capture a stale closure the day
    // that hook is changed to close over anything. The cheap direction is the one that
    // survives a future edit to another file.
    //
    // This replaces Chapter 1's suppression of the same rule on the same array, whose
    // note read "an over-broad dependency list ... Phase 16 rebuilds this component".
    // The array is no longer over-broad: every other entry here was verified to be
    // required by removing it and watching `exhaustive-deps` ask for it back.
  }, [
    names,
    prepare,
    registry,
    setRun,
    // oxlint-disable-next-line react/memo-dependencies
    stopStream,
    toast,
    workflow.id,
  ]);

  /**
   * The durable path. It differs from `start` in one line — `runWorkflowDurably` answers
   * as soon as the run is on the queue rather than when it is over — and in one omission:
   * **the stream is deliberately left open.** `start` closes it in its `finally` because
   * the run is finished by then; here the run has not begun, and closing the stream is
   * exactly how a queued run would become invisible on the canvas. That is the Phase 12
   * defect (D59) in a new place, so it is worth saying out loud rather than leaving as an
   * absent line of code.
   */
  const startDurable = useCallback(async () => {
    const prepared = await prepare();
    if (!prepared) return;

    setBusy("queueing");

    try {
      const queued = await api.runWorkflowDurably(workflow.id, prepared.input);
      // The stream may have the run already, with steps a fast delivery recorded (`adoptStarted`).
      setRun((current) => adoptStarted(current, queued));

      toast(
        queued.status === "queued"
          ? {
              tone: "ok",
              title: "Queued",
              detail:
                "This run is on the queue. It survives a redeploy or a restart, and it streams here as it goes.",
            }
          : {
              // The fallback in `startDurableRun`: no queue was reachable, so it ran in
              // the request instead. Saying so matters — the user asked for durability
              // and did not get it.
              tone: "warn",
              title: "Ran without the queue",
              detail:
                "The queue was not available, so this ran immediately instead. It would not have survived a restart.",
              duration: null,
            },
      );
    } catch (error) {
      stopStream();
      toast({
        tone: "bad",
        title: "The run could not be queued",
        detail: error instanceof ApiRequestError ? error.message : undefined,
        duration: null,
      });
    } finally {
      setBusy(null);
    }
  }, [
    prepare,
    setRun,
    // oxlint-disable-next-line react/memo-dependencies
    stopStream,
    toast,
    workflow.id,
  ]);

  /**
   * **Run history on the canvas — Phase 33.** The page hands over this workflow's newest runs; the
   * run on screen — streamed (D59), started here, or opened from the list — is merged into them as
   * it changes (`mergeRecent`), so the list stays current with no request of its own. React's
   * "adjust state when a value changes", done during render as `library-dialogs.tsx` does, so the
   * row and the canvas never disagree for a frame.
   */
  const [recent, setRecent] = useState(recentRuns);
  const [mergedRun, setMergedRun] = useState<Run | null>(run);
  if (run !== mergedRun) {
    setMergedRun(run);
    setRecent((current) => mergeRecent(current, run, saved.name));
  }

  /**
   * An earlier run, opened from the list: its id, and what the canvas showed before it so *Stop
   * showing it* can put that back. A new run arriving on the stream replaces it as any run does,
   * and the panel stops calling it earlier because the run on screen is no longer it.
   */
  const [pastRunId, setPastRunId] = useState<string | null>(null);
  const beforePast = useRef<Run | null>(null);
  const [openingRun, setOpeningRun] = useState<string | null>(null);
  const showingPast = pastRunId !== null && run?.id === pastRunId;

  const openRun = useCallback(
    async (runId: string) => {
      if (run?.id === runId || openingRun) return;
      setOpeningRun(runId);
      try {
        const full = await api.getRun(runId);
        if (!showingPast) beforePast.current = run;
        setPastRunId(runId);
        setRun(full);
      } catch (error) {
        toast({
          tone: "bad",
          title: "That run could not be opened",
          detail: error instanceof ApiRequestError ? error.message : undefined,
        });
      } finally {
        setOpeningRun(null);
      }
    },
    [openingRun, run, setRun, showingPast, toast],
  );

  const closePast = useCallback(() => {
    setPastRunId(null);
    setRun(beforePast.current);
    beforePast.current = null;
  }, [setRun]);

  /**
   * **Retry from the failed step, or re-run — Phase 33.** Queued, like *Run in the background*:
   * the new run is followed over the stream the canvas already holds open, re-armed here so it
   * picks the new run up the moment it exists (D28). What runs is what is **stored**, so unsaved
   * edits are saved first — the fix somebody just typed into the failed node is the point of a
   * retry.
   */
  const restart = useCallback(
    async (kind: "rerun" | "retry", runId = run?.id): Promise<boolean> => {
      if (!runId) return false;
      const current = dirty ? await save() : saved;
      if (!current) return false;

      setBusy("restarting");
      watch();
      try {
        const started = await api.restartRun(runId, kind, "durable");
        setPastRunId(null);
        setRun((current) => adoptStarted(current, started));
        toast({
          tone: "ok",
          title: kind === "retry" ? "Retrying from the failed step" : "Running it again",
          detail:
            kind === "retry"
              ? "The steps that finished are reused, not run again. It streams here as it goes."
              : "With the same input, on the workflow as it is saved now.",
        });
        return true;
      } catch (error) {
        toast({
          tone: "bad",
          title: kind === "retry" ? "The run could not be retried" : "The run could not be started",
          detail: error instanceof ApiRequestError ? error.message : undefined,
          duration: null,
        });
        return false;
      } finally {
        setBusy(null);
      }
    },
    [dirty, run, save, saved, setRun, toast, watch],
  );

  /**
   * **Why did this run fail? — Phase 36.** The copilot opens in the right-hand column and diagnoses
   * the run; a fix in the workflow arrives as a proposal on the canvas (D167).
   */
  const askWhy = useCallback(
    (runId: string) => {
      openCopilot();
      void diagnoseRun(runId);
    },
    [diagnoseRun, openCopilot],
  );

  /**
   * An accepted fix, run again the way that will actually run it (D171): saved first — Accept left
   * it unsaved, and retry and re-run execute what is stored (D151) — then retried from the failed
   * step, or re-run when the fix changed a step a retry would reuse.
   */
  const followFix = useCallback(
    async (turnId: number, runId: string, next: AfterFix) => {
      if (await restart(next.kind === "retry" ? "retry" : "rerun", runId)) markFollowed(turnId);
    },
    [markFollowed, restart],
  );

  /**
   * Arriving from `/runs/[id]` with `?diagnose=<run>` (D170): show that run on the canvas and ask
   * the copilot about it, once. The parameter is taken out of the address first, so a reload does
   * not spend the person's model quota on the same question again.
   */
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current || !diagnoseRunId) return;
    // Its own task, after the canvas's first commit: arriving is an event, like a click, and what
    // it does — opening the column, asking — is the click's work, not this render's. The flag is
    // set inside, so a development double-mount, whose cleanup clears the first timer, still asks once.
    const timer = setTimeout(() => {
      if (arrived.current) return;
      arrived.current = true;
      const url = new URL(window.location.href);
      url.searchParams.delete("diagnose");
      replaceAddress(`${url.pathname}${url.search}${url.hash}`);
      if (!canEdit) return;
      void openRun(diagnoseRunId);
      askWhy(diagnoseRunId);
    }, 0);
    return () => clearTimeout(timer);
  }, [askWhy, canEdit, diagnoseRunId, openRun]);

  /**
   * **Test part of the workflow — Phase 31.** *Test this node* runs one node, fed from pins and
   * from what ran before; *test up to here* runs the way from the trigger to it. Both are
   * synchronous, like Run, and both are labelled a test on the run.
   *
   * When the test would execute a step that acts outside the product, it waits for the
   * author's yes first (`TestConfirmDialog`). The plan is the engine's own arithmetic
   * (`planTest`), over the graph on screen, which `prepare` then saves — so what the dialog
   * names is what runs.
   */
  const startTest = useCallback(
    async (scope: Exclude<TestScope, "workflow">, nodeId: string, confirmed = false) => {
      if (!confirmed) {
        const plan = planTest(graph, { scope, nodeId }, (type) => registry.get(type));
        if (plan.effects.length > 0) {
          const name = names.get(nodeId) ?? nodeId;
          setPendingTest({
            scope,
            nodeId,
            title: scope === "node" ? `Test ${name} alone?` : `Test up to ${name}?`,
            effects: plan.effects.map((effect) => ({
              name: names.get(effect.node.id) ?? effect.node.id,
              does: effect.does,
            })),
            // Pinning is no help when the only step that writes is the one being tested: the
            // node a test is aimed at always runs.
            aimedOnly: plan.effects.every((effect) => effect.node.id === nodeId),
          });
          return;
        }
      }

      const prepared = await prepare({ scope });
      if (!prepared) return;
      setBusy("running");

      try {
        const finished = await api.runWorkflow(workflow.id, prepared.input, { scope, nodeId });
        setRun(finished);
        const outcome = testOutcome(finished, nodeId, names);
        toast({ ...outcome, duration: outcome.tone === "bad" ? null : undefined });
      } catch (error) {
        toast({
          tone: "bad",
          title: "The test could not run",
          detail: error instanceof ApiRequestError ? error.message : undefined,
          duration: null,
        });
      } finally {
        stopStream();
        setBusy(null);
      }
    },
    [
      graph,
      names,
      prepare,
      registry,
      setRun,
      // oxlint-disable-next-line react/memo-dependencies
      stopStream,
      toast,
      workflow.id,
    ],
  );

  /**
   * **Pin a node's output, or unpin it — Phase 31.** An ordinary graph edit — undoable, saved,
   * versioned — refused here when it would pass the caps the graph schema enforces, so the
   * author hears why now rather than as a failed save.
   */
  const pinOutput = useCallback(
    (id: string, output: unknown) => {
      if (output !== undefined) {
        const size = jsonBytes(output);
        const others = graph.nodes
          .filter((node) => node.id !== id && node.pinned)
          .reduce((total, node) => total + jsonBytes(node.pinned!.output), 0);
        if (size > PIN_MAX_BYTES || others + size > PINNED_TOTAL_MAX_BYTES) {
          toast({
            tone: "warn",
            title: "Too large to pin",
            detail:
              size > PIN_MAX_BYTES
                ? `This output is ${Math.ceil(size / 1024)} KB, and a pinned output can be at most ${PIN_MAX_BYTES / 1024} KB. Pin a trimmed copy as JSON instead.`
                : `This workflow's pins would add up to ${Math.ceil((others + size) / 1024)} KB, past the ${PINNED_TOTAL_MAX_BYTES / 1024} KB they may share. Unpin another first.`,
            duration: null,
          });
          return false;
        }
      }
      changeNode(id, { pinned: output === undefined ? undefined : { output } });
      return true;
    },
    [changeNode, graph.nodes, toast],
  );

  /**
   * Stop a run. Honest about what it can promise: a node already talking to Gmail is not
   * interrupted, because a request in flight cannot be recalled. So the toast says "the
   * step that is running will finish first" rather than "cancelled", unless the server
   * came back saying it really did cancel it — which happens when nothing had started it
   * yet (`api/runs/[id]/cancel`).
   */
  const stopRun = useCallback(async () => {
    if (!run) return;

    setBusy("stopping");
    try {
      const updated = await api.cancelRun(run.id);
      setRun(updated);

      toast(
        updated.status === "cancelled"
          ? { tone: "ok", title: "Run cancelled" }
          : {
              tone: "warn",
              title: "Stopping the run",
              detail:
                "No further nodes will start. The one that is running finishes first — a request already sent cannot be recalled.",
            },
      );
    } catch (error) {
      toast({
        tone: "bad",
        title: "The run could not be stopped",
        detail: error instanceof ApiRequestError ? error.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  }, [run, setRun, toast]);

  /**
   * Enter diff mode. Fetching here rather than in the dialog is deliberate: the canvas
   * owns the mode, and a dialog that closed *and then* failed to load would leave the
   * user staring at an unchanged canvas with nothing to explain it.
   */
  const compare = useCallback(
    async (from: number, to: number) => {
      // One diff on the canvas at a time. A proposal waiting on Accept is the person's open
      // decision, and a comparison drawn over it would hide it — so they finish it first.
      if (proposal || copilotBusy) {
        toast({
          tone: "warn",
          title: "The copilot has a change open",
          detail: "Accept or reject its proposal first, then compare versions.",
        });
        return;
      }
      try {
        const result = await api.compareVersions(workflow.id, from, to);
        setNodes((all) => all.map((node) => ({ ...node, selected: false })));
        setNotes((all) => all.map((note) => ({ ...note, selected: false })));
        setEditingNote(null);
        setComparison({ from, to, diff: result.diff });
        requestAnimationFrame(() => fitView({ ...FIT, duration: tweenMs(250) }));
      } catch (error) {
        toast({
          tone: "bad",
          title: "Could not compare those versions",
          detail: error instanceof ApiRequestError ? error.message : undefined,
          duration: null,
        });
      }
    },
    [copilotBusy, fitView, proposal, setNodes, setNotes, toast, workflow.id],
  );

  /**
   * Leave diff mode. Nothing to restore — the editing graph was never replaced.
   *
   * **Nor does the undo history clear**, though `BUILD_PLAN.md` Phase 29 first said it
   * should (D128). The history is a history of the editing graph, and a comparison never
   * touches it: undo is inert while one is on screen, and afterwards the stack is exactly
   * the work the person did before they looked. Clearing it would throw that work's undo
   * away for no reason a person could see.
   */
  const stopComparing = useCallback(() => {
    setComparison(null);
    requestAnimationFrame(() => fitView({ ...FIT, duration: tweenMs(250) }));
  }, [fitView]);

  /**
   * A restore rewrites the stored workflow, so the canvas has to adopt it wholesale:
   * the saved baseline, the name, and the nodes and edges on screen. Doing less would
   * leave the canvas showing the old graph and reporting it as unsaved work.
   */
  const adoptRestored = useCallback(
    (restored: Workflow) => {
      const flow = toFlow(restored.graph);
      // A restored version has no past on this canvas: its undo would step back into a
      // graph the restore just replaced (Phase 29).
      resetHistory(restored.graph);
      setSaved(restored);
      setName(restored.name);
      setNodes(flow.nodes);
      setEdges(flow.edges);
      setNotes(flow.notes);
      setEditingNote(null);
      setComparison(null);
      // A proposal is a change to the canvas the restore just replaced (Phase 35).
      setCopilotAside(
        "A version was restored over the canvas, so the copilot's proposal was set aside. Ask again to change what is there now.",
      );
      requestAnimationFrame(() => fitView({ ...FIT, duration: tweenMs(250) }));
    },
    [fitView, resetHistory, setCopilotAside, setEdges, setNodes, setNotes],
  );

  /**
   * Rotate the webhook URL — **Phase 21**.
   *
   * It replaces the *saved* workflow and nothing else: the graph on screen is unchanged, the
   * dirty flag is unchanged, and `webhookUrl` comes off `saved`, so the trigger panel prints
   * the new URL without anybody building one. A failure is a toast rather than a thrown
   * promise, because the panel's confirm step has already closed by the time it lands and a
   * silent rejection would leave a user believing an old URL was dead.
   */
  const rotateWebhook = useCallback(async () => {
    try {
      const rotated = await api.rotateWebhookToken(saved.id);
      setSaved(rotated);
      toast({
        tone: "ok",
        title: "Webhook URL rotated",
        detail: "The previous URL is already refused. Copy the new one to whatever calls it.",
        duration: null,
      });
    } catch (error) {
      toast({
        tone: "bad",
        title: "Could not rotate the URL",
        detail: error instanceof ApiRequestError ? error.message : "Try again.",
        duration: null,
      });
    }
  }, [saved.id, toast]);

  /**
   * The active switch — **Phase 26**. It changes when the workflow runs *by itself*, not
   * what it does, so it is its own PATCH and replaces only the saved workflow: the graph
   * on screen and the dirty flag are untouched, like a webhook rotation.
   */
  const toggleActive = useCallback(async () => {
    const next = !saved.active;
    setBusy("switching");
    try {
      const updated = await api.updateWorkflow(saved.id, { active: next });
      setSaved(updated);
      toast(
        next
          ? {
              tone: "ok",
              title: "Switched on",
              detail: updated.scheduleNextAt
                ? `The schedule fires next at ${formatUtc(updated.scheduleNextAt)}.`
                : "The webhook accepts runs again.",
            }
          : {
              tone: "ok",
              title: "Switched off",
              // Names only the triggers this workflow has — a schedule-only workflow told
              // that "its webhook refuses calls" has been told about something it lacks.
              detail: `${
                updated.webhookUrl ? "Its webhook refuses calls" : "Its schedule will not fire"
              }. Pressing Run still works.`,
            },
      );
    } catch (error) {
      toast({
        tone: "bad",
        title: next ? "Could not switch it on" : "Could not switch it off",
        detail: error instanceof ApiRequestError ? error.message : "Try again.",
        duration: null,
      });
    } finally {
      setBusy(null);
    }
  }, [saved.active, saved.id, toast]);

  /**
   * Whether the switch means anything here: only a stored webhook, schedule or — Phase 37 —
   * error trigger runs a workflow by itself. A manual workflow has nothing to switch off, and a
   * switch that does nothing is a question the user then has to ask.
   */
  const automatic =
    saved.webhookUrl !== null ||
    saved.scheduleCron !== null ||
    saved.graph.nodes.some((node) => node.type === ERROR_TRIGGER_TYPE);

  /**
   * The keyboard — Phase 29. Which key means what is `lib/canvas/shortcuts.ts`; an action
   * left `undefined` here is not claimed, so its key keeps the browser's meaning. Undo,
   * paste and the rest are missing for exactly the two states `editable` excludes.
   *
   * Duplicate and select-all always claim their key when they are offered, even with
   * nothing to act on: ⌘D on the canvas opening the browser's bookmark dialog, or ⌘A
   * selecting the page's text, would be a surprise nobody asked for.
   */
  useShortcuts({
    undo: editable ? undo : undefined,
    redo: editable ? redo : undefined,
    copy: comparing ? undefined : clipboard.copy,
    cut: editable ? clipboard.cut : undefined,
    duplicate: editable
      ? () => {
          clipboard.duplicate();
        }
      : undefined,
    selectAll: comparing ? undefined : selectAll,
    save: canEdit
      ? () => {
          if (busy === null && dirty && !comparing) void save();
        }
      : undefined,
    fit,
    search: editable ? focusPaletteSearch : undefined,
    help: () => setShortcutsOpen(true),
    toggleDisabled: editable ? toggleSelectionDisabled : undefined,
    addNote: editable ? addNote : undefined,
  });

  /** ⌘K on the canvas: its actions, then every node — *find a node* (`canvas-commands.ts`). */
  const canvasCommands = useMemo(
    () =>
      buildCanvasCommands({
        nodes,
        registry,
        platform,
        editable,
        comparing,
        actions: {
          undo,
          redo,
          arrange,
          fit,
          selectAll,
          shortcuts: () => setShortcutsOpen(true),
          find: findNode,
          addNote,
          // An editor, and not while two versions are compared — but while a proposal is open,
          // which is when a refinement is asked for (Phase 35).
          ...(canEdit && !comparison ? { copilot: openCopilot } : {}),
        },
      }),
    [
      addNote,
      arrange,
      canEdit,
      comparing,
      comparison,
      editable,
      findNode,
      fit,
      nodes,
      openCopilot,
      platform,
      redo,
      registry,
      selectAll,
      undo,
    ],
  );

  const noteControls = useMemo(
    (): NoteControls => ({
      editing: editingNote,
      setEditing: setEditingNote,
      change: changeNote,
      editable,
      withheld: NOTHING_WITHHELD,
    }),
    [changeNote, editable, editingNote],
  );

  /**
   * The steps a pressed copilot sentence cites — Phase 36 (D169). While the copilot holds the column:
   * once the inspector takes it back the sentence is gone, and a ring pointing at it would be
   * pointing at nothing. A closed drawer keeps it — on a phone, closing the drawer is how the ringed
   * step is seen at all.
   */
  const highlightedNodes = copilot.highlight?.nodes;
  const highlightShown = column === "copilot";
  const highlighted = useMemo(
    () => new Set(highlightShown ? (highlightedNodes ?? []) : []),
    [highlightShown, highlightedNodes],
  );
  useEffect(() => {
    if (highlighted.size === 0) return;
    // The camera moves only for a step out of sight: pressing sentence after sentence of a
    // workflow already on screen should ring steps, not zoom the canvas about (found in the walk).
    const frame = document.querySelector(".react-flow")?.getBoundingClientRect();
    const boxes = [...highlighted].map((id) =>
      document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`)?.getBoundingClientRect(),
    );
    if (allInFrame(boxes, frame)) return;
    // Into view, not into a close-up: the step among its neighbours is what a sentence describes.
    fitView({ nodes: [...highlighted].map((id) => ({ id })), padding: 0.6, maxZoom: 1, duration: tweenMs(300) });
  }, [fitView, highlighted]);

  const canvasValue = useMemo(
    () => ({
      registry,
      runStates,
      diffStates: diffView?.states ?? EMPTY_DIFF,
      entryOrder,
      noteDiffStates: diffView?.noteStates ?? EMPTY_NOTE_DIFF,
      notes: noteControls,
      highlighted,
    }),
    [diffView, entryOrder, highlighted, noteControls, registry, runStates],
  );

  /**
   * A run nothing has finished yet. `queued` counts: a durable run sits there until a
   * delivery claims it, and that is precisely the window in which Stop is most useful and
   * cheapest — nothing has executed, so cancelling costs nothing and undoes everything.
   */
  const inFlight = run !== null && (run.status === "queued" || run.status === "running");

  /**
   * Paused until its wake time (Phase 26). Not in flight — nothing is executing it, and the
   * Run button stays usable, because a workflow waiting two days must not lock its canvas —
   * but it can still be stopped, which is the moment a stop is most often wanted.
   */
  const waiting = run?.status === "waiting";

  const status = comparison
    ? `Comparing v${comparison.from} with v${comparison.to}`
    : proposal
      ? "Reviewing the copilot's proposal"
      : busy === "saving"
      ? "Saving…"
      : dirty
        ? "Unsaved changes"
        : saved.runnable
          ? `Saved · v${saved.version}`
          : `v${saved.version} · ${saved.problems.length} problem${saved.problems.length === 1 ? "" : "s"}`;

  /**
   * The same state in the width a phone can spare (Phase 28). The version button beside
   * the status already reads `vN`, so on a phone the status does not say it twice; and the
   * diff bar under the toolbar names both versions being compared. Measured at 375 px:
   * with these, the shorter padding below and the switch's gap, the toolbar is two rows
   * instead of three, and 104 px tall instead of 151.
   */
  const statusShort = comparison
    ? "Comparing"
    : proposal
      ? "Reviewing"
      : busy === "saving"
        ? "Saving…"
        : dirty
          ? "Unsaved"
          : saved.runnable
            ? "Saved"
            : `${saved.problems.length} problem${saved.problems.length === 1 ? "" : "s"}`;

  return (
    <CanvasContext value={canvasValue}>
      {/* Not an interactive element — a keyboard-shortcut scope wrapping the page, so
          there is no role that would describe it honestly. */}
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        className="flex h-dvh flex-col"
        // Escape closes whichever drawer is open. It is the expected key for a panel
        // over content, and the only way off the backdrop from a keyboard.
        onKeyDown={(event) => {
          if (event.key === "Escape") closePanels();
        }}
      >
        <header className="border-line bg-surface pad-safe flex shrink-0 flex-wrap items-center gap-x-2 gap-y-2 border-b-2 pb-2">
          {/* The canvas had no `h1` at all before Phase 16 — the workflow's name is an
              editable `<input>`, which is a control and not a heading, so the document
              outline started at the panels' `h2`s. This is the same defect Phase 15
              shipped on the 404 for one deploy, and it is invisible until the page is
              asked for its headings rather than looked at.

              Visually hidden because the name is already on screen as the field
              beside it; duplicating it would be noise for everyone who can see it and
              structure for everyone who cannot. It tracks `name`, so renaming the
              workflow renames the document. */}
          <h1 className="sr-only">{name}</h1>

          <Link href="/workflows" className="btn btn-ghost shrink-0 px-2">
            <span aria-hidden="true">←</span>
            <span className="max-sm:sr-only">Workflows</span>
          </Link>

          {canEdit ? (
            <input
              aria-label="Workflow name"
              value={name}
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
              className="field min-w-0 flex-1 basis-32 border-transparent bg-transparent font-bold shadow-none max-sm:basis-24"
            />
          ) : (
            // A text field nobody can type in is a lie about what it is, and a `readOnly`
            // input still takes a caret and still looks like the place to start. The name
            // is a heading to a viewer, so it is rendered as text — the `h1` above carries
            // it for assistive technology either way.
            <p className="min-w-0 flex-1 basis-32 truncate px-3 py-2 font-bold max-sm:basis-24">{name}</p>
          )}

          {/* Drawer toggles. Only below `lg`, where the panels are not columns — at
              `lg` and up each panel's own rail is the way back. */}
          <div className="flex shrink-0 items-center gap-1.5 lg:hidden">
            {canEdit && (
              <button
                type="button"
                aria-expanded={paletteOpen}
                aria-controls="node-palette"
                onClick={() => {
                  setPaletteOpen((open) => !open);
                  setInspectorOpen(false);
                }}
                className="btn btn-quiet px-2.5"
              >
                Nodes
              </button>
            )}
            <button
              type="button"
              aria-expanded={inspectorOpen && rightPanel === "inspector"}
              aria-controls={controls("inspector", column)}
              onClick={() => {
                // The drawer may be showing the copilot (Phase 35): Details always means the inspector.
                if (rightPanel === "copilot") {
                  setRightPanel("inspector");
                  setHighlight(null);
                  setInspectorOpen(true);
                } else setInspectorOpen((open) => !open);
                setPaletteOpen(false);
              }}
              className="btn btn-quiet px-2.5"
            >
              Details
            </button>
          </div>

          {/* `max-sm:flex-wrap` since Phase 26: the active switch made this row one control
              wider, and at 375px a row that cannot wrap clips its first item — the save
              status — off the left edge rather than moving it down a line.

              Phase 28 made it fit instead of wrap: below `sm` the status is its short form,
              the buttons' padding and the row's gap are tighter, and the name field's
              minimum is smaller so the first row holds at 320 px. Two rows at 375 px (was
              three), three at 320 (was four) — measured in a browser on the deployed canvas.
              The wrap stays as the fallback: a run in flight adds Stop and widens Run. */}
          <div className="flex min-w-0 items-center justify-end gap-2 max-sm:order-last max-sm:basis-full max-sm:flex-wrap max-sm:gap-1.5 sm:flex-1">
            {/* Both forms are in the live region, and only the visible one is in the
                accessibility tree — `hidden` is `display: none`. */}
            <span className="text-muted shrink-0 text-2xs" role="status">
              <span className="max-sm:hidden">{status}</span>
              <span className="sm:hidden">{statusShort}</span>
            </span>

            {/* The version number *is* the affordance. A button reading "v7" says both
                what this workflow is at and that there is something behind it, in the
                width a canvas toolbar can spare at 375px — where the word "History"
                would have to be the first thing dropped anyway. */}
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              aria-haspopup="dialog"
              className="btn btn-ghost shrink-0 px-2 font-mono"
            >
              <span aria-hidden="true">v{saved.version}</span>
              <span className="sr-only">Version history — currently version {saved.version}</span>
            </button>

            {/* **Read-only is stated, not merely enforced by absence** (Phase 20). A
                canvas with no Save and no Run looks broken unless something says why, and
                the word a viewer needs is the role they hold — that is what they would
                have to quote to ask for more. */}
            {!canEdit && (
              <span className="border-line bg-elevated text-muted shrink-0 rounded-lg border-2 px-2 py-1 text-2xs font-bold">
                Read only · {role}
              </span>
            )}

            {/* The active switch — Phase 26. Beside the read-only chip rather than with the
                run controls, because it is a standing property of the workflow, not an
                action taken now. A viewer sees the state as a chip and cannot change it. */}
            {automatic &&
              (canEdit ? (
                <Toggle
                  kind="switch"
                  // The word is the switch's accessible name at every width, and visible
                  // only from `sm` up: at 375px the toolbar's second row cannot spare it
                  // without pushing the save status off the edge (measured).
                  label={<span className="max-sm:sr-only">Active</span>}
                  checked={saved.active}
                  onChange={() => {
                    if (busy === null) void toggleActive();
                  }}
                  aria-busy={busy === "switching"}
                  // The label is visually hidden below `sm`, but its wrapper is still in
                  // the flow, so the gap would be 10 px of nothing beside the switch.
                  className="text-2xs shrink-0 max-sm:gap-0"
                />
              ) : (
                !saved.active && (
                  <span className="border-line bg-sunken text-muted shrink-0 rounded-lg border-2 px-2 py-1 text-2xs font-bold">
                    Switched off
                  </span>
                )
              ))}

            {(canShare || canSetVisibility) && (
              <button
                type="button"
                onClick={() => setShareOpen(true)}
                aria-haspopup="dialog"
                className="btn btn-quiet shrink-0 max-sm:px-2.5"
              >
                Share
                {/* The dot is the only place on the canvas that says a public link is
                    live. A workflow readable by anybody holding a URL must be visible as
                    such from the screen you edit it on, not only from inside a dialog. */}
                {saved.shareUrl && (
                  <span aria-hidden="true" className="bg-ink size-1.5 rounded-full" />
                )}
                {saved.shareUrl && <span className="sr-only">— a public link is live</span>}
              </button>
            )}

            {/* The copilot — Phase 35. An editor's, because what it does is change the workflow; it
                opens in the inspector's column (D161). Below `sm` the glyph alone, with the word
                for a screen reader: the phone toolbar is measured to the pixel (Phase 28). */}
            {canEdit && (
              <button
                type="button"
                onClick={openCopilot}
                aria-controls={controls("copilot", column)}
                className="btn btn-quiet shrink-0 max-sm:px-2.5"
              >
                <span aria-hidden="true">✦</span>
                <span className="max-sm:sr-only">Copilot</span>
              </button>
            )}

            {canEdit && (
              <button
                type="button"
                onClick={save}
                // Nothing on the canvas in diff mode belongs to the editing graph, so
                // there is nothing here that Save could honestly write.
                disabled={busy !== null || !dirty || comparing}
                className="btn btn-quiet shrink-0 max-sm:px-2.5"
              >
                Save
              </button>
            )}

            {/* Only while there is something to stop. A permanent, mostly-disabled Stop
                would sit in the tab order offering nothing for the whole time a person is
                building a workflow, which is almost all of the time. */}
            {(inFlight || waiting) && canEdit && (
              <button
                type="button"
                onClick={stopRun}
                aria-busy={busy === "stopping"}
                className="btn btn-danger shrink-0 max-sm:px-2.5"
              >
                {run?.cancelRequested ? "Stopping…" : "Stop"}
              </button>
            )}

            {/* Running needs `editor`, not `viewer`, because a run writes to the outside
                world — see the roles matrix in `CONTRACT.md`. */}
            {canEdit && (
            <button
              type="button"
              onClick={start}
              // `aria-busy`, never `disabled`: a disabled button can lose its
              // accessible name mid-announcement and drops out of the tab order
              // under the user's cursor (`DESIGN.md`).
              aria-busy={busy === "running"}
              disabled={busy === "saving" || comparing}
              // Not dimmed while running: the label on a fill stays at full strength (D126) —
              // the bobbing dots and the word already say it is busy. Phase 30.
              className="btn btn-primary shrink-0 max-sm:px-2.5"
            >
              {busy === "running" ? (
                <>
                  <span aria-hidden="true" className="flex items-end gap-0.5">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        style={{ animationDelay: `${i * 140}ms` }}
                        className="animate-think bg-accent-ink size-1 rounded-full"
                      />
                    ))}
                  </span>
                  Running
                </>
              ) : (
                "Run"
              )}
            </button>
            )}

            {/* The shell's palette, mounted here rather than stacking a second bar
                above a viewport-height graph. It is how the canvas reaches the rest
                of the product without spending vertical space on nav links. */}
            <CommandPalette className="max-md:hidden" commands={canvasCommands} />
          </div>
        </header>

        {/* The mode bar. Below the toolbar and above the canvas, so the thing it
            describes is directly under it and the toolbar keeps its position. */}
        {comparison && (
          <DiffBar
            heading={
              <>
                Comparing v{comparison.from} <span aria-hidden="true">→</span>
                <span className="sr-only">with</span> v{comparison.to}
              </>
            }
            summary={comparison.diff.summary}
          >
            <Button tone="ink" size="sm" onClick={stopComparing}>
              Back to editing
            </Button>
          </DiffBar>
        )}
        {/* A copilot proposal is the same mode, with the decision where the way out was (Phase
            35). The words the bar leads with say whose graph this is: not yours yet. */}
        {!comparison && proposal && (
          <DiffBar heading="The copilot's proposal — not applied yet" summary={proposal.diff.summary}>
            <Button size="sm" onClick={rejectProposal} disabled={copilotBusy}>
              Reject
            </Button>
            <Button tone="ink" size="sm" onClick={acceptProposal} disabled={copilotBusy}>
              Accept
            </Button>
          </DiffBar>
        )}

        <div className="relative flex min-h-0 flex-1">
          {/* Backdrop for the drawers. Not focusable — Escape and the panel's own
              close button are the keyboard paths, and a full-screen button in the tab
              order between the header and the canvas is worse than neither. */}
          {(paletteOpen || inspectorOpen) && (
            <div
              aria-hidden="true"
              onClick={closePanels}
              className="bg-scrim/25 animate-fade absolute inset-0 z-20 lg:hidden"
            />
          )}

          {/* No palette for a viewer: every control in it adds a node, and a 40px rail
              that opens onto a list of things you cannot use is worse than the space it
              costs. The inspector stays — reading a node's configuration is a read. */}
          {canEdit && (
          <Palette
            id="node-palette"
            nodes={palette}
            onAdd={addNode}
            disabled={busy !== null}
            open={paletteOpen}
            collapsed={paletteCollapsed}
            onClose={closePanels}
            onExpand={() => {
              setPaletteCollapsed(false);
              refit();
            }}
            onCollapse={() => {
              setPaletteCollapsed(true);
              refit();
            }}
            searchRef={paletteSearch}
          />
          )}

          <main id="main" ref={wrapper} className="min-w-0 flex-1">
            <ReactFlow
              // In diff mode the canvas renders the union of two versions instead of
              // the editing graph. Every handler below is withheld with it, and that
              // is the whole safety story: React Flow reports edits through
              // `onNodesChange`, so a diff that stayed interactive would feed nodes
              // from a graph nobody ever saved back into the editing state, and the
              // next Save would write a workflow assembled out of two others.
              nodes={diffView ? diffView.nodes : flowNodes}
              edges={diffView ? diffView.edges : displayEdges}
              nodeTypes={nodeTypes}
              //
              // **A viewer gets the same treatment diff mode gets, and for the same
              // reason** (Phase 20). React Flow reports every edit through
              // `onNodesChange`; a canvas that stayed draggable for somebody who cannot
              // save would let them rearrange a graph, watch it look edited, and lose the
              // lot on reload. `elementsSelectable` stays on either way — selecting a node
              // opens the inspector, which is how a viewer reads its configuration.
              //
              // **Except selection**, since Phase 29: a controlled React Flow reports a
              // click's selection through `onNodesChange` too, so withholding it from a
              // viewer meant no click ever selected anything. A viewer gets the select
              // and measure changes and nothing else (`readOnlyChanges`).
              onNodesChange={
                comparing ? undefined : canEdit ? handleNodesChange : handleReadOnlyNodesChange
              }
              onEdgesChange={
                comparing ? undefined : canEdit ? onEdgesChange : handleReadOnlyEdgesChange
              }
              onConnect={comparing || !canEdit ? undefined : onConnect}
              onSelectionChange={comparing ? undefined : onSelectionChange}
              nodesDraggable={!comparing && canEdit}
              nodesConnectable={!comparing && canEdit}
              elementsSelectable={!comparing}
              deleteKeyCode={comparing || !canEdit ? null : ["Delete", "Backspace"]}
              // Shift-click adds a node to the selection or takes it out (Phase 29), as
              // ⌘-click (Ctrl elsewhere) already did. Shift-*drag* is still the box:
              // React Flow starts a box only when the pointer moves.
              multiSelectionKeyCode={["Meta", "Control", "Shift"]}
              // The palette the reader's theme resolves to (Phase 28), never React
              // Flow's own `"system"`, which would follow the OS for a reader who
              // chose Light. Every variable `globals.css` sets wins in either mode;
              // what this decides is the fallback for any it does not — and a fallback
              // in the wrong mode is the trap `DESIGN.md` records from Phase 15.
              colorMode={theme}
              fitView
              // Low enough that a seven-node graph still fits a 375px screen; the
              // default floor of 0.5 cropped it and the graph's spine ran off-canvas.
              minZoom={0.15}
              fitViewOptions={FIT}
              proOptions={{ hideAttribution: false }}
            >
              <Background gap={20} />
              <Controls showInteractive={false}>
                <EditControls
                  editable={editable}
                  canUndo={history.canUndo}
                  canRedo={history.canRedo}
                  canArrange={nodes.length > 1}
                  platform={platform}
                  onUndo={undo}
                  onRedo={redo}
                  onArrange={arrange}
                  onAddNote={addNote}
                  onShortcuts={() => setShortcutsOpen(true)}
                />
              </Controls>
              {/* A minimap on a phone costs a quarter of the canvas and duplicates
                  what panning already gives. */}
              <MiniMap pannable zoomable className="max-sm:!hidden" />
            </ReactFlow>
          </main>

          {/* The right-hand column: the copilot or the inspector, never both (D161). The copilot is
              an editor's; a viewer's column is always the inspector. */}
          {column === "copilot" ? (
            <CopilotPanel
              id={COPILOT_PANEL}
              open={inspectorOpen}
              collapsed={inspectorCollapsed}
              onClose={closePanels}
              onExpand={() => {
                setInspectorCollapsed(false);
                refit();
              }}
              onCollapse={() => {
                setInspectorCollapsed(true);
                refit();
              }}
              onShowDetails={() => {
                setRightPanel("inspector");
                setHighlight(null);
              }}
              copilot={copilot}
              onAccept={acceptProposal}
              comparingVersions={comparison !== null}
              platform={platform}
              failedRun={run?.status === "failed" ? { id: run.id } : null}
              onFollowFix={(turnId, runId, next) => void followFix(turnId, runId, next)}
              nameOf={(nodeId) => names.get(nodeId) ?? nodeId}
            />
          ) : (
          <Inspector
            id={INSPECTOR_PANEL}
            open={inspectorOpen}
            collapsed={inspectorCollapsed}
            onClose={closePanels}
            onExpand={() => {
              setInspectorCollapsed(false);
              refit();
            }}
            onCollapse={() => {
              setInspectorCollapsed(true);
              refit();
            }}
            node={selected}
            definition={selected ? registry.get(selected.data.nodeType) : undefined}
            note={selectedNote}
            nodes={nodes}
            selection={selection}
            selectedNotes={selectedNotes}
            registry={registry}
            platform={platform}
            revision={history.revision}
            workflow={saved}
            dirty={dirty}
            problems={saved.problems}
            run={run}
            live={live}
            names={names}
            triggerInput={triggerInput}
            onChangeTriggerInput={setTriggerInput}
            queueing={busy === "queueing"}
            // A viewer can never run, so the durable-run button in the panel goes too —
            // `canRun` is the one flag it reads, so folding the role into it here keeps
            // the two paths to a run gated in one place rather than two.
            canRun={busy === null && !inFlight && !comparing && canEdit}
            // `admin`, like Share and for the same reason (Phase 20's rule): an editor may
            // change everything about this workflow, and may not invalidate a secret that
            // systems outside this product are calling.
            canRotateWebhook={canShare && !comparing}
            readOnly={!canEdit}
            onRotateWebhook={rotateWebhook}
            onWorkflowChanged={setSaved}
            onRunDurably={startDurable}
            onTest={(scope, nodeId) => void startTest(scope, nodeId)}
            onPin={pinOutput}
            onChangeNode={changeNode}
            onDeleteNode={deleteNode}
            onSelectNode={selectNode}
            onChangeNote={changeNote}
            onSetDisabled={setDisabled}
            onCopySelection={() => clipboard.copy()}
            onDuplicateSelection={() => clipboard.duplicate()}
            onMoveSelection={moveSelection}
            onDeleteSelection={() => removeNodes(selectedIds)}
            history={{
              workflowId: workflow.id,
              runs: recent,
              shownId: run?.id ?? null,
              opening: openingRun,
              onOpen: (runId) => void openRun(runId),
              past: showingPast ? { onClose: closePast } : null,
              // An editor, with nothing else starting or running — the same gate as Run (Phase 20).
              restart:
                canEdit && !comparing && !inFlight && (busy === null || busy === "restarting")
                  ? { onRestart: (kind) => void restart(kind), busy: busy === "restarting" }
                  : null,
              // Phase 36: an editor's, like the copilot itself. Waits while it is busy or has a
              // change open, as its own buttons do.
              diagnose: canEdit
                ? { onDiagnose: askWhy, disabled: copilotBusy || proposal !== null || comparing }
                : null,
              // Phase 38: a decision wakes the run through the queue; watch it come back. The stream
              // follows a waiting run whose wake time has just come (`engine/stream.ts` → `waking`).
              onDecided: () => watch(),
            }}
          />
          )}
        </div>
      </div>

      <History
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        workflow={saved}
        dirty={dirty}
        // Reading history is a read; naming a version and restoring one are writes the API
        // refuses below `editor`. Comparing stays available, which is the thing a viewer
        // opening this dialog actually came for.
        readOnly={!canEdit}
        onRestored={adoptRestored}
        onCompare={compare}
      />

      <TestConfirmDialog
        pending={pendingTest}
        onCancel={() => setPendingTest(null)}
        onConfirm={() => {
          const confirmed = pendingTest;
          setPendingTest(null);
          if (confirmed) void startTest(confirmed.scope, confirmed.nodeId, true);
        }}
      />

      <ShortcutsDialog
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        platform={platform}
      />

      <ShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        workflow={saved}
        canShare={canShare}
        canSetVisibility={canSetVisibility}
        onChanged={setSaved}
      />
    </CanvasContext>
  );
}
