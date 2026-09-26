import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";

/**
 * The demonstration on the landing page.
 *
 * `BUILD_PLAN.md` Phase 15 asks the landing page for "a visible demonstration", and
 * this is it: the sentence a user types, the workflow that comes back, and the run
 * that follows — in that order, because that is the order the product happens in.
 *
 * It is **built from the product's own language rather than captured from it**. Every
 * card here is the real `card` utility, every colour is the real category token, and
 * the whole thing is text, so it is sharp on any display, readable by a screen
 * reader, translatable, and — the part that matters over a year — it cannot go stale
 * the way a PNG of a UI goes stale. The content is illustrative and the caption says
 * so; the *form* is not an illustration of anything.
 *
 * No client JavaScript. The stagger is `animate-rise` with an inline delay, which
 * `prefers-reduced-motion` collapses to nothing in one place.
 */

const CATEGORY_FILL = {
  trigger: "bg-cat-trigger-pop",
  agent: "bg-cat-agent-pop",
  logic: "bg-cat-logic-pop",
  transform: "bg-cat-transform-pop",
  integration: "bg-cat-integration-pop",
} as const;

type Category = keyof typeof CATEGORY_FILL;

const PROMPT =
  "When a support message arrives, summarise it, decide whether it is urgent, " +
  "and post the urgent ones to Discord.";

function Node({
  category,
  label,
  type,
  detail,
  status,
  delay,
  className,
}: {
  category: Category;
  label: string;
  type: string;
  detail: string;
  status: ReactNode;
  delay: number;
  className?: string;
}) {
  return (
    <div
      style={{ animationDelay: `${delay}ms` }}
      className={cn("card-raised animate-rise w-full min-w-0 overflow-hidden", className)}
    >
      <div
        className={cn(
          "border-line flex items-center justify-between gap-2 border-b-2 px-3 py-1.5",
          CATEGORY_FILL[category],
        )}
      >
        <span className="text-ink text-3xs font-bold tracking-wide uppercase">{category}</span>
        {status}
      </div>
      <div className="space-y-1 px-3 py-2.5">
        <p className="text-ui leading-tight font-bold">{label}</p>
        <p className="text-faint font-mono text-3xs">{type}</p>
        <p className="text-muted text-2xs text-pretty">{detail}</p>
      </div>
    </div>
  );
}

/** ✓ and ▶ carry the status alongside the word, never instead of it. */
function Done() {
  return (
    <Badge className="border-line bg-surface">
      <span aria-hidden="true">✓</span> done
    </Badge>
  );
}

function Running() {
  return (
    <Badge className="border-line bg-surface">
      <span aria-hidden="true" className="animate-breathe">
        ▶
      </span>{" "}
      running
    </Badge>
  );
}

/**
 * The line between two nodes. Horizontal from `md` up, where the graph runs left to
 * right; vertical below it, where it stacks. `aria-hidden`, because the reading
 * order of the cards already states the sequence — an arrow announced between every
 * pair would be five extra words saying "then".
 */
function Link() {
  return (
    <div
      aria-hidden="true"
      className="text-ink flex shrink-0 flex-col items-center justify-center py-1 leading-none md:w-7 md:flex-row md:py-0"
    >
      <span className="bg-ink h-4 w-0.5 md:h-0.5 md:w-full" />
      <span className="text-3xs md:hidden">▼</span>
      <span className="text-3xs hidden md:inline">▶</span>
    </div>
  );
}

export function Demo() {
  return (
    <figure className="m-0">
      {/* 1 — the sentence. Rendered as the real prompt box, because that is where a
          user actually types it. */}
      <div className="card animate-rise mx-auto max-w-2xl p-4 sm:p-5">
        <p className="eyebrow">You type</p>
        <p className="mt-2 text-base font-semibold text-pretty sm:text-lg">“{PROMPT}”</p>
        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <span className="btn btn-primary pointer-events-none">Generate workflow</span>
          <span className="text-faint text-2xs">⌘↵</span>
        </div>
      </div>

      <p aria-hidden="true" className="text-faint py-3 text-center text-lg">
        ↓
      </p>

      {/* 2 — the workflow. The dot grid is the canvas's own background. */}
      <div className="card dotted overflow-hidden p-4 sm:p-6">
        <p className="eyebrow mb-4">AgentForge builds</p>

        <div className="flex flex-col items-stretch gap-0 md:flex-row md:items-center">
          <Node
            category="trigger"
            label="Webhook trigger"
            type="core.webhook_trigger"
            detail="An unguessable URL. Posting to it starts a run."
            status={<Done />}
            delay={0}
            className="md:w-48"
          />
          <Link />
          <Node
            category="agent"
            label="Summarise the message"
            type="ai.llm"
            detail="One model call. Output feeds the node after it."
            status={<Done />}
            delay={80}
            className="md:w-48"
          />
          <Link />
          <Node
            category="agent"
            label="Decide if it is urgent"
            type="ai.agent"
            detail="Reads the summary, calls tools, picks a branch."
            status={<Running />}
            delay={160}
            className="md:w-48"
          />
          <Link />

          {/* The fork. Each branch carries its own output label, which is what the
              canvas does — an edge leaving a branch node is named, not guessed. */}
          <div className="flex flex-col gap-3 md:w-48">
            <div className="flex items-center gap-2">
              <span className="chip bg-surface shrink-0">true</span>
              <Node
                category="integration"
                label="Post to Discord"
                type="integration.discord"
                detail="Your webhook, encrypted at rest."
                status={<Badge className="border-line bg-surface">queued</Badge>}
                delay={240}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="chip bg-surface shrink-0">false</span>
              <Node
                category="logic"
                label="Log and stop"
                type="core.log"
                detail="Nothing urgent. The run ends here."
                status={<Badge className="border-line bg-surface">skipped</Badge>}
                delay={280}
              />
            </div>
          </div>
        </div>
      </div>

      <p aria-hidden="true" className="text-faint py-3 text-center text-lg">
        ↓
      </p>

      {/* 3 — the run. Monospaced, because a log is a log. */}
      <div className="card overflow-hidden">
        <div className="border-line bg-surface flex flex-wrap items-center justify-between gap-2 border-b-2 px-4 py-2.5">
          <p className="eyebrow">Then it runs, and you watch</p>
          <Badge tone="pop" className="bg-live-pop">
            <span aria-hidden="true" className="animate-breathe">
              ●
            </span>{" "}
            live
          </Badge>
        </div>
        <ul className="bg-sunken divide-line-soft divide-y font-mono text-2xs">
          {[
            ["09:41:02", "core.webhook_trigger", "started · payload accepted"],
            ["09:41:02", "ai.llm", "done · 1.2 s · summary produced"],
            ["09:41:03", "ai.agent", "tool call → core.log"],
            ["09:41:04", "ai.agent", "chose branch true · “billing outage, customer blocked”"],
            ["09:41:04", "integration.discord", "queued"],
          ].map(([at, node, message]) => (
            <li key={`${at}-${node}-${message}`} className="flex flex-wrap gap-x-3 px-4 py-1.5">
              <span className="text-faint">{at}</span>
              <span className="text-accent">{node}</span>
              <span className="text-muted min-w-0 flex-1">{message}</span>
            </li>
          ))}
        </ul>
      </div>

      <figcaption className="text-faint mt-3 text-center text-2xs text-pretty">
        An illustrated example. The node cards, categories, statuses and log lines are the
        product&rsquo;s own components and tokens — the message is made up.
      </figcaption>
    </figure>
  );
}
