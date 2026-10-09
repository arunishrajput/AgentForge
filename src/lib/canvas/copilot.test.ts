import assert from "node:assert/strict";
import { test } from "node:test";

import { COPILOT_EARLIER_MAX } from "@/lib/generate/schema";
import { describeNodes } from "@/lib/nodes";
import { diffGraphs } from "@/lib/workflow/diff";
import { GRAPH_VERSION, type WorkflowGraph } from "@/lib/workflow/graph";

import type { CopilotResponse, DiagnoseResponse, ExplainResponse } from "./client";
import {
  EMPTY_COPILOT,
  accept,
  answered,
  ask,
  askAbout,
  diagnosed,
  explained,
  failed,
  followed,
  opened,
  reject,
  setAside,
  type CopilotState,
  type Turn,
} from "./copilot";

const registry = new Map(describeNodes().map((node) => [node.type, node]));

const CANVAS: WorkflowGraph = {
  version: GRAPH_VERSION,
  nodes: [
    { id: "trigger", type: "core.manual_trigger", position: { x: 0, y: 0 }, config: {} },
    { id: "log", type: "core.log", position: { x: 300, y: 0 }, config: { message: "hi" } },
  ],
  edges: [{ id: "e1", source: "trigger", target: "log", sourceHandle: null }],
};

const withSlack = (text: string): WorkflowGraph => ({
  ...CANVAS,
  nodes: [...CANVAS.nodes, { id: "slack", type: "integration.slack", position: { x: 600, y: 0 }, config: { text } }],
  edges: [...CANVAS.edges, { id: "e2", source: "log", target: "slack", sourceHandle: null }],
});

function response(graph: WorkflowGraph, unsupported: string[] = []): CopilotResponse {
  return {
    proposal: { graph, unsupported, changes: diffGraphs(CANVAS, graph).summary, problems: [] },
    generation: { model: "m", source: "user", usage: null, attempts: [] },
  };
}

/** Ask, and hand back the state with the request in flight. */
function asking(state: CopilotState, text: string, canvas = CANVAS) {
  const started = ask(state, text, canvas, 1000);
  assert.ok(started, "the ask was refused");
  return started;
}

const last = (state: CopilotState): Turn => state.turns[state.turns.length - 1];

test("asking sends the canvas and shows the question and a thinking turn", () => {
  const { state, request } = asking(EMPTY_COPILOT, "  Also post to Slack  ");
  assert.deepEqual(request, { instruction: "Also post to Slack", graph: CANVAS, earlier: [] });
  assert.deepEqual(
    state.turns.map((turn) => (turn.from === "you" ? turn.text : turn.state)),
    ["Also post to Slack", "thinking"],
  );
});

test("one question at a time, and an empty one is not a question", () => {
  const { state } = asking(EMPTY_COPILOT, "a");
  assert.equal(ask(state, "b", CANVAS, 1), null);
  assert.equal(ask(EMPTY_COPILOT, "   ", CANVAS, 1), null);
});

test("an answer that changes the canvas becomes an open proposal, described in words", () => {
  const { state } = asking(EMPTY_COPILOT, "Also post to Slack");
  const next = answered(state, response(withSlack("Hi")), CANVAS, registry);
  assert.ok(next.proposal);
  assert.equal(next.proposal.diff.summary.added, 1);
  assert.deepEqual(next.proposal.instructions, ["Also post to Slack"]);
  const turn = last(next);
  assert.ok(turn.from === "copilot" && turn.state === "proposal");
  assert.equal(turn.outcome, "open");
  assert.equal(turn.lines[0].kind, "added");
  assert.equal(next.pending, null);
});

test("refine edits the proposal, keeps the canvas as the base, and carries what was asked before", () => {
  const first = answered(asking(EMPTY_COPILOT, "Also post to Slack").state, response(withSlack("Hi")), CANVAS, registry);
  const { state, request } = asking(first, "no, say Urgent");
  assert.deepEqual(request.graph, withSlack("Hi"));
  assert.deepEqual(request.earlier, ["Also post to Slack"]);

  const second = answered(state, response(withSlack("Urgent")), CANVAS, registry);
  assert.ok(second.proposal);
  assert.equal(second.proposal.base, CANVAS);
  // One change to the canvas, however many refinements it took.
  assert.equal(second.proposal.diff.summary.added, 1);
  assert.deepEqual(second.proposal.instructions, ["Also post to Slack", "no, say Urgent"]);
  const outcomes = second.turns.flatMap((turn) => (turn.from === "copilot" && turn.state === "proposal" ? [turn.outcome] : []));
  assert.deepEqual(outcomes, ["refined", "open"]);
});

test("a long refinement sends only the newest instructions the API accepts", () => {
  let state: CopilotState = answered(asking(EMPTY_COPILOT, "0").state, response(withSlack("0")), CANVAS, registry);
  for (let index = 1; index <= COPILOT_EARLIER_MAX + 2; index += 1) {
    state = answered(asking(state, String(index)).state, response(withSlack(String(index))), CANVAS, registry);
  }
  const { request } = asking(state, "again");
  assert.equal(request.earlier.length, COPILOT_EARLIER_MAX);
  assert.equal(request.earlier.at(-1), String(COPILOT_EARLIER_MAX + 2));
});

test("an answer of no change is said, and leaves nothing to accept", () => {
  const next = answered(asking(EMPTY_COPILOT, "rename the workflow").state, response(CANVAS, ["rename the workflow"]), CANVAS, registry);
  assert.equal(next.proposal, null);
  const turn = last(next);
  assert.ok(turn.from === "copilot" && turn.state === "nothing");
  assert.deepEqual(turn.unsupported, ["rename the workflow"]);
});

test("if the canvas changed while the copilot worked, its answer is set aside, not shown", () => {
  const { state } = asking(EMPTY_COPILOT, "Also post to Slack");
  const edited: WorkflowGraph = { ...CANVAS, nodes: CANVAS.nodes.map((node) => ({ ...node, label: "renamed" })) };
  const next = answered(state, response(withSlack("Hi")), edited, registry);
  assert.equal(next.proposal, null);
  const turn = last(next);
  assert.ok(turn.from === "copilot" && turn.state === "set-aside");
});

test("accept hands back the proposed graph once, and marks the turn", () => {
  const open = answered(asking(EMPTY_COPILOT, "Also post to Slack").state, response(withSlack("Hi")), CANVAS, registry);
  const accepted = accept(open);
  assert.ok(accepted);
  assert.deepEqual(accepted.graph, withSlack("Hi"));
  assert.equal(accepted.state.proposal, null);
  const turn = last(accepted.state);
  assert.ok(turn.from === "copilot" && turn.state === "proposal" && turn.outcome === "accepted");
  assert.equal(accept(accepted.state), null);
});

test("nothing is accepted or rejected while a refinement is in flight", () => {
  const open = answered(asking(EMPTY_COPILOT, "Also post to Slack").state, response(withSlack("Hi")), CANVAS, registry);
  const { state } = asking(open, "no");
  assert.equal(accept(state), null);
  assert.equal(reject(state), state);
});

test("reject drops the proposal and leaves the canvas as it was", () => {
  const open = answered(asking(EMPTY_COPILOT, "Also post to Slack").state, response(withSlack("Hi")), CANVAS, registry);
  const rejected = reject(open);
  assert.equal(rejected.proposal, null);
  const turn = last(rejected);
  assert.ok(turn.from === "copilot" && turn.state === "proposal" && turn.outcome === "rejected");
  // The next question is about the canvas again, with no earlier instructions.
  assert.deepEqual(asking(rejected, "something else").request.earlier, []);
});

test("a failed refine keeps the open proposal open", () => {
  const open = answered(asking(EMPTY_COPILOT, "Also post to Slack").state, response(withSlack("Hi")), CANVAS, registry);
  const next = failed(asking(open, "no").state, { message: "Quota", issues: [], recovery: null });
  assert.ok(next.proposal);
  const turn = last(next);
  assert.ok(turn.from === "copilot" && turn.state === "failed" && turn.message === "Quota");
});

test("the canvas is fitted to a proposal when one opens or a refinement replaces it — never otherwise", () => {
  const thinking = asking(EMPTY_COPILOT, "Also post to Slack").state;
  const first = answered(thinking, response(withSlack("Hi")), CANVAS, registry);
  assert.equal(opened(thinking, first), true);

  const refining = asking(first, "say Urgent").state;
  const refined = answered(refining, response(withSlack("Urgent")), CANVAS, registry);
  assert.equal(opened(refining, refined), true);

  // A failed refine leaves the same proposal on screen; an answer of no change opens none.
  const failedRefine = failed(asking(refined, "x").state, { message: "m", issues: [], recovery: null });
  assert.equal(opened(refined, failedRefine), false);
  const nothing = answered(asking(EMPTY_COPILOT, "x").state, response(CANVAS), CANVAS, registry);
  assert.equal(opened(EMPTY_COPILOT, nothing), false);
  assert.equal(opened(first, reject(first)), false);
});

test("a restored version sets aside whatever was open or in flight, and says why", () => {
  const open = answered(asking(EMPTY_COPILOT, "Also post to Slack").state, response(withSlack("Hi")), CANVAS, registry);
  const cleared = setAside(open, "restored");
  assert.equal(cleared.proposal, null);
  assert.ok(cleared.turns.some((turn) => turn.from === "copilot" && turn.state === "set-aside"));
  assert.equal(new Set(cleared.turns.map((turn) => turn.id)).size, cleared.turns.length, "turn ids stay unique");

  const inFlight = setAside(asking(EMPTY_COPILOT, "x").state, "restored");
  assert.equal(inFlight.pending, null);
  // A late answer to a set-aside question changes nothing.
  assert.equal(answered(inFlight, response(withSlack("Hi")), CANVAS, registry), inFlight);
  assert.equal(setAside(EMPTY_COPILOT, "restored"), EMPTY_COPILOT);
});

// Phase 36 — explain, diagnose, and a diagnosis's fix.

const EXPLAINED: ExplainResponse = {
  explanation: {
    summary: "Logs a greeting when somebody presses Run.",
    sentences: [
      { text: "A person presses Run.", nodes: ["trigger"] },
      { text: "'Log' writes hi.", nodes: ["log"] },
    ],
  },
  generation: { model: "m", source: "user", usage: null, attempts: [] },
};

function diagnosis(fix: string | null): DiagnoseResponse {
  return {
    diagnosis: { sentences: [{ text: "'Log' was given nothing to write.", nodes: ["log"] }], fix },
    run: { id: "run-1", failedNodeId: "log", ran: ["trigger"], partialTest: false },
    generation: { model: "m", source: "user", usage: null, attempts: [] },
  };
}

test("explain is asked from a button: the label is the question, and the answer is sentences that cite steps", () => {
  const started = askAbout(EMPTY_COPILOT, { kind: "explain" }, "Explain this workflow", CANVAS, 5);
  assert.ok(started);
  assert.deepEqual(started.request, { kind: "explain" });
  assert.deepEqual(
    started.state.turns.map((turn) => (turn.from === "you" ? turn.text : `${turn.state}:${turn.state === "thinking" ? turn.task : ""}`)),
    ["Explain this workflow", "thinking:explain"],
  );
  // An answer that changes nothing is shown even if the canvas moved meanwhile.
  const next = explained(started.state, EXPLAINED);
  const turn = last(next);
  assert.ok(turn.from === "copilot" && turn.state === "explanation");
  assert.equal(turn.summary, "Logs a greeting when somebody presses Run.");
  assert.deepEqual(turn.sentences[1].nodes, ["log"]);
  assert.equal(next.pending, null);
  assert.equal(next.proposal, null);
});

test("explain and diagnose wait for an open proposal to be decided, and for any answer in flight", () => {
  const { state } = asking(EMPTY_COPILOT, "Also post to Slack");
  assert.equal(askAbout(state, { kind: "explain" }, "Explain", CANVAS, 1), null, "in flight");
  const open = answered(state, response(withSlack("Hi")), CANVAS, registry);
  assert.equal(askAbout(open, { kind: "diagnose", runId: "r" }, "Why?", CANVAS, 1), null, "a proposal is open");
});

test("each answer goes only to the ask it answers", () => {
  const explaining = askAbout(EMPTY_COPILOT, { kind: "explain" }, "Explain", CANVAS, 1)!.state;
  assert.equal(diagnosed(explaining, diagnosis("x")).state, explaining);
  assert.equal(answered(explaining, response(withSlack("Hi")), CANVAS, registry), explaining);
  const editing = asking(EMPTY_COPILOT, "Also post to Slack").state;
  assert.equal(explained(editing, EXPLAINED), editing);
});

test("a diagnosis with a fix is shown, and hands back the fix to ask for — quietly, remembering the run", () => {
  const started = askAbout(EMPTY_COPILOT, { kind: "diagnose", runId: "run-1" }, "Why did run run-1 fail?", CANVAS, 5)!;
  const { state, fix } = diagnosed(started.state, diagnosis("Change the message of 'Log' to hello"));
  const turn = last(state);
  assert.ok(turn.from === "copilot" && turn.state === "diagnosis");
  assert.equal(turn.fix, "Change the message of 'Log' to hello");
  assert.ok(fix);
  assert.equal(fix.text, "Change the message of 'Log' to hello");

  // The copilot asks for the fix itself: no "you" turn — the diagnosis already says it in words.
  const chained = ask(state, fix.text, CANVAS, 6, fix.fixes)!;
  assert.deepEqual(chained.request, { instruction: "Change the message of 'Log' to hello", graph: CANVAS, earlier: [] });
  assert.deepEqual(
    chained.state.turns.map((entry) => (entry.from === "you" ? "you" : entry.state === "thinking" ? `thinking:${entry.task}` : entry.state)),
    ["you", "diagnosis", "thinking:fix"],
  );

  // Its proposal is an ordinary one that also knows how to run the run again once accepted.
  const fixedGraph: WorkflowGraph = { ...CANVAS, nodes: [CANVAS.nodes[0], { ...CANVAS.nodes[1], config: { message: "hello" } }] };
  const proposed = answered(chained.state, response(fixedGraph), CANVAS, registry);
  const proposal = last(proposed);
  assert.ok(proposal.from === "copilot" && proposal.state === "proposal");
  assert.deepEqual(proposal.fix, { runId: "run-1", next: { kind: "retry" }, followed: false });
  assert.equal(proposed.proposal?.fixes?.run.id, "run-1");

  // A refine of a fix is still a fix of the same run.
  const refining = ask(proposed, "and say hello twice", CANVAS, 7)!;
  const refined = answered(refining.state, response(fixedGraph), CANVAS, registry);
  const again = last(refined);
  assert.ok(again.from === "copilot" && again.state === "proposal" && again.fix?.runId === "run-1");

  // Accepted, then followed by a retry from the panel: it stops offering one.
  const accepted = accept(refined)!.state;
  const done = followed(accepted, again.id);
  const final = done.turns.find((entry) => entry.id === again.id);
  assert.ok(final && final.from === "copilot" && final.state === "proposal" && final.fix?.followed === true);
});

test("a diagnosis whose fix is not in the workflow asks for nothing more", () => {
  const started = askAbout(EMPTY_COPILOT, { kind: "diagnose", runId: "run-1" }, "Why?", CANVAS, 5)!;
  const { state, fix } = diagnosed(started.state, diagnosis(null));
  assert.equal(fix, null);
  assert.equal(state.pending, null);
  const turn = last(state);
  assert.ok(turn.from === "copilot" && turn.state === "diagnosis" && turn.fix === null);
});

test("a fix to a step that already ran is offered as a re-run, not a retry", () => {
  const started = askAbout(EMPTY_COPILOT, { kind: "diagnose", runId: "run-1" }, "Why?", CANVAS, 5)!;
  const response36 = diagnosis("Set the trigger's input");
  const { state, fix } = diagnosed(started.state, { ...response36, run: { ...response36.run, ran: ["trigger", "log"], failedNodeId: null } });
  const chained = ask(state, fix!.text, CANVAS, 6, fix!.fixes)!;
  const changed: WorkflowGraph = { ...CANVAS, nodes: [CANVAS.nodes[0], { ...CANVAS.nodes[1], config: { message: "bye" } }] };
  const turn = last(answered(chained.state, response(changed), CANVAS, registry));
  assert.ok(turn.from === "copilot" && turn.state === "proposal");
  assert.deepEqual(turn.fix?.next, { kind: "rerun", why: "ran", nodes: ["log"] });
});
