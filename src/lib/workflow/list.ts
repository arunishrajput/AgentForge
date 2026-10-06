/**
 * The workflow list's view model: the projection a card renders from, and the
 * search, filter and sort that sit above it.
 *
 * Kept as plain functions in a module of its own, for two reasons. The list is a
 * client component — a user types into the search box and expects the list to
 * answer that keystroke, not a round trip — so this code ships to the browser, and
 * **it must therefore import nothing from the node registry**: pulling
 * `@/lib/nodes` in would drag the Gmail, Sheets and Discord clients into the page
 * bundle to render a label. `toWorkflowCard` takes a lookup function instead, which
 * the server page supplies from the registry it has already loaded.
 *
 * The second reason is that this is the part worth testing. A card is data, a
 * filter is a predicate, and a sort is a comparator; none of the three needs a
 * browser to prove, and all three are what breaks when a later phase adds a
 * trigger kind.
 */

/** The three ways a run can start today — CONTRACT.md → "Trigger shapes". */
export type TriggerKind = "manual" | "webhook" | "schedule";

const TRIGGER_TYPES: Record<string, TriggerKind> = {
  "core.manual_trigger": "manual",
  "core.webhook_trigger": "webhook",
  "core.schedule_trigger": "schedule",
};

export type WorkflowCard = {
  id: string;
  name: string;
  description: string | null;
  nodeCount: number;
  /** Registry labels, deduped and in graph order. Search matches these too. */
  nodeLabels: string[];
  /**
   * The node types, deduped. Searched as well as the labels, because the word a
   * user types is often the vendor's — "gmail" finds a workflow whose node is
   * labelled "Send email", and nothing else on the card carries that word.
   */
  nodeTypes: string[];
  /** Registry categories present in the graph, for the card's colour strip. */
  categories: string[];
  triggers: TriggerKind[];
  runnable: boolean;
  problemCount: number;
  scheduleCron: string | null;
  /**
   * Phase 20. `private` means only its creator and the workspace's admins can open it;
   * `workspace` is the default and means everybody in the workspace. A card is only ever
   * built for a workflow the reader may already see, so this is a *label* rather than a
   * filter — the filtering happened in SQL (`lib/workflow/visibility.ts`).
   */
  visibility: string;
  /** A public link is live on this workflow. Not the link itself — a card does not need it. */
  shared: boolean;
  /**
   * Phase 26. False means its webhook refuses and its schedule does not fire. Shown on the
   * card only when the workflow has a trigger that runs by itself — a manual workflow has
   * nothing to be switched off.
   */
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

/** What a card needs to know about a node type, without importing the registry. */
export type NodeLookup = (type: string) => { label: string; category: string } | undefined;

/** The shape `describeWorkflow` returns, narrowed to what a card actually reads. */
type DescribedWorkflow = {
  id: string;
  name: string;
  description: string | null;
  graph: { nodes: { type: string }[] };
  runnable: boolean;
  problems: unknown[];
  scheduleCron: string | null;
  visibility: string;
  shareUrl: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export function toWorkflowCard(workflow: DescribedWorkflow, lookup: NodeLookup): WorkflowCard {
  const labels: string[] = [];
  const types: string[] = [];
  const categories: string[] = [];
  const triggers: TriggerKind[] = [];

  for (const node of workflow.graph.nodes) {
    if (!types.includes(node.type)) types.push(node.type);

    const known = lookup(node.type);
    // An unknown type is rendered as its raw type rather than dropped. A graph can
    // outlive a node being renamed, and a card that silently omits a node it cannot
    // name would under-report the size of the workflow.
    const label = known?.label ?? node.type;
    if (!labels.includes(label)) labels.push(label);

    const category = known?.category;
    if (category && !categories.includes(category)) categories.push(category);

    const trigger = TRIGGER_TYPES[node.type];
    if (trigger && !triggers.includes(trigger)) triggers.push(trigger);
  }

  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    nodeCount: workflow.graph.nodes.length,
    nodeLabels: labels,
    nodeTypes: types,
    categories,
    triggers,
    runnable: workflow.runnable,
    problemCount: workflow.problems.length,
    scheduleCron: workflow.scheduleCron,
    visibility: workflow.visibility,
    // A boolean rather than the URL: the list is a client component, so anything put on a
    // card ships to the browser, and the card has no use for the link. The dialog on the
    // canvas is where a share URL belongs.
    shared: workflow.shareUrl !== null,
    active: workflow.active,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
  };
}

export type SortKey = "recent" | "created" | "name";
export type StatusKey = "all" | "runnable" | "problems";
export type TriggerKey = "all" | TriggerKind;

export type ListView = {
  query: string;
  status: StatusKey;
  trigger: TriggerKey;
  sort: SortKey;
};

export const DEFAULT_VIEW: ListView = {
  query: "",
  status: "all",
  trigger: "all",
  sort: "recent",
};

/**
 * Search runs over the name, the description **and the nodes** — both their labels
 * and their types. "discord" finds the workflow that posts to Discord even though
 * the word appears nowhere in its title, and "gmail" finds the one with a
 * `integration.gmail` node even though that node is labelled "Send email". That is
 * the search a user of an automation tool actually wants, and it costs nothing here
 * because both are already on the card.
 */
export function matchesQuery(card: WorkflowCard, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;

  // Every term must match something. Two words narrow rather than widen, which is
  // what typing a second word is for.
  return needle.split(/\s+/).every((term) => {
    if (card.name.toLowerCase().includes(term)) return true;
    if (card.description?.toLowerCase().includes(term)) return true;
    if (card.nodeLabels.some((label) => label.toLowerCase().includes(term))) return true;
    return card.nodeTypes.some((type) => type.toLowerCase().includes(term));
  });
}

function matchesStatus(card: WorkflowCard, status: StatusKey): boolean {
  if (status === "runnable") return card.runnable;
  if (status === "problems") return !card.runnable;
  return true;
}

function matchesTrigger(card: WorkflowCard, trigger: TriggerKey): boolean {
  return trigger === "all" || card.triggers.includes(trigger);
}

const SORTS: Record<SortKey, (a: WorkflowCard, b: WorkflowCard) => number> = {
  recent: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
  created: (a, b) => b.createdAt.localeCompare(a.createdAt),
  // `numeric` so "Report 2" sorts before "Report 10", and `sensitivity: base` so
  // case and accents do not split two names a user reads as the same word.
  name: (a, b) => a.name.localeCompare(b.name, "en", { numeric: true, sensitivity: "base" }),
};

/** Filter then sort, without mutating the input. */
export function viewWorkflows(cards: WorkflowCard[], view: ListView): WorkflowCard[] {
  return cards
    .filter(
      (card) =>
        matchesQuery(card, view.query) &&
        matchesStatus(card, view.status) &&
        matchesTrigger(card, view.trigger),
    )
    .toSorted(SORTS[view.sort]);
}

/** The counts the filter chips print beside their labels. */
export function countWorkflows(cards: WorkflowCard[]) {
  return {
    total: cards.length,
    runnable: cards.filter((card) => card.runnable).length,
    problems: cards.filter((card) => !card.runnable).length,
    manual: cards.filter((card) => card.triggers.includes("manual")).length,
    webhook: cards.filter((card) => card.triggers.includes("webhook")).length,
    schedule: cards.filter((card) => card.triggers.includes("schedule")).length,
  };
}

/** True when a view is showing everything it could — what the empty state turns on. */
export function isDefaultView(view: ListView): boolean {
  return (
    view.query.trim().length === 0 && view.status === "all" && view.trigger === "all"
  );
}
