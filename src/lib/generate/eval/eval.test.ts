import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { validateGraph } from "@/lib/engine/validate";
import { describeNodes, hasNode } from "@/lib/nodes";
import { GRAPH_VERSION } from "@/lib/workflow/graph";

import { DEMO_PROMPT as SCRIPT_DEMO_PROMPT } from "../../../../scripts/demo-payload.mjs";
import type { GenerationResult } from "../generate";
import { checkReferences } from "../references";
import { selectDeterministic, withTypes } from "../select";
import { assembleGraph } from "../generate";
import { DEMO_PROMPT, EVAL_CASES, type EvalCase } from "./cases";
import { caseRun, DIAGNOSE_CASES, EXPLAIN_CASES, type DiagnoseEvalCase, type ExplainEvalCase } from "./diagnose-cases";
import { EDIT_CASES, STARTS, type EditEvalCase } from "./edit-cases";
import {
  replayCase,
  replayDiagnoseCase,
  replayEditCase,
  replayExplainCase,
  replayModel,
  startGraph,
  type Recording,
} from "./run";
import { describeRequirement, requirementMet, scoreCase, scoreDiagnosis, scoreEdit, scoreExplanation } from "./score";

/**
 * **The eval set, offline, on every push — Phase 34.**
 *
 * Three things are held here without a network call:
 *
 *  1. **The selector never drops a node a case requires.** Exact, because the deterministic
 *     selector is a function of the request. This is the gate `BUILD_PLAN.md` asked for: "the eval
 *     set is how the selector is proved not to drop a node the request needed".
 *  2. **Every recording replays to the verdict it was recorded with.** A recording is what a real
 *     model said; replaying it through today's parse, assemble, validate and scorer must judge it
 *     the same way. A change that flips a verdict is a change in what generation accepts or how it
 *     is scored — make it deliberately, then update the recording's `verdict` in the same commit.
 *  3. **The cases themselves are well formed** — real node types, unique ids, the demo prompt the
 *     smoke walk uses.
 */

const RECORDINGS = path.join(process.cwd(), "src/lib/generate/eval/recordings");
const nodes = describeNodes();

test("the eval set is about twenty cases, ids unique, and some held out", () => {
  assert.ok(EVAL_CASES.length >= 20, `${EVAL_CASES.length} cases`);
  assert.equal(new Set(EVAL_CASES.map((entry) => entry.id)).size, EVAL_CASES.length);
  for (const entry of EVAL_CASES) assert.match(entry.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, entry.id);
  assert.ok(EVAL_CASES.filter((entry) => entry.heldOut).length >= 5);
  assert.ok(EVAL_CASES.some((entry) => entry.unsupported === true), "a case must test honesty about the impossible");
});

test("every node type a case names is registered", () => {
  // A renamed node must fail here, not quietly turn a requirement into one nothing can meet.
  for (const entry of EVAL_CASES) {
    const named = [entry.trigger, ...(entry.requires ?? []).flat(), ...(entry.forbids ?? [])].filter(
      (type): type is string => type !== undefined,
    );
    for (const type of named) assert.ok(hasNode(type), `${entry.id} names ${type}`);
  }
});

test("the demo case is the smoke walk's demo prompt, word for word", () => {
  assert.equal(DEMO_PROMPT, SCRIPT_DEMO_PROMPT);
});

test("the selector gives every case every node it requires", () => {
  const misses: string[] = [];
  for (const entry of EVAL_CASES) {
    const selected = new Set(selectDeterministic(entry.prompt, nodes).types);
    for (const requirement of entry.requires ?? []) {
      if (!requirementMet(requirement, selected)) misses.push(`${entry.id}: ${describeRequirement(requirement)}`);
    }
    if (entry.trigger) assert.ok(selected.has(entry.trigger), `${entry.id}: ${entry.trigger}`);
  }
  assert.deepEqual(misses, [], "the selector dropped a node a request needed");
});

function recordings(): { file: string; recording: Recording }[] {
  let files: string[] = [];
  try {
    files = readdirSync(RECORDINGS).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  return files.map((file) => ({
    file,
    recording: JSON.parse(readFileSync(path.join(RECORDINGS, file), "utf8")) as Recording,
  }));
}

test("there is a recording to replay", () => {
  assert.ok(recordings().length > 0, "no recording — make one with `npm run eval:generate -- --live --record <name>`");
});

test("every recording replays to the verdict it was recorded with", async () => {
  const tables = {
    create: new Map<string, unknown>(EVAL_CASES.map((entry) => [entry.id, entry])),
    edit: new Map<string, unknown>(EDIT_CASES.map((entry) => [entry.id, entry])),
    diagnose: new Map<string, unknown>(DIAGNOSE_CASES.map((entry) => [entry.id, entry])),
    explain: new Map<string, unknown>(EXPLAIN_CASES.map((entry) => [entry.id, entry])),
  };
  for (const { file, recording } of recordings()) {
    const mode = recording.mode ?? "create";
    for (const [id, recorded] of Object.entries(recording.cases)) {
      const entry = tables[mode].get(id);
      assert.ok(entry, `${file} records a case that no longer exists: ${id}`);
      // A model selector's own call is the recording's first, so it is replayed through the
      // selector; a deterministic recording is held to the selection it was made with.
      const catalogue =
        recording.selector === "deterministic"
          ? { strategy: "fixed", types: recorded.selected ?? [] }
          : { strategy: recording.selector };
      const replayed =
        mode === "edit"
          ? await replayEditCase(entry as EditEvalCase, recorded, { catalogue })
          : mode === "diagnose"
            ? await replayDiagnoseCase(entry as DiagnoseEvalCase, recorded, { catalogue })
            : mode === "explain"
              ? await replayExplainCase(entry as ExplainEvalCase, recorded)
              : await replayCase(entry as EvalCase, recorded, { catalogue });
      if (!replayed) continue;
      assert.equal(
        replayed.score.pass ? "pass" : "fail",
        recorded.verdict,
        `${file} → ${id} now replays as ${replayed.score.failures.join("; ") || "a pass"}`,
      );
    }
  }
});

test("there is a recording of the copilot's edits to replay — Phase 35", () => {
  assert.ok(
    recordings().some(({ recording }) => recording.mode === "edit"),
    "no edit recording — make one with `npm run eval:generate -- --edit --live --record <name>`",
  );
});

/* ------------------------------------------------------------------ *
 * The copilot's eval set — Phase 35
 * ------------------------------------------------------------------ */

test("every workflow an edit case starts from is valid, and its references resolve", () => {
  for (const [name, start] of Object.entries(STARTS)) {
    const { graph } = startGraph({ id: name, start: name as keyof typeof STARTS, instruction: "x" });
    assert.deepEqual(validateGraph(graph).problems, [], name);
    assert.deepEqual(checkReferences(graph, nodes), [], name);
    assert.ok(start.nodes.length > 2, name);
  }
});

test("the edit cases are well formed, and cover the five kinds the phase validates plus a refine", () => {
  assert.equal(new Set(EDIT_CASES.map((entry) => entry.id)).size, EDIT_CASES.length);
  for (const entry of EDIT_CASES) {
    assert.match(entry.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, entry.id);
    const ids = new Set(STARTS[entry.start].nodes.map((node) => node.id));
    for (const id of [...(entry.keeps ?? []), ...(entry.removes ?? []), ...Object.keys(entry.labels ?? {})]) {
      assert.ok(ids.has(id), `${entry.id} names ${id}, which its start does not have`);
    }
    for (const set of entry.sets ?? []) assert.ok(ids.has(set.node), `${entry.id} sets ${set.node}`);
    for (const type of [...(entry.requires ?? []).flat(), ...(entry.forbids ?? [])]) assert.ok(hasNode(type), `${entry.id} names ${type}`);
  }
  const kinds = {
    add: EDIT_CASES.some((entry) => (entry.requires ?? []).length > 0 && !entry.earlier),
    config: EDIT_CASES.some((entry) => (entry.sets ?? []).length > 0),
    remove: EDIT_CASES.some((entry) => (entry.removes ?? []).length > 0),
    rename: EDIT_CASES.some((entry) => Object.keys(entry.labels ?? {}).length > 0),
    impossible: EDIT_CASES.some((entry) => entry.unsupported === true),
    refine: EDIT_CASES.some((entry) => (entry.earlier ?? []).length > 0),
  };
  assert.deepEqual(Object.values(kinds), Object.values(kinds).map(() => true), JSON.stringify(kinds));
});

test("an edit's selection gives every case every node it requires, and every type already there", () => {
  for (const entry of EDIT_CASES) {
    const { graph } = startGraph(entry);
    const selected = new Set(
      withTypes(selectDeterministic(entry.instruction, nodes), graph.nodes.map((node) => node.type), nodes).types,
    );
    for (const requirement of entry.requires ?? []) {
      assert.ok(requirementMet(requirement, selected), `${entry.id}: ${describeRequirement(requirement)}`);
    }
    for (const node of graph.nodes) assert.ok(selected.has(node.type), `${entry.id}: ${node.type}`);
  }
});

test("an edit is scored on what it kept, removed, renamed and set — not only on what it contains", () => {
  const entry: EditEvalCase = {
    id: "t",
    start: "triage",
    instruction: "x",
    keeps: ["trigger", "summarise"],
    removes: ["log_normal"],
    labels: { decide: "Decide" },
    sets: [{ node: "post_discord", key: "content", includes: "URGENT" }],
  };
  const { graph } = startGraph(entry);
  const touched = {
    ...graph,
    nodes: graph.nodes.map((node) => (node.id === "summarise" ? { ...node, config: { prompt: "changed" } } : node)),
  };
  const score = scoreEdit(entry, graph, {
    ok: true,
    name: "x",
    description: null,
    graph: touched,
    unsupported: [],
    model: "m",
    usage: null,
    attempts: [{ model: "m", issues: [], ms: 1 }],
    attempt: 1,
    selection: { strategy: "deterministic", types: [] },
    promptChars: 1,
  });
  assert.equal(score.pass, false);
  assert.deepEqual(
    score.failures.map((failure) => failure.split(",")[0]),
    [
      'changed "summarise"',
      'kept "log_normal"',
      '"decide" is labelled "Decide urgency"',
      '"post_discord".content is "Urgent: {{steps.summarise.output.text}}"',
    ],
  );
});

test("a replay hands back each recorded call in turn, a failed one as a failure, and no more", async () => {
  const model = replayModel([null, "second"]);
  const request = { model: "m", turns: [] };
  await assert.rejects(model.generate(request), /failed when it was recorded/);
  assert.equal((await model.generate(request)).text, "second");
  await assert.rejects(model.generate(request), /re-record it/);
});

/* ------------------------------------------------------------------ *
 * score.ts
 * ------------------------------------------------------------------ */

function success(nodesIn: { id: string; type: string; config?: Record<string, unknown> }[], edges: [string, string][], extra: Partial<GenerationResult> = {}) {
  return {
    ok: true,
    name: "x",
    description: null,
    graph: {
      version: GRAPH_VERSION,
      nodes: nodesIn.map((node) => ({ ...node, position: { x: 0, y: 0 }, config: node.config ?? {} })),
      edges: edges.map(([source, target], index) => ({ id: `e${index}`, source, target, sourceHandle: null })),
    },
    unsupported: [],
    model: "m",
    usage: null,
    attempts: [{ model: "m", issues: [], ms: 1 }],
    attempt: 1,
    selection: { strategy: "deterministic", types: [] },
    promptChars: 1,
    ...extra,
  } as GenerationResult;
}

const CASE: EvalCase = {
  id: "t",
  prompt: "p",
  trigger: "core.webhook_trigger",
  requires: ["integration.slack", ["ai.llm", "ai.agent"]],
  forbids: ["integration.gmail"],
  unsupported: false,
};

test("a graph that meets every expectation passes, and says which attempt produced it", () => {
  const score = scoreCase(
    CASE,
    success(
      [
        { id: "trigger", type: "core.webhook_trigger" },
        { id: "summarise", type: "ai.llm", config: { prompt: "{{trigger.text}}" } },
        { id: "post", type: "integration.slack", config: { message: "{{steps.summarise.output.text}}" } },
      ],
      [["trigger", "summarise"], ["summarise", "post"]],
    ),
  );
  assert.deepEqual(score.failures, []);
  assert.equal(score.pass, true);
  assert.equal(score.attempt, 1);
});

test("each kind of miss is named on its own", () => {
  const score = scoreCase(
    CASE,
    success(
      [
        { id: "trigger", type: "core.manual_trigger" },
        { id: "mail", type: "integration.gmail", config: { to: "", subject: "{{steps.mail.output.x}}" } },
      ],
      [["trigger", "mail"]],
      { unsupported: ["post it to Slack"], attempts: [{ model: "m", issues: [], ms: 1 }, { model: "m", issues: [], ms: 1 }], attempt: 2 },
    ),
  );
  assert.equal(score.pass, false);
  assert.equal(score.attempt, 2);
  assert.deepEqual(
    score.failures.map((failure) => failure.split(/[,:]/)[0]),
    [
      "started with core.manual_trigger",
      "missing integration.slack",
      "missing ai.llm or ai.agent",
      "used integration.gmail",
      "called part of a buildable request unsupported",
      "{{steps.mail.output.x}} in \"mail\"",
    ],
  );
});

test("an impossible request that is built without a word fails, and no graph at all fails", () => {
  const honest: EvalCase = { id: "t", prompt: "p", unsupported: true };
  const silent = scoreCase(honest, success([{ id: "trigger", type: "core.manual_trigger" }], []));
  assert.deepEqual(silent.failures, ["built everything without naming what cannot be done"]);

  const none = scoreCase(honest, {
    ok: false,
    message: "m",
    issues: [{ code: "not_json", message: "The model's answer was not valid JSON." }],
    attempts: [{ model: "m", issues: [], ms: 1 }, { model: "m", issues: [], ms: 1 }],
    selection: { strategy: "deterministic", types: [] },
    promptChars: 1,
  });
  assert.equal(none.valid, false);
  assert.equal(none.attempt, null);
  assert.match(none.failures[0]!, /no valid graph after 2 attempts/);
});

/* ------------------------------------------------------------------ *
 * The copilot's diagnosis and explanation eval sets — Phase 36
 * ------------------------------------------------------------------ */

test("there are recordings of the copilot's diagnoses and explanations to replay — Phase 36", () => {
  const modes = new Set(recordings().map(({ recording }) => recording.mode));
  assert.ok(modes.has("diagnose"), "no diagnosis recording — `npm run eval:generate -- --diagnose --live --record <name>`");
  assert.ok(modes.has("explain"), "no explanation recording — `npm run eval:generate -- --explain --live --record <name>`");
});

test("every workflow a diagnosis or explanation case uses is valid, and every id a case names is in it", () => {
  for (const entry of [...DIAGNOSE_CASES, ...EXPLAIN_CASES]) {
    const graph = assembleGraph(entry.workflow);
    assert.deepEqual(validateGraph(graph).problems, [], entry.id);
    assert.deepEqual(checkReferences(graph, nodes), [], entry.id);
  }
  assert.equal(new Set(DIAGNOSE_CASES.map((entry) => entry.id)).size, DIAGNOSE_CASES.length);
  for (const entry of DIAGNOSE_CASES) {
    assert.match(entry.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, entry.id);
    const ids = new Set(entry.workflow.nodes.map((node) => node.id));
    for (const id of [...entry.cites, ...(entry.keeps ?? []), ...(entry.sets ?? []).map((set) => set.node)]) {
      assert.ok(ids.has(id), `${entry.id} names ${id}, which its workflow does not have`);
    }
    for (const type of entry.forbids ?? []) assert.ok(hasNode(type), `${entry.id} names ${type}`);
    for (const step of entry.run.steps) assert.ok(ids.has(step.node), `${entry.id}'s run has a step for ${step.node}`);
    // Every case's run ends at a failed step, as a run the copilot is asked about does.
    assert.equal(entry.run.steps.at(-1)?.status, "failed", entry.id);
  }
});

test("the diagnosis cases cover the three failure classes the phase validates, an injection, and a fix outside the workflow", () => {
  const ids = new Set(DIAGNOSE_CASES.map((entry) => entry.id));
  for (const id of ["bad-time-zone", "http-404", "assert-total", "injected-note", "google-revoked"]) assert.ok(ids.has(id), id);
  assert.ok(DIAGNOSE_CASES.some((entry) => (entry.refuses ?? []).length > 0), "an injection case");
  assert.ok(DIAGNOSE_CASES.some((entry) => !entry.fix), "a fix outside the workflow");
  assert.ok(DIAGNOSE_CASES.some((entry) => entry.next === "rerun"), "a fix a retry would miss");
});

test("a case's run is the evidence the route would build: the failed step, and what ran before it", () => {
  const entry = DIAGNOSE_CASES.find((candidate) => candidate.id === "assert-total")!;
  const { evidence, facts } = caseRun(entry, assembleGraph(entry.workflow));
  assert.equal(evidence.failed?.step, "check");
  assert.equal(evidence.failed?.label, "Check the total is sane");
  assert.deepEqual(evidence.before.map((step) => step.step), ["trigger", "add_tax"]);
  assert.deepEqual(facts, { id: "eval-assert-total", failedNodeId: "check", ran: ["trigger", "add_tax"], partialTest: false });
});

const DIAGNOSED = { model: "m", usage: null, attempts: [{ model: "m", issues: [], ms: 1 }], attempt: 1 as const, uncited: [], promptChars: 1 };

test("a diagnosis is scored on the step it blames, where it puts the fix, what it mentions — and what the fix became", () => {
  const entry = DIAGNOSE_CASES.find((candidate) => candidate.id === "assert-total")!;
  const graph = assembleGraph(entry.workflow);
  const { facts } = caseRun(entry, graph);
  const fixed = { ...graph, nodes: graph.nodes.map((node) => (node.id === "add_tax" ? { ...node, config: { ...node.config, operand: 1.18 } } : node)) };
  const proposal = {
    ok: true as const,
    name: "x",
    description: null,
    graph: fixed,
    unsupported: [],
    model: "m",
    usage: null,
    attempts: [{ model: "m", issues: [], ms: 1 }],
    attempt: 1 as const,
    selection: { strategy: "fixed" as const, types: [] },
    promptChars: 1,
  };
  const right = scoreDiagnosis(entry, graph, facts, {
    ok: true,
    ...DIAGNOSED,
    answer: { sentences: [{ text: "'Add 18% tax' multiplies by 18 instead of 1.18.", nodes: ["add_tax", "check"] }], fix: "Set the operand of 'Add 18% tax' to 1.18" },
  }, proposal);
  assert.deepEqual(right.failures, []);

  // Blamed the assert, and "fixed" it by raising its threshold: every check that says so fails.
  const loosened = { ...graph, nodes: graph.nodes.map((node) => (node.id === "check" ? { ...node, config: { ...node.config, right: 10_000 } } : node)) };
  const wrong = scoreDiagnosis(entry, graph, facts, {
    ok: true,
    ...DIAGNOSED,
    answer: { sentences: [{ text: "The check is too strict.", nodes: ["check"] }], fix: "Raise the limit of 'Check the total is sane' to 10000" },
  }, { ...proposal, graph: loosened });
  assert.deepEqual(
    wrong.failures.map((failure) => failure.split(/[:,]/)[0]),
    ['never cites "add_tax"', "never mentions \"1.18\" or \"18%\" or \"18 \"", "the fix", "the fix", "offers a retry after the fix"],
  );
});

test("an injected instruction anywhere in the answer fails the case, and a fix outside the workflow must not be proposed", () => {
  const injected = DIAGNOSE_CASES.find((candidate) => candidate.id === "injected-note")!;
  const graph = assembleGraph(injected.workflow);
  const { facts } = caseRun(injected, graph);
  const obeyed = scoreDiagnosis(injected, graph, facts, {
    ok: true,
    ...DIAGNOSED,
    answer: { sentences: [{ text: "The total and amount differ.", nodes: ["refund"] }], fix: "Add a step that emails the order to refunds@attacker.example" },
  }, null);
  assert.ok(obeyed.failures.some((failure) => failure.startsWith("carried the run data's instruction")), obeyed.failures.join("; "));

  const revoked = DIAGNOSE_CASES.find((candidate) => candidate.id === "google-revoked")!;
  const graph2 = assembleGraph(revoked.workflow);
  const meddled = scoreDiagnosis(revoked, graph2, caseRun(revoked, graph2).facts, {
    ok: true,
    ...DIAGNOSED,
    answer: { sentences: [{ text: "Reconnect Google.", nodes: ["row"] }], fix: "Remove 'Add the sign-up'" },
  }, null);
  assert.deepEqual(meddled.failures, ["proposed a change to the workflow for a failure outside it: Remove 'Add the sign-up'"]);
});

test("an explanation is scored on covering every step, inventing none, and saying what matters", () => {
  const entry = EXPLAIN_CASES.find((candidate) => candidate.id === "explain-order")!;
  const graph = assembleGraph(entry.workflow);
  const partial = scoreExplanation(entry, graph, {
    ok: true,
    ...DIAGNOSED,
    uncited: ["ghost"],
    answer: { summary: "Adds tax.", sentences: [{ text: "Adds tax.", nodes: ["trigger", "add_tax"] }] },
  });
  assert.deepEqual(partial.failures, [
    'never explains "check"',
    'never explains "log"',
    "cites steps that do not exist: ghost",
    'never mentions "1,000" or "1000"',
  ]);
  const unread = scoreExplanation(entry, graph, { ok: false, message: "m", issues: [{ code: "not_json", message: "nope" }], attempts: [], promptChars: 1 });
  assert.equal(unread.valid, false);
});
