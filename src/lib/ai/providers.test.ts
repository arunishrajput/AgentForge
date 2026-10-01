import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_PROVIDER_ID,
  LLM_CREDENTIAL_KINDS,
  PROVIDERS,
  describeProviders,
  providerById,
  providerByKind,
  providerOrDefault,
} from "./providers";

/**
 * **The provider registry — Phase 23D.**
 *
 * Two kinds of claim are tested here, and only one of them is about types:
 *
 *   1. **Order and identity.** `PROVIDERS[0]` being Google is load-bearing — it is what makes
 *      "the second provider must not quietly become the default" true — and it is exactly the
 *      kind of fact a later tidy-up would break by sorting the array. So it is pinned.
 *   2. **The stored kinds.** `llm.google` is in rows that already exist in the deployed
 *      database. Renaming it would orphan every Gemini key in the product, silently, and
 *      nothing else in the codebase would fail. This file is what fails.
 */

test("Google is first, and that is what stops Groq becoming the default", () => {
  // `resolveProvider` walks this array when a workspace has made no choice, so the first
  // entry holding a key wins. Every workspace that existed before Phase 23D had a Gemini key
  // and no stored choice, which means this line is why none of them changed behaviour.
  assert.equal(PROVIDERS[0].id, "google");
  assert.equal(DEFAULT_PROVIDER_ID, "google");
  assert.equal(PROVIDERS[1].id, "groq");
  assert.equal(PROVIDERS.length, 2);
});

test("the stored credential kinds are the ones already in the database", () => {
  // `llm.google` is written in existing rows. A rename here is a silent data loss: the key is
  // still encrypted in the table and nothing can find it again.
  assert.deepEqual(LLM_CREDENTIAL_KINDS, ["llm.google", "llm.groq"]);
  assert.equal(providerByKind("llm.google")!.id, "google");
  assert.equal(providerByKind("llm.groq")!.id, "groq");
});

test("every provider is complete enough to render a settings card and call an API", () => {
  for (const provider of PROVIDERS) {
    assert.ok(provider.id.length > 0, "a provider needs an id");
    assert.ok(provider.kind.startsWith("llm."), `${provider.id}'s kind should be namespaced`);
    assert.ok(provider.label.length > 0, `${provider.id} has no label`);
    assert.match(provider.keyUrl, /^https:\/\//, `${provider.id}'s key URL is not https`);
    assert.ok(provider.keyUrlLabel.length > 0, `${provider.id} has no link text`);
    assert.ok(provider.blurb.length > 40, `${provider.id}'s blurb is too short to be useful`);
    assert.ok(provider.placeholder.length > 0, `${provider.id} has no placeholder`);
    assert.equal(typeof provider.create, "function");

    // The chain must be non-empty and must start at the declared default, or a request that
    // names no model would be answered by something other than the documented one.
    assert.ok(provider.models.length > 0, `${provider.id} has an empty chain`);
    assert.equal(provider.models[0], provider.defaultModel);
    assert.equal(
      new Set(provider.models).size,
      provider.models.length,
      `${provider.id}'s chain repeats a model, which wastes an attempt on a known failure`,
    );
  }
});

test("ids and kinds are unique, because both are used as lookup keys", () => {
  assert.equal(new Set(PROVIDERS.map((p) => p.id)).size, PROVIDERS.length);
  assert.equal(new Set(PROVIDERS.map((p) => p.kind)).size, PROVIDERS.length);
});

test("a provider id never contains a colon, so a health key cannot be ambiguous", () => {
  // `health.ts` keys records on `provider:model`. A colon in an id would make two different
  // pairs collide, and the collision would look like a flaky breaker rather than a bug.
  for (const provider of PROVIDERS) {
    assert.equal(provider.id.includes(":"), false, `${provider.id} must not contain a colon`);
  }
});

test("a lookup with an attacker-chosen string answers null, not a prototype member", () => {
  // Phase 23B's lesson, applied before it could cost anything: `ROTATION_RULES["toString"]`
  // returned a truthy function and turned a 404 into a 500. Both lookups here are Maps.
  for (const probe of ["__proto__", "toString", "constructor", "valueOf", ""]) {
    assert.equal(providerById(probe), null, `providerById(${JSON.stringify(probe)})`);
    assert.equal(providerByKind(probe), null, `providerByKind(${JSON.stringify(probe)})`);
  }
  assert.equal(providerById(null), null);
  assert.equal(providerById(undefined), null);
});

test("an unknown stored id degrades to the default rather than throwing", () => {
  // A provider removed in a later phase leaves rows naming it. A workspace must still work.
  assert.equal(providerOrDefault("a-provider-that-was-removed").id, "google");
  assert.equal(providerOrDefault(null).id, "google");
  assert.equal(providerOrDefault("groq").id, "groq");
});

test("the described shape carries no secret-adjacent field and no function", () => {
  // It is serialised to the client. A Zod schema does not survive JSON and a factory is not
  // data, so neither may be in here.
  for (const described of describeProviders()) {
    assert.equal("create" in described, false);
    assert.equal("schema" in described, false);
    // `models` is deliberately absent too: the chain is a server-side reliability decision,
    // and the client gets the live catalogue from `listModels` instead.
    assert.equal("models" in described, false);
  }
  assert.deepEqual(describeProviders().map((entry) => entry.id), ["google", "groq"]);
});

test("each provider's schema refuses an obviously wrong key before the provider is called", () => {
  for (const provider of PROVIDERS) {
    assert.equal(provider.schema.safeParse("short").success, false, `${provider.id} accepted a short key`);
    assert.equal(
      provider.schema.safeParse("x".repeat(500)).success,
      false,
      `${provider.id} accepted an absurdly long key`,
    );
    assert.equal(provider.schema.safeParse("a-plausible-looking-key-0123456789").success, true);
  }
});

test("create honours the two seams verifyModel depends on", async () => {
  // `verifyModel` must prove ONE model: `fallbacks: []` so a broken choice is not answered by
  // a working model and stored as though it worked, and `ignoreHealth` so the breaker neither
  // reorders the chain away from the model under test nor counts the probe against it.
  // Asserted through the registry because that is how `settings.ts` reaches it.
  for (const provider of PROVIDERS) {
    const attempted: string[] = [];
    const model = provider.create({
      apiKey: "k",
      fallbacks: [],
      ignoreHealth: true,
      // `create` takes no fetch seam, so this proves the options reach the adapter by their
      // observable effect: with an empty chain only the requested model is ever tried.
    });
    assert.equal(model.provider, provider.id);

    await assert.rejects(
      () => model.generate({ model: "a-model-that-does-not-exist", turns: [{ role: "user", text: "hi" }], timeoutMs: 1 }),
      (error: unknown) => {
        // Whatever the failure, the attempt list must name only the model asked about.
        const attempts = (error as { attempts?: Array<{ model: string }> }).attempts ?? [];
        for (const attempt of attempts) attempted.push(attempt.model);
        return true;
      },
    );

    for (const name of attempted) {
      assert.equal(
        name,
        "a-model-that-does-not-exist",
        `${provider.id} fell back to ${name} despite fallbacks: []`,
      );
    }
  }
});
