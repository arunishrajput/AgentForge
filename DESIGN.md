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
2. **The label on any `-pop` fill is `--color-ink`.** Never white. Every fill in the palette clears
   AA against ink (worst case 6.2:1) and none of them clears it against white.
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

`--color-line` is the outline. It is ink by another name so a later phase can tint outlines without
tinting text.

### Hue assignments

Accent is grape. Status is `ok` green, `live` blue, `warn` amber, `bad` red. Node categories are
trigger, agent, logic, transform, integration.

**Trigger, logic and integration deliberately share a hue with ok, live and warn.** A trigger is the
"go" of a graph; one hue meaning one thing is worth more than five more colours. The distinction is
carried by shape, icon and label — see *Never colour alone*.

---

## Shape, elevation and the press

### Corners

Fat. The Tailwind radius scale is retargeted in `@theme`, so `rounded-lg` and friends already mean
the Toybox radius — a component does not opt in.

### Shadows

A **hard ink offset**, down-right, **no blur and no spread**. Blur reads as a drop shadow; the hard
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
cannot read a CSS variable. `illustrations-static.test.ts` regenerates them in memory and compares
byte for byte, so **a colour token change fails CI until the export is re-run.** Do not hand-edit
them.

---

## Accessibility — the constraints, not a checklist

### One focus ring, and it is ink

2.5px solid ink, 3px offset, `:focus-visible` only. **No control anywhere sets `outline-none`.**

It is ink rather than the accent because of a measurement: WCAG 2.2 SC 1.4.11 wants 3:1 for a focus
indicator, the accent fill is **2.6:1** against cream, and ink is **16.4:1** there and never below
**6.2:1** on any fill in the system. One ink ring is therefore legal everywhere. The 3px offset
leaves a gap of page colour between an object's own outline and the ring, which is what stops the two
reading as one thicker border.

The one arrangement this does not survive is an ink object on an ink background. There is none, and
if a later phase adds one it needs a cream ring there.

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

A greyscale screenshot of a run still reads: dashed and recessed was skipped, bobbing is working,
ticked finished.

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

### The run panel is the quiet register

**No mascot here, and that is a rule rather than an omission.** Sparky is allowed as a small
thinking indicator and forbidden in the quiet register, and a log *is* the quiet register. A running
step gets the bobbing dots in its chip — the same `waiting` motion, without putting a face in a log.

Three things make an agent's reasoning readable: a step is **named** by its label rather than its
raw id, every log line carries its **offset from the step's start** (`+3.4s`), and the log block
sits **outside** the click target so it can be selected and copied.

---

## The primitives

`src/components/ui/`. All of them take `className`, and the caller's class wins because it is
appended last — there is no Tailwind-aware merge, and none is needed.

| File | Exports |
|---|---|
| `button.tsx` | `Button` (tones `ink`, `primary`, `quiet`, `ghost`, `danger`), `Spinner` |
| `field.tsx` | `Labelled`, `Input`, `Textarea`, `Select`, `Checkbox`, `Switch`, `Toggle` |
| `card.tsx` | `Card` (flat / `raised`), `CardHeader` (optional `-pop` fill strip) |
| `badge.tsx` | `Badge` (`quiet` / `pop`) |
| `dialog.tsx` | `Dialog` — native `<dialog>`, modal |
| `toast.tsx` | `ToastProvider`, `useToast` |
| `notice.tsx` | `Notice` — the anchored message |
| `tone.ts` | `TONE`, `liveRole` — the shared message table |
| `tooltip.tsx` | `Tooltip` |
| `tabs.tsx` | `Tabs` — roving tabindex, arrows, Home/End |
| `menu.tsx` | `Menu` — arrows, Home/End, Escape, click-outside |
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

- Every text-register tone clears AA on all four surfaces
- Ink clears AA as the label on every `-pop` fill
- The two registers stay at least 2× apart in luminance
- Ink clears 3:1 against every surface and every fill — the focus-ring rule
- The ink outline clears 3:1 on every fill and on the page — the outline rule
- Every token is inside sRGB, so the measured colour is the rendered colour
- Every shadow is a hard ink offset with no blur
- `color-scheme` is `light`
- The palette catalogue and the stylesheet agree in both directions
- `public/illustrations/*.svg` are byte-identical to a fresh export

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
| **A filled animation silently kills a utility on the same element** | `animate-rise` uses `animation-fill-mode: both`, so after it ends the keyframe *keeps* `opacity: 1` applied — and a filled animation outranks an ordinary declaration. `opacity-65` on the skipped node card was in the DOM and did **nothing**. Found by `getComputedStyle` in a browser; no test in the repo could see it. The entry animation now lives on a wrapper. **A class being in the DOM is not evidence that it applies.** The near-miss worth knowing: `-translate-x-px` was *unaffected*, because Tailwind 4 compiles it to the `translate` property while the keyframe animates `transform` |
| **A fuzzy search tier is noise against a sentence** | A subsequence match means something against a short *name* and nothing against a description: any long sentence contains almost any five-letter subsequence. Feeding node descriptions to the shared ranking made `gmail` match **7 of 15** nodes. The fuzzy tier now applies to a title alone; substring and word-start matching on a subtitle are untouched |
| **React Flow's `colorMode` is a trap even when it looks inert** | The canvas shipped `colorMode="dark"` through Phase 15 on a light-first product. It changed almost nothing visible — React Flow's node colours only reach its *built-in* node types, and Phase 14 had overridden the variables that mattered — but every variable **not** overridden was falling back to a dark default, waiting for the next person to add one |
| **A lint rule can be wrong about a native element** | `role="switch"` on `input[type=checkbox]` is explicitly allowed by ARIA in HTML and its `checked` maps to `aria-checked`; adding `aria-checked` would create a second source of truth. Suppressed inline, with the reason, per the project convention |

---

## Changing this system

1. Change `src/app/globals.css` — the stylesheet is the source of truth for values
2. Mirror the change in `src/lib/design/palette.ts`, or CI fails on the drift gate
3. Run `npm run check`. If a contrast gate fails, **the token is wrong, not the gate**
4. If a colour moved, run `npm run design:export` and commit the regenerated SVGs
5. Look at `/design` in a real browser. Every phase of this project that drove a browser found
   something the test suite could not see, and Phase 14 was no exception
