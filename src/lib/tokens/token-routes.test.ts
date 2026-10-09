import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

/**
 * **The set of routes that accept a personal access token is pinned here** — Phase 41, D192.
 *
 * A route accepts `Authorization: Bearer` if and only if it calls `requireApiScope`; every other
 * route calls `requireScope`, which never reads the header. So the allowlist is a fact about the
 * source, and this test reads the source: adding a route to the set — or letting a token reach
 * token management, credentials, members or the vault — fails here until the list below is changed
 * on purpose, in a diff somebody reads.
 */
const ALLOWED = [
  "runs/[id]/cancel/route.ts",
  "runs/[id]/rerun/route.ts",
  "runs/[id]/retry/route.ts",
  "runs/[id]/route.ts",
  "runs/[id]/steps/[seq]/route.ts",
  "runs/route.ts",
  "workflows/[id]/export/route.ts",
  "workflows/[id]/runs/route.ts",
  "workflows/[id]/route.ts",
  "workflows/[id]/stream/route.ts",
  "workflows/generate/route.ts",
  "workflows/import/route.ts",
  "workflows/route.ts",
];

/** Whatever else changes, these never take a token: they hand out or change authority. */
const NEVER = ["tokens", "credentials", "workspaces", "invitations", "integrations", "settings", "approvals"];

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? routeFiles(path) : name === "route.ts" ? [path] : [];
  });
}

const root = join(process.cwd(), "src/app/api");
const sources = routeFiles(root).map((path) => ({
  path: relative(root, path),
  text: readFileSync(path, "utf8"),
}));

/** Code only: a comment may name the function without calling it. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("which routes accept an access token", () => {
  const accepting = sources.filter((s) => /\brequireApiScope\(/.test(code(s.text))).map((s) => s.path).sort();

  it("is exactly the allowlist", () => {
    assert.deepEqual(accepting, [...ALLOWED].sort());
  });

  it("never includes token management, credentials, members, invitations, integrations or the vault", () => {
    for (const path of accepting) {
      for (const forbidden of NEVER) {
        assert.ok(!path.startsWith(`${forbidden}/`), `${path} must not accept a token`);
      }
    }
  });

  it("leaves a route that takes a token with no second way in", () => {
    // A route that mixes the two would let a token reach the half that only a session should.
    for (const s of sources.filter((x) => ALLOWED.includes(x.path))) {
      assert.ok(!/\brequireScope(For)?\(/.test(code(s.text)), `${s.path} mixes requireScope with requireApiScope`);
    }
  });

  it("covers every allowlisted file that exists", () => {
    const present = new Set(sources.map((s) => s.path));
    for (const path of ALLOWED) assert.ok(present.has(path), `${path} does not exist`);
  });
});
