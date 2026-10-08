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

import { findTag, sameTagName, sortTags, type TagSummary } from "./tags";

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
  /** Phase 32. The tags it wears, by name. Searched as well, and the tag filter reads them. */
  tags: TagSummary[];
  /** Phase 32. Whether the person reading the list has starred it — theirs, nobody else's. */
  starred: boolean;
  /**
   * Phase 32. How many of its nodes hold a pinned output — so *Export* can ask whether to
   * include them (D146) without the card carrying the graph.
   */
  pinnedCount: number;
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
  graph: { nodes: { type: string; pinned?: unknown }[] };
  runnable: boolean;
  problems: unknown[];
  scheduleCron: string | null;
  visibility: string;
  shareUrl: string | null;
  active: boolean;
  tags: TagSummary[];
  starred: boolean;
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
    tags: sortTags(workflow.tags),
    starred: workflow.starred,
    pinnedCount: workflow.graph.nodes.filter((node) => node.pinned !== undefined).length,
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
  /**
   * Phase 32. A tag's **name**, or null for any tag. A name rather than an id so a pasted URL
   * reads as what it is — `?tag=billing` — at the price that renaming a tag retires links to
   * the old name, which the list then says rather than showing an unexplained empty page.
   */
  tag: string | null;
  /** Phase 32. Only the reader's starred workflows. */
  starred: boolean;
  sort: SortKey;
};

export const DEFAULT_VIEW: ListView = {
  query: "",
  status: "all",
  trigger: "all",
  tag: null,
  starred: false,
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
    if (card.tags.some((tag) => tag.name.toLowerCase().includes(term))) return true;
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

/** Case-insensitive, like the database's unique index — `?tag=Billing` finds "billing". */
function matchesTag(card: WorkflowCard, tag: string | null): boolean {
  return tag === null || card.tags.some((worn) => sameTagName(worn.name, tag));
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
        matchesTrigger(card, view.trigger) &&
        matchesTag(card, view.tag) &&
        (!view.starred || card.starred),
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
    starred: cards.filter((card) => card.starred).length,
  };
}

/**
 * How many of the cards wear each tag, by tag id — the counts the tag filter prints. Counted
 * over the cards this reader can see, so a tag used only on a colleague's private workflow
 * reads 0 here: the list never knows about a workflow it was not sent (D101).
 */
export function countTags(cards: WorkflowCard[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const card of cards) {
    for (const tag of card.tags) counts.set(tag.id, (counts.get(tag.id) ?? 0) + 1);
  }
  return counts;
}

/** True when a view is showing everything it could — what the empty state turns on. */
export function isDefaultView(view: ListView): boolean {
  return (
    view.query.trim().length === 0 &&
    view.status === "all" &&
    view.trigger === "all" &&
    view.tag === null &&
    !view.starred
  );
}

/**
 * **The view, in the URL — Phase 32.** `/workflows?tag=billing&starred=1&sort=name` is a list a
 * person can paste to a colleague and get back after a reload. Each part has a short key, and
 * a part at its default is left out, so the plain list is the plain URL.
 *
 *   q        the search text
 *   status   `runnable` | `problems`
 *   trigger  `manual` | `webhook` | `schedule`
 *   tag      a tag's name
 *   starred  `1`
 *   sort     `created` | `name`
 */
type SearchParams = Record<string, string | string[] | undefined>;

const STATUSES: readonly StatusKey[] = ["all", "runnable", "problems"];
const TRIGGER_KEYS: readonly TriggerKey[] = ["all", "manual", "webhook", "schedule"];
const SORT_KEYS: readonly SortKey[] = ["recent", "created", "name"];

/** The longest a pasted search or tag is taken to be. Longer is not a search anybody typed. */
const PARAM_MAX = 200;

function first(value: string | string[] | undefined): string | undefined {
  const one = Array.isArray(value) ? value[0] : value;
  return one === undefined ? undefined : one.slice(0, PARAM_MAX);
}

function oneOf<T extends string>(allowed: readonly T[], value: string | undefined, fallback: T): T {
  return value !== undefined && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * A URL's search parameters to a view. **Forgiving**: a value it does not know falls back to
 * that part's default rather than failing the page, because a URL is typed, pasted and
 * truncated by people, and an old link should still open the list.
 */
export function parseView(params: SearchParams): ListView {
  const tag = first(params.tag)?.trim();
  return {
    query: first(params.q) ?? DEFAULT_VIEW.query,
    status: oneOf(STATUSES, first(params.status), DEFAULT_VIEW.status),
    trigger: oneOf(TRIGGER_KEYS, first(params.trigger), DEFAULT_VIEW.trigger),
    tag: tag ? tag : null,
    starred: first(params.starred) === "1",
    sort: oneOf(SORT_KEYS, first(params.sort), DEFAULT_VIEW.sort),
  };
}

/** A view to the search string that `parseView` reads back — without the `?`, empty for the default. */
export function viewSearch(view: ListView): string {
  const params = new URLSearchParams();
  if (view.query.length > 0) params.set("q", view.query);
  if (view.status !== DEFAULT_VIEW.status) params.set("status", view.status);
  if (view.trigger !== DEFAULT_VIEW.trigger) params.set("trigger", view.trigger);
  if (view.tag !== null) params.set("tag", view.tag);
  if (view.starred) params.set("starred", "1");
  if (view.sort !== DEFAULT_VIEW.sort) params.set("sort", view.sort);
  return params.toString();
}

/**
 * The tag a view filters by, resolved against the workspace's tags — or, when the URL names a
 * tag that does not exist (renamed, deleted, mistyped), `missing` with the name, so the list
 * can say so instead of showing an empty page with no reason.
 */
export function resolveViewTag(
  view: ListView,
  tags: readonly TagSummary[],
): { tag: TagSummary | null; missing: string | null } {
  if (view.tag === null) return { tag: null, missing: null };
  const tag = findTag(tags, view.tag);
  return tag ? { tag, missing: null } : { tag: null, missing: view.tag };
}

/**
 * The tag `<select>`'s value while the URL names a tag that does not exist. A tag name cannot
 * hold a control character (`tagNameSchema`), so this can never be a real tag's.
 */
export const MISSING_TAG = "\u0000missing";

/**
 * **What the tag `<select>` shows** — the matched tag's own name, `""` for any tag, or
 * `MISSING_TAG`. The match is the filter's, ignoring case, so `?tag=BILLING` shows "Billing"
 * selected. The view's raw value is not an option's value whenever its case differs, and a
 * `<select>` given a value no option has silently shows its first option — "Any tag", over a
 * list that is filtered (found in Phase 32's browser walk).
 */
export function tagSelectValue(view: ListView, tags: readonly TagSummary[]): string {
  const { tag, missing } = resolveViewTag(view, tags);
  if (missing !== null) return MISSING_TAG;
  return tag?.name ?? "";
}

/**
 * The address the list's view lives at: `path`, the view's search, and `hash` kept — the empty
 * state links to `#generate-prompt`.
 */
export function viewHref(path: string, hash: string, view: ListView): string {
  const search = viewSearch(view);
  return `${path}${search ? `?${search}` : ""}${hash}`;
}

/**
 * The view after a tag was renamed or deleted — Phase 32. The filter follows a rename of the tag
 * it filters by and lets go of a deleted one, so the list does not empty itself under the person
 * who just tidied their tags. **The same object back when nothing about the view changed**, so a
 * caller can tell whether there is a new URL to write.
 */
export function viewAfterTagChange(
  view: ListView,
  change: { renamed: { from: string; to: string } } | { deleted: string } | { created: string },
): ListView {
  if (view.tag === null) return view;
  if ("renamed" in change && sameTagName(view.tag, change.renamed.from)) {
    return { ...view, tag: change.renamed.to };
  }
  if ("deleted" in change && sameTagName(view.tag, change.deleted)) return { ...view, tag: null };
  return view;
}
