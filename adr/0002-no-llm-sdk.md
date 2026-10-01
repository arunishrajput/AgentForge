# 0002 — No LLM SDK; the provider adapter is a `fetch` client we own

**Status:** Accepted · **Date:** 2026-09-26 · **Phase:** 6 (reaffirmed at 23D)

## Context

[ADR 0001](./0001-harvest-not-fork.md) adopted the Vercel AI SDK (`ai`, `@ai-sdk/google`) for
provider-agnostic tool-calling. It was the obvious choice: tool-calling is the agent node's core,
the SDK is Apache-2.0, and "do not hand-roll an LLM client" is ordinary good advice.

Then Phase 6 called the real API, and four things turned up that an abstraction layer is
actively in the way of. Each was discovered by making requests, not by reasoning about the
library.

**1. The history must be byte-exact.** Gemini signs every `functionCall` part with a
`thoughtSignature`, and answers **400** to a conversation whose history has lost one. A
normalising adapter — which is what an SDK is — passes its first tool call and fails on the
second. This was the decisive one.

**2. The tool schema needs a sanitiser we own anyway.** Gemini rejects `additionalProperties`,
which Zod emits for real registry nodes. Something has to translate JSON Schema into the
provider's accepted subset, and that something has to live here.

**3. Retry and a model fallback chain are reliability properties, not middleware.**
`gemini-3.8-flash` answered 503 "experiencing high demand" on a first call. Through an SDK that
is custom middleware; in a `fetch` client it is fifteen lines in the one place that makes HTTP
requests.

**4. Each tool call must become a visible, streamed step.** The engine already owns step
recording and `context.log`. An SDK's internal loop is a second loop to reconcile with it — and
"watch the agent think" is the product.

## Decision

Do not install `ai` or `@ai-sdk/google`. Write the provider adapter as a `fetch` client, with the
wire format isolated in one file per provider and everything provider-agnostic above it.

## Consequences

**The cost is one file of wire-format knowledge per provider**, and it is a real cost: when a
provider changes its API, that file is ours to fix.

**The benefits compounded more than expected.** Zero new dependencies and a smaller container.
Tests that inject a fake `fetch` with no module mocking — which matters because `npm test` runs
the TypeScript sources directly on Node's own runner. And the pure parts (`schema.ts`,
`tools.ts`, `loop.ts`) touch no network, no database and no registry state, so the property that
actually matters — *a model that never stops calling tools is stopped by the cap* — is asserted
in a millisecond instead of against a live quota.

**Phase 23D tested the claim this decision rests on**, by adding Groq as a second provider. The
result was split, and both halves are worth recording:

- **Above the interface, nothing changed.** A second provider really was "a new file implementing
  this interface". That is the part this ADR predicted.
- **Below it, the abstraction was in the wrong place.** The retry, fallback, time-budget and
  circuit-breaker machinery had been sitting inside `gemini.ts` since Phase 13, and none of it
  mentions Google. It moved to a shared `chain.ts` rather than being copied, because a hard-won
  reliability fix is exactly the kind of thing that rots in duplicate. The evidence the move was
  faithful is that `gemini.test.ts` — 687 lines pinning those behaviours — **passes unedited**.

The honest summary: *"a second provider is a new file; nothing above the interface changes"* was
true above the interface and wrong below it. An untested abstraction was approximately right, and
only doing it could show which half.

**One further cost, accepted deliberately.** Groq is handed the Gemini-compatible *subset* of
JSON Schema for tool parameters, and is denied JSON-mode-with-tools, which it would allow. One
contract for both providers beats a workflow that behaves differently depending on who runs it.

## Alternatives

| Rejected | Why |
|---|---|
| **Use the AI SDK as adopted** | Fails on `thoughtSignature`. Reasons 2–4 would each have needed custom middleware anyway |
| **Use the SDK and patch around the signature** | Fighting an abstraction's normalisation on every call is more code than not having it, and fails silently when the SDK updates |
| **A thin wrapper over the SDK** | All the maintenance of our own layer, plus a dependency, plus someone else's loop to reconcile with the engine's |
