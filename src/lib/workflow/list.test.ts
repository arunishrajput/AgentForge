import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_VIEW,
  MISSING_TAG,
  countTags,
  countWorkflows,
  isDefaultView,
  matchesQuery,
  parseView,
  resolveViewTag,
  tagSelectValue,
  toWorkflowCard,
  viewAfterTagChange,
  viewHref,
  viewSearch,
  viewWorkflows,
  type ListView,
  type WorkflowCard,
} from "./list";

const LOOKUP = (type: string) =>
  ({
    "core.manual_trigger": { label: "Manual trigger", category: "trigger" },
    "core.webhook_trigger": { label: "Webhook trigger", category: "trigger" },
    "core.schedule_trigger": { label: "Schedule trigger", category: "trigger" },
    "integration.discord": { label: "Post to Discord", category: "integration" },
    "ai.agent": { label: "AI Agent", category: "agent" },
  })[type];

function described(over: Partial<Parameters<typeof toWorkflowCard>[0]> = {}) {
  return {
    id: "wf_1",
    name: "Nightly digest",
    description: null,
    graph: { nodes: [{ type: "core.manual_trigger" }, { type: "integration.discord" }] },
    runnable: true,
    problems: [],
    scheduleCron: null,
    visibility: "workspace",
    shareUrl: null,
    active: true,
    tags: [] as { id: string; name: string }[],
    starred: false,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-20T00:00:00.000Z",
    ...over,
  };
}

function card(over: Partial<WorkflowCard> = {}): WorkflowCard {
  return { ...toWorkflowCard(described(), LOOKUP), ...over };
}

test("toWorkflowCard reads labels, categories and triggers out of the graph", () => {
  const result = toWorkflowCard(described(), LOOKUP);

  assert.equal(result.nodeCount, 2);
  assert.deepEqual(result.nodeLabels, ["Manual trigger", "Post to Discord"]);
  assert.deepEqual(result.nodeTypes, ["core.manual_trigger", "integration.discord"]);
  assert.deepEqual(result.categories, ["trigger", "integration"]);
  assert.deepEqual(result.triggers, ["manual"]);
});

test("toWorkflowCard dedupes labels but still counts every node", () => {
  const result = toWorkflowCard(
    described({
      graph: {
        nodes: [
          { type: "integration.discord" },
          { type: "integration.discord" },
          { type: "integration.discord" },
        ],
      },
    }),
    LOOKUP,
  );

  assert.equal(result.nodeCount, 3);
  assert.deepEqual(result.nodeLabels, ["Post to Discord"]);
  assert.deepEqual(result.nodeTypes, ["integration.discord"]);
});

test("toWorkflowCard falls back to the raw type for a node the registry cannot name", () => {
  const result = toWorkflowCard(
    described({ graph: { nodes: [{ type: "integration.retired" }] } }),
    LOOKUP,
  );

  assert.deepEqual(result.nodeLabels, ["integration.retired"]);
  assert.deepEqual(result.categories, []);
  assert.equal(result.nodeCount, 1);
});

test("toWorkflowCard collects every distinct trigger in the graph", () => {
  const result = toWorkflowCard(
    described({
      graph: {
        nodes: [
          { type: "core.webhook_trigger" },
          { type: "core.schedule_trigger" },
          { type: "core.webhook_trigger" },
        ],
      },
    }),
    LOOKUP,
  );

  assert.deepEqual(result.triggers, ["webhook", "schedule"]);
});

test("toWorkflowCard carries the problem count, not the problems", () => {
  const result = toWorkflowCard(
    described({ runnable: false, problems: [{ message: "a" }, { message: "b" }] }),
    LOOKUP,
  );

  assert.equal(result.runnable, false);
  assert.equal(result.problemCount, 2);
});

test("search matches a node type, not only its label", () => {
  const subject = toWorkflowCard(
    described({ name: "Nightly digest", graph: { nodes: [{ type: "integration.gmail" }] } }),
    () => ({ label: "Send email", category: "integration" }),
  );

  // The word a user types is the vendor's, and it is nowhere in the label.
  assert.equal(matchesQuery(subject, "gmail"), true);
  assert.equal(matchesQuery(subject, "send email"), true);
});

test("search matches the name, the description and the node labels", () => {
  const subject = card({ name: "Nightly digest", description: "Summarises the day" });

  assert.equal(matchesQuery(subject, "nightly"), true);
  assert.equal(matchesQuery(subject, "summarises"), true);
  // The point of searching labels: "discord" appears in neither the name nor the
  // description, only in the graph.
  assert.equal(matchesQuery(subject, "discord"), true);
  assert.equal(matchesQuery(subject, "gmail"), false);
});

test("search is case-insensitive and ignores surrounding space", () => {
  assert.equal(matchesQuery(card(), "  NIGHTLY  "), true);
});

test("an empty query matches everything", () => {
  assert.equal(matchesQuery(card(), ""), true);
  assert.equal(matchesQuery(card(), "   "), true);
});

test("every term must match — a second word narrows the result", () => {
  const subject = card({ name: "Nightly digest" });

  assert.equal(matchesQuery(subject, "nightly digest"), true);
  assert.equal(matchesQuery(subject, "nightly gmail"), false);
});

const RUNNABLE = card({ id: "a", name: "Alpha", updatedAt: "2026-09-03T00:00:00.000Z" });
const BROKEN = card({
  id: "b",
  name: "beta",
  runnable: false,
  problemCount: 1,
  triggers: ["webhook"],
  updatedAt: "2026-09-02T00:00:00.000Z",
  createdAt: "2026-09-10T00:00:00.000Z",
});
const SCHEDULED = card({
  id: "c",
  name: "Gamma 10",
  triggers: ["schedule"],
  scheduleCron: "0 9 * * *",
  updatedAt: "2026-09-01T00:00:00.000Z",
});
const ALL = [RUNNABLE, BROKEN, SCHEDULED];

function view(over: Partial<ListView> = {}): ListView {
  return { ...DEFAULT_VIEW, ...over };
}

test("the status filter splits runnable from broken", () => {
  assert.deepEqual(
    viewWorkflows(ALL, view({ status: "runnable" })).map((c) => c.id),
    ["a", "c"],
  );
  assert.deepEqual(
    viewWorkflows(ALL, view({ status: "problems" })).map((c) => c.id),
    ["b"],
  );
});

test("the trigger filter keeps only workflows holding that trigger", () => {
  assert.deepEqual(
    viewWorkflows(ALL, view({ trigger: "schedule" })).map((c) => c.id),
    ["c"],
  );
  assert.deepEqual(viewWorkflows(ALL, view({ trigger: "manual" })).map((c) => c.id), ["a"]);
});

test("filters combine rather than replace each other", () => {
  assert.deepEqual(
    viewWorkflows(ALL, view({ status: "runnable", trigger: "webhook" })).map((c) => c.id),
    [],
  );
});

test("the default sort is most recently updated first", () => {
  assert.deepEqual(viewWorkflows(ALL, view()).map((c) => c.id), ["a", "b", "c"]);
});

test("sorting by creation date is a different order from updated", () => {
  assert.deepEqual(viewWorkflows(ALL, view({ sort: "created" })).map((c) => c.id), [
    "b",
    "a",
    "c",
  ]);
});

test("sorting by name is case-insensitive and numeric", () => {
  const numbered = [card({ id: "10", name: "Report 10" }), card({ id: "2", name: "report 2" })];

  assert.deepEqual(viewWorkflows(numbered, view({ sort: "name" })).map((c) => c.id), [
    "2",
    "10",
  ]);
  assert.deepEqual(viewWorkflows(ALL, view({ sort: "name" })).map((c) => c.id), [
    "a",
    "b",
    "c",
  ]);
});

test("viewWorkflows does not mutate the array it is given", () => {
  const order = ALL.map((c) => c.id);
  viewWorkflows(ALL, view({ sort: "name" }));
  assert.deepEqual(ALL.map((c) => c.id), order);
});

test("countWorkflows counts each axis independently", () => {
  assert.deepEqual(countWorkflows(ALL), {
    total: 3,
    runnable: 2,
    problems: 1,
    manual: 1,
    webhook: 1,
    form: 0,
    schedule: 1,
    error: 0,
    starred: 0,
  });
});

test("isDefaultView is false as soon as anything is narrowed", () => {
  assert.equal(isDefaultView(DEFAULT_VIEW), true);
  // Sort is not a narrowing — a sorted list still shows everything, so the empty
  // state must not offer to "clear filters" because of it.
  assert.equal(isDefaultView(view({ sort: "name" })), true);
  assert.equal(isDefaultView(view({ query: "x" })), false);
  assert.equal(isDefaultView(view({ status: "problems" })), false);
  assert.equal(isDefaultView(view({ trigger: "webhook" })), false);
});

test("a card carries the workflow's visibility and whether a public link is live", () => {
  // Both are labels on a card rather than anything it filters by: a card is only built for
  // a workflow the reader may already open, so the filtering happened in SQL. What the card
  // has to do is not let a private workflow look like a shared one.
  const plain = toWorkflowCard(described(), LOOKUP);
  assert.equal(plain.visibility, "workspace");
  assert.equal(plain.shared, false);

  const restricted = toWorkflowCard(
    described({ visibility: "private", shareUrl: "https://app.example/s/abc" }),
    LOOKUP,
  );
  assert.equal(restricted.visibility, "private");
  assert.equal(restricted.shared, true);
});

test("a card never carries the share URL itself", () => {
  // The list is a client component, so everything on a card ships to the browser. The URL
  // has no use there and the canvas dialog is where it belongs.
  const result = toWorkflowCard(described({ shareUrl: "https://app.example/s/SECRET" }), LOOKUP);
  assert.doesNotMatch(JSON.stringify(result), /SECRET/);
});

/* ------------------------- Phase 32: the library ------------------------- */

const BILLING = { id: "t-billing", name: "Billing" };
const OPS = { id: "t-ops", name: "ops" };

const TAGGED = [
  card({ id: "a", name: "Alpha", tags: [BILLING], starred: true, updatedAt: "2026-09-03T00:00:00.000Z" }),
  card({ id: "b", name: "Beta", tags: [BILLING, OPS], updatedAt: "2026-09-02T00:00:00.000Z" }),
  card({ id: "c", name: "Gamma", tags: [], starred: true, updatedAt: "2026-09-01T00:00:00.000Z" }),
];

test("a card carries its tags, sorted by name, its star and how many pins it holds", () => {
  const result = toWorkflowCard(
    described({
      tags: [OPS, BILLING],
      starred: true,
      graph: { nodes: [{ type: "core.manual_trigger" }, { type: "core.log", pinned: { output: 1 } }] },
    }),
    LOOKUP,
  );
  assert.deepEqual(result.tags.map((tag) => tag.name), ["Billing", "ops"]);
  assert.equal(result.starred, true);
  assert.equal(result.pinnedCount, 1);
  // A pin of `null` is a pin: `pinned` is `{ output: null }`, present.
  const nullPin = toWorkflowCard(described({ graph: { nodes: [{ type: "core.log", pinned: { output: null } }] } }), LOOKUP);
  assert.equal(nullPin.pinnedCount, 1);
});

test("the tag filter keeps the workflows wearing it, ignoring case — `?tag=billing` finds Billing", () => {
  assert.deepEqual(viewWorkflows(TAGGED, view({ tag: "billing" })).map((c) => c.id), ["a", "b"]);
  assert.deepEqual(viewWorkflows(TAGGED, view({ tag: "OPS" })).map((c) => c.id), ["b"]);
  assert.deepEqual(viewWorkflows(TAGGED, view({ tag: "weekly" })).map((c) => c.id), []);
});

test("the starred filter keeps only the reader's starred workflows, and combines with a tag", () => {
  assert.deepEqual(viewWorkflows(TAGGED, view({ starred: true })).map((c) => c.id), ["a", "c"]);
  assert.deepEqual(viewWorkflows(TAGGED, view({ starred: true, tag: "billing" })).map((c) => c.id), ["a"]);
});

test("search matches a tag's name too", () => {
  assert.equal(matchesQuery(TAGGED[1], "ops"), true);
  assert.equal(matchesQuery(TAGGED[2], "billing"), false);
});

test("countWorkflows counts the starred, and countTags counts each tag's wearers by id", () => {
  assert.equal(countWorkflows(TAGGED).starred, 2);
  const counts = countTags(TAGGED);
  assert.equal(counts.get(BILLING.id), 2);
  assert.equal(counts.get(OPS.id), 1);
  assert.equal(counts.get("t-unworn"), undefined);
});

test("a tag or the starred filter is a narrowing, so the list offers to clear it", () => {
  assert.equal(isDefaultView(view({ tag: "billing" })), false);
  assert.equal(isDefaultView(view({ starred: true })), false);
});

test("the default view is the bare URL, and every part round-trips through it", () => {
  assert.equal(viewSearch(DEFAULT_VIEW), "");
  const full: ListView = {
    query: "weekly digest",
    status: "problems",
    trigger: "schedule",
    tag: "needs review",
    starred: true,
    sort: "name",
  };
  const search = viewSearch(full);
  assert.equal(search, "q=weekly+digest&status=problems&trigger=schedule&tag=needs+review&starred=1&sort=name");
  assert.deepEqual(parseView(Object.fromEntries(new URLSearchParams(search))), full);
});

test("a part at its default is left out of the URL", () => {
  assert.equal(viewSearch(view({ sort: "recent", status: "all", trigger: "all" })), "");
  assert.equal(viewSearch(view({ tag: "billing" })), "tag=billing");
});

test("parseView is forgiving: an unknown value falls back to that part's default", () => {
  assert.deepEqual(parseView({}), DEFAULT_VIEW);
  assert.deepEqual(
    parseView({ status: "broken", trigger: "email", sort: "oldest", starred: "yes", tag: "   " }),
    DEFAULT_VIEW,
  );
});

test("parseView takes the first of a repeated parameter, and caps a pasted one", () => {
  assert.equal(parseView({ tag: ["billing", "ops"] }).tag, "billing");
  assert.equal(parseView({ q: "x".repeat(5000) }).query.length, 200);
});

test("resolveViewTag names a tag the URL asks for that the workspace does not have", () => {
  const tags = [BILLING, OPS];
  assert.deepEqual(resolveViewTag(view(), tags), { tag: null, missing: null });
  assert.deepEqual(resolveViewTag(view({ tag: "billing" }), tags), { tag: BILLING, missing: null });
  assert.deepEqual(resolveViewTag(view({ tag: "renamed-away" }), tags), { tag: null, missing: "renamed-away" });
});

test("the tag select shows the matched tag's own name, whatever case the URL used", () => {
  const tags = [BILLING, OPS];
  // The bug: `?tag=BILLING` filtered the list, and the select — given "BILLING", which no
  // option has — showed "Any tag".
  assert.equal(tagSelectValue(view({ tag: "BILLING" }), tags), "Billing");
  assert.equal(tagSelectValue(view({ tag: "billing" }), tags), "Billing");
  assert.equal(tagSelectValue(view(), tags), "");
  assert.equal(tagSelectValue(view({ tag: "renamed-away" }), tags), MISSING_TAG);
});

test("the view's address keeps the path and the hash, and is bare for the default view", () => {
  assert.equal(viewHref("/workflows", "", DEFAULT_VIEW), "/workflows");
  assert.equal(viewHref("/workflows", "#generate-prompt", view({ tag: "ops" })), "/workflows?tag=ops#generate-prompt");
});

test("renaming the filtered tag moves the filter — and the address — to the new name", () => {
  const before = view({ tag: "zzzz-walk billing", starred: true });
  const after = viewAfterTagChange(before, { renamed: { from: "ZZZZ-walk Billing", to: "zzzz-walk invoices" } });
  assert.equal(after.tag, "zzzz-walk invoices");
  assert.equal(after.starred, true);
  // What the list writes to the address bar before it refreshes — the walk's bug kept the old one.
  assert.equal(viewHref("/workflows", "", after), "/workflows?tag=zzzz-walk+invoices&starred=1");
});

test("deleting the filtered tag lets go of it; any other change leaves the view as it was", () => {
  const filtered = view({ tag: "billing" });
  assert.equal(viewAfterTagChange(filtered, { deleted: "Billing" }).tag, null);
  // Unrelated changes return the very same object, so there is no new address to write.
  assert.equal(viewAfterTagChange(filtered, { renamed: { from: "ops", to: "oncall" } }), filtered);
  assert.equal(viewAfterTagChange(filtered, { deleted: "ops" }), filtered);
  assert.equal(viewAfterTagChange(filtered, { created: "billing" }), filtered);
  const unfiltered = view();
  assert.equal(viewAfterTagChange(unfiltered, { deleted: "billing" }), unfiltered);
});
