import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { describeNodes, hasNode } from "@/lib/nodes";
import { GRAPH_VERSION } from "@/lib/workflow/graph";

import { DEMO_PROMPT as SCRIPT_DEMO_PROMPT } from "../../../../scripts/demo-payload.mjs";
import type { GenerationResult } from "../generate";
import { selectDeterministic } from "../select";
import { DEMO_PROMPT, EVAL_CASES, type EvalCase } from "./cases";
import { replayCase, replayModel, type Recording } from "./run";
import { describeRequirement, requirementMet, scoreCase } from "./score";

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
  const byId = new Map(EVAL_CASES.map((entry) => [entry.id, entry]));
  for (const { file, recording } of recordings()) {
    for (const [id, recorded] of Object.entries(recording.cases)) {
      const entry = byId.get(id);
      assert.ok(entry, `${file} records a case that no longer exists: ${id}`);
      // A model selector's own call is the recording's first, so it is replayed through the
      // selector; a deterministic recording is held to the selection it was made with.
      const catalogue =
        recording.selector === "deterministic"
          ? { strategy: "fixed", types: recorded.selected ?? [] }
          : { strategy: recording.selector };
      const replayed = await replayCase(entry, recorded, { catalogue });
      if (!replayed) continue;
      assert.equal(
        replayed.score.pass ? "pass" : "fail",
        recorded.verdict,
        `${file} → ${id} now replays as ${replayed.score.failures.join("; ") || "a pass"}`,
      );
    }
  }
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
