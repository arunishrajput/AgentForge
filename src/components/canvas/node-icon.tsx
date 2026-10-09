import type { ReactNode } from "react";

import { cn } from "@/components/ui/cn";

/**
 * One icon per node, drawn here rather than installed.
 *
 * `BUILD_PLAN.md` Phase 16 asks for a node card with "a category colour, an icon and
 * a legible status". Twenty line drawings is not a dependency worth taking, and an
 * icon set would not be in this language anyway: every glyph below is stroked in
 * `currentColor` at the same weight as the UI's outlines, on the same 24-unit grid,
 * with round joins — so it sits on a `-pop` category strip as ink, like every other
 * mark in the system, and a token change carries it along.
 *
 * **The lookup is type first, category second, and that ordering is the contract.**
 * The registry is the spine of this product: a node type added in a later phase with
 * no entry here still draws its *category's* icon and still reads correctly, so the
 * palette and the canvas keep the property that adding a node to the registry needs
 * no UI change. A missing icon is a slightly less specific drawing, never a hole.
 *
 * `aria-hidden` throughout. Every icon sits beside the node's own label, and a node
 * announced as "envelope Send email" is worse than one announced as "Send email".
 */

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** By registry type. The specific drawing, where there is one worth having. */
const BY_TYPE: Record<string, ReactNode> = {
  // A filled triangle: the one icon that is a solid, because "start" is a button.
  "core.manual_trigger": (
    <path d="M8 4.8 19.2 12 8 19.2Z" fill="currentColor" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
  ),
  "core.webhook_trigger": <path d="M13.2 2.2 5 13.6h5.6L9.4 21.8 18 10.4h-5.6z" {...STROKE} />,
  "core.schedule_trigger": (
    <>
      <circle cx="12" cy="12" r="8.6" {...STROKE} />
      <path d="M12 6.8V12l3.6 2.6" {...STROKE} />
    </>
  ),
  // Phase 37. A warning sign: it starts when something somewhere else went wrong. The category's
  // circled play — what it drew before — read as a second Manual trigger in the palette.
  "core.error_trigger": (
    <>
      <path d="M12 3.4 21.2 19.6H2.8Z" {...STROKE} />
      <path d="M12 9.4v4.6M12 16.9v.1" {...STROKE} />
    </>
  ),

  "ai.llm": (
    <>
      <path d="M4 6.4A2.4 2.4 0 0 1 6.4 4h11.2A2.4 2.4 0 0 1 20 6.4v6.4a2.4 2.4 0 0 1-2.4 2.4h-5.2L7.6 19.6V15.2H6.4A2.4 2.4 0 0 1 4 12.8z" {...STROKE} />
      <path d="M9 9.6h6" {...STROKE} />
    </>
  ),
  // The four-point sparkle: the one glyph a reader already parses as "it reasons".
  "ai.agent": (
    <>
      <path d="M10.4 2.8c.8 4.4 1.9 5.5 6.3 6.3-4.4.8-5.5 1.9-6.3 6.3-.8-4.4-1.9-5.5-6.3-6.3 4.4-.8 5.5-1.9 6.3-6.3z" {...STROKE} />
      <path d="M17.6 14.4c.35 1.9.85 2.4 2.75 2.75-1.9.35-2.4.85-2.75 2.75-.35-1.9-.85-2.4-2.75-2.75 1.9-.35 2.4-.85 2.75-2.75z" {...STROKE} />
    </>
  ),

  "core.branch": <path d="M3 12h6l4.4-5.6h7.6M9 12l4.4 5.6h7.6" {...STROKE} />,
  "core.loop": (
    <>
      <path d="M20.4 12a8.4 8.4 0 1 1-2.46-5.94" {...STROKE} />
      <path d="M13.6 5.2h5v-5" transform="translate(-0.6 1)" {...STROKE} />
    </>
  ),
  "core.delay": <path d="M7 3.4h10M7 20.6h10M17 3.4v3.2l-5 5.4 5 5.4v3.2M7 3.4v3.2l5 5.4-5 5.4v3.2" {...STROKE} />,
  // Phase 38. A person and a tick: it waits on somebody's yes. Without it the approval would draw the
  // logic category's mark beside Branch and Assert — three guards that look alike.
  "core.approval": (
    <>
      <circle cx="9" cy="7.8" r="3.4" {...STROKE} />
      <path d="M2.8 20.4c0-3.6 2.8-6.2 6.2-6.2s6.2 2.6 6.2 6.2M15.6 9.4l2.2 2.2 4-4.4" {...STROKE} />
    </>
  ),
  "core.assert": (
    <>
      <path d="M12 2.8 20 5.8v5.9c0 4.5-3.3 7.7-8 9.5-4.7-1.8-8-5-8-9.5V5.8z" {...STROKE} />
      <path d="M8.6 11.8l2.6 2.6 4.4-4.8" {...STROKE} />
    </>
  ),

  "core.set": (
    <path d="M9.6 3.6H8.2a2 2 0 0 0-2 2v3.9a2.5 2.5 0 0 1-2.5 2.5 2.5 2.5 0 0 1 2.5 2.5v3.9a2 2 0 0 0 2 2h1.4M14.4 3.6h1.4a2 2 0 0 1 2 2v3.9a2.5 2.5 0 0 0 2.5 2.5 2.5 2.5 0 0 0-2.5 2.5v3.9a2 2 0 0 1-2 2h-1.4" {...STROKE} />
  ),
  "core.log": <path d="M4 6.6h16M4 12h11.5M4 17.4h7.5" {...STROKE} />,

  "integration.http": (
    <>
      <circle cx="12" cy="12" r="8.8" {...STROKE} />
      <path d="M3.2 12h17.6M12 3.2c2.9 3.5 2.9 14.1 0 17.6M12 3.2c-2.9 3.5-2.9 14.1 0 17.6" {...STROKE} />
    </>
  ),
  // A channel, which is how a Discord destination is actually written: #general.
  "integration.discord": <path d="M10.4 3.4 8.2 20.6M16.4 3.4l-2.2 17.2M4.4 9h15.2M3.4 15h15.2" {...STROKE} />,
  "integration.sheets": (
    <path d="M4 4.8h16v14.4H4zM4 10h16M4 15h16M10 4.8v14.4" {...STROKE} />
  ),
  "integration.gmail": <path d="M3.2 6h17.6v12H3.2zM3.2 6 12 13 20.8 6" {...STROKE} />,
};

/**
 * By category. The fallback, and the reason an unregistered icon is never a hole.
 * Each is the plainest possible reading of its group.
 */
const BY_CATEGORY: Record<string, ReactNode> = {
  trigger: (
    <>
      <circle cx="12" cy="12" r="8.8" {...STROKE} />
      <path d="M10 8.4 16 12l-6 3.6Z" fill="currentColor" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" />
    </>
  ),
  agent: (
    <path d="M12 2.8c.9 4.9 2.1 6.1 7 7-4.9.9-6.1 2.1-7 7-.9-4.9-2.1-6.1-7-7 4.9-.9 6.1-2.1 7-7z" {...STROKE} />
  ),
  logic: <path d="M3 12h6l4.4-5.6h7.6M9 12l4.4 5.6h7.6" {...STROKE} />,
  transform: <path d="M4 8.4h13M14.2 5.6 17 8.4l-2.8 2.8M20 15.6H7M9.8 12.8 7 15.6l2.8 2.8" {...STROKE} />,
  integration: (
    <path d="M9 3v5.6M15 3v5.6M6 8.6h12v1.8a6 6 0 0 1-12 0zM12 16.4V21" {...STROKE} />
  ),
};

/** Nothing matched — not even the category. A plain block: a node, unelaborated. */
const GENERIC: ReactNode = <path d="M5 6.4h14v11.2H5z" {...STROKE} />;

export function NodeIcon({
  type,
  category,
  className,
}: {
  type: string;
  category?: string;
  className?: string;
}) {
  const glyph =
    BY_TYPE[type] ??
    (category === undefined ? undefined : BY_CATEGORY[category]) ??
    GENERIC;

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("shrink-0", className)}>
      {glyph}
    </svg>
  );
}
