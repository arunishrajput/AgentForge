import assert from "node:assert/strict";
import { test } from "node:test";

import { REDACTED, redactStep, redactValue } from "./redact";
import type { StepRecord } from "./types";

test("every occurrence of a secret is removed, at any depth, and nothing else is touched", () => {
  const secret = "S".repeat(43);
  const secrets = new Set([secret]);
  const value = { url: `https://x/approve#${secret}`, nested: [{ text: `${secret} and ${secret}` }], n: 3, ok: true, none: null };
  assert.deepEqual(redactValue(value, secrets), {
    url: `https://x/approve#${REDACTED}`,
    nested: [{ text: `${REDACTED} and ${REDACTED}` }],
    n: 3,
    ok: true,
    none: null,
  });
  assert.equal(redactValue(value, new Set()), value, "no secrets — the same object, not a copy");
});

test("a redacted step is a copy: the engine's own step keeps what its next node needs", () => {
  const secret = "K".repeat(43);
  const step: StepRecord = {
    seq: 1,
    nodeId: "n",
    nodeType: "core.log",
    iteration: 0,
    status: "failed",
    config: { message: secret },
    input: { url: secret },
    output: secret,
    branch: null,
    logs: [{ at: "t", level: "info", message: `sent ${secret}` }],
    error: `refused ${secret}`,
    startedAt: null,
    finishedAt: null,
  };
  const copy = redactStep(step, new Set([secret]));
  assert.equal(JSON.stringify(copy).includes(secret), false);
  assert.equal(copy.error, `refused ${REDACTED}`);
  assert.equal(step.input && (step.input as { url: string }).url, secret, "the original is untouched");
});
