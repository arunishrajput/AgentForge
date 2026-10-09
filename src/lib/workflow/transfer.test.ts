import assert from "node:assert/strict";
import { test } from "node:test";

import type { Workflow } from "@/db/schema";
import type { GraphProblem } from "@/lib/engine/validate";

import { graphsEqual, type WorkflowGraph } from "./graph";
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  copyName,
  duplicateLabel,
  exportFilename,
  exportWorkflow,
  pinnedCount,
  readImport,
  unknownNodeTypes,
  unknownTypesMessage,
} from "./transfer";

/** A graph using every optional field the schema names, so "absent stays absent" is tested both ways. */
const GRAPH: WorkflowGraph = {
  version: 1,
  nodes: [
    { id: "trigger", type: "core.manual_trigger", position: { x: 0, y: 0 }, config: {} },
    {
      id: "fetch",
      type: "integration.http",
      label: "Fetch the page",
      position: { x: 240, y: 0 },
      config: { url: "https://example.com", method: "GET" },
      policy: { retries: 2, backoffMs: 500, timeoutMs: 20_000 },
      pinned: { output: { status: 200, body: "from somebody's inbox" } },
    },
    { id: "say", type: "core.log", position: { x: 480, y: 0 }, config: { message: "hi" }, disabled: true },
  ],
  edges: [
    { id: "e1", source: "trigger", target: "fetch", sourceHandle: null },
    { id: "e2", source: "fetch", target: "say" },
  ],
  notes: [
    {
      id: "note_1",
      position: { x: -40, y: -180 },
      size: { width: 240, height: 140 },
      text: "Ask Priya before changing the sheet.",
      tone: "yellow",
    },
  ],
};

const NOW = new Date("2026-10-08T12:00:00.000Z");

/**
 * A whole workflow row, every secret-shaped column holding a sentinel. The export is made from
 * the row exactly as a route would hand it over, so the test proves the builder reads only what
 * it names.
 */
function row(): Workflow {
  return {
    id: "SENTINEL-WORKFLOW-ID",
    ownerId: "SENTINEL-OWNER-ID",
    workspaceId: "SENTINEL-WORKSPACE-ID",
    name: "Weekly report",
    description: "Posts the numbers on Monday.",
    graph: structuredClone(GRAPH),
    webhookToken: "SENTINEL-WEBHOOK-TOKEN",
    webhookTokenRotatedAt: null,
    scheduleNextAt: null,
    scheduleLastFiredAt: null,
    scheduleArmedFor: null,
    active: true,
    version: 7,
    visibility: "private",
    shareToken: "SENTINEL-SHARE-TOKEN",
    sharedAt: new Date(),
    agentTool: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

test("an export is a versioned envelope: a format name, a format version and the workflow", () => {
  const envelope = exportWorkflow(row(), { now: NOW });
  assert.equal(envelope.format, EXPORT_FORMAT);
  assert.equal(envelope.format, "agentforge/workflow");
  assert.equal(envelope.version, EXPORT_VERSION);
  assert.equal(envelope.exportedAt, NOW.toISOString());
  assert.deepEqual(Object.keys(envelope).toSorted(), ["exportedAt", "format", "version", "workflow"]);
  assert.deepEqual(Object.keys(envelope.workflow).toSorted(), ["description", "graph", "name"]);
  assert.equal(envelope.workflow.name, "Weekly report");
  assert.equal(envelope.workflow.description, "Posts the numbers on Monday.");
});

test("no token, id, owner or workspace can appear in an export — the builder reads only what it names", () => {
  const text = JSON.stringify(exportWorkflow(row(), { includePinned: true }));
  for (const sentinel of [
    "SENTINEL-WORKFLOW-ID",
    "SENTINEL-OWNER-ID",
    "SENTINEL-WORKSPACE-ID",
    "SENTINEL-WEBHOOK-TOKEN",
    "SENTINEL-SHARE-TOKEN",
  ]) {
    assert.equal(text.includes(sentinel), false, `${sentinel} leaked into the export`);
  }
  for (const key of ["webhookToken", "shareToken", "ownerId", "workspaceId", "visibility", "active", "version\":7"]) {
    assert.equal(text.includes(key), false, `${key} appears in the export`);
  }
});

test("a stray key on a stored node never reaches the export — nodes are built field by field", () => {
  const source = row();
  (source.graph.nodes[1] as Record<string, unknown>).credential = "SENTINEL-CIPHERTEXT";
  (source.graph as Record<string, unknown>).owner = "SENTINEL-OWNER";
  const text = JSON.stringify(exportWorkflow(source, { includePinned: true }));
  assert.equal(text.includes("SENTINEL-CIPHERTEXT"), false);
  assert.equal(text.includes("SENTINEL-OWNER"), false);
});

test("pinned outputs are left out unless asked for (D146)", () => {
  const without = exportWorkflow(row());
  assert.equal(pinnedCount(without.workflow.graph), 0);
  assert.equal(JSON.stringify(without).includes("from somebody's inbox"), false);
  assert.ok(without.workflow.graph.nodes.every((node) => !("pinned" in node)));

  const withPins = exportWorkflow(row(), { includePinned: true });
  assert.equal(pinnedCount(withPins.workflow.graph), 1);
  assert.deepEqual(withPins.workflow.graph.nodes[1].pinned, { output: { status: 200, body: "from somebody's inbox" } });
});

test("notes and the off switch are part of the workflow, and travel", () => {
  const { graph } = exportWorkflow(row()).workflow;
  assert.equal(graph.nodes[2].disabled, true);
  assert.deepEqual(graph.notes, GRAPH.notes);
});

test("an export imported again is the same graph — absent stays absent, null stays null", () => {
  const exported = exportWorkflow(row(), { includePinned: true });
  const reading = readImport(JSON.parse(JSON.stringify(exported)));
  assert.equal(reading.ok, true);
  if (!reading.ok) return;
  assert.equal(graphsEqual(reading.workflow.graph, GRAPH), true);
  // `sourceHandle: null` and an absent one are different values to `graphsEqual`.
  assert.equal(reading.workflow.graph.edges[0].sourceHandle, null);
  assert.equal("sourceHandle" in reading.workflow.graph.edges[1], false);
  assert.equal("label" in reading.workflow.graph.nodes[0], false);
  assert.equal(reading.workflow.name, "Weekly report");
});

test("a graph with no notes exports none — not an empty list", () => {
  const source = row();
  delete source.graph.notes;
  assert.equal("notes" in exportWorkflow(source).workflow.graph, false);
});

test("an export without pins of a pinned graph imports as the graph without them", () => {
  const reading = readImport(JSON.parse(JSON.stringify(exportWorkflow(row()))));
  assert.equal(reading.ok, true);
  if (!reading.ok) return;
  assert.equal(graphsEqual(reading.workflow.graph, GRAPH), false);
  const unpinned = structuredClone(GRAPH);
  delete unpinned.nodes[1].pinned;
  assert.equal(graphsEqual(reading.workflow.graph, unpinned), true);
});

/* ------------------------------ readImport ------------------------------ */

const envelope = () => JSON.parse(JSON.stringify(exportWorkflow(row()))) as Record<string, unknown>;

test("something that is not an object is not an export", () => {
  for (const value of [null, 42, "hello", [], true]) {
    const reading = readImport(value);
    assert.equal(reading.ok, false);
    if (!reading.ok) assert.equal(reading.refusal.reason, "not_an_export");
  }
});

test("an object of another format is not an export, and the message says what one looks like", () => {
  for (const value of [{}, { format: "n8n" }, { nodes: [], connections: {} }, { version: 1, nodes: [], edges: [] }]) {
    const reading = readImport(value);
    assert.equal(reading.ok, false);
    if (reading.ok) continue;
    assert.equal(reading.refusal.reason, "not_an_export");
    assert.match(reading.refusal.message, /agentforge\/workflow/);
  }
});

test("a copy of nodes from the canvas is recognised, and pointed at the canvas", () => {
  const reading = readImport({ format: "agentforge/nodes", version: 1, nodes: [], edges: [] });
  assert.equal(reading.ok, false);
  if (reading.ok) return;
  assert.equal(reading.refusal.reason, "nodes_clipboard");
  assert.match(reading.refusal.message, /paste it onto the canvas/);
});

test("a newer format version is refused as newer — before its shape is read", () => {
  // A version 2 file may have any shape; it must be refused for being newer, not for that.
  const reading = readImport({ format: EXPORT_FORMAT, version: 2, somethingNew: true });
  assert.equal(reading.ok, false);
  if (reading.ok) return;
  assert.equal(reading.refusal.reason, "newer_version");
  assert.match(reading.refusal.message, /version 2/);
  assert.match(reading.refusal.message, /reads version 1/);
  assert.match(reading.refusal.message, /nothing was imported/);
});

test("a newer graph version is refused as newer too", () => {
  const value = envelope();
  (value.workflow as { graph: { version: number } }).graph.version = 3;
  const reading = readImport(value);
  assert.equal(reading.ok, false);
  if (!reading.ok) {
    assert.equal(reading.refusal.reason, "newer_version");
    assert.match(reading.refusal.message, /graph is version 3/);
  }
});

test("a version that is not a whole number of 1 or more is unreadable, not newer", () => {
  for (const version of [undefined, "1", 0, -1, 1.5, null]) {
    const reading = readImport({ ...envelope(), version });
    assert.equal(reading.ok, false, String(version));
    if (!reading.ok) assert.equal(reading.refusal.reason, "invalid", String(version));
  }
});

test("a malformed workflow is refused with the paths that failed, under `workflow.`", () => {
  const value = envelope();
  const workflow = value.workflow as { name: string; graph: { nodes: { position: unknown }[] } };
  workflow.name = "   ";
  workflow.graph.nodes[0].position = "top left";
  const reading = readImport(value);
  assert.equal(reading.ok, false);
  if (reading.ok || reading.refusal.reason !== "invalid") return assert.fail("expected invalid");
  const paths = reading.refusal.issues.map((issue) => issue.path);
  assert.ok(paths.includes("workflow.name"), paths.join(", "));
  assert.ok(paths.includes("workflow.graph.nodes.0.position"), paths.join(", "));
});

test("an import meets the graph's own limits — a pin over 32 KB is refused", () => {
  const value = envelope();
  (value.workflow as { graph: { nodes: { pinned?: unknown }[] } }).graph.nodes[1].pinned = {
    output: "x".repeat(33 * 1024),
  };
  const reading = readImport(value);
  assert.equal(reading.ok, false);
  if (!reading.ok) assert.equal(reading.refusal.reason, "invalid");
});

test("an import's name is trimmed, and a missing description is null", () => {
  const value = envelope();
  const workflow = value.workflow as { name: string; description?: unknown };
  workflow.name = "  Spaced out  ";
  delete workflow.description;
  const reading = readImport(value);
  assert.equal(reading.ok, true);
  if (reading.ok) {
    assert.equal(reading.workflow.name, "Spaced out");
    assert.equal(reading.workflow.description, null);
  }
});

test("`exportedAt` is informational — an export without it still imports", () => {
  const value = envelope();
  delete value.exportedAt;
  assert.equal(readImport(value).ok, true);
});

/* --------------------------- unknown node types --------------------------- */

test("unknown node types are read off validateGraph's problems, deduped, in graph order", () => {
  const graph = {
    nodes: [
      { id: "a", type: "integration.trello" },
      { id: "b", type: "core.log" },
      { id: "c", type: "core.merge" },
      { id: "d", type: "integration.trello" },
    ],
  };
  const problems: GraphProblem[] = [
    { code: "unknown_node_type", message: "", nodeId: "a" },
    { code: "no_trigger", message: "" },
    { code: "unknown_node_type", message: "", nodeId: "c" },
    { code: "unknown_node_type", message: "", nodeId: "d" },
  ];
  assert.deepEqual(unknownNodeTypes(graph, problems), ["integration.trello", "core.merge"]);
  assert.deepEqual(unknownNodeTypes(graph, problems.filter((p) => p.code !== "unknown_node_type")), []);
});

test("the refusal names every unknown type and says nothing was imported (D39)", () => {
  assert.equal(
    unknownTypesMessage(["integration.trello"]),
    "This workflow uses a node type this AgentForge does not have: “integration.trello”. Nothing was imported.",
  );
  const many = unknownTypesMessage(["integration.trello", "core.merge"]);
  assert.match(many, /2 node types/);
  assert.match(many, /“integration\.trello”, “core\.merge”/);
});

/* ------------------------------ names ------------------------------ */

test("a duplicate is called '<name> (copy)', and still fits the 200-character column", () => {
  assert.equal(copyName("Weekly report"), "Weekly report (copy)");
  const long = copyName("x".repeat(200));
  assert.equal(long.length, 200);
  assert.ok(long.endsWith(" (copy)"));
});

test("a duplicate's first version says where it came from, in at most 80 characters", () => {
  assert.equal(duplicateLabel("Weekly report", 7), "Duplicated from v7 of “Weekly report”");
  const long = duplicateLabel("A very long workflow name that goes on and on and on and on and on", 1234);
  assert.ok(long.length <= 80, `${long.length}: ${long}`);
  assert.ok(long.startsWith("Duplicated from v1234 of “"));
  assert.ok(long.endsWith("…”"));
});

test("an export's file name is the workflow's name as a slug", () => {
  assert.equal(exportFilename("Triage inbound leads!"), "triage-inbound-leads.agentforge.json");
  assert.equal(exportFilename("Café — weekly digest"), "cafe-weekly-digest.agentforge.json");
  assert.equal(exportFilename("🚀🚀"), "workflow.agentforge.json");
  assert.equal(exportFilename("   "), "workflow.agentforge.json");
  const long = exportFilename("word ".repeat(40));
  assert.ok(long.length <= 60 + ".agentforge.json".length);
  assert.ok(!long.includes("-.agentforge"));
});
