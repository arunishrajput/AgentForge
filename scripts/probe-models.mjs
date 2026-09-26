#!/usr/bin/env node
/**
 * probe-models.mjs — which Gemini models can this key actually use, and how fast?
 *
 * Phase 13 exists partly because a model name in the fallback chain went bad and the
 * adapter spent 91.9 s discovering it. This script is how that is never guessed again:
 * it makes REAL calls and reports measured latency, so `FALLBACK_MODELS` in
 * `src/lib/ai/gemini.ts` is set from numbers rather than from memory.
 *
 * Two probes per model, because they fail independently — and the Phase 12 incident was
 * exactly that divergence:
 *
 *   • text        — one tiny generateContent call, no tools.
 *   • tool-call   — the same call with one function declaration, which is the path an
 *                   `ai.agent` node takes. `ai.llm` answered on gemini-3.5-flash-lite in
 *                   1.4 s in the same run where `ai.agent` took 91.9 s on it.
 *
 * A model is HEALTHY only when both probes pass. One that answers text but not tools is
 * usable for `ai.llm` and unusable as an agent's model, which is a distinction the
 * fallback chain has to respect.
 *
 * Usage:
 *   # the free-tier key, read straight from Google Cloud and never printed
 *   KEY=$(gcloud services api-keys get-key-string \
 *     projects/370286775466/locations/global/keys/f6e2a035-a9a5-4b7b-8b8b-c4765c67d153 \
 *     --format='value(keyString)' --project=agentforge-gemini-free)
 *   GEMINI_API_KEY="$KEY" node scripts/probe-models.mjs
 *
 *   # probe named models instead of the discovered catalogue
 *   GEMINI_API_KEY="$KEY" node scripts/probe-models.mjs gemini-3.5-flash-lite gemini-3.8-flash
 *
 *   # --json for machine consumption; --timeout-ms to change the per-probe budget
 *   GEMINI_API_KEY="$KEY" node scripts/probe-models.mjs --json --timeout-ms 20000
 *
 * The free tier rate-limits hard, so probes run SEQUENTIALLY with a pause between them.
 * Running them in parallel produces a wall of 429s that says nothing about model health.
 */

const BASE = "https://generativelanguage.googleapis.com/v1beta";

const API_KEY = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
if (!API_KEY) {
  console.error(
    "No key. Set GEMINI_API_KEY (preferred) or GOOGLE_GENERATIVE_AI_API_KEY.\n" +
      "The free-tier key lives in the agentforge-gemini-free project — see the header.",
  );
  process.exit(2);
}

const argv = process.argv.slice(2);
const json = argv.includes("--json");
const timeoutMs = readNumber("--timeout-ms", 15_000);
const pauseMs = readNumber("--pause-ms", 900);
const named = argv.filter((arg) => !arg.startsWith("--") && !/^\d+$/.test(arg));

function readNumber(flag, fallback) {
  const index = argv.indexOf(flag);
  if (index === -1) return fallback;
  const value = Number(argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** The one tool shape every agent node sends: an object schema with one string field. */
const PROBE_TOOL = {
  name: "record_note",
  description: "Record a short note. Call this exactly once.",
  parameters: {
    type: "object",
    properties: { note: { type: "string", description: "The note to record." } },
    required: ["note"],
  },
};

async function call(model, body) {
  const started = Date.now();
  try {
    const response = await fetch(`${BASE}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": API_KEY, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await response.json().catch(() => ({}));
    const ms = Date.now() - started;

    if (response.status !== 200) {
      return { ok: false, ms, status: response.status, error: payload?.error?.message ?? `HTTP ${response.status}` };
    }
    return { ok: true, ms, status: 200, payload };
  } catch (error) {
    // A timeout is a result, not a crash — it is the exact failure Phase 13 is fixing.
    const ms = Date.now() - started;
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    return {
      ok: false,
      ms,
      status: 0,
      error: timedOut ? `timed out after ${timeoutMs} ms` : String(error?.message ?? error),
      timedOut,
    };
  }
}

async function probeText(model) {
  const result = await call(model, {
    contents: [{ role: "user", parts: [{ text: "Reply with exactly: OK" }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 1000 },
  });
  if (!result.ok) return result;

  const parts = result.payload?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((part) => part.text ?? "").join("").trim();
  // An empty completion is a failure dressed as a 200 — a thinking model that spent its
  // whole output budget before writing a token answers 200 with no text.
  return text.length > 0
    ? { ...result, text }
    : { ...result, ok: false, error: "200 with an empty completion" };
}

async function probeTools(model) {
  const result = await call(model, {
    contents: [{ role: "user", parts: [{ text: 'Record a note that says "hello".' }] }],
    tools: [{ functionDeclarations: [PROBE_TOOL] }],
    generationConfig: { temperature: 0, maxOutputTokens: 1000 },
  });
  if (!result.ok) return result;

  const parts = result.payload?.candidates?.[0]?.content?.parts ?? [];
  const called = parts.some((part) => part.functionCall);
  return called
    ? result
    : { ...result, ok: false, error: "answered without calling the tool" };
}

async function discover() {
  const response = await fetch(`${BASE}/models?pageSize=200`, {
    headers: { "x-goog-api-key": API_KEY },
  });
  const payload = await response.json();
  if (response.status !== 200) {
    throw new Error(payload?.error?.message ?? `models.list returned HTTP ${response.status}`);
  }
  return (payload.models ?? [])
    .filter((model) => (model.supportedGenerationMethods ?? []).includes("generateContent"))
    .map((model) => String(model.name ?? "").replace(/^models\//, ""))
    .filter(
      (id) =>
        id.startsWith("gemini-") &&
        !/-(tts|image|transcribe|embedding)\b/.test(id) &&
        !id.includes("computer-use") &&
        !id.includes("robotics") &&
        // `-latest` aliases move under you; the chain must name a concrete model.
        !id.endsWith("-latest"),
    );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const models = named.length > 0 ? named : await discover();
const results = [];

if (!json) {
  console.log(`Probing ${models.length} model(s), ${timeoutMs} ms budget per probe.\n`);
  console.log("model                                  text        tool-call   verdict");
  console.log("-".repeat(78));
}

for (const model of models) {
  const text = await probeText(model);
  await sleep(pauseMs);
  const tools = await probeTools(model);
  await sleep(pauseMs);

  const healthy = text.ok && tools.ok;
  const entry = {
    model,
    healthy,
    text: { ok: text.ok, ms: text.ms, status: text.status, error: text.error ?? null },
    tools: { ok: tools.ok, ms: tools.ms, status: tools.status, error: tools.error ?? null },
  };
  results.push(entry);

  if (!json) {
    const cell = (probe) => (probe.ok ? `${probe.ms} ms`.padEnd(11) : `FAIL ${probe.status || "-"}`.padEnd(11));
    const verdict = healthy ? "HEALTHY" : text.ok ? "text only" : "unusable";
    const why = healthy ? "" : `  ← ${(tools.error ?? text.error ?? "").slice(0, 60)}`;
    console.log(`${model.padEnd(38)} ${cell(text)} ${cell(tools)} ${verdict}${why}`);
  }
}

const healthy = results
  .filter((entry) => entry.healthy)
  .sort((a, b) => a.tools.ms + a.text.ms - (b.tools.ms + b.text.ms));

if (json) {
  console.log(JSON.stringify({ probedAt: new Date().toISOString(), timeoutMs, results, ranked: healthy.map((e) => e.model) }, null, 2));
} else {
  console.log("-".repeat(78));
  console.log(`\n${healthy.length} of ${results.length} model(s) healthy on BOTH paths, fastest first:\n`);
  for (const entry of healthy) {
    console.log(`  ${entry.model.padEnd(38)} text ${String(entry.text.ms).padStart(6)} ms   tools ${String(entry.tools.ms).padStart(6)} ms`);
  }
  console.log(
    "\nSet FALLBACK_MODELS in src/lib/ai/gemini.ts from this list — fastest first, and\n" +
      "pick three from different families so one family's outage cannot empty the chain.",
  );
}

process.exit(healthy.length > 0 ? 0 : 1);
