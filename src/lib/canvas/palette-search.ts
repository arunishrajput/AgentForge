import { rankCommands, type Command } from "@/lib/ui/command";

import { categoryLook, categoryRank, type CategoryLook } from "./categories";
import type { NodeSummary } from "./client";

/**
 * Finding a node in the palette.
 *
 * `BUILD_PLAN.md` Phase 16 asks for "a palette that is browsable and searchable
 * rather than a long list", and the two halves are these two functions: grouping
 * is the browsing, ranking is the searching.
 *
 * The ranking is the **command palette's**, reused wholesale from
 * `src/lib/ui/command.ts`. Two search boxes in one product that disagree about
 * whether "gmail" should find "Send email" is a worse outcome than either ranking
 * being imperfect, and that module is already tested and already tuned. Nothing
 * here re-implements matching; it only decides what a node offers to be matched on.
 *
 * A node offers three things, at the ranking module's own discount:
 *
 *   its label        "Send email"          — full weight
 *   its description  the sentence          — half weight, as a subtitle
 *   its type         `integration.gmail`   — as a keyword, which is what lets
 *                    "gmail" reach a node whose label never says the word
 *
 * That last one is the point. The registry is the spine: no node type is named
 * anywhere in this file, so a node added in a later phase is searchable by its own
 * type string with no change here.
 */

export interface PaletteGroup {
  category: string;
  look: CategoryLook;
  nodes: NodeSummary[];
}

function asCommand(node: NodeSummary): Command {
  return {
    id: node.type,
    title: node.label,
    subtitle: node.description,
    keywords: [node.type, node.category],
  };
}

/**
 * Filter and rank against a query. An empty query returns the list untouched, in
 * the order given — the palette is a menu first and a search second.
 */
export function rankNodes(nodes: NodeSummary[], query: string): NodeSummary[] {
  if (query.trim() === "") return [...nodes];

  const byType = new Map(nodes.map((node) => [node.type, node]));
  return rankCommands(nodes.map(asCommand), query)
    .map((command) => byType.get(command.id))
    .filter((node): node is NodeSummary => node !== undefined);
}

/**
 * Group into categories for browsing, in reading order. A category with no nodes
 * in the given list does not appear — which is what makes this correct over a
 * *filtered* list as well as over the whole registry.
 */
export function groupNodes(nodes: NodeSummary[]): PaletteGroup[] {
  const groups = new Map<string, NodeSummary[]>();
  for (const node of nodes) {
    const existing = groups.get(node.category);
    if (existing) existing.push(node);
    else groups.set(node.category, [node]);
  }

  return [...groups.entries()]
    .map(([category, entries]) => ({
      category,
      look: categoryLook(category),
      nodes: entries,
    }))
    .sort(
      (a, b) =>
        categoryRank(a.category) - categoryRank(b.category) ||
        // Two unknown categories both rank Infinity, and Infinity - Infinity is
        // NaN, which `sort` treats as "leave them alone" — unstably, in principle.
        // Falling back to the name keeps the order defined.
        a.category.localeCompare(b.category),
    );
}
