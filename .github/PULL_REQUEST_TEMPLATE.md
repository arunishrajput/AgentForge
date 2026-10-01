## What this changes

<!-- One or two sentences. What is different after this merges? -->

## Why

<!-- The problem being solved. Link the issue if there is one: Fixes #123 -->

## How you verified it

<!--
  "Tests pass" is the floor, not the answer. What did you actually observe?
  Examples that would make a reviewer's day:
    - ran it against a real Notion database and the row appeared
    - reproduced the bug on the deployed URL, applied the fix, could not reproduce it
    - drove the canvas in a browser at 375 px and 1440 px
-->

## Checklist

- [ ] `npm run check` passes (lint · typecheck · tests with coverage · docs)
- [ ] `npm run build` passes
- [ ] **If this fixes a bug:** there is a test that fails without the fix
- [ ] **If this touches a node:** `npm run docs:build` has been run and the result is committed
- [ ] **If this adds a route:** it is in `docs/api.md`, and it asks for a role via `requireScope`
- [ ] **If this adds a dependency:** the PR says why, and why the alternative was worse
- [ ] No secret, key, token or connection string is in the diff
