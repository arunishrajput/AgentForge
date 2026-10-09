import assert from "node:assert/strict";
import { test } from "node:test";

import { executeWorkflow } from "@/lib/engine/execute";
import { graph, TEST_SCOPE } from "@/lib/engine/fixtures";
import { TRIGGER_KINDS } from "@/lib/engine/types";
import { REMOVED } from "@/lib/generate/scrub";

import {
  alertsFor,
  ERROR_TRIGGER_TYPE,
  FAILURE_ERROR_MAX,
  failurePayload,
  readFailure,
  sampleFailure,
} from "./failure";

/**
 * **Who hears about a failure — Phase 37, D176 and D177.** The rules are pure, so they are held
 * here clause by clause; the writes are exercised against the deployed service by `verify-api.mjs`.
 */

test("a failure nobody was watching is told: a webhook's, a form's (Phase 40), a schedule's", () => {
  for (const trigger of ["webhook", "form", "schedule"] as const) {
    assert.deepEqual(alertsFor({ trigger, test: null }), { inbox: true, errorWorkflows: true }, trigger);
  }
});

test("a run somebody pressed Run on is not — they were told on the canvas", () => {
  assert.deepEqual(alertsFor({ trigger: "manual", test: null }), { inbox: false, errorWorkflows: false });
});

test("a test is never told to anybody, whatever started it", () => {
  for (const trigger of TRIGGER_KINDS) {
    assert.deepEqual(
      alertsFor({ trigger, test: { scope: "workflow", nodeId: null } }),
      { inbox: false, errorWorkflows: false },
      trigger,
    );
  }
});

test("an error workflow that fails reaches the inbox and nothing else — it cannot set off another", () => {
  // The cascade bound: depth one. An error workflow whose Slack connection was revoked is told to
  // the inbox, and stops there.
  assert.deepEqual(alertsFor({ trigger: "error", test: null }), { inbox: true, errorWorkflows: false });
});

test("every trigger kind has a stated answer", () => {
  // A kind added later — Phase 39's child runs — must be decided, not fall through to a default.
  for (const trigger of TRIGGER_KINDS) {
    const answer = alertsFor({ trigger, test: null });
    assert.equal(typeof answer.inbox, "boolean", trigger);
  }
  assert.deepEqual(alertsFor({ trigger: "agent", test: null }), { inbox: false, errorWorkflows: false });
});

/* ------------------------------------------------------------------ *
 * The payload
 * ------------------------------------------------------------------ */

const base = {
  baseUrl: "https://agentforge.example/",
  workflow: { id: "wf-1", name: "Invoice sync" },
  run: { id: "run-1", trigger: "webhook", startedAt: new Date("2026-10-09T08:00:00.000Z"), error: 'Node "post" failed: 403' },
};

test("the payload names the workflow, the run with a link to it, the step and the step's own error", () => {
  const payload = failurePayload({
    ...base,
    step: { nodeId: "post", nodeType: "integration.slack", label: "Post to Slack", error: "Slack refused the message (403)." },
  });
  assert.deepEqual(payload, {
    workflow: { id: "wf-1", name: "Invoice sync" },
    run: { id: "run-1", trigger: "webhook", startedAt: "2026-10-09T08:00:00.000Z", url: "https://agentforge.example/runs/run-1" },
    failedStep: { id: "post", label: "Post to Slack", type: "integration.slack" },
    error: "Slack refused the message (403).",
  });
  assert.deepEqual(readFailure(payload), payload, "the trigger reads back what was handed to it");
});

test("a run that stopped between steps hands on the run's own words and no step", () => {
  const payload = failurePayload({ ...base, step: null, run: { ...base.run, error: "Run exceeded its time limit." } });
  assert.equal(payload.failedStep, null);
  assert.equal(payload.error, "Run exceeded its time limit.");
});

test("nothing shaped like a stored credential rides along into somebody's Slack message (D168)", () => {
  const discord = "https://discord.com/api/webhooks/123456789/abcdefghijklmnopqrstuvwxyz_ABCDEF";
  const payload = failurePayload({
    ...base,
    workflow: { id: "wf-1", name: "Sync ghp_abcdefghijklmnopqrstuvwxyz0123" },
    step: {
      nodeId: "post",
      nodeType: "integration.http",
      label: "Call AIzaSyA1234567890abcdefghijklmnopqrstu",
      error: `POST ${discord} answered 400`,
    },
  });
  const text = JSON.stringify(payload);
  assert.ok(!text.includes("ghp_"), "a GitHub token in the workflow's name");
  assert.ok(!text.includes("AIza"), "a Gemini key in a step's label");
  assert.ok(!text.includes("abcdefghijklmnopqrstuvwxyz_ABCDEF"), "a Discord webhook in the error");
  assert.ok(text.includes(REMOVED));
});

test("scrubbed before it is cut, so half a secret cannot survive the cut", () => {
  // A token straddling the limit: cut first, the half left would no longer match its shape.
  const pad = "x".repeat(FAILURE_ERROR_MAX - 10);
  const payload = failurePayload({
    ...base,
    step: { nodeId: "n", nodeType: "core.log", label: "n", error: `${pad} ghp_abcdefghijklmnopqrstuvwxyz0123` },
  });
  assert.ok(!payload.error.includes("ghp_"));
  assert.ok(payload.error.length <= FAILURE_ERROR_MAX + 1);
});

test("an input that is not a failure is not read as one", () => {
  assert.equal(readFailure(null), null);
  assert.equal(readFailure({}), null);
  assert.equal(readFailure({ error: "close, but no workflow" }), null);
});

/* ------------------------------------------------------------------ *
 * The node
 * ------------------------------------------------------------------ */

const errorWorkflow = () =>
  graph(
    [
      { id: "trigger", type: ERROR_TRIGGER_TYPE },
      { id: "say", type: "core.log", config: { message: "{{trigger.workflow.name}} failed: {{trigger.error}}" } },
    ],
    [{ source: "trigger", target: "say" }],
  );

test("an error trigger hands on the failure it was started with", async () => {
  const payload = failurePayload({
    ...base,
    step: { nodeId: "post", nodeType: "integration.slack", label: "Post to Slack", error: "403" },
  });
  const outcome = await executeWorkflow({
    runId: "r",
    workflowId: "w",
    scope: TEST_SCOPE,
    graph: errorWorkflow(),
    input: payload,
  });
  assert.equal(outcome.status, "succeeded");
  const say = outcome.steps.find((step) => step.nodeId === "say")!;
  assert.equal((say.config as { message: string }).message, "Invoice sync failed: 403");
});

test("run by hand it hands on a sample, said so, so the alert after it can be tried", async () => {
  const outcome = await executeWorkflow({ runId: "r", workflowId: "w", scope: TEST_SCOPE, graph: errorWorkflow(), input: {} });
  assert.equal(outcome.status, "succeeded");
  const trigger = outcome.steps.find((step) => step.nodeId === "trigger")!;
  assert.equal((trigger.output as { sample?: boolean }).sample, true);
  assert.ok(trigger.logs.some((line) => /sample failure/.test(line.message)));
  // Every field a reference might read is there.
  const sample = sampleFailure("");
  assert.ok(sample.failedStep && sample.workflow.name && sample.run.url && sample.error);
});
