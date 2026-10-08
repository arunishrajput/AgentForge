import { z } from "zod";

import type { GraphProblem } from "@/lib/engine/validate";

import {
  GRAPH_VERSION,
  workflowGraphSchema,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowNote,
} from "./graph";

/**
 * **A workflow as a file — export, import and duplicate** (Phase 32, `CONTRACT.md` → *The
 * workflow export*, D146).
 *
 * An export is a JSON envelope with a format name and a format version, the way the canvas
 * clipboard is (D129): the format says what the file is, so anything else is recognised as
 * *not ours*, and the version lets a later AgentForge change the shape while this one refuses
 * what it cannot read rather than misreading it.
 *
 * **What travels is the workflow — its name, description and graph — and nothing about where it
 * lived.** No id, no owner, no workspace, no webhook or share token, no version history, no
 * visibility, no active switch, no tags and no stars: each is a fact about one workspace, and
 * every one of them is minted or chosen afresh by whatever imports the file. The envelope is
 * built field by field from an explicit list — `exportWorkflow` below — so a column added to the
 * workflow later cannot widen it by existing, which is the share link's allowlist rule (D98)
 * applied to a file.
 *
 * **Credentials are not in it, and cannot be**: a credential never lives in the graph. A node
 * resolves its credential by its kind, from the workspace that runs it, at run time — so an
 * imported Discord node posts with the *importing* workspace's Discord connection, and the file
 * carries only the node type that names the kind. A value somebody typed into a node's config —
 * a header, a URL — is part of the workflow and travels with it; `docs/api.md` says so.
 *
 * **Pinned outputs are left out unless asked for** (D146): a pin is test data captured from a
 * real run — somebody's inbox, an API's answer — and an export is a file people attach to issues
 * and commit to repositories. Notes and the off switch are part of the workflow and travel.
 *
 * Pure: no database and no registry, so it is tested without either. Whether every node type
 * exists here is the route's question (`validateGraph`), because only the server has the
 * registry.
 */

export const EXPORT_FORMAT = "agentforge/workflow";
export const EXPORT_VERSION = 1;

/** Larger than any legal export — the same ceiling as the clipboard (`lib/canvas/clipboard.ts`). */
export const IMPORT_MAX_BYTES = 2_000_000;

/** The workflow limits a name and a description already have (`createWorkflowSchema`). */
const NAME_MAX = 200;
const DESCRIPTION_MAX = 2000;

export interface WorkflowExport {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  /** When the file was made. Informational: an import does not read it. */
  exportedAt: string;
  workflow: {
    name: string;
    description: string | null;
    graph: WorkflowGraph;
  };
}

/** What an export is made from. A whole workflow row may be passed; only these are read. */
export interface ExportSource {
  name: string;
  description: string | null;
  graph: WorkflowGraph;
}

/** How many of a graph's nodes hold a pinned output — what the export dialog asks about. */
export function pinnedCount(graph: { nodes: readonly { pinned?: unknown }[] }): number {
  return graph.nodes.filter((node) => node.pinned !== undefined).length;
}

/**
 * Every node field the graph schema names, and only those. **Absent stays absent**: a key is
 * written only when the stored node has it, so an export imported again is `graphsEqual` to the
 * graph it came from — `null` and absent are different values to that comparison.
 */
function exportNode(node: WorkflowNode, includePinned: boolean): WorkflowNode {
  return {
    id: node.id,
    type: node.type,
    ...(node.label === undefined ? {} : { label: node.label }),
    position: { x: node.position.x, y: node.position.y },
    config: node.config,
    ...(node.policy === undefined ? {} : { policy: node.policy }),
    ...(node.disabled === undefined ? {} : { disabled: node.disabled }),
    ...(includePinned && node.pinned !== undefined ? { pinned: { output: node.pinned.output } } : {}),
  };
}

function exportEdge(edge: WorkflowEdge): WorkflowEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...(edge.sourceHandle === undefined ? {} : { sourceHandle: edge.sourceHandle }),
  };
}

function exportNote(note: WorkflowNote): WorkflowNote {
  return {
    id: note.id,
    position: { x: note.position.x, y: note.position.y },
    size: { width: note.size.width, height: note.size.height },
    text: note.text,
    tone: note.tone,
  };
}

export function exportWorkflow(
  source: ExportSource,
  options: { includePinned?: boolean; now?: Date } = {},
): WorkflowExport {
  const { graph } = source;
  const includePinned = options.includePinned ?? false;
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: (options.now ?? new Date()).toISOString(),
    workflow: {
      name: source.name,
      description: source.description,
      graph: {
        version: graph.version,
        nodes: graph.nodes.map((node) => exportNode(node, includePinned)),
        edges: graph.edges.map(exportEdge),
        ...(graph.notes === undefined ? {} : { notes: graph.notes.map(exportNote) }),
      },
    },
  };
}

/**
 * A file name for the download: the workflow's name as a slug, so "Triage inbound leads!"
 * becomes `triage-inbound-leads.agentforge.json`. Accents are folded rather than dropped, and a
 * name with nothing left — all emoji, say — falls back to `workflow`.
 */
export function exportFilename(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `${slug || "workflow"}.agentforge.json`;
}

/** A duplicate's name: the original's with " (copy)", trimmed so it still fits the column. */
export function copyName(name: string): string {
  const suffix = " (copy)";
  return `${name.slice(0, NAME_MAX - suffix.length).trimEnd()}${suffix}`;
}

/** A version label is at most 80 characters (`lib/workflow/versions.ts`). */
const LABEL_MAX = 80;

/**
 * Version 1 of a duplicate says where it came from — "Duplicated from v7 of “Weekly report”" —
 * which is the row somebody scrolling its history looks for, and a label exempts it from the
 * retention cap. The name is shortened to fit, never the version number.
 */
export function duplicateLabel(name: string, version: number): string {
  const head = `Duplicated from v${version} of “`;
  const room = LABEL_MAX - head.length - 1;
  const shown = name.length > room ? `${name.slice(0, room - 1).trimEnd()}…` : name;
  return `${head}${shown}”`;
}

export const IMPORT_LABEL = "Imported from a file";

/* ------------------------------- import ------------------------------- */

const importedWorkflowSchema = z.object({
  name: z.string().trim().min(1, "The workflow needs a name.").max(NAME_MAX),
  description: z.string().max(DESCRIPTION_MAX).nullish(),
  graph: workflowGraphSchema,
});

export type ImportedWorkflow = {
  name: string;
  description: string | null;
  graph: WorkflowGraph;
};

/**
 * Why a file was refused, before the registry is consulted. Each reason has its own message,
 * because "this is not ours", "this is ours but newer" and "this is ours and broken" ask the
 * person for three different things.
 */
export type ImportRefusal =
  | { reason: "not_an_export"; message: string }
  | { reason: "nodes_clipboard"; message: string }
  | { reason: "newer_version"; message: string; version: number }
  | { reason: "invalid"; message: string; issues: { path: string; message: string }[] };

export type ImportReading =
  | { ok: true; workflow: ImportedWorkflow }
  | { ok: false; refusal: ImportRefusal };

const NOT_AN_EXPORT =
  'This is not an AgentForge workflow export. An export is a JSON object whose "format" is "agentforge/workflow".';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A parsed JSON value to a workflow that can be created, or the reason it cannot. Never
 * throws: the value came from a file somebody picked.
 *
 * **The order is the point.** The format is read first, so a paste of something else is told it
 * is something else. The version is read *before* the shape, so a file from a newer AgentForge —
 * whose shape this one may not understand — is refused for being newer rather than for a
 * schema error it could not have avoided. Only then is the workflow parsed, with the graph's own
 * schema, so an imported graph meets exactly the rules a saved one does: the node, edge and note
 * limits, the pin caps, the note-id rule.
 */
export function readImport(value: unknown): ImportReading {
  if (!isRecord(value)) return { ok: false, refusal: { reason: "not_an_export", message: NOT_AN_EXPORT } };

  const format = value.format;
  if (format === "agentforge/nodes") {
    return {
      ok: false,
      refusal: {
        reason: "nodes_clipboard",
        message:
          "This is a copy of nodes from a canvas, not a workflow export. Open a workflow and paste it onto the canvas instead.",
      },
    };
  }
  if (format !== EXPORT_FORMAT) {
    return { ok: false, refusal: { reason: "not_an_export", message: NOT_AN_EXPORT } };
  }

  const version = value.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return {
      ok: false,
      refusal: {
        reason: "invalid",
        message: "This export has no readable format version.",
        issues: [{ path: "version", message: "Expected a whole number of 1 or more." }],
      },
    };
  }
  if (version > EXPORT_VERSION) {
    return {
      ok: false,
      refusal: {
        reason: "newer_version",
        version,
        message: `This file is export format version ${version}, and this AgentForge reads version ${EXPORT_VERSION}. It was made by a newer AgentForge; nothing was imported.`,
      },
    };
  }

  // The graph has a version of its own (`GRAPH_VERSION`), read for the same reason and in the
  // same order: a newer graph is refused as newer, not as malformed.
  const graphVersion = isRecord(value.workflow) && isRecord(value.workflow.graph)
    ? value.workflow.graph.version
    : undefined;
  if (typeof graphVersion === "number" && graphVersion > GRAPH_VERSION) {
    return {
      ok: false,
      refusal: {
        reason: "newer_version",
        version: graphVersion,
        message: `This workflow's graph is version ${graphVersion}, and this AgentForge reads graph version ${GRAPH_VERSION}. It was made by a newer AgentForge; nothing was imported.`,
      },
    };
  }

  const parsed = importedWorkflowSchema.safeParse(value.workflow);
  if (!parsed.success) {
    return {
      ok: false,
      refusal: {
        reason: "invalid",
        message: "This is an AgentForge export, but the workflow in it does not fit the shape a workflow must have.",
        issues: parsed.error.issues.slice(0, 20).map((issue) => ({
          path: ["workflow", ...issue.path].join("."),
          message: issue.message,
        })),
      },
    };
  }

  return {
    ok: true,
    workflow: {
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      graph: parsed.data.graph,
    },
  };
}

/**
 * The node types a graph uses that this AgentForge does not have, in the order they first
 * appear — read off `validateGraph`'s `unknown_node_type` problems, so "unknown" means exactly
 * what it means to the engine.
 */
export function unknownNodeTypes(
  graph: { nodes: readonly { id: string; type: string }[] },
  problems: readonly GraphProblem[],
): string[] {
  const ids = new Set(
    problems.filter((problem) => problem.code === "unknown_node_type").map((problem) => problem.nodeId),
  );
  const types: string[] = [];
  for (const node of graph.nodes) {
    if (ids.has(node.id) && !types.includes(node.type)) types.push(node.type);
  }
  return types;
}

/**
 * **Named, never dropped** (D39's honesty, applied to a file). An import that quietly left out
 * the nodes it could not build would hand back a workflow that runs and does less than the one
 * exported — the worst kind of wrong, because nothing says so. So the file is refused whole,
 * and the refusal says which types are missing.
 */
export function unknownTypesMessage(types: readonly string[]): string {
  const listed = types.map((type) => `“${type}”`).join(", ");
  return types.length === 1
    ? `This workflow uses a node type this AgentForge does not have: ${listed}. Nothing was imported.`
    : `This workflow uses ${types.length} node types this AgentForge does not have: ${listed}. Nothing was imported.`;
}
