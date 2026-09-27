import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ApiError } from "@/lib/api-error";
import { integrationApiError } from "@/lib/integrations/errors";
import { IntegrationError } from "@/lib/integrations/net";

import { atLeast, isWorkspaceRole, WORKSPACE_ROLES } from "./roles";
import { systemScope } from "./scope";
import { activeMembership, describeWorkspace, personalWorkspaceName, type Membership } from "./store";

const workspace = (over: Partial<Membership["workspace"]> = {}) =>
  ({
    id: "ws-1",
    name: "Test workspace",
    createdBy: "user-1",
    personal: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  }) as Membership["workspace"];

describe("workspace roles", () => {
  it("ranks every role against every other consistently", () => {
    // Asserted as a matrix rather than a handful of cases: the ordering is what Phase
    // 20's authorisation layer is built on, and a role inserted in the wrong place in
    // WORKSPACE_ROLES would otherwise only show up as a permission bug later.
    for (let i = 0; i < WORKSPACE_ROLES.length; i += 1) {
      for (let j = 0; j < WORKSPACE_ROLES.length; j += 1) {
        const higher = WORKSPACE_ROLES[i];
        const lower = WORKSPACE_ROLES[j];
        assert.equal(
          atLeast(higher, lower),
          i <= j,
          `atLeast(${higher}, ${lower}) should be ${i <= j}`,
        );
      }
    }
  });

  it("every role is at least itself", () => {
    for (const role of WORKSPACE_ROLES) assert.equal(atLeast(role, role), true);
  });

  it("recognises only the four declared roles", () => {
    for (const role of WORKSPACE_ROLES) assert.equal(isWorkspaceRole(role), true);
    for (const value of ["", "OWNER", "superuser", null, undefined, 3, {}]) {
      assert.equal(isWorkspaceRole(value), false, `${String(value)} is not a role`);
    }
  });
});

describe("systemScope", () => {
  it("takes the workspace and the owner from the workflow row", () => {
    // The property that matters: a webhook or a scheduled run cannot name a workspace.
    // It gets the one the workflow lives in, and nothing about the request can widen it.
    const scope = systemScope({ workspaceId: "ws-9", ownerId: "user-9" });
    assert.deepEqual(scope, { workspaceId: "ws-9", userId: "user-9", role: "owner" });
  });
});

describe("personalWorkspaceName", () => {
  it("uses the display name when there is one", () => {
    assert.equal(personalWorkspaceName({ name: "Arunish Rajput" }), "Arunish Rajput's workspace");
  });

  it("falls back to the email's local part", () => {
    assert.equal(personalWorkspaceName({ name: null, email: "ada@example.com" }), "ada's workspace");
  });

  it("falls back again when there is neither", () => {
    assert.equal(personalWorkspaceName({}), "Personal workspace");
  });

  it("treats a whitespace-only name as absent", () => {
    // `z.string().min(1)` accepts "   " (PROGRESS.md → Known Issues), and an OAuth
    // profile can carry one. "'s workspace" is not a name.
    assert.equal(
      personalWorkspaceName({ name: "   ", email: "ada@example.com" }),
      "ada's workspace",
    );
  });

  it("matches the shape migration 0005 backfills", () => {
    // The migration writes `<name>'s workspace` in SQL for accounts that predate this
    // phase. Two implementations of one rule; this is the check that they agree.
    assert.equal(personalWorkspaceName({ name: "Ada" }), "Ada's workspace");
  });
});

describe("activeMembership", () => {
  it("is null when the user is in no workspace", () => {
    assert.equal(activeMembership([]), null);
  });

  it("prefers the personal workspace over one joined later", () => {
    const shared: Membership = { workspace: workspace({ id: "ws-shared" }), role: "editor" };
    const personal: Membership = {
      workspace: workspace({ id: "ws-personal", personal: true }),
      role: "owner",
    };
    assert.equal(activeMembership([shared, personal])?.workspace.id, "ws-personal");
  });

  it("falls back to the first workspace when none is personal", () => {
    const a: Membership = { workspace: workspace({ id: "ws-a" }), role: "editor" };
    const b: Membership = { workspace: workspace({ id: "ws-b" }), role: "viewer" };
    assert.equal(activeMembership([a, b])?.workspace.id, "ws-a");
  });
});

describe("describeWorkspace", () => {
  it("carries the name and role and nothing else", () => {
    const described = describeWorkspace({
      workspace: workspace({ id: "ws-1", name: "Team", personal: false }),
      role: "admin",
    });
    assert.deepEqual(described, { id: "ws-1", name: "Team", personal: false, role: "admin" });
    // `createdBy` is a user id and has no business reaching a client that only needs a
    // label in a header.
    assert.equal("createdBy" in described, false);
  });
});

describe("integrationApiError", () => {
  it("passes an IntegrationError's own words through as a 400", () => {
    const mapped = integrationApiError(
      "Discord",
      new IntegrationError("Discord rejected this webhook: Unknown Webhook"),
    );
    assert.equal(mapped.code, "invalid_request");
    assert.match(mapped.message, /Unknown Webhook/);
  });

  it("does NOT claim Discord was unreachable when the failure was not Discord's", () => {
    // The regression this file exists for. A missing unique index made `putCredential`
    // throw a Postgres 42P10 *after* Discord had answered successfully, and this
    // function reported it as a reachability problem — which sent the diagnosis in
    // entirely the wrong direction.
    const mapped = integrationApiError(
      "Discord",
      new Error("there is no unique or exclusion constraint matching the ON CONFLICT specification"),
    );
    assert.equal(mapped.code, "internal");
    assert.doesNotMatch(mapped.message, /reach/i);
    assert.equal(mapped instanceof ApiError, true);
  });

  it("never echoes the underlying error to the client", () => {
    const mapped = integrationApiError(
      "Discord",
      new Error("postgres://user:hunter2@host/db is unreachable"),
    );
    assert.doesNotMatch(mapped.message, /hunter2/);
  });
});
