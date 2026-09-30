import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { atLeast, roleChangeRefusal, WORKSPACE_ROLES, type WorkspaceRole } from "./roles";

/**
 * Phase 20's authorisation rules, asserted as matrices rather than as cases.
 *
 * The matrix is the point. `BUILD_PLAN.md` Phase 20 asks for "every role against every
 * action", and the deployed suite does that over HTTP — but the *rules* those refusals come
 * from are pure functions, and a table driven over all four roles catches the thing a
 * handful of examples never does: a rule that is right for the role it was written against
 * and wrong one step up or down the ladder. Phase 19B's `removalRefusal` bug was exactly
 * that shape.
 */

const base = {
  actorRole: "owner" as WorkspaceRole,
  actorUserId: "user-a",
  targetUserId: "user-b",
  targetRole: "editor" as WorkspaceRole,
  nextRole: "admin" as unknown,
  ownerCount: 2,
};

describe("roleChangeRefusal — authority", () => {
  it("refuses every role below admin, whatever the change", () => {
    // Authority is tested first, so this holds regardless of what the target's role is or
    // what it would become — including changes that are otherwise nonsense.
    for (const actorRole of WORKSPACE_ROLES) {
      for (const nextRole of [...WORKSPACE_ROLES, "nonsense"]) {
        const refusal = roleChangeRefusal({ ...base, actorRole, nextRole });
        if (!atLeast(actorRole, "admin")) {
          assert.equal(refusal, "not_allowed", `${actorRole} → ${String(nextRole)}`);
        } else {
          assert.notEqual(refusal, "not_allowed", `${actorRole} → ${String(nextRole)}`);
        }
      }
    }
  });

  it("reports an unprivileged caller as not allowed before it looks at the value", () => {
    // The same ordering lesson as `removalRefusal`: a viewer sending a role that is not a
    // role must learn they may not do this, not that their input was malformed. The second
    // answer is a probe for what the roles are.
    assert.equal(roleChangeRefusal({ ...base, actorRole: "viewer", nextRole: "root" }), "not_allowed");
  });

  it("refuses a value that is not a role once the caller is privileged", () => {
    for (const nextRole of [undefined, null, "", "root", 3, {}]) {
      assert.equal(roleChangeRefusal({ ...base, nextRole }), "not_a_role", String(nextRole));
    }
  });
});

describe("roleChangeRefusal — ownership", () => {
  it("lets an owner promote an editor to admin", () => {
    assert.equal(roleChangeRefusal(base), null);
  });

  it("lets an admin promote a viewer to editor", () => {
    assert.equal(
      roleChangeRefusal({ ...base, actorRole: "admin", targetRole: "viewer", nextRole: "editor" }),
      null,
    );
  });

  it("refuses an admin granting ownership — otherwise admin promotes itself", () => {
    assert.equal(roleChangeRefusal({ ...base, actorRole: "admin", nextRole: "owner" }), "owner_only");
  });

  it("refuses an admin changing an owner's role — otherwise admin evicts its inviter", () => {
    assert.equal(
      roleChangeRefusal({
        ...base,
        actorRole: "admin",
        targetRole: "owner",
        nextRole: "viewer",
        ownerCount: 2,
      }),
      "owner_only",
    );
  });

  it("lets an owner grant ownership", () => {
    assert.equal(roleChangeRefusal({ ...base, nextRole: "owner" }), null);
  });

  it("only ever lets an owner touch ownership, in either direction", () => {
    // The full matrix over both ends of the change, because the two halves of the rule are
    // independent and each is a way in on its own.
    for (const actorRole of WORKSPACE_ROLES) {
      if (!atLeast(actorRole, "admin")) continue;
      for (const targetRole of WORKSPACE_ROLES) {
        for (const nextRole of WORKSPACE_ROLES) {
          if (targetRole === nextRole) continue;
          const involvesOwnership = targetRole === "owner" || nextRole === "owner";
          const refusal = roleChangeRefusal({
            ...base,
            actorRole,
            targetRole,
            nextRole,
            ownerCount: 2,
          });
          if (involvesOwnership && actorRole !== "owner") {
            assert.equal(refusal, "owner_only", `${actorRole}: ${targetRole} → ${nextRole}`);
          } else {
            assert.equal(refusal, null, `${actorRole}: ${targetRole} → ${nextRole}`);
          }
        }
      }
    }
  });
});

describe("roleChangeRefusal — the last owner", () => {
  it("refuses demoting the sole owner", () => {
    assert.equal(
      roleChangeRefusal({ ...base, targetRole: "owner", nextRole: "admin", ownerCount: 1 }),
      "last_owner",
    );
  });

  it("allows demoting an owner once there is another one", () => {
    assert.equal(
      roleChangeRefusal({ ...base, targetRole: "owner", nextRole: "admin", ownerCount: 2 }),
      null,
    );
  });

  it("lets an owner step down when another owner exists, aimed at themselves", () => {
    // The intended handover: promote the successor, then demote yourself. It has to be
    // allowed or the sole owner of a shared workspace is stuck in the role for ever.
    assert.equal(
      roleChangeRefusal({
        ...base,
        targetUserId: base.actorUserId,
        targetRole: "owner",
        nextRole: "admin",
        ownerCount: 2,
      }),
      null,
    );
  });

  it("refuses the sole owner stepping down, aimed at themselves", () => {
    assert.equal(
      roleChangeRefusal({
        ...base,
        targetUserId: base.actorUserId,
        targetRole: "owner",
        nextRole: "admin",
        ownerCount: 1,
      }),
      "last_owner",
    );
  });

  it("puts authority before the invariant, as removalRefusal now does", () => {
    // A viewer aiming a demotion at the sole owner learns they may not do this. The
    // `last_owner` answer would both call a refusal a conflict and disclose the owner
    // count, which is the Phase 19B defect exactly.
    assert.equal(
      roleChangeRefusal({
        ...base,
        actorRole: "viewer",
        targetRole: "owner",
        nextRole: "admin",
        ownerCount: 1,
      }),
      "not_allowed",
    );
  });
});

describe("roleChangeRefusal — no change", () => {
  it("refuses a change to the role already held", () => {
    for (const role of WORKSPACE_ROLES) {
      assert.equal(
        roleChangeRefusal({ ...base, targetRole: role, nextRole: role, ownerCount: 2 }),
        "no_change",
        role,
      );
    }
  });

  it("checks authority before no-change, so a viewer cannot confirm somebody's role", () => {
    assert.equal(
      roleChangeRefusal({ ...base, actorRole: "editor", targetRole: "editor", nextRole: "editor" }),
      "not_allowed",
    );
  });
});
