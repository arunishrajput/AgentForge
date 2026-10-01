import assert from "node:assert/strict";
import { test } from "node:test";

import { onboardingProgress, type OnboardingFacts } from "./steps";

const NOTHING: OnboardingFacts = {
  hasProviderKey: false,
  hasWorkflow: false,
  hasSuccessfulRun: false,
};

const facts = (over: Partial<OnboardingFacts> = {}): OnboardingFacts => ({ ...NOTHING, ...over });

test("a brand-new workspace has three steps, none done, and opens on the first", () => {
  const progress = onboardingProgress(NOTHING);

  assert.equal(progress.steps.length, 3);
  assert.deepEqual(
    progress.steps.map((step) => step.id),
    ["provider", "workflow", "run"],
  );
  assert.equal(progress.steps.every((step) => !step.done), true);
  assert.equal(progress.completed, 0);
  assert.equal(progress.complete, false);
  assert.equal(progress.next, "provider");
});

test("every fact maps to exactly one step, and to the right one", () => {
  const done = (f: OnboardingFacts) =>
    onboardingProgress(f)
      .steps.filter((step) => step.done)
      .map((step) => step.id);

  assert.deepEqual(done(facts({ hasProviderKey: true })), ["provider"]);
  assert.deepEqual(done(facts({ hasWorkflow: true })), ["workflow"]);
  assert.deepEqual(done(facts({ hasSuccessfulRun: true })), ["run"]);
});

test("all three done reports complete, and has no next step", () => {
  const progress = onboardingProgress({
    hasProviderKey: true,
    hasWorkflow: true,
    hasSuccessfulRun: true,
  });

  assert.equal(progress.completed, 3);
  assert.equal(progress.complete, true);
  assert.equal(progress.next, null);
});

/**
 * The steps are presented in order but deliberately not gated in order — a template with
 * no LLM node runs with no provider key — so progress out of order has to be representable
 * rather than normalised away. `next` is the first *unfinished* step, which is the one the
 * guide opens on.
 */
test("out-of-order progress is kept, and next is the first unfinished step", () => {
  const progress = onboardingProgress(facts({ hasWorkflow: true, hasSuccessfulRun: true }));

  assert.equal(progress.completed, 2);
  assert.equal(progress.complete, false);
  assert.equal(progress.next, "provider");
  assert.deepEqual(
    progress.steps.map((step) => step.done),
    [false, true, true],
  );
});

test("next skips a finished first step", () => {
  assert.equal(onboardingProgress(facts({ hasProviderKey: true })).next, "workflow");
  assert.equal(
    onboardingProgress(facts({ hasProviderKey: true, hasWorkflow: true })).next,
    "run",
  );
});

/**
 * The guide's text is the whole of its usefulness, so it is asserted rather than assumed:
 * a step with an empty title or detail would render a card that says nothing and nothing
 * else in the project would fail.
 */
test("every step carries a non-empty title and detail", () => {
  for (const step of onboardingProgress(NOTHING).steps) {
    assert.ok(step.title.length > 0, `${step.id} has no title`);
    assert.ok(step.detail.length > 20, `${step.id} has no useful detail`);
  }
});

test("completed counts only finished steps and never exceeds the list", () => {
  for (const hasProviderKey of [true, false]) {
    for (const hasWorkflow of [true, false]) {
      for (const hasSuccessfulRun of [true, false]) {
        const progress = onboardingProgress({ hasProviderKey, hasWorkflow, hasSuccessfulRun });
        const expected = [hasProviderKey, hasWorkflow, hasSuccessfulRun].filter(Boolean).length;
        assert.equal(progress.completed, expected);
        assert.equal(progress.complete, expected === 3);
        assert.equal(progress.next === null, expected === 3);
      }
    }
  }
});
