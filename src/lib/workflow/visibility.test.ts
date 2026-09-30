import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { WORKSPACE_ROLES, type WorkspaceRole } from "@/lib/workspace/roles";

import {
  canSeeWorkflow,
  isWorkflowVisibility,
  mayChangeVisibility,
  mintShareToken,
  SHARE_TOKEN_PATTERN,
  shareUrl,
  WORKFLOW_VISIBILITIES,
  workflowVisibilitySchema,
} from "./visibility";

/**
 * Per-workflow visibility, Phase 20. The rules are pure so they can be asserted over the
 * whole role × visibility × authorship space rather than sampled — which is what catches a
 * rule that is right for the role it was written against and wrong one rung away.
 */

describe("workflow visibility vocabulary", () => {
  it("recognises exactly its own two values", () => {
    for (const v of WORKFLOW_VISIBILITIES) assert.equal(isWorkflowVisibility(v), true, v);
    for (const v of ["public", "", "PRIVATE", null, 1, {}]) {
      assert.equal(isWorkflowVisibility(v), false, String(v));
    }
  });

  it("parses through the schema the update route uses", () => {
    assert.equal(workflowVisibilitySchema.parse("private"), "private");
    assert.equal(workflowVisibilitySchema.safeParse("public").success, false);
  });
});

describe("canSeeWorkflow", () => {
  it("shows a workspace-visible workflow to every role, whoever made it", () => {
    for (const role of WORKSPACE_ROLES) {
      for (const ownerId of ["me", "them"]) {
        assert.equal(
          canSeeWorkflow({ role, userId: "me" }, { visibility: "workspace", ownerId }),
          true,
          `${role} / ${ownerId}`,
        );
      }
    }
  });

  it("shows a private workflow to its creator at every role, including viewer", () => {
    // A viewer who made a workflow before being demoted must still see it — the column
    // says who may look, and they are the author.
    for (const role of WORKSPACE_ROLES) {
      assert.equal(
        canSeeWorkflow({ role, userId: "me" }, { visibility: "private", ownerId: "me" }),
        true,
        role,
      );
    }
  });

  it("hides somebody else's private workflow from an editor and a viewer, and shows it to an admin and an owner", () => {
    // The decision `visibility.ts` explains at length: a private workflow still runs with
    // the workspace's credentials, so the people accountable for those credentials can see
    // what is using them. `private` means "not shared with my colleagues", never "hidden
    // from the workspace".
    const expected: Record<WorkspaceRole, boolean> = {
      owner: true,
      admin: true,
      editor: false,
      viewer: false,
    };
    for (const role of WORKSPACE_ROLES) {
      assert.equal(
        canSeeWorkflow({ role, userId: "me" }, { visibility: "private", ownerId: "them" }),
        expected[role],
        role,
      );
    }
  });

  it("treats an unrecognised visibility as visible rather than as private", () => {
    // Fails *open* on purpose, and this is the one place in Phase 20 that does. The column
    // has a NOT NULL default so the value cannot be absent in practice; if a later phase
    // adds a third visibility and this build reads a row written by the next one, showing
    // a workspace member a workflow they could already see yesterday is the harmless
    // outcome. Hiding rows on an unknown value would make a forward-compatible deploy
    // silently empty somebody's workflow list.
    assert.equal(
      canSeeWorkflow({ role: "viewer", userId: "me" }, { visibility: "team", ownerId: "them" }),
      true,
    );
  });
});

describe("mayChangeVisibility", () => {
  it("lets the creator change it at any role", () => {
    for (const role of WORKSPACE_ROLES) {
      assert.equal(
        mayChangeVisibility({ actorRole: role, actorUserId: "me", workflowOwnerId: "me" }),
        true,
        role,
      );
    }
  });

  it("lets an admin and an owner change somebody else's, and refuses an editor and a viewer", () => {
    const expected: Record<WorkspaceRole, boolean> = {
      owner: true,
      admin: true,
      editor: false,
      viewer: false,
    };
    for (const role of WORKSPACE_ROLES) {
      assert.equal(
        mayChangeVisibility({ actorRole: role, actorUserId: "me", workflowOwnerId: "them" }),
        expected[role],
        role,
      );
    }
  });
});

describe("the share token", () => {
  it("is 192 bits of base64url, matching its own pattern", () => {
    for (let i = 0; i < 20; i += 1) {
      const token = mintShareToken();
      assert.equal(token.length, 32, token);
      assert.match(token, SHARE_TOKEN_PATTERN);
      // URL-safe: nothing here may need escaping, because the token goes in a path.
      assert.equal(encodeURIComponent(token), token);
    }
  });

  it("is different every time", () => {
    const seen = new Set(Array.from({ length: 200 }, () => mintShareToken()));
    assert.equal(seen.size, 200);
  });

  it("refuses the shapes a hand-typed or truncated link would have", () => {
    for (const bad of ["", "short", "a".repeat(15), "a".repeat(65), "has spaces", "has/slash", "has+plus"]) {
      assert.equal(SHARE_TOKEN_PATTERN.test(bad), false, bad);
    }
  });

  it("builds a /s/ url and tolerates a trailing slash on the base", () => {
    assert.equal(shareUrl("https://app.example", "abc"), "https://app.example/s/abc");
    assert.equal(shareUrl("https://app.example/", "abc"), "https://app.example/s/abc");
  });
});
