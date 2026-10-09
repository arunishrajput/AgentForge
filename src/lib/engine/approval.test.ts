import assert from "node:assert/strict";
import { test } from "node:test";

import type { ApprovalDecision, ApprovalRequest } from "@/lib/approvals/rules";

import type { RunCursor } from "./cursor";
import { executeWorkflow } from "./execute";
import { graph, TEST_SCOPE } from "./fixtures";
import { planRetry } from "./retry";
import { CHECKPOINT_OK, type Checkpoint, type IssuedApproval, type RunRecorder, type StepRecord } from "./types";

/**
 * **Phase 38's critical path in the engine** (`CONTRACT.md` → *Approvals*): an approval records its
 * request, hands Ask its link, lets the run finish everything else it can, and puts it down; a
 * decision wakes it down Approved or Rejected; a timeout set to fail fails it. And **the link never
 * reaches anything the engine writes** — the one secret a run makes lives only in its memory.
 *
 * Against an in-memory recorder, like the rest of the engine suite (D18). What it cannot cover — the
 * approval row, the suspend write that wakes at once for a decision that beat it, the Cloud Tasks
 * delivery — is verified on the deployed service by `scripts/verify-api.mjs`.
 */

const TOKEN = "T".repeat(43);
const FRESH = "U".repeat(43);
const BASE = "https://agentforge.test";

function recording(options: { checkpoint?: (count: number) => Checkpoint; reissue?: boolean } = {}) {
  const requests: Array<ApprovalRequest & { nodeId: string; iteration: number; seq: number }> = [];
  const reissued: string[] = [];
  const written: unknown[] = [];
  const finished: StepRecord[] = [];
  let checkpoints = 0;
  const recorder: RunRecorder = {
    stepStarted: (step) => { written.push(structuredClone(step)); },
    stepFinished: (step) => {
      written.push(structuredClone(step));
      finished.push(structuredClone(step));
    },
    stepLogged: (step, entry) => { written.push(structuredClone(step), { ...entry }); },
    checkpoint: (cursor) => {
      written.push(structuredClone(cursor));
      checkpoints += 1;
      return options.checkpoint?.(checkpoints) ?? CHECKPOINT_OK;
    },
    requestApproval: async (request): Promise<IssuedApproval> => {
      requests.push(request);
      return { id: "ap-1", token: TOKEN, url: `${BASE}/approve#${TOKEN}` };
    },
    reissueApproval: async (id) => {
      reissued.push(id);
      return options.reissue === false ? null : { id, token: FRESH, url: `${BASE}/approve#${FRESH}` };
    },
  };
  return { recorder, requests, reissued, written, finished };
}

/** trigger → approve —Ask→ notify; —Approved→ yes; —Rejected→ no. */
const approvalGraph = (extra: { askTo?: string; config?: Record<string, unknown> } = {}) =>
  graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      {
        id: "approve",
        type: "core.approval",
        config: { message: "Refund {{input.amount}} to {{input.customer}}?", timeout: 2, timeoutUnit: "days", ...extra.config },
      },
      { id: "notify", type: "core.log", config: { message: "Decide here: {{input.url}} — {{input.message}}" } },
      { id: "yes", type: "core.log", config: { message: "approved by {{input.decidedBy.name}}: {{input.comment}}" } },
      { id: "no", type: "core.log", config: { message: "rejected" } },
    ],
    [
      { source: "trigger", target: "approve" },
      { source: "approve", target: extra.askTo ?? "notify", sourceHandle: "ask" },
      { source: "approve", target: "yes", sourceHandle: "approved" },
      { source: "approve", target: "no", sourceHandle: "rejected" },
    ],
  );

const run = (
  options: {
    recorder?: RunRecorder;
    allowWait?: boolean;
    resume?: { cursor: RunCursor; steps: readonly StepRecord[] };
    decision?: ApprovalDecision;
    graph?: ReturnType<typeof graph>;
  } = {},
) =>
  executeWorkflow({
    runId: "run_approval",
    workflowId: "wf_approval",
    scope: TEST_SCOPE,
    graph: options.graph ?? approvalGraph(),
    input: { amount: 250, customer: "Ada" },
    recorder: options.recorder ?? recording().recorder,
    allowWait: options.allowWait ?? true,
    resume: options.resume,
    decision: options.decision,
  });

const decision = (overrides: Partial<ApprovalDecision> = {}): ApprovalDecision => ({
  outcome: "approved",
  via: "member",
  decidedBy: { name: "Grace", email: "grace@example.com" },
  comment: "Within policy",
  decidedAt: new Date().toISOString(),
  ...overrides,
});

const statuses = (steps: readonly StepRecord[]) => steps.map((step) => [step.nodeId, step.status]);

test("an approval records its request, sends the link down Ask, and puts the run down until the timeout", async () => {
  const { recorder, requests } = recording();
  const before = Date.now();
  const outcome = await run({ recorder });

  assert.equal(outcome.stop, "waiting");
  assert.equal(outcome.status, null, "a waiting run's status is the caller's to write");
  // The Ask path ran before the run was put down — that is how the link gets sent — and nothing
  // after the decision did.
  assert.deepEqual(statuses(outcome.steps), [
    ["trigger", "succeeded"],
    ["approve", "running"],
    ["notify", "succeeded"],
  ]);

  // The request: the message resolved against the approval's input, nobody named, the default outcome.
  assert.equal(requests.length, 1);
  assert.equal(requests[0].message, "Refund 250 to Ada?");
  assert.equal(requests[0].approvers, null);
  assert.equal(requests[0].onTimeout, "reject");
  assert.deepEqual([requests[0].nodeId, requests[0].iteration, requests[0].seq], ["approve", 0, 1]);
  assert.ok(Math.abs(Date.parse(requests[0].expiresAt) - (before + 2 * 86_400_000)) < 5_000);

  // The run wakes at the timeout, and the cursor says what it is waiting for — not a delay.
  assert.equal(outcome.wakeAt, requests[0].expiresAt);
  assert.deepEqual(outcome.cursor!.approval, { seq: 1, until: requests[0].expiresAt, id: "ap-1" });
  assert.equal(outcome.cursor!.wait, undefined);
  assert.deepEqual(outcome.cursor!.queue, [], "the decision's successors are not queued: the decision chooses them");
  assert.equal(outcome.cursor!.executions.approve, 1);
});

/** Ask → a check that passes only if the step was handed the working link for `token`. */
const provingGraph = (token: string) =>
  graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "approve", type: "core.approval", config: { message: "Refund {{input.amount}} to {{input.customer}}?" } },
      { id: "check", type: "core.assert", config: { left: "{{input.url}}", operator: "contains", right: `#${token}`, message: "No working link." } },
      { id: "notify", type: "core.log", config: { message: "Decide here: {{input.url}} — {{input.message}}" } },
    ],
    [
      { source: "trigger", target: "approve" },
      { source: "approve", target: "check", sourceHandle: "ask" },
      { source: "check", target: "notify" },
    ],
  );

test("the link reaches the step that sends it, and nothing the engine writes or returns", async () => {
  const { recorder, written } = recording();
  const outcome = await run({ recorder, graph: provingGraph(TOKEN) });

  // The check passed, so the step after Ask was handed the link that works.
  assert.equal(outcome.stop, "waiting", JSON.stringify(outcome.steps.map((step) => step.error)));
  assert.equal(outcome.steps.find((step) => step.nodeId === "check")!.status, "succeeded");

  // The Ask step read a link that works — its log line is the message it would have sent...
  const notify = outcome.steps.find((step) => step.nodeId === "notify")!;
  assert.equal(notify.logs[0].message, `Decide here: ${BASE}/approve#[removed] — Refund 250 to Ada?`);

  // ...but every write, and the outcome handed back, has the token removed.
  const everything = JSON.stringify([written, outcome]);
  assert.equal(everything.includes(TOKEN), false, "the token was written down somewhere");
  assert.ok(everything.includes(`${BASE}/approve#[removed]`));

  // What Ask handed on, as kept: the request's id, the message and the deadline — and the link removed.
  const approve = outcome.steps.find((step) => step.nodeId === "approve")!;
  assert.deepEqual(Object.keys(approve.output as object).sort(), ["approvalId", "expiresAt", "message", "url"]);
  assert.equal((approve.output as { url: string }).url, `${BASE}/approve#[removed]`);
});

test("a decision wakes it down Approved: the step finishes with who decided, and Rejected is skipped", async () => {
  const first = await run();
  const { recorder, finished } = recording();
  const outcome = await run({ recorder, resume: { cursor: first.cursor!, steps: first.steps }, decision: decision() });

  assert.equal(outcome.stop, "finished");
  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(statuses(outcome.steps), [
    ["trigger", "succeeded"],
    ["approve", "succeeded"],
    ["notify", "succeeded"],
    ["yes", "succeeded"],
    ["no", "skipped"],
  ]);

  const approve = outcome.steps.find((step) => step.nodeId === "approve")!;
  assert.equal(approve.branch, "approved");
  assert.ok(approve.finishedAt, "it finishes on the decision, so its duration is the wait");
  assert.deepEqual(approve.output, {
    approvalId: "ap-1",
    decision: "approved",
    via: "member",
    decidedBy: { name: "Grace", email: "grace@example.com" },
    comment: "Within policy",
    decidedAt: (approve.output as { decidedAt: string }).decidedAt,
    message: "Refund 250 to Ada?",
  });
  assert.equal(approve.logs.at(-1)?.message, "Approved by Grace. “Within policy”");

  // The Approved step read the decision as its input.
  const yes = outcome.steps.find((step) => step.nodeId === "yes")!;
  assert.equal(yes.logs[0].message, "approved by Grace: Within policy");
  // The approval's completion was recorded before anything after it ran.
  assert.deepEqual(finished.map((step) => step.nodeId).slice(0, 2), ["approve", "yes"]);
  assert.equal(outcome.cursor!.approval, undefined, "the cursor stops carrying a decided approval");
});

test("a rejection — by the link or by a timeout set to reject — goes down Rejected", async () => {
  for (const via of ["link", "timeout"] as const) {
    const first = await run();
    const outcome = await run({
      resume: { cursor: first.cursor!, steps: first.steps },
      decision: decision({ outcome: "rejected", via, decidedBy: null, comment: null }),
    });
    assert.equal(outcome.status, "succeeded");
    const approve = outcome.steps.find((step) => step.nodeId === "approve")!;
    assert.equal(approve.branch, "rejected");
    assert.equal(approve.logs.at(-1)?.message, via === "link" ? "Rejected through the link." : "Rejected when nobody decided in time.");
    assert.equal(outcome.steps.find((step) => step.nodeId === "no")!.status, "succeeded");
    assert.equal(outcome.steps.find((step) => step.nodeId === "yes")!.status, "skipped");
  }
});

test("a timeout set to fail fails the step and the run, and nothing after it runs", async () => {
  const first = await run();
  const outcome = await run({
    resume: { cursor: first.cursor!, steps: first.steps },
    decision: decision({ outcome: "expired", via: "timeout", decidedBy: null, comment: null }),
  });
  assert.equal(outcome.status, "failed");
  const approve = outcome.steps.find((step) => step.nodeId === "approve")!;
  assert.equal(approve.status, "failed");
  assert.match(approve.error!, /Nobody decided before the timeout/);
  assert.match(outcome.error!, /"approve" \(core\.approval\) failed/);
  assert.equal(outcome.steps.find((step) => step.nodeId === "yes")!.status, "skipped");
  assert.equal(outcome.steps.find((step) => step.nodeId === "no")!.status, "skipped");
  assert.equal(outcome.unsettledApproval, undefined, "a timeout settled it — there is nothing left to close");
});

test("resumed undecided mid-Ask, the step still to send gets a new link, and the run waits again", async () => {
  // A container lost after the approval's checkpoint and before the Ask step ran: the redelivery
  // finds the request pending and the Ask step still queued. The minted plaintext died with the
  // first attempt, so the request gets a new token — and the step sends the link that works.
  const lost = recording({ checkpoint: (count) => (count === 2 ? { cancelRequested: false, leaseHeld: false } : CHECKPOINT_OK) });
  const first = await run({ recorder: lost.recorder });
  assert.equal(first.stop, "interrupted");
  const cursor: RunCursor = {
    queue: [{ nodeId: "notify", fromSeq: 1 }],
    executions: { trigger: 1, approve: 1 },
    seq: 2,
    approval: { seq: 1, until: lost.requests[0].expiresAt, id: "ap-1" },
  };
  const steps = first.steps.filter((step) => step.nodeId !== "notify");
  // The row holds what the first attempt wrote: the link removed.
  assert.equal((steps[1].output as { url: string }).url, `${BASE}/approve#[removed]`);

  const again = recording();
  const outcome = await run({
    recorder: again.recorder,
    resume: { cursor: { ...cursor, queue: [{ nodeId: "check", fromSeq: 1 }] }, steps },
    graph: provingGraph(FRESH),
  });
  assert.deepEqual(again.reissued, ["ap-1"]);
  assert.equal(outcome.stop, "waiting", JSON.stringify(outcome.steps.map((step) => step.error)));
  // The check passed only because it was handed the fresh link, not the removed one.
  assert.equal(outcome.steps.find((step) => step.nodeId === "check")!.status, "succeeded");
  assert.equal(outcome.steps.find((step) => step.nodeId === "notify")!.status, "succeeded");
  // In memory the step sent the fresh link; written down, both tokens are gone.
  assert.equal(JSON.stringify([again.written, outcome]).includes(FRESH), false);
  assert.equal(again.requests.length, 0, "a resume never makes a second request");
});

test("resumed undecided with the Ask path already done, nothing is re-minted — a sent link stays good", async () => {
  const first = await run();
  const again = recording();
  const outcome = await run({ recorder: again.recorder, resume: { cursor: first.cursor!, steps: first.steps } });
  assert.equal(outcome.stop, "waiting");
  assert.deepEqual(again.reissued, []);
  assert.deepEqual(outcome.cursor!.approval, first.cursor!.approval);
});

test("while an approval is outstanding nothing else may wait, and the refusal closes the approval", async () => {
  const pausing = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "approve", type: "core.approval", config: { message: "ok?" } },
      { id: "hold", type: "core.delay", config: { amount: 1, unit: "hours" } },
    ],
    [
      { source: "trigger", target: "approve" },
      { source: "approve", target: "hold", sourceHandle: "ask" },
    ],
  );
  const outcome = await run({ graph: pausing });
  assert.equal(outcome.status, "failed");
  const hold = outcome.steps.find((step) => step.nodeId === "hold")!;
  assert.match(hold.error!, /already waiting for a decision at "approve", and a run waits for one thing at a time/);
  const approve = outcome.steps.find((step) => step.nodeId === "approve")!;
  assert.equal(approve.status, "failed", "a finished run holds no running step");
  assert.equal(approve.error, "The run stopped before anybody decided.");
  assert.equal(outcome.unsettledApproval, "ap-1", "the caller closes the request, which kills its link");
});

test("a failure on the Ask path fails the run and closes the approval", async () => {
  const failing = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "approve", type: "core.approval", config: { message: "ok?" } },
      { id: "check", type: "core.assert", config: { left: "", operator: "is_not_empty", message: "Could not send." } },
    ],
    [
      { source: "trigger", target: "approve" },
      { source: "approve", target: "check", sourceHandle: "ask" },
    ],
  );
  const outcome = await run({ graph: failing });
  assert.equal(outcome.status, "failed");
  assert.match(outcome.error!, /Could not send/, "the run's failure is the step that failed, not the approval");
  assert.equal(outcome.unsettledApproval, "ap-1");
  assert.deepEqual(statuses(outcome.steps).slice(0, 3), [
    ["trigger", "succeeded"],
    ["approve", "failed"],
    ["check", "failed"],
  ]);
});

test("a stop asked for while the Ask path runs cancels the run and closes the approval", async () => {
  const { recorder } = recording({ checkpoint: (count) => (count === 2 ? { cancelRequested: true, leaseHeld: true } : CHECKPOINT_OK) });
  const outcome = await run({ recorder });
  assert.equal(outcome.status, "cancelled");
  assert.equal(outcome.unsettledApproval, "ap-1");
  const approve = outcome.steps.find((step) => step.nodeId === "approve")!;
  assert.equal(approve.error, "The run was cancelled before anybody decided.");
});

test("where nothing could resume it, an approval fails its step before asking anybody", async () => {
  const { recorder, requests } = recording();
  const outcome = await run({ recorder, allowWait: false });
  assert.equal(outcome.status, "failed");
  assert.match(outcome.steps.find((step) => step.nodeId === "approve")!.error!, /no queue is configured here/);
  assert.equal(requests.length, 0);
  assert.equal(outcome.unsettledApproval, undefined);
});

test("an approval with nothing on Ask is still asked — it waits in the inbox and on the canvas", async () => {
  const silent = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "approve", type: "core.approval", config: { message: "ok?", approvers: "Ada@Example.com, grace@example.com" } },
      { id: "yes", type: "core.log", config: { message: "yes" } },
    ],
    [
      { source: "trigger", target: "approve" },
      { source: "approve", target: "yes", sourceHandle: "approved" },
    ],
  );
  const { recorder, requests } = recording();
  const outcome = await run({ recorder, graph: silent });
  assert.equal(outcome.stop, "waiting");
  assert.deepEqual(requests[0].approvers, ["ada@example.com", "grace@example.com"]);
  assert.match(outcome.steps[1].logs.at(-1)!.message, /Nothing is connected to Ask/);
});

test("a named approver that is not an address fails the step with the reason", async () => {
  const outcome = await run({ graph: approvalGraph({ config: { approvers: "{{input.customer}}" } }) });
  assert.equal(outcome.status, "failed");
  assert.match(outcome.steps[1].error!, /"ada" is not an email address/);
});

test("a retry of a run that failed after its decision starts there — the approval and its Ask path reused", async () => {
  const failingAfter = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "approve", type: "core.approval", config: { message: "ok?" } },
      { id: "notify", type: "core.log", config: { message: "{{input.url}}" } },
      { id: "refund", type: "core.assert", config: { left: "", operator: "is_not_empty", message: "Refund API down." } },
      { id: "no", type: "core.log", config: { message: "rejected" } },
    ],
    [
      { source: "trigger", target: "approve" },
      { source: "approve", target: "notify", sourceHandle: "ask" },
      { source: "approve", target: "refund", sourceHandle: "approved" },
      { source: "approve", target: "no", sourceHandle: "rejected" },
    ],
  );
  const first = await run({ graph: failingAfter });
  const finished = await run({
    graph: failingAfter,
    resume: { cursor: first.cursor!, steps: first.steps },
    decision: decision(),
  });
  assert.equal(finished.status, "failed");

  const plan = planRetry({
    original: failingAfter,
    current: failingAfter,
    triggerNodeId: "trigger",
    steps: finished.steps,
    passesThrough: () => true,
  });
  assert.ok("reused" in plan, JSON.stringify(plan));
  assert.equal(plan.from, "refund");
  assert.deepEqual(
    plan.reused.map((step) => [step.nodeId, step.status]),
    [
      ["trigger", "reused"],
      ["approve", "reused"],
      ["notify", "reused"],
    ],
  );
  assert.deepEqual(plan.cursor.queue, [{ nodeId: "refund", fromSeq: 1 }]);
});

test("a retry of a run whose Ask path failed asks again — the closed approval is where it stopped", async () => {
  const failing = graph(
    [
      { id: "trigger", type: "core.manual_trigger" },
      { id: "approve", type: "core.approval", config: { message: "ok?" } },
      { id: "send", type: "core.assert", config: { left: "", operator: "is_not_empty", message: "Could not send." } },
    ],
    [
      { source: "trigger", target: "approve" },
      { source: "approve", target: "send", sourceHandle: "ask" },
    ],
  );
  const outcome = await run({ graph: failing });
  const plan = planRetry({
    original: failing,
    current: failing,
    triggerNodeId: "trigger",
    steps: outcome.steps,
    passesThrough: () => true,
  });
  assert.ok("reused" in plan, JSON.stringify(plan));
  assert.equal(plan.from, "approve", "a void request cannot be decided, so the retry makes a new one");
});
