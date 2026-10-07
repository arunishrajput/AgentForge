"use client";

import type { NodeSummary } from "@/lib/canvas/client";

/**
 * What a node is, in the panel where somebody has just selected one — Phase 23A.
 *
 * Two registers, deliberately separated:
 *
 *  - **The lead paragraph** is `docs.summary` when the node has one and `description`
 *    when it does not. They are written for different readers — `description` is read
 *    verbatim by the model and is terse and imperative because that is what makes a
 *    tool callable — and a node that has both shows the human one here.
 *  - **Everything else is behind a disclosure**, closed by default. The panel is 320 px
 *    wide and the form underneath it is what the user came for; three worked examples
 *    permanently above the first field would push the configuration below the fold on a
 *    laptop. `<details>` rather than state because it needs no JavaScript, it is
 *    keyboard-operable and screen-reader-announced for free, and the browser's own
 *    find-in-page opens it.
 */
export function NodeDocs({ definition }: { definition: NodeSummary }) {
  const docs = definition.docs;
  const lead = docs?.summary ?? definition.description;
  // With nothing to expand, the disclosure would be a control that reveals an empty
  // box — worse than no control.
  const hasDetail = Boolean(docs?.accepts || docs?.examples?.length || definition.outputShape);

  return (
    <div className="space-y-2">
      <p className="text-muted text-xs leading-relaxed text-pretty">{lead}</p>

      {hasDetail && (
        <details className="group border-line-soft rounded-lg border">
          <summary
            className={[
              "text-faint flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5",
              "text-3xs font-bold tracking-wide uppercase select-none",
              "hover:text-ink rounded-lg",
            ].join(" ")}
          >
            {/* `list-none` plus an own marker: the default triangle is the one piece of
                native chrome in this panel that cannot be styled consistently across
                browsers, and a rotating caret matches the springy register. */}
            <svg
              viewBox="0 0 8 8"
              aria-hidden="true"
              className="size-2 transition-transform duration-150 group-open:rotate-90"
            >
              <path d="M2 1 L6 4 L2 7 Z" fill="currentColor" />
            </svg>
            How to use this
          </summary>

          <div className="border-line-soft space-y-2.5 border-t px-2 py-2">
            {docs?.accepts && (
              <Line term="Takes">{docs.accepts}</Line>
            )}

            {definition.outputShape && (
              <Line term="Gives back">{definition.outputShape}</Line>
            )}

            {docs?.examples && docs.examples.length > 0 && (
              <div className="space-y-1.5">
                <h4 className="text-faint text-3xs font-bold tracking-wide uppercase">
                  Examples
                </h4>
                <ul className="space-y-1.5">
                  {docs.examples.map((example) => (
                    <li key={example.title} className="space-y-0.5">
                      <p className="text-ink text-2xs font-semibold text-pretty">
                        {example.title}
                      </p>
                      {/* `break-words` because an example body is often a `{{ }}`
                          reference with no spaces in it, and one long token in a 320 px
                          panel is a horizontal scrollbar on the whole inspector. */}
                      <p className="bg-sunken text-muted rounded px-1.5 py-1 font-mono text-3xs leading-relaxed break-words">
                        {example.body}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

function Line({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <p className="text-muted text-2xs leading-relaxed text-pretty">
      <span className="text-faint font-bold tracking-wide uppercase">{term}. </span>
      {children}
    </p>
  );
}
