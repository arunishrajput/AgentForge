/**
 * What a node category looks like: its heading in the palette, its word on a node
 * card, and the two colour registers it may use.
 *
 * Every class here is a **literal** string. A token built by concatenation —
 * `` `bg-cat-${category}-pop` `` — compiles to nothing, because Tailwind's scanner
 * reads source text and never runs it. That failure is silent: the strip renders
 * with no fill and looks merely plain.
 *
 * The two registers are `DESIGN.md`'s central rule. `fill` is a `-pop` token and is
 * only ever a background, always under an ink label and inside an ink outline;
 * `dot` is the text-register token and is the one safe as a small graphic. Nothing
 * here may use `fill` as a text colour.
 *
 * Trigger, logic and integration deliberately share a hue with ok, live and warn.
 * A trigger is the "go" of a graph, and one hue meaning one thing is worth more
 * than five more colours — the distinction is carried by the icon and the word.
 */

export interface CategoryLook {
  /** Plural. The palette groups by it. */
  label: string;
  /** Singular. One node card wears it. */
  noun: string;
  /** `-pop` register: a background only, ink label, inside the card's outline. */
  fill: string;
  /** Text register: safe as a small graphic — the palette's dot. */
  dot: string;
  ring: string;
}

export const CATEGORY: Record<string, CategoryLook> = {
  trigger: {
    label: "Triggers",
    noun: "Trigger",
    fill: "bg-cat-trigger-pop",
    dot: "bg-cat-trigger",
    ring: "ring-cat-trigger",
  },
  agent: {
    label: "Agents",
    noun: "Agent",
    fill: "bg-cat-agent-pop",
    dot: "bg-cat-agent",
    ring: "ring-cat-agent",
  },
  logic: {
    label: "Logic",
    noun: "Logic",
    fill: "bg-cat-logic-pop",
    dot: "bg-cat-logic",
    ring: "ring-cat-logic",
  },
  transform: {
    label: "Transform",
    noun: "Transform",
    fill: "bg-cat-transform-pop",
    dot: "bg-cat-transform",
    ring: "ring-cat-transform",
  },
  integration: {
    label: "Integrations",
    noun: "Integration",
    fill: "bg-cat-integration-pop",
    dot: "bg-cat-integration",
    ring: "ring-cat-integration",
  },
};

/** Reading order in the palette: what starts a graph, then what thinks, then the rest. */
export const CATEGORY_ORDER = ["trigger", "agent", "logic", "transform", "integration"];

/**
 * A node whose type is not in the registry at all. Red, because it is the one case
 * that must look wrong — the workflow cannot run until it is removed.
 */
export const UNKNOWN_CATEGORY: CategoryLook = {
  label: "Unknown",
  noun: "Unknown",
  fill: "bg-bad-pop",
  dot: "bg-bad",
  ring: "ring-bad",
};

export function categoryLook(category: string | undefined): CategoryLook {
  return (category === undefined ? undefined : CATEGORY[category]) ?? UNKNOWN_CATEGORY;
}

/**
 * Sort key for a category name.
 *
 * `Infinity` for one this file has never heard of, **not** `indexOf`'s -1. A new
 * category added to the registry in a later phase would otherwise sort ahead of
 * the triggers, putting an unrecognised group at the top of the palette — which is
 * precisely backwards, and is what the Chapter 1 palette did.
 */
export function categoryRank(category: string): number {
  const at = CATEGORY_ORDER.indexOf(category);
  return at === -1 ? Number.POSITIVE_INFINITY : at;
}
