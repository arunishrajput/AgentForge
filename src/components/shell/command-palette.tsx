"use client";

import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { cn } from "@/components/ui/cn";
import { useToast } from "@/components/ui/toast";
import { api, type Workflow } from "@/lib/canvas/client";
import { rankCommands, type Command } from "@/lib/ui/command";

/**
 * The command palette — ⌘K, or Ctrl+K.
 *
 * It is one component rather than a provider and a dialog, because there is one of
 * it per page and nothing else needs to open it. The button it renders is the
 * discoverable half: a palette with no visible trigger is a feature only the person
 * who built it knows about, and the keyboard hint on the button is how everyone
 * else finds the shortcut.
 *
 * Built on the native `<dialog>` for the same reasons as `ui/dialog.tsx` — focus
 * trap, Escape, inert background, top layer — but not on that component, because a
 * palette is anchored near the top of the viewport and has a search field where a
 * dialog has a title bar.
 *
 * The ARIA pattern is a combobox that owns a listbox: focus never leaves the input
 * while the arrow keys move a *virtual* cursor, which is what `aria-activedescendant`
 * is for. Moving real focus onto the options instead would stop the user typing to
 * narrow the list, which is the whole interaction.
 *
 * The ranking is in `src/lib/ui/command.ts`, with tests. This file is the wiring.
 */

type PaletteCommand = Command & {
  group: string;
  /** Right-aligned meta on the row — a node count, or a shortcut. */
  hint?: string;
  run: () => void | Promise<void>;
};

const REPOSITORY = "https://github.com/arunishrajput/AgentForge";

export function CommandPalette({ className }: { className?: string }) {
  const router = useRouter();
  const toast = useToast();
  const listId = useId();
  const optionId = useId();

  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<(HTMLDivElement | null)[]>([]);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // `null` means "not asked yet", which is different from "asked, and you have none".
  const [workflows, setWorkflows] = useState<Workflow[] | null>(null);

  const close = useCallback(() => dialog.current?.close(), []);

  // ⌘K on a Mac, Ctrl+K everywhere else. `keydown` on the document rather than a
  // React handler, because the shortcut has to work wherever focus happens to be.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // `showModal()` rather than the `open` attribute: an `open` attribute produces a
  // NON-modal dialog with no focus trap, no Escape and no inert background.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      // `showModal()` focuses the first focusable descendant by itself, but only
      // when nothing in the dialog claims focus first. Saying it explicitly is one
      // line and removes the dependency on that ordering.
      input.current?.focus();
    }
    if (!open && element.open) element.close();
  }, [open]);

  // Every exit path — Escape, the backdrop, a chosen command — ends in `close`, so
  // this is the single place the React state is put back in step with the element.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const onClose = () => {
      setOpen(false);
      setQuery("");
      setActive(0);
      // `<dialog>` returns focus to whatever had it before `showModal()`, which for
      // the ⌘K path is the document body — a keyboard user would then be tabbing
      // from the top of the page. The visible equivalent of the shortcut is the
      // button, so focus goes there instead, whichever way the palette was opened.
      trigger.current?.focus();
    };
    element.addEventListener("close", onClose);
    return () => element.removeEventListener("close", onClose);
  }, []);

  // The list is fetched once, on first open, and kept. It is the signed-in user's
  // own workflows, which is a small owner-scoped list, and re-fetching it on every
  // ⌘K would put a request between the keystroke and the first paint.
  useEffect(() => {
    if (!open || workflows !== null) return;
    api
      .listWorkflows()
      .then(setWorkflows)
      .catch(() => setWorkflows([]));
  }, [open, workflows]);

  const createWorkflow = useCallback(async () => {
    try {
      const workflow = await api.createWorkflow({ name: "Untitled workflow" });
      router.push(`/workflows/${workflow.id}`);
    } catch {
      toast({ tone: "bad", title: "Could not create the workflow", duration: null });
    }
  }, [router, toast]);

  const commands = useMemo<PaletteCommand[]>(() => {
    const navigation: PaletteCommand[] = [
      {
        id: "new",
        group: "Actions",
        title: "New workflow",
        subtitle: "Start from an empty canvas",
        keywords: ["create", "blank", "add"],
        run: createWorkflow,
      },
      {
        id: "templates",
        group: "Actions",
        title: "Start from a template",
        subtitle: "Six workflows that already work",
        keywords: ["template", "gallery", "example", "starter", "sample", "blank"],
        run: () => router.push("/templates"),
      },
      {
        id: "workflows",
        group: "Go to",
        title: "Workflows",
        subtitle: "Everything you have built",
        keywords: ["list", "home"],
        run: () => router.push("/workflows"),
      },
      {
        id: "analytics",
        group: "Go to",
        title: "Analytics",
        subtitle: "Runs, failures and model usage",
        keywords: ["runs", "failures", "errors", "latency", "metrics", "usage", "dashboard"],
        run: () => router.push("/analytics"),
      },
      {
        id: "settings",
        group: "Go to",
        title: "Settings",
        subtitle: "Model, integrations and account",
        keywords: ["gemini", "api key", "model", "discord", "google", "sheets", "gmail"],
        run: () => router.push("/settings"),
      },
      {
        id: "design",
        group: "Go to",
        title: "Design system",
        subtitle: "The Toybox gallery",
        keywords: ["toybox", "colour", "tokens", "components"],
        run: () => router.push("/design"),
      },
      {
        id: "repository",
        group: "Go to",
        title: "Source on GitHub",
        subtitle: "Opens in a new tab",
        keywords: ["repo", "code", "open source"],
        run: () => window.open(REPOSITORY, "_blank", "noopener,noreferrer"),
      },
    ];

    const saved: PaletteCommand[] = (workflows ?? []).map((workflow) => ({
      id: `workflow:${workflow.id}`,
      group: "Workflows",
      title: workflow.name,
      subtitle: workflow.description ?? undefined,
      keywords: workflow.graph.nodes.map((node) => node.type),
      hint: `${workflow.graph.nodes.length} node${workflow.graph.nodes.length === 1 ? "" : "s"}`,
      run: () => router.push(`/workflows/${workflow.id}`),
    }));

    return [...navigation, ...saved];
  }, [createWorkflow, router, workflows]);

  const results = useMemo(() => rankCommands(commands, query), [commands, query]);

  // The group heading each row carries, derived rather than tracked with a variable
  // that the render loop reassigns: a value mutated during render is read again on
  // the next one and is a genuine source of stale UI, not just a lint opinion.
  const rows = useMemo(
    () =>
      results.map((command, at) => ({
        command,
        heading: at === 0 || results[at - 1].group !== command.group ? command.group : null,
      })),
    [results],
  );

  // Clamped rather than reset, so narrowing the list cannot leave the cursor past
  // the end of it.
  const index = Math.min(active, Math.max(results.length - 1, 0));
  const current = results[index];

  useEffect(() => {
    options.current[index]?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const choose = (command: PaletteCommand | undefined) => {
    if (!command) return;
    close();
    void command.run();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") setActive((current) => (current + 1) % results.length);
    else if (event.key === "ArrowUp")
      setActive((current) => (current - 1 + results.length) % results.length);
    else if (event.key === "Home") setActive(0);
    else if (event.key === "End") setActive(results.length - 1);
    else if (event.key === "Enter") choose(current);
    else return;
    event.preventDefault();
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        className={cn("btn btn-quiet text-muted gap-2 font-medium", className)}
      >
        <span aria-hidden="true">⌕</span>
        <span className="hidden sm:inline">Search</span>
        <kbd className="border-line bg-sunken text-3xs hidden rounded-md border px-1 py-px font-sans font-bold sm:inline">
          ⌘K
        </kbd>
      </button>

      {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions --
          The keyboard equivalent of a backdrop click is Escape, which `<dialog>`
          implements itself and the `close` listener above reacts to. This handler is
          a pointer affordance for behaviour the keyboard already has. */}
      <dialog
        ref={dialog}
        aria-label="Command palette"
        onClick={(event) => {
          if (event.target === dialog.current) close();
        }}
        className={cn(
          "card-raised animate-pop m-auto mt-[12vh] w-[min(34rem,calc(100vw-2rem))] p-0",
          "backdrop:bg-ink/35 open:flex open:flex-col",
        )}
      >
        <div className="border-line bg-sunken flex items-center gap-2.5 border-b-2 px-4 py-3">
          <span aria-hidden="true" className="text-muted">
            ⌕
          </span>
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={current ? `${optionId}-${index}` : undefined}
            aria-autocomplete="list"
            aria-label="Search commands and workflows"
            autoComplete="off"
            spellCheck={false}
            placeholder="Search workflows, settings, actions…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            className="text-ui min-w-0 flex-1 bg-transparent placeholder:font-sans focus:outline-none"
          />
          <kbd className="border-line bg-surface text-3xs rounded-md border px-1.5 py-0.5 font-sans font-bold">
            esc
          </kbd>
        </div>

        <div
          id={listId}
          role="listbox"
          aria-label="Results"
          className="max-h-[50vh] overflow-y-auto p-1.5"
        >
          {rows.map(({ command, heading }, at) => {
            const selected = at === index;

            return (
              <Fragment key={command.id}>
                {/* A sibling of the option, never a child of it: anything inside an
                    option becomes part of that option's accessible name, and a
                    screen reader would read "Go to Workflows Everything you have
                    built" as one string. */}
                {heading && (
                  <div role="presentation" className="eyebrow mt-3 mb-1 px-2.5 first:mt-1">
                    {heading}
                  </div>
                )}
                {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events --
                    In the combobox pattern the keyboard interface lives on the INPUT,
                    which keeps focus while `aria-activedescendant` moves a virtual
                    cursor over these options. Arrow keys, Home, End and Enter are all
                    handled there. Adding key handlers here would require focusing the
                    option, which is exactly what the pattern exists to avoid, because
                    it would stop the user typing to narrow the list. */}
                <div
                  ref={(element) => {
                    options.current[at] = element;
                  }}
                  id={`${optionId}-${at}`}
                  role="option"
                  aria-selected={selected}
                  // Not in the tab order — focus stays on the input — but focusable
                  // enough that assistive technology can reach the element the
                  // `aria-activedescendant` on the input points at.
                  tabIndex={-1}
                  onClick={() => choose(command)}
                  onPointerMove={() => setActive(at)}
                  className={cn(
                    "cursor-pointer rounded-lg px-2.5 py-2",
                    // The cursor is a fill AND a left rule, never the fill alone:
                    // `DESIGN.md` → *Never colour alone*.
                    selected && "bg-accent-pop text-ink border-line border-l-4",
                  )}
                >
                  <span className="flex items-baseline gap-3">
                    <span className="text-ui min-w-0 flex-1 truncate font-semibold">
                      {command.title}
                    </span>
                    {command.hint && (
                      <span
                        className={cn("text-2xs shrink-0", selected ? "text-ink" : "text-faint")}
                      >
                        {command.hint}
                      </span>
                    )}
                  </span>
                  {command.subtitle && (
                    <span
                      className={cn(
                        "text-2xs mt-0.5 block truncate",
                        selected ? "text-ink/75" : "text-muted",
                      )}
                    >
                      {command.subtitle}
                    </span>
                  )}
                </div>
              </Fragment>
            );
          })}

          {rows.length === 0 && (
            <p className="text-muted text-ui px-2.5 py-6 text-center">
              Nothing matches “{query.trim()}”.
            </p>
          )}
        </div>
      </dialog>
    </>
  );
}
