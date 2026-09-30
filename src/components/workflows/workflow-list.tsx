"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Dialog } from "@/components/ui/dialog";
import { Labelled, Input, Select } from "@/components/ui/field";
import { EmptyState, QuietArt, WorkbenchArt } from "@/components/ui/illustration";
import { Menu } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/canvas/client";
import { formatDayUtc } from "@/lib/format/date";
import {
  DEFAULT_VIEW,
  countWorkflows,
  isDefaultView,
  viewWorkflows,
  type ListView,
  type SortKey,
  type StatusKey,
  type TriggerKey,
  type WorkflowCard,
} from "@/lib/workflow/list";

/**
 * The workflow list.
 *
 * Search, filter and sort all happen in the browser against the whole list, which
 * the server has already sent. That is the right trade at this size: a user's own
 * workflows are a short owner-scoped list, and a round trip per keystroke would make
 * the search feel worse while costing Neon compute the project does not have to
 * spare (CLAUDE.md → cost rules). If a single account ever holds enough workflows
 * for this to matter, the fix is pagination on the server, not a debounce here.
 *
 * The matching itself is in `src/lib/workflow/list.ts`, with tests. This file is the
 * controls and the rows.
 */
export function WorkflowList({
  cards,
  canEdit,
}: {
  cards: WorkflowCard[];
  /**
   * The viewer's role carries editing — **Phase 20**. Deleting is a write the API refuses
   * below `editor`, and the empty state's call to action is an invitation to generate a
   * workflow, which is also a write. Both go for a viewer, who gets copy that says what
   * they are looking at instead.
   */
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  const [view, setView] = useState<ListView>(DEFAULT_VIEW);
  const [pendingDelete, setPendingDelete] = useState<WorkflowCard | null>(null);
  const [deleting, setDeleting] = useState(false);

  const counts = useMemo(() => countWorkflows(cards), [cards]);
  const visible = useMemo(() => viewWorkflows(cards, view), [cards, view]);
  const narrowed = !isDefaultView(view);

  const update = (patch: Partial<ListView>) => setView((current) => ({ ...current, ...patch }));

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.deleteWorkflow(pendingDelete.id);
      toast({
        tone: "ok",
        title: `Deleted “${pendingDelete.name}”`,
        detail: "Its run history went with it.",
      });
      setPendingDelete(null);
      router.refresh();
    } catch {
      toast({
        tone: "bad",
        title: "Could not delete that workflow",
        detail: "It is still in your list. Try again.",
        duration: null,
      });
    } finally {
      setDeleting(false);
    }
  };

  // Nothing has ever been built. A different situation from "nothing matches", and
  // it gets the illustration and the encouragement rather than a clear-filters link.
  if (cards.length === 0) {
    return (
      <EmptyState
        level={2}
        art={<WorkbenchArt />}
        title={canEdit ? "Nothing built yet" : "Nothing to see here yet"}
        description={
          canEdit
            ? "Describe what you want in the box above and AgentForge will build it — or open a template and edit a workflow that already runs."
            : "Nobody in this workspace has built a workflow yet — or the ones here are private to the people who made them. Ask an admin for the editor role if you need to build one."
        }
        action={
          // An empty state whose call to action is refused is worse than one with none.
          //
          // Two actions, not one — Phase 23A. "Describe your first workflow" asks a
          // person with nothing on screen to think of something, which is the blank-page
          // problem the generator was supposed to solve and does not: the box is still
          // empty. A template is the answer that requires no idea, so it sits beside the
          // primary action rather than being hidden behind a nav link.
          canEdit ? (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <a href="#generate-prompt" className="btn btn-primary">
                Describe your first workflow
              </a>
              <Link href="/templates" className="btn btn-ghost">
                Or start from a template
              </Link>
            </div>
          ) : undefined
        }
      />
    );
  }

  return (
    <>
      <div className="card animate-rise mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Labelled label="Search" className="min-w-52 flex-1">
            <Input
              type="search"
              value={view.query}
              onChange={(event) => update({ query: event.target.value })}
              placeholder="Name, description, or a node it uses…"
            />
          </Labelled>
          <Labelled label="Sort" className="w-48">
            <Select
              value={view.sort}
              onChange={(event) => update({ sort: event.target.value as SortKey })}
            >
              <option value="recent">Recently updated</option>
              <option value="created">Recently created</option>
              <option value="name">Name</option>
            </Select>
          </Labelled>
        </div>

        <div className="mt-3.5 flex flex-wrap items-center gap-x-5 gap-y-2.5">
          <Filters
            label="Status"
            value={view.status}
            onChange={(status) => update({ status })}
            options={[
              { value: "all", label: "All", count: counts.total },
              { value: "runnable", label: "Runnable", count: counts.runnable },
              { value: "problems", label: "Needs attention", count: counts.problems },
            ]}
          />
          <Filters
            label="Trigger"
            value={view.trigger}
            onChange={(trigger) => update({ trigger })}
            options={[
              { value: "all", label: "Any", count: counts.total },
              { value: "manual", label: "Manual", count: counts.manual },
              { value: "webhook", label: "Webhook", count: counts.webhook },
              { value: "schedule", label: "Schedule", count: counts.schedule },
            ]}
          />
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-muted text-2xs" role="status">
          Showing {visible.length} of {cards.length} workflow{cards.length === 1 ? "" : "s"}
        </p>
        {narrowed && (
          <Button tone="ghost" size="sm" onClick={() => setView({ ...DEFAULT_VIEW, sort: view.sort })}>
            Clear filters
          </Button>
        )}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          level={2}
          art={<QuietArt />}
          title="Nothing matches that"
          description="No workflow in your list matches the search and filters you have set."
          action={
            <Button tone="primary" onClick={() => setView({ ...DEFAULT_VIEW, sort: view.sort })}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <ul className="space-y-2.5">
          {visible.map((card, index) => (
            <Row
              key={card.id}
              card={card}
              delay={Math.min(index * 40, 280)}
              canEdit={canEdit}
              onDelete={() => setPendingDelete(card)}
            />
          ))}
        </ul>
      )}

      {/* Kept mounted so the native `<dialog>` can be closed by the effect inside it
          rather than by being torn out of the DOM. The title is guarded because the
          card is cleared the moment it closes, and an ungated template literal
          renders "Delete “undefined”?" for the frame in between. */}
      <Dialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title={pendingDelete ? `Delete “${pendingDelete.name}”?` : "Delete workflow?"}
        description="This also deletes every run it has recorded. It cannot be undone."
        footer={
          <>
            <Button onClick={() => setPendingDelete(null)}>Keep it</Button>
            <Button tone="danger" loading={deleting} onClick={confirmDelete}>
              {deleting ? "Deleting…" : "Delete workflow"}
            </Button>
          </>
        }
      />
    </>
  );
}

function Row({
  card,
  delay,
  canEdit,
  onDelete,
}: {
  card: WorkflowCard;
  delay: number;
  canEdit: boolean;
  onDelete: () => void;
}) {
  const router = useRouter();

  return (
    <li
      style={{ animationDelay: `${delay}ms` }}
      className="card animate-rise flex items-start gap-3 p-4"
    >
      <div className="min-w-0 flex-1">
        <Link
          href={`/workflows/${card.id}`}
          className="text-base font-bold hover:underline hover:underline-offset-4"
        >
          {card.name}
        </Link>
        {card.description && (
          <p className="text-muted mt-0.5 line-clamp-2 text-sm text-pretty">{card.description}</p>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {card.runnable ? (
            <Badge className="text-ok">
              <span aria-hidden="true">✓</span> runnable
            </Badge>
          ) : (
            <Badge className="text-warn">
              <span aria-hidden="true">▲</span> {card.problemCount} problem
              {card.problemCount === 1 ? "" : "s"}
            </Badge>
          )}
          <Badge>
            {card.nodeCount} node{card.nodeCount === 1 ? "" : "s"}
          </Badge>
          {card.triggers.map((trigger) => (
            <Badge key={trigger}>{trigger}</Badge>
          ))}
          {card.scheduleCron && <Badge className="font-mono">{card.scheduleCron}</Badge>}
          {/* **Both of these have to be visible from the list** (Phase 20). A workflow that
              is private, or one that anybody with a URL can read, is a fact about it as
              important as whether it runs — and the list is where somebody scanning their
              workspace would expect to find out, not a dialog two clicks in. */}
          {card.visibility === "private" && (
            <Badge tone="pop" icon="●">
              private
            </Badge>
          )}
          {card.shared && (
            <Badge tone="pop" icon="↗">
              public link
            </Badge>
          )}
        </div>

        <p className="text-faint mt-2 text-2xs">
          Updated {formatDayUtc(card.updatedAt)}
          {card.nodeLabels.length > 0 && (
            <span className="text-faint"> · {card.nodeLabels.slice(0, 3).join(", ")}</span>
          )}
          {card.nodeLabels.length > 3 && <span> +{card.nodeLabels.length - 3} more</span>}
        </p>
      </div>

      <Menu
        align="end"
        className="shrink-0"
        label={
          <>
            <span aria-hidden="true">⋯</span>
            <span className="sr-only">Actions for {card.name}</span>
          </>
        }
        items={[
          {
            id: "open",
            label: "Open on the canvas",
            onSelect: () => router.push(`/workflows/${card.id}`),
          },
          ...(canEdit
            ? [{ id: "delete", label: "Delete", tone: "danger" as const, onSelect: onDelete }]
            : []),
        ]}
      />
    </li>
  );
}

/**
 * A set of filter buttons. Buttons rather than a `<select>` because the counts are
 * worth showing and because one tap changes the list; `aria-pressed` is what makes a
 * toggle button announce as one, and the pressed button also sits pressed IN, so the
 * state is never carried by colour alone.
 */
function Filters<T extends StatusKey | TriggerKey>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; count: number }[];
}) {
  return (
    <div role="group" aria-label={`Filter by ${label.toLowerCase()}`} className="flex flex-wrap items-center gap-1.5">
      <span className="eyebrow">{label}</span>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "btn px-2.5 py-1 text-2xs",
              active
                ? "btn-primary translate-x-[2px] translate-y-[2px] shadow-(--shadow-press)"
                : "btn-quiet",
            )}
          >
            {option.label}
            <span className={cn("text-3xs", active ? "text-ink/70" : "text-faint")}>
              {option.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
