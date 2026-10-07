import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GRAPH_VERSION, type WorkflowGraph, type WorkflowNode } from "@/lib/workflow/graph";

import {
  CLIPBOARD_FORMAT,
  CLIPBOARD_VERSION,
  copySelection,
  freshId,
  parseEnvelope,
  PASTE_STEP,
  planPaste,
  remapReferences,
  serialiseEnvelope,
  type ClipboardEnvelope,
  type PasteOptions,
} from "./clipboard";

const node = (id: string, type: string, x: number, config: Record<string, unknown> = {}): WorkflowNode => ({
  id,
  type,
  position: { x, y: 0 },
  config,
});

/** trigger → agent → email, with the email reading the agent's output. */
const source: WorkflowGraph = {
  version: GRAPH_VERSION,
  nodes: [
    node("manual_trigger", "core.manual_trigger", 0),
    node("agent", "ai.agent", 300, { prompt: "Summarise {{input.text}}" }),
    { ...node("email", "integration.gmail", 600, { subject: "{{steps.agent.output.title}}" }), label: "Send it" },
  ],
  edges: [
    { id: "e1", source: "manual_trigger", target: "agent", sourceHandle: null },
    { id: "e2", source: "agent", target: "email", sourceHandle: null },
  ],
};

const options: PasteOptions = {
  isTrigger: (type) => type.endsWith("_trigger"),
  isKnown: (type) => !type.startsWith("unknown."),
};

const envelopeOf = (ids: string[]) => copySelection(source, ids)!;

describe("copying a selection", () => {
  it("takes the selected nodes and only the edges between them", () => {
    const envelope = envelopeOf(["agent", "email"]);
    assert.deepEqual(
      envelope.nodes.map((n) => n.id),
      ["agent", "email"],
    );
    assert.deepEqual(
      envelope.edges.map((e) => e.id),
      ["e2"],
      "the edge from the trigger, which was not copied, is left behind",
    );
  });

  it("copies nothing when nothing is selected", () => {
    assert.equal(copySelection(source, []), null);
    assert.equal(copySelection(source, ["missing"]), null);
  });
});

describe("the clipboard text", () => {
  it("round-trips through the envelope and says what it is", () => {
    const envelope = envelopeOf(["agent", "email"]);
    const text = serialiseEnvelope(envelope);
    assert.match(text, new RegExp(`"format": "${CLIPBOARD_FORMAT}"`));
    assert.deepEqual(parseEnvelope(text), envelope);
  });

  it("ignores anything that is not an envelope, without throwing", () => {
    for (const text of [
      "",
      "milk, eggs, bread",
      "{",
      "null",
      "[]",
      JSON.stringify({ nodes: [], edges: [] }),
      JSON.stringify({ format: "something/else", version: 1, nodes: [], edges: [] }),
      JSON.stringify({ format: CLIPBOARD_FORMAT, version: 2, nodes: source.nodes, edges: [] }),
    ]) {
      assert.equal(parseEnvelope(text), null, text);
    }
  });

  it("holds a pasted node to the same schema a saved one meets", () => {
    const bad = (nodes: unknown[]) =>
      JSON.stringify({ format: CLIPBOARD_FORMAT, version: CLIPBOARD_VERSION, nodes, edges: [] });
    assert.equal(parseEnvelope(bad([])), null, "an empty envelope");
    assert.equal(parseEnvelope(bad([{ id: "", type: "core.set", position: { x: 0, y: 0 } }])), null);
    assert.equal(parseEnvelope(bad([{ id: "a", type: "core.set", position: { x: "0", y: 0 } }])), null);
    assert.equal(
      parseEnvelope(bad([{ id: "a", type: "core.set", position: { x: 0, y: 0 }, policy: { retries: 99 } }])),
      null,
      "a policy outside the schema's bounds",
    );
    assert.equal(parseEnvelope(bad(Array.from({ length: 101 }, (_, i) => node(`n${i}`, "core.set", i)))), null);
  });

  it("refuses text too large to be an envelope before parsing it", () => {
    assert.equal(parseEnvelope(" ".repeat(2_000_001)), null);
  });
});

describe("pasting", () => {
  it("into another workflow, keeps the ids it can and re-points every edge", () => {
    const target: WorkflowGraph = {
      version: GRAPH_VERSION,
      nodes: [node("webhook_trigger", "core.webhook_trigger", 0)],
      edges: [],
    };
    const result = planPaste(target, envelopeOf(["agent", "email"]), options);
    assert.ok(result.ok);
    assert.deepEqual(result.nodes.map((n) => n.id), ["agent", "email"]);
    assert.deepEqual(result.edges, [{ id: "e1", source: "agent", target: "email", sourceHandle: null }]);
    assert.equal(result.nodes[1].label, "Send it", "the label travels");
    assert.equal(result.note, null);
  });

  it("into the same workflow, mints new ids and rewrites references between the pasted nodes", () => {
    const result = planPaste(source, envelopeOf(["agent", "email"]), options);
    assert.ok(result.ok);
    assert.deepEqual(result.nodes.map((n) => n.id), ["agent_2", "email_2"]);
    assert.deepEqual(result.edges, [
      { id: "e3", source: "agent_2", target: "email_2", sourceHandle: null },
    ]);
    assert.equal(result.nodes[1].config.subject, "{{steps.agent_2.output.title}}");
  });

  it("leaves a reference to a node that was not copied pointing where it did", () => {
    const result = planPaste(source, envelopeOf(["email"]), options);
    assert.ok(result.ok);
    assert.equal(result.nodes[0].id, "email_2");
    assert.equal(result.nodes[0].config.subject, "{{steps.agent.output.title}}");
  });

  it("keeps a branch's output handle on the copied edge", () => {
    const branchy: WorkflowGraph = {
      version: GRAPH_VERSION,
      nodes: [node("check", "core.branch", 0), node("yes", "core.set", 300)],
      edges: [{ id: "e1", source: "check", target: "yes", sourceHandle: "true" }],
    };
    const envelope = copySelection(branchy, ["check", "yes"])!;
    const result = planPaste(branchy, envelope, options);
    assert.ok(result.ok);
    assert.deepEqual(result.edges, [
      { id: "e2", source: "check_2", target: "yes_2", sourceHandle: "true" },
    ]);
  });

  it("drops an edge to a node that is not in the envelope", () => {
    const envelope: ClipboardEnvelope = {
      ...envelopeOf(["agent"]),
      edges: [{ id: "e9", source: "agent", target: "ghost", sourceHandle: null }],
    };
    const result = planPaste(source, envelope, options);
    assert.ok(result.ok);
    assert.deepEqual(result.edges, []);
  });

  it("leaves a second trigger out, pastes the rest, and says so", () => {
    const result = planPaste(source, envelopeOf(["manual_trigger", "agent"]), options);
    assert.ok(result.ok);
    assert.deepEqual(result.nodes.map((n) => n.id), ["agent_2"]);
    assert.deepEqual(result.edges, [], "the edge from the trigger went with it");
    assert.match(result.note ?? "", /trigger was left out/);
  });

  it("refuses a paste of nothing but a trigger the workflow cannot take", () => {
    const result = planPaste(source, envelopeOf(["manual_trigger"]), options);
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.reason : "", /already has a trigger/);
  });

  it("takes a trigger into a workflow that has none", () => {
    const empty: WorkflowGraph = { version: GRAPH_VERSION, nodes: [], edges: [] };
    const result = planPaste(empty, envelopeOf(["manual_trigger", "agent", "email"]), options);
    assert.ok(result.ok);
    assert.equal(result.nodes.length, 3);
    assert.equal(result.edges.length, 2);
    assert.equal(result.note, null);
  });

  it("keeps only the first of two triggers even into an empty workflow", () => {
    const empty: WorkflowGraph = { version: GRAPH_VERSION, nodes: [], edges: [] };
    const envelope: ClipboardEnvelope = {
      ...envelopeOf(["manual_trigger"]),
      nodes: [node("t1", "core.manual_trigger", 0), node("t2", "core.webhook_trigger", 0)],
    };
    const result = planPaste(empty, envelope, options);
    assert.ok(result.ok);
    assert.deepEqual(result.nodes.map((n) => n.id), ["t1"]);
    assert.ok(result.note);
  });

  it("refuses a node type the registry does not have", () => {
    const envelope: ClipboardEnvelope = {
      ...envelopeOf(["agent"]),
      nodes: [node("x", "unknown.thing", 0)],
    };
    const result = planPaste(source, envelope, options);
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.reason : "", /unknown\.thing/);
  });

  it("refuses a paste that would pass the 100-node limit", () => {
    const full: WorkflowGraph = {
      version: GRAPH_VERSION,
      nodes: Array.from({ length: 99 }, (_, i) => node(`n${i}`, "core.set", i * 300)),
      edges: [],
    };
    const result = planPaste(full, envelopeOf(["agent", "email"]), options);
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.reason : "", /101 nodes/);
  });
});

describe("where a paste lands", () => {
  it("one step down and right of the original, so it never covers it", () => {
    const result = planPaste(source, envelopeOf(["agent"]), options);
    assert.ok(result.ok);
    assert.deepEqual(result.nodes[0].position, { x: 300 + PASTE_STEP, y: PASTE_STEP });
  });

  it("staggers repeated pastes rather than stacking them", () => {
    const once = planPaste(source, envelopeOf(["agent"]), options);
    assert.ok(once.ok);
    const withCopy: WorkflowGraph = { ...source, nodes: [...source.nodes, ...once.nodes] };
    const twice = planPaste(withCopy, envelopeOf(["agent"]), options);
    assert.ok(twice.ok);
    assert.deepEqual(twice.nodes[0].position, { x: 300 + 2 * PASTE_STEP, y: 2 * PASTE_STEP });
  });

  it("in the middle of the screen when the originals are off it", () => {
    const viewport = { x: 5000, y: 5000, width: 1000, height: 600 };
    const result = planPaste(source, envelopeOf(["agent", "email"]), { ...options, viewport });
    assert.ok(result.ok);
    // The pair spans x 300…600, so its middle (450) moves to the viewport's (5500).
    assert.deepEqual(result.nodes.map((n) => n.position), [
      { x: 5350, y: 5300 },
      { x: 5650, y: 5300 },
    ]);
  });

  it("beside the originals when they are on screen", () => {
    const viewport = { x: 0, y: -300, width: 1000, height: 600 };
    const result = planPaste(source, envelopeOf(["agent"]), { ...options, viewport });
    assert.ok(result.ok);
    assert.deepEqual(result.nodes[0].position, { x: 340, y: 40 });
  });
});

describe("ids and references", () => {
  it("freshId keeps a free id and suffixes a taken one by its stem", () => {
    assert.equal(freshId(new Set(), "agent"), "agent");
    assert.equal(freshId(new Set(["agent"]), "agent"), "agent_2");
    assert.equal(freshId(new Set(["agent", "agent_2"]), "agent_2"), "agent_3");
    assert.equal(freshId(new Set(["agent_2"]), "agent_2"), "agent_3");
  });

  it("rewrites every form of a reference to a renamed node, and nothing else", () => {
    const ids = new Map([["agent", "agent_2"]]);
    const config = {
      whole: "{{steps.agent.output}}",
      spaced: "{{ steps.agent.output.text }}",
      indexed: "{{steps.agent[0]}}",
      bare: "{{steps.agent}}",
      inline: "Hi {{input.name}}, {{steps.agent.output.text}}!",
      other: "{{steps.agentx.output}} {{steps.email.output}} {{input.agent}}",
      nested: { list: ["{{steps.agent.output}}", 3, true, null] },
      literal: "steps.agent.output",
    };
    assert.deepEqual(remapReferences(config, ids), {
      whole: "{{steps.agent_2.output}}",
      spaced: "{{ steps.agent_2.output.text }}",
      indexed: "{{steps.agent_2[0]}}",
      bare: "{{steps.agent_2}}",
      inline: "Hi {{input.name}}, {{steps.agent_2.output.text}}!",
      other: "{{steps.agentx.output}} {{steps.email.output}} {{input.agent}}",
      nested: { list: ["{{steps.agent_2.output}}", 3, true, null] },
      literal: "steps.agent.output",
    });
  });
});
