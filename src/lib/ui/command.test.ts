import assert from "node:assert/strict";
import { test } from "node:test";

import { rankCommands, scoreCommand, type Command } from "./command";

const COMMANDS: Command[] = [
  { id: "new", title: "New workflow", keywords: ["create", "blank", "canvas"] },
  { id: "list", title: "Workflows", subtitle: "Everything you have built" },
  { id: "settings", title: "Settings", keywords: ["gemini", "api key", "discord", "google"] },
  { id: "design", title: "Design system", subtitle: "The Toybox gallery" },
];

const ids = (query: string) => rankCommands(COMMANDS, query).map((command) => command.id);

test("an empty query returns everything, in the order it was given", () => {
  assert.deepEqual(ids(""), ["new", "list", "settings", "design"]);
  assert.deepEqual(ids("   "), ["new", "list", "settings", "design"]);
});

test("an empty query returns a copy, not the caller's array", () => {
  const ranked = rankCommands(COMMANDS, "");
  assert.notEqual(ranked, COMMANDS);
  assert.deepEqual(ranked, COMMANDS);
});

test("a title prefix ranks above a title that merely contains the word", () => {
  // "Workflows" starts with it; "New workflow" has it as a later word.
  assert.deepEqual(ids("workflow"), ["list", "new"]);
});

test("a needle longer than the title is not a match", () => {
  // "workflows" cannot be found in "New workflow", and it is not a subsequence of
  // it either — the trailing "s" has nowhere to land.
  assert.deepEqual(ids("workflows"), ["list"]);
});

test("a prefix ranks above a match in the middle of a title", () => {
  assert.deepEqual(ids("new"), ["new"]);
  assert.equal(ids("work")[0], "list");
});

test("a word start ranks above a match inside a word", () => {
  const inside: Command = { id: "inside", title: "Unworkable" };
  const start: Command = { id: "start", title: "The work item" };

  assert.deepEqual(
    rankCommands([inside, start], "work").map((c) => c.id),
    ["start", "inside"],
  );
});

test("a keyword matches, at a discount to a title", () => {
  assert.deepEqual(ids("gemini"), ["settings"]);

  const byTitle: Command = { id: "title", title: "Gemini" };
  assert.deepEqual(
    rankCommands([COMMANDS[2], byTitle], "gemini").map((c) => c.id),
    ["title", "settings"],
  );
});

test("a subtitle matches, and ranks below a title match", () => {
  assert.deepEqual(ids("toybox"), ["design"]);

  const byTitle: Command = { id: "title", title: "Toybox" };
  assert.deepEqual(
    rankCommands([COMMANDS[3], byTitle], "toybox").map((c) => c.id),
    ["title", "design"],
  );
});

test("a subsequence matches, and ranks last", () => {
  assert.deepEqual(ids("nwf"), ["new"]);

  const exact: Command = { id: "exact", title: "nwf" };
  assert.deepEqual(
    rankCommands([COMMANDS[0], exact], "nwf").map((c) => c.id),
    ["exact", "new"],
  );
});

test("something that matches nothing is dropped", () => {
  assert.deepEqual(ids("kubernetes"), []);
});

test("a second term narrows rather than widens", () => {
  const one = ids("new");
  const two = ids("new workflow");

  assert.deepEqual(one, ["new"]);
  assert.deepEqual(two, ["new"]);
  assert.deepEqual(ids("new gemini"), []);
});

test("matching ignores case on both sides", () => {
  assert.deepEqual(ids("SETTINGS"), ["settings"]);
  assert.deepEqual(ids("  Design  "), ["design"]);
});

test("scoreCommand answers null for no match and 0 for no query", () => {
  assert.equal(scoreCommand(COMMANDS[0], "kubernetes"), null);
  assert.equal(scoreCommand(COMMANDS[0], "  "), 0);
});

test("equal scores keep their input order", () => {
  const a: Command = { id: "a", title: "Run it" };
  const b: Command = { id: "b", title: "Run it" };

  assert.deepEqual(rankCommands([a, b], "run it").map((c) => c.id), ["a", "b"]);
  assert.deepEqual(rankCommands([b, a], "run it").map((c) => c.id), ["b", "a"]);
});
