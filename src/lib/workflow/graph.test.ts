import assert from "node:assert/strict";
import { test } from "node:test";

import {
  GRAPH_VERSION,
  graphsEqual,
  jsonBytes,
  PIN_MAX_BYTES,
  PINNED_TOTAL_MAX_BYTES,
  workflowGraphSchema,
} from "./graph";

/**
 * **Pinned output in the stored graph — Phase 31 (D138).** Optional and additive like
 * `disabled`, and capped, because every version snapshots it.
 */

const node = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "core.set",
  position: { x: 0, y: 0 },
  config: {},
  ...extra,
});

const graphOf = (...nodes: unknown[]) => ({ version: GRAPH_VERSION, nodes, edges: [] });

/** A JSON string value whose stored form is exactly `bytes` long. */
const ofBytes = (bytes: number) => "x".repeat(bytes - 2);

test("a pin round-trips, and a node without one stays without the key", () => {
  const parsed = workflowGraphSchema.parse(
    graphOf(node("a", { pinned: { output: { rows: [1, null, "two"] } } }), node("b")),
  );
  assert.deepEqual(parsed.nodes[0].pinned, { output: { rows: [1, null, "two"] } });
  assert.equal("pinned" in parsed.nodes[1], false, "absent stays absent");
  assert.ok(graphsEqual(parsed, workflowGraphSchema.parse(JSON.parse(JSON.stringify(parsed)))));
});

test("a pin of null is a pin — the wrapper is what makes it present", () => {
  const parsed = workflowGraphSchema.parse(graphOf(node("a", { pinned: { output: null } })));
  assert.deepEqual(parsed.nodes[0].pinned, { output: null });
  assert.equal(workflowGraphSchema.safeParse(graphOf(node("a", { pinned: {} }))).success, false);
});

test("a pin is measured in UTF-8 bytes of its JSON, and capped at 32 KB", () => {
  assert.equal(jsonBytes("é"), 4, "two quote marks and a two-byte character");
  assert.equal(jsonBytes(ofBytes(PIN_MAX_BYTES)), PIN_MAX_BYTES);

  assert.equal(
    workflowGraphSchema.safeParse(graphOf(node("a", { pinned: { output: ofBytes(PIN_MAX_BYTES) } }))).success,
    true,
  );
  const over = workflowGraphSchema.safeParse(
    graphOf(node("a", { pinned: { output: ofBytes(PIN_MAX_BYTES + 1) } })),
  );
  assert.equal(over.success, false);
  assert.match(over.error!.issues[0].message, /at most 32 KB/);
});

test("a graph's pins together are capped at 128 KB, and the refusal says how much there is", () => {
  const near = ofBytes(PIN_MAX_BYTES);
  const fits = Array.from({ length: PINNED_TOTAL_MAX_BYTES / PIN_MAX_BYTES }, (_, i) =>
    node(`n${i}`, { pinned: { output: near } }),
  );
  assert.equal(workflowGraphSchema.safeParse(graphOf(...fits)).success, true);

  const over = workflowGraphSchema.safeParse(graphOf(...fits, node("extra", { pinned: { output: "xx" } })));
  assert.equal(over.success, false);
  assert.match(over.error!.issues[0].message, /add up to 129 KB; together they can be at most 128 KB/);
});

test("a pin refuses what JSON cannot carry", () => {
  for (const output of [undefined, () => 1, new Date(0), Number.NaN]) {
    assert.equal(
      workflowGraphSchema.safeParse(graphOf(node("a", { pinned: { output } }))).success,
      false,
      String(output),
    );
  }
});
