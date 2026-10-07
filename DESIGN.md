# DESIGN.md — Toybox

The AgentForge design language. **Read this before any UI work.**

The live reference is **[`/design`](https://agentforge-733000675212.asia-southeast1.run.app/design)** —
every token, primitive, motion state and illustration on one page, with its contrast ratio computed
rather than claimed. This file is the *why* and the *rules*; the gallery is the *what*.

---

## The direction, in one paragraph

**Bright, playful, light-first.** A cream page, near-black ink, saturated colour, thick outlines,
hard offset shadows, fat corners and springy motion. The reference is a well-made toy: tactile,
friendly, obviously clickable. **Not a dark IDE**, which is what every competing tool looks like —
that is the point, and it is the one thing a stranger notices in the first second.

The direction was chosen deliberately in `BUILD_PLAN.md` Chapter 2 and is **binding**. It is not
re-litigated phase by phase.

### Themes — Light, Toybox Night and System (Phase 27)

**Toybox has a dark theme, "Toybox Night", and a System option** (`DECISIONS.md` D110, chosen by
the user, superseding D65's light-only; built in Phase 27, D121–D124). Three things do not move:

- **Light is the default and the reference.** The product opens in Light even for a visitor whose OS
  is dark, and everything in this file describes Light unless it says otherwise
- **Night is Toybox, not a dark IDE.** Same outlines, same hard no-blur shadows, same press, same
  saturation — and the same gates, run per theme. See *Themes* below
- **The choice is the reader's, per browser.** The account menu, *Settings → Account →
  Appearance*, the ⌘K palette, and the switch at the top of `/design`

---

## The one rule the whole system turns on

**Every chromatic token comes in two registers.**

| Register | Token | What it is | What it may do |
|---|---|---|---|
| Text | `--color-x` | Dark and saturated | Text on any surface, and small graphics — dots, rules, icons |
| Fill | `--color-x-pop` | Bright and saturated | A **background only**, always with an ink label, always inside an ink outline |

This exists because **saturated-accent-on-cream is exactly where AA fails**. A single grape that is
vivid enough to be a good button fill is nowhere near readable as body text on cream, and a grape
dark enough to read as text is a muddy button. Rather than pick one and quietly break the other,
every tone is two tones, and the name says which job it does.

Three consequences that are easy to get wrong:

1. **`text-accent` is correct. `text-accent-pop` is a bug.** The plain token is the default because
   the safe thing should be the short thing.
2. **The label on any `-pop` fill is `--color-accent-ink`.** Never white, and never cream in Night.
   Every fill in the palette clears AA against it (worst case 6.2:1 in Light, 4.95:1 in Night).
   Write `bg-ok-pop text-accent-ink`, not `text-ink` — identical in Light, broken in Night
3. **A `-pop` fill is never drawn without its ink outline.** Some fills sit as little as **1.3:1**
   off the cream page — the amber and the lime especially. In this language the outline carries the
   separation between an object and its background, *not* the lightness. Take the outline off and
   the object does not become subtle, it becomes invisible.

All three are asserted by `src/app/tokens.test.ts`, which fails the build. They are not conventions.

---

## Colour

Full swatches, roles and measured ratios: **`/design` → Colour**. The catalogue is
`src/lib/design/palette.ts`, which CI asserts against `src/app/globals.css` in both directions.

### Surfaces

| Token | What it is |
|---|---|
| `--color-canvas` | The page |
| `--color-surface` | A card, a panel |
| `--color-elevated` | A node, a dialog, a popover |
| `--color-sunken` | An input well, a log list |

The luminance steps between them are **deliberately tiny**. Chapter 1's dark palette asserted a 1.4×
step between surfaces, because in a dark UI elevation *is* lightness. Here it is not: elevation is
the outline and the shadow. `tokens.test.ts` asserts the ordering and specifically refuses to assert
a large step, because doing so would be asserting the wrong design.

### Ink

`--color-ink` for body text, `--color-muted` for captions and help text, `--color-faint` for
placeholders and footnotes. **All three clear AA on all four surfaces**, `faint` included — which was
not true in Chapter 1, where `faint` was documented as decorative-only. That exemption is gone.

`--color-line` is the outline and `--color-shade` the hard shadow. In Light both are ink by another
name; they have their own names because in Night they are not text — see *Themes*. The label on a
fill is `--color-accent-ink`, which is the one ink role that stays near-black in both themes.

### Hue assignments

Accent is grape. Status is `ok` green, `live` blue, `warn` amber, `bad` red. Node categories are
trigger, agent, logic, transform, integration.

**Trigger, logic and integration deliberately share a hue with ok, live and warn.** A trigger is the
"go" of a graph; one hue meaning one thing is worth more than five more colours. The distinction is
carried by shape, icon and label — see *Never colour alone*.

---

## Themes

Built in Phase 27. **Night is the same toy after dark, and every rule above holds in it** —
`tokens.test.ts` runs each gate once per theme.

### The split that made it possible

Until Phase 27 `--color-ink` did four jobs, and on a cream page one value can do all four. On an
indigo page it cannot, so each job has its own name (D121):

| Role | Token | Light | Night |
|---|---|---|---|
| Body text, and the focus ring | `ink` | near-black | cream |
| The label on a pop fill | `accent-ink` | near-black | **near-black** — unchanged |
| The outline | `line` | near-black | cream |
| The hard shadow | `shade` | near-black | cream |
| A modal's backdrop | `scrim` | near-black | near-black, deeper |

### Toybox Night's rules

- **The page is a deep indigo**, and the four surfaces keep Light's order (sunken, page, card,
  lifted) and Light's deliberately small steps. Elevation is still the outline and the shadow
- **The structure is drawn in cream** — outline, shadow and ring (D122). A near-black shadow on
  indigo measures ~1.2:1 and vanishes; a mid-tone shadow reads as a second, coloured stripe; cream
  reads as one object drawn in one material, which is Light mirrored
- **The fills are a rich mid-tone, and that is arithmetic, not taste.** One outline has to clear 3:1
  against both the indigo page and every fill. With a cream outline that caps a fill at about 0.25
  luminance, and the near-black label needs it at least about 0.21 — so every Night fill sits at
  **0.24**. Light's near-pastels would have needed a dark outline on a dark page. The cost is amber,
  which cannot be bright at that luminance and comes out bronze
- **The text register is the bright half.** On indigo a readable tone has to be light, so Night's
  text tones (~0.53 luminance) are brighter than its fills — the registers are still 2× apart, the
  other way round
- **The focus ring is one ring in both themes** — `ink`, cream in Night, never below 3.22:1 on any
  fill. The trap this file already named, "an ink object on an ink background needs a cream ring",
  is what Night is made of, and the fitted fills are the answer
- **No glow.** A dark theme is exactly where a soft glow tries to come back. The gate refuses a
  shadow with a blur in either theme
- **A hovered fill does not get lighter in Night** (D125). In Light, `btn-primary` and `btn-danger`
  mix 14% white into their fill on hover, a second cue beside the lift. Night's fills sit at 0.24 in a
  band of luminance from 0.21 (the near-black label's 4.5:1) to 0.26 (the cream outline's 3:1), and
  the same 14% lifts them to 0.31 — the outline falls to 2.61:1. So the amount is a per-theme value,
  `--pop-hover-white` (14% / 0%), and in Night the hover is the lift alone. The gate computes every
  fill's hover in both themes, and refuses any white mix that does not go through that value

### How the switch works

`<html data-theme>` holds the reader's choice — `light`, `dark` or `system` — kept in
`localStorage` and applied by a blocking script in `<head>` before the first paint (D123). The
stylesheet's `@custom-variant dark` decides what `system` means through `prefers-color-scheme`, so a
device that switches at sunset takes the page with it. Measured: a throttled hard reload with Dark
stored paints 218 frames, all indigo; with the script removed it paints 64 cream frames first.

**Use `dark:` for anything that must differ by theme.** It is this project's variant, not
Tailwind's — Tailwind's built-in follows the OS alone and would go dark for a reader who chose
Light. A token that already differs by theme needs no `dark:` at all, which is most of them.

### Everything the tokens do not reach — Phase 28

Phase 27 made the tokens two-themed; Phase 28 found what was drawn without them.

- **The canvas.** React Flow's `colorMode` is the reader's *resolved* theme (`useTheme().theme`),
  never React Flow's own `"system"`, which follows the OS. Every `--xy-*` variable `globals.css`
  sets wins in either mode, because React Flow's dark rule only changes the `*-default` fallbacks;
  what the mode decides is the fallback for a variable nobody set. The minimap's mask is the recess
  colour now, not a literal cream, and the dot grid is ink — see *Traps*
- **The error page that replaces the layout.** `global-error.tsx` renders its own `<html>`, so it
  carries `ThemeSync` itself. Next 16 never server-renders it — a root-layout failure gets Next's
  bare `__next_error__` shell, and the page is rendered into it on the client — so the head script
  would never run there, and is not copied in. Measured on a probe build: both a server-side and a
  client-side throw painted the page in Night
- **Files read outside the page** cannot see `data-theme`, so they follow their own environment.
  The static illustrations are written twice, `name.svg` and `name-dark.svg`, and the README picks
  with `<picture>` and `prefers-color-scheme` — GitHub's own theme. The favicon is drawn in the
  browser's chrome, which follows the device, so it is one file holding both palettes behind a
  media query. All of them are generated from the palette catalogue and compared byte for byte

---

## Shape, elevation and the press

### Corners

Fat. The Tailwind radius scale is retargeted in `@theme`, so `rounded-lg` and friends already mean
the Toybox radius — a component does not opt in.

### Shadows

A **hard offset in `shade`** — ink in Light, cream in Night — down-right, **no blur and no spread**. Blur reads as a drop shadow; the hard
edge is what makes an object read as a solid thing sitting on the page rather than floating above it.
One light source, always the same direction.

`tokens.test.ts` **refuses a shadow with a blur radius.** This is the single easiest way to turn
Toybox back into the material-elevation look every competing tool has, and it is the most likely
thing for a later phase to do by accident.

### The press — the gesture the whole language rests on

An object sitting on a hard shadow **presses into the page** when clicked. It travels down-right by
**exactly the shadow offset it loses**, so the object moves and the shadow's far corner stays put.
Hover does the reverse: up-left, shadow grows.

This lives in the `btn` utility and the `squish` utility in `globals.css`, not in a React component,
so a plain `<button className="btn btn-primary">` in a Chapter 1 screen behaves identically to
`<Button>`. **Everything clickable gets it, with two exceptions:** `btn-ghost`, which has no outline
or shadow to press, and form fields, which are holes rather than objects.

A **disabled** object is flat on the table: no shadow, so no gesture. That is the affordance, not a
grey wash.

---

## The loud register and the quiet register

`BUILD_PLAN.md` Phase 14 states the constraint plainly: *a cartoon look earns goodwill on the
landing page and gets in the way in a settings form.* So the system has both.

| | Loud | Quiet |
|---|---|---|
| Where | Landing, empty states, the gallery, primary actions, node cards | Settings forms, the inspector, dense lists, log output |
| Fills | `-pop` fills, category strips | Paper and cream only |
| Shadows | `shadow-node`, `shadow-lift` | `shadow-card` or none |
| Motion | `rise`, `boing`, the mascot | The press, and nothing else |
| Illustration | Yes | No |

**Form controls are the quiet register.** They keep the thick outline and the fat radius, because
those are what make the language one language, and they drop the hard shadow and the press. A field
carries an **inset** shadow instead — the one place in the system where light comes from the other
direction, so a hole and a button can never be confused.

---

## Motion

Eight named states and nothing outside the list. Two curves: `--ease-out-soft` settles,
`--ease-spring` overshoots. Live examples at **`/design` → Motion**.

| State | What it is for |
|---|---|
| `press` | An object moving into the page. Every button, every tab |
| `hover-lift` | The same object rising |
| `enter` (`animate-rise`) | Something arriving: up, with a small overshoot |
| `appear` (`animate-pop`) | Something appearing in place: a dialog, a tooltip, a menu |
| `success` (`animate-boing`) | A settled overshoot. The toy landing in its slot |
| `failure` (`animate-wiggle`) | A tight, short shake |
| `waiting` (`animate-think`) | Three dots bobbing in sequence. The agent is thinking |
| `idle` (`animate-float`) | The mascot's bob |

**The failure shake is deliberately small and short.** It says "look here", not "your work is gone".
A long or wide shake on a failed run is the animation equivalent of shouting at someone whose
workflow just broke.

**Do not add a spinner.** The waiting state is three bobbing dots, in the product's own character. A
rotating ring is the one piece of motion every product shares and it is a wasted chance to be
recognisable.

### Reduced motion

`prefers-reduced-motion: reduce` collapses every duration to zero, in one blanket rule. That rule is
safe **only because every animation in the system is decoration over a state that is also stated in
text** — keep it that way. The canvas's JavaScript `fitView` tween reads the same query separately
in `src/lib/canvas/motion.ts` and must keep doing so.

**The press displacement is deliberately NOT suppressed.** The request is for less animation, not for
a control that stops responding to a click. A 2px move with no transition is instantaneous feedback.

---

## Illustration and character

### Sparky

A forge sprite — an ingot with a flame. Three moods: `happy`, `thinking`, `concerned`.

**When the mascot may appear:**

- Empty states, at full size, with a heading, a sentence and an action
- The agent thinking indicator, small
- The gallery and the landing page

**When it may not:**

- **It never replaces an error message.** On a failure it appears small, `concerned`, beside real
  text saying what broke and what to do — or it does not appear at all
- Never with a joke, an apology or an exclamation mark, in any error context
- Never in the quiet register: not in a settings form, not in the inspector, not in a log

`concerned` is drawn **attentive, not sad** — level mouth, **inner brow ends raised**, no tears and
no shrug. The first draft lowered them toward the nose, which is the geometry of anger: on the
deployed error screen it read as cross with the user, which is worse than the flippancy the phase
warns about. It was only obvious once it was on screen at size.
`BUILD_PLAN.md` Phase 14 is explicit that a mascot must not read as flippant when someone's workflow
has just failed, and the mood's geometry is the first half of honouring that. The placement rules
above are the second half, and they matter more.

### The scenes

`WorkbenchArt` (nothing built), `CanvasArt` (an empty canvas), `QuietArt` (nothing has run),
`BrokenArt` (something failed). All inline SVG on `var(--color-*)`, all `aria-hidden` — an
illustration sits above a heading and a sentence that already say what is going on, and announcing it
twice is noise.

**Every empty state gets an action.** `EmptyState` takes `action` before `children` so that omitting
it is a visible choice. An empty state without one is a dead end with a picture on it.

**`EmptyState` takes a heading `level`, and the default is wrong for a full-page one.** It renders an
`h3`, because the usual caller is a region inside a page that already has an `h1`. On a screen that
*is* the empty state — the 404 and the error boundary — pass `level={1}`, or the document ships with
no `h1` at all. That is exactly what Phase 15 shipped for one deploy, and it was found by asking the
deployed page for its headings rather than by looking at it.

### The static copies

`public/illustrations/*.svg` are **generated** by `npm run design:export` from
`src/lib/design/illustrations-static.ts`, for the README and the docs site, where an `<img src>`
cannot read a CSS variable — **each in Light and in Night** (`-dark.svg`) since Phase 28, and the
README chooses with `<picture>`. The same command writes the favicon, `src/app/icon.svg`.
`illustrations-static.test.ts` regenerates them all in memory and compares byte for byte, so **a
colour token change fails CI until the export is re-run.** Do not hand-edit them.

---

## Accessibility — the constraints, not a checklist

### One focus ring, and it is ink

2.5px solid ink, 3px offset, `:focus-visible` only — near-black in Light, cream in Night. **No
control anywhere sets `outline-none`.** A control whose real input is visually hidden (the theme
switch's radios) wears the ring on its label with `focus-ring-within`.

It is ink rather than the accent because of a measurement: WCAG 2.2 SC 1.4.11 wants 3:1 for a focus
indicator, the accent fill is **2.6:1** against cream, and ink is **16.4:1** there and never below
**6.2:1** on any fill in the system. One ink ring is therefore legal everywhere. The 3px offset
leaves a gap of page colour between an object's own outline and the ring, which is what stops the two
reading as one thicker border.

The one arrangement this does not survive is an ink object on an ink background. In Light there is
none. In Night the ring *is* cream, and the fills were fitted so it clears 3:1 on every one of them.

### Never colour alone

Every status pairs its tone with a **word, an icon or a position**. A selected tab is a different
colour *and* pressed in. A failure toast is red *and* announces "Error:" *and* shakes.

**Phase 16 delivered the canvas half of this promise**, and it is the strictest application of the
rule in the product: a node's status is carried on **five** channels — see *The canvas* below.

### Native elements where they are better

The select is a real `<select>`, the dialog a real `<dialog>`, the switch a real
`<input type="checkbox">` with `role="switch"`. Typeahead, Home/End, focus trapping, Escape, the
inert background and a phone's own picker all come free, and all are commonly broken when hand-rolled.
A hand-rolled listbox is the single most frequently broken "accessible" component on the web.

The cost is that a native `<select>`'s open list is drawn by the OS and cannot be Toybox. The closed
control, which is what a user looks at, can be. That trade is deliberate.

### The live region exists before the first message

`ToastProvider` renders its `aria-live` region **always, empty**. A screen reader only announces
changes to a region it was already observing, so a region created together with its first toast
announces nothing. This is the commonest way a toast system is silently broken for exactly the people
who most need it.

### Timed messages are dismissible

Every toast has a close button. A failure worth acting on uses `duration: null` and stays up until
dismissed (WCAG 2.2.1).

---

## The canvas

The screen the product exists for, and the one place where decoration that costs scanability is a
net loss. Rebuilt in Phase 16.

### The layout is the design decision

Chapter 1 measured the constraint precisely: two 280px side panels leave an **880px canvas at
1440px**, which forces `fitView` to 0.39 and draws a 224px node card at **88px**. Bigger, chunkier
cards make that *worse*, so the phase could not be a restyle.

**A panel collapses to a 40px rail.** Measured on the deployed revision: canvas **880 → 1360px**,
zoom **0.524 → 0.810**, card **117 → 182px**. The rail is the load-bearing half — a panel that
collapses to *nothing* is a panel the user cannot find again, so it stays a real button that names
itself and reports `aria-expanded`. The canvas refits itself when the layout changes.

Two breakpoints, two behaviours, and **no viewport measurement in JavaScript**: below `lg` a panel
is a drawer driven by `open`, at `lg` and up a column driven by `collapsed`. CSS decides, so there
is nothing to mismatch on the server render.

**On a phone the toolbar is two rows, not three** (Phase 28). Below `sm` the save status drops the
version it shared with the `vN` button beside it ("Saved", not "Saved · v1"), the buttons' padding
and the row's gap tighten, the hidden "Active" label stops spending a gap, and the name field's
minimum shrinks so the first row holds at 320 px. Measured on the deployed canvas through a
same-origin iframe: 151 → 104 px at 375, 197 → 149 px at 320 for a webhook workflow. Nothing was
removed; a run in flight, which adds Stop and widens Run, still wraps rather than clips.

### A node card

An object, built the way every other object in this language is built: a 2px ink outline, a hard
offset shadow, a fat radius, on `elevated`.

| Part | What it is |
|---|---|
| Category strip | A `-pop` fill, an ink icon and the category in **words**, inside the card's outline |
| Name | The node's own label, and the largest type on the card — at 0.4 zoom it is the only thing still readable, so it is what the card is *for* |
| Type | `ai.agent`, in mono, muted |
| Status | The chip, when the node has run |
| Outputs | One labelled row per declared output, each with its handle centred on it |

**Selection and status are different channels.** Status owns the outline and the surface; selection
owns the lift. A selected *failed* node therefore still shows that it failed.

### Status is five channels, one of which is hue

`src/lib/canvas/status.ts`, asserted by `status.test.ts` — a later phase may change a glyph, it may
not make two statuses look alike.

| Status | Word | Shape | Outline | Surface | Motion |
|---|---|---|---|---|---|
| idle | "Idle" | `○` | ink | raised | — |
| running | "Running" / **"Thinking"** on an agent | three bobbing dots | ink | raised | — |
| succeeded | "Succeeded" | `✓` | ink | raised | `boing` |
| failed | "Failed" | `!` | **red** | raised | `wiggle` |
| skipped | "Skipped" | `–` | **dashed** | **sunken, flatter shadow** | — |
| disabled | "Switched off" | `⊘` | **dotted** | **sunken, flatter shadow** | — |

A greyscale screenshot of a run still reads: dashed and recessed was skipped, dotted and recessed is
switched off, bobbing is working, ticked finished.

**Switched off is a property of the graph as well as a step status** (Phase 30). A switched-off node
wears it whether or not a run has reached it — the card's job is to say *this will not run* — and it
outranks the last run's status, which described a node that was on. A run that reaches one records a
`disabled` step, so the run panel says the same thing in the same word. It is recessed like
`skipped`, because the run does not execute either, and told apart from it by the outline's *shape*:
dashed is *the run went another way*, dotted is *this is off*. In diff mode the change owns the outline
and the surface, and the chip stays — being off is a fact about that version of the graph.

**A skipped node is recessed, not faded.** That is the design answer — elevation here is the
outline and the shadow, never the lightness — and it is also the only one that *works*; see the
trap below.

### Edges

2px, ink, an **arrowhead**, `smoothstep` routing. A workflow graph is directed and the whole
meaning is which way data moves; Chapter 1 drew it as an undecorated 1px line, so direction was
carried by node position alone.

The edge into the node working right now animates its flow in `live`, **the same blue** as that
card's breathing ring and its "Running" chip. Three colours for one fact is three chances to read
it as three facts. Every edge the run crossed stays lit in accent, and on a branch the untaken edge
never lights — so a finished run is still showing the route it chose.

### Diff mode — Phase 18

Comparing two versions puts the canvas into a **mode**, and the design problem is entirely that:
the graph on screen is the *union* of two versions and was never anybody's workflow, so a user who
does not realise it will try to edit it.

Three things say so, and all three are needed:

- **A pop-filled bar across the top**, with an ink label — the one loud element on the canvas, and
  the only place in the product where a whole bar takes a `-pop` fill. It names both versions, the
  counts, and the way out. A mode that looks like the ordinary page is a mode people edit by
  mistake
- **The canvas is inert.** No dragging, no connecting, no selecting, no Delete key. Save, Run and
  Queue are all disabled — there is nothing here any of them could honestly write
- **Every node wears its change as a ribbon** above the category strip, because at the zoom a
  whole-graph diff is read at, the top two centimetres are all there is

`src/lib/canvas/changes.ts`, asserted by `changes.test.ts` on the same terms as `status.ts`:

| Change | Word | Shape | Outline | Surface |
|---|---|---|---|---|
| added | "Added" | `+` | **green** | raised |
| removed | "Removed" | `−` | **red, dashed** | **sunken, flatter shadow** |
| changed | "Changed" | `~` | **amber** | raised |
| moved | "Moved" | `⤢` | ink | raised |
| unchanged | — | — | ink | raised |

**A ribbon's words are at full strength, and its ink follows its fill** (Phase 30): `accent-ink` on
the three `-pop` ribbons, `ink` on *moved*, which sits on `surface`. The field list was dimmed with
`opacity-75` until then — D126's dimmed label on a fill by another mechanism — and is told apart from
the word by weight instead. A node switched off or on says which: *switched off*, *switched on*.

**An unchanged node is undecorated, deliberately.** A diff where every card is decorated is a diff
with no signal in the decoration; the point of the mode is that the nodes which changed are the
ones that stand out. A `changed` ribbon also names *what* changed — "configuration", "name" — in
the space the ribbon already occupies.

**Run status is suppressed in diff mode.** No run ever executed the union graph, so a green
"Succeeded" badge on a node in a diff would be a statement about a different graph.

Edges follow the cards: an added connection is green at 3px, a removed one is **red and dashed**.
Dashed as well as coloured, because *Never colour alone* applies to a line exactly as it does to a
card.

**Version history is a dialog, not a third panel.** Phase 16 spent itself solving what two side
panels cost the canvas — at 1440 px two open columns leave 880 px — and a third column would undo
it. History is also read in a considered way: you open it, look, decide.

### The run panel is the quiet register

**No mascot here, and that is a rule rather than an omission.** Sparky is allowed as a small
thinking indicator and forbidden in the quiet register, and a log *is* the quiet register. A running
step gets the bobbing dots in its chip — the same `waiting` motion, without putting a face in a log.

Three things make an agent's reasoning readable: a step is **named** by its label rather than its
raw id, every log line carries its **offset from the step's start** (`+3.4s`), and the log block
sits **outside** the click target so it can be selected and copied.

---

### Editing — Phase 29

**Every edit is undoable, and the canvas reaches everything from the keyboard.**

**The shortcut vocabulary is one table** — `src/lib/canvas/shortcuts.ts` — and it drives both the
key handler and the `?` card, so the card cannot promise a key that does nothing. Change a key there
and nowhere else.

| Group | Keys |
|---|---|
| Edit | **⌘Z** undo · **⇧⌘Z** or **⌘Y** redo · **⌘C** copy · **⌘X** cut · **⌘V** paste · **⌘D** duplicate · **D** switch off or on · **N** a sticky note · **Delete** / **⌫** · **⌘S** save |
| Select | **⌘A** every node and note · **⇧ Click** add or remove a node · **⇧ Drag** a box · **arrows** move the selection from a focused node (**⇧** for bigger steps) |
| Canvas | **⌘K** find a node, or any command · **/** the palette's search · **F** fit · **?** this list · **Esc** close a panel or dialog |

The rules the vocabulary keeps:

- **`mod` is written once and printed per platform.** ⌘ and glyphs run together on a Mac (`⇧⌘Z`),
  Ctrl and `+` everywhere else (`Ctrl+Shift+Z`) — `src/lib/ui/keys.ts`. Matching accepts ⌘ *or* Ctrl
  on either, as ⌘K always has. A chord is spoken to a screen reader in words ("Command Shift Z"),
  never as glyphs, and a control announces its key through `aria-keyshortcuts`
- **Never while typing.** No canvas key fires in a text field, a textarea, a select or editable
  content — `F` types an F and ⌘Z undoes the field's own typing. The one exception is **⌘S**, which
  means nothing in a field and would otherwise open the browser's *Save page as*
- **Never behind a dialog.** A key pressed inside an open `<dialog>` is the dialog's
- **Nothing the browser or React Flow already owns is bound twice**: Delete, Shift-click, the box and
  the arrow keys are React Flow's; paste is the browser's `paste` event; **⌘F stays the browser's
  find** — *find a node* is ⌘K, the shared ranking over every node's label, type and id
- **A found node takes focus**, so the next key acts on it — the arrows, Delete, ⌘D. ⌘K returns focus
  to its own button only when the chosen command left it nowhere; and it keeps each group's results
  together, so a heading is never printed twice

**The edit controls live on the canvas, not in the toolbar.** Undo, Redo, Auto-arrange and `?` sit in
React Flow's control stack under zoom and fit, set apart by a full-weight rule. The toolbar is two
rows on a 375 px phone (Phase 28) and four more buttons would make it three; the stack sits over the
canvas and costs it nothing. Their icons are strokes, where React Flow's are fills — the
`control-icon` class says so. A viewer and diff mode get only `?`.

**Several nodes selected is an inspector state of its own** — a count, what can be done to all of them
(Duplicate, Copy, a four-way *Move* pad that nudges one grid step, Delete) and the list, each row
narrowing the selection to that node. The pad exists because a drag needs a pointer. Only a
single-node selection opens a railed inspector: a box selection reports a new set on every frame, and
expanding the column mid-drag would resize the canvas under the box — the rail names the selection
instead.

### Sticky notes and the off switch — Phase 30

**A note is an object like every other**: one of five `-pop` fills — yellow, pink, blue, green,
purple, each a fill the palette already has (`lib/canvas/notes.ts`) — with an `accent-ink` label at
full strength, inside a 2px ink outline, on the hard shadow. No new colour tokens: a note's tone
carries no meaning, so it needed no new row in either theme's contrast matrix, and it is never
"colour alone" because it is never information. In Night the yellow is bronze, as every amber fill is
(D121).

- **Behind the nodes.** A note sits under the graph (`zIndex: -1`) and lifts like a card when
  selected, so it explains a corner without covering it
- **Edited in place by double-click**; Escape or a click away ends it. The keyboard path is the
  inspector, which opens on a selected note with the same text in a field and the tone as a radio
  group of swatches — the chosen one pressed in and ticked
- **Resized by its corners**, with handles drawn as small objects — elevated fill, ink outline — and
  no second frame: the note's own outline is the edge being dragged. The resizer sits *outside* the
  note's clipped box, or its handles are clipped to nothing (found in the browser)
- **On a phone a new note is typed into where it is.** Below `lg` the inspector is a drawer over the
  canvas, so a note being typed into does not open it — the drawer would cover the note with a second
  field for the same text
- **Plain text.** Nothing renders a note as HTML or Markdown
- **Not in the palette.** The palette is the registry and a note is not a node; *Add a sticky note*
  sits in the control stack beside Auto-arrange, in ⌘K, and on **N**
- **On a share link** a note keeps its place and tone and says *its text is not shared on this link* —
  never an empty note

**The off switch** is a *Run this node* switch in the inspector, whose hint says what off will do for
that node in particular — pass its input straight on, or, for a Branch, Switch or Loop, stop its path —
and *Switch off* / *Switch on* for a selection, and **D**. A trigger has no switch (a run starts at
it), and D on one says so and names the Active switch.

**Keycaps are `Keys`** (`ui/kbd.tsx`): a `<kbd>` per key inside a `<kbd>` for the chord, `bg-surface`
and an ink hairline; `joined` draws one cap, for the ⌘K button.

## The primitives

`src/components/ui/`. All of them take `className`, and the caller's class wins because it is
appended last — there is no Tailwind-aware merge, and none is needed.

| File | Exports |
|---|---|
| `button.tsx` | `Button` (tones `ink`, `primary`, `quiet`, `ghost`, `danger`), `Spinner` |
| `field.tsx` | `Labelled`, `Input`, `Textarea`, `Select`, `Checkbox`, `Switch`, `Toggle` |
| `card.tsx` | `Card` (flat / `raised`), `CardHeader` (optional `-pop` fill strip) |
| `badge.tsx` | `Badge` (`quiet` / `outline` / `pop`) — `pop` requires its `fill`, and the type refuses one without |
| `dialog.tsx` | `Dialog` — native `<dialog>`, modal |
| `toast.tsx` | `ToastProvider`, `useToast` |
| `notice.tsx` | `Notice` — the anchored message |
| `tone.ts` | `TONE`, `liveRole` — the shared message table |
| `tooltip.tsx` | `Tooltip` |
| `tabs.tsx` | `Tabs` — roving tabindex, arrows, Home/End |
| `menu.tsx` | `Menu` — arrows, Home/End, Escape, click-outside; radio items (`checked`) in a named `group`. Focus moves only over enabled items (`menu-focus.ts`) |
| `theme.tsx` | `useTheme`, `ThemeSwitch` (the Light / Dark / System radio group), `ThemeSync` |
| `kbd.tsx` | `Keys` (a chord as keycaps, spoken in words), `usePlatform` — Phase 29 |
| `illustration.tsx` | `Mascot`, `Thinking`, `EmptyState`, and the four scenes |

### Notice or toast

Both say the same kind of thing, and they take their fill, their glyph and their **word** from one
table (`ui/tone.ts`) so the same failure never announces itself two different ways.

| | Toast | Notice |
|---|---|---|
| What it reports | the result of something the user just did | the state of a region of the page |
| Where | the bottom of the viewport, over everything | in the flow, beside the thing it is about |
| How it leaves | on a timer, or a close button | when the state it describes changes |
| Reach for it when | the action could have been started from anywhere | the message belongs to one form, one card, one list |

A failure is `role="alert"` in both, shakes once in both, and in a toast uses `duration: null` so it
does not time out (WCAG 2.2.1). **Neither may be the only place the information lives** if the user
has to act on it.

The Chapter 1 shape this replaced was a translucent tint plus a hairline ring
(`bg-bad/10 ring-bad/25 ring-1`). A tint only separates from its background when the background is
dark; on cream it is a smudge. Five call sites carried a copy of it, and Phase 15 replaced all five.

**Use `Toggle`, not a hand-written `<label>` around `<Checkbox>`.** Both are correct at runtime, but
only `Toggle` puts the `<input>` literally inside the `<label>` where a linter and a reviewer can see
it — otherwise every call site needs a suppression, and one of them will eventually ship unlabelled.

**A loading button is `aria-busy`, not `disabled`.** A `disabled` button can lose its accessible name
mid-announcement and drops out of the tab order under the user's cursor.

### The shell — `src/components/shell/`

The header on every signed-in page that is not the canvas: the mark, two nav links, the search
button and the account menu. The current page is marked three ways — `aria-current`, a different
fill, and the *pressed* position — because a tab that has already been clicked should sit where a
pressed object sits.

**The command palette is ⌘K, and the button beside it is not decoration.** A palette with no visible
trigger is a feature only its author knows about; the button carries the shortcut as a `<kbd>` so
everyone else finds it.

Its ARIA shape is a combobox that owns a listbox: **focus stays in the input** and the arrow keys
move a virtual cursor through `aria-activedescendant`. Moving real focus onto the options would stop
the user typing to narrow the list, which is the entire interaction. Closing it returns focus to the
button, not to the body — `<dialog>` restores focus to whatever had it before `showModal()`, and for
a keyboard shortcut that is nothing.

### The utilities are equally first-class

`btn`, `field`, `card`, `card-raised`, `chip`, `chip-pop`, `eyebrow`, `squish`, `dotted`, `sweep-bar`
and `pad-safe` live in `globals.css`. The ~90 Chapter 1 call sites that use them directly are not
wrong and do not need migrating — a primitive and its utility are the same language. Reach for the
primitive in new code because it carries the accessibility behaviour too.

---

## What the build enforces

`npm run check` fails on any of these. None of them is a convention:

**Each of these runs once for Light and once for Toybox Night:**

- Every text-register tone clears AA on all four surfaces
- `accent-ink` clears AA as the label on every `-pop` fill
- The two registers stay at least 2× apart in luminance — fill brighter in Light, text in Night
- Ink clears 3:1 against every surface and every fill — the focus-ring rule
- The outline clears 3:1 on every fill and every surface, and some object sits flat on the page
  without it — the outline rule
- The shadow clears 3:1 on every surface, and the scrim is darker than the page
- Every token is inside sRGB, so the measured colour is the rendered colour
- The palette catalogue and the stylesheet agree in both directions

**And these once, across both:**

- Night re-declares every colour token Light declares, and no colour is declared anywhere else
- `color-scheme` is `light` on `:root` and `dark` in the Night block, and nowhere else
- Every shadow is a hard offset in `shade` with no blur, declared once
- The `dark` variant follows the reader's choice, and the OS only under System
- The select chevron (a data URI, which cannot read a variable) is each theme's own ink
- A hovered pop fill still carries its label, its outline and the ring — every fill, each theme's
  `--pop-hover-white` (D125) — and white is mixed into a colour nowhere else
- **Every colour utility in `src/` compiles to CSS** — `utilities.test.ts`, D124
- **No control removes the focus ring** (`outline-none`), except the ⌘K input, listed with its
  reason — `utilities.test.ts`, Phase 28
- **The fill's label is never dimmed** — no opacity modifier on `text-accent-ink` — and a `pop`
  badge without a `fill` does not typecheck (D126)
- Every file that renders an `<html>` applies the theme before it paints — `theme.test.ts`
- `public/illustrations/*.svg`, both themes, and the favicon are byte-identical to a fresh export

The maths is in `src/lib/design/contrast.ts` and is shared with the gallery, so **the number on the
`/design` page is the number in the gate.** A gallery quoting figures from a hand-kept table would be
wrong within a phase.

---

## Traps, learned the hard way

| Trap | What happened |
|---|---|
| **A radial gradient is clipped by its own box** | Chapter 1's hero glow became a hard vertical rectangle down both sides of the cream landing page. Only visible in a browser against a built page. The fix that replaced it is the dot texture, masked so it fades well inside its own bounds — and the *first* fix used 88% mask radii, which reproduced the very seam it was fixing. Mask radii must be under 50% |
| **A soft glow is a dark-UI idiom** | Depth from a light source does not survive the move to cream. Toybox gets depth from outlines and hard shadows. There are no gradients in artwork |
| **A stale local server serves stale CSS** | Port 3100 was held by a detached process from an earlier launch, so `EADDRINUSE` killed the new server silently and three rounds of screenshots showed the old stylesheet. `lsof -nP -iTCP:<port> -sTCP:LISTEN` before believing a local check — the same trap `PROGRESS.md` already records for port 3000 |
| **`.tsx` files never appear in the coverage report** | Node's coverage only counts modules a test loads, and no test loads a component. The Chapter 1 note predicting that a design-system phase would break the function-coverage threshold was wrong: coverage went **up**, because the new `.ts` modules are all tested |
| **A closed `<dialog>` still holds its heading** | A confirm dialog kept mounted so it can close itself renders its `<h2>` into the document whether it is open or not, and a template literal in that title prints `Delete "undefined"?` the moment the row it was about is cleared. Guard the title, or unmount the dialog |
| **A reusable component may not hardcode an `id`** | The same trap one level up, and it survived from Phase 14 to Phase 25. `Dialog` carried `aria-labelledby="dialog-title"` and an `<h2 id="dialog-title">`. Correct for one dialog per document; the canvas mounts **two** — share, and version history — and because a closed `<dialog>` still renders its heading, the page held two elements with one id. `aria-labelledby` resolves to the **first** match, so the history dialog was announced to a screen reader with the share dialog's name. Nothing looked wrong and nothing failed. Found by `scripts/verify-a11y.mjs` as a duplicate id; fixed with `useId()`; guarded by `src/components/ui/primitives.test.ts`, which reads the primitives as text and fails on a literal `id` or a literal ARIA reference |
| **A control can be a perfectly good button and still miss WCAG 2.5.8** | The onboarding guide's step rows were 896 px wide and **20 px tall** — under the 24 px minimum target size, in the dimension nobody checks. The spacing exception technically rescued them (the steps are 55 px apart, so the 24 px circles never intersect), which is exactly the kind of reasoning that should not be load-bearing for a control one class can fix. `min-h-6`. **Measured in a browser with `getBoundingClientRect`, not read off the CSS** — the height came from line-height and padding that no single declaration stated |
| **A filled animation silently kills a utility on the same element** | `animate-rise` uses `animation-fill-mode: both`, so after it ends the keyframe *keeps* `opacity: 1` applied — and a filled animation outranks an ordinary declaration. `opacity-65` on the skipped node card was in the DOM and did **nothing**. Found by `getComputedStyle` in a browser; no test in the repo could see it. The entry animation now lives on a wrapper. **A class being in the DOM is not evidence that it applies.** The near-miss worth knowing: `-translate-x-px` was *unaffected*, because Tailwind 4 compiles it to the `translate` property while the keyframe animates `transform` |
| **An arbitrary-value colour can drop its opacity modifier silently** | `divide-[--color-line]/40` on the vault's log list. `divide-y` applied; the `/40` did **not**, so every row was separated by a full-strength ink rule inside an already-outlined well — the one thing `--color-line-soft` exists to prevent. Nothing failed: the class was in the DOM, the build passed, and `getComputedStyle` in a browser was the only thing that could see `1px solid ink` where `1px solid ink/0.16` was meant. **Reach for the token the system already has** — `divide-line-soft` — rather than writing an arbitrary value that looks equivalent |
| **A fuzzy search tier is noise against a sentence** | A subsequence match means something against a short *name* and nothing against a description: any long sentence contains almost any five-letter subsequence. Feeding node descriptions to the shared ranking made `gmail` match **7 of 15** nodes. The fuzzy tier now applies to a title alone; substring and word-start matching on a subtitle are untouched |
| **React Flow's `colorMode` is a trap even when it looks inert** | The canvas shipped `colorMode="dark"` through Phase 15 on a light-first product. It changed almost nothing visible — React Flow's node colours only reach its *built-in* node types, and Phase 14 had overridden the variables that mattered — but every variable **not** overridden was falling back to a dark default, waiting for the next person to add one |
| **A class that names a missing token compiles to nothing, silently** | `bg-lift` reached for a `--color-lift` that never existed, and six elements shipped with no background from Phase 19A to Phase 27; `text-ok-ink` and `text-warn-ink` did the same to two messages. Tailwind does not warn. `utilities.test.ts` now asks Tailwind's own compiler about every colour utility in `src/` (D124) |
| **A fill's label without the fill is an empty capsule in Night** | Seven badges were `tone="pop"` with no `bg-*-pop` — "private", "public link", "switched off", a member count, a role, "shared read-only", "Invitation". `chip-pop` sets `accent-ink`, which is near-black in both themes, so each drew a near-black word on whatever was behind it: a deliberate-looking outlined pill on cream, **1.06:1** on indigo. Every token pair was legal, so no gate could see it; `scripts/contrast-audit.browser.js` found it in one pass of the signed-in pages. A pill without a fill is `outline` now (`ink`, identical in Light), and `pop` without a `fill` does not typecheck |
| **A dimmed label on a fill is under AA** | `text-accent-ink/70` — a count on the active filter tab — measured **3.77:1** on the grape fill, in Light. The label clears AA on every fill at full strength and has no margin to spend; `utilities.test.ts` refuses an opacity modifier on it |
| **A menu that focuses item 0 is dead when item 0 is disabled** | The account menu's first row is the signed-in address, disabled. `focus()` on a disabled button does nothing, so opening the menu from the keyboard left focus on the trigger — and the items are `tabIndex={-1}`, so Settings, the theme and Sign out were unreachable without a pointer. `/design`'s menu, whose first item is enabled, could never show it. Focus now moves over enabled items only (`menu-focus.ts`, tested) |
| **A label colour set on a container reaches everything inside it** | `CardHeader` set `accent-ink` on its whole strip, so the quiet badge in its `aside` — which paints its own dark pill — inherited a near-black word. Invisible in Light, where the two inks are equal; an empty capsule in Night. Set the label on the label. The same applies to any neutral object placed on a fill: it names its own text colour (`chip bg-surface text-ink` in the diff bar) |
| **An inline `style` cannot be themed** | The select chevron was an inline data URI with a near-black stroke; no class can override an inline style, so it stayed near-black on Night's indigo. It is the `select-chevron` utility now, with a `dark` variant |
| **A style that names the wrong property applies nothing, silently** | The canvas's dot grid set `color` on React Flow's pattern, and React Flow paints each dot with `fill` from its own variable, `--xy-background-pattern-color` — so from Phase 14 to Phase 28 the dots were React Flow's grey, not ink, and in Night they would have been its dark-mode grey. Point a third-party component at the variable it actually reads; read its stylesheet to find out which |
| **A script React renders on the client never runs** | Phase 28's first fix for `global-error.tsx` copied the root layout's blocking theme script into it. A probe build showed Next 16 never server-renders that file — it renders it into a bare shell on the client — so the script was dead code that looked like the fix. `ThemeSync` was what actually worked, and is all the page carries now |
| **A lint rule can be wrong about a native element** | `role="switch"` on `input[type=checkbox]` is explicitly allowed by ARIA in HTML and its `checked` maps to `aria-checked`; adding `aria-checked` would create a second source of truth. Suppressed inline, with the reason, per the project convention |

---

## Changing this system

1. Change `src/app/globals.css` — the stylesheet is the source of truth for values. **A colour has
   two values**: Light in `@theme`, Night in the `@variant dark` block at the end of `:root`
2. Mirror both in `src/lib/design/palette.ts` (`light` and `dark`), or CI fails on the drift gate
3. Run `npm run check`. If a contrast gate fails, **the token is wrong, not the gate**
4. If a colour moved, run `npm run design:export` and commit the regenerated SVGs
5. Look at `/design` in a real browser **in both themes**. Every phase of this project that drove a
   browser found something the test suite could not see — Phase 14 was no exception, and Phase 27
   found three things in Night that no gate could
6. Run **`scripts/contrast-audit.browser.js`** in the browser on every screen the change touches, in
   both themes — evaluate the file in the page; an empty list is a pass. The gates prove the tokens;
   the audit proves the pairs a component actually draws. It is how Phase 28 found seven badges at
   1.06:1 in Night and a dimmed label at 3.77:1 in Light
