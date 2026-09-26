import assert from "node:assert/strict";
import { test } from "node:test";

import { describeNodes } from "@/lib/nodes";

import { CATEGORY, UNKNOWN_CATEGORY, categoryLook, categoryRank } from "./categories";
import type { NodeSummary } from "./client";
import { groupNodes, rankNodes } from "./palette-search";

/**
 * Against the *real* registry, deliberately. A palette that finds nothing is the
 * kind of failure a fixture-only test cannot see, and the registry is what the
 * component is actually handed.
 */
const REGISTRY = describeNodes();

function synthetic(type: string, category: string): NodeSummary {
  return {
    type,
    label: type,
    description: "",
    kind: "action",
    category: category as NodeSummary["category"],
    outputs: [{ key: null, label: "Out" }],
    agentCallable: false,
    configSchema: {},
  };
}

test("the registry is not empty, so the rest of this file means something", () => {
  assert.ok(REGISTRY.length >= 10, `only ${REGISTRY.length} nodes in the registry`);
});

test("every category in the registry has a look of its own", () => {
  // Without this, adding a category in a later phase renders a whole group as the
  // red "Unknown" treatment reserved for a node that cannot run.
  for (const node of REGISTRY) {
    assert.notEqual(
      categoryLook(node.category),
      UNKNOWN_CATEGORY,
      `category "${node.category}" has no entry in CATEGORY`,
    );
  }
});

test("an empty query returns every node, in the order given", () => {
  assert.deepEqual(rankNodes(REGISTRY, ""), REGISTRY);
  assert.deepEqual(rankNodes(REGISTRY, "   "), REGISTRY);
});

test("a node is findable by a word in its label", () => {
  const found = rankNodes(REGISTRY, "branch");
  assert.equal(found[0]?.type, "core.branch");
});

test("a node is findable by its type, not only its label", () => {
  // The registry-as-spine property: "gmail" reaches the node whose *label* is
  // "Send email" only because the type is offered to the ranking as a keyword.
  const gmail = REGISTRY.find((node) => node.type === "integration.gmail");
  assert.ok(gmail);
  assert.ok(
    !gmail.label.toLowerCase().includes("gmail"),
    "this test is vacuous if the label already says gmail",
  );
  assert.equal(rankNodes(REGISTRY, "gmail")[0]?.type, "integration.gmail");
});

test("a query that matches nothing returns nothing rather than everything", () => {
  assert.deepEqual(rankNodes(REGISTRY, "zzzzqqq"), []);
});

test("a second word narrows rather than widens", () => {
  const one = rankNodes(REGISTRY, "trigger");
  const two = rankNodes(REGISTRY, "trigger schedule");
  assert.ok(two.length < one.length, `${two.length} is not fewer than ${one.length}`);
  assert.equal(two[0]?.type, "core.schedule_trigger");
});

test("grouping puts every node in exactly one group and loses none", () => {
  const groups = groupNodes(REGISTRY);
  const grouped = groups.flatMap((group) => group.nodes);
  assert.equal(grouped.length, REGISTRY.length);
  assert.equal(new Set(grouped.map((node) => node.type)).size, REGISTRY.length);
});

test("groups come back in reading order, triggers first", () => {
  const groups = groupNodes(REGISTRY);
  assert.equal(groups[0]?.category, "trigger");

  const ranks = groups.map((group) => categoryRank(group.category));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
});

test("a category with no nodes in the list does not appear", () => {
  const triggersOnly = REGISTRY.filter((node) => node.category === "trigger");
  assert.deepEqual(
    groupNodes(triggersOnly).map((group) => group.category),
    ["trigger"],
  );
});

test("an unrecognised category sorts LAST, not first", () => {
  // `indexOf` returns -1 for an unknown name, which would sort a category this
  // file has never heard of above the triggers. `categoryRank` returns Infinity
  // instead, and this is the test that keeps it that way.
  const groups = groupNodes([
    synthetic("future.thing", "quantum"),
    ...REGISTRY.filter((node) => node.category === "trigger"),
  ]);
  assert.deepEqual(
    groups.map((group) => group.category),
    ["trigger", "quantum"],
  );
});

test("an unrecognised category still renders, as Unknown", () => {
  const [group] = groupNodes([synthetic("future.thing", "quantum")]);
  assert.equal(group?.look, UNKNOWN_CATEGORY);
});

test("two unrecognised categories keep a defined order", () => {
  // Infinity - Infinity is NaN, which is not a usable comparator result.
  const groups = groupNodes([
    synthetic("b.thing", "zeta"),
    synthetic("a.thing", "alpha"),
  ]);
  assert.deepEqual(
    groups.map((group) => group.category),
    ["alpha", "zeta"],
  );
});

test("a pop fill is never offered as a small graphic, and never the other way", () => {
  // `DESIGN.md`'s one rule: `-pop` is a background, the plain token is the graphic.
  for (const look of [...Object.values(CATEGORY), UNKNOWN_CATEGORY]) {
    assert.ok(look.fill.endsWith("-pop"), `${look.fill} is not a fill token`);
    assert.ok(!look.dot.endsWith("-pop"), `${look.dot} is a fill used as a graphic`);
    assert.ok(look.fill.startsWith("bg-"), `${look.fill} is not a background`);
  }
});

test("a search returns a short list, not half the catalogue", () => {
  // The regression this pins: node descriptions are whole sentences, and a sentence
  // contains almost any short subsequence, so fuzzy-matching them made "gmail" return
  // 7 of 15 nodes. `lib/ui/command.ts` now limits the fuzzy tier to the title.
  const found = rankNodes(REGISTRY, "gmail");
  assert.equal(found[0]?.type, "integration.gmail");
  assert.ok(
    found.length <= 3,
    `"gmail" matched ${found.length} nodes: ${found.map((n) => n.type).join(", ")}`,
  );
});

test("a one-word search stays useful across the whole registry", () => {
  // No query should quietly return most of the list.
  for (const query of ["discord", "sheet", "branch", "delay", "webhook"]) {
    const found = rankNodes(REGISTRY, query);
    assert.ok(found.length > 0, `"${query}" found nothing`);
    assert.ok(
      found.length <= REGISTRY.length / 2,
      `"${query}" matched ${found.length} of ${REGISTRY.length} nodes`,
    );
  }
});
