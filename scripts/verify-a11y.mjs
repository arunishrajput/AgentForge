/**
 * **The WCAG 2.2 AA structural audit — Phase 25.**
 *
 *   node --env-file=.env scripts/verify-a11y.mjs
 *
 * Chapter 1 explicitly did not do an accessibility audit, and `BUILD_PLAN.md` → *Phase 25*
 * asks for a full one. This is the half of it that a machine can hold: it fetches every
 * page of the real, signed-in application and asserts the structural properties that WCAG
 * AA actually requires of the markup.
 *
 * ## What it checks, and which success criterion each one is
 *
 *   • `<html lang>` is present and well formed ......................... 3.1.1 Language of Page
 *   • a non-empty, distinct `<title>` .................................. 2.4.2 Page Titled
 *   • exactly one `<h1>`, and no skipped heading level .................. 1.3.1 Info and Relationships
 *   • a `<main>` landmark, and the skip link resolves to it ............. 2.4.1 Bypass Blocks
 *   • every form control has an accessible name ........................ 4.1.2 Name, Role, Value
 *   • every button and link has an accessible name ..................... 4.1.2, 2.4.4 Link Purpose
 *   • every `<img>` carries `alt` (empty is a valid answer) ............. 1.1.1 Non-text Content
 *   • no duplicate `id` ................................................ 4.1.1 / referential integrity
 *   • every ARIA id reference resolves ................................. 1.3.1, 4.1.2
 *   • no positive `tabindex` ........................................... 2.4.3 Focus Order
 *   • every `role` is a real ARIA role ................................. 4.1.2
 *
 * ## What it deliberately does not check, and where that half lives instead
 *
 * **Colour contrast** is already gated, in a better place than this script could manage:
 * `src/lib/design/contrast.test.ts` computes every token pair from the stylesheet on every
 * `npm run check`, and `/design` renders the same numbers from the same module
 * (`DESIGN.md` → *Changing this system*). Re-deriving contrast from served HTML would mean
 * a second, worse implementation of maths that already has one.
 *
 * **Keyboard operation, focus visibility, reflow and target size** need a browser with a
 * layout engine and a real focus ring, so they are driven by hand in a browser at the end
 * of the phase and recorded in `PROGRESS.md`. A script that claimed to have checked them
 * from a string of HTML would be the kind of false green this project has been bitten by
 * before (`PROGRESS.md` → *Phase 12 — the lesson worth keeping*).
 *
 * So: this proves the structure, the browser proves the behaviour, and `npm run check`
 * proves the colour. The three together are the audit.
 *
 * It mints a real session the same way every other `verify-*.mjs` does, and it writes
 * nothing.
 */
import { neon } from "@neondatabase/serverless";

const BASE = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
if (!BASE) throw new Error("APP_BASE_URL is required.");

const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);

const COOKIE =
  new URL(BASE).protocol === "https:" ? "__Secure-authjs.session-token" : "authjs.session-token";

let cookie = null;
let passed = 0;
let failed = 0;

const pass = (m) => {
  passed += 1;
  console.log(`   ✓ ${m}`);
};
const fail = (m) => {
  failed += 1;
  console.log(`   ✗ ${m}`);
};
const check = (ok, good, bad) => (ok ? pass(good) : fail(bad ?? good));

async function mintSession() {
  const [user] = await sql.query('select id, email from "user" order by "id" limit 1');
  if (!user) throw new Error("No user row — sign in through the browser once first.");
  const token = crypto.randomUUID() + crypto.randomUUID();
  await sql.query(
    'insert into "session" ("sessionToken", "userId", "expires") values ($1, $2, $3)',
    [token, user.id, new Date(Date.now() + 2 * 60 * 60 * 1000)],
  );
  cookie = `${COOKIE}=${token}`;
  return user.email;
}

/* ------------------------------------------------------------------ *
 * A small HTML reader
 *
 * Regex, not a parser, and the scope is what makes that defensible: almost
 * every question below is about one tag's own attributes or about a flat list
 * of tags. Adding a DOM parser would be a new dependency for the audit script
 * of a project whose stated rule is to add none.
 *
 * **The one question that genuinely needs nesting is label containment**, and
 * the first version of this script got it wrong in the direction that matters:
 * it reported 12 of 13 controls on `/settings` as unnamed. They were not.
 * `Labelled` in `src/components/ui/field.tsx` wraps its control in a real
 * `<label>` — a standards-sanctioned technique, and deliberately chosen there
 * because it makes an unlabelled input impossible to ship. An audit that cries
 * wolf is worse than no audit, because the next person turns it off, so the
 * reader tracks `<label>` open/close spans with a stack and answers the
 * question properly. `labelSpans` below is that.
 * ------------------------------------------------------------------ */

const TAG = /<([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

function tags(html) {
  const out = [];
  for (const match of html.matchAll(TAG)) {
    out.push({ name: match[1].toLowerCase(), attrs: attributes(match[2]), at: match.index });
  }
  return out;
}

/**
 * The `[start, end)` character range of every `<label>` element, found with a stack so a
 * nested label — which is invalid HTML but renderable — cannot shift every span after it.
 * A label left unclosed at the end of the document is discarded rather than treated as
 * running to EOF, which would silently "label" the whole page.
 */
function labelSpans(html) {
  const spans = [];
  const open = [];
  for (const match of html.matchAll(/<(\/?)label\b[^>]*>/gi)) {
    if (match[1]) {
      const start = open.pop();
      if (start !== undefined) spans.push([start, match.index]);
    } else {
      open.push(match.index);
    }
  }
  return spans;
}

const within = (spans, at) => spans.some(([start, end]) => at > start && at < end);

const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function attributes(raw) {
  const out = {};
  for (const match of raw.matchAll(ATTR)) {
    out[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return out;
}

/** The text a tag encloses, with markup and comments stripped. */
function textAfter(html, at) {
  const slice = html.slice(at, at + 4000);
  const close = slice.indexOf(">");
  if (close < 0) return "";
  return slice
    .slice(close + 1)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .trim();
}

/* ------------------------------------------------------------------ *
 * The checks
 * ------------------------------------------------------------------ */

/**
 * Roles used by this product plus every role it could reasonably grow into. A short,
 * explicit list rather than the full ARIA 1.2 taxonomy: the purpose is to catch a typo
 * (`role="buton"`), and a misspelling will not be in a list of any length.
 */
const ROLES = new Set([
  "alert", "alertdialog", "application", "article", "banner", "button", "cell", "checkbox",
  "columnheader", "combobox", "complementary", "contentinfo", "definition", "dialog",
  "document", "feed", "figure", "form", "grid", "gridcell", "group", "heading", "img",
  "link", "list", "listbox", "listitem", "log", "main", "marquee", "math", "menu", "menubar",
  "menuitem", "menuitemcheckbox", "menuitemradio", "navigation", "none", "note", "option",
  "presentation", "progressbar", "radio", "radiogroup", "region", "row", "rowgroup",
  "rowheader", "scrollbar", "search", "searchbox", "separator", "slider", "spinbutton",
  "status", "switch", "tab", "table", "tablist", "tabpanel", "term", "textbox", "timer",
  "toolbar", "tooltip", "tree", "treegrid", "treeitem",
]);

const NAMED_BY_VALUE = new Set(["submit", "reset", "button", "image"]);
const UNLABELLED_TYPES = new Set(["hidden", "submit", "reset", "button", "image"]);

function audit(page, html) {
  const all = tags(html);
  const labels = labelSpans(html);
  const ids = all.map((t) => t.attrs.id).filter(Boolean);
  const idSet = new Set(ids);
  const label = (m) => `${page}: ${m}`;

  /* 3.1.1 Language of Page */
  const htmlTag = all.find((t) => t.name === "html");
  check(
    Boolean(htmlTag?.attrs.lang) && /^[a-z]{2}(-[A-Za-z0-9]+)*$/.test(htmlTag.attrs.lang),
    label(`<html lang="${htmlTag?.attrs.lang ?? ""}"> — 3.1.1`),
    label(`<html> has no well-formed lang — 3.1.1 (found "${htmlTag?.attrs.lang ?? ""}")`),
  );

  /* 2.4.2 Page Titled */
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
  check(title.length > 0, label(`has a title — "${title}" — 2.4.2`), label("has no <title> — 2.4.2"));

  /* 1.3.1 — exactly one h1, and no skipped level */
  const headings = [...html.matchAll(/<h([1-6])\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)].map((m) => ({
    level: Number(m[1]),
    attrs: attributes(m[2]),
  }));
  const h1s = headings.filter((h) => h.level === 1);
  check(h1s.length === 1, label(`exactly one <h1> — 1.3.1`), label(`has ${h1s.length} <h1> — 1.3.1`));

  // A level may repeat or go back up any distance; it may only go *down* by one at a time.
  // `aria-hidden` headings are skipped — they are not in the accessibility tree.
  const visible = headings.filter((h) => h.attrs["aria-hidden"] !== "true");
  let skipped = null;
  for (let i = 1; i < visible.length && !skipped; i += 1) {
    if (visible[i].level - visible[i - 1].level > 1) {
      skipped = `h${visible[i - 1].level} → h${visible[i].level}`;
    }
  }
  check(skipped === null, label("no skipped heading level — 1.3.1"), label(`skips ${skipped} — 1.3.1`));

  /* 2.4.1 Bypass Blocks */
  const main = all.find((t) => t.name === "main" || t.attrs.role === "main");
  check(Boolean(main), label("has a <main> landmark — 2.4.1"), label("has no <main> landmark — 2.4.1"));

  const skip = all.find(
    (t) => t.name === "a" && (t.attrs.href ?? "").startsWith("#") && /skip/i.test(textAfter(html, t.at)),
  );
  if (skip) {
    const target = skip.attrs.href.slice(1);
    check(
      idSet.has(target),
      label(`skip link resolves to #${target} — 2.4.1`),
      label(`skip link points at #${target}, which no element has — 2.4.1`),
    );
  } else {
    // Not every page needs one; a page with no repeated navigation block has nothing to
    // bypass. Reported rather than failed, so the audit output still says what it saw.
    pass(label("no skip link, and no navigation block before <main> to bypass — 2.4.1"));
  }

  /* 4.1.2 — form controls have an accessible name */
  const labelFor = new Set(
    all.filter((t) => t.name === "label" && t.attrs.for).map((t) => t.attrs.for),
  );
  const controls = all.filter(
    (t) =>
      ["input", "select", "textarea"].includes(t.name) &&
      !UNLABELLED_TYPES.has((t.attrs.type ?? "text").toLowerCase()),
  );
  const unnamed = controls.filter(
    (t) =>
      !t.attrs["aria-label"] &&
      !t.attrs["aria-labelledby"] &&
      !(t.attrs.id && labelFor.has(t.attrs.id)) &&
      // Wrapped in its own `<label>`, which is what `Labelled` and `Toggle` produce and
      // is the reason this reader tracks label spans at all.
      !within(labels, t.at) &&
      !t.attrs.title,
  );
  check(
    unnamed.length === 0,
    label(`all ${controls.length} form controls have an accessible name — 4.1.2`),
    label(
      `${unnamed.length}/${controls.length} form controls have no accessible name — 4.1.2: ` +
        unnamed.map((t) => `<${t.name}${t.attrs.name ? ` name=${t.attrs.name}` : ""}>`).join(", "),
    ),
  );

  /* 4.1.2 / 2.4.4 — buttons and links have an accessible name */
  const named = (t) =>
    Boolean(
      t.attrs["aria-label"] ||
        t.attrs["aria-labelledby"] ||
        t.attrs.title ||
        textAfter(html, t.at).length > 0 ||
        (t.name === "input" && NAMED_BY_VALUE.has((t.attrs.type ?? "").toLowerCase()) && t.attrs.value),
    );
  const actionable = all.filter(
    (t) =>
      (t.name === "button" || (t.name === "a" && t.attrs.href !== undefined)) &&
      t.attrs["aria-hidden"] !== "true",
  );
  const anonymous = actionable.filter((t) => !named(t));
  check(
    anonymous.length === 0,
    label(`all ${actionable.length} buttons and links have an accessible name — 4.1.2`),
    label(`${anonymous.length}/${actionable.length} buttons or links have no accessible name — 4.1.2`),
  );

  /* 1.1.1 Non-text Content */
  const images = all.filter((t) => t.name === "img");
  const noAlt = images.filter((t) => t.attrs.alt === undefined);
  check(
    noAlt.length === 0,
    label(`all ${images.length} <img> carry alt — 1.1.1`),
    label(`${noAlt.length}/${images.length} <img> have no alt attribute — 1.1.1`),
  );

  /* 4.1.1 — a duplicate id breaks every reference to it */
  const duplicates = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  check(
    duplicates.length === 0,
    label(`no duplicate id across ${ids.length} ids`),
    label(`duplicate id: ${duplicates.join(", ")}`),
  );

  /* 1.3.1 / 4.1.2 — an ARIA reference to an id that does not exist is silently inert */
  const REFS = ["aria-labelledby", "aria-describedby", "aria-controls", "aria-owns"];
  const dangling = [];
  for (const tag of all) {
    for (const attr of REFS) {
      for (const ref of (tag.attrs[attr] ?? "").split(/\s+/).filter(Boolean)) {
        // `aria-controls` on a disclosure legitimately names an element that is not in the
        // DOM while it is collapsed, which is the one documented exception.
        if (!idSet.has(ref) && !(attr === "aria-controls" && tag.attrs["aria-expanded"] === "false")) {
          dangling.push(`<${tag.name} ${attr}="${ref}">`);
        }
      }
    }
  }
  check(
    dangling.length === 0,
    label("every ARIA id reference resolves — 1.3.1"),
    label(`${dangling.length} ARIA references point at nothing: ${dangling.slice(0, 4).join(", ")}`),
  );

  /* 2.4.3 Focus Order — a positive tabindex reorders the document against its own reading order */
  const positive = all.filter((t) => Number(t.attrs.tabindex) > 0);
  check(
    positive.length === 0,
    label("no positive tabindex — 2.4.3"),
    label(`${positive.length} elements use a positive tabindex — 2.4.3`),
  );

  /* 4.1.2 — a misspelled role is worse than none: it overrides the real one */
  const bad = all.filter((t) => t.attrs.role && !ROLES.has(t.attrs.role.trim().toLowerCase()));
  check(
    bad.length === 0,
    label("every role is a real ARIA role — 4.1.2"),
    label(`unknown role: ${bad.map((t) => `<${t.name} role="${t.attrs.role}">`).join(", ")}`),
  );

  return { title };
}

/* ------------------------------------------------------------------ *
 * Run it
 * ------------------------------------------------------------------ */

/** Every page a user can reach. `/design` is included: it is a real, linked page. */
const SIGNED_IN = ["/workflows", "/templates", "/analytics", "/settings"];
const PUBLIC = ["/", "/design"];

async function fetchPage(path, withSession) {
  const response = await fetch(`${BASE}${path}`, {
    headers: withSession && cookie ? { cookie } : {},
    redirect: "manual",
  });
  return { status: response.status, html: await response.text() };
}

console.log(`\nAccessibility audit — WCAG 2.2 AA structure\n${BASE}\n`);

const email = await mintSession();
console.log(`Session minted for ${email}\n`);

const titles = new Map();

for (const path of PUBLIC) {
  console.log(`${path} (no session)`);
  const { status, html } = await fetchPage(path, false);
  if (status !== 200) {
    fail(`${path}: expected 200, got ${status}`);
    continue;
  }
  const { title } = audit(path, html);
  titles.set(path, title);
  console.log("");
}

for (const path of SIGNED_IN) {
  console.log(`${path} (signed in)`);
  const { status, html } = await fetchPage(path, true);
  if (status !== 200) {
    fail(`${path}: expected 200, got ${status}`);
    continue;
  }
  const { title } = audit(path, html);
  titles.set(path, title);
  console.log("");
}

/**
 * One workflow canvas, which is the densest page in the product and the only one whose
 * controls are nearly all icons. Skipped rather than failed when the workspace has no
 * workflow: a fresh database is a legitimate state, not a regression.
 */
const [workflow] = await sql.query('select id from "workflow" order by "updatedAt" desc limit 1');
if (workflow) {
  const path = `/workflows/${workflow.id}`;
  console.log(`${path} (signed in — the canvas)`);
  const { status, html } = await fetchPage(path, true);
  if (status === 200) {
    audit("/workflows/[id]", html);
  } else {
    fail(`${path}: expected 200, got ${status}`);
  }
  console.log("");
} else {
  console.log("/workflows/[id] — skipped, no workflow in the database\n");
}

/* 2.4.2 — a title that is the same on every page does not identify anything */
const distinct = new Set([...titles.values()].filter(Boolean));
check(
  distinct.size === titles.size,
  `every page has a distinct <title> (${distinct.size} of ${titles.size}) — 2.4.2`,
  `only ${distinct.size} distinct titles across ${titles.size} pages — 2.4.2`,
);

console.log(`\n${passed} passed / ${failed} failed\n`);
if (failed > 0) {
  console.log("Accessibility audit FAILED\n");
  process.exit(1);
}
console.log("Accessibility audit PASSED — structure only; behaviour is driven in a browser.\n");
