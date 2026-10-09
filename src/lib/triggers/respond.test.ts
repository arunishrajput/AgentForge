import assert from "node:assert/strict";
import { test } from "node:test";

import { executeWorkflow } from "@/lib/engine/execute";
import { graph, TEST_SCOPE } from "@/lib/engine/fixtures";
import { validateGraph } from "@/lib/engine/validate";
import { respondNode } from "@/lib/nodes/core/respond";
import { NodeError, type NodeContext } from "@/lib/nodes/types";

import {
  allowedStatus,
  answerFromSteps,
  MAX_RESPONSE_BODY_BYTES,
  respondConfigSchema,
  responseFor,
} from "./respond";

/**
 * **What a webhook or form may answer with — Phase 40, D190.** The allowlist is asserted twice: as the
 * node's config (the author hears at save time) and as the receiver's re-check of what a step row
 * holds (a row cannot widen it). Then the node is run through the real engine.
 */

test("the status is 200–299 or 400–599 — never a redirect, an informational code, or nonsense", () => {
  for (const ok of [200, 201, 204, 299, 400, 404, 422, 429, 500, 503, 599]) assert.equal(allowedStatus(ok), true, String(ok));
  for (const bad of [0, 100, 101, 199, 300, 301, 302, 307, 399, 600, 99999, -200, 200.5, Number.NaN]) {
    assert.equal(allowedStatus(bad), false, String(bad));
  }
  assert.equal(respondConfigSchema.safeParse({ status: 302 }).success, false);
  assert.equal(respondConfigSchema.safeParse({ status: 201 }).success, true);
  assert.equal(respondConfigSchema.parse({}).status, 200);
});

test("headers: the six named ones, case-insensitively — and nothing that sets a cookie, a redirect or a type", () => {
  for (const name of ["Cache-Control", "etag", "RETRY-AFTER", "X-Request-Id", "content-language", "x-correlation-id"]) {
    assert.equal(respondConfigSchema.safeParse({ headers: { [name]: "v" } }).success, true, name);
  }
  for (const name of ["Set-Cookie", "Location", "Content-Type", "Access-Control-Allow-Origin", "X-Frame-Options", "Authorization", "Content-Length", "x-anything"]) {
    assert.equal(respondConfigSchema.safeParse({ headers: { [name]: "v" } }).success, false, name);
  }
});

test("a header value cannot carry a line break — that is response splitting", () => {
  for (const value of ["a\r\nSet-Cookie: x=1", "a\nb", "a\u0000b", "é", "x".repeat(201)]) {
    assert.equal(respondConfigSchema.safeParse({ headers: { "x-request-id": value } }).success, false, JSON.stringify(value));
  }
  assert.equal(respondConfigSchema.safeParse({ headers: { "x-request-id": "abc-123 ok" } }).success, true);
});

test("the same header twice under different cases is refused", () => {
  assert.equal(respondConfigSchema.safeParse({ headers: { ETag: "a", etag: "b" } }).success, false);
});

test("the receiver re-checks a recorded step: a row outside the allowlist answers nothing", () => {
  const step = (output: unknown, over = {}) => ({ seq: 1, nodeType: "core.respond", status: "succeeded", output, ...over });
  const good = { status: 202, headers: { "x-request-id": "r1" }, body: { ok: true } };
  assert.deepEqual(answerFromSteps([step(good)]), good);

  assert.equal(answerFromSteps([step({ ...good, status: 302 })]), null);
  assert.equal(answerFromSteps([step({ ...good, headers: { location: "https://evil.example" } })]), null);
  assert.equal(answerFromSteps([step({ ...good, headers: { "set-cookie": "a=b" } })]), null);
  assert.equal(answerFromSteps([step({ ...good, body: "not an object" })]), null);
  assert.equal(answerFromSteps([step({ ...good, body: { big: "x".repeat(MAX_RESPONSE_BODY_BYTES + 1) } })]), null);
  assert.equal(answerFromSteps([step(null)]), null);
});

test("only a Respond that succeeded counts, and the first one to run wins", () => {
  const out = (status: number) => ({ status, headers: {}, body: { n: status } });
  const steps = [
    { seq: 4, nodeType: "core.respond", status: "succeeded", output: out(202) },
    { seq: 2, nodeType: "core.respond", status: "succeeded", output: out(201) },
    { seq: 1, nodeType: "core.respond", status: "failed", output: out(200) },
    { seq: 0, nodeType: "core.set", status: "succeeded", output: out(299) },
    { seq: 3, nodeType: "core.respond", status: "skipped", output: out(203) },
  ];
  assert.equal(answerFromSteps(steps)?.status, 201);
  assert.equal(answerFromSteps([]), null);
  assert.equal(answerFromSteps(steps.filter((s) => s.nodeType !== "core.respond")), null);
});

test("the response is always JSON, always nosniff, and a 204 has no body", async () => {
  const response = responseFor({ status: 201, headers: { "Retry-After": "5", ETag: "e" }, body: { a: 1 } });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("retry-after"), "5");
  assert.deepEqual(await response.json(), { a: 1 });

  const empty = responseFor({ status: 204, headers: {}, body: { ignored: true } });
  assert.equal(empty.status, 204);
  assert.equal(await empty.text(), "");
});

/* ------------------------------------------------------------------ *
 * The node, and the engine
 * ------------------------------------------------------------------ */

const context = (): NodeContext => ({
  runId: "r",
  workflowId: "w",
  scope: TEST_SCOPE,
  nodeId: "respond",
  nodeType: "core.respond",
  iteration: 0,
  log: () => {},
  signal: new AbortController().signal,
});

test("the node refuses a body over the cap, with the size in its message", async () => {
  const config = respondConfigSchema.parse({ body: { big: "x".repeat(MAX_RESPONSE_BODY_BYTES) } });
  await assert.rejects(
    respondNode.execute({ config, input: {}, context: context() }),
    (error: unknown) => error instanceof NodeError && /at most 64 KB/.test(error.message),
  );
});

test("through the engine: a reply built from earlier data, by lookup only", async () => {
  const g = graph(
    [
      { id: "trigger", type: "core.webhook_trigger" },
      { id: "shape", type: "core.set", config: { fields: { total: "{{trigger.qty}}" } } },
      {
        id: "reply",
        type: "core.respond",
        config: {
          status: 202,
          headers: { "x-request-id": "req-{{trigger.qty}}" },
          body: { received: "{{steps.shape.output.total}}", note: "{{trigger.note}}" },
        },
      },
    ],
    [
      { source: "trigger", target: "shape" },
      { source: "shape", target: "reply" },
    ],
  );
  const outcome = await executeWorkflow({
    runId: "run_respond",
    workflowId: "wf_respond",
    scope: TEST_SCOPE,
    graph: g,
    input: { qty: 3, note: "hi" },
  });
  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(answerFromSteps(outcome.steps), {
    status: 202,
    headers: { "x-request-id": "req-3" },
    body: { received: 3, note: "hi" },
  });
});

test("through the engine: a Respond on a branch that was not taken answers nothing", async () => {
  const g = graph(
    [
      { id: "trigger", type: "core.webhook_trigger" },
      { id: "check", type: "core.branch", config: { left: "{{trigger.ok}}", operator: "equals", right: "yes" } },
      { id: "yes", type: "core.respond", config: { status: 200, body: { answer: "yes" } } },
      { id: "no", type: "core.respond", config: { status: 422, body: { answer: "no" } } },
    ],
    [
      { source: "trigger", target: "check" },
      { source: "check", target: "yes", sourceHandle: "true" },
      { source: "check", target: "no", sourceHandle: "false" },
    ],
  );
  const run = (ok: string) =>
    executeWorkflow({ runId: "r", workflowId: "w", scope: TEST_SCOPE, graph: g, input: { ok } });
  assert.equal(answerFromSteps((await run("yes")).steps)?.status, 200);
  assert.equal(answerFromSteps((await run("nope")).steps)?.status, 422);
});

test("through the engine: a Respond whose reference resolves to a status outside the allowlist fails the step, not the caller", async () => {
  const g = graph(
    [
      { id: "trigger", type: "core.webhook_trigger" },
      { id: "reply", type: "core.respond", config: { status: "{{trigger.code}}", body: {} } },
    ],
    [{ source: "trigger", target: "reply" }],
  );
  const outcome = await executeWorkflow({ runId: "r", workflowId: "w", scope: TEST_SCOPE, graph: g, input: { code: 302 } });
  assert.equal(outcome.status, "failed");
  assert.equal(answerFromSteps(outcome.steps), null);
});

test("a manual run passes straight through a Respond — it answers nobody, and the workflow carries on", async () => {
  const g = graph(
    [
      { id: "trigger", type: "core.webhook_trigger" },
      { id: "reply", type: "core.respond", config: { status: 200, body: { a: 1 } } },
      { id: "after", type: "core.log", config: { message: "carried on" } },
    ],
    [
      { source: "trigger", target: "reply" },
      { source: "reply", target: "after" },
    ],
  );
  const outcome = await executeWorkflow({ runId: "r", workflowId: "w", scope: TEST_SCOPE, graph: g, input: {} });
  assert.equal(outcome.status, "succeeded");
  assert.ok(outcome.steps.some((s) => s.nodeId === "after" && s.status === "succeeded"));
});

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

const withTrigger = (type: string) =>
  graph(
    [
      { id: "trigger", type, config: type === "core.form_trigger" ? {} : undefined },
      { id: "reply", type: "core.respond", config: {} },
    ],
    [{ source: "trigger", target: "reply" }],
  );

test("a Respond needs a webhook or a form to answer — any other trigger is a problem on the Respond itself", () => {
  for (const type of ["core.webhook_trigger", "core.form_trigger"]) {
    assert.equal(validateGraph(withTrigger(type)).valid, true, type);
  }
  for (const type of ["core.manual_trigger", "core.schedule_trigger", "core.error_trigger"]) {
    const result = validateGraph(withTrigger(type));
    const problem = result.problems.find((p) => p.code === "respond_without_caller");
    assert.ok(problem, type);
    assert.equal(problem?.nodeId, "reply");
  }
});
