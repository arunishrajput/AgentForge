"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Dialog } from "@/components/ui/dialog";
import { Labelled, Input, Select } from "@/components/ui/field";
import { EmptyState, QuietArt, WorkbenchArt } from "@/components/ui/illustration";
import { Menu } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { ApiRequestError, api, type TagSummary } from "@/lib/canvas/client";
import { formatDayUtc } from "@/lib/format/date";
import { replaceAddress } from "@/lib/ui/url";
import {
  DEFAULT_VIEW,
  MISSING_TAG,
  TRIGGER_NAMES,
  countTags,
  countWorkflows,
  isDefaultView,
  resolveViewTag,
  tagSelectValue,
  viewAfterTagChange,
  viewHref,
  viewWorkflows,
  type ListView,
  type SortKey,
  type StatusKey,
  type TriggerKey,
  type WorkflowCard,
} from "@/lib/workflow/list";
import { sameTagName, sortTags } from "@/lib/workflow/tags";

import {
  ExportDialog,
  ManageTagsDialog,
  WorkflowTagsDialog,
  downloadExport,
  type TagChange,
} from "./library-dialogs";

/**
 * Put the view in the address bar, unless it is already there. Replace, never push — and through
 * `replaceAddress`, which passes the null state Next's router needs to follow the change.
 */
function writeViewToUrl(view: ListView) {
  replaceAddress(viewHref(window.location.pathname, window.location.hash, view));
}

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
 *
 * **Phase 32 made it a library**: a star on every card, the tags each wears, a *Starred* and a
 * tag filter, and *Tags…*, *Duplicate* and *Export* on each row. **The view lives in the URL** —
 * the page parses it on the server (`parseView`) and this component writes it back with
 * `history.replaceState` as it changes, which Next's router follows — so a filtered list is a
 * link, and survives a reload. Replace, not push: a keystroke in the search box is not a page
 * somebody wants Back to step through.
 */
export function WorkflowList({
  cards,
  tags,
  initialView,
  canEdit,
}: {
  cards: WorkflowCard[];
  /** The workspace's tags — the filter's vocabulary, including a tag nothing wears yet. */
  tags: TagSummary[];
  /** The view the URL asked for, parsed on the server. */
  initialView: ListView;
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

  const [view, setView] = useState<ListView>(initialView);
  const [pendingDelete, setPendingDelete] = useState<WorkflowCard | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [tagging, setTagging] = useState<WorkflowCard | null>(null);
  const [exporting, setExporting] = useState<WorkflowCard | null>(null);
  const [managingTags, setManagingTags] = useState(false);
  /**
   * A star shows the moment it is pressed. The server's answer is the truth and arrives with
   * the next read of the list; until then this holds what was pressed, by workflow id.
   */
  const [stars, setStars] = useState<Map<string, boolean>>(new Map());

  const starredCards = useMemo(
    () =>
      stars.size === 0
        ? cards
        : cards.map((card) => (stars.has(card.id) ? { ...card, starred: stars.get(card.id) === true } : card)),
    [cards, stars],
  );
  const counts = useMemo(() => countWorkflows(starredCards), [starredCards]);
  const tagCounts = useMemo(() => countTags(starredCards), [starredCards]);
  const visible = useMemo(() => viewWorkflows(starredCards, view), [starredCards, view]);
  const narrowed = !isDefaultView(view);
  const { missing: missingTag } = resolveViewTag(view, tags);
  const sortedTags = useMemo(() => sortTags(tags), [tags]);

  const update = (patch: Partial<ListView>) => setView((current) => ({ ...current, ...patch }));

  // The view, written to the address bar as it changes.
  useEffect(() => writeViewToUrl(view), [view]);

  const toggleStar = async (card: WorkflowCard) => {
    const starred = !card.starred;
    setStars((current) => new Map(current).set(card.id, starred));
    try {
      await api.starWorkflow(card.id, starred);
    } catch {
      setStars((current) => new Map(current).set(card.id, !starred));
      toast({
        tone: "bad",
        title: starred ? `Could not star “${card.name}”` : `Could not unstar “${card.name}”`,
        detail: "Nothing changed. Try again.",
        duration: null,
      });
    }
  };

  const duplicate = async (card: WorkflowCard) => {
    try {
      const copy = await api.duplicateWorkflow(card.id);
      const off = !copy.active && (copy.scheduleCron !== null || copy.webhookUrl !== null || copy.formUrl !== null);
      toast({
        tone: "ok",
        title: `Duplicated as “${copy.name}”`,
        detail: off
          ? "This is the copy. It is switched off, so its trigger will not run it until you switch it on."
          : "This is the copy. The original is unchanged.",
      });
      router.push(`/workflows/${copy.id}`);
    } catch (caught) {
      toast({
        tone: "bad",
        title: `Could not duplicate “${card.name}”`,
        detail: caught instanceof ApiRequestError ? caught.message : "Nothing was created. Try again.",
        duration: null,
      });
    }
  };

  // Asked only when the workflow holds a pin; otherwise there is nothing to decide (D146).
  const exportCard = async (card: WorkflowCard) => {
    if (card.pinnedCount > 0) {
      setExporting(card);
      return;
    }
    try {
      await downloadExport(card, false);
      toast({ tone: "ok", title: `Exported “${card.name}”` });
    } catch (caught) {
      toast({
        tone: "bad",
        title: "Could not export that workflow",
        detail: caught instanceof ApiRequestError ? caught.message : "Nothing was downloaded. Try again.",
        duration: null,
      });
    }
  };

  // A rename or a delete of the tag the list is filtered by moves the filter with it — and the
  // address with it, written before the refresh is asked for so the router's queue sees the new
  // address first (`lib/ui/url.ts` has the bug this guards against).
  const onTagChanged = (change: TagChange) => {
    const next = viewAfterTagChange(view, change);
    if (next !== view) {
      setView(next);
      writeViewToUrl(next);
    }
    router.refresh();
  };

  const filterByTag = (tag: TagSummary) => update({ tag: tag.name });

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
              // Phase 40. Like On failure, offered once there is a form to find.
              ...(counts.form > 0 || view.trigger === "form"
                ? [{ value: "form" as const, label: "Form", count: counts.form }]
                : []),
              { value: "schedule", label: "Schedule", count: counts.schedule },
              // Phase 37. Offered once there is an error workflow to find, or while it is the
              // filter — a fifth chip that always reads 0 is noise for most workspaces.
              ...(counts.error > 0 || view.trigger === "error"
                ? [{ value: "error" as const, label: "On failure", count: counts.error }]
                : []),
            ]}
          />
        </div>

        {/* Phase 32 — the library's two filters. Starred is a toggle like the chips above;
            tags are a `<select>`, because a workspace may hold up to a hundred of them and a
            row of a hundred chips is not a filter anybody can read. */}
        <div className="mt-3.5 flex flex-wrap items-center gap-x-5 gap-y-2.5">
          <div role="group" aria-label="Filter by star" className="flex items-center gap-1.5">
            <span className="eyebrow">Mine</span>
            <FilterButton
              active={view.starred}
              onClick={() => update({ starred: !view.starred })}
              count={counts.starred}
            >
              <span aria-hidden="true">{view.starred ? "★" : "☆"}</span> Starred
            </FilterButton>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5">
              <span className="eyebrow">Tag</span>
              <Select
                value={tagSelectValue(view, tags)}
                onChange={(event) => update({ tag: event.target.value === "" ? null : event.target.value })}
                className="w-auto min-w-40 py-1"
              >
                <option value="">Any tag</option>
                {missingTag !== null && (
                  <option value={MISSING_TAG} disabled>
                    “{missingTag}” — no such tag
                  </option>
                )}
                {sortedTags.map((tag) => (
                  <option key={tag.id} value={tag.name}>
                    {tag.name} ({tagCounts.get(tag.id) ?? 0})
                  </option>
                ))}
              </Select>
            </label>
            {canEdit && (
              <Button tone="ghost" size="sm" onClick={() => setManagingTags(true)}>
                Manage tags
              </Button>
            )}
          </div>
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
          description={
            missingTag !== null
              ? `There is no tag called “${missingTag}” in this workspace — it may have been renamed or deleted.`
              : view.starred && counts.starred === 0
                ? "You have not starred a workflow yet. The ☆ beside a workflow's name stars it, for you alone."
                : "No workflow in your list matches the search and filters you have set."
          }
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
              activeTag={view.tag}
              onDelete={() => setPendingDelete(card)}
              onStar={() => toggleStar(card)}
              onTags={() => setTagging(card)}
              onDuplicate={() => duplicate(card)}
              onExport={() => exportCard(card)}
              onTag={filterByTag}
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

      <WorkflowTagsDialog
        card={tagging}
        tags={tags}
        onClose={() => setTagging(null)}
        onSaved={() => router.refresh()}
      />
      <ExportDialog card={exporting} onClose={() => setExporting(null)} />
      {canEdit && (
        <ManageTagsDialog
          open={managingTags}
          tags={tags}
          counts={tagCounts}
          onClose={() => setManagingTags(false)}
          onChanged={onTagChanged}
        />
      )}
    </>
  );
}

function Row({
  card,
  delay,
  canEdit,
  activeTag,
  onDelete,
  onStar,
  onTags,
  onDuplicate,
  onExport,
  onTag,
}: {
  card: WorkflowCard;
  delay: number;
  canEdit: boolean;
  /** The tag the list is filtered by, so its chip on this card shows as pressed. */
  activeTag: string | null;
  onDelete: () => void;
  onStar: () => void;
  onTags: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onTag: (tag: TagSummary) => void;
}) {
  const router = useRouter();

  return (
    <li
      style={{ animationDelay: `${delay}ms` }}
      className="card animate-rise flex items-start gap-3 p-4"
    >
      {/* Phase 32. A star is the reader's own — a viewer may star — and it is a toggle
          button: `aria-pressed` says the state, and the glyph's shape says it again, filled
          or hollow, so it is never carried by colour alone. */}
      <button
        type="button"
        aria-pressed={card.starred}
        onClick={onStar}
        className={cn(
          "-mt-0.5 -ml-1 grid size-8 shrink-0 place-items-center rounded-lg text-lg leading-none",
          "hover:bg-ink/7 transition-colors",
          card.starred ? "text-warn" : "text-muted hover:text-ink",
        )}
      >
        <span aria-hidden="true">{card.starred ? "★" : "☆"}</span>
        <span className="sr-only">Star “{card.name}”</span>
      </button>

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
            <Badge key={trigger}>{TRIGGER_NAMES[trigger]}</Badge>
          ))}
          {card.scheduleCron && <Badge className="font-mono">{card.scheduleCron}</Badge>}
          {/* **Both of these have to be visible from the list** (Phase 20). A workflow that
              is private, or one that anybody with a URL can read, is a fact about it as
              important as whether it runs — and the list is where somebody scanning their
              workspace would expect to find out, not a dialog two clicks in. */}
          {card.visibility === "private" && (
            <Badge tone="outline" icon="●">
              private
            </Badge>
          )}
          {card.shared && (
            <Badge tone="outline" icon="↗">
              public link
            </Badge>
          )}
          {/* Phase 26. The one state on this card that means "this will not run by itself",
              so it is as loud as the two above it. */}
          {!card.active && card.triggers.some((trigger) => trigger !== "manual") && (
            <Badge tone="outline" icon="⏻">
              switched off
            </Badge>
          )}
          {/* Phase 32. A tag is a button that filters the list by it — the quickest way from
              "this one is billing" to "show me billing". Pressed when it is the filter. */}
          {card.tags.map((tag) => {
            const pressed = activeTag !== null && sameTagName(activeTag, tag.name);
            return (
              <button
                key={tag.id}
                type="button"
                aria-pressed={pressed}
                onClick={() => onTag(tag)}
                className={cn(
                  "chip min-h-6 cursor-pointer",
                  pressed ? "bg-accent-pop text-accent-ink" : "bg-surface text-ink hover:bg-canvas",
                )}
              >
                <span aria-hidden="true">#</span>
                {tag.name}
                <span className="sr-only">, filter by this tag</span>
              </button>
            );
          })}
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
            ? [
                { id: "tags", label: "Tags…", onSelect: onTags },
                { id: "duplicate", label: "Duplicate", onSelect: onDuplicate },
              ]
            : []),
          // A viewer may export: it is a read of what they can already open, minus every token.
          { id: "export", label: card.pinnedCount > 0 ? "Export as JSON…" : "Export as JSON", onSelect: onExport },
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
/** One toggle button of the filter rows — pressed IN when active, never colour alone. */
function FilterButton({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "btn px-2.5 py-1 text-2xs",
        active ? "btn-primary translate-x-[2px] translate-y-[2px] shadow-(--shadow-press)" : "btn-quiet",
      )}
    >
      {children}
      {/* The full label colour on the fill, never a dimmed one: `accent-ink` at 70%
          measured 3.77:1 on the grape fill in Light (Phase 28's contrast audit). The
          count is set apart by its size instead. */}
      <span className={cn("text-3xs", active ? "text-accent-ink" : "text-faint")}>{count}</span>
    </button>
  );
}

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
      {options.map((option) => (
        <FilterButton
          key={option.value}
          active={option.value === value}
          onClick={() => onChange(option.value)}
          count={option.count}
        >
          {option.label}
        </FilterButton>
      ))}
    </div>
  );
}
