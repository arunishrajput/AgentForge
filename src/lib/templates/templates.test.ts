import assert from "node:assert/strict";
import { test } from "node:test";

import { executeWorkflow } from "@/lib/engine/execute";
import { TEST_SCOPE } from "@/lib/engine/fixtures";
import { CHECKPOINT_OK, type RunRecorder, type StepRecord } from "@/lib/engine/types";
import { validateGraph } from "@/lib/engine/validate";
import { getNode } from "@/lib/nodes";
import { workflowGraphSchema } from "@/lib/workflow/graph";

import {
  describeTemplate,
  describeTemplates,
  getTemplate,
  reachesNoService,
  TEMPLATES,
} from "./catalogue";

/**
 * **This file is the reason templates are allowed to exist** — Phase 23A.
 *
 * `BUILD_PLAN.md` asks for templates that "are actually run in tests, so they cannot
 * rot". A gallery of stored graphs is otherwise the most rot-prone thing a product like
 * this can have: nothing type-checks a node type inside a JSON blob, so a rename in a
 * later phase leaves a template that looks fine in the gallery, clones happily, and
 * fails the moment somebody presses Run.
 *
 * So every template is validated against the **real registry**, and every template that
 * reaches no service is **executed through the real engine** — no mocks, no fakes, no
 * stub node table. The engine takes its recorder as an argument, so this needs no
 * database and no network.
 */

function recording(): { recorder: RunRecorder; finished: StepRecord[] } {
  const finished: StepRecord[] = [];
  return {
    finished,
    recorder: {
      stepStarted: () => {},
      stepFinished: (step) => {
        finished.push({ ...step });
      },
      // `CHECKPOINT_OK` rather than a hand-rolled object: a checkpoint that does not
      // report holding the lease makes the engine stand down mid-run and return a
      // `null` status, which reads as a broken template rather than a broken stub.
      checkpoint: () => CHECKPOINT_OK,
    },
  };
}

test("the gallery is not empty and every id is a unique slug", () => {
  assert.ok(TEMPLATES.length >= 6);
  const ids = TEMPLATES.map((template) => template.id);
  assert.equal(new Set(ids).size, ids.length, "ids must be unique — they are URLs");
  for (const id of ids) assert.match(id, /^[a-z][a-z0-9-]{2,40}$/, id);
});

test("every template is a well-formed graph the schema accepts", () => {
  for (const template of TEMPLATES) {
    const parsed = workflowGraphSchema.safeParse(template.graph);
    assert.ok(parsed.success, `${template.id}: ${parsed.error?.message}`);
  }
});

test("every template passes the SAME validation a user's own graph must pass", () => {
  // Not a weaker check for being built-in. A template that cannot run is worse than no
  // template, because the user assumes the fault is theirs.
  for (const template of TEMPLATES) {
    const result = validateGraph(template.graph);
    assert.ok(
      result.valid,
      `${template.id} is invalid: ${result.problems.map((problem) => problem.message).join("; ")}`,
    );
    assert.ok(result.triggerNodeId, `${template.id} has no trigger`);
  }
});

test("every node type in every template is in the registry", () => {
  // The rot this file exists to catch: a type renamed in a later phase.
  for (const template of TEMPLATES) {
    for (const node of template.graph.nodes) {
      assert.ok(getNode(node.type), `${template.id} uses unknown node type "${node.type}"`);
    }
  }
});

test("every edge leaves through a handle its source node actually declares", () => {
  // `unknown_output_handle` is caught by validateGraph too, but this asserts it per edge
  // with the template named, which is the difference between a useful failure and a
  // puzzle.
  for (const template of TEMPLATES) {
    const byId = new Map(template.graph.nodes.map((node) => [node.id, node]));
    for (const edge of template.graph.edges) {
      const source = byId.get(edge.source);
      assert.ok(source, `${template.id}: edge ${edge.id} leaves a node that does not exist`);
      const declared = new Set(getNode(source.type)?.outputs.map((output) => output.key));
      assert.ok(
        declared.has(edge.sourceHandle ?? null),
        `${template.id}: edge ${edge.id} uses handle "${edge.sourceHandle}", which ${source.type} does not declare`,
      );
    }
  }
});

test("no two nodes in a template sit on top of each other", () => {
  // A template's whole value is opening as a readable graph. Two nodes at the same point
  // look like one node, and the user cannot find the second.
  for (const template of TEMPLATES) {
    const seen = new Set<string>();
    for (const node of template.graph.nodes) {
      const key = `${node.position.x},${node.position.y}`;
      assert.ok(!seen.has(key), `${template.id}: two nodes share position ${key}`);
      seen.add(key);
    }
  }
});

test("every template that reaches no service RUNS, end to end, through the real engine", async () => {
  const offline = TEMPLATES.filter(reachesNoService);
  assert.ok(offline.length >= 4, "most of the gallery should be runnable with nothing configured");

  for (const template of offline) {
    const { recorder, finished } = recording();
    const outcome = await executeWorkflow({
      runId: `run-${template.id}`,
      workflowId: `wf-${template.id}`,
      scope: TEST_SCOPE,
      graph: template.graph,
      input: template.sampleInput ?? null,
      recorder,
    });

    assert.equal(outcome.status, "succeeded", `${template.id} did not succeed`);

    const failed = finished.filter((step) => step.status === "failed");
    assert.deepEqual(
      failed.map((step) => `${step.nodeId}: ${step.error}`),
      [],
      `${template.id} had failed steps`,
    );

    // A template every one of whose steps was skipped would "succeed" while doing
    // nothing at all — the switch templates route past most of their nodes by design,
    // so the bar is that real work happened, not that everything ran.
    const succeeded = finished.filter((step) => step.status === "succeeded");
    assert.ok(succeeded.length >= 3, `${template.id} only ran ${succeeded.length} step(s)`);
  }
});

test("rank-and-report actually computes the right answer, not merely a status", async () => {
  // Executing a graph proves it does not throw. This proves it is *correct*: three of
  // the five sample rows score over 50, and the summary names them best-first.
  const template = getTemplate("rank-and-report");
  assert.ok(template);

  const { recorder, finished } = recording();
  const outcome = await executeWorkflow({
    runId: "run-rank",
    workflowId: "wf-rank",
    scope: TEST_SCOPE,
    graph: template.graph,
    recorder,
  });
  assert.equal(outcome.status, "succeeded");

  const joined = finished.find((step) => step.nodeId === "names");
  assert.ok(joined, "the join step ran");
  assert.equal((joined.output as { value: string }).value, "Katherine, Ada, Grace, Edsger");

  const report = finished.find((step) => step.nodeId === "report");
  assert.match(
    report?.logs.at(-1)?.message ?? "",
    /^4 of 5 scored over 50: Katherine, Ada, Grace, Edsger$/,
  );
});

test("tidy-list folds case BEFORE splitting, so the count is the one a user expects", async () => {
  const template = getTemplate("tidy-list");
  assert.ok(template);

  const { recorder, finished } = recording();
  await executeWorkflow({
    runId: "run-tidy",
    workflowId: "wf-tidy",
    scope: TEST_SCOPE,
    graph: template.graph,
    input: template.sampleInput ?? null,
    recorder,
  });

  // "billing, urgent, billing, refund, Urgent, refund" holds three distinct tags. The
  // first draft of this template scored 5, because it split on "," and left a leading
  // space on every piece and never folded the case — both repeats survived and the
  // template taught a bug. This assertion is what pins the fix.
  const total = finished.find((step) => step.nodeId === "total");
  assert.ok(total, "the count step ran");
  assert.equal((total.output as { value: number }).value, 3);

  const ordered = finished.find((step) => step.nodeId === "ordered");
  assert.ok(ordered, "the sort step ran");
  assert.deepEqual((ordered.output as { items: string[] }).items, ["billing", "refund", "urgent"]);
});

test("triage-webhook routes urgent to the urgent path and skips the others", async () => {
  const template = getTemplate("triage-webhook");
  assert.ok(template);

  const { recorder, finished } = recording();
  await executeWorkflow({
    runId: "run-triage",
    workflowId: "wf-triage",
    scope: TEST_SCOPE,
    graph: template.graph,
    input: { priority: "urgent", message: "The checkout page is down" },
    recorder,
  });

  const byNode = new Map(finished.map((step) => [step.nodeId, step]));
  assert.equal(byNode.get("page")?.status, "succeeded");
  assert.equal(byNode.get("queue")?.status, "skipped");
  assert.equal(byNode.get("file")?.status, "skipped");
  assert.match(byNode.get("page")?.logs.at(-1)?.message ?? "", /URGENT/);

  // And the fallback really is reachable — a switch whose else never fires would be a
  // template that lies about having three destinations.
  const other = recording();
  await executeWorkflow({
    runId: "run-triage-2",
    workflowId: "wf-triage",
    scope: TEST_SCOPE,
    graph: template.graph,
    input: { priority: "whenever", message: "A typo on the about page" },
    recorder: other.recorder,
  });
  const second = new Map(other.finished.map((step) => [step.nodeId, step]));
  assert.equal(second.get("file")?.status, "succeeded");
  assert.equal(second.get("page")?.status, "skipped");
});

test("the templates that need setup say so, and the rest say nothing", () => {
  // `requires` is what the gallery card warns about. An empty one is a promise that
  // cloning and pressing Run works.
  const needing = TEMPLATES.filter((template) => template.requires.length > 0);
  assert.deepEqual(
    needing.map((template) => template.id),
    // Phase 23B's four each need a credential only the user can create, so each one says so
    // on its card. Pinned rather than counted: a template that quietly loses its `requires`
    // becomes a promise that cloning and pressing Run works, which is the one thing a card
    // must not claim falsely.
    ["classify-and-route", "slack-standup", "notion-run-log", "webhook-to-github", "airtable-inbox"],
  );
  for (const template of needing) {
    for (const line of template.requires) assert.ok(line.length > 10, template.id);
  }
});

test("reachesNoService is derived from the graph and agrees with what the graphs hold", () => {
  const offline = TEMPLATES.filter(reachesNoService).map((template) => template.id);
  // Unchanged by Phase 23B, and that is the assertion: four templates reaching Slack, Notion,
  // GitHub and Airtable must not join the set this suite *executes*, or `npm test` would post
  // to somebody's real channel. `reachesNoService` reads the node types rather than `requires`,
  // so it cannot be got wrong by forgetting to declare something.
  assert.deepEqual(offline, ["rank-and-report", "tidy-list", "triage-webhook", "daily-digest"]);
  // The distinction it draws is not the same one `requires` draws, and that is the point.
  const fetcher = getTemplate("fetch-and-summarise");
  assert.ok(fetcher);
  assert.deepEqual(fetcher.requires, [], "it needs no setup");
  assert.equal(reachesNoService(fetcher), false, "but it does call an API");
});

test("describeTemplate gives the gallery what it needs and no graph", () => {
  const summaries = describeTemplates();
  assert.equal(summaries.length, TEMPLATES.length);
  assert.deepEqual(JSON.parse(JSON.stringify(summaries)), summaries, "plain JSON only");

  const summary = describeTemplate(TEMPLATES[0]);
  assert.equal(summary.nodeCount, TEMPLATES[0].graph.nodes.length);
  assert.equal(new Set(summary.uses).size, summary.uses.length, "the chips are distinct");
  assert.ok(!("graph" in summary), "the graph is large and the gallery does not read it");
});

test("getTemplate answers for every id and for nothing else", () => {
  for (const template of TEMPLATES) assert.equal(getTemplate(template.id)?.id, template.id);
  assert.equal(getTemplate("nope"), undefined);
  assert.equal(getTemplate("__proto__"), undefined);
});
