#!/usr/bin/env node
/**
 * eval-generate.mjs — how good is generation, measured rather than eyeballed? (Phase 34)
 *
 * Runs the eval set (`src/lib/generate/eval/cases.ts`) through the real generation pipeline and
 * scores every answer: a valid graph, the trigger the request implies, the nodes it needs, none
 * it forbids, `unsupported` used honestly, and **every `{{ }}` reference resolving** — the check
 * that sees a valid graph doing the wrong thing.
 *
 *   npm run eval:generate                       offline: replay every recording, no network
 *   npm run eval:generate -- --live             live, against the free-tier key, the shipped selector
 *
 * Live options:
 *   --selector full|deterministic|model         the catalogue strategy (`select.ts`)
 *   --provider google|groq                      google reads GOOGLE_GENERATIVE_AI_API_KEY or
 *                                               GEMINI_API_KEY; groq reads GROQ_API_KEY
 *   --model <id>                                default: the provider's default model
 *   --case <id>[,<id>…]                         a subset
 *   --record <name>                             write recordings/<name>.json for offline replay; with
 *                                               --case, merge those cases into an existing recording
 *   --pause-ms <n>                              between cases (default 4000 — free tiers rate-limit)
 *   --recall                                    measure only the selector: which required nodes it
 *                                               chose. One small call a case for the model selector,
 *                                               none for the deterministic one
 *
 *   npm run eval:generate -- --rescore          re-judge every recording with today's scorer and
 *                                               rewrite its verdicts — after a deliberate change to
 *                                               the scorer or a case's expectations, never to hide one
 *
 *   --edit                                      **the copilot's edits** (Phase 35) instead of
 *                                               generation: `edit-cases.ts`, each a change to a
 *                                               starting workflow, scored on what it kept and removed
 *                                               as well. With --live it records `mode: "edit"`;
 *                                               offline, every recording replays by its own mode
 *
 * **Live runs spend real quota — run them sparingly, once per session** (`PROGRESS.md` →
 * *Operations*). The fallback chain is switched off for a live run, so every answer comes from the
 * model named and two runs are comparable; the model that answered is recorded per call anyway.
 *
 * Run with the repository's resolve hook, as `npm run eval:generate` does, so the TypeScript
 * sources load directly.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { geminiModel, DEFAULT_MODEL } from "../src/lib/ai/gemini.ts";
import { groqModel, GROQ_DEFAULT_MODEL } from "../src/lib/ai/groq.ts";
import { describeNodes } from "../src/lib/nodes/index.ts";
import { EVAL_CASES } from "../src/lib/generate/eval/cases.ts";
import { EDIT_CASES } from "../src/lib/generate/eval/edit-cases.ts";
import { recordingModel, replayCase, replayEditCase, runCase, runEditCase } from "../src/lib/generate/eval/run.ts";
import { describeRequirement, requirementMet } from "../src/lib/generate/eval/score.ts";
import { selectDeterministic, selectWithModel } from "../src/lib/generate/select.ts";

const RECORDINGS = path.join(process.cwd(), "src/lib/generate/eval/recordings");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1] : fallback;
};

const editing = flag("edit");
/** The case table a mode measures — generation's, or the copilot's (Phase 35). */
const tableFor = (mode) => (mode === "edit" ? EDIT_CASES : EVAL_CASES);
const only = option("case")?.split(",");
const table = tableFor(editing ? "edit" : "create");
const cases = only ? table.filter((entry) => only.includes(entry.id)) : table;
if (only && cases.length !== only.length) {
  console.error(`Unknown case in --case. Known: ${table.map((entry) => entry.id).join(", ")}`);
  process.exit(2);
}

function percent(part, whole) {
  return whole === 0 ? "—" : `${Math.round((part / whole) * 100)}%`;
}

/** One line per case, then the totals. Returns the totals so a caller can compare runs. */
function report(title, rows) {
  console.log(`\n${title}\n`);
  for (const row of rows) {
    const { evalCase, score, error, promptChars } = row;
    const mark = error ? "ERR " : score.pass ? "pass" : "FAIL";
    const held = evalCase.heldOut ? " (held out)" : "";
    console.log(`  ${mark}  ${evalCase.id}${held}  ${error ? "" : `attempt ${score.attempt ?? "-"}, ${promptChars ?? "?"} chars`}`);
    if (error) console.log(`          ${error}`);
    else {
      if (score.types.length > 0) console.log(`          ${score.types.join(" · ")}`);
      for (const failure of score.failures) console.log(`          ✗ ${failure}`);
    }
  }

  const judged = rows.filter((row) => !row.error);
  const passed = judged.filter((row) => row.score.pass).length;
  const valid = judged.filter((row) => row.score.valid).length;
  const first = judged.filter((row) => row.score.attempt === 1).length;
  const cleanRefs = judged.filter((row) => row.score.valid && row.score.references.length === 0).length;
  const held = judged.filter((row) => row.evalCase.heldOut);
  const heldPassed = held.filter((row) => row.score.pass).length;
  const chars = judged.map((row) => row.promptChars).filter((value) => typeof value === "number");
  const meanChars = chars.length ? Math.round(chars.reduce((a, b) => a + b, 0) / chars.length) : null;
  const spent = judged.map((row) => row.tokens).filter((value) => typeof value === "number");
  const meanTokens = spent.length ? Math.round(spent.reduce((a, b) => a + b, 0) / spent.length) : null;

  console.log(
    `\n  passed ${passed}/${judged.length} (${percent(passed, judged.length)}) · valid ${valid} · ` +
      `first attempt ${first} · references clean ${cleanRefs}/${valid} · held out ${heldPassed}/${held.length}` +
      (meanChars ? ` · prompt ${meanChars} chars on average` : "") +
      (meanTokens ? ` · ${meanTokens} tokens a case` : "") +
      (rows.length > judged.length ? ` · ${rows.length - judged.length} not judged (no answer, or a stale recording)` : ""),
  );
  return { passed, judged: judged.length };
}

async function offline({ rescore = false } = {}) {
  let files = [];
  try {
    files = readdirSync(RECORDINGS).filter((name) => name.endsWith(".json")).sort();
  } catch {
    // No recordings yet is a state, not an error.
  }
  if (files.length === 0) {
    console.log("No recordings yet. Make one with --live --record <name>.");
    return;
  }

  let drift = 0;
  for (const file of files) {
    const recording = JSON.parse(readFileSync(path.join(RECORDINGS, file), "utf8"));
    const edit = recording.mode === "edit";
    const own = tableFor(recording.mode);
    const rows = [];
    for (const evalCase of only ? own.filter((entry) => only.includes(entry.id)) : own) {
      const recorded = recording.cases[evalCase.id];
      if (!recorded) continue;
      if (recorded.error) {
        rows.push({ evalCase, error: recorded.error });
        continue;
      }
      let replayed;
      try {
        const replay = edit ? replayEditCase : replayCase;
        replayed = await replay(evalCase, recorded, generateOptionsFor(recording.selector, recorded));
      } catch (error) {
        // The pipeline now asks for a call the recording never made — it is stale, not failed.
        drift += 1;
        rows.push({ evalCase, error: `stale recording: ${error.message}` });
        continue;
      }
      const verdict = replayed.score.pass ? "pass" : "fail";
      if (verdict !== recorded.verdict) {
        drift += 1;
        console.log(`  ! ${evalCase.id}: recorded ${recorded.verdict}, replays as ${verdict}`);
      }
      if (rescore) {
        recorded.verdict = verdict;
        recorded.failures = replayed.score.failures;
      }
      rows.push({ evalCase, score: replayed.score, promptChars: recorded.promptChars });
    }
    if (rescore) writeFileSync(path.join(RECORDINGS, file), `${JSON.stringify(recording, null, 2)}\n`);
    report(
      `${file} — ${edit ? "copilot edits: " : ""}${recording.description} (${recording.provider} ${recording.model}, selector ${recording.selector}, ${recording.recordedAt.slice(0, 10)})`,
      rows,
    );
  }
  if (drift > 0 && rescore) {
    console.log(`\n${drift} verdict(s) rewritten. Say why in the commit that carries them.`);
  } else if (drift > 0) {
    console.log(`\n${drift} case(s) replay with a different verdict than was recorded — see above.`);
    process.exitCode = 1;
  }
}

/**
 * The options a recorded case is replayed with: the selection it was recorded with, so the replay
 * asks the pipeline for the same calls in the same order.
 */
function generateOptionsFor(selector, recorded) {
  // The model selector's own call is the recording's first; replaying through it reproduces the
  // selection from what the model said. A deterministic one is held to what it chose that day.
  if (selector === "deterministic") return { catalogue: { strategy: "fixed", types: recorded.selected ?? [] } };
  return { catalogue: { strategy: selector } };
}

async function live() {
  const providerId = option("provider", "google");
  const selector = option("selector", "deterministic");
  const pauseMs = Number(option("pause-ms", "4000"));
  const recordAs = option("record");

  const key =
    providerId === "groq"
      ? process.env.GROQ_API_KEY
      : (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY);
  if (!key) {
    console.error(`No key for ${providerId}. See the header of this file.`);
    process.exit(2);
  }
  const modelId = option("model", providerId === "groq" ? GROQ_DEFAULT_MODEL : DEFAULT_MODEL);
  // No fallbacks: a comparison between two runs means nothing if a different model answered some
  // of one of them. A long budget, because a free tier queues rather than refuses.
  const base =
    providerId === "groq"
      ? groqModel({ apiKey: key, defaultModel: modelId, fallbacks: [], ignoreHealth: true, totalBudgetMs: 90_000, attemptTimeoutMs: 60_000 })
      : geminiModel({ apiKey: key, defaultModel: modelId, fallbacks: [], ignoreHealth: true, totalBudgetMs: 90_000, attemptTimeoutMs: 60_000 });

  console.log(
    `Live: ${cases.length} ${editing ? "copilot edit" : "generation"} cases on ${providerId} ${modelId}, selector ${selector}. This spends real quota.`,
  );
  const run = editing ? runEditCase : runCase;

  const rows = [];
  const recorded = {};
  for (const [index, evalCase] of cases.entries()) {
    if (index > 0 && pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
    let model;
    try {
      // A free tier answers "high demand" in bursts. A case that got no answer says nothing about
      // generation, so it is tried again after a pause — twice — before it is recorded as an error.
      let outcome;
      for (let attempt = 0; ; attempt += 1) {
        model = recordingModel(base);
        try {
          outcome = await run(evalCase, { model, modelId, generateOptions: { catalogue: { strategy: selector } } });
          break;
        } catch (error) {
          if (attempt >= 2) throw error;
          process.stdout.write("r");
          await new Promise((resolve) => setTimeout(resolve, 30_000));
        }
      }
      const { score, result } = outcome;
      // The generation prompt is the last system prompt sent; a selector's own call comes first.
      const promptChars = model.systems.at(-1)?.length ?? 0;
      const spent = model.tokens.reduce((sum, entry) => sum + (entry ? entry.input + entry.output : 0), 0);
      rows.push({ evalCase, score, promptChars, tokens: spent });
      recorded[evalCase.id] = {
        calls: model.calls,
        models: model.models,
        ms: model.ms,
        tokens: model.tokens,
        selected: result.selection?.types ?? null,
        promptChars,
        verdict: score.pass ? "pass" : "fail",
        failures: score.failures,
      };
      process.stdout.write(score.pass ? "." : "F");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      rows.push({ evalCase, error: message });
      recorded[evalCase.id] = { calls: [], models: [], ms: [], selected: null, promptChars: 0, verdict: "fail", failures: [], error: message };
      process.stdout.write("E");
    }
  }
  process.stdout.write("\n");

  report(`Live — ${editing ? "copilot edits, " : ""}${providerId} ${modelId}, selector ${selector}`, rows);

  if (recordAs) {
    const file = path.join(RECORDINGS, `${recordAs}.json`);
    if (only) {
      // A subset merges into the recording it belongs to — filling in cases that got no answer.
      const existing = JSON.parse(readFileSync(file, "utf8"));
      Object.assign(existing.cases, recorded);
      existing.cases = Object.fromEntries(
        tableFor(existing.mode).filter((entry) => existing.cases[entry.id]).map((entry) => [entry.id, existing.cases[entry.id]]),
      );
      writeFileSync(file, `${JSON.stringify(existing, null, 2)}\n`);
      console.log(`\nMerged ${cases.length} case(s) into ${path.relative(process.cwd(), file)}`);
      return;
    }
    const recording = {
      label: recordAs,
      mode: editing ? "edit" : "create",
      description: option("description", `${selector} selector`),
      provider: providerId,
      model: modelId,
      selector,
      recordedAt: new Date().toISOString(),
      cases: recorded,
    };
    writeFileSync(file, `${JSON.stringify(recording, null, 2)}\n`);
    console.log(`\nRecorded to ${path.relative(process.cwd(), file)}`);
  }
}

/** Selection recall only: did the selector choose every node each case requires? */
async function recall() {
  const selector = option("selector", "deterministic");
  const nodes = describeNodes();
  let model;
  let modelId;
  if (selector === "model") {
    const providerId = option("provider", "google");
    const key =
      providerId === "groq" ? process.env.GROQ_API_KEY : (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY);
    modelId = option("model", providerId === "groq" ? GROQ_DEFAULT_MODEL : DEFAULT_MODEL);
    const options = { apiKey: key, defaultModel: modelId, fallbacks: [], ignoreHealth: true, totalBudgetMs: 90_000, attemptTimeoutMs: 60_000 };
    model = providerId === "groq" ? groqModel(options) : geminiModel(options);
  }

  let met = 0;
  let total = 0;
  let sizes = 0;
  let fellBack = 0;
  let tokens = 0;
  for (const [index, evalCase] of cases.entries()) {
    if (model && index > 0) await new Promise((resolve) => setTimeout(resolve, Number(option("pause-ms", "4000"))));
    const selection = model
      ? await selectWithModel({ model, modelId, request: evalCase.prompt, nodes })
      : selectDeterministic(evalCase.prompt, nodes);
    const chosen = new Set(selection.types);
    const misses = (evalCase.requires ?? []).filter((requirement) => !requirementMet(requirement, chosen));
    met += (evalCase.requires ?? []).length - misses.length;
    total += (evalCase.requires ?? []).length;
    sizes += selection.types.length;
    if (selection.fellBack) fellBack += 1;
    tokens += selection.usage?.totalTokens ?? 0;
    console.log(
      `  ${misses.length ? "MISS" : "ok  "}  ${evalCase.id}${evalCase.heldOut ? " (held out)" : ""}  ${selection.types.length} selected` +
        (selection.fellBack ? " (fell back)" : "") +
        (misses.length ? ` — missing ${misses.map(describeRequirement).join(", ")}` : ""),
    );
  }
  console.log(
    `\n  ${selector}: ${met}/${total} required nodes selected · ${(sizes / cases.length).toFixed(1)} selected a case` +
      (model ? ` · ${fellBack} fell back · ${Math.round(tokens / cases.length)} tokens a case for the selector` : ""),
  );
}

if (editing && flag("recall")) {
  // An edit's selection is the instruction's plus every type already on the canvas — the recall the
  // offline suite asserts for every edit case (`eval.test.ts`).
  console.error("--recall measures generation's selector; an edit's selection is asserted offline by eval.test.ts.");
  process.exit(2);
}

await (flag("live") ? live() : flag("recall") ? recall() : offline({ rescore: flag("rescore") }));
