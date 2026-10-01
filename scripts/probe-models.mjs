#!/usr/bin/env node
/**
 * probe-models.mjs — which models can this key actually use, and how fast?
 *
 * Phase 13 exists partly because a model name in the fallback chain went bad and the
 * adapter spent 91.9 s discovering it. This script is how that is never guessed again:
 * it makes REAL calls and reports measured latency, so the `models` chain on each entry
 * of `src/lib/ai/providers.ts` is set from numbers rather than from memory.
 *
 * Two probes per model, because they fail independently — and the Phase 12 incident was
 * exactly that divergence:
 *
 *   • text        — one tiny completion call, no tools.
 *   • tool-call   — the same call with one function declaration, which is the path an
 *                   `ai.agent` node takes. `ai.llm` answered on gemini-3.5-flash-lite in
 *                   1.4 s in the same run where `ai.agent` took 91.9 s on it.
 *
 * A model is HEALTHY only when both probes pass. One that answers text but not tools is
 * usable for `ai.llm` and unusable as an agent's model, which is a distinction the
 * fallback chain has to respect.
 *
 * **Phase 23D made it two-provider**, because a second provider's chain has to be measured
 * the same way the first one's was. The provider-specific part is the `PROVIDERS` table at
 * the top: an endpoint, an auth header, a request body, and how to read an answer out of a
 * response. Everything below it — sequential probing, the pause, the verdict, the ranking —
 * is shared, so the two providers are judged by one standard rather than two.
 *
 * Usage:
 *   # Gemini: the free-tier key, read straight from Google Cloud and never printed
 *   KEY=$(gcloud services api-keys get-key-string \
 *     projects/370286775466/locations/global/keys/f6e2a035-a9a5-4b7b-8b8b-c4765c67d153 \
 *     --format='value(keyString)' --project=agentforge-gemini-free)
 *   GEMINI_API_KEY="$KEY" node scripts/probe-models.mjs
 *
 *   # Groq
 *   GROQ_API_KEY=... node scripts/probe-models.mjs --provider groq
 *
 *   # probe named models instead of the discovered catalogue
 *   GEMINI_API_KEY="$KEY" node scripts/probe-models.mjs gemini-3.5-flash-lite gemini-3.8-flash
 *
 *   # --json for machine consumption; --timeout-ms to change the per-probe budget
 *   GEMINI_API_KEY="$KEY" node scripts/probe-models.mjs --json --timeout-ms 20000
 *
 * Free tiers rate-limit hard, so probes run SEQUENTIALLY with a pause between them.
 * Running them in parallel produces a wall of 429s that says nothing about model health.
 */

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

const TEXT_PROMPT = "Reply with exactly: OK";
const TOOL_PROMPT = 'Record a note that says "hello".';

/**
 * One entry per provider. Mirrors `src/lib/ai/providers.ts` deliberately — this script is
 * how that file's `models` arrays get their order, so the two must agree on what a model
 * id is and which endpoint answers for it.
 */
const PROVIDERS = {
  google: {
    label: "Google Gemini",
    keyEnv: ["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
    keyHint:
      "The free-tier key lives in the agentforge-gemini-free project — see the header.",
    base: "https://generativelanguage.googleapis.com/v1beta",
    headers: (key) => ({ "x-goog-api-key": key, "content-type": "application/json" }),
    url: (base, model) => `${base}/models/${model}:generateContent`,
    listUrl: (base) => `${base}/models?pageSize=200`,
    textBody: () => ({
      contents: [{ role: "user", parts: [{ text: TEXT_PROMPT }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 1000 },
    }),
    toolsBody: () => ({
      contents: [{ role: "user", parts: [{ text: TOOL_PROMPT }] }],
      tools: [{ functionDeclarations: [PROBE_TOOL] }],
      generationConfig: { temperature: 0, maxOutputTokens: 1000 },
    }),
    parts: (payload) => payload?.candidates?.[0]?.content?.parts ?? [],
    readText(payload) {
      return this.parts(payload)
        .map((part) => part.text ?? "")
        .join("")
        .trim();
    },
    calledTool(payload) {
      return this.parts(payload).some((part) => part.functionCall);
    },
    errorOf: (payload, status) => payload?.error?.message ?? `HTTP ${status}`,
    /**
     * Gemini's catalogue says which generation methods a model supports but never whether
     * it can tool-call, so the chat filter is a name test. That is the weaker of the two
     * providers here and it is why `-latest` is excluded: an alias moves under you.
     */
    discover(payload) {
      return (payload.models ?? [])
        .filter((model) => (model.supportedGenerationMethods ?? []).includes("generateContent"))
        .map((model) => String(model.name ?? "").replace(/^models\//, ""))
        .filter(
          (id) =>
            id.startsWith("gemini-") &&
            !/-(tts|image|transcribe|embedding)\b/.test(id) &&
            !id.includes("computer-use") &&
            !id.includes("robotics") &&
            !id.endsWith("-latest"),
        );
    },
  },

  groq: {
    label: "Groq",
    keyEnv: ["GROQ_API_KEY"],
    keyHint: "Create one at https://console.groq.com/keys.",
    base: "https://api.groq.com/openai/v1",
    headers: (key) => ({ authorization: `Bearer ${key}`, "content-type": "application/json" }),
    url: (base) => `${base}/chat/completions`,
    listUrl: (base) => `${base}/models`,
    /** OpenAI-compatible: the model goes in the body, not the path. */
    textBody: (model) => ({
      model,
      messages: [{ role: "user", content: TEXT_PROMPT }],
      temperature: 0,
      max_completion_tokens: 1000,
    }),
    toolsBody: (model) => ({
      model,
      messages: [{ role: "user", content: TOOL_PROMPT }],
      tools: [{ type: "function", function: PROBE_TOOL }],
      temperature: 0,
      max_completion_tokens: 1000,
    }),
    readText: (payload) => String(payload?.choices?.[0]?.message?.content ?? "").trim(),
    calledTool: (payload) => (payload?.choices?.[0]?.message?.tool_calls ?? []).length > 0,
    errorOf: (payload, status) => payload?.error?.message ?? `HTTP ${status}`,
    /**
     * **Groq declares capability, so this filter asks rather than guesses.** Each entry
     * carries `input_modalities`, `output_modalities` and `supported_features`, so a text
     * chat model that can tool-call is a property of the catalogue, not of the name:
     * Whisper outputs `transcription`, Orpheus outputs `speech`, and Prompt Guard is
     * text→text with no `supported_features` at all. Measured against the live catalogue
     * on 2026-10-01.
     */
    discover(payload) {
      return (payload.data ?? [])
        .filter((model) => {
          const inputs = model.input_modalities ?? [];
          const outputs = model.output_modalities ?? [];
          const features = model.supported_features ?? [];
          return (
            model.active !== false &&
            inputs.includes("text") &&
            outputs.includes("text") &&
            features.includes("tools")
          );
        })
        .map((model) => String(model.id));
    },
  },
};

const argv = process.argv.slice(2);
const json = argv.includes("--json");
const timeoutMs = readNumber("--timeout-ms", 15_000);
const pauseMs = readNumber("--pause-ms", 900);
const providerId = readString("--provider", process.env.PROBE_PROVIDER ?? "google");
const named = argv.filter(
  (arg) => !arg.startsWith("--") && !/^\d+$/.test(arg) && arg !== providerId,
);

function readNumber(flag, fallback) {
  const index = argv.indexOf(flag);
  if (index === -1) return fallback;
  const value = Number(argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readString(flag, fallback) {
  const index = argv.indexOf(flag);
  if (index === -1) return fallback;
  return argv[index + 1] ?? fallback;
}

const provider = PROVIDERS[providerId];
if (!provider) {
  console.error(`Unknown provider "${providerId}". Known: ${Object.keys(PROVIDERS).join(", ")}.`);
  process.exit(2);
}

const API_KEY = provider.keyEnv.map((name) => process.env[name]).find(Boolean);
if (!API_KEY) {
  console.error(`No key for ${provider.label}. Set ${provider.keyEnv.join(" or ")}.\n${provider.keyHint}`);
  process.exit(2);
}

async function call(model, body) {
  const started = Date.now();
  try {
    const response = await fetch(provider.url(provider.base, model), {
      method: "POST",
      headers: provider.headers(API_KEY),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await response.json().catch(() => ({}));
    const ms = Date.now() - started;

    if (response.status !== 200) {
      return { ok: false, ms, status: response.status, error: provider.errorOf(payload, response.status) };
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
  const result = await call(model, provider.textBody(model));
  if (!result.ok) return result;

  const text = provider.readText(result.payload);
  // An empty completion is a failure dressed as a 200 — a thinking model that spent its
  // whole output budget before writing a token answers 200 with no text.
  return text.length > 0
    ? { ...result, text }
    : { ...result, ok: false, error: "200 with an empty completion" };
}

async function probeTools(model) {
  const result = await call(model, provider.toolsBody(model));
  if (!result.ok) return result;

  return provider.calledTool(result.payload)
    ? result
    : { ...result, ok: false, error: "answered without calling the tool" };
}

async function discover() {
  const response = await fetch(provider.listUrl(provider.base), {
    headers: provider.headers(API_KEY),
  });
  const payload = await response.json();
  if (response.status !== 200) {
    throw new Error(provider.errorOf(payload, response.status));
  }
  return provider.discover(payload);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const models = named.length > 0 ? named : await discover();
const results = [];

if (!json) {
  console.log(
    `${provider.label}: probing ${models.length} model(s), ${timeoutMs} ms budget per probe.\n`,
  );
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
  console.log(
    JSON.stringify(
      { provider: providerId, probedAt: new Date().toISOString(), timeoutMs, results, ranked: healthy.map((e) => e.model) },
      null,
      2,
    ),
  );
} else {
  console.log("-".repeat(78));
  console.log(`\n${healthy.length} of ${results.length} model(s) healthy on BOTH paths, fastest first:\n`);
  for (const entry of healthy) {
    console.log(`  ${entry.model.padEnd(38)} text ${String(entry.text.ms).padStart(6)} ms   tools ${String(entry.tools.ms).padStart(6)} ms`);
  }
  console.log(
    `\nSet the "${providerId}" entry's \`models\` in src/lib/ai/providers.ts from this list —\n` +
      "fastest first, and pick three from different families so one family's outage cannot\n" +
      "empty the chain.",
  );
}

process.exit(healthy.length > 0 ? 0 : 1);
