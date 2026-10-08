"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef } from "react";

import { Input, Labelled, Select } from "@/components/ui/field";
import { RUN_STATUSES, TRIGGER_KINDS } from "@/lib/engine/types";
import { runStatusLook } from "@/lib/canvas/status";
import { isFiltered, parseRunQuery, runQuerySearch, type RunQuery } from "@/lib/runs/query";
import { TRIGGER_WORDS } from "@/lib/runs/words";

/**
 * **The history's filters — Phase 33.** Status, trigger, workflow and a range of UTC days.
 *
 * **A real `GET` form**, so it works with no JavaScript at all: the browser builds the query
 * string from the fields' names and the server reads it (`parseRunQuery`). With JavaScript it
 * navigates as soon as a filter changes, rather than waiting for *Apply* — every change is a new
 * page from the server, because the history is paginated there (D150), and a filter change always
 * starts again from the newest run: the form carries no cursor. Enter applies too.
 *
 * Unlike the workflow list (D149) nothing is rewritten with `replaceState`: here a filter change
 * *is* a navigation, so it is `router.push`, and Back undoes it.
 */
export function RunFilters({
  query,
  workflows,
}: {
  query: RunQuery;
  workflows: { id: string; name: string }[];
}) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);

  const go = () => {
    if (!form.current) return;
    const data = new FormData(form.current);
    const params = new URLSearchParams();
    for (const [key, value] of data) if (typeof value === "string" && value !== "") params.set(key, value);
    router.push(`/runs${runQuerySearch(parseRunQuery(params))}`);
  };

  // The chosen workflow may have been deleted or hidden since the link was made; it still needs
  // an option, or the select would read "Any workflow" over a filtered list (`DESIGN.md` → Traps).
  const chosenMissing = query.workflowId !== null && !workflows.some((workflow) => workflow.id === query.workflowId);

  return (
    <form
      ref={form}
      method="get"
      action="/runs"
      aria-label="Filter runs"
      onChange={(event) => {
        // A date typed from the keyboard is a valid date at every digit of its year — 0002,
        // 0020, 0202, 2026 — and each would be a navigation. It applies once the year is one
        // this product could have run in; the picker, and clearing the field, apply at once.
        const field = event.target;
        if (field instanceof HTMLInputElement && field.type === "date" && field.value !== "" && field.value < "2000") return;
        go();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        go();
      }}
      className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto_auto] sm:items-end"
    >
      <Labelled label="Status">
        <Select name="status" defaultValue={query.status ?? ""}>
          <option value="">Any status</option>
          {RUN_STATUSES.map((status) => (
            <option key={status} value={status}>
              {runStatusLook(status).label}
            </option>
          ))}
        </Select>
      </Labelled>

      <Labelled label="Trigger">
        <Select name="trigger" defaultValue={query.trigger ?? ""}>
          <option value="">Any trigger</option>
          {TRIGGER_KINDS.map((trigger) => (
            <option key={trigger} value={trigger}>
              {TRIGGER_WORDS[trigger]}
            </option>
          ))}
        </Select>
      </Labelled>

      <Labelled label="Workflow" className="col-span-2 sm:col-span-1">
        <Select name="workflow" defaultValue={query.workflowId ?? ""}>
          <option value="">Any workflow</option>
          {chosenMissing && <option value={query.workflowId!}>A workflow you cannot see</option>}
          {workflows.map((workflow) => (
            <option key={workflow.id} value={workflow.id}>
              {workflow.name}
            </option>
          ))}
        </Select>
      </Labelled>

      <Labelled label={<>From <span className="text-faint text-2xs font-normal">UTC day</span></>}>
        <Input type="date" name="from" defaultValue={query.from ?? ""} max={query.to ?? undefined} />
      </Labelled>

      <Labelled label={<>To <span className="text-faint text-2xs font-normal">UTC, included</span></>}>
        <Input type="date" name="to" defaultValue={query.to ?? ""} min={query.from ?? undefined} />
      </Labelled>

      <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-5">
        {/* For a browser without JavaScript, which cannot submit on change. */}
        <noscript>
          <button type="submit" className="btn btn-quiet">
            Apply
          </button>
        </noscript>
        {isFiltered(query) && (
          <Link href="/runs" className="btn btn-ghost">
            Clear filters
          </Link>
        )}
      </div>
    </form>
  );
}
