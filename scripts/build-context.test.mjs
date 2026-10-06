// What `gcloud run deploy --source .` uploads to Cloud Build is governed by
// `.gcloudignore`, which — unlike git — does not honour `.gitignore` unless told to.
// Phase 26 found the upload carrying 63 MB of git-ignored presentation media, and the
// same gap would carry a stray key file: `.gitignore` lists `*.pem`, `*.key` and
// `service-account*.json`, and nothing else kept them out of the build context.
//
// CI has no gcloud, so this cannot run `gcloud meta list-files-for-upload`; it asserts
// the directive that makes the upload a subset of what git tracks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const lines = (text) => text.split("\n").map((line) => line.trim());

test("the Cloud Build upload excludes everything git ignores", () => {
  assert.ok(
    lines(read(".gcloudignore")).includes("#!include:.gitignore"),
    ".gcloudignore must contain `#!include:.gitignore` — without it, git-ignored files reach Cloud Build",
  );
});

test("the key-file patterns that directive relies on are still in .gitignore", () => {
  const ignored = lines(read(".gitignore"));
  for (const pattern of [".env", "*.pem", "*.key", "service-account*.json", "gcp-credentials*.json"]) {
    assert.ok(ignored.includes(pattern), `.gitignore no longer lists ${pattern}`);
  }
});
