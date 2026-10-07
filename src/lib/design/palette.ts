import type { Oklch } from "./contrast";

/**
 * The palette catalogue: every colour token, what it is for, and its value in each
 * theme.
 *
 * This is a MIRROR of `src/app/globals.css`, not a second source of truth. The
 * stylesheet is what the browser reads; this is what the gallery at `/design` reads,
 * so it can print a measured contrast ratio and a role next to each swatch.
 * `src/app/tokens.test.ts` asserts the two agree in both directions **for each theme**
 * — every triple here matches the stylesheet's block for that theme, and every
 * `--color-*` in either block appears here — so the mirror cannot drift without
 * failing CI.
 *
 * It exists rather than the gallery reading `globals.css` off disk because a
 * `readFileSync` in a page is a build-versus-runtime trap: it resolves against the
 * source tree during prerender and against the bundle inside the container, and the
 * failure only shows up in production. It also carries the one thing CSS cannot —
 * a sentence saying what each token is for.
 *
 * `register` is the rule the whole palette turns on, and says what a token may do —
 * which is also what the gallery measures it against:
 *
 *   `text`     saturated and safe as text on any surface, and as a small graphic.
 *              The default register. Dark in Light, bright in Night
 *   `fill`     saturated, a background only, always with the `accent-ink` label and
 *              always inside the `line` outline
 *   `surface`  a page or panel background
 *   `ink`      body text and its quieter steps
 *   `label`    the label on a fill — `accent-ink`, and nothing else
 *   `line`     a non-text graphic that must clear 3:1: the outline, and the shadow
 *   `backdrop` drawn translucent behind a modal, so it has no fixed contrast
 */
export type Register = "surface" | "ink" | "label" | "line" | "backdrop" | "text" | "fill";

/** The two palettes. `system` is a preference, not a palette — it resolves to one of these. */
export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

/** What each theme is called where a person reads it. */
export const THEME_LABEL: Record<Theme, string> = { light: "Light", dark: "Toybox Night" };

export type TokenSpec = {
  /** The token name without the `--color-` prefix. */
  name: string;
  /** Its value in Light — the default theme, and the reference. */
  light: Oklch;
  /** Its value in Toybox Night. */
  dark: Oklch;
  register: Register;
  /** What it is for, in one line. Printed in the gallery. */
  role: string;
};

export type TokenGroup = {
  title: string;
  /** Why the group exists, and the rule that governs it. */
  note: string;
  tokens: TokenSpec[];
};

export const PALETTE: TokenGroup[] = [
  {
    title: "Surfaces",
    note: "In Light: cream page, paper card, white lifted object, deeper cream recess. In Night the same four, in indigo, in the same order. The steps between them are deliberately small in both: an object is separated from the page by its outline and its shadow, never by being a paler shade.",
    tokens: [
      { name: "canvas", light: [0.968, 0.031, 88], dark: [0.21, 0.04, 280], register: "surface", role: "The page" },
      { name: "surface", light: [0.993, 0.008, 90], dark: [0.232, 0.042, 280], register: "surface", role: "A card, a panel" },
      { name: "elevated", light: [1, 0, 0], dark: [0.255, 0.044, 280], register: "surface", role: "A node, a dialog, a popover" },
      { name: "sunken", light: [0.936, 0.042, 86], dark: [0.185, 0.036, 280], register: "surface", role: "An input well, a log list" },
    ],
  },
  {
    title: "Ink and line",
    note: "Text, the outline every object wears, and the hard shadow under it. In Light they are one near-black; in Night text, outline and shadow are cream, because a dark line on a dark page is invisible. All three text steps clear WCAG AA on all four surfaces in both themes — including the faintest, which was not true of the Chapter 1 dark palette.",
    tokens: [
      { name: "ink", light: [0.205, 0.024, 272], dark: [0.96, 0.022, 88], register: "ink", role: "Body text, and the focus ring" },
      { name: "muted", light: [0.46, 0.028, 272], dark: [0.8, 0.03, 280], register: "ink", role: "Captions, help text, log lines" },
      { name: "faint", light: [0.52, 0.028, 272], dark: [0.74, 0.032, 280], register: "ink", role: "Placeholders, footnotes, digests" },
      { name: "line", light: [0.205, 0.024, 272], dark: [0.96, 0.022, 88], register: "line", role: "The outline every object wears, at 2px. Its own name since Phase 27, so the outline can differ from the text" },
      { name: "shade", light: [0.205, 0.024, 272], dark: [0.96, 0.022, 88], register: "line", role: "The hard offset shadow. Every shadow-* utility draws in it" },
      { name: "scrim", light: [0.205, 0.024, 272], dark: [0.1, 0.02, 280], register: "backdrop", role: "Behind a modal, at 25–35%. Darkens the page in both themes" },
    ],
  },
  {
    title: "Accent",
    note: "Grape. The text register is the default — it is what a link and a label use. The pop fill is what a primary button uses, and its label is always accent-ink, the same near-black in both themes.",
    tokens: [
      { name: "accent", light: [0.515, 0.2, 302], dark: [0.819, 0.106, 302], register: "text", role: "Links, selected labels, the traversed edge" },
      { name: "accent-pop", light: [0.7, 0.19, 302], dark: [0.643, 0.2, 302], register: "fill", role: "The primary button, the selected tab" },
      { name: "accent-ink", light: [0.205, 0.024, 272], dark: [0.205, 0.024, 272], register: "label", role: "The label on any pop fill. Never cream, in either theme" },
      { name: "spark", light: [0.845, 0.144, 195], dark: [0.61, 0.101, 195], register: "fill", role: "The second gradient hue, and the run sweep. Never text" },
    ],
  },
  {
    title: "Status",
    note: "The engine's four step outcomes. Status is never carried by colour alone — every use pairs the tone with a word, an icon or a position.",
    tokens: [
      { name: "ok", light: [0.48, 0.113, 158], dark: [0.788, 0.179, 158], register: "text", role: "Succeeded" },
      { name: "ok-pop", light: [0.845, 0.198, 158], dark: [0.605, 0.138, 158], register: "fill", role: "A success badge or toast" },
      { name: "live", light: [0.49, 0.1, 232], dark: [0.803, 0.117, 232], register: "text", role: "Running" },
      { name: "live-pop", light: [0.8, 0.123, 232], dark: [0.615, 0.122, 232], register: "fill", role: "A running badge, the live edge" },
      { name: "warn", light: [0.495, 0.102, 86], dark: [0.814, 0.163, 82], register: "text", role: "Skipped, or a validation warning" },
      { name: "warn-pop", light: [0.88, 0.135, 86], dark: [0.625, 0.126, 82], register: "fill", role: "A warning panel's marker" },
      { name: "bad", light: [0.52, 0.2, 25], dark: [0.82, 0.098, 25], register: "text", role: "Failed" },
      { name: "bad-pop", light: [0.72, 0.174, 25], dark: [0.645, 0.2, 25], register: "fill", role: "A destructive button, an error marker" },
    ],
  },
  {
    title: "Node categories",
    note: "Trigger, logic and integration deliberately share a hue with ok, live and warn: a trigger is the “go” of a graph, and one hue meaning one thing is worth more than five more colours. Shape, icon and label carry the distinction.",
    tokens: [
      { name: "cat-trigger", light: [0.48, 0.113, 158], dark: [0.788, 0.179, 158], register: "text", role: "Trigger nodes" },
      { name: "cat-trigger-pop", light: [0.845, 0.198, 158], dark: [0.605, 0.138, 158], register: "fill", role: "A trigger node's colour band" },
      { name: "cat-agent", light: [0.52, 0.2, 335], dark: [0.827, 0.139, 335], register: "text", role: "Agent and LLM nodes" },
      { name: "cat-agent-pop", light: [0.755, 0.21, 335], dark: [0.649, 0.21, 335], register: "fill", role: "An agent node's colour band" },
      { name: "cat-logic", light: [0.49, 0.1, 232], dark: [0.803, 0.117, 232], register: "text", role: "Branch, loop, delay" },
      { name: "cat-logic-pop", light: [0.8, 0.123, 232], dark: [0.615, 0.122, 232], register: "fill", role: "A logic node's colour band" },
      { name: "cat-transform", light: [0.485, 0.083, 195], dark: [0.794, 0.132, 195], register: "text", role: "Set, assert, log" },
      { name: "cat-transform-pop", light: [0.845, 0.144, 195], dark: [0.61, 0.101, 195], register: "fill", role: "A transform node's colour band" },
      { name: "cat-integration", light: [0.495, 0.102, 86], dark: [0.814, 0.163, 82], register: "text", role: "HTTP, Discord, Sheets, Gmail" },
      { name: "cat-integration-pop", light: [0.88, 0.135, 86], dark: [0.625, 0.126, 82], register: "fill", role: "An integration node's colour band" },
    ],
  },
];

/** Every token in the catalogue, flat. */
export const ALL_TOKENS: TokenSpec[] = PALETTE.flatMap((group) => group.tokens);

/** The four surfaces, in the order the gallery grids them. */
export const SURFACE_NAMES = ["canvas", "surface", "elevated", "sunken"] as const;

export function tokenValue(name: string, theme: Theme = "light"): Oklch {
  const spec = ALL_TOKENS.find((t) => t.name === name);
  if (!spec) throw new Error(`no token named --color-${name} in the palette catalogue`);
  return spec[theme];
}

/** The type scale, for the gallery's specimen block. */
export const TYPE_SCALE = [
  { token: "text-3xs", px: "10px", role: "Status badges, handle labels" },
  { token: "text-2xs", px: "11px", role: "Captions, log lines, help text" },
  { token: "text-xs", px: "12px", role: "Dense secondary text" },
  { token: "text-ui", px: "13px", role: "Form controls and buttons" },
  { token: "text-sm", px: "14px", role: "Body text" },
  { token: "text-base", px: "16px", role: "A card or dialog heading" },
  { token: "text-xl", px: "20px", role: "A section heading" },
  { token: "text-3xl", px: "30px", role: "A page heading" },
] as const;

/** The elevation scale. Every value is a hard offset in `shade`, with no blur. */
export const ELEVATION = [
  { token: "shadow-flat", offset: "2px", role: "A checkbox, a switch — something small and fixed" },
  { token: "shadow-card", offset: "3px", role: "A button, a card, a badge" },
  { token: "shadow-node", offset: "4px", role: "A node card, a dialog, a toast" },
  { token: "shadow-lift", offset: "5px", role: "The hover state of anything with shadow-card" },
  { token: "shadow-drawer", offset: "6px", role: "A panel that slides over the page" },
  { token: "shadow-press", offset: "1px", role: "The pressed state — the object has moved into the page" },
] as const;

/** The motion vocabulary. Six named states, and nothing outside this list. */
export const MOTION = [
  { name: "press", animation: null, role: "An object moves down-right into the page and its shadow shrinks. Every button, every tab.", duration: "120ms" },
  { name: "hover-lift", animation: null, role: "The same object rises up-left and its shadow grows.", duration: "120ms" },
  { name: "enter", animation: "animate-rise", role: "Something arriving: up, with a small overshoot.", duration: "380ms" },
  { name: "appear", animation: "animate-pop", role: "Something appearing in place: a dialog, a tooltip, a menu.", duration: "200ms" },
  { name: "success", animation: "animate-boing", role: "A settled overshoot. The toy landing in its slot.", duration: "380ms" },
  { name: "failure", animation: "animate-wiggle", role: "A tight, short shake. “Look here”, not “your work is gone”.", duration: "420ms" },
  { name: "waiting", animation: "animate-think", role: "Three dots bobbing in sequence. The agent is thinking.", duration: "1.25s loop" },
  { name: "idle", animation: "animate-float", role: "The mascot's bob. Decoration, and the only infinite motion that is not a status.", duration: "3.4s loop" },
] as const;
