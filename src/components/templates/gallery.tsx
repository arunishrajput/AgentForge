"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api, ApiRequestError } from "@/lib/canvas/client";
import { categoryLook } from "@/lib/canvas/categories";
import type { NodeSummary } from "@/lib/canvas/client";
import type { TemplateSummary } from "@/lib/templates/catalogue";

/**
 * The template gallery — Phase 23A.
 *
 * **A client component around a server-rendered list.** The cards' content arrives as
 * props from the page, which read the catalogue directly; the only thing that needs the
 * browser is the button, which POSTs and then navigates. Rendering the list on the
 * client instead would mean an empty page followed by a fetch of data the server was
 * already holding.
 *
 * Each card says what the template *uses*, by node label and category colour, because
 * that is the honest preview: a gallery of names tells a reader nothing about whether a
 * template is three log nodes or a real integration, and the alternative — a thumbnail
 * of the graph — is a picture to keep in step with a graph that can change.
 */
export function TemplateGallery({
  templates,
  nodes,
  canUse,
}: {
  templates: TemplateSummary[];
  /** The registry, for turning a node type into its label and category. */
  nodes: NodeSummary[];
  /** `editor` and up. A viewer reads the gallery and cannot clone from it. */
  canUse: boolean;
}) {
  const byType = new Map(nodes.map((node) => [node.type, node]));

  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {templates.map((template, index) => (
        <TemplateCard
          key={template.id}
          template={template}
          byType={byType}
          canUse={canUse}
          index={index}
        />
      ))}
    </ul>
  );
}

function TemplateCard({
  template,
  byType,
  canUse,
  index,
}: {
  template: TemplateSummary;
  byType: Map<string, NodeSummary>;
  canUse: boolean;
  index: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  // Named `clone`, not `use`. React 19 has a `use()` hook and the hooks lint rule reads
  // any `use*` call inside a function as one — `api.useTemplate(...)` was a lint error
  // rather than a style question, and `clone` is the better word for it regardless.
  const clone = async () => {
    setBusy(true);
    try {
      const workflow = await api.cloneTemplate(template.id);
      // Straight onto the canvas. A template that clones and then leaves you on the
      // gallery makes you go and find what you just made.
      router.push(`/workflows/${workflow.id}`);
    } catch (caught) {
      toast({
        tone: "bad",
        title: "Could not use that template",
        detail:
          caught instanceof ApiRequestError ? caught.message : "Nothing was created. Try again.",
        duration: null,
      });
      setBusy(false);
    }
  };

  return (
    <li
      className="card animate-rise flex flex-col gap-3 p-4"
      // A short stagger so the grid arrives as a deal of cards rather than a flash.
      // Capped: past a handful the last card would wait long enough to feel broken.
      style={{ animationDelay: `${Math.min(index, 5) * 45}ms` }}
    >
      <div className="space-y-1.5">
        {/* **`h2`, not `h3` — WCAG 1.3.1, fixed in Phase 25.** The page's only other
            heading is its `h1`, so an `h3` here skipped a level and told a screen reader
            that every card was a subsection of a section that does not exist. It was
            `h3` because the card is visually small, which is a type-size decision and
            not a document-structure one. The convention the rest of the product already
            follows: a card directly under the page heading is an `h2`, and a subsection
            inside one is an `h3` — see every panel in `components/settings`. Found by
            `scripts/verify-a11y.mjs`. */}
        <h2 className="text-ink text-base leading-tight font-bold text-balance">
          {template.name}
        </h2>
        <p className="text-muted text-xs leading-relaxed text-pretty">{template.description}</p>
      </div>

      <p className="text-faint text-2xs leading-relaxed text-pretty">{template.about}</p>

      <ul className="flex flex-wrap gap-1" aria-label="Nodes this template uses">
        {template.uses.map((type) => {
          const definition = byType.get(type);
          const look = categoryLook(definition?.category);
          return (
            <li key={type}>
              <Badge>
                <span className={`size-1.5 shrink-0 rounded-full ${look.dot}`} aria-hidden="true" />
                {definition?.label ?? type}
              </Badge>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto flex items-center gap-2 pt-1">
        <Button tone="primary" loading={busy} disabled={!canUse} onClick={clone}>
          {busy ? "Creating…" : "Use this template"}
        </Button>
        <p className="text-faint text-3xs">
          {template.nodeCount} node{template.nodeCount === 1 ? "" : "s"}
        </p>
      </div>

      {template.requires.length > 0 && (
        // Stated on the card rather than discovered on the first failed run. It is not
        // a warning tone: needing a key is a normal fact about a template, not a fault.
        <p className="text-faint border-line-soft border-t pt-2 text-3xs text-pretty">
          <span className="font-bold tracking-wide uppercase">Needs. </span>
          {template.requires.join("; ")}
        </p>
      )}
    </li>
  );
}
