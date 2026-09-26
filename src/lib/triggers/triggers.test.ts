import assert from "node:assert/strict";
import { test } from "node:test";

import { validateGraph } from "@/lib/engine/validate";
import { getNode } from "@/lib/nodes";
import { scheduleTrigger } from "@/lib/nodes/core/schedule-trigger";
import { webhookTrigger } from "@/lib/nodes/core/webhook-trigger";
import { GRAPH_VERSION, type WorkflowGraph } from "@/lib/workflow/graph";

import { nextScheduleState, scheduleCron } from "./schedule";
import { cronSecretMatches } from "./secret";
import {
  MAX_WEBHOOK_BODY_BYTES,
  mintWebhookToken,
  readWebhookPayload,
  WEBHOOK_TOKEN_PATTERN,
  webhookRequiredFields,
  webhookTriggerNode,
  webhookUrl,
} from "./webhook";

const graphOf = (
  ...nodes: { id: string; type: string; config?: Record<string, unknown> }[]
): WorkflowGraph => ({
  version: GRAPH_VERSION,
  nodes: nodes.map((node, index) => ({
    id: node.id,
    type: node.type,
    position: { x: index * 300, y: 0 },
    config: node.config ?? {},
  })),
  edges: [],
});

/* --- registration ---------------------------------------------------------- */

test("both triggers are registered as triggers and closed to the agent", () => {
  for (const type of [webhookTrigger.type, scheduleTrigger.type]) {
    const definition = getNode(type);
    assert.ok(definition, `${type} is not registered`);
    assert.equal(definition.kind, "trigger");
    assert.equal(definition.category, "trigger");
    // D19: a trigger is never a tool. Starting a run is not a capability to hand a
    // model in the middle of one.
    assert.notEqual(definition.agentCallable, true);
    // D38: the generator needs the output shape to write a {{ }} reference.
    assert.ok(definition.outputShape, `${type} has no outputShape`);
  }
});

test("a graph with either trigger validates, and nothing may edge into one", () => {
  for (const type of [webhookTrigger.type, scheduleTrigger.type]) {
    const graph = graphOf({ id: "trigger", type }, { id: "log", type: "core.log" });
    graph.edges = [{ id: "e1", source: "trigger", target: "log", sourceHandle: null }];
    assert.equal(validateGraph(graph).valid, true, `${type} did not validate`);

    graph.edges.push({ id: "e2", source: "log", target: "trigger", sourceHandle: null });
    const problems = validateGraph(graph).problems.map((problem) => problem.code);
    assert.ok(problems.includes("edge_into_trigger"), `${type} accepted an inbound edge`);
  }
});

test("two triggers of different types is still multiple_triggers", () => {
  const graph = graphOf(
    { id: "webhook", type: webhookTrigger.type },
    { id: "schedule", type: scheduleTrigger.type },
  );
  const codes = validateGraph(graph).problems.map((problem) => problem.code);
  assert.ok(codes.includes("multiple_triggers"));
});

/* --- the schedule trigger's cron is validated at config time ---------------- */

test("an unsupported cron expression is invalid_config, not a silent non-firing schedule", () => {
  const graph = graphOf({
    id: "schedule",
    type: scheduleTrigger.type,
    config: { cron: "0 9 * * MON" },
  });
  const problem = validateGraph(graph).problems.find(
    (candidate) => candidate.code === "invalid_config",
  );
  assert.ok(problem, "a weekday name was accepted");
  assert.match(problem.message, /not supported/);
});

test("a cron that parses but can never match is rejected too", () => {
  const graph = graphOf({
    id: "schedule",
    type: scheduleTrigger.type,
    config: { cron: "0 0 30 2 *" },
  });
  const codes = validateGraph(graph).problems.map((candidate) => candidate.code);
  assert.ok(codes.includes("invalid_config"));
});

test("a valid cron survives the round trip through the config schema", () => {
  assert.equal(scheduleCron(graphOf({ id: "s", type: scheduleTrigger.type, config: { cron: "*/30 * * * *" } })), "*/30 * * * *");
  // The default applies when the field is absent.
  assert.equal(scheduleCron(graphOf({ id: "s", type: scheduleTrigger.type })), "0 9 * * *");
  // No schedule trigger, no schedule.
  assert.equal(scheduleCron(graphOf({ id: "t", type: "core.manual_trigger" })), null);
  // An invalid one yields no schedule rather than throwing: the graph must stay saveable.
  assert.equal(scheduleCron(graphOf({ id: "s", type: scheduleTrigger.type, config: { cron: "nope" } })), null);
});

/* --- deriving scheduleNextAt ------------------------------------------------ */

const now = new Date("2026-09-26T08:59:00Z");

test("a new schedule gets its next due time", () => {
  const state = nextScheduleState({
    graph: graphOf({ id: "s", type: scheduleTrigger.type, config: { cron: "0 9 * * *" } }),
    previousCron: null,
    previousNextAt: null,
    now,
  });
  assert.equal(state.scheduleNextAt?.toISOString(), "2026-09-26T09:00:00.000Z");
});

test("an unchanged expression keeps the stored due time instead of recomputing it", () => {
  // The bug this prevents: the 09:00 slot has already fired today, so the row holds
  // tomorrow. Recomputing at 08:59 would move it back to today and fire it twice.
  const alreadyFired = new Date("2026-09-27T09:00:00Z");
  const state = nextScheduleState({
    graph: graphOf({ id: "s", type: scheduleTrigger.type, config: { cron: "0 9 * * *" } }),
    previousCron: "0 9 * * *",
    previousNextAt: alreadyFired,
    now,
  });
  assert.equal(state.scheduleNextAt?.toISOString(), alreadyFired.toISOString());
});

test("a missed due time survives a save and is caught up rather than skipped", () => {
  const missed = new Date("2026-09-25T09:00:00Z");
  const state = nextScheduleState({
    graph: graphOf({ id: "s", type: scheduleTrigger.type, config: { cron: "0 9 * * *" } }),
    previousCron: "0 9 * * *",
    previousNextAt: missed,
    now,
  });
  assert.equal(state.scheduleNextAt?.toISOString(), missed.toISOString());
});

test("changing the expression recomputes from now", () => {
  const state = nextScheduleState({
    graph: graphOf({ id: "s", type: scheduleTrigger.type, config: { cron: "0 17 * * *" } }),
    previousCron: "0 9 * * *",
    previousNextAt: new Date("2026-09-27T09:00:00Z"),
    now,
  });
  assert.equal(state.scheduleNextAt?.toISOString(), "2026-09-26T17:00:00.000Z");
});

test("removing the schedule trigger clears the due time", () => {
  const state = nextScheduleState({
    graph: graphOf({ id: "t", type: "core.manual_trigger" }),
    previousCron: "0 9 * * *",
    previousNextAt: new Date("2026-09-27T09:00:00Z"),
    now,
  });
  assert.equal(state.scheduleNextAt, null);
});

/* --- the webhook token and URL --------------------------------------------- */

test("a minted token is unguessable, URL-safe and unique", () => {
  const tokens = new Set(Array.from({ length: 200 }, () => mintWebhookToken()));
  assert.equal(tokens.size, 200, "mint collided");
  for (const token of tokens) {
    assert.match(token, WEBHOOK_TOKEN_PATTERN);
    // 24 bytes of base64url is 32 characters and 192 bits.
    assert.equal(token.length, 32);
    assert.ok(!token.includes("/") && !token.includes("+") && !token.includes("="));
  }
});

test("the token pattern rejects what must not reach the database", () => {
  for (const token of ["", "short", "../../etc/passwd", "has spaces", "a".repeat(65), "tok+en/"]) {
    assert.equal(WEBHOOK_TOKEN_PATTERN.test(token), false, `accepted "${token}"`);
  }
});

test("the URL is built without a double slash", () => {
  assert.equal(webhookUrl("https://app.example.com", "abc"), "https://app.example.com/api/webhook/abc");
  assert.equal(webhookUrl("https://app.example.com/", "abc"), "https://app.example.com/api/webhook/abc");
});

test("the trigger node is found by type, and requiredFields comes from its own schema", () => {
  const graph = graphOf({
    id: "hook",
    type: webhookTrigger.type,
    config: { requiredFields: ["name", "message"] },
  });
  const node = webhookTriggerNode(graph);
  assert.equal(node?.id, "hook");
  assert.deepEqual(webhookRequiredFields(node!), ["name", "message"]);

  // Absent config means no requirements, not a throw.
  assert.deepEqual(
    webhookRequiredFields(webhookTriggerNode(graphOf({ id: "hook", type: webhookTrigger.type }))!),
    [],
  );
  // An unparseable config likewise: validation already reports it.
  assert.deepEqual(
    webhookRequiredFields(
      webhookTriggerNode(graphOf({ id: "hook", type: webhookTrigger.type, config: { requiredFields: "nope" } }))!,
    ),
    [],
  );
  assert.equal(webhookTriggerNode(graphOf({ id: "t", type: "core.manual_trigger" })), undefined);
});

/* --- payload validation ---------------------------------------------------- */

test("a JSON object passes and is handed through unchanged", () => {
  const result = readWebhookPayload('{"name":"Priya","message":"down"}', []);
  assert.deepEqual(result, { ok: true, body: { name: "Priya", message: "down" } });
});

test("an empty body is an empty object, not an error", () => {
  // A webhook that only says "something happened" is legitimate.
  assert.deepEqual(readWebhookPayload("", []), { ok: true, body: {} });
  assert.deepEqual(readWebhookPayload("   \n ", []), { ok: true, body: {} });
});

test("a non-object body is refused, because {{trigger.field}} would have nothing to read", () => {
  for (const raw of ["[1,2]", '"text"', "42", "null", "true"]) {
    const result = readWebhookPayload(raw, []);
    assert.equal(result.ok, false, `accepted ${raw}`);
    assert.match(result.message, /JSON object/);
  }
});

test("malformed JSON is refused before a run exists", () => {
  const result = readWebhookPayload("{not json", []);
  assert.equal(result.ok, false);
  assert.match(result.message, /valid JSON/);
});

test("required fields are enforced and every missing one is named", () => {
  const result = readWebhookPayload('{"name":"Priya"}', ["name", "email", "message"]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ["email", "message"]);
  assert.match(result.message, /email, message/);
});

test("a present-but-null field counts as supplied; an explicit undefined does not", () => {
  // null is a value a webhook may legitimately send. `hasOwn` is what makes the
  // difference from a missing key, rather than truthiness.
  assert.equal(readWebhookPayload('{"name":null}', ["name"]).ok, true);
  assert.equal(readWebhookPayload('{"other":1}', ["name"]).ok, false);
});

test("a body over the size cap is refused without being parsed", () => {
  const huge = JSON.stringify({ blob: "x".repeat(MAX_WEBHOOK_BODY_BYTES) });
  const result = readWebhookPayload(huge, []);
  assert.equal(result.ok, false);
  assert.match(result.message, /larger than/);
});

test("the size cap counts bytes, not characters", () => {
  // A multi-byte payload under the character count can still be over the byte cap.
  const multibyte = JSON.stringify({ blob: "é".repeat(MAX_WEBHOOK_BODY_BYTES / 2) });
  assert.ok(multibyte.length < MAX_WEBHOOK_BODY_BYTES);
  assert.equal(readWebhookPayload(multibyte, []).ok, false);
});

/* --- the cron secret ------------------------------------------------------- */

test("the cron secret must match exactly, and a missing one is a miss", () => {
  assert.equal(cronSecretMatches("s3cret-value-here", "s3cret-value-here"), true);
  assert.equal(cronSecretMatches("s3cret-value-heri", "s3cret-value-here"), false);
  assert.equal(cronSecretMatches("s3cret", "s3cret-value-here"), false);
  assert.equal(cronSecretMatches("s3cret-value-here-and-more", "s3cret-value-here"), false);
  assert.equal(cronSecretMatches("", "s3cret-value-here"), false);
  assert.equal(cronSecretMatches(null, "s3cret-value-here"), false);
});

/* --- the nodes themselves -------------------------------------------------- */

const context = () => {
  const logs: string[] = [];
  return {
    logs,
    context: {
      runId: "run",
      workflowId: "wf",
      ownerId: "owner",
      nodeId: "trigger",
      iteration: 0,
      log: (message: string) => logs.push(message),
      signal: new AbortController().signal,
    },
  };
};

test("the webhook trigger passes the body through and names its fields in the log", async () => {
  const { logs, context: ctx } = context();
  const outcome = await webhookTrigger.execute({
    config: { requiredFields: [] },
    input: { name: "Priya", message: "down" },
    context: ctx,
  });
  assert.deepEqual(outcome.output, { name: "Priya", message: "down" });
  assert.match(logs[0], /2 field\(s\): name, message/);
});

test("the webhook trigger turns a null input into an empty object", async () => {
  const { context: ctx } = context();
  const outcome = await webhookTrigger.execute({ config: { requiredFields: [] }, input: null, context: ctx });
  assert.deepEqual(outcome.output, {});
});

test("the schedule trigger reports the slot it fired for", async () => {
  const { logs, context: ctx } = context();
  const outcome = await scheduleTrigger.execute({
    config: { cron: "0 9 * * *" },
    input: { scheduledFor: "2026-09-26T09:00:00.000Z" },
    context: ctx,
  });
  const output = outcome.output as { cron: string; firedAt: string; scheduledFor: string };
  assert.equal(output.cron, "0 9 * * *");
  assert.equal(output.scheduledFor, "2026-09-26T09:00:00.000Z");
  assert.ok(!Number.isNaN(Date.parse(output.firedAt)));
  assert.match(logs[0], /26 Sept 2026, 09:00 UTC/);
});

test("the schedule trigger run by hand reports no slot rather than inventing one", async () => {
  const { context: ctx } = context();
  const outcome = await scheduleTrigger.execute({ config: { cron: "0 9 * * *" }, input: null, context: ctx });
  assert.equal((outcome.output as { scheduledFor: string | null }).scheduledFor, null);
});
