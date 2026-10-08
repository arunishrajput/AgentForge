import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { credentials, runs, workflows, workspaces } from "@/db/schema";
import { LLM_CREDENTIAL_KINDS } from "@/lib/ai/providers";
import { visibleWorkflows } from "@/lib/workflow/visibility";
import type { WorkspaceScope } from "@/lib/workspace/scope";

import { onboardingProgress, type OnboardingProgress } from "./steps";

export type { OnboardingProgress, OnboardingStep, OnboardingStepId } from "./steps";
export { onboardingProgress } from "./steps";

/**
 * **Reading first-run progress — Phase 25, and it is written against the meter.**
 *
 * Neon's free plan meters **compute time awake**, not statements (`DEPLOYMENT.md` →
 * *Free-tier headroom*, sharpened in Phase 19A), so what costs money is a new reason to
 * wake an idle database — and what costs latency is a round trip. This reads progress for
 * a page a signed-in person has just opened, so the database is already awake and there is
 * no wake to pay for. That leaves three rules, in order of how much each saves:
 *
 *  1. **Nothing is read once the workspace has onboarded.** `onboardedAt` comes free on the
 *     membership row the page already loaded (`listMemberships` selects the workspace), so
 *     the common case — every page load after the first day — costs **zero statements**.
 *     This is the whole saving.
 *  2. **The two queries that do run go in parallel.** Two statements, one round trip.
 *     A statement against an awake database is close to free; the round trip is not.
 *  3. **The run query is skipped when there is no workflow.** `run.workflowId` is
 *     `not null` and cascades, so no workflow provably means no run and asking is a
 *     statement whose answer is already known.
 *
 * Every query is `limit(1)` and opens on the leading column of an index that already
 * exists — `credential_workspace_kind_label_idx`, `workflow_workspace_idx` and
 * `run_workspace_idx`. Nothing here adds an index and nothing here scans a table.
 */
export async function readOnboarding(
  scope: WorkspaceScope,
  workspace: { onboardedAt: Date | null },
  /**
   * Whether the page already knows there is a workflow. `/workflows` has just listed
   * them, so passing the answer in saves a statement rather than re-deriving it — and it
   * is the same answer, because the list is scoped by `visibleWorkflows` too.
   */
  knownHasWorkflow?: boolean,
): Promise<OnboardingProgress | null> {
  // Done, dismissed, or on a workspace created before this column existed and since
  // finished. Nothing to read and nothing to show.
  if (workspace.onboardedAt !== null) return null;

  const [hasProviderKey, hasWorkflow] = await Promise.all([
    anyProviderKey(scope),
    knownHasWorkflow ?? anyWorkflow(scope),
  ]);

  return onboardingProgress({
    hasProviderKey,
    hasWorkflow,
    // No workflow, no run: `run.workflowId` is not-null and cascades on delete.
    hasSuccessfulRun: hasWorkflow ? await anySuccessfulRun(scope) : false,
  });
}

/**
 * Does this workspace hold a key for **any** LLM provider?
 *
 * `LLM_CREDENTIAL_KINDS` is derived from the provider registry, so a third provider is
 * counted here with no edit — the same mechanism that made `llm.groq` rotatable in 23D
 * with no rotation code written.
 */
async function anyProviderKey(scope: WorkspaceScope): Promise<boolean> {
  const rows = await db()
    .select({ one: credentials.id })
    .from(credentials)
    .where(
      and(
        eq(credentials.workspaceId, scope.workspaceId),
        inArray(credentials.kind, LLM_CREDENTIAL_KINDS),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Scoped by `visibleWorkflows` as well as by workspace, exactly as the list is: a viewer
 * who cannot see a colleague's private workflow must not be told the step is done by one
 * they will never find.
 */
async function anyWorkflow(scope: WorkspaceScope): Promise<boolean> {
  const rows = await db()
    .select({ one: workflows.id })
    .from(workflows)
    .where(and(eq(workflows.workspaceId, scope.workspaceId), visibleWorkflows(scope)))
    .limit(1);
  return rows.length > 0;
}

/**
 * **`succeeded`, not "a run exists".** The step's claim is that the product executed
 * something, and a run that failed has not demonstrated that — it is the state the guide
 * is there to help somebody out of. **Nor a test** (Phase 31): one node tried alone, or a run
 * that used pinned outputs, proves a piece of a workflow rather than the workflow.
 *
 * Joined to `workflow` and scoped twice, like every run query in this project (see
 * `lib/analytics/queries.ts` for the reasoning): a run carries its workflow's name, so a
 * viewer must not learn about a private workflow through one.
 */
async function anySuccessfulRun(scope: WorkspaceScope): Promise<boolean> {
  const rows = await db()
    .select({ one: runs.id })
    .from(runs)
    .innerJoin(workflows, eq(workflows.id, runs.workflowId))
    .where(
      and(
        eq(runs.workspaceId, scope.workspaceId),
        eq(runs.status, "succeeded"),
        // Phase 31: a test proves a piece, not the workflow — the step is "run a workflow".
        isNull(runs.test),
        visibleWorkflows(scope),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Finish onboarding — either because all three steps are done or because somebody skipped
 * it. One idempotent write, and the guide never returns.
 *
 * **It does not check that the steps are complete, deliberately.** "Skip" is a legitimate
 * answer: somebody evaluating the product, or a colleague joining a workspace that was set
 * up long ago, should be able to clear the checklist without first satisfying it. The
 * product loses nothing — every step is reachable from the normal navigation, which is
 * where an experienced user would go anyway.
 *
 * **Any member may dismiss it, not only an admin.** It is a note on a page rather than a
 * setting, and `onboardedAt` grants nothing: the worst a viewer can do with it is hide a
 * checklist from their colleagues, where the alternative is a viewer unable to dismiss
 * something they have read. Compare the credential routes, which are admin-only because
 * what they change is a secret.
 *
 * The timestamp is only written once — `onboardedAt is null` in the `where` — so a second
 * click is a no-op rather than a quiet rewrite of when it happened.
 */
export async function finishOnboarding(scope: WorkspaceScope): Promise<void> {
  await db()
    .update(workspaces)
    .set({ onboardedAt: new Date() })
    .where(and(eq(workspaces.id, scope.workspaceId), isNull(workspaces.onboardedAt)));
}
