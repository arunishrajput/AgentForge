import { hex } from "./contrast";
import { tokenValue } from "./palette";

/**
 * Standalone SVG copies of the mascot and one empty-state scene, for the README, the
 * docs site and anywhere else an `<img src>` is the only option.
 *
 * They exist because an `<img>` cannot read a CSS variable: the components in
 * `src/components/ui/illustration.tsx` reference `var(--color-*)` so a token change
 * carries the artwork with it, and that is exactly what breaks outside the app.
 *
 * The colours here are resolved from the palette catalogue rather than typed in, and
 * `illustrations-static.test.ts` regenerates the files in memory and compares them to
 * what is on disk — so a token change fails CI until `npm run design:export` is run.
 * That is the whole reason this is a module and not four hand-drawn files.
 */

// The same roles `illustration.tsx` draws with: the outline, the label on a pop fill (Sparky's
// face), and the hard shadow. All three are one near-black in Light, which is all these
// files are drawn in today.
const line = () => hex(tokenValue("line"));
const label = () => hex(tokenValue("accent-ink"));
const shade = () => hex(tokenValue("shade"));
const c = (name: string) => hex(tokenValue(name));

type Mood = "happy" | "thinking" | "concerned";

function mascot(mood: Mood): string {
  const stroke = `stroke="${line()}" stroke-width="3" stroke-linejoin="round"`;
  const face = `stroke="${label()}" stroke-width="3" stroke-linejoin="round"`;

  const brows =
    mood === "concerned"
      ? `\n  <path d="M19 30l8 -3" fill="none" stroke-linecap="round" ${face}/>` +
        `\n  <path d="M45 30l-8 -3" fill="none" stroke-linecap="round" ${face}/>`
      : "";

  const features =
    mood === "thinking"
      ? `\n  <circle cx="26" cy="33" r="4" fill="${label()}"/>` +
        `\n  <circle cx="42" cy="33" r="4" fill="${label()}"/>` +
        `\n  <circle cx="32" cy="43" r="3" fill="none" ${face}/>`
      : `\n  <circle cx="24" cy="36" r="4.2" fill="${label()}"/>` +
        `\n  <circle cx="40" cy="36" r="4.2" fill="${label()}"/>` +
        (mood === "happy"
          ? `\n  <path d="M25 44q7 6 14 0" fill="none" stroke-linecap="round" ${face}/>`
          : `\n  <path d="M26 45h12" fill="none" stroke-linecap="round" ${face}/>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="Sparky, the AgentForge mascot, looking ${mood}">
  <title>Sparky — ${mood}</title>
  <path d="M32 3c5 6 9 9 9 13a9 9 0 0 1-18 0c0-4 4-7 9-13z" fill="${c("warn-pop")}" ${stroke}/>
  <path d="M20 50h7v6h-7z" fill="${line()}"/>
  <path d="M37 50h7v6h-7z" fill="${line()}"/>
  <rect x="9" y="20" width="46" height="32" rx="12" fill="${c("accent-pop")}" ${stroke}/>${brows}${features}
</svg>
`;
}

/** The node card glyph, shared by the scenes. */
function nodeGlyph(x: number, y: number, fill: string, width = 34): string {
  const stroke = `stroke="${line()}" stroke-width="3" stroke-linejoin="round"`;
  return `
  <rect x="${x + 3}" y="${y + 3}" width="${width}" height="22" rx="6" fill="${shade()}"/>
  <rect x="${x}" y="${y}" width="${width}" height="22" rx="6" fill="${c("elevated")}" ${stroke}/>
  <rect x="${x + 5}" y="${y + 5}" width="8" height="8" rx="3" fill="${fill}" stroke="${line()}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M${x + 17} ${y + 9}h${width - 22}" stroke="${c("muted")}" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M${x + 17} ${y + 15}h${width - 27}" stroke="${c("faint")}" stroke-width="2.5" stroke-linecap="round"/>`;
}

function workbench(): string {
  const stroke = `stroke="${line()}" stroke-width="3" stroke-linejoin="round"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 110" width="320" height="220" role="img" aria-label="An empty workbench with two node cards and a waiting slot">
  <title>Nothing built yet</title>
  <rect x="6" y="78" width="148" height="16" rx="7" fill="${c("warn-pop")}" ${stroke}/>
  <path d="M22 94v10M138 94v10" stroke-linecap="round" fill="none" ${stroke}/>${nodeGlyph(18, 30, c("cat-trigger-pop"))}${nodeGlyph(66, 48, c("cat-agent-pop"))}
  <rect x="114" y="30" width="34" height="22" rx="6" fill="none" stroke="${line()}" stroke-width="3" stroke-dasharray="6 5" stroke-linecap="round"/>
  <path d="M131 35v12M125 41h12" stroke-linecap="round" fill="none" ${stroke}/>
  <path d="M52 41q14 0 14 13" fill="none" stroke-linecap="round" stroke="${line()}" stroke-width="3"/>
</svg>
`;
}

/** Published path → file contents. The single source of truth for both. */
export function renderStaticIllustrations(): Map<string, string> {
  return new Map([
    ["mascot-happy.svg", mascot("happy")],
    ["mascot-thinking.svg", mascot("thinking")],
    ["mascot-concerned.svg", mascot("concerned")],
    ["empty-workbench.svg", workbench()],
  ]);
}

/** Where they are written, relative to the repository root. */
export const STATIC_ILLUSTRATION_DIR = "public/illustrations";
