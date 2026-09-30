import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ApiError } from "@/lib/api-error";
import { integrationApiError } from "@/lib/integrations/errors";
import { IntegrationError } from "@/lib/integrations/net";

import {
  assertRole,
  atLeast,
  INVITABLE_ROLES,
  isInvitableRole,
  isWorkspaceRole,
  removalRefusal,
  WORKSPACE_ROLES,
} from "./roles";
import { systemScope } from "./scope";
import { chooseMembership, describeWorkspace, personalWorkspaceName, type Membership } from "./store";

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

describe("chooseMembership", () => {
  const ME = "user-1";
  const mine = (over: Partial<Membership["workspace"]> = {}): Membership => ({
    workspace: workspace({ personal: true, createdBy: ME, ...over }),
    role: "owner",
  });

  it("is null when the user is in no workspace", () => {
    assert.equal(chooseMembership([], ME), null);
  });

  it("prefers this user's own personal workspace over one joined later", () => {
    const shared: Membership = { workspace: workspace({ id: "ws-shared" }), role: "editor" };
    const personal = mine({ id: "ws-personal" });
    assert.equal(chooseMembership([shared, personal], ME)?.workspace.id, "ws-personal");
  });

  it("does NOT treat somebody else's personal workspace as home", () => {
    // The bug the deployed suite found. A personal workspace can be shared, and
    // `listMemberships` returns oldest first — so `find(personal)` landed an invited
    // account in the INVITER's workspace by default. `createdBy` is what fixes it.
    const theirs: Membership = {
      workspace: workspace({ id: "ws-theirs", personal: true, createdBy: "user-2" }),
      role: "viewer",
    };
    const ours = mine({ id: "ws-ours" });
    assert.equal(chooseMembership([theirs, ours], ME)?.workspace.id, "ws-ours");
  });

  it("falls back to the first workspace when the user owns no personal one", () => {
    const a: Membership = { workspace: workspace({ id: "ws-a" }), role: "editor" };
    const b: Membership = { workspace: workspace({ id: "ws-b" }), role: "viewer" };
    assert.equal(chooseMembership([a, b], ME)?.workspace.id, "ws-a");
  });

  it("honours the cookie's workspace over the personal one", () => {
    const shared: Membership = { workspace: workspace({ id: "ws-shared" }), role: "editor" };
    assert.equal(
      chooseMembership([mine({ id: "ws-personal" }), shared], ME, "ws-shared")?.workspace.id,
      "ws-shared",
    );
  });

  it("IGNORES a preferred id the user is not a member of", () => {
    // **The security property the whole cookie design rests on.** The cookie is not
    // signed and carries no user id, which is only safe because a workspace the database
    // did not return is discarded rather than honoured. If this test ever fails, an
    // attacker with a forged cookie reads another tenant's rows.
    assert.equal(
      chooseMembership([mine({ id: "ws-personal" })], ME, "ws-somebody-elses")?.workspace.id,
      "ws-personal",
    );
  });

  it("falls back when the preferred workspace was left in another tab", () => {
    // A stale cookie, which is the ordinary case rather than an attack: removed from a
    // workspace elsewhere, the cookie still names it, and the next request must land
    // somewhere real.
    assert.equal(chooseMembership([mine({ id: "ws-personal" })], ME, "ws-gone")?.workspace.id, "ws-personal");
  });

  it("ignores an empty or absent preference", () => {
    const a = mine({ id: "ws-a" });
    assert.equal(chooseMembership([a], ME, "")?.workspace.id, "ws-a");
    assert.equal(chooseMembership([a], ME, null)?.workspace.id, "ws-a");
    assert.equal(chooseMembership([a], ME, undefined)?.workspace.id, "ws-a");
  });
});

describe("assertRole", () => {
  it("passes when the role carries the requirement", () => {
    assert.doesNotThrow(() => assertRole("owner", "admin"));
    assert.doesNotThrow(() => assertRole("editor", "editor"));
    assert.doesNotThrow(() => assertRole("viewer", "viewer"));
  });

  it("throws a 403 ApiError when it does not", () => {
    // 403 and not 404: the row is in the caller's own workspace and they can already see
    // it, so hiding behind a 404 would make a real permission boundary look like a bug.
    // D20's 404 is for another tenant's resource, which is a different question.
    assert.throws(
      () => assertRole("viewer", "editor"),
      (error: unknown) =>
        error instanceof ApiError && error.code === "forbidden" && /editor/.test(error.message),
    );
  });

  it("refuses every role below every requirement, as a matrix", () => {
    for (const held of WORKSPACE_ROLES) {
      for (const required of WORKSPACE_ROLES) {
        const allowed = atLeast(held, required);
        if (allowed) assert.doesNotThrow(() => assertRole(held, required));
        else assert.throws(() => assertRole(held, required), ApiError);
      }
    }
  });
});

describe("invitable roles", () => {
  it("never includes owner", () => {
    // Ownership must not arrive by link: an invitation is a bearer token in somebody's
    // inbox, and the blast radius of a leaked one has to stop short of being able to
    // remove everybody else.
    assert.equal((INVITABLE_ROLES as readonly string[]).includes("owner"), false);
    assert.equal(isInvitableRole("owner"), false);
  });

  it("includes every other role", () => {
    for (const role of WORKSPACE_ROLES) {
      assert.equal(isInvitableRole(role), role !== "owner", role);
    }
  });
});

describe("removalRefusal", () => {
  const base = {
    actorRole: "owner" as const,
    actorUserId: "user-a",
    targetUserId: "user-b",
    targetRole: "editor" as const,
    ownerCount: 1,
  };

  it("lets an owner remove an editor", () => {
    assert.equal(removalRefusal(base), null);
  });

  it("lets an admin remove an editor", () => {
    assert.equal(removalRefusal({ ...base, actorRole: "admin" }), null);
  });

  it("refuses an editor removing anybody else", () => {
    assert.equal(removalRefusal({ ...base, actorRole: "editor" }), "not_allowed");
    assert.equal(removalRefusal({ ...base, actorRole: "viewer" }), "not_allowed");
  });

  it("tells a viewer aiming at the sole owner that they are not allowed, not that it is the last owner", () => {
    // The bug the deployed suite found: the invariant was tested before the actor's
    // authority, so a viewer got a 409 saying "this is the workspace's only owner" —
    // which leaked how many owners it has and called a refusal a conflict.
    assert.equal(
      removalRefusal({ ...base, actorRole: "viewer", targetRole: "owner", ownerCount: 1 }),
      "not_allowed",
    );
    assert.equal(
      removalRefusal({ ...base, actorRole: "admin", targetRole: "owner", ownerCount: 1 }),
      "owner_only",
    );
  });

  it("lets anybody remove THEMSELVES — leaving is not a privilege", () => {
    for (const actorRole of WORKSPACE_ROLES) {
      if (actorRole === "owner") continue;
      assert.equal(
        removalRefusal({
          ...base,
          actorRole,
          targetUserId: base.actorUserId,
          targetRole: actorRole,
        }),
        null,
        actorRole,
      );
    }
  });

  it("refuses removing the last owner, even by themselves", () => {
    // The irreversible case. A workspace with no owner has nobody who can invite a
    // replacement, and its workflows, credentials and history are still in it.
    assert.equal(
      removalRefusal({
        ...base,
        targetUserId: base.actorUserId,
        targetRole: "owner",
        ownerCount: 1,
      }),
      "last_owner",
    );
  });

  it("lets an owner leave when there is another owner", () => {
    assert.equal(
      removalRefusal({
        ...base,
        targetUserId: base.actorUserId,
        targetRole: "owner",
        ownerCount: 2,
      }),
      null,
    );
  });

  it("refuses an admin removing an owner", () => {
    // Otherwise `admin` is `owner` with extra steps, and an invitation handing out admin
    // hands out the ability to evict the person who sent it.
    assert.equal(
      removalRefusal({ ...base, actorRole: "admin", targetRole: "owner", ownerCount: 2 }),
      "owner_only",
    );
  });

  it("lets an owner remove another owner when one would remain", () => {
    assert.equal(removalRefusal({ ...base, targetRole: "owner", ownerCount: 2 }), null);
  });
});

describe("describeWorkspace", () => {
  it("carries the name and role and nothing else", () => {
    const described = describeWorkspace(
      { workspace: workspace({ id: "ws-1", name: "Team", personal: false }), role: "admin" },
      "user-1",
    );
    assert.deepEqual(described, {
      id: "ws-1",
      name: "Team",
      personal: false,
      own: false,
      role: "admin",
    });
    // `createdBy` is a user id and has no business reaching a client that only needs a
    // label in a header.
    assert.equal("createdBy" in described, false);
  });

  it("marks the viewer's OWN personal workspace as own", () => {
    const described = describeWorkspace(
      { workspace: workspace({ personal: true, createdBy: "user-1" }), role: "owner" },
      "user-1",
    );
    assert.equal(described.own, true);
  });

  it("does not mark somebody else's personal workspace as own", () => {
    // Found by driving a browser: the switcher labelled the inviter's workspace
    // `PERSONAL` to a guest, and the workflow list called it "your workspace".
    const described = describeWorkspace(
      { workspace: workspace({ personal: true, createdBy: "user-2" }), role: "viewer" },
      "user-1",
    );
    assert.equal(described.personal, true);
    assert.equal(described.own, false);
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

  it("passes a deliberate ApiError through with its own code and message — Phase 21", () => {
    /**
     * **The Phase 21 regression.** The vault's rotation route wrapped its whole body in this
     * mapper, so every deliberate refusal underneath it — an unknown credential kind (404), a
     * Google connection explaining that a refresh token cannot be typed (400), a key the
     * provider had rejected (400) — came back as *"Something went wrong saving this The provider
     * connection."* Four real refusals collapsed into one internal error, found by the deployed
     * check suite because a route's error mapping is invisible anywhere else.
     *
     * Fixed here rather than at that call site, because the defect is a class: an `ApiError`
     * already carries a code and a client-safe message chosen on purpose, so re-deciding either
     * is always wrong.
     */
    const refusal = new ApiError("not_found", "This product does not store that kind of credential.");
    const mapped = integrationApiError("Discord", refusal);
    assert.equal(mapped, refusal, "the refusal was replaced rather than passed through");
    assert.equal(mapped.code, "not_found");
    assert.match(mapped.message, /does not store that kind/);
  });

  it("keeps every ApiError code intact, not just the one that was reported", () => {
    // Total over the codes a rotation can raise, so the fix cannot be narrowed to a special
    // case for 404 by somebody reading only the bug report.
    for (const code of ["not_found", "invalid_request", "conflict", "forbidden"] as const) {
      const mapped = integrationApiError("Discord", new ApiError(code, "refused on purpose"));
      assert.equal(mapped.code, code);
      assert.equal(mapped.message, "refused on purpose");
    }
  });
});
