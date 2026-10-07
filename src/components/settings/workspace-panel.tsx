"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Labelled, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { formatUtc } from "@/lib/format/date";
import {
  api,
  ApiRequestError,
  type InvitableRole,
  type InvitationSummary,
  type IssuedInvitation,
  type WorkspaceMemberSummary,
  type WorkspaceRole,
} from "@/lib/canvas/client";
import type { WorkspaceSummary } from "@/lib/canvas/client";
import { WORKSPACE_ROLES } from "@/lib/workspace/roles";

/**
 * The workspace tab: who is in here, who has been invited, what it is called, and how to
 * make another one — Phase 19B.
 *
 * **The whole panel is built around one honest limitation.** There is no email provider on
 * a zero-cost budget, so AgentForge does not send invitations: it mints one link and hands
 * it to the inviter to deliver however they already talk to that person. The panel says
 * that in the copy rather than implying a mail was sent, and it shows the link exactly
 * once — only a hash of the token is stored, so it genuinely cannot be shown again, and
 * "Send again" is re-inviting, which rotates it.
 *
 * **Phase 20 added the role picker**, which is what 19B left behind: an invitation fixed a
 * role at the moment it was sent and nothing could move it afterwards, so a workspace whose
 * owner had left was unadministrable for ever. The picker is a native `<select>` on each
 * row, and the two rules worth knowing at a glance are in the copy under it — only an owner
 * can grant or take ownership, and the last owner cannot be demoted.
 *
 * Deleting a workspace is still not here and is not Phase 20's either. It is the one
 * destructive act in membership with no undo and no partial form, and the product has no
 * export yet — so it waits for one rather than shipping a button that loses somebody's work.
 */
export function WorkspacePanel({
  workspace,
  members: initialMembers,
  invitations: initialInvitations,
  canAdminister,
  viewerUserId,
}: {
  workspace: WorkspaceSummary;
  members: WorkspaceMemberSummary[];
  /** Empty for a member who may not see them — the API refuses, the page does not ask. */
  invitations: InvitationSummary[];
  canAdminister: boolean;
  viewerUserId: string;
}) {
  const router = useRouter();

  const [members, setMembers] = useState(initialMembers);
  const [invitations, setInvitations] = useState(initialInvitations);
  const [name, setName] = useState(workspace.name);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole>("editor");
  const [issued, setIssued] = useState<IssuedInvitation | null>(null);
  const [copied, setCopied] = useState(false);
  const [newWorkspace, setNewWorkspace] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const report = (caught: unknown, fallback: string) => {
    setError(caught instanceof ApiRequestError ? caught.message : fallback);
    setNotice(null);
  };

  const start = (what: string) => {
    setBusy(what);
    setError(null);
    setNotice(null);
  };

  const rename = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed === workspace.name) return;
    start("rename");
    try {
      const saved = await api.renameWorkspace(workspace.id, { name: trimmed });
      setNotice(`Renamed to ${saved.name}.`);
      // The name is in the header, which is a server component — so the page has to
      // re-render for the rename to be visible anywhere but this field.
      router.refresh();
    } catch (caught) {
      report(caught, "That workspace could not be renamed.");
    } finally {
      setBusy(null);
    }
  };

  const invite = async () => {
    const trimmed = email.trim();
    if (trimmed.length === 0) return;
    start("invite");
    try {
      const result = await api.inviteToWorkspace(workspace.id, { email: trimmed, role });
      setIssued(result);
      setCopied(false);
      setEmail("");
      setInvitations(await api.listInvitations(workspace.id));
    } catch (caught) {
      report(caught, "That invitation could not be created.");
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (invitation: InvitationSummary) => {
    start(`revoke:${invitation.id}`);
    try {
      await api.revokeInvitation(workspace.id, invitation.id);
      setInvitations(await api.listInvitations(workspace.id));
      // The link the panel is still showing is now dead. Saying so is the point.
      if (issued?.invitation.id === invitation.id) setIssued(null);
      setNotice(`The invitation to ${invitation.email} was revoked.`);
    } catch (caught) {
      report(caught, "That invitation could not be revoked.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (member: WorkspaceMemberSummary) => {
    start(`remove:${member.userId}`);
    try {
      await api.removeMember(workspace.id, member.userId);
      if (member.you) {
        // Left. The active workspace is cleared server-side, so the next render resolves
        // one this account is still in — a push rather than a refresh, because settings
        // for a workspace you are no longer in is not a page to land on.
        router.push("/workflows");
        return;
      }
      setMembers(await api.listMembers(workspace.id));
      setNotice(`${member.email ?? member.name ?? "That member"} was removed.`);
    } catch (caught) {
      report(caught, "That member could not be removed.");
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    const trimmed = newWorkspace.trim();
    if (trimmed.length === 0) return;
    start("create");
    try {
      await api.createWorkspace({ name: trimmed });
      setNewWorkspace("");
      // Creating switches to it, so everything on the page now belongs somewhere else.
      router.refresh();
    } catch (caught) {
      report(caught, "That workspace could not be created.");
    } finally {
      setBusy(null);
    }
  };

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard access can be refused, and the link is on screen in a selectable field
      // anyway — so this is a hint, not a failure.
      setCopied(false);
      setError("Could not copy automatically. Select the link and copy it.");
    }
  };

  const changeRole = async (member: WorkspaceMemberSummary, role: WorkspaceRole) => {
    start(`role:${member.userId}`);
    try {
      const updated = await api.changeMemberRole(workspace.id, member.userId, role);
      setMembers((current) =>
        current.map((m) => (m.userId === updated.userId ? updated : m)),
      );
      setNotice(`${member.email ?? member.name ?? "That member"} is now ${roleArticle(role)} ${role}.`);
      // Demoting yourself changes what the rest of the page may show, and the header and
      // every server-rendered control on it were drawn for the role you no longer have.
      if (member.you) router.refresh();
    } catch (caught) {
      report(caught, "That role could not be changed.");
      // The list this was drawn from may be what was wrong — a 409 means somebody else
      // moved first — so re-read it rather than leaving a stale picker on screen.
      try {
        setMembers(await api.listMembers(workspace.id));
      } catch {
        // The error above is the one worth showing; a failed re-read is not a second one.
      }
    } finally {
      setBusy(null);
    }
  };

  // An affordance that cannot succeed is worse than none: the sole owner's Leave button
  // could only ever return the 409 the store throws. The API still refuses regardless —
  // this hides a dead control, it does not enforce anything.
  const owners = members.filter((member) => member.role === "owner").length;
  const canLeave = (member: WorkspaceMemberSummary) =>
    !(member.role === "owner" && owners <= 1);

  /**
   * Whether to draw a picker for this row — **the client-side mirror of
   * `roleChangeRefusal`**, and deliberately the *narrow* half of it.
   *
   * It withholds the picker in exactly the cases where every option in it would be refused:
   * a viewer who is not an admin, and an admin looking at an owner. It does **not** try to
   * reproduce the whole rule — the last-owner case is handled by `roleOptions` removing the
   * options that would fail, and anything it gets wrong still meets the same refusal from
   * the API. The rule lives on the server; this only decides what is worth drawing.
   */
  const canChangeRole = (member: WorkspaceMemberSummary) => {
    if (!canAdminister) return false;
    if (member.role === "owner" && workspace.role !== "owner") return false;
    // The sole owner has nowhere to go: every other role would leave the workspace
    // ownerless, which is the one membership state with no way back.
    if (member.role === "owner" && owners <= 1) return false;
    return true;
  };

  /**
   * Which roles this viewer may move that member to. `owner` is offered only to an owner,
   * because ownership does not arrive from an admin — the same rule that keeps it out of
   * an invitation.
   */
  const roleOptions = (member: WorkspaceMemberSummary): WorkspaceRole[] =>
    WORKSPACE_ROLES.filter(
      (role) => role !== "owner" || workspace.role === "owner" || member.role === "owner",
    );

  const live = invitations.filter((invitation) => invitation.state === "live");
  const spent = invitations.filter((invitation) => invitation.state !== "live");

  return (
    <div className="space-y-5">
      {error && <Notice tone="bad" title={error} />}
      {notice && <Notice tone="ok" title={notice} />}

      {/* ---------------------------------------------------------------- *
          What this workspace is
       * ---------------------------------------------------------------- */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold">This workspace</h2>
            <p className="text-muted mt-1 text-sm text-pretty">
              Every workflow, run, version and credential belongs to a workspace — not to a
              person. {workspace.own ? "This one was made for you when you signed in." : ""}{" "}
              You are {roleArticle(workspace.role)}{" "}
              <strong className="font-semibold">{workspace.role}</strong> here.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {workspace.own && <Badge icon="●">Personal</Badge>}
            <Badge tone="pop" icon="◆">
              {members.length} {members.length === 1 ? "member" : "members"}
            </Badge>
          </div>
        </div>

        {canAdminister ? (
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <Labelled label="Name" className="min-w-56 flex-1" hint="What everyone in it sees in the header.">
              <Input
                value={name}
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void rename();
                }}
              />
            </Labelled>
            <Button
              onClick={() => void rename()}
              loading={busy === "rename"}
              disabled={name.trim().length === 0 || name.trim() === workspace.name}
            >
              Rename
            </Button>
          </div>
        ) : (
          <p className="text-faint mt-3 text-2xs">
            Renaming this workspace needs the admin role.
          </p>
        )}
      </Card>

      {/* ---------------------------------------------------------------- *
          Members
       * ---------------------------------------------------------------- */}
      <Card className="p-5">
        <h2 className="text-base font-bold">Members</h2>
        <p className="text-muted mt-1 text-sm text-pretty">
          Everyone here can see every workflow and every run in this workspace, and every
          workflow that runs uses <strong className="font-semibold">this workspace&rsquo;s</strong>{" "}
          connected credentials.
        </p>

        <ul className="mt-4 space-y-2">
          {members.map((member) => (
            <li
              key={member.userId}
              className="border-line bg-elevated flex flex-wrap items-center gap-3 rounded-xl border-2 p-3"
            >
              <span
                aria-hidden="true"
                className="border-line bg-accent-pop text-accent-ink grid size-8 shrink-0 place-items-center rounded-lg border-2 text-sm font-bold"
              >
                {(member.name ?? member.email ?? "?").slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-bold">
                    {member.name ?? member.email ?? "Unnamed account"}
                  </span>
                  {member.you && <Badge icon="●">You</Badge>}
                </span>
                {member.name && member.email && (
                  <span className="text-muted block truncate text-2xs">{member.email}</span>
                )}
                <span className="text-faint block text-2xs">
                  Joined {formatUtc(member.joinedAt)}
                </span>
              </span>
              {/* **The picker replaces the badge only where it could work.** A member
                  whose role this viewer cannot change still has to see what it is, so the
                  badge stays for them — a control that is absent is legible, a control that
                  is present and refuses is not. */}
              {canChangeRole(member) ? (
                <label className="shrink-0">
                  <span className="sr-only">
                    Role for {member.name ?? member.email ?? "this member"}
                  </span>
                  <Select
                    value={member.role}
                    disabled={busy !== null}
                    onChange={(event) => void changeRole(member, event.target.value as WorkspaceRole)}
                    className="w-32 py-1.5 text-2xs"
                  >
                    {roleOptions(member).map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </Select>
                </label>
              ) : (
                <Badge tone="pop" className="shrink-0" icon="◆">
                  {member.role}
                </Badge>
              )}
              {(member.you || canAdminister) && canLeave(member) && (
                <Button
                  tone="danger"
                  onClick={() => void remove(member)}
                  loading={busy === `remove:${member.userId}`}
                >
                  {member.you ? "Leave" : "Remove"}
                </Button>
              )}
            </li>
          ))}
        </ul>

        {members.length === 1 && members[0]?.userId === viewerUserId && (
          <p className="text-faint mt-3 text-2xs text-pretty">
            It is just you in here. Invite somebody below and they will see everything in
            this workspace.
          </p>
        )}

        {canAdminister && members.length > 1 && (
          <p className="text-faint mt-3 text-2xs text-pretty">
            {workspace.role === "owner"
              ? "Only an owner can grant or take away ownership, and the last owner cannot be demoted — promote somebody else first, then step down."
              : "An admin cannot change an owner's role. Ask an owner to do that."}
          </p>
        )}
      </Card>

      {/* ---------------------------------------------------------------- *
          Invitations
       * ---------------------------------------------------------------- */}
      {canAdminister && (
        <Card className="p-5">
          <h2 className="text-base font-bold">Invite somebody</h2>
          <p className="text-muted mt-1 text-sm text-pretty">
            AgentForge does not send the email — it makes one link, and you send it however
            you already talk to them. The link works for{" "}
            <strong className="font-semibold">that address only</strong>, expires in seven
            days, and can be used once.
          </p>

          <div className="mt-4 flex flex-wrap items-end gap-2">
            <Labelled label="Email address" className="min-w-56 flex-1">
              <Input
                type="email"
                value={email}
                placeholder="them@example.com"
                autoComplete="off"
                maxLength={320}
                onChange={(event) => setEmail(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void invite();
                }}
              />
            </Labelled>
            <Labelled label="Role" className="w-40">
              <Select value={role} onChange={(event) => setRole(event.target.value as InvitableRole)}>
                <option value="admin">Admin</option>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </Select>
            </Labelled>
            <Button onClick={() => void invite()} loading={busy === "invite"} disabled={email.trim().length === 0}>
              Create link
            </Button>
          </div>

          <dl className="text-faint mt-3 space-y-1 text-2xs">
            <div>
              <dt className="text-ink inline font-semibold">Admin</dt>{" "}
              <dd className="inline">
                — everything an editor can do, plus invite people and connect credentials.
              </dd>
            </div>
            <div>
              <dt className="text-ink inline font-semibold">Editor</dt>{" "}
              <dd className="inline">— build, edit and run workflows. Cannot invite or connect.</dd>
            </div>
            <div>
              <dt className="text-ink inline font-semibold">Viewer</dt>{" "}
              <dd className="inline">— read workflows, runs and history. Cannot change or run anything.</dd>
            </div>
          </dl>

          {issued && (
            <Notice
              tone="ok"
              className="mt-4"
              title={`Link ready for ${issued.invitation.email}`}
              action={
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button onClick={() => void copyLink(issued.url)}>
                    {copied ? "Copied" : "Copy link"}
                  </Button>
                  <span className="text-faint text-2xs">
                    Expires {formatUtc(issued.invitation.expiresAt)}
                  </span>
                </div>
              }
            >
              <p>
                <strong className="text-ink font-semibold">Copy it now.</strong> Only a hash of
                this link is stored, so it cannot be shown again — creating another link for
                the same address replaces this one.
              </p>
              {/* Read-only rather than a code block: it has to be selectable on a phone,
                  where clipboard access is the flakiest. */}
              <input
                readOnly
                value={issued.url}
                aria-label="Invitation link"
                onFocus={(event) => event.currentTarget.select()}
                className="field mt-2 font-mono text-2xs"
              />
            </Notice>
          )}

          {live.length > 0 && (
            <>
              <h3 className="mt-5 text-sm font-bold">Waiting to be accepted</h3>
              <ul className="mt-2 space-y-2">
                {live.map((invitation) => (
                  <li
                    key={invitation.id}
                    className="border-line bg-elevated flex flex-wrap items-center gap-3 rounded-xl border-2 p-3"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">{invitation.email}</span>
                      <span className="text-faint block text-2xs">
                        Expires {formatUtc(invitation.expiresAt)}
                      </span>
                    </span>
                    <Badge className="shrink-0" icon="◆">
                      {invitation.role}
                    </Badge>
                    <Button
                      tone="quiet"
                      onClick={() => {
                        setEmail(invitation.email);
                        setRole(invitation.role as InvitableRole);
                      }}
                    >
                      New link
                    </Button>
                    <Button
                      tone="danger"
                      onClick={() => void revoke(invitation)}
                      loading={busy === `revoke:${invitation.id}`}
                    >
                      Revoke
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {spent.length > 0 && (
            <>
              <h3 className="mt-5 text-sm font-bold">Already dealt with</h3>
              <ul className="text-muted mt-2 space-y-1 text-2xs">
                {spent.slice(0, 10).map((invitation) => (
                  <li key={invitation.id} className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold">{invitation.email}</span>
                    <span>— {invitation.state}</span>
                    <span className="text-faint">{formatUtc(invitation.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}

      {/* ---------------------------------------------------------------- *
          Another workspace
       * ---------------------------------------------------------------- */}
      <Card className="p-5">
        <h2 className="text-base font-bold">Start another workspace</h2>
        <p className="text-muted mt-1 text-sm text-pretty">
          A second workspace is a clean slate: no workflows and{" "}
          <strong className="font-semibold">no credentials</strong>. You will need to connect
          a model provider and any integrations again, because those belong to a workspace
          rather than to you. Switch between them from the header.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <Labelled label="Name" className="min-w-56 flex-1">
            <Input
              value={newWorkspace}
              placeholder="Acme automations"
              maxLength={120}
              onChange={(event) => setNewWorkspace(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void create();
              }}
            />
          </Labelled>
          <Button
            tone="primary"
            onClick={() => void create()}
            loading={busy === "create"}
            disabled={newWorkspace.trim().length === 0}
          >
            Create and switch
          </Button>
        </div>
      </Card>
    </div>
  );
}

/** "an admin", "an owner", "a viewer" — a sentence that reads as English. */
function roleArticle(role: string): string {
  return /^[aeiou]/i.test(role) ? "an" : "a";
}
