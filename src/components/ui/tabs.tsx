"use client";

import { type ReactNode, useId, useRef, useState } from "react";

import { cn } from "./cn";

/**
 * Tabs, with the keyboard behaviour the ARIA pattern actually specifies.
 *
 * The part everyone skips is the roving tabindex: in a correct tablist exactly ONE
 * tab is in the document tab order, and Left/Right move between tabs without Tab
 * ever landing on them. A tablist where every tab is tabbable means a keyboard user
 * has to press Tab five times to reach the panel, which is why the pattern exists.
 *
 * Also handled: Home and End, `aria-selected`, and the two-way `aria-controls` /
 * `aria-labelledby` link between a tab and its panel. Activation is on selection
 * (automatic), which is correct when switching panels is cheap — and it is here,
 * because every panel is already rendered.
 */
export type Tab = { id: string; label: ReactNode; content: ReactNode };

export function Tabs({
  tabs,
  className,
  initial = 0,
}: {
  tabs: Tab[];
  className?: string;
  initial?: number;
}) {
  const base = useId();
  const [active, setActive] = useState(initial);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (to: number) => {
    const index = (to + tabs.length) % tabs.length;
    setActive(index);
    refs.current[index]?.focus();
  };

  return (
    <div className={className}>
      <div role="tablist" className="flex flex-wrap gap-1.5">
        {tabs.map((tab, index) => {
          const selected = index === active;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                refs.current[index] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${tab.id}`}
              // The roving tabindex.
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(index)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") move(index + 1);
                else if (event.key === "ArrowLeft") move(index - 1);
                else if (event.key === "Home") move(0);
                else if (event.key === "End") move(tabs.length - 1);
                else return;
                event.preventDefault();
              }}
              className={cn(
                "btn",
                selected ? "btn-primary" : "btn-quiet",
                // The selected tab is pressed IN — it has already been clicked, so
                // it sits where a pressed object sits. The state is in the colour
                // and the position, never in the colour alone.
                selected && "translate-x-[2px] translate-y-[2px] shadow-(--shadow-press)",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {tabs.map((tab, index) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${base}-panel-${tab.id}`}
          aria-labelledby={`${base}-tab-${tab.id}`}
          hidden={index !== active}
          // A panel with no focusable child must be focusable itself, or Tab from
          // the tablist leaves the widget entirely.
          tabIndex={0}
          className="animate-fade mt-4"
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
