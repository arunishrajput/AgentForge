import { valuesEqual, type WorkflowGraph } from "@/lib/workflow/graph";

/**
 * Undo and redo for the canvas — `BUILD_PLAN.md` Phase 29, task 1.
 *
 * **A history entry is a graph, never a React Flow state** (D22). `fromFlow` is a clean
 * inverse of `toFlow`, so the stored shape is the whole of what an edit can change, and
 * nothing React Flow hangs on a node — `selected`, `measured`, `dragging` — can be undone
 * into existence or out of it. Selecting a node is not an edit.
 *
 * The module is pure and holds no clock: the editor observes each structural change of
 * its graph and calls `record` with the graph as it was *before*, a coalescing key, and
 * the time. Everything that decides what one "step" of undo is lives here, with tests,
 * because that judgement is the part of undo that can actually be wrong.
 *
 * **Coalescing.** Undo that rewinds one pixel of a drag, or one keystroke of a label, is
 * a history nobody can use. Consecutive changes that share a key fold into the entry
 * the first one made, so that entry keeps the graph from before the whole run of them:
 *
 *   `gesture:<n>`        one drag, from pointer-down to pointer-up, however long it
 *                        lasts. Every drag gets a fresh `n`, so two drags of the same
 *                        node are two steps
 *   `config:<id>:<key>`  one field of one node's configuration — typing a subject line
 *   `label:<id>`         one node's label
 *   `policy:<id>`        one node's retry and timeout
 *   `note:<id>`          one sticky note's text (Phase 30) — typing in it
 *   `move:<ids>`         the same nodes and notes nudged with the arrow keys
 *   `null`               never coalesces: an add, a delete, a paste, a connection, a node
 *                        switched off or on, a note's tone
 *
 * A keyed run outside a gesture also breaks after `COALESCE_MS` of quiet, so typing a
 * value, pausing, and typing more is two steps — the way a text editor groups typing.
 */

/** Entries kept. A graph is at most 100 nodes, so this is a few megabytes at worst. */
export const HISTORY_LIMIT = 100;

/** Quiet that ends a run of keyed edits, except inside a gesture. */
export const COALESCE_MS = 1500;

const GESTURE = "gesture:";

/** The coalescing key for the `n`th pointer gesture since the canvas loaded. */
export function gestureKey(n: number): string {
  return `${GESTURE}${n}`;
}

export interface History {
  /** Oldest first. The last entry is what Undo returns to. */
  readonly past: readonly WorkflowGraph[];
  /** Most recently undone last. The last entry is what Redo returns to. */
  readonly future: readonly WorkflowGraph[];
  /** The key of the change that made the newest entry — `null` once anything breaks the run. */
  readonly lastKey: string | null;
  readonly lastAt: number;
}

export function emptyHistory(): History {
  return { past: [], future: [], lastKey: null, lastAt: 0 };
}

/**
 * One structural change, observed. `before` is the graph as it stood before the change;
 * the change itself is already on the canvas.
 *
 * Any new edit discards the redo stack: redoing a step that was undone and then edited
 * around would apply it to a graph it was never made against.
 */
export function record(
  history: History,
  before: WorkflowGraph,
  key: string | null,
  now: number,
): History {
  const coalesce =
    key !== null &&
    key === history.lastKey &&
    history.past.length > 0 &&
    (key.startsWith(GESTURE) || now - history.lastAt <= COALESCE_MS);

  if (coalesce) return { ...history, future: [], lastAt: now };

  return {
    past: [...history.past, before].slice(-HISTORY_LIMIT),
    future: [],
    lastKey: key,
    lastAt: now,
  };
}

/**
 * Step back. `current` is the graph on the canvas now, which becomes what Redo returns
 * to. Returns `null` when there is nothing to undo.
 *
 * The run is broken (`lastKey: null`), so the next keystroke after an undo starts its
 * own entry rather than folding into one that has just been popped.
 */
export function undo(
  history: History,
  current: WorkflowGraph,
): { history: History; graph: WorkflowGraph } | null {
  const graph = history.past.at(-1);
  if (graph === undefined) return null;
  return {
    graph,
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, current],
      lastKey: null,
      lastAt: 0,
    },
  };
}

/** Step forward again. The mirror of `undo`. */
export function redo(
  history: History,
  current: WorkflowGraph,
): { history: History; graph: WorkflowGraph } | null {
  const graph = history.future.at(-1);
  if (graph === undefined) return null;
  return {
    graph,
    history: {
      past: [...history.past, current].slice(-HISTORY_LIMIT),
      future: history.future.slice(0, -1),
      lastKey: null,
      lastAt: 0,
    },
  };
}

/**
 * The coalescing key for a change the editor did not label itself — what an edit in the
 * inspector or an arrow-key nudge looks like from the graph alone.
 *
 * Deliberately narrow. Only a change that is unmistakably "the same edit, continued"
 * gets a key: one field of one node, or a move of the same set of nodes. Anything that
 * adds, removes, reorders or reconnects is `null`, and so is an edit touching two
 * things at once — guessing that two changes belong together is how undo loses work.
 */
export function changeKey(before: WorkflowGraph, after: WorkflowGraph): string | null {
  if (before.nodes.length !== after.nodes.length) return null;
  if (!valuesEqual(before.edges, after.edges)) return null;

  const beforeNotes = before.notes ?? [];
  const afterNotes = after.notes ?? [];
  if (beforeNotes.length !== afterNotes.length) return null;

  const moved: string[] = [];
  const edits: string[] = [];

  for (let index = 0; index < before.nodes.length; index += 1) {
    const a = before.nodes[index];
    const b = after.nodes[index];
    if (a.id !== b.id || a.type !== b.type) return null;
    // Switching a node off or on is a click, and each click is a step of its own.
    if (Boolean(a.disabled) !== Boolean(b.disabled)) return null;

    if (a.position.x !== b.position.x || a.position.y !== b.position.y) moved.push(a.id);

    if (a.label !== b.label) edits.push(`label:${a.id}`);
    if (!valuesEqual(a.policy, b.policy)) edits.push(`policy:${a.id}`);

    if (!valuesEqual(a.config, b.config)) {
      const keys = new Set([...Object.keys(a.config), ...Object.keys(b.config)]);
      const changed = [...keys].filter((key) => !valuesEqual(a.config[key], b.config[key]));
      if (changed.length !== 1) return null;
      edits.push(`config:${a.id}:${changed[0]}`);
    }
  }

  // Notes (Phase 30). Typing in one is a field like any other; its tone is a click, and a
  // resize arrives inside a pointer gesture, so either seen out here is a step of its own.
  for (let index = 0; index < beforeNotes.length; index += 1) {
    const a = beforeNotes[index];
    const b = afterNotes[index];
    if (a.id !== b.id || a.tone !== b.tone || !valuesEqual(a.size, b.size)) return null;
    if (a.position.x !== b.position.x || a.position.y !== b.position.y) moved.push(a.id);
    if (a.text !== b.text) edits.push(`note:${a.id}`);
  }

  if (edits.length === 0 && moved.length > 0) return `move:${moved.sort().join(",")}`;
  if (edits.length === 1 && moved.length === 0) return edits[0];
  return null;
}
