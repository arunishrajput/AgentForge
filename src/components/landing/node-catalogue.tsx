import { describeNodes } from "@/lib/nodes";
import type { NodeCategory } from "@/lib/nodes/types";

/**
 * Every node the product actually has, **read from the registry at render time.**
 *
 * A hand-written feature list on a landing page is a promise that rots: Chapter 1
 * shipped four integration nodes in Phase 9, and a static list would have said three
 * for a fortnight. This reads `describeNodes()` — the same projection the canvas
 * palette and the agent's tool set are built from (ARCHITECTURE.md → "The node
 * registry is the spine") — so the page cannot claim a node that does not exist, or
 * miss one that does.
 *
 * It is a server component, so the registry never reaches the browser bundle.
 */

const GROUPS: { category: NodeCategory; title: string; fill: string; blurb: string }[] = [
  {
    category: "trigger",
    title: "Triggers",
    fill: "bg-cat-trigger-pop",
    blurb: "What starts a run.",
  },
  {
    category: "agent",
    title: "Models and agents",
    fill: "bg-cat-agent-pop",
    blurb: "Where the reasoning happens.",
  },
  { category: "logic", title: "Logic", fill: "bg-cat-logic-pop", blurb: "Flow, and control of it." },
  {
    category: "transform",
    title: "Data",
    fill: "bg-cat-transform-pop",
    blurb: "Shaping what moves between nodes.",
  },
  {
    category: "integration",
    title: "Integrations",
    fill: "bg-cat-integration-pop",
    blurb: "The outside world.",
  },
];

export function NodeCatalogue() {
  const nodes = describeNodes();

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {GROUPS.map((group) => {
        const members = nodes.filter((node) => node.category === group.category);
        if (members.length === 0) return null;

        return (
          <div key={group.category} className="card overflow-hidden">
            <div
              className={`border-line flex items-baseline justify-between gap-2 border-b-2 px-4 py-2.5 ${group.fill}`}
            >
              <h3 className="text-accent-ink text-ui font-bold">{group.title}</h3>
              <span className="text-accent-ink text-3xs font-bold">{members.length}</span>
            </div>
            <div className="space-y-2.5 px-4 py-3.5">
              <p className="text-muted text-2xs">{group.blurb}</p>
              <ul className="space-y-1.5">
                {members.map((node) => (
                  <li key={node.type} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-ui font-semibold">{node.label}</span>
                    <span className="text-faint font-mono text-3xs">{node.type}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The count, for a sentence that should never disagree with the list above it. */
export function nodeCount(): number {
  return describeNodes().length;
}

/** How many of those the agent may call — the security boundary, stated as a number. */
export function agentToolCount(): number {
  return describeNodes().filter((node) => node.agentCallable).length;
}
