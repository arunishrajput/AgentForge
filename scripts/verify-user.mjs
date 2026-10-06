/**
 * **Which account a verification script acts as** — one answer, shared by every script that
 * mints a session (and by `mint-session.mjs`, which hands one to a browser).
 *
 * It is the **deployment's owner**: whoever created the oldest personal workspace, which is the
 * first person ever to sign in. `VERIFY_USER_EMAIL` names a different account deliberately.
 *
 * Until Phase 26 every script said `select … from "user" order by "id" limit 1`. User ids are
 * random UUIDs, so that is "the first user" only while there is one. When a second account
 * signed in on 2026-10-01 its id happened to sort first, and every suite silently moved into a
 * workspace with an empty vault — Phase 26's deployed battery failed every model check with
 * "No model provider key configured", and stored the operator's own GitHub, Slack, Groq and
 * Postgres credentials in somebody else's workspace on the way. Nothing errored: the scripts
 * were still acting as *a* user, just not the one whose data they were written against.
 */

const CANDIDATES = `
  select u."id", u."email", w."createdAt" as "workspaceCreatedAt"
  from "user" u
  join "workspace" w on w."createdBy" = u."id" and w."personal"
`;

/**
 * The pure half: given every user with a personal workspace, pick the one to act as. Ordered
 * here rather than in SQL so the rule is testable — oldest workspace first, id as the tiebreak.
 *
 * @param {{ id: string, email: string | null, workspaceCreatedAt: Date | string }[]} candidates
 * @param {string | undefined} email `VERIFY_USER_EMAIL`, when set
 */
export function chooseVerificationUser(candidates, email) {
  if (email) {
    const wanted = email.trim().toLowerCase();
    const match = candidates.find((user) => user.email?.toLowerCase() === wanted);
    if (!match) throw new Error(`VERIFY_USER_EMAIL=${email} names no user with a personal workspace.`);
    return { id: match.id, email: match.email };
  }
  const [owner] = [...candidates].sort(
    (a, b) =>
      new Date(a.workspaceCreatedAt).getTime() - new Date(b.workspaceCreatedAt).getTime() ||
      a.id.localeCompare(b.id),
  );
  return owner ? { id: owner.id, email: owner.email } : null;
}

/** The account to act as, or `null` when nobody has signed in yet. */
export async function verificationUser(sql) {
  return chooseVerificationUser(await sql.query(CANDIDATES), process.env.VERIFY_USER_EMAIL);
}
