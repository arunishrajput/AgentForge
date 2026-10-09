/**
 * Generates the parts of `docs/` that are derivable from the code, and checks the
 * parts that are not.
 *
 *   node --import ./scripts/test-register.mjs scripts/build-docs.mjs          # write
 *   node --import ./scripts/test-register.mjs scripts/build-docs.mjs --check  # verify
 *
 * Why this exists — Phase 24. A hand-written node reference is a lie waiting to
 * happen: the registry is the spine (ARCHITECTURE.md), every node already carries a
 * `label`, a `description`, a `docs` block, an `outputShape` and a Zod schema, and
 * the inspector already renders them. Writing those facts out a second time by hand
 * would create the one thing this project has consistently refused — a second source
 * of truth. So `docs/nodes.md` is generated, and `--check` runs in CI, which means a
 * node added without documentation fails the build rather than shipping undocumented.
 *
 * The API reference is the other half and cannot be generated honestly: a route's
 * meaning is not in its file. What *is* checkable is coverage — every `route.ts`
 * under `src/app/api` must appear in `docs/api.md`, and nothing may be documented
 * that does not exist. That catches the two ways an API reference rots.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describeNodes } from "../src/lib/nodes/index.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const check = process.argv.includes("--check");

/* ---------------------------------------------------------------- nodes.md -- */

const CATEGORY_ORDER = ["trigger", "logic", "transform", "agent", "integration"];

const CATEGORY_BLURB = {
  trigger: "Every workflow starts at exactly one of these. Nothing may draw an edge into a trigger.",
  logic: "Flow control and plumbing — the nodes that decide where a run goes next, or pause it.",
  transform:
    "Pure data shaping. None of them reach the network, and each one reads the previous node's list, so they chain with nothing in between.",
  agent:
    "The reasoning nodes. `ai.llm` asks a model once; `ai.agent` loops — thinking, calling other nodes as tools, and deciding when it is done.",
  integration:
    "The nodes that reach a real service. Each one is bound to a credential you created, which is what fixes its destination.",
};

/** JSON Schema → a short human type. Returns "any" when the schema says nothing. */
function renderType(schema) {
  if (!schema || typeof schema !== "object") return "any";
  if (Array.isArray(schema.enum)) {
    return schema.enum.map((value) => `\`${String(value)}\``).join(" · ");
  }
  if (Array.isArray(schema.anyOf)) {
    return [...new Set(schema.anyOf.map(renderType))].join(" or ");
  }
  if (schema.type === "array") {
    const inner = renderType(schema.items);
    return inner === "any" ? "array" : `array of ${inner}`;
  }
  if (typeof schema.type === "string") return schema.type;
  return "any";
}

function renderDefault(schema) {
  if (!schema || !Object.hasOwn(schema, "default")) return "";
  const value = schema.default;
  if (value === "") return "`\"\"`";
  if (typeof value === "object") return `\`${JSON.stringify(value)}\``;
  return `\`${String(value)}\``;
}

/** Escapes a cell so a pipe or a newline in a description cannot break the table. */
function cell(text) {
  return String(text ?? "").replaceAll("|", "\\|").replaceAll("\n", " ").trim();
}

function configTable(schema) {
  const properties = schema?.properties ?? {};
  const names = Object.keys(properties);
  if (names.length === 0) return "_No configuration._\n";

  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const rows = names.map((name) => {
    const property = properties[name];
    return `| \`${name}\` | ${cell(renderType(property))} | ${required.has(name) ? "yes" : "no"} | ${renderDefault(property) || "—"} |`;
  });

  return ["| Field | Type | Required | Default |", "|---|---|---|---|", ...rows].join("\n") + "\n";
}

/** The one place a node's section heading is spelled. The anchor is derived from it. */
function nodeHeading(node) {
  return `\`${node.type}\` — ${node.label}`;
}

/**
 * GitHub's heading-anchor rule: lowercase, drop everything that is not a word
 * character, a hyphen or a space, then hyphenate the spaces. Underscores survive and
 * dots do not, which is exactly the pair a hand-written anchor gets wrong.
 */
function githubAnchor(heading) {
  return heading
    .toLowerCase()
    .replace(/[^\w\- ]/g, "")
    .trim()
    .replaceAll(" ", "-");
}

function renderNode(node) {
  const lines = [];
  lines.push(`### ${nodeHeading(node)}`);
  lines.push("");

  const badges = [`**${node.kind}**`];
  badges.push(node.agentCallable ? "callable by the agent" : "**not** callable by the agent");
  lines.push(badges.join(" · "));
  lines.push("");

  lines.push(node.docs?.summary ?? node.description);
  lines.push("");

  if (node.docs?.accepts) {
    lines.push(`**Input.** ${node.docs.accepts}`);
    lines.push("");
  }

  if (node.outputShape) {
    lines.push(`**Output.** ${node.outputShape}`);
    lines.push("");
  }

  if (node.outputs.length > 1 || node.outputs.some((output) => output.key !== null)) {
    const outputs = node.outputs
      .map((output) => (output.key === null ? `${output.label} (default)` : `${output.label} (\`${output.key}\`)`))
      .join(" · ");
    lines.push(`**Branches.** ${outputs}`);
    lines.push("");
  }

  lines.push(configTable(node.configSchema));

  if (node.docs?.examples?.length) {
    lines.push("**Examples**");
    lines.push("");
    for (const example of node.docs.examples) {
      lines.push(`- *${example.title}* — ${example.body}`);
    }
    lines.push("");
  }

  lines.push("<details><summary>What the agent reads</summary>");
  lines.push("");
  lines.push("> " + node.description);
  lines.push("");
  lines.push("</details>");
  lines.push("");

  return lines.join("\n");
}

function buildNodesDoc() {
  const nodes = describeNodes();
  const callable = nodes.filter((node) => node.agentCallable);
  const byCategory = new Map(CATEGORY_ORDER.map((category) => [category, []]));
  for (const node of nodes) {
    if (!byCategory.has(node.category)) byCategory.set(node.category, []);
    byCategory.get(node.category).push(node);
  }

  const out = [];
  out.push("<!-- GENERATED by scripts/build-docs.mjs from the node registry. Do not edit by hand. -->");
  out.push("<!-- Run `npm run docs:build` after changing a node; CI runs `npm run docs:check`. -->");
  out.push("");
  out.push("# Node reference");
  out.push("");
  out.push(
    `**${nodes.length} nodes**, of which **${callable.length} are callable by an agent node as tools**.`,
  );
  out.push("");
  out.push(
    "This page is generated from the registry itself, so it cannot drift from what the product does.",
  );
  out.push(
    "Every entry below is one object in [`src/lib/nodes/`](../src/lib/nodes) — the same object the",
  );
  out.push(
    "engine dispatches through, the canvas palette renders, and the agent is handed as a tool",
  );
  out.push("definition. See [`architecture.md`](./architecture.md) → *The registry is the spine*.");
  out.push("");
  out.push("## Every node at a glance");
  out.push("");
  out.push("| Node | Type | Category | Agent tool |");
  out.push("|---|---|---|---|");
  for (const category of byCategory.keys()) {
    for (const node of byCategory.get(category)) {
      out.push(
        `| [${cell(node.label)}](#${githubAnchor(nodeHeading(node))}) | \`${node.type}\` | ${node.category} | ${node.agentCallable ? "yes" : "no"} |`,
      );
    }
  }
  out.push("");

  for (const category of byCategory.keys()) {
    const group = byCategory.get(category);
    if (group.length === 0) continue;
    out.push("---");
    out.push("");
    out.push(`## ${category[0].toUpperCase()}${category.slice(1)}`);
    out.push("");
    if (CATEGORY_BLURB[category]) {
      out.push(CATEGORY_BLURB[category]);
      out.push("");
    }
    for (const node of group) out.push(renderNode(node));
  }

  out.push("---");
  out.push("");
  out.push("## Why some nodes are not agent tools");
  out.push("");
  out.push(
    "`agentCallable` defaults to `false`. Widening what an agent may reach is a deliberate act per",
  );
  out.push(
    "node, never a side effect of registering one — see [`agents.md`](./agents.md) and",
  );
  out.push("[`../SECURITY.md`](../SECURITY.md) → *The agent, and what it cannot reach*.");
  out.push("");
  const notCallable = nodes.filter((node) => !node.agentCallable);
  out.push("| Node | Why not |");
  out.push("|---|---|");
  for (const node of notCallable) {
    const reason =
      node.kind === "trigger"
        ? "A trigger starts a run; an agent runs inside one."
        : node.type === "integration.gmail"
          ? "Sends mail as you. A model deciding to send email is a blast radius, not a feature."
          : "Flow control belongs to the graph, not to a tool call.";
    out.push(`| \`${node.type}\` | ${reason} |`);
  }
  out.push("");

  return out.join("\n");
}

/* ------------------------------------------------------------------ api.md -- */

function listRouteFiles(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listRouteFiles(full, found);
    else if (entry.name === "route.ts") found.push(full);
  }
  return found;
}

/** `src/app/api/workflows/[id]/runs/route.ts` → `/api/workflows/[id]/runs` */
function routePath(file) {
  return (
    "/" +
    relative(join(root, "src/app"), file)
      .replace(/\/route\.ts$/, "")
      .split("/")
      .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")))
      .join("/")
  );
}

function checkApiDoc() {
  const docPath = join(root, "docs/api.md");
  let text;
  try {
    text = readFileSync(docPath, "utf8");
  } catch {
    return [`docs/api.md does not exist`];
  }

  const routes = listRouteFiles(join(root, "src/app/api")).map(routePath).sort();
  const problems = [];

  for (const route of routes) {
    if (!text.includes(`\`${route}\``)) problems.push(`undocumented route: ${route}`);
  }

  // Phase 41: the routes that accept a personal access token are a fact about the source — the ones
  // that call `requireApiScope` — so the list in the doc is checked against it, both ways.
  const accepting = listRouteFiles(join(root, "src/app/api"))
    .filter((file) => /\brequireApiScope\(/.test(readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")))
    .map(routePath)
    .sort();
  const block = /<!-- token-routes:start -->([\s\S]*?)<!-- token-routes:end -->/.exec(text);
  if (!block) {
    problems.push("docs/api.md has no <!-- token-routes:start --> … <!-- token-routes:end --> block");
  } else {
    const listed = new Set([...block[1].matchAll(/`(\/api\/[^`\s]*)`/g)].map((m) => m[1]));
    for (const route of accepting) {
      if (!listed.has(route)) problems.push(`accepts a token but is not in the token-routes block: ${route}`);
    }
    for (const route of listed) {
      if (!accepting.includes(route)) problems.push(`listed as accepting a token but does not: ${route}`);
    }
  }

  // Anything in the doc that looks like an api path must actually exist.
  const known = new Set(routes);
  for (const match of text.matchAll(/`(\/api\/[^`\s]*)`/g)) {
    const cited = match[1].replace(/\/$/, "");
    if (!known.has(cited)) problems.push(`documented route does not exist: ${cited}`);
  }

  return problems;
}

/* ------------------------------------------------------------------- links -- */

/**
 * Every relative link in the documentation must resolve to a file that exists, and
 * every `#fragment` into a Markdown file must resolve to a heading in it.
 *
 * A dead link is the cheapest possible way to look unserious to somebody reading the
 * repository for the first time, and it is the failure mode that documentation
 * reorganisation produces every single time. External `http(s)` links are left alone:
 * checking them means a network call per link, which would make this gate flaky and
 * make CI depend on somebody else's uptime.
 */
function markdownFiles() {
  const files = ["README.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "SECURITY.md"];
  for (const dir of ["docs", "adr"]) {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".md")) files.push(`${dir}/${entry.name}`);
    }
  }
  return files.filter((file) => existsSync(join(root, file))).sort();
}

/** Every heading anchor a Markdown file offers, by GitHub's rule. */
function anchorsOf(text) {
  const anchors = new Set();
  for (const match of text.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)) {
    anchors.add(githubAnchor(match[1]));
  }
  return anchors;
}

function checkLinks() {
  const problems = [];
  const anchorCache = new Map();

  for (const file of markdownFiles()) {
    const text = readFileSync(join(root, file), "utf8");
    const dir = dirname(join(root, file));

    for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = match[1];
      if (/^(https?:|mailto:|#)/.test(target)) {
        // A same-file anchor still has to exist.
        if (target.startsWith("#") && !anchorsOf(text).has(target.slice(1))) {
          problems.push(`${file}: no heading for anchor ${target}`);
        }
        continue;
      }

      const [path, fragment] = target.split("#");
      const resolved = resolve(dir, path);
      if (!existsSync(resolved)) {
        problems.push(`${file}: broken link ${target}`);
        continue;
      }
      if (fragment && resolved.endsWith(".md")) {
        if (!anchorCache.has(resolved)) {
          anchorCache.set(resolved, anchorsOf(readFileSync(resolved, "utf8")));
        }
        if (!anchorCache.get(resolved).has(fragment)) {
          problems.push(`${file}: ${path} has no heading for anchor #${fragment}`);
        }
      }
    }
  }

  return problems;
}

/* -------------------------------------------------------------------- main -- */

const generated = [{ path: "docs/nodes.md", body: buildNodesDoc() }];
const failures = [];

for (const file of generated) {
  const full = join(root, file.path);
  if (check) {
    let current = "";
    try {
      current = readFileSync(full, "utf8");
    } catch {
      failures.push(`${file.path} has not been generated — run \`npm run docs:build\``);
      continue;
    }
    const hash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 12);
    if (current !== file.body) {
      failures.push(
        `${file.path} is stale (on disk ${hash(current)}, from the registry ${hash(file.body)}) — run \`npm run docs:build\``,
      );
    } else {
      console.log(`ok    ${file.path} matches the registry`);
    }
  } else {
    writeFileSync(full, file.body);
    console.log(`write ${file.path} (${file.body.length} bytes)`);
  }
}

const apiProblems = checkApiDoc();
if (apiProblems.length > 0) failures.push(...apiProblems);
else console.log("ok    docs/api.md covers every route under src/app/api, and invents none");

const linkProblems = checkLinks();
if (linkProblems.length > 0) failures.push(...linkProblems);
else console.log("ok    every relative documentation link resolves, anchors included");

if (failures.length > 0) {
  console.error("\nDocumentation is out of date:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(check ? "\nDocumentation is current." : "\nDocumentation generated.");
