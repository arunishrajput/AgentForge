import type { NodeSummary } from "@/lib/nodes";
import type { GraphDiff, NodeDiff } from "@/lib/workflow/diff";
import { valuesEqual, type WorkflowNode } from "@/lib/workflow/graph";

import { fieldWords } from "./changes";

/**
 * **A copilot proposal, in words — Phase 35.** The canvas shows *which* nodes a proposal touches —
 * ribbons, Phase 18's diff mode — but a ribbon reading "Changed: configuration" does not say what
 * Accept would do. "Post to Slack — text: Urgent: {{…}}" does, and so does an agent's `tools`
 * going from nothing to `integration.slack`: least privilege (D160) is only worth something if the
 * person can see what an accepted agent may call. So the panel lists every change with the values
 * it sets, and this is the pure, tested half of that list.
 */

export type ChangeKind = "added" | "removed" | "changed" | "connected" | "disconnected";

export interface ChangeDetail {
  /** A config key, or `name` / `node type` for those fields. */
  key: string;
  /** Absent for a value that is new. */
  before?: string;
  /** Absent for a value that was removed. */
  after?: string;
}

export interface ChangeLine {
  /** Unique within one proposal: the node's id, or what a connection joins. */
  key: string;
  kind: ChangeKind;
  /** The node's name as the canvas shows it, or `From → To` for a connection. */
  subject: string;
  /** What kind of node, for an added or removed one — "Slack". */
  what?: string;
  /** For a changed node, its changed fields in words — "configuration and name". */
  summary?: string;
  details: ChangeDetail[];
}

/** Long enough to read a message template; short enough that a prompt does not fill the panel. */
export const VALUE_MAX = 90;

/** A config value as one readable line. */
export function showValue(value: unknown): string {
  let text: string;
  if (typeof value === "string") text = value === "" ? "(empty)" : value;
  else if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    text = value.length === 0 ? "(none)" : value.join(", ");
  } else text = JSON.stringify(value) ?? String(value);
  return text.length > VALUE_MAX ? `${text.slice(0, VALUE_MAX - 1)}…` : text;
}

function nameOf(node: WorkflowNode, registry: ReadonlyMap<string, NodeSummary>): string {
  return node.label || registry.get(node.type)?.label || node.type;
}

function configDetails(before: Record<string, unknown>, after: Record<string, unknown>): ChangeDetail[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys
    .filter((key) => !valuesEqual(before[key], after[key]))
    .map((key) => {
      const detail: ChangeDetail = { key };
      if (key in before) detail.before = showValue(before[key]);
      if (key in after) detail.after = showValue(after[key]);
      return detail;
    });
}

function nodeLine(entry: NodeDiff, registry: ReadonlyMap<string, NodeSummary>): ChangeLine | null {
  const { node } = entry;
  const what = registry.get(node.type)?.label ?? node.type;
  switch (entry.change) {
    case "added":
      return {
        key: `node:${node.id}`,
        kind: "added",
        subject: nameOf(node, registry),
        what,
        details: Object.entries(node.config ?? {}).map(([key, value]) => ({ key, after: showValue(value) })),
      };
    case "removed":
      return { key: `node:${node.id}`, kind: "removed", subject: nameOf(node, registry), what, details: [] };
    case "changed": {
      const before = entry.before ?? node;
      const details: ChangeDetail[] = [];
      if (entry.fields.includes("label")) {
        details.push({ key: "name", before: nameOf(before, registry), after: nameOf(node, registry) });
      }
      if (entry.fields.includes("type")) {
        details.push({
          key: "node type",
          before: registry.get(before.type)?.label ?? before.type,
          after: what,
        });
      }
      if (entry.fields.includes("config")) details.push(...configDetails(before.config ?? {}, node.config ?? {}));
      return {
        key: `node:${node.id}`,
        kind: "changed",
        // Named as it was: "Summarise it" renamed to "Shorten it" is found on the canvas by the old name.
        subject: nameOf(before, registry),
        summary: fieldWords(entry.fields, Boolean(node.disabled)),
        details,
      };
    }
    case "moved":
    case "unchanged":
      // A proposal never moves an existing node (`assembleEdit` keeps positions), and an unchanged
      // node is not a change. Neither is worth a line.
      return null;
  }
}

/**
 * Every change a proposal makes, in the order a person reads a workflow: nodes as the proposed
 * graph orders them, removed ones after, then the connections.
 */
export function describeProposal(diff: GraphDiff, registry: ReadonlyMap<string, NodeSummary>): ChangeLine[] {
  const lines = diff.nodes
    .map((entry) => nodeLine(entry, registry))
    .filter((line): line is ChangeLine => line !== null);

  const names = new Map(diff.nodes.map((entry) => [entry.id, nameOf(entry.node, registry)]));
  for (const edge of diff.edges) {
    if (edge.change === "unchanged") continue;
    const handle = edge.sourceHandle === null ? "" : ` (${edge.sourceHandle})`;
    lines.push({
      key: `${edge.change}:${JSON.stringify([edge.source, edge.sourceHandle, edge.target])}`,
      kind: edge.change === "added" ? "connected" : "disconnected",
      subject: `${names.get(edge.source) ?? edge.source}${handle} → ${names.get(edge.target) ?? edge.target}`,
      details: [],
    });
  }
  return lines;
}
