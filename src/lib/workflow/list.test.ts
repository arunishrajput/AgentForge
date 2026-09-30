import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_VIEW,
  countWorkflows,
  isDefaultView,
  matchesQuery,
  toWorkflowCard,
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
    schedule: 1,
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
