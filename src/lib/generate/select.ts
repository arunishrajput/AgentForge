import { z } from "zod";

import type { LanguageModel, Usage } from "@/lib/ai/types";
import { stripCodeFence } from "@/lib/nodes/ai/llm";
import type { NodeSummary } from "@/lib/nodes";

import { renderIndex } from "./prompt";

/**
 * **Which nodes does a request get full definitions for? — Phase 34.**
 *
 * Until Phase 34 every generation sent the whole catalogue: 30 nodes, 19,644 characters of a
 * 25,081-character prompt, growing ~820 characters with every node registered (D112 froze the
 * registry to hold it under a ceiling). Now the prompt carries an **index** — one line for every
 * node, so the model still knows everything that exists — and **full definitions** (config fields,
 * outputs, output shape) only for the nodes selected here. The prompt then grows by one index line
 * per node, not by a definition.
 *
 * A selector that drops a node the request needed is the failure that matters, and two things
 * stand against it. The eval set (`eval/cases.ts`) asserts, offline and exactly, that every node a
 * case requires is selected. And a miss is recoverable: the model may still use any indexed node,
 * and if its config for one is wrong, the retry is given that node's definition (`generate.ts`).
 *
 * **Two selectors were built and measured** (`BUILD_PLAN.md` → *Phase 34*, D156): this file's
 * deterministic one, and a first model call that picks from the index. The model selector is kept
 * because the eval runner measures it; generation uses whichever `DEFAULT_CATALOGUE` names
 * (`generate.ts`).
 */

export type SelectionStrategy = "full" | "deterministic" | "model" | "fixed";

export interface CatalogueSelection {
  strategy: SelectionStrategy;
  /** The types sent with full definitions, in registry order. */
  types: string[];
  /** The model selector's own call failed or answered nothing usable, so the deterministic one chose. */
  fellBack?: boolean;
  /** What the model selector's call cost. Absent for the other strategies. */
  usage?: Usage | null;
}

/** How generation should choose its catalogue. `fixed` replays a recorded selection. */
export type CatalogueOption =
  | { strategy: Exclude<SelectionStrategy, "fixed"> }
  | { strategy: "fixed"; types: string[] };

/**
 * At most this many nodes are chosen by the request's words, on top of the triggers, `ALWAYS` and
 * companions. Bounds the worst case the budget test (`registry.test.ts`) asserts. **Measured on the
 * eval set**: at 8 one case lost a node it required; at 10 every case keeps all of them, the worst
 * at rank 9. A bigger number buys margin at ~650 characters a node.
 */
export const MAX_SELECTED = 10;

/**
 * Sent with every request, as the triggers are. `ai.llm` is the general-purpose text step —
 * summarise, rewrite, extract, classify — and a request can need it without naming any of those
 * verbs: "turn my meeting notes into action items" has no word a matcher could catch.
 */
export const ALWAYS = ["ai.llm"];

/** A request that matches almost nothing still gets enough general-purpose nodes to build with. */
export const MIN_SELECTED = 4;
const GENERAL_PURPOSE = ["ai.llm", "core.log", "core.set", "core.branch"];

/**
 * Nodes the prompt tells the model to use together. An agent "does not have its own branches",
 * and the prompt's own advice is to follow it with a Branch on its decision — so selecting the
 * agent without the Branch would leave the model told to use a node it was not described.
 */
const COMPANIONS: Record<string, string[]> = {
  "ai.agent": ["core.branch"],
};

/* ------------------------------------------------------------------ *
 * Words
 * ------------------------------------------------------------------ */

const STOPWORDS = new Set(
  (
    "a an the and or but to of in on at for from with by as is are was were be been being it its " +
    "this that these those there their them they then than so do does did done have has had i me my " +
    "we us our you your he she his her him not no yes into onto out up down over off about also just " +
    "can could should would will shall may might must any all some what which who whom whose how why " +
    "where when get got make made use used using want need like please let s t one ones thing things " +
    "new via"
  ).split(" "),
);

/**
 * **Words that mean the same thing to a person asking.** About language, not about nodes: a new
 * node needs no entry here, because its own description and docs are what it is matched against.
 * Each group expands, on both sides, to every word in it — "spreadsheet" in a request meets "Sheet"
 * in a description, "email addresses" meets "mail", "every Monday" meets "schedule". A word may sit
 * in two groups ("every" is a schedule and a loop) and then expands to both. Only a request's words
 * are expanded; a node is matched on the words it actually uses.
 */
const SYNONYMS: string[] = [
  "summarise summary digest recap condense tldr shorten",
  "email mail inbox gmail",
  "sheet spreadsheet gsheet excel",
  "notify notification alert ping announce tell know channel",
  "decide decision classify classification categorise triage urgent urgency priority prioritise important judge approve approval reject escalate choose choice sentiment whether",
  "schedule scheduled every daily weekly hourly monthly morning evening night weekday weekdays weekend monday tuesday wednesday thursday friday saturday sunday cron timetable oclock",
  "webhook form submission submit submitted signup sign register incoming arrive arrives receive received callback",
  "wait delay later pause sleep until afterwards",
  "each every per iterate repeat loop individually",
  "filter keep only exclude under above below greater less cheaper threshold",
  "unique duplicate duplicates dedupe deduplicate distinct",
  "sort order rank cheapest expensive ascending descending newest oldest largest smallest highest lowest",
  "sum total average mean count tally aggregate minimum maximum many",
  "calculate calculation math maths arithmetic tax percent percentage round decimal decimals multiply divide subtract plus minus",
  "date today tomorrow yesterday timestamp time day week month year calendar now",
  "text uppercase lowercase capitalise replace trim prefix suffix front greeting string split substring",
  "json parse stringify serialise decode encode",
  "http https api endpoint url fetch request download webpage website site",
  "github issue issues bug repo repository",
  "notion page wiki doc document",
  "airtable base crm",
  "postgres postgresql sql database db table query",
  "ai llm gpt model write draft rewrite generate compose translate extract personalise personalised",
  "agent autonomous tool tools research investigate",
  "if whether otherwise else unless condition conditional compare comparison depending",
  "route routing category categories case cases depending",
  "set field fields enrich add rename",
  "reshape transform rebuild convert map pick",
  "assert validate validation ensure require required missing stop error fail guard abort",
  "log record print trace",
];

/**
 * A deliberately small stemmer — enough that "sheets", "posted", "summarising" and "summarize"
 * meet their roots, applied identically to a request and to a node's text, so its quirks cancel.
 */
export function stem(word: string): string {
  let w = word.replace(/z/g, "s");
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  if (w.length > 3 && w.endsWith("e") && !w.endsWith("ee")) w = w.slice(0, -1);
  return w;
}

/** Lower-cased words of a text, stop words dropped, stemmed. "8am" reads as a time of day. */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/e-mail/g, "email")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word) && !/^\d+$/.test(word))
    .map((word) => (/^\d{1,2}(am|pm)$/.test(word) ? "oclock" : stem(word)));
}

const groupsOf = new Map<string, Set<string>>();
for (const group of SYNONYMS) {
  const members = new Set(group.split(" ").map(stem));
  for (const member of members) {
    const existing = groupsOf.get(member) ?? new Set<string>();
    for (const other of members) existing.add(other);
    groupsOf.set(member, existing);
  }
}

/** A word and every word it means the same as. */
function expand(word: string): Set<string> {
  return groupsOf.get(word) ?? new Set([word]);
}

/* ------------------------------------------------------------------ *
 * The deterministic selector
 * ------------------------------------------------------------------ */

interface NodeDocument {
  type: string;
  /** Words of the type and label: a match here counts double. */
  name: Set<string>;
  /** Every word of the node's text, name included. **Not expanded** — see `scoreNodes`. */
  all: Set<string>;
}

function documentOf(node: NodeSummary): NodeDocument {
  const [namespace, local = ""] = node.type.split(".");
  const name = new Set([
    ...words(local.replace(/_/g, " ")),
    ...words(node.label),
    ...(namespace === "ai" ? ["ai"] : []),
  ]);
  const text = [
    node.description,
    node.docs?.summary ?? "",
    node.docs?.accepts ?? "",
    ...(node.docs?.examples ?? []).map((example) => example.title),
  ].join(" ");
  return { type: node.type, name, all: new Set([...name, ...words(text)]) };
}

/**
 * A word in a node's type or label says what the node *is*; the same word in its description may
 * only mention it ("writes to the run log"). And a synonym is weaker evidence than the word the
 * person actually typed: "uppercase" reaching Switch through "case" must not outweigh "log" naming
 * Log — which, before this weighting, it did (the `greeting` case).
 */
const NAME_WEIGHT = 2.5;
const SYNONYM_WEIGHT = 0.8;

/** Per-node scores for a request, for the selector and for the eval report. */
export function scoreNodes(request: string, nodes: NodeSummary[]): Map<string, number> {
  const documents = nodes.map(documentOf);
  const frequency = new Map<string, number>();
  for (const document of documents) {
    for (const term of document.all) frequency.set(term, (frequency.get(term) ?? 0) + 1);
  }
  const idf = (term: string) => Math.log(1 + documents.length / (frequency.get(term) ?? documents.length));

  const requested = [...new Set(words(request))];
  const scores = new Map<string, number>();
  for (const document of documents) {
    let score = 0;
    // Each word the person typed counts once, at the weight of its most distinctive match — so a
    // word in a large synonym group is not counted once per synonym. Only the request is expanded:
    // expanding the nodes' text too gave every node that says "per item" the word "loop", and the
    // one node *named* Loop stopped standing out (measured on the eval set: 31 of 37 → see Phase 34).
    for (const word of requested) {
      let best = 0;
      for (const term of expand(word)) {
        if (!document.all.has(term)) continue;
        const weight = (document.name.has(term) ? NAME_WEIGHT : 1) * (term === word ? 1 : SYNONYM_WEIGHT);
        best = Math.max(best, idf(term) * weight);
      }
      score += best;
    }
    scores.set(document.type, score);
  }
  return scores;
}

/** Below this a match is one common word, which says nothing about the request. */
const MIN_SCORE = 1.5;

export function selectDeterministic(request: string, nodes: NodeSummary[]): CatalogueSelection {
  const scores = scoreNodes(request, nodes);
  const chosen = new Set(nodes.filter((node) => node.kind === "trigger").map((node) => node.type));

  const ranked = nodes
    .filter((node) => node.kind !== "trigger" && (scores.get(node.type) ?? 0) >= MIN_SCORE)
    .sort((a, b) => (scores.get(b.type) ?? 0) - (scores.get(a.type) ?? 0))
    .slice(0, MAX_SELECTED);
  for (const node of ranked) chosen.add(node.type);

  return { strategy: "deterministic", types: complete(chosen, nodes) };
}

/**
 * Every trigger always (the first decision a workflow makes, and the one most often wrong), `ALWAYS`,
 * the companions of what was chosen, and general-purpose nodes up to `MIN_SELECTED` — in registry
 * order.
 */
function complete(chosen: Set<string>, nodes: NodeSummary[]): string[] {
  const known = new Set(nodes.map((node) => node.type));
  for (const node of nodes) if (node.kind === "trigger") chosen.add(node.type);
  for (const type of ALWAYS) chosen.add(type);
  // A Set visits what is added while it is iterated, so a companion's companions come too.
  for (const type of chosen) for (const companion of COMPANIONS[type] ?? []) chosen.add(companion);

  const actions = () => [...chosen].filter((type) => nodes.find((node) => node.type === type)?.kind !== "trigger");
  for (const type of GENERAL_PURPOSE) {
    if (actions().length >= MIN_SELECTED) break;
    chosen.add(type);
  }
  return nodes.map((node) => node.type).filter((type) => chosen.has(type) && known.has(type));
}

export function selectAll(nodes: NodeSummary[]): CatalogueSelection {
  return { strategy: "full", types: nodes.map((node) => node.type) };
}

/* ------------------------------------------------------------------ *
 * The model selector — measured against the deterministic one
 * ------------------------------------------------------------------ */

const selectorAnswer = z.object({ nodes: z.array(z.string().max(128)).max(60) });

export function selectorPrompt(nodes: NodeSummary[]): string {
  return `You choose the building blocks for an automation workflow. Given a request, answer with every node type a workflow for it would use — the trigger, each step, and anything needed to route or reshape data between them. Include a node when in doubt: leaving out a node the workflow needs is worse than including one it does not.

Answer with JSON only, in this shape: {"nodes": ["core.webhook_trigger", "ai.llm"]}

The node types that exist:

${renderIndex(nodes)}`;
}

export interface ModelSelectOptions {
  model: LanguageModel;
  modelId: string;
  request: string;
  nodes: NodeSummary[];
  signal?: AbortSignal;
}

/**
 * One cheap call that picks from the index. Anything that goes wrong — a provider error, prose, a
 * list naming nothing that exists — falls back to the deterministic choice rather than failing the
 * generation the person actually asked for.
 */
export async function selectWithModel(options: ModelSelectOptions): Promise<CatalogueSelection> {
  try {
    const result = await options.model.generate({
      model: options.modelId,
      system: selectorPrompt(options.nodes),
      turns: [{ role: "user", text: options.request }],
      json: true,
      signal: options.signal,
    });
    const parsed = selectorAnswer.safeParse(JSON.parse(stripCodeFence(result.text)));
    const known = new Set(options.nodes.map((node) => node.type));
    const named = parsed.success ? parsed.data.nodes.filter((type) => known.has(type)) : [];
    if (named.length > 0) {
      return { strategy: "model", types: complete(new Set(named), options.nodes), usage: result.usage };
    }
    return { ...selectDeterministic(options.request, options.nodes), strategy: "model", fellBack: true, usage: result.usage };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return { ...selectDeterministic(options.request, options.nodes), strategy: "model", fellBack: true };
  }
}
