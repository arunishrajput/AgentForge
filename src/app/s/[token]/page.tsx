import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SharedCanvas } from "@/components/share/shared-canvas";
import { Wordmark } from "@/components/shell/logo";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { NodeIcon } from "@/components/canvas/node-icon";
import { formatUtc } from "@/lib/format/date";
import { describeNodes } from "@/lib/nodes";
import { shareWorkflow, type SharedNode } from "@/lib/workflow/share";
import { findSharedWorkflow } from "@/lib/workflow/store";
import { SHARE_TOKEN_PATTERN } from "@/lib/workflow/visibility";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shared workflow",
  // No link to this page should ever end up in an index. The URL *is* the credential —
  // the same rule the invitation page follows, for the same reason.
  robots: { index: false, follow: false },
};

/**
 * A workflow, published read-only — **Phase 20**, and the second page a signed-out stranger
 * can reach after the landing page and the invitation.
 *
 * **It reads the database directly rather than fetching its own API.** The redaction is the
 * same function either way (`shareWorkflow` in `lib/workflow/share.ts`), and a page that
 * fetched `/api/share/:token` would add a round trip, a second failure mode and a URL to
 * construct — all to arrive at the value it can have for free. The API route exists for
 * anything that is not this page.
 *
 * **What the visitor is told, and why the page says it out loud.** A diagram with no
 * explanation invites the reader to assume they are seeing everything, and they are not:
 * every value somebody typed into a node is withheld. So the page states that, once, near
 * the top, and each node's card carries its own count of hidden values. A reader who cannot
 * tell "this node has no settings" from "this node's settings are not shown to you" is
 * being misled by omission, which is the failure mode a share link has.
 *
 * A dead token answers `notFound()` — the framework's 404 page, identical for a token that
 * never existed, one that was revoked and one that was replaced. Nothing here distinguishes
 * them, so the URL cannot be probed.
 */
export default async function SharedWorkflowPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // Pattern first, so a malformed token costs no query — the invitation route's rule.
  if (!SHARE_TOKEN_PATTERN.test(token)) notFound();

  const row = await findSharedWorkflow(token);
  if (!row) notFound();

  const shared = shareWorkflow(row);
  const registry = describeNodes();
  const byType = new Map(registry.map((node) => [node.type, node]));

  const hidden = shared.graph.nodes.reduce((total, node) => total + node.redacted.length, 0);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-line bg-surface pad-safe flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b-2 px-4 py-3 sm:px-6">
        <Link href="/" className="shrink-0">
          <Wordmark />
        </Link>
        {/* **The title takes its own line on a phone.** Sharing a row with the wordmark and
            the badge left it about 90px wide at 375px, which truncated a real workflow name
            to two words and an ellipsis — on the one page a stranger sees, where the name is
            the first thing they need. Measured in a browser; it looked fine at 1440. */}
        <div className="min-w-0 flex-1 max-sm:order-last max-sm:basis-full">
          <h1 className="truncate text-lg font-bold tracking-tight">{shared.name}</h1>
          <p className="text-faint text-2xs">
            Version {shared.version} · updated {formatUtc(shared.updatedAt)}
          </p>
        </div>
        <Badge tone="pop" className="ml-auto shrink-0 sm:ml-0" icon="↗">
          shared read-only
        </Badge>
      </header>

      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {shared.description && (
          <p className="text-muted animate-rise mb-4 text-sm text-pretty">{shared.description}</p>
        )}

        {/* Stated before the diagram, not after it. A reader who scrolls past the canvas and
            stops has still been told what they are not seeing. */}
        <Card className="animate-rise mb-4 p-4">
          <h2 className="text-sm font-bold">What you are looking at</h2>
          <p className="text-muted mt-1 text-sm text-pretty">
            The <strong className="font-semibold">shape</strong> of a workflow built in
            AgentForge — its nodes, how they are wired, and each node&rsquo;s settings.{" "}
            <strong className="font-semibold">
              Every value its author typed in is withheld
            </strong>
            : no URLs, prompts, message bodies, email addresses or request headers.{" "}
            {hidden > 0 && (
              <>
                {hidden} value{hidden === 1 ? "" : "s"} {hidden === 1 ? "is" : "are"} hidden
                across {shared.graph.nodes.length} node
                {shared.graph.nodes.length === 1 ? "" : "s"}.{" "}
              </>
            )}
            Nothing here is live: no runs, no credentials, and nothing about the workspace it
            belongs to or who is in it.
          </p>
        </Card>

        {/* A fixed height rather than a viewport one: this page scrolls, and a canvas
            that owns the whole viewport would trap the wheel before the reader reached the
            node list under it. */}
        <div className="border-line bg-elevated animate-rise mb-4 h-[26rem] overflow-hidden rounded-2xl border-2 sm:h-[32rem]">
          <SharedCanvas graph={shared.graph} registry={registry} />
        </div>

        <h2 className="mb-2.5 text-base font-bold">
          {shared.graph.nodes.length} node{shared.graph.nodes.length === 1 ? "" : "s"}
        </h2>
        <ul className="space-y-2.5">
          {shared.graph.nodes.map((node) => (
            <NodeCard key={node.id} node={node} definition={byType.get(node.type)} />
          ))}
        </ul>

        <p className="text-faint mt-6 text-2xs text-pretty">
          Built with{" "}
          <Link href="/" className="font-semibold underline underline-offset-2">
            AgentForge
          </Link>{" "}
          — describe what you want in plain language and get a real, executable workflow.
        </p>
      </main>
    </div>
  );
}

/**
 * One node, as a card.
 *
 * The published settings are rendered generically from whatever survived redaction, so a
 * node type added in a later phase needs no change here — and, more importantly, this file
 * cannot accidentally publish a field the table withheld, because it never sees one.
 */
function NodeCard({
  node,
  definition,
}: {
  node: SharedNode;
  definition: { label: string; description: string; category: string } | undefined;
}) {
  const settings = Object.entries(node.config);

  return (
    <li className="card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <NodeIcon type={node.type} category={definition?.category} className="size-4 shrink-0" />
        <span className="text-sm font-bold">{node.label ?? definition?.label ?? node.type}</span>
        <code className="text-faint font-mono text-3xs">{node.type}</code>
        {node.redacted.length > 0 && (
          <Badge className="ml-auto shrink-0">
            {node.redacted.length} value{node.redacted.length === 1 ? "" : "s"} hidden
          </Badge>
        )}
      </div>

      {definition && (
        <p className="text-muted mt-1.5 text-xs leading-relaxed text-pretty">
          {definition.description}
        </p>
      )}

      {settings.length > 0 && (
        <dl className="mt-2.5 grid gap-x-4 gap-y-1 text-2xs sm:grid-cols-[auto_1fr]">
          {settings.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-ink font-semibold">{key}</dt>
              <dd className="text-muted font-mono break-words">{renderValue(value)}</dd>
            </div>
          ))}
        </dl>
      )}

      {node.redacted.length > 0 && (
        <p className="text-faint mt-2 text-3xs text-pretty">
          Withheld: {node.redacted.join(", ")}
        </p>
      )}
    </li>
  );
}

/**
 * A published setting, as text.
 *
 * `null` is what a redacted key inside an object field is, and it prints as a placeholder
 * rather than as the word "null" — the reader is being shown that a header exists and not
 * what is in it, and "null" reads as though the author left it empty.
 */
function renderValue(value: unknown): string {
  if (value === null) return "— hidden —";
  if (Array.isArray(value)) return value.length === 0 ? "—" : value.join(", ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, inner]) => `${key}: ${inner === null ? "— hidden —" : String(inner)}`)
      .join(", ");
  }
  return String(value);
}
