import type { Oklch } from "./contrast";

/**
 * The palette catalogue: every colour token, what it is for, and its value.
 *
 * This is a MIRROR of `src/app/globals.css`, not a second source of truth. The
 * stylesheet is what the browser reads; this is what the gallery at `/design` reads,
 * so it can print a measured contrast ratio and a role next to each swatch.
 * `src/app/tokens.test.ts` asserts the two agree in both directions — every triple
 * here matches the stylesheet, and every `--color-*` in the stylesheet appears here
 * — so the mirror cannot drift without failing CI.
 *
 * It exists rather than the gallery reading `globals.css` off disk because a
 * `readFileSync` in a page is a build-versus-runtime trap: it resolves against the
 * source tree during prerender and against the bundle inside the container, and the
 * failure only shows up in production. It also carries the one thing CSS cannot —
 * a sentence saying what each token is for.
 *
 * `register` is the rule the whole palette turns on:
 *
 *   `text`     dark and saturated. Safe as text on any surface, and as a small
 *              graphic. The default register
 *   `fill`     bright and saturated. A background only, always with an ink label
 *              and always with an ink outline
 *   `surface`  a page or panel background
 *   `ink`      the text and outline family
 */
export type Register = "surface" | "ink" | "text" | "fill";

export type TokenSpec = {
  /** The token name without the `--color-` prefix. */
  name: string;
  value: Oklch;
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
    note: "Cream page, paper card, white lifted object, deeper cream recess. The steps between them are deliberately small: an object is separated from the page by its outline and its shadow, never by being a paler shade.",
    tokens: [
      { name: "canvas", value: [0.968, 0.031, 88], register: "surface", role: "The page" },
      { name: "surface", value: [0.993, 0.008, 90], register: "surface", role: "A card, a panel" },
      { name: "elevated", value: [1, 0, 0], register: "surface", role: "A node, a dialog, a popover" },
      { name: "sunken", value: [0.936, 0.042, 86], register: "surface", role: "An input well, a log list" },
    ],
  },
  {
    title: "Ink",
    note: "Text, and the outline every object in the system wears. All three clear WCAG AA on all four surfaces — including the faintest, which was not true of the Chapter 1 dark palette.",
    tokens: [
      { name: "ink", value: [0.205, 0.024, 272], register: "ink", role: "Body text" },
      { name: "line", value: [0.205, 0.024, 272], register: "ink", role: "The outline every object wears, at 2px. Ink by another name, so a later phase can tint outlines without tinting text" },
      { name: "muted", value: [0.46, 0.028, 272], register: "ink", role: "Captions, help text, log lines" },
      { name: "faint", value: [0.52, 0.028, 272], register: "ink", role: "Placeholders, footnotes, digests" },
    ],
  },
  {
    title: "Accent",
    note: "Grape. The text register is the default — it is what a link and a label use. The pop fill is what a primary button uses, and its label is always ink.",
    tokens: [
      { name: "accent", value: [0.515, 0.2, 302], register: "text", role: "Links, selected labels, the traversed edge" },
      { name: "accent-pop", value: [0.7, 0.19, 302], register: "fill", role: "The primary button, the selected tab" },
      { name: "accent-ink", value: [0.205, 0.024, 272], register: "ink", role: "The label on any pop fill" },
      { name: "spark", value: [0.845, 0.144, 195], register: "fill", role: "The second gradient hue, and the run sweep. Never text" },
    ],
  },
  {
    title: "Status",
    note: "The engine's four step outcomes. Status is never carried by colour alone — every use pairs the tone with a word, an icon or a position.",
    tokens: [
      { name: "ok", value: [0.48, 0.113, 158], register: "text", role: "Succeeded" },
      { name: "ok-pop", value: [0.845, 0.198, 158], register: "fill", role: "A success badge or toast" },
      { name: "live", value: [0.49, 0.1, 232], register: "text", role: "Running" },
      { name: "live-pop", value: [0.8, 0.123, 232], register: "fill", role: "A running badge, the live edge" },
      { name: "warn", value: [0.495, 0.102, 86], register: "text", role: "Skipped, or a validation warning" },
      { name: "warn-pop", value: [0.88, 0.135, 86], register: "fill", role: "A warning panel's marker" },
      { name: "bad", value: [0.52, 0.2, 25], register: "text", role: "Failed" },
      { name: "bad-pop", value: [0.72, 0.174, 25], register: "fill", role: "A destructive button, an error marker" },
    ],
  },
  {
    title: "Node categories",
    note: "Trigger, logic and integration deliberately share a hue with ok, live and warn: a trigger is the “go” of a graph, and one hue meaning one thing is worth more than five more colours. Shape, icon and label carry the distinction.",
    tokens: [
      { name: "cat-trigger", value: [0.48, 0.113, 158], register: "text", role: "Trigger nodes" },
      { name: "cat-trigger-pop", value: [0.845, 0.198, 158], register: "fill", role: "A trigger node's colour band" },
      { name: "cat-agent", value: [0.52, 0.2, 335], register: "text", role: "Agent and LLM nodes" },
      { name: "cat-agent-pop", value: [0.755, 0.21, 335], register: "fill", role: "An agent node's colour band" },
      { name: "cat-logic", value: [0.49, 0.1, 232], register: "text", role: "Branch, loop, delay" },
      { name: "cat-logic-pop", value: [0.8, 0.123, 232], register: "fill", role: "A logic node's colour band" },
      { name: "cat-transform", value: [0.485, 0.083, 195], register: "text", role: "Set, assert, log" },
      { name: "cat-transform-pop", value: [0.845, 0.144, 195], register: "fill", role: "A transform node's colour band" },
      { name: "cat-integration", value: [0.495, 0.102, 86], register: "text", role: "HTTP, Discord, Sheets, Gmail" },
      { name: "cat-integration-pop", value: [0.88, 0.135, 86], register: "fill", role: "An integration node's colour band" },
    ],
  },
];

/** Every token in the catalogue, flat. */
export const ALL_TOKENS: TokenSpec[] = PALETTE.flatMap((group) => group.tokens);

/** The four surfaces, in the order the gallery grids them. */
export const SURFACE_NAMES = ["canvas", "surface", "elevated", "sunken"] as const;

export function tokenValue(name: string): Oklch {
  const spec = ALL_TOKENS.find((t) => t.name === name);
  if (!spec) throw new Error(`no token named --color-${name} in the palette catalogue`);
  return spec.value;
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

/** The elevation scale. Every value is a hard ink offset with no blur. */
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
