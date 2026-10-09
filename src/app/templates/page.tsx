import type { Metadata } from "next";
import Link from "next/link";

import { AppHeader } from "@/components/shell/app-header";
import { TemplateGallery } from "@/components/templates/gallery";
import { describeNodes } from "@/lib/nodes";
import { describeTemplates } from "@/lib/templates/catalogue";
import { requirePageSession } from "@/lib/workspace/page";
import { atLeast } from "@/lib/workspace/roles";
import { describeWorkspace } from "@/lib/workspace/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Templates",
  description: "Start from a workflow that already works.",
};

/**
 * **The template gallery — Phase 23A.** The answer to the blank canvas.
 *
 * A server component that reads the catalogue and the registry directly, the same way
 * `/workflows` calls `listWorkflows` and `/analytics` calls `readAnalytics`. Both are
 * module-level constants, so **this page costs no database query at all** — it is the
 * cheapest route in the product, and deliberately: a gallery that woke a metered
 * database to list six hard-coded graphs would be spending the thing `CLAUDE.md` says
 * not to spend.
 *
 * A viewer sees the gallery and cannot clone from it. That is the Phase 20 line held
 * where it already is: reading is a read, and creating a workflow is `editor`.
 */
export default async function TemplatesPage() {
  const { email, scope, membership, memberships } = await requirePageSession();
  const workspace = describeWorkspace(membership, scope.userId);
  const canUse = atLeast(scope.role, "editor");

  const templates = describeTemplates();

  return (
    <>
      <AppHeader
        email={email}
        workspace={workspace}
        workspaces={memberships.map((m) => describeWorkspace(m, scope.userId))}
        scope={scope}
        active="templates"
      />

      <main id="main" className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="animate-rise mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Templates</h1>
          <p className="text-muted mt-1 max-w-2xl text-sm text-pretty">
            Start from a workflow that already works. Every one of these is a real graph —
            it opens on the canvas, every node is editable, and you can run it straight
            away.{" "}
            {canUse ? (
              <>
                Prefer to describe your own?{" "}
                <Link href="/workflows" className="link">
                  Go to Workflows
                </Link>
                .
              </>
            ) : (
              <>
                You have the <strong className="font-semibold">{scope.role}</strong> role
                here, so you can read these and an admin can give you the editor role to use
                one.
              </>
            )}
          </p>
        </div>

        <TemplateGallery templates={templates} nodes={describeNodes()} canUse={canUse} />
      </main>
    </>
  );
}
