import type { PaletteCommand } from "@/components/shell/command-palette";
import type { CanvasNode } from "@/lib/canvas/bridge";
import { categoryLook } from "@/lib/canvas/categories";
import type { NodeSummary } from "@/lib/canvas/client";
import { shortcutFor, type ShortcutAction } from "@/lib/canvas/shortcuts";
import { chordLabel, type Platform } from "@/lib/ui/keys";

/**
 * What the canvas adds to ⌘K — Phase 29: its own actions, then every node on it.
 *
 * The nodes are *find a node* (task 6). Each is a command ranked by the shared ranking
 * (`lib/ui/command.ts`, D72, D76) — the node's label as the title, its type and id as
 * keywords — so "gmail", "Send the summary" and "agent_2" all find it, the same way part
 * of a workflow's name finds a workflow. A second search box for nodes would be a second
 * ranking to disagree with the first.
 *
 * Pure, so it is tested: which commands a viewer, an editor and a comparison are offered
 * is exactly the kind of rule that drifts when a new one is added.
 */
export function buildCanvasCommands({
  nodes,
  registry,
  platform,
  editable,
  comparing,
  actions,
}: {
  nodes: readonly CanvasNode[];
  registry: Map<string, NodeSummary>;
  platform: Platform;
  /** An editor outside diff mode — the only state that may undo or arrange. */
  editable: boolean;
  /** Diff mode: two versions on screen and nothing selectable. */
  comparing: boolean;
  actions: {
    undo: () => void;
    redo: () => void;
    arrange: () => void;
    fit: () => void;
    selectAll: () => void;
    shortcuts: () => void;
    find: (id: string) => void;
  };
}): PaletteCommand[] {
  const hint = (action: ShortcutAction) => chordLabel(shortcutFor(action).chords[0], platform);
  const group = "This canvas";

  const canvas: PaletteCommand[] = [];
  if (editable) {
    canvas.push(
      { id: "canvas:undo", group, title: "Undo", hint: hint("undo"), keywords: ["revert", "back"], run: actions.undo },
      { id: "canvas:redo", group, title: "Redo", hint: hint("redo"), keywords: ["again", "forward"], run: actions.redo },
      {
        id: "canvas:arrange",
        group,
        title: "Auto-arrange",
        subtitle: "Lay the graph out left to right",
        keywords: ["tidy", "tidy up", "layout", "arrange", "clean up", "organise", "organize"],
        run: actions.arrange,
      },
    );
  }
  canvas.push({
    id: "canvas:fit",
    group,
    title: "Fit the workflow to the screen",
    hint: hint("fit"),
    keywords: ["zoom", "view", "centre", "center"],
    run: actions.fit,
  });
  if (!comparing) {
    canvas.push({
      id: "canvas:select-all",
      group,
      title: "Select every node",
      hint: hint("selectAll"),
      keywords: ["all", "selection"],
      run: actions.selectAll,
    });
  }
  canvas.push({
    id: "canvas:shortcuts",
    group,
    title: "Keyboard shortcuts",
    hint: hint("help"),
    keywords: ["keys", "hotkeys", "help", "keyboard"],
    run: actions.shortcuts,
  });

  // In diff mode the canvas shows two versions at once and nothing can be selected, so a
  // list of the editing graph's nodes would find things that are not what is on screen.
  if (comparing) return canvas;

  const found = nodes.map((node): PaletteCommand => {
    const definition = registry.get(node.data.nodeType);
    return {
      id: `node:${node.id}`,
      group: "Nodes on this canvas",
      title: node.data.label || definition?.label || node.data.nodeType,
      subtitle: `${categoryLook(definition?.category).noun} · ${node.data.nodeType}`,
      keywords: [node.id, node.data.nodeType, "find", "node"],
      hint: node.id,
      run: () => actions.find(node.id),
    };
  });

  return [...canvas, ...found];
}
