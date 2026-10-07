"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, type ButtonTone } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Labelled, Select, Textarea, Toggle } from "@/components/ui/field";
import { Menu } from "@/components/ui/menu";
import { useTheme } from "@/components/ui/theme";
import { Tabs } from "@/components/ui/tabs";
import { Notice } from "@/components/ui/notice";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { THEME_CHOICES } from "@/lib/ui/theme";

/**
 * The interactive half of the gallery.
 *
 * Separate from `page.tsx` so the page itself stays a static server component — the
 * gallery is prerendered and the only JavaScript it ships is this island.
 *
 * Everything here is the real primitive. That is the point: a design gallery that
 * renders screenshots of its components proves the screenshots, and the first thing
 * a contributor does on this page is press something.
 */

const TONES: ButtonTone[] = ["ink", "primary", "quiet", "ghost", "danger"];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="eyebrow">{label}</p>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function ButtonBoard() {
  return (
    <div className="space-y-5">
      <Row label="Tones">
        {TONES.map((tone) => (
          <Button key={tone} tone={tone}>
            {tone}
          </Button>
        ))}
      </Row>
      <Row label="Sizes">
        <Button tone="primary" size="sm">
          Small
        </Button>
        <Button tone="primary">Medium</Button>
        <Button tone="primary" size="lg">
          Large
        </Button>
      </Row>
      <Row label="States">
        <Button tone="primary" disabled>
          Disabled
        </Button>
        <Button tone="primary" loading>
          Working
        </Button>
        <Button tone="quiet" disabled>
          Disabled
        </Button>
      </Row>
      <p className="text-muted text-2xs max-w-2xl text-pretty">
        A disabled button is flat on the table — no shadow to press, so no gesture. The
        loading button keeps its place in the tab order and reports{" "}
        <code className="font-mono">aria-busy</code> rather than becoming{" "}
        <code className="font-mono">disabled</code>, which would drop it out from under a
        keyboard user mid-announcement.
      </p>
    </div>
  );
}

function FieldBoard() {
  const [checked, setChecked] = useState(true);
  const [on, setOn] = useState(true);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Labelled label="Workflow name" hint="Shown in the list and on the canvas header.">
        <Input placeholder="Daily standup digest" defaultValue="Support triage" />
      </Labelled>
      <Labelled label="Model" hint="The provider is configured in Settings.">
        <Select defaultValue="gemini-3-flash-preview">
          <option value="gemini-3-flash-preview">gemini-3-flash-preview</option>
          <option value="gemini-3.6-flash">gemini-3.6-flash</option>
          <option value="gemini-3.5-flash-lite">gemini-3.5-flash-lite</option>
        </Select>
      </Labelled>
      <Labelled
        label="System prompt"
        hint="What the agent is for, in its own words."
        className="sm:col-span-2"
      >
        <Textarea defaultValue="You triage inbound support messages and decide whether a human needs to see them today." />
      </Labelled>
      <Labelled label="Webhook token" error="This token is already in use.">
        <Input defaultValue="af_8f21c0" aria-invalid="true" />
      </Labelled>
      <div className="space-y-3">
        <p className="eyebrow">Toggles</p>
        <Toggle
          label="Retry a failed step once"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        <Toggle
          kind="switch"
          label="Stream logs while running"
          checked={on}
          onChange={(e) => setOn(e.target.checked)}
        />
      </div>
    </div>
  );
}

function OverlayBoard() {
  const toast = useToast();
  const { preference, setPreference } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-5">
      <Row label="Dialog">
        <Button tone="primary" onClick={() => setOpen(true)}>
          Open a dialog
        </Button>
        <span className="text-muted text-2xs">
          Native <code className="font-mono">&lt;dialog&gt;</code>: focus is trapped, Escape
          closes, the background is inert, and there is no z-index anywhere.
        </span>
      </Row>

      <Row label="Toasts">
        <Button
          tone="quiet"
          onClick={() => toast({ tone: "ok", title: "Workflow saved", detail: "6 nodes, 5 connections." })}
        >
          Success
        </Button>
        <Button
          tone="quiet"
          onClick={() =>
            toast({
              tone: "bad",
              title: "The run failed at decide_urgency",
              detail: "The model did not answer within 12s. Nothing was sent.",
              duration: null,
            })
          }
        >
          Failure
        </Button>
        <Button
          tone="quiet"
          onClick={() => toast({ tone: "warn", title: "Two steps were skipped", detail: "The branch took the false path." })}
        >
          Warning
        </Button>
        <Button tone="quiet" onClick={() => toast({ tone: "info", title: "Generating…" })}>
          Note
        </Button>
      </Row>
      <p className="text-muted text-2xs max-w-2xl text-pretty">
        A failure is <code className="font-mono">role=&quot;alert&quot;</code> and stays up
        until dismissed; everything else is polite and clears itself. The live region is
        rendered always, empty — a region created together with its first message announces
        nothing, which is the commonest way a toast system is silently broken.
      </p>

      <Row label="Menu and tooltip">
        <Menu
          label="Actions"
          items={[
            { id: "run", label: "Run now", onSelect: () => toast({ tone: "info", title: "Run started" }) },
            { id: "dup", label: "Duplicate", onSelect: () => toast({ tone: "ok", title: "Duplicated" }) },
            { id: "export", label: "Export JSON", onSelect: () => {}, disabled: true },
            // A radio set, exactly as the account menu offers the theme — and live:
            // choosing one here switches this page.
            ...THEME_CHOICES.map((choice) => ({
              id: `theme:${choice.value}`,
              label: choice.label,
              group: "Theme",
              checked: preference === choice.value,
              onSelect: () => setPreference(choice.value),
            })),
            {
              id: "delete",
              label: "Delete workflow",
              tone: "danger",
              onSelect: () => toast({ tone: "bad", title: "Deleted" }),
            },
          ]}
        />
        <Tooltip label="Runs the workflow without saving">
          <Button tone="quiet">Dry run</Button>
        </Tooltip>
        <span className="text-muted text-2xs">
          Both answer the keyboard: arrows and Escape in the menu, focus and Escape on the
          tooltip. The menu&apos;s Theme items are a radio set — announced as checked or not,
          and marked with a dot, not by colour.
        </span>
      </Row>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Delete this workflow?"
        description="This cannot be undone. Its run history goes with it."
        footer={
          <>
            <Button tone="quiet" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button
              tone="danger"
              onClick={() => {
                setOpen(false);
                toast({ tone: "bad", title: "Workflow deleted" });
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-pretty">
          <strong>Support triage</strong> has run 41 times and is connected to a webhook
          trigger. Anything still posting to that URL will start getting a 404.
        </p>
      </Dialog>
    </div>
  );
}

function MessageBoard() {
  return (
    <div className="space-y-4">
      <p className="text-muted max-w-2xl text-2xs text-pretty">
        A <strong>notice</strong> is anchored to the thing it is about and stays until that
        changes; a <strong>toast</strong> reports the result of something the user just did
        and clears itself. Both take their fill, their glyph and — importantly — their WORD
        from one table, so the same failure never announces itself two different ways.
      </p>

      <Notice tone="ok" title="Key verified against the provider and stored, encrypted." />

      <Notice tone="warn" title="Built and saved — but no node can do these parts yet">
        <ul className="list-disc space-y-0.5 pl-4">
          <li>Read the attachment on the incoming email</li>
          <li>Wait for a human to approve it</li>
        </ul>
      </Notice>

      <Notice
        tone="bad"
        title="The model returned a graph that does not validate"
        action={
          <Button size="sm" tone="quiet">
            Try again
          </Button>
        }
      >
        <ul className="list-disc space-y-0.5 pl-4">
          <li>Edge e2 leaves an output handle that core.branch does not declare</li>
        </ul>
      </Notice>

      <Notice tone="info" title="This workflow has no trigger yet, so it cannot run." />

      <p className="text-muted max-w-2xl text-2xs text-pretty">
        The failure carries <code className="font-mono">role=&quot;alert&quot;</code> and a
        single short shake. Deliberately small: it says &ldquo;look here&rdquo;, not
        &ldquo;your work is gone&rdquo;.
      </p>
    </div>
  );
}

function CardBoard() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Card>
        <CardHeader title="A flat card" aside={<Badge>region</Badge>} />
        <div className="p-4">
          <p className="text-muted text-2xs text-pretty">
            A region of the page — a settings section, a list item. Paper fill.
          </p>
        </div>
      </Card>
      <Card raised>
        <CardHeader title="A raised card" aside={<Badge>object</Badge>} />
        <div className="p-4">
          <p className="text-muted text-2xs text-pretty">
            An object on the page — a node, a popover, a dialog. White fill, deeper shadow.
          </p>
        </div>
      </Card>
      <Card raised>
        <CardHeader title="decide_urgency" fill="bg-cat-agent-pop" aside={<Badge>agent</Badge>} />
        <div className="space-y-2 p-4">
          <p className="text-muted text-2xs">
            A category header strip is the one place a pop fill covers a wide area — and
            where a node card carries its category.
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Badge className="text-ok" icon={<span aria-hidden="true">✓</span>}>
              succeeded
            </Badge>
            <Badge className="text-live" icon={<span aria-hidden="true">▸</span>}>
              running
            </Badge>
            <Badge className="text-warn" icon={<span aria-hidden="true">▲</span>}>
              skipped
            </Badge>
            <Badge className="text-bad" icon={<span aria-hidden="true">✕</span>}>
              failed
            </Badge>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="pop" className="bg-cat-trigger-pop">
              trigger
            </Badge>
            <Badge tone="pop" className="bg-cat-agent-pop">
              agent
            </Badge>
            <Badge tone="pop" className="bg-cat-logic-pop">
              logic
            </Badge>
            <Badge tone="pop" className="bg-cat-integration-pop">
              integration
            </Badge>
          </div>
        </div>
      </Card>
    </div>
  );
}

export function Playground() {
  return (
    <ToastProvider>
      <Tabs
        tabs={[
          { id: "buttons", label: "Buttons", content: <ButtonBoard /> },
          { id: "fields", label: "Fields", content: <FieldBoard /> },
          { id: "cards", label: "Cards & badges", content: <CardBoard /> },
          { id: "messages", label: "Messages", content: <MessageBoard /> },
          { id: "overlays", label: "Overlays", content: <OverlayBoard /> },
        ]}
      />
    </ToastProvider>
  );
}
