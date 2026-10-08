import assert from "node:assert/strict";
import { test } from "node:test";

import { TEST_SCOPE } from "@/lib/engine/fixtures";
import { NodeError, type NodeContext } from "@/lib/nodes/types";

import { checkManualInput, manualTrigger, type ManualField } from "./manual-trigger";

/**
 * **The manual trigger's declared fields — Phase 31.** Enforced at run time, so a run started
 * from the API meets the same rule the canvas's form does.
 */

const context: NodeContext = {
  runId: "run-1",
  workflowId: "wf-1",
  scope: TEST_SCOPE,
  nodeId: "trigger",
  nodeType: "core.manual_trigger",
  iteration: 0,
  log: () => {},
  signal: new AbortController().signal,
};

const fields = (...list: Array<Partial<ManualField> & { name: string }>): ManualField[] =>
  list.map((field) => ({ type: "text", required: false, ...field }));

const runWith = (config: unknown, input: unknown) =>
  manualTrigger.execute({ config: manualTrigger.configSchema.parse(config), input, context });

test("with no fields declared, any input is the output, exactly as before Phase 31", async () => {
  assert.deepEqual(await runWith({}, { anything: [1] }), { output: { anything: [1] } });
  assert.deepEqual(await runWith({}, null), { output: {} });
  // A config saved with stray keys still parses: the schema stayed loose.
  assert.deepEqual(manualTrigger.configSchema.parse({ legacy: true }), { legacy: true, fields: [] });
});

test("a required field that is missing or blank stops the run, and is named", async () => {
  const config = { fields: fields({ name: "topic", required: true }, { name: "tone" }) };
  for (const input of [null, {}, { topic: "" }, { topic: "   " }, { tone: "warm" }]) {
    await assert.rejects(runWith(config, input), (error: unknown) => {
      assert.ok(error instanceof NodeError);
      assert.equal(error.message, 'This workflow needs the field "topic" to run.');
      return true;
    });
  }
  assert.deepEqual(await runWith(config, { topic: "launch" }), { output: { topic: "launch" } });
});

test("several missing fields are named together", () => {
  assert.equal(
    checkManualInput(fields({ name: "a", required: true }, { name: "b", required: true }), {}),
    'This workflow needs the fields "a", "b" to run.',
  );
});

test("a value of the wrong type is refused, and an optional field may be left out", () => {
  const declared = fields(
    { name: "count", type: "number" },
    { name: "urgent", type: "boolean" },
    { name: "extra", type: "json" },
  );
  assert.equal(checkManualInput(declared, { count: "3" }), '"count" should be a number.');
  assert.equal(checkManualInput(declared, { count: Number.NaN }), '"count" should be a number.');
  assert.equal(checkManualInput(declared, { urgent: "yes" }), '"urgent" should be true or false.');
  assert.equal(checkManualInput(declared, { count: 3, urgent: false, extra: { any: ["thing"] } }), null);
  assert.equal(checkManualInput(declared, {}), null);
  assert.equal(checkManualInput(fields({ name: "t" }), { t: 4 }), '"t" should be text.');
});

test("the field declaration itself is bounded", () => {
  const parse = (config: unknown) => manualTrigger.configSchema.safeParse(config).success;
  assert.equal(parse({ fields: [{ name: "  " }] }), false, "a blank name");
  assert.equal(parse({ fields: [{ name: "x", type: "date" }] }), false, "an unknown type");
  assert.equal(parse({ fields: Array.from({ length: 21 }, (_, i) => ({ name: `f${i}` })) }), false);
  assert.deepEqual(manualTrigger.configSchema.parse({ fields: [{ name: " topic " }] }), {
    fields: [{ name: "topic", type: "text", required: false }],
  });
});
