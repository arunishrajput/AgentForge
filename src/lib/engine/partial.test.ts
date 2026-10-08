import assert from "node:assert/strict";
import { test } from "node:test";

import { getNode } from "@/lib/nodes";
import type { WorkflowGraph } from "@/lib/workflow/graph";

import { graph, loopGraph } from "./fixtures";
import { canPin, effectOf, planTest, seedNode, upstreamOf } from "./partial";

/**
 * The planning half of Phase 31 — the arithmetic both the server and the canvas run, so the
 * confirmation a person reads names exactly what the engine then executes.
 */

/** trigger → fetch (http GET) → shape → post (discord) → after, plus trigger → side. */
const sample = (): WorkflowGraph =>
  graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "fetch", type: "integration.http", config: { url: "https://example.com", method: "GET" } },
      { id: "shape", type: "core.set", config: { fields: { text: "{{input.body}}" } } },
      { id: "post", type: "integration.discord", config: { content: "{{input.text}}" } },
      { id: "after", type: "core.log", config: { message: "done" } },
      { id: "side", type: "core.log", config: { message: "side" } },
    ],
    [
      { source: "trigger", target: "fetch" },
      { source: "fetch", target: "shape" },
      { source: "shape", target: "post" },
      { source: "post", target: "after" },
      { source: "trigger", target: "side" },
    ],
  );

const ids = (nodes: readonly { id: string }[]) => nodes.map((node) => node.id);

function withPin(source: WorkflowGraph, id: string, output: unknown = { pinned: true }): WorkflowGraph {
  return { ...source, nodes: source.nodes.map((n) => (n.id === id ? { ...n, pinned: { output } } : n)) };
}

test("upstream is every node with a way to the target, the target included", () => {
  assert.deepEqual([...upstreamOf(sample(), "post")].sort(), ["fetch", "post", "shape", "trigger"]);
  assert.deepEqual([...upstreamOf(sample(), "trigger")], ["trigger"]);
});

test("upstream inside a loop includes the loop's own way round", () => {
  // trigger → each ⇄ body, each → after. `body` is reached from `each`, which `body` feeds.
  assert.deepEqual([...upstreamOf(loopGraph(), "body")].sort(), ["body", "each", "trigger"]);
});

test("only a node with a default output can hold a pin", () => {
  assert.equal(canPin(getNode("integration.http")), true);
  assert.equal(canPin(getNode("core.manual_trigger")), true);
  for (const router of ["core.branch", "core.switch", "core.loop"]) {
    assert.equal(canPin(getNode(router)), false, router);
  }
  assert.equal(canPin(undefined), false);
});

test("a plan names what a test would execute, what stands in with a pin, and what writes", () => {
  const plan = planTest(withPin(sample(), "fetch"), { scope: "path", nodeId: "post" }, getNode);
  assert.deepEqual(ids(plan.executes), ["trigger", "shape", "post"]);
  assert.deepEqual(ids(plan.pinned), ["fetch"]);
  assert.deepEqual(
    plan.effects.map((effect) => [effect.node.id, effect.does]),
    [["post", "post a message to Discord"]],
  );
});

test("a plan for one node is that node, even when it holds a pin", () => {
  const plan = planTest(withPin(sample(), "post"), { scope: "node", nodeId: "post" }, getNode);
  assert.deepEqual(ids(plan.executes), ["post"]);
  assert.deepEqual(plan.pinned, []);
});

test("a whole-workflow plan honours every pin and skips nodes that are switched off", () => {
  const source = withPin(sample(), "post");
  const off = { ...source, nodes: source.nodes.map((n) => (n.id === "side" ? { ...n, disabled: true as const } : n)) };
  const plan = planTest(off, { scope: "workflow", nodeId: null }, getNode);
  assert.deepEqual(ids(plan.pinned), ["post"]);
  assert.ok(!ids(plan.executes).includes("side"));
  assert.deepEqual(plan.effects, [], "the only writer stands in with its pin");
});

test("an effect narrowed by config is read off the stored config, and a reference counts", () => {
  const http = getNode("integration.http")!.effect;
  const node = (method: unknown) => ({ id: "h", type: "integration.http", position: { x: 0, y: 0 }, config: { method } });
  assert.equal(effectOf(node("GET"), http), null);
  assert.equal(effectOf(node(undefined), http), null, "GET is the default");
  assert.match(effectOf(node("POST"), http) ?? "", /send/);
  assert.match(effectOf(node("{{trigger.method}}"), http) ?? "", /send/, "unknown until run time means yes");

  const agent = getNode("ai.agent")!.effect;
  const withTools = (tools: unknown) => ({ id: "a", type: "ai.agent", position: { x: 0, y: 0 }, config: { tools } });
  assert.equal(effectOf(withTools([]), agent), null);
  assert.ok(effectOf(withTools(["integration.slack"]), agent));
});

test("every integration that writes says so, and no node that only reads does", () => {
  const writes = ["integration.slack", "integration.discord", "integration.gmail", "integration.sheets", "integration.github", "integration.notion"];
  for (const type of writes) assert.ok(getNode(type)?.effect, `${type} declares an effect`);
  for (const type of ["integration.postgres", "core.set", "core.log", "transform.map", "ai.llm"]) {
    assert.equal(getNode(type)?.effect, undefined, `${type} only reads`);
  }
});

/* ------------------------------------------------------------------ *
 * Seeding a node tested alone
 * ------------------------------------------------------------------ */

test("a node's seed prefers a pin to a recorded output, and reports where its input came from", () => {
  const recorded = new Map<string, unknown>([
    ["trigger", { q: 1 }],
    ["fetch", { body: "recorded" }],
    ["shape", { text: "recorded" }],
  ]);
  const seed = seedNode(withPin(sample(), "shape", { text: "pinned" }), "post", getNode, recorded);
  assert.deepEqual(seed.input, { text: "pinned" });
  assert.deepEqual(seed.from, { nodeId: "shape", source: "pinned" });
  assert.deepEqual(seed.outputs.get("fetch"), { body: "recorded" });
  assert.deepEqual(seed.trigger, { value: { q: 1 }, source: "recorded" });
  assert.deepEqual(seed.missing, []);
});

test("an upstream node that is switched off hands on its own input, as a run would", () => {
  const source = sample();
  const off = { ...source, nodes: source.nodes.map((n) => (n.id === "shape" ? { ...n, disabled: true as const } : n)) };
  const seed = seedNode(off, "post", getNode, new Map([["fetch", { body: "B" }]]));
  assert.deepEqual(seed.input, { body: "B" });
  assert.deepEqual(seed.from, { nodeId: "shape", source: "recorded" });
});

test("a seed with nothing upstream on record says so, node by node", () => {
  const seed = seedNode(sample(), "post", getNode, new Map());
  assert.equal(seed.input, null);
  assert.equal(seed.from, null);
  assert.deepEqual(seed.missing, ["trigger", "fetch", "shape"]);
  assert.equal(seed.trigger, null);
});

test("a node with several inputs takes the first edge whose source has a value", () => {
  const source = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "a", type: "core.set" },
      { id: "b", type: "core.set" },
      { id: "join", type: "core.log", config: { message: "x" } },
    ],
    [
      { source: "trigger", target: "a" },
      { source: "trigger", target: "b" },
      { source: "a", target: "join" },
      { source: "b", target: "join" },
    ],
  );
  const onlyB = seedNode(source, "join", getNode, new Map([["b", "from b"]]));
  assert.deepEqual(onlyB.from, { nodeId: "b", source: "recorded" });
  const both = seedNode(source, "join", getNode, new Map([["a", "from a"], ["b", "from b"]]));
  assert.equal(both.input, "from a");
});
