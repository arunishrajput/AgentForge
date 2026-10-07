import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import {
  BrokenArt,
  CanvasArt,
  EmptyState,
  Mascot,
  QuietArt,
  Thinking,
  WorkbenchArt,
} from "@/components/ui/illustration";
import { ThemeSwitch } from "@/components/ui/theme";
import { contrast, grade, hex, type Oklch } from "@/lib/design/contrast";
import {
  ELEVATION,
  MOTION,
  PALETTE,
  SURFACE_NAMES,
  THEME_LABEL,
  THEMES,
  TYPE_SCALE,
  type Theme,
  type TokenSpec,
  tokenValue,
} from "@/lib/design/palette";

import { Playground } from "./playground";

export const metadata: Metadata = {
  // The root layout appends "· AgentForge", so the product name is not repeated here.
  title: "Toybox — the design system",
  description:
    "Every token, primitive and motion state in AgentForge's design language, on one page, with measured contrast ratios.",
};

/**
 * The living gallery.
 *
 * `BUILD_PLAN.md` Phase 14 asks for "a living gallery at /design rendering every
 * token, primitive and motion state on one page", as the reference for later phases
 * and a screenshot source for the README. Three things make it *living* rather than
 * a screenshot of a decision:
 *
 *   - every contrast figure on the page is COMPUTED, by the same module that gates
 *     the build (`src/lib/design/contrast.ts`). No figure here can be stale, and no
 *     figure here can disagree with CI
 *   - the swatches read the palette catalogue, which `tokens.test.ts` asserts against
 *     `globals.css` in both directions — so a token added to the stylesheet and not
 *     the gallery fails the build
 *   - the primitives are the real components, not pictures of them: the buttons in
 *     the playground squish, the dialog traps focus, the tabs answer arrow keys
 *
 * Public on purpose. It is the page to link a contributor to, and it holds nothing
 * belonging to any account.
 */

/** Nothing here is per-request, and nothing should be read from disk at runtime. */
export const dynamic = "force-static";

const ALL = PALETTE.flatMap((g) => g.tokens);
const FILL_NAMES = ALL.filter((t) => t.register === "fill").map((t) => t.name);

/**
 * One theme's half of the page. **Every figure is printed for both themes and the
 * stylesheet shows the one in use** — the `dark` variant in `globals.css`, which
 * follows the reader's choice. No script decides it, so nothing flashes, the page stays
 * `force-static`, and the figure on screen is always the one for the colours on screen.
 */
function ForTheme({
  theme,
  as: Tag = "div",
  children,
}: {
  theme: Theme;
  as?: "div" | "span";
  children: React.ReactNode;
}) {
  const shown =
    theme === "light" ? "dark:hidden" : Tag === "span" ? "hidden dark:inline" : "hidden dark:block";
  return <Tag className={shown}>{children}</Tag>;
}

type Measure = { ratio: number; against: string; bar: "text" | "graphic" } | null;

/** The number the gallery prints beside a swatch in one theme, and what it means. */
function measure(spec: TokenSpec, theme: Theme): Measure {
  const value = (name: string) => tokenValue(name, theme);
  const worstSurface = (v: Oklch) =>
    Math.min(...SURFACE_NAMES.map((surface) => contrast(v, value(surface))));
  const worstFill = (v: Oklch) => Math.min(...FILL_NAMES.map((fill) => contrast(v, value(fill))));
  const own = spec[theme];

  switch (spec.register) {
    case "surface":
      return { ratio: contrast(value("ink"), own), against: "body text on it", bar: "text" };
    case "ink":
    case "text":
      // The honest figure for a text token is its WORST surface, not its best.
      return { ratio: worstSurface(own), against: "worst surface", bar: "text" };
    case "label":
      return { ratio: worstFill(own), against: "on the worst fill", bar: "text" };
    case "fill":
      return { ratio: contrast(value("accent-ink"), own), against: "its label on it", bar: "text" };
    case "line":
      // The outline must show against the page AND against every fill it rings; the
      // shadow only ever sits on a surface.
      return spec.name === "line"
        ? { ratio: Math.min(worstSurface(own), worstFill(own)), against: "worst surface or fill", bar: "graphic" }
        : { ratio: worstSurface(own), against: "worst surface", bar: "graphic" };
    case "backdrop":
      return null;
  }
}

const REGISTER_LABEL: Record<TokenSpec["register"], string> = {
  surface: "surface",
  ink: "text",
  label: "fill label",
  line: "graphic",
  backdrop: "backdrop",
  text: "safe as text",
  fill: "fill only",
};

/** WCAG's grade for text, or the 3:1 non-text bar (SC 1.4.11) for an outline or a shadow. */
function verdictOf(m: NonNullable<Measure>): { word: string; tone: string } {
  if (m.bar === "graphic") {
    return m.ratio >= 3 ? { word: "≥ 3:1", tone: "text-ok" } : { word: "fail", tone: "text-bad" };
  }
  const g = grade(m.ratio);
  return { word: g, tone: g === "fail" ? "text-bad" : g === "AAA" ? "text-ok" : "text-live" };
}

function Swatch({ spec }: { spec: TokenSpec }) {
  return (
    <div className="card overflow-hidden">
      <div
        className="border-line h-16 border-b-2"
        style={{ backgroundColor: `var(--color-${spec.name})` }}
      />
      <div className="space-y-1.5 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <code className="text-2xs font-mono font-bold">--color-{spec.name}</code>
          {THEMES.map((theme) => (
            <ForTheme key={theme} theme={theme} as="span">
              <span className="text-faint text-3xs font-mono">{hex(spec[theme])}</span>
            </ForTheme>
          ))}
        </div>
        <p className="text-muted text-2xs text-pretty">{spec.role}</p>
        {THEMES.map((theme) => {
          const m = measure(spec, theme);
          const verdict = m && verdictOf(m);
          return (
            <ForTheme key={theme} theme={theme}>
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <Badge>{REGISTER_LABEL[spec.register]}</Badge>
                {m && verdict ? (
                  <>
                    <Badge className={verdict.tone}>
                      {m.ratio.toFixed(2)}:1 {verdict.word}
                    </Badge>
                    <span className="text-faint text-3xs">{m.against}</span>
                  </>
                ) : (
                  <span className="text-faint text-3xs">translucent, so no fixed ratio</span>
                )}
              </div>
            </ForTheme>
          );
        })}
      </div>
    </div>
  );
}

function Section({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: string;
  lead: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 space-y-5">
      <div className="space-y-1.5">
        <h2 className="text-xl font-bold tracking-tight">{title}</h2>
        <p className="text-muted max-w-2xl text-sm text-pretty">{lead}</p>
      </div>
      {children}
    </section>
  );
}

const NAV = [
  ["colour", "Colour"],
  ["themes", "Themes"],
  ["contrast", "Contrast"],
  ["type", "Type"],
  ["shape", "Shape & elevation"],
  ["primitives", "Primitives"],
  ["motion", "Motion"],
  ["character", "Character"],
  ["access", "Accessibility"],
] as const;

/** The four jobs ink did on one value until Phase 27, and what each is called now. */
const ROLES = [
  { name: "ink", job: "Body text, and the focus ring" },
  { name: "accent-ink", job: "The label on every pop fill" },
  { name: "line", job: "The outline every object wears" },
  { name: "shade", job: "The hard shadow under it" },
] as const;

export default function DesignPage() {
  const tableRows = ALL.filter((t) => t.register === "ink" || t.register === "text");

  return (
    <div className="min-h-dvh">
      <header className="dotted border-line border-b-2">
        <div className="mx-auto max-w-6xl space-y-6 px-5 py-12 sm:py-16">
          <div className="flex flex-wrap items-center gap-3">
            <Mascot mood="happy" float className="size-14" />
            <div>
              <p className="eyebrow text-accent">The AgentForge design system</p>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Toybox</h1>
            </div>
          </div>
          <p className="max-w-2xl text-sm text-pretty sm:text-base">
            Bright, playful and light-first. Saturated colour, thick outlines, hard offset
            shadows, fat corners and springy motion — the reference is a well-made toy:
            tactile, friendly, obviously clickable. Not a dark IDE, which is what every
            competing tool looks like. Toybox Night is the same toy after dark, held to
            the same rules.
          </p>
          <p className="text-muted max-w-2xl text-sm text-pretty">
            Every contrast figure on this page is computed by the same module that fails
            the build when a token drops below WCAG AA — for the theme you are looking at.
            Switch it and every number changes with the colours. Nothing here is a claim.
          </p>
          <ThemeSwitch className="max-w-2xl" />
          <div className="flex flex-wrap gap-2">
            <Link href="/" className="btn btn-ink">
              Back to AgentForge
            </Link>
            <a
              href="https://github.com/arunishrajput/AgentForge/blob/main/DESIGN.md"
              className="btn btn-quiet"
              target="_blank"
              rel="noreferrer noopener"
            >
              Read DESIGN.md
            </a>
          </div>
        </div>
      </header>

      {/* The section nav. Horizontally scrollable on a phone rather than wrapped into
          four rows that push the content below the fold. */}
      <nav
        aria-label="Sections"
        className="border-line bg-canvas/92 sticky top-0 z-30 border-b-2 backdrop-blur-sm"
      >
        <ul className="mx-auto flex max-w-6xl gap-1.5 overflow-x-auto px-5 py-2.5">
          {NAV.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className="btn btn-ghost text-2xs whitespace-nowrap">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <main id="main" className="mx-auto max-w-6xl space-y-16 px-5 py-12">
        <Section
          id="colour"
          title="Colour"
          lead="Every chromatic token comes in two registers. The plain token is safe as text on any surface. The -pop token is a fill only, always with its accent-ink label and always inside its outline. No token is ever asked to do both jobs, because a saturated colour vivid enough to be a good fill is exactly where text fails WCAG AA."
        >
          {PALETTE.map((group) => (
            <div key={group.title} className="space-y-3">
              <div className="space-y-1">
                <h3 className="text-ui font-bold">{group.title}</h3>
                <p className="text-muted max-w-3xl text-2xs text-pretty">{group.note}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {group.tokens.map((spec) => (
                  <Swatch key={spec.name} spec={spec} />
                ))}
              </div>
            </div>
          ))}
        </Section>

        <Section
          id="themes"
          title="Themes"
          lead="Light is the default and the reference; Toybox Night and System are choices a reader makes, kept in their own browser. Until Phase 27 one near-black did four jobs. On a cream page it can; on an indigo one it cannot — text must turn light, a label on a bright fill must stay dark, and an outline and a shadow must still show against the page. So each job has its own name."
        >
          <div className="card overflow-x-auto">
            {/* No minimum width, unlike the contrast table: on a phone the cells wrap
                rather than scroll, so the Night column — the one this table is for — is on
                screen without a sideways swipe. */}
            <table className="w-full text-left">
              <caption className="sr-only">
                The four ink roles and their value in each theme
              </caption>
              <thead>
                <tr className="border-line border-b-2">
                  <th scope="col" className="eyebrow px-3 py-2.5 sm:px-4">
                    Role
                  </th>
                  {THEMES.map((theme) => (
                    <th key={theme} scope="col" className="eyebrow px-3 py-2.5 sm:px-4">
                      {THEME_LABEL[theme]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROLES.map((role) => (
                  <tr key={role.name} className="border-line-soft border-b last:border-b-0">
                    <th scope="row" className="px-3 py-2.5 font-normal sm:px-4">
                      <code className="text-2xs block font-mono font-bold">{role.name}</code>
                      <span className="text-muted text-2xs">{role.job}</span>
                    </th>
                    {THEMES.map((theme) => {
                      const value = tokenValue(role.name, theme);
                      return (
                        <td key={theme} className="px-3 py-2.5 sm:px-4">
                          <span
                            aria-hidden="true"
                            className="border-line inline-block size-5 rounded-md border-2 align-middle sm:mr-2"
                            style={{ backgroundColor: hex(value) }}
                          />
                          <code className="text-faint text-3xs block font-mono sm:inline sm:align-middle">
                            {hex(value)}
                          </code>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-muted max-w-3xl text-2xs text-pretty">
            The fills are the one place the numbers decided the design. In Night a single
            outline must clear 3:1 against both the indigo page and every fill, which leaves the
            fills a band between &ldquo;a dark label reads on it&rdquo; and &ldquo;a cream
            outline shows around it&rdquo; — so Night&apos;s fills are a rich mid-tone rather
            than Light&apos;s near-pastels, and its text tones are the bright half instead. The
            two registers still sit twice apart, the other way round.
          </p>
        </Section>

        <Section
          id="contrast"
          title="Contrast, measured"
          lead="Every tone in the text register against every surface, graded against the 4.5:1 bar for normal-sized text — not the 3:1 large-text allowance, because the smallest tokens in this system carry 10 and 11px captions. These are the figures the build gate asserts."
        >
          {THEMES.map((theme) => (
            <ForTheme key={theme} theme={theme}>
              <div className="card overflow-x-auto">
                <table className="w-full min-w-[34rem] text-left">
                  <caption className="sr-only">
                    WCAG contrast ratio of each text token against each surface, in{" "}
                    {THEME_LABEL[theme]}
                  </caption>
                  <thead>
                    <tr className="border-line border-b-2">
                      <th scope="col" className="eyebrow px-4 py-2.5">
                        Token
                      </th>
                      {SURFACE_NAMES.map((surface) => (
                        <th key={surface} scope="col" className="eyebrow px-4 py-2.5">
                          {surface}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((spec) => (
                      <tr key={spec.name} className="border-line-soft border-b">
                        <th scope="row" className="px-4 py-2">
                          <code
                            className="text-2xs font-mono font-bold"
                            style={{ color: `var(--color-${spec.name})` }}
                          >
                            {spec.name}
                          </code>
                        </th>
                        {SURFACE_NAMES.map((surface) => {
                          const r = contrast(spec[theme], tokenValue(surface, theme));
                          const g = grade(r);
                          return (
                            <td key={surface} className="px-4 py-2">
                              <span
                                className="text-2xs font-mono font-bold"
                                style={{ backgroundColor: `var(--color-${surface})` }}
                              >
                                {r.toFixed(2)}
                              </span>{" "}
                              <span
                                className={`text-3xs font-bold ${g === "fail" ? "text-bad" : g === "AAA" ? "text-ok" : "text-muted"}`}
                              >
                                {g}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ForTheme>
          ))}

          <Card className="p-4">
            <h3 className="text-ui font-bold">Why the focus ring is ink, not the accent</h3>
            {THEMES.map((theme) => {
              const ink = tokenValue("ink", theme);
              const page = tokenValue("canvas", theme);
              const worstFill = Math.min(
                ...FILL_NAMES.map((fill) => contrast(ink, tokenValue(fill, theme))),
              );
              const figure = (r: number) => (
                <strong className="text-ink font-mono">{r.toFixed(2)}:1</strong>
              );
              return (
                <ForTheme key={theme} theme={theme}>
                  <p className="text-muted mt-1.5 text-sm text-pretty">
                    {theme === "light" ? (
                      <>
                        WCAG 2.2 asks a focus indicator for 3:1 against what surrounds it. The
                        accent fill is {figure(contrast(tokenValue("accent-pop", theme), page))}{" "}
                        against the cream page — under the bar. Ink is {figure(contrast(ink, page))}{" "}
                        there, and never below {figure(worstFill)} on any fill in the system. So
                        one ink ring is legal everywhere, and there is exactly one focus ring in
                        the product.
                      </>
                    ) : (
                      <>
                        In Toybox Night the ring is still ink — which is cream here. It is{" "}
                        {figure(contrast(ink, page))} against the indigo page and never below{" "}
                        {figure(worstFill)} on any fill, because the fills were fitted so that one
                        ring would still clear WCAG&apos;s 3:1 on every one of them. The same single
                        ring, in both themes.
                      </>
                    )}
                  </p>
                </ForTheme>
              );
            })}
          </Card>
        </Section>

        <Section
          id="type"
          title="Type"
          lead="Geist and Geist Mono, self-hosted, variable axis. Three steps below Tailwind's smallest, because a node card, a status badge and a log line are all denser than body text. Mono is load-bearing rather than decorative: node ids, {{ }} references, cron expressions and JSON output are all monospaced."
        >
          <div className="card divide-line-soft divide-y">
            {TYPE_SCALE.map((step) => (
              <div key={step.token} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 p-4">
                <code className="text-2xs w-28 shrink-0 font-mono font-bold">{step.token}</code>
                <span className="text-faint text-3xs w-10 shrink-0 font-mono">{step.px}</span>
                <span className={`${step.token} flex-1 font-semibold`}>
                  Describe the automation
                </span>
                <span className="text-muted text-2xs w-full sm:w-56">{step.role}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section
          id="shape"
          title="Shape and elevation"
          lead="A hard offset shadow, down-right, no blur and no spread — ink in Light, cream in Night, drawn in the shade token either way. Blur would read as a drop shadow; the hard edge is what makes an object read as a solid thing sitting on the page. The build gate refuses a shadow with a blur radius in either theme."
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ELEVATION.map((step) => (
              <div key={step.token} className="space-y-2">
                <div
                  className={`border-line bg-elevated ${step.token} grid h-20 place-items-center rounded-xl border-2`}
                >
                  <code className="text-2xs font-mono font-bold">{step.offset}</code>
                </div>
                <div>
                  <code className="text-2xs font-mono font-bold">{step.token}</code>
                  <p className="text-muted text-2xs text-pretty">{step.role}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <h3 className="text-ui font-bold">Corner radius</h3>
            <div className="flex flex-wrap items-end gap-3">
              {["rounded-sm", "rounded-md", "rounded-lg", "rounded-xl", "rounded-2xl", "rounded-3xl"].map(
                (radius) => (
                  <div key={radius} className="space-y-1.5 text-center">
                    <div
                      className={`border-line bg-accent-pop shadow-card size-16 border-2 ${radius}`}
                    />
                    <code className="text-3xs block font-mono">{radius}</code>
                  </div>
                ),
              )}
            </div>
          </div>
        </Section>

        <Section
          id="primitives"
          title="Primitives"
          lead="The real components, not pictures of them. Every outlined object here presses into the page when clicked — it travels down-right by exactly the shadow offset it loses, so the shadow's far corner stays put and the object appears to move. Try them with a keyboard: every one is operable and shows a visible ink focus ring."
        >
          <Playground />
        </Section>

        <Section
          id="motion"
          title="Motion"
          lead="Eight named states, and nothing outside the list. Two curves: one that settles, one that overshoots. Everything here is decoration over a state that is also stated in text, which is what makes the blanket prefers-reduced-motion rule safe."
        >
          <div className="card divide-line-soft divide-y">
            {MOTION.map((state) => (
              <div key={state.name} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
                <code className="text-2xs w-24 shrink-0 font-mono font-bold">{state.name}</code>
                <span className="text-faint text-3xs w-20 shrink-0 font-mono">
                  {state.duration}
                </span>
                <div className="w-14 shrink-0">
                  {state.animation && (
                    <div
                      className={`border-line bg-cat-agent-pop shadow-flat size-8 rounded-lg border-2 ${state.animation}`}
                      style={{ animationIterationCount: "infinite", animationDuration: "1.6s" }}
                    />
                  )}
                </div>
                <p className="text-muted flex-1 text-2xs text-pretty">{state.role}</p>
              </div>
            ))}
          </div>
          <p className="text-muted text-2xs">
            The two shadow states — press and hover-lift — have no keyframes, because they
            are transitions on an interaction. They are in the Primitives section above,
            where they can be felt rather than watched.
          </p>
        </Section>

        <Section
          id="character"
          title="Illustration and character"
          lead="Sparky is a forge sprite with three moods, and the third one is the careful one: a mascot must not read as flippant when someone's workflow has just failed. Concerned is attentive rather than sad — level mouth, inner brow ends raised, no tears — it is rendered small in error contexts, and it never replaces the error text."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            {(["happy", "thinking", "concerned"] as const).map((mood) => (
              <Card key={mood}>
                <CardHeader title={mood} fill="bg-accent-pop" />
                <div className="grid place-items-center p-6">
                  <Mascot mood={mood} className="size-24" />
                </div>
              </Card>
            ))}
          </div>

          <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
            <div>
              <h3 className="text-ui font-bold">The thinking indicator</h3>
              <p className="text-muted text-2xs">
                Used while an agent node is reasoning. The state is announced as a sentence;
                a bobbing dot is not information.
              </p>
            </div>
            <Thinking />
          </Card>

          <div className="grid gap-3 lg:grid-cols-2">
            {[
              { art: <WorkbenchArt className="w-full" />, title: "No workflows yet", description: "Describe what you want in plain language and AgentForge will build the first one.", cta: "Generate a workflow" },
              { art: <CanvasArt className="w-full" />, title: "This canvas is empty", description: "Drag a node in from the palette, or let an agent lay the whole graph out for you.", cta: "Open the palette" },
              { art: <QuietArt className="w-full" />, title: "Nothing has run yet", description: "Run this workflow once and every step's status and logs will stream in here.", cta: "Run it now" },
              { art: <BrokenArt className="w-full" />, title: "Something went wrong", description: "The page could not finish loading. Reloading usually fixes it, and nothing you saved was lost.", cta: "Reload" },
            ].map((scene) => (
              <Card key={scene.title}>
                <EmptyState
                  art={scene.art}
                  title={scene.title}
                  description={scene.description}
                  action={<Button tone="primary">{scene.cta}</Button>}
                />
              </Card>
            ))}
          </div>
        </Section>

        <Section
          id="access"
          title="Accessibility"
          lead="The constraints the system is built inside, rather than a list of things checked afterwards."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              [
                "One focus ring, and it is ink",
                "Near-black in Light, cream in Night. 2.5px, offset 3px, keyboard only. The offset leaves a gap of page colour between an object's own outline and the ring, which is what stops the two reading as one thicker border. No control anywhere sets outline-none.",
              ],
              [
                "Never colour alone",
                "Every status pairs its tone with a word, an icon or a position. A pressed tab is darker AND moved. A failed toast is red AND says “Error” to a screen reader AND shakes.",
              ],
              [
                "An object is never drawn without its outline",
                "Some fills sit as little as 1.3:1 off the cream page; in Night it is the cards that sit flat on the indigo. Either way the outline carries the separation, not the lightness — the build gate asserts both halves of that, in both themes.",
              ],
              [
                "Reduced motion is honoured, and the press is not motion",
                "prefers-reduced-motion collapses every duration to zero. The 2px press displacement stays: that request asks for less animation, not for a control that stops responding.",
              ],
              [
                "Native elements where they are better",
                "The select is a real <select>, the dialog a real <dialog>, the switch a real checkbox. Typeahead, focus trapping, Escape, the inert background and a phone's own picker all come free and are all commonly broken when hand-rolled.",
              ],
              [
                "The quiet register exists",
                "A cartoon look earns goodwill on a landing page and gets in the way in a settings form. Form controls keep the outline and the radius and drop the shadow and the squish — a field is a hole in the page, not an object on it.",
              ],
            ].map(([title, body]) => (
              <Card key={title} className="p-4">
                <h3 className="text-ui font-bold text-pretty">{title}</h3>
                <p className="text-muted mt-1.5 text-2xs text-pretty">{body}</p>
              </Card>
            ))}
          </div>
        </Section>
      </main>

      <footer className="border-line dotted border-t-2">
        <div className="text-muted mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-8 text-2xs">
          <p>
            Toybox — AgentForge&apos;s design language. Phase 14; Toybox Night, Phase 27. Every
            figure on this page is computed, not claimed.
          </p>
          <Link href="/" className="text-accent font-semibold">
            AgentForge →
          </Link>
        </div>
      </footer>
    </div>
  );
}
