# BUILD_PLAN.md — AgentForge

The phase roadmap and the **scope contract**. **One session, one phase.** Do not start a later
phase while a required earlier phase is incomplete. Current position is in `PROGRESS.md`, not here.

**Chapters 1 and 2 (phases 0–25) are complete**, and their phase definitions were moved verbatim to
[`archive/build-plan-chapters-1-2.md`](./archive/build-plan-chapters-1-2.md) on 2026-10-06. When
code, a comment or a document cites "`BUILD_PLAN.md` Phase 16" — or any phase 0–25 — that archive
is the file it means.

---

## The ladder

**Chapter 1 — the hackathon MVP. Phases 0–12. COMPLETE, shipped 2026-09-26.**

```
 0  Setup and foundation decision   ✅      7  Natural language → workflow  ✅
 1  Skeleton with Google auth       ✅      8  Triggers — webhook, schedule ✅
 2  First deploy                    ✅      9  Integrations                 ✅
 3  Data model, registry, engine    ✅     10  Design system pass           ✅
 4  Visual canvas                   ✅     11  Hardening                    ✅
 5  Live execution streaming        ✅     12  Demo readiness and ship      ✅
 6  Agent layer                     ✅
```

**Chapter 2 — the open-source product. Phases 13–25. COMPLETE, closed 2026-10-01.**

```
13  Reset, verification, CI        ✅     20  Roles, permissions, sharing     ✅
14  Toybox design system           ✅     21  Credential vault and rotation   ✅
15  UI rebuild I — the shell       ✅     22  Observability and analytics     ✅
16  UI rebuild II — the canvas     ✅     23A Transform nodes, templates      ✅
17  Durable execution              ✅     23B Slack, Notion, GitHub, Airtable ✅
18  Versioning and diffing         ✅     23C The Postgres node               ✅
19A Workspaces — data model        ✅     23D The second LLM provider         ✅
19B Membership and invitations     ✅     24  Docs and open-source readiness  ✅
                                          25  Launch polish                   ✅
```

**Chapter 3 — a product people use every day. Phases 26–42. THIS IS THE CURRENT WORK.**

```
26  Timers — schedules that fire, at zero idle cost       ✅
27  Themes I — Toybox Night: tokens, gates, switching      ✅
28  Themes II — every screen in both themes                ✅
29  Canvas I — editing ergonomics                          ← START HERE
30  Canvas II — sticky notes and disabled nodes
31  Canvas III — the test loop: pinned data and partial runs
32  Library — organising workflows
33  Runs — history and recovery
34  Generator at scale — catalogue selection and evals
35  Copilot I — edit a workflow by conversation
36  Copilot II — explain and repair
37  Workflows I — when things go wrong
38  Workflows II — human in the loop
39  Workflows III — composition: sub-workflows, workflow tools, merge
40  Workflows IV — public entry points: forms and webhook responses
41  Public API — personal access tokens
42  Chapter 3 launch polish
```

**Move the `← START HERE` marker when a phase closes.** Chapter 2 forgot to, and the marker sat on
Phase 24 after 24 and 25 were both done — a heading that names a phase goes stale the moment that
phase ends.

---

# Chapter 3 — a product people use every day

**Chapter 2 made AgentForge real and legible. Chapter 3 makes it something a person reaches for
every day** — easier to build with, safer to rely on, and able to automate work that needs judgement,
waiting, people and other workflows.

**Planned on 2026-10-06 with the user**, who chose:

| Decision | Value |
|---|---|
| **Themes** | **Light, Dark ("Toybox Night") and System. Light stays the default and the reference** — `DECISIONS.md` D110, superseding D65's light-only |
| **Feature areas** | **All four**: canvas editing power · an AI copilot · more powerful workflows · organisation and daily use |
| **Size** | **Comprehensive** — 17 phases. One more than the "~14–16" discussed, because two enabling phases are not optional (26 timers, 34 the generator's prompt ceiling) |

**What did not change:** zero cost, Toybox, no arbitrary code execution, Cloud Run + Neon, the
registry as the spine, and every rule in `CLAUDE.md`.

## Why this order

`DECISIONS.md` D111. **Correctness first, then cross-cutting work before the screens multiply, then
enabling work before what depends on it.**

- **26 first** because a defect is live: `agentforge-cron` has been `PAUSED` since M12
  (2026-10-01), so **a schedule trigger saves cleanly, displays a next fire time, and never fires.**
  For a stranger that is the worst failure a scheduler can have
- **27–28 next** because a theme touches every screen, and phases 29–41 add a dozen new ones — built
  after the themes, each is theme-aware from birth instead of retrofitted
- **29 before 35** so a copilot change the user accepts is undoable for free
- **33 before 36** so "why did this fail?" has a run detail page to live on
- **34 before 35–40**, and this is the hard one: see D112 below

## The rules for this ladder

- **Work them in order.** The dependencies are real and each phase names them
- **Every phase ends with the deployed environment working**, verified on the deployed URL and —
  for any UI claim — **in a real browser**. The API suites cannot see the page
- **From Phase 28 onward every UI phase is verified in both Light and Dark.** A screen checked in
  one theme is a screen checked in half
- **No new registry node before Phase 34 (D112).** The generation prompt is 24,876 characters
  against the 26,000 ceiling asserted in `src/lib/nodes/registry.test.ts`, which is one node of
  headroom. Phases 26–33 extend existing nodes or add things that are not nodes. **Raising the
  ceiling is not the fix**; Phase 34 is
- **Every new node owes the registry's five obligations** (`PROGRESS.md` → *Deployed State* →
  Registry): a `PUBLISHABLE` entry, a `ROTATION_RULES` entry if it carries a credential kind, the
  `model` output field only if it is a model call, the generator catalogue entry (automatic), and
  `docs`. `registry.test.ts` asserts all five. `agentCallable` stays opt-in (D19), and
  `docs/nodes.md` is regenerated with `npm run docs:build`
- **Every new unauthenticated surface** — the form page, approval links, bearer tokens — **is added
  to `scripts/verify-security.mjs`'s enumeration and to `SECURITY.md` in the same phase.** Phase 25
  found three surfaces a hand-kept list had missed
- **No arbitrary code execution and no expression language. Ever.** `{{ }}` stays lookup (D17).
  The copilot can propose only registry nodes, and only as a diff a person accepts
- **Splitting a phase is expected, not a failure** — Chapter 2 split 19 and 23 four ways. Record a
  split here when it happens, with its reason, the way 23B/23C/23D are recorded in the archive
- **Re-check a number before designing against it.** Every free-tier figure below was true on the
  date it was measured; vendors move them

## The zero-cost problem, Chapter 3 edition

**Neon is still the binding constraint**, and its rule is unchanged: **never add a new reason to
wake an idle database.** Neon meters compute time *awake* (100 CU-hours/month, autosuspend after 5
minutes, cannot be disabled), so a statement made while a run has already woken it is nearly free
and a timer that wakes it every few minutes is not. `DEPLOYMENT.md` → *Free-tier headroom* has the
measured arithmetic; Chapter 2's per-area resolution is in the archive.

| Need | The paid answer | The zero-cost answer here | Phase |
|---|---|---|---|
| Timers: schedules, long waits, approval timeouts | A worker with a clock, or a 1-minute cron | **Cloud Tasks scheduled for the exact time** (`scheduleTime`) — no clock in the app, no wake until a timer is due. The `*/15` cron shrinks to a daily safety sweep | 26 |
| Theme preference | A per-user settings row | **Per browser, applied before first paint.** No column, so no read | 27 |
| Failure alerts | A mail provider | **An in-app inbox** written in the same statement path as the failure, read on page load, never polled — plus an error-trigger workflow that alerts through a channel the user already connected | 37 |
| Approval links | A mail provider | **A signed link the author delivers** through Slack, Discord or Gmail nodes they already have | 38 |
| Hosted forms | A forms SaaS | **A page on the same container** | 40 |
| API keys | An API gateway | **Hashed tokens in Neon**, checked by the existing auth funnel | 41 |
| Copilot and evals | A hosted model budget | **The user's own key** for the copilot; evals replayed offline in CI and run live sparingly | 34–36 |
| Run retention | A storage upgrade | **Pruning on the daily sweep** against Neon's 0.5 GB | 33 |

---

## Phase 26 — Timers: schedules that fire, at zero idle cost

**Objective.** A schedule trigger fires at its time on the deployed service with no `*/15` cron
keeping Neon awake; a run can wait minutes to days without holding a container; and a workflow can
be switched off.

**Dependencies.** None — Chapter 2 is complete. Builds on Phase 17's queue (`src/lib/engine/queue.ts`,
the lease and the cursor) and on D42's compare-and-set claim.

**Why it is first.** Since M12 paused `agentforge-cron` on 2026-10-01, **no schedule trigger fires
at all**, and nothing in the product says so. Resuming the cron is the cheap fix and costs ~60 of
Neon's 100 CU-hours a month, because a tick every 15 minutes keeps the database awake around the
clock. This phase fixes the defect *and* removes that cost.

**Tasks.**
1. **Arm a timer per due schedule.** When a workflow with a schedule trigger is saved, activated or
   fires, enqueue one Cloud Tasks task whose `scheduleTime` is the workflow's `scheduleNextAt`,
   delivered to an authenticated endpoint guarded the way `/api/runs/dispatch` is (`CRON_SECRET`
   plus a per-task token — D82). On delivery: claim the slot with D42's compare-and-set
   (`WHERE scheduleNextAt = <the time this task was armed for>`), start a **durable** run, compute
   the next fire, and arm the next task. **A stale task updates zero rows and does nothing** — so
   changing the expression, deleting the workflow or switching it off needs no task deletion
   (deleting is best-effort tidiness, never the correctness mechanism).
2. **Far-future fires.** Cloud Tasks limits how far ahead `scheduleTime` may be — **verified
   2026-10-06 against its quotas page: 30 days from now** (and a task de-duplication window of up
   to 24 hours, task retention 31 days). A fire beyond the limit arms a *re-arm* task at the limit
   instead of a run — built with a 29-day horizon, `TASK_HORIZON_MS`.
3. **The cron becomes a daily safety sweep.** Keep `agentforge-cron`, change it from `*/15 * * * *`
   to once a day, and **resume it**. The daily tick re-arms any schedule that is due but unarmed (a
   lost task, a workflow that existed before this phase), calls `sweepAbandonedRuns`, and is the
   hook later phases hang housekeeping on (Phase 33's retention). Compute its CU-hour cost in
   `DEPLOYMENT.md` — one wake a day, against ~60 CU-hours/month for `*/15`.
4. **Durable long waits in `core.delay`.** Today `MAX_DELAY_MS` is 10 s
   (`src/lib/nodes/core/delay.ts`). Above a threshold, the engine checkpoints the cursor, ends the
   attempt, and schedules a Cloud Tasks delivery for the wake time, which resumes the run. Add a
   **`waiting`** run status to the state machine — a waiting run holds **no lease and no
   container**. Bound the longest wait (30 days, say) as a safety property in the D16 family. With
   no queue configured (local dev), a long wait is **refused with a clear message** rather than
   silently holding a request open. No new node: this extends `core.delay` (D112).
5. **A per-workflow active switch.** An additive column (e.g. `workflow.active`, default `true`).
   Off means: the webhook answers a clear refusal (choose the status deliberately and document
   it), the schedule disarms, and **manual runs still work**. Shown on the canvas toolbar and on the
   workflow card.
6. **Honest trigger UI.** The trigger panel shows the next fire time *and* whether a timer is
   armed for it; a switched-off workflow says so.

**Primary files.** `src/lib/triggers/{schedule,tick,cron}.ts`, `src/app/api/cron/tick/route.ts`,
`src/lib/engine/{queue,lease,cursor,run,execute,types}.ts`, `src/app/api/runs/dispatch/route.ts`,
`src/lib/nodes/core/delay.ts`, `src/db/schema.ts` and a new migration,
`src/app/api/webhook/[token]/route.ts`, `src/components/canvas/trigger-panel.tsx`,
`src/components/canvas/editor.tsx`, `src/components/workflows/workflow-list.tsx`,
`scripts/verify-durable.mjs` (or a new `scripts/verify-timers.mjs`).

**Implementation notes.** **Read the Cloud Tasks docs rather than recall them** — the
`scheduleTime` horizon and the task-name de-duplication window both matter, and the CAS claim is the
real guard either way, so do not lean on task names for correctness. The **lease family** (engine
deadline 120 s, `STREAM_MAX_MS` 150 s, `LEASE_MS` 180 s — `PROGRESS.md` → *Known Issues*) must
stay ordered; a waiting run sits outside it entirely, because it holds no lease. A stream watching
a run that enters `waiting` closes (D31) and the canvas shows "waiting until …" from the run row.
Cloud Tasks bills per operation: one task per fire and one per wait is negligible against
1,000,000/month, but **enqueue an id, never a payload** (the Phase 13 finding). `MAX_FIRES_PER_TICK`
(25) now applies only to the safety sweep. Measure the queue's `maxConcurrentDispatches` (3) against
a burst of schedules all due at 09:00.

**Validation steps.** On the deployed service, with the cron at its daily cadence: a schedule set a
few minutes ahead **fires**, and the run appears on an open canvas. Change the expression after
arming — the old task fires and starts **zero** runs (asserted). A switched-off workflow's webhook
refuses and its schedule does not fire; switch it back on and it does. A `core.delay` of ~2 minutes
completes, with the run `waiting` and holding no lease in between (asserted over the API). The
daily sweep re-arms a schedule whose task was deliberately deleted. Driven in a real browser: the
trigger panel's armed state and the active switch.

**Completion criteria.** Schedules fire on the deployed URL without a frequent cron. Long waits are
durable. The active switch works. **The M12 "no schedule trigger fires" consequence is closed** in
`PROGRESS.md`, with the before/after CU-hour arithmetic.

**Documentation updates.** `CONTRACT.md` (run state machine gains `waiting`; trigger shapes; the
active flag), `ARCHITECTURE.md` (*Queue* — timers), `DEPLOYMENT.md` (*Cloud Scheduler* cadence,
*Free-tier headroom*), `OPERATIONS.md`, `docs/nodes.md` (regenerated), `DECISIONS.md`,
`PROGRESS.md`.

**Commit.** `feat: complete phase 26 durable timers and schedules that fire`

**Status: COMPLETE, 2026-10-06 — deployed as `agentforge-00063-zt5` and verified there.** Built while
the trial billing account was closed (M13, D113); deployed the same day once the user had upgraded
it. On the deployed service: `verify-timers.mjs` **34/34** — a schedule fired from its timer 0.1 s
after its slot, an edited schedule's old timer started zero runs, the switch refused the webhook
with 409, a two-minute delay waited with no lease and woke after 120 s, a deleted timer was re-armed
by the sweep and fired once, and a burst of 8 same-minute schedules fired within 0.1–8.1 s against
`maxConcurrentDispatches` 3. The cron is daily (`0 4 * * *`) and `ENABLED`; its first run caught up
the three slots overdue since 2026-10-02. In a real browser, on the deployed canvas: the panel said
*Armed*, a schedule set three minutes ahead fired and lit up an open canvas, and the active switch
refused and resumed — Light only, as planned (Dark arrives in 27).

**Verifying it on the deployed service found five things, all fixed in this phase:**

- **The trigger panel named a past slot after a firing** — the canvas showed the run but never
  re-read the schedule. It now does, once per firing seen (`src/lib/canvas/schedule-sync.ts`), and
  `fireDue` arms the next slot *before* starting the run, so the re-read never sees the gap
- **Every verify script had silently changed account.** They acted as `order by "id" limit 1`, which
  stopped meaning "the owner" when a second user signed in on 2026-10-01 — so the model checks failed
  against an empty vault, and four of the operator's credentials were stored in that account's
  workspace (removed). `scripts/verify-user.mjs` now chooses the deployment owner deliberately,
  and `verify-a11y.mjs` audits a canvas that account can actually open
- **`verify-security.mjs` pinned the exception table at 10** after this phase made it 11, and
  **`verify-observability.mjs` asserted on a half-ingested run** — it stopped polling Cloud Logging
  at the first line instead of the last
- **The Cloud Build upload carried every git-ignored file** — 63 MB of local media this time, and
  potentially a stray key file. `.gcloudignore` now includes `.gitignore` (D120), and the registry and
  source bucket are held by standing cleanup rules

---

## Phase 27 — Themes I — Toybox Night: tokens, gates, switching

**Objective.** The design system supports **Light, Dark and System** (D110), every invariant the
build enforces holds **in each theme**, the theme switches with no flash, and `/design` shows both.

**Dependencies.** Phase 26 (ordering only).

**The hard part, stated first.** `--color-ink` does four jobs today, and on a cream page one value
can do all four: **body text**, **the label on every `-pop` fill**, **the outline** (`--color-line`
is "ink by another name"), and **the shadow** (every `--shadow-*` is `Npx Npx 0 0 var(--color-ink)`).
On a dark page they diverge: text must be light, a label on a bright fill must stay dark, an outline
must separate an object from a dark page, and a hard shadow must still read as a solid edge. **A
dark theme that does not split those roles first will break one of the four everywhere at once.**

**Tasks.**
1. **Split ink into roles** without breaking `CONTRACT.md` → *Design token names*. Adding a name is
   allowed; changing what an existing name means is not. `--color-accent-ink` already exists as
   "the label on any pop fill" — make every pop-fill label actually use it. Give outline and shadow
   their own role tokens.
2. **The Toybox Night palette**, under `[data-theme="dark"]`, and `System` through
   `prefers-color-scheme` when `data-theme="system"` — every `--color-*` token (31 today) and the
   new role tokens.
3. **Fix `bg-lift`.** It is used in four places (`src/app/workflows/page.tsx`, `src/app/s/[token]/page.tsx`,
   `src/components/settings/workspace-panel.tsx` ×2) and **no `--color-lift` token exists**, so it
   applies no background in either theme. A live defect, found while planning this phase.
4. **Gates per theme.** `parseTokens()` in `src/lib/design/contrast.ts` reads the whole stylesheet
   and lets a later declaration overwrite an earlier one, **so a dark block would silently replace
   the light values in every gate**. Make it selector-aware. Run every invariant in
   `src/app/tokens.test.ts` for each theme; restate the light-only ones per theme (surface luminance
   above 0.75, "some pop fill is flat on cream", `color-scheme: light`). `src/lib/design/palette.ts`
   mirrors both. **Mutation-test the new gates** the way Phase 14 did: break a dark token on
   purpose and watch the build fail.
5. **Switching.** A blocking inline script in `<head>` in `src/app/layout.tsx` reads the stored
   preference and sets `data-theme` before first paint; `suppressHydrationWarning` on `<html>`;
   `color-scheme` per theme (so a native `<select>` renders dark in Dark — D65's original reason
   for `color-scheme`, now applied twice); `themeColor` per scheme (today a hardcoded `#fdf4dd` at
   `layout.tsx:74`). The preference lives in `localStorage`, read through the
   `useSyncExternalStore` pattern `src/components/canvas/panel.tsx` already uses (D74), with an
   in-memory fallback when storage is blocked. **Light is the default even when the OS is dark.**
   There is no Content-Security-Policy today (checked 2026-10-06); if one is ever added, allow this
   script by hash, never with a blanket `unsafe-inline`.
6. **The controls.** Theme choice in the account menu, in *Settings → Account* (an "Appearance"
   group), and in the ⌘K palette. Radio-group semantics, keyboard complete.
7. **`/design` in both themes**, with every contrast figure computed for the theme it shows. The
   gallery is `force-static`, which is exactly why the switch must be client-side.

**Primary files.** `src/app/globals.css`, `src/lib/design/{palette,contrast}.ts`,
`src/app/tokens.test.ts`, `src/app/layout.tsx`, `src/components/shell/{account-menu,command-palette}.tsx`,
`src/components/settings/account-panel.tsx`, `src/app/design/*`, a small theme module under
`src/lib/ui/`.

**Implementation notes.** **Dark is not an inversion.** Keep the saturation, the thick outlines,
the hard no-blur shadows (the gate refuses a blur in either theme) and the press gesture. Resist the
glow: `DESIGN.md` → *Traps* records that "a soft glow is a dark-UI idiom", and a dark theme is
exactly where it will try to come back. D66 (two registers) and D67 (the outline carries
separation) must both survive — the second is the hard one, because an ink outline on a near-black
page is invisible and a black hard shadow vanishes. Design an answer, screenshot it, and record it
as a decision. `DESIGN.md` already names the focus-ring trap: "an ink object on an ink background
needs a cream ring" — the one ring must clear 3:1 in **both** themes. **Light must not change:**
screenshot `/design` in Light before and after and compare.

**Validation steps.** `npm run check` green with per-theme gates, and the mutation tests failing as
intended. `/design` in a real browser in Light, Dark, and System with the OS emulated both ways, at
1440 and 375 px. **No flash on a hard reload**, in each theme — check the first painted frame, not
the settled page. The preference survives a reload and is per browser. Light is visually unchanged.

**Completion criteria.** Three themes, switchable from three places; gates per theme; the gallery
complete in both; deployed.

**Documentation updates.** `DESIGN.md` (a *Themes* section: the role split, Toybox Night's rules for
outline, shadow and focus), `CONTRACT.md` (*Design token names*: the role tokens and per-theme
invariants), `ARCHITECTURE.md` (*Design system*), `DECISIONS.md`, `PROGRESS.md`.

**Commit.** `feat: complete phase 27 toybox night theme foundations`

**Status: COMPLETE, 2026-10-07 — deployed as `agentforge-00064-jmm` and verified there, in Light,
Toybox Night and System.** What was built, and what the numbers decided:

- **Ink's four jobs became four roles** — `ink`, `accent-ink`, `line`, `shade` — plus `scrim` (D121).
  ~30 pop-fill labels moved from `ink` to `accent-ink`, identical in Light, where every token and
  every probed component computes exactly as on `00063-zt5` (measured with `getComputedStyle`,
  deployed against local)
- **Toybox Night** is fitted to the gates, not the gates to it: one cream outline must clear 3:1
  against both the indigo page and every fill, which puts every Night fill at luminance 0.24 — label
  ≥ 4.95:1, outline and ring ≥ 3.22:1. The text register became the bright half. Its structure is
  cream (D122); a near-black shadow vanished on indigo and a mid-tone one read as a second stripe,
  both tried in the browser
- **The gates run per theme.** `parseTokens()` is selector-aware (`declarations()` carries each
  declaration's block), so the Night block can no longer silently replace the light values.
  **Ten deliberate breaks of Night were each caught** — a pastel fill, a dark ink, a black shadow, a
  cream label, a forgotten token, `color-scheme: light`, a stray token, a blurred shadow, the
  variant reverted to the OS, a mid-grey page
- **Switching** (D123): a blocking `<head>` script tested as shipped; the stylesheet resolves System.
  **No flash, measured as frames:** a throttled, cache-disabled hard reload with Dark stored painted
  218 frames locally and 121 deployed, every one indigo; the control, with the script stripped,
  painted 64 cream frames before React applied the theme. A first visit on a dark OS is Light;
  System follows the OS live, with no reload
- **The controls**: the account menu (a `menuitemradio` group — `Menu` gained radio items), *Settings
  → Account → Appearance* (`ThemeSwitch`, native radios), ⌘K, and a switch on `/design`
- **`/design` in both themes**, every figure printed for both and CSS showing the one in use, plus a
  *Themes* section showing the role split

**Found on the way, all fixed:**

- **`bg-lift` was in six places, not four**, and **two more classes named tokens that never existed**
  — `text-ok-ink` (the webhook "Rotated" message) and `text-warn-ink` (the vault's warning figure).
  `utilities.test.ts` now asks Tailwind's own compiler about every colour class in `src/` (D124); it
  failed on all three before the fix
- **Three Night defects the gates could not see, found in the browser**: the quiet badge inside a
  filled `CardHeader` inherited the near-black label (an empty capsule), the select chevron was an
  inline near-black data URI (now the `select-chevron` utility, moved forward from Phase 28), and the
  Share dot used `accent-ink` on a quiet button. Plus the Themes table needed a sideways scroll at
  375 px, which hid the Night column
- **A stale verify instruction**: `PROGRESS.md` told `verify-templates.mjs` to take its URL as an
  argument; it reads only `APP_BASE_URL`

**Not done here, and why:** the three signed-in placements (account menu, Settings, ⌘K) were not
seen in a browser — the only Chrome connected to the extension was signed out, and minting a session
for the automated browser is refused as credential leakage. Their components are verified live on
`/design`; the placements are Phase 28's task 4.

**The first-frame check**, for the next UI phase (Playwright, `page` in scope):

```js
const client = await page.context().newCDPSession(page); const frames = [];
client.on('Page.screencastFrame', async (f) => { frames.push(f.data);
  await client.send('Page.screencastFrameAck', { sessionId: f.sessionId }); });
await client.send('Network.enable'); await client.send('Network.setCacheDisabled', { cacheDisabled: true });
await client.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: 240, maxHeight: 150 });
await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1000);
await client.send('Page.stopScreencast');
// then decode each frame in the page (createImageBitmap → OffscreenCanvas → getImageData)
// and read one corner pixel per frame: a flash is any frame in the other theme's page colour
```

**The battery, on `00064-jmm`, acting as the owner — 0 failed:** `verify-security` 68, `verify-a11y`
92, `verify-api` 404 / 4 skipped, `verify-templates` 47, `verify-postgres` 65, `verify-providers` 55,
`verify-vault` 62, `verify-observability` 68 / 1 structural skip, `verify-integrations` 60 / 2 skipped
(Notion, Airtable), `verify-timers` 34, `verify-durable all` passed, `smoke.mjs` **CLEAN**. The first
`verify-api` run failed one check — "an agent that will not converge fails at its cap" — because the
model answered instead of looping, so the cap was never reached; the cap itself is unit-tested
(`loop.test.ts`), and the re-run passed it.

---

## Phase 28 — Themes II — every screen in both themes

**Objective.** No screen, state or shipped asset is light-only.

**Dependencies.** Phase 27.

**Tasks.**
1. **The canvas.** React Flow's `colorMode` follows the theme (hardcoded `"light"` at
   `src/components/canvas/editor.tsx:1167` and `src/components/share/shared-canvas.tsx`); the
   minimap mask is a literal `oklch()` in `globals.css`; arrow markers; every edge state (traversed,
   live, added, removed); node cards in all five statuses; the diff bar; the run panel.
2. **Hardcoded colours.** Hover states use `color-mix(…, white)`; `src/app/icon.svg` has hex
   fills. *(The select chevron — an inline data URI with a fixed stroke — was done in Phase 27,
   because it sits on `/design` and that gallery had to be complete in both themes; it is the
   `select-chevron` utility now, and `tokens.test.ts` ties its stroke to each theme's ink.)*
3. **Illustrations and Sparky.** The inline SVGs use `var(--color-*)`, and Phase 27 gave them the
   role tokens (outline `line`, Sparky's face `accent-ink`, the glyph shadow `shade`) and checked
   them on `/design` in Night — verify them everywhere else they appear, especially `concerned` on
   an error screen. The static
   `public/illustrations/*.svg` gain dark variants from `npm run design:export`, and the README
   uses `<picture>` with `prefers-color-scheme` so GitHub's dark mode gets them. The export test
   must cover both.
4. **The three theme controls, signed in, in both themes — carried from Phase 27.** The account
   menu's Theme group, *Settings → Account → Appearance* and the ⌘K theme commands. Phase 27
   verified the components they are built from (`Menu`'s radio items and `ThemeSwitch`, both live
   on `/design`) but the only browser it could drive was signed out, so these three placements, and
   ⌘K at all, have not been seen in a browser.
5. **Every page.** Landing, `/workflows` with the onboarding guide, `/templates`, `/analytics` (the
   hand-drawn chart), `/settings` (all five tabs, the vault), `/s/[token]`, `/invite/[token]`,
   `not-found`, `error.tsx`, and `global-error.tsx` — **which renders its own `<html>` and so needs
   the theme script too**. Toasts, notices, dialogs, menus, tooltips.
6. **Screenshots.** `docs/assets/*` refreshed, and the README shows the product in both themes —
   and its *What comes next* list loses the items Phases 26 and 27 shipped.

**Primary files.** `src/components/canvas/*`, `src/components/share/*`, `src/app/globals.css`,
`src/components/ui/field.tsx`, `src/lib/design/illustrations-static.ts`, `public/illustrations/*`,
`scripts/export-illustrations.mjs`, `src/app/global-error.tsx`, `src/app/icon.svg`, `README.md`,
`docs/assets/*`.

**Implementation notes.** `DESIGN.md` → *Traps* applies double here: a class in the DOM is not
evidence it applies — **measure with `getComputedStyle` in a browser**. React Flow's `colorMode` is a
trap even when it looks inert (Phase 16): every variable not overridden falls back to React Flow's
own default for that mode. Reduced motion must still be honoured in both places.

**Validation steps.** Every route in a real browser in Light **and** Dark at 375, 1024, 1440 and
1920 px: zero console errors, zero horizontal overflow. A workflow generated, edited and run on the
canvas **in Dark**. The public share page in Dark, signed out. `verify-a11y.mjs` all passing.

**Completion criteria.** A full pass of the product in Dark finds nothing light-only. Deployed.

**Documentation updates.** `DESIGN.md`, `README.md`, `PROGRESS.md`.

**Commit.** `feat: complete phase 28 every screen in both themes`

**Status: COMPLETE, 2026-10-07 — deployed as `agentforge-00066-wvx` and verified there in Light and
Toybox Night.** Two deploys, not a split: part 1 (`00065-d2r`) shipped what could be verified signed out
while the only Chrome connected to the extension was signed out; part 2 is what the signed-in pass
found. What was built:

- **The canvas follows the theme.** React Flow's `colorMode` is the reader's resolved theme on the
  editor and the share page. The minimap mask is the recess colour, not a literal cream. **The dot grid
  had never been ink**: it set `color` on a pattern React Flow paints with `fill` from its own variable —
  measured on the live canvas, the dots fall back to `rgb(145,145,154)` in Light and `rgb(85,85,85)` in
  dark mode when the variable is unset, and a `color` on them changes nothing
- **Night's fill hover broke the outline rule** — 14% white took a hovered primary button's outline and
  ring from 3.23:1 to 2.61:1. The amount is per theme now (D125), gated for every fill in both themes
- **Assets outside the page** (D127): the static illustrations in both themes with `<picture>` in the
  README, and the favicon generated from the palette with both palettes behind `prefers-color-scheme`
- **`global-error.tsx`** applies the theme through `ThemeSync`. A copy of the head script was tried
  first and found dead on a probe build — Next 16 never server-renders that page — and a probe with a
  server-side and a client-side throw in the root layout painted it in each stored theme
- **The three theme controls, signed in (task 4)**: the account menu (pointer), *Settings → Account →
  Appearance* (arrow keys, the ring on the label) and ⌘K ("light" + Enter) each switched the theme, stored
  it and recoloured `theme-color`, and the others followed live
- **The phone toolbar Known Issue**: two rows at 375 px (was three; 151 → 104 px) and three at 320 (was
  four; 197 → 149 px), measured on the deployed canvas through a same-origin iframe

**Found by the signed-in pass, all fixed:**

- **The account menu was a dead end from the keyboard.** Its first item is the disabled address; the
  menu focused item 0, which refuses focus, so focus stayed on the trigger and nothing else was
  reachable. End also counted from item 0. `menu-focus.ts`, tested; verified on `00066-wvx`
- **Seven badges were an empty capsule in Night (1.06:1)** — `tone="pop"` with no fill (D126). Now the
  `outline` register, identical in Light, and a pop badge without a `fill` does not typecheck
- **Two labels on fills were dimmed under AA** — 3.77:1 in Light, older than the themes (D126)
- **Two controls replaced the ink focus ring** with an accent one and `outline-none`; a gate now refuses it

**Verified in a real browser on the deployed service**: every signed-out route at 375 / 1024 / 1440 /
1920 px in both themes, zero horizontal overflow, no console errors beyond each 404's own status. Every
signed-in page — `/workflows`, `/templates`, `/analytics`, all five settings tabs, the canvas with and
without a node selected, a run, version history, the diff, both dialogs — read by
`scripts/contrast-audit.browser.js` in both themes and **clean** on `00066-wvx`. **A workflow generated,
edited and run on the canvas in Night**: five nodes from a sentence, renamed and relabelled, saved as v2,
run to five successes with the branch taking `true` (the first attempt met a Gemini timeout, which the
failure notice reported in Night). **The share page in Night, signed out**, at 375 and 1440, with a link
the user approved, then revoked (404 after). The README's screenshots are re-shot in both themes —
landing, the demo, the design system and a real run (the run's are JPEG captures at 1512 × 695: the
connected Chrome's screen is 838 px tall, and a 256-colour PNG of them shifted the palette's hues).

**Driven, not clicked, for the last part.** The connected Chrome window went to the background midway,
and a hidden window receives no pointer or keyboard input and advances no CSS transitions. The
generate-edit-run pass and the canvas screenshots were therefore driven through the UI's own controls
with DOM events (`click()`, native `input`), which run the same React handlers; pointer and keyboard
behaviour — the menu, the radios, ⌘K, Run — had been exercised for real while the window was visible.
The one false alarm it produced is recorded: a cross-tab switch to Light read grey node cards at 1.13:1
until the frozen colour transition was allowed to settle; settled, the audit was clean.

**Gates added** — every one mutation-tested against the old code: each fill's hover per theme, and no
white mix outside the variable (`tokens.test.ts`); no control removes the ring, and no opacity on the
fill's label (`utilities.test.ts`); every `<html>` applies the theme (`theme.test.ts`); the favicon and
both illustration sets byte-identical to an export; the menu's focus order (`menu-focus.test.ts`); and
`Badge`'s type. **`scripts/contrast-audit.browser.js`** is the rendered half of the contrast check
(D126), now step 6 of `DESIGN.md` → *Changing this system*.

**The battery, on `00066-wvx`, acting as the owner:** `verify-security` 68 (one run died on a local
`EHOSTUNREACH` mid-suite; the re-run passed), `verify-a11y` 92, `verify-api` 405 / 3 skipped,
`verify-templates` 47, `verify-postgres` 65, `verify-providers` 55, `verify-vault` 62,
`verify-observability` 68 / 1 structural skip, `verify-integrations` 60 / 2 skipped (Notion, Airtable),
`verify-timers` 34, `verify-durable all` passed — **0 failed**. **`smoke.mjs` failed two walks of three
and passed the third CLEAN.** Both failures were one cause: the generated Google Sheets node wrote a
cell as a whole-string `{{ }}` reference to a path the run never produced, so it resolved to `null` and
the cell refused it (`values.2`, then `values.0`/`values.1`); the branch and Discord beats failed after
it. Phase 28 changed no generator, engine or node code — this is generation quality, the run-to-run
variance `PROGRESS.md` already records — and it is a *Known Issue* owned by Phase 34's evals.

---

## Phase 29 — Canvas I — editing ergonomics

**Objective.** The canvas edits like a serious tool: mistakes are undoable, work is copyable, and
the keyboard reaches everything.

**Dependencies.** Phase 28 — new UI is built in both themes.

**Tasks.**
1. **Undo / redo.** A bounded history of graph states in the editor, as a pure, tested module.
   Coalesce a drag into one entry and a config edit into one entry per field. ⌘Z / ⇧⌘Z (Ctrl on
   other platforms) and toolbar buttons. Save is not a history boundary; loading, restoring a
   version and leaving diff mode clear the history.
2. **Copy, paste, duplicate.** Copy the selection (nodes plus the edges between them) to the
   clipboard as a recognisable JSON envelope. Paste mints new ids, offsets the positions, drops
   edges to nodes not pasted, and refuses a second trigger with a clear message (validation allows
   one). Works across workflows and tabs. ⌘D duplicates in place.
3. **Multi-select that does something.** Box select already works, but the inspector opens only for
   exactly one node. Add ⌘A and shift-click, and an inspector state for *N nodes selected* with bulk
   delete, duplicate and move.
4. **Auto-arrange.** A toolbar action that runs the generator's `layout()`
   (`src/lib/generate/layout.ts`, D40) over the current graph. Undoable.
5. **Shortcuts, and a way to discover them.** ⌘S save, F fit view, `/` focuses palette search, a
   `?` help dialog (also reachable from ⌘K). Never fire while the user is typing in a field.
   Platform-aware labels.
6. **Find on canvas.** "Find node" jumps to and selects a node by label, reusing the shared ranking
   in `src/lib/ui/command.ts` (D72, D76).

**Primary files.** `src/components/canvas/editor.tsx`, new `src/lib/canvas/{history,clipboard}.ts`,
`src/lib/canvas/bridge.ts`, `src/lib/generate/layout.ts`, `src/components/shell/command-palette.tsx`,
`src/components/ui/dialog.tsx`.

**Implementation notes.** D25: dirty state is structural, so undoing back to the saved graph must
read **clean**. D22: `fromFlow` is a clean inverse of `toFlow`, so a history entry is a graph, not a
React Flow state. Diff mode and the viewer role stay inert — no undo, no paste. React Flow already
binds Delete/Backspace; do not double-handle them. `editor.tsx` is over a thousand lines — **extract
hooks** (`useHistory`, `useClipboard`, `useShortcuts`) rather than growing it, and mind the two lint
rules that disagree about one dependency array in that file (`PROGRESS.md` → *Known Issues*).

**Validation steps.** Unit tests for history coalescing and paste id remapping. In a real browser,
in both themes: twenty mixed edits undone and redone; a selection copied from one workflow and
pasted into another; duplicate; bulk delete; a generated six-node graph auto-arranged and then
undone; the `?` dialog; the whole flow keyboard-only. Deployed.

**Completion criteria.** All of the above on the deployed URL.

**Documentation updates.** `DESIGN.md` (the shortcut vocabulary), `CONTRACT.md` (the clipboard
envelope, if another tab can read it), `README.md` features, `PROGRESS.md`.

**Commit.** `feat: complete phase 29 canvas editing ergonomics`

---

## Phase 30 — Canvas II — sticky notes and disabled nodes

**Objective.** An author can explain a workflow on the canvas itself, and switch a node off without
deleting it.

**Dependencies.** Phase 29 (notes and the disabled flag must be undoable and copyable).

**Tasks.**
1. **Sticky notes.** A `notes` list on the graph (id, position, size, text, a tone from a fixed set)
   — **not a registry node**: never executed, never an agent tool, invisible to validation's trigger
   rule (D112). Plain text: a note never renders HTML or Markdown that could carry markup. Move,
   resize, delete, undo, copy and paste.
2. **Disabled nodes.** A `disabled` flag on a node. **Decide the engine semantics and write them
   into `CONTRACT.md` before the code** — n8n passes a disabled node's input straight through to
   its default output, and the alternative is to skip everything below it. Cover the edge cases
   explicitly: a disabled trigger, a disabled branch or loop node, a disabled agent. The node's
   look joins the status vocabulary on non-colour channels (D75).
3. **Versions and diffs** understand both. A note can be added, removed, changed or moved; a
   disabled flag shows as a "changed" ribbon naming what changed (`src/lib/workflow/diff.ts`,
   `src/lib/canvas/changes.ts`).
4. **The share page.** A note's text is a value the author typed, so the allowlist (D98) **withholds
   it and counts it**. The disabled flag is shape and may be published.
5. **The generator** may emit neither: notes are for people, and a generated graph must not arrive
   with nodes switched off. The generation schema refuses both.

**Primary files.** `src/lib/workflow/{graph,diff,share}.ts`, `src/lib/canvas/{bridge,changes,status}.ts`,
`src/lib/engine/{execute,validate}.ts`, `src/lib/generate/schema.ts`,
`src/components/canvas/{editor,workflow-node,inspector}.tsx`, a new note component,
`src/components/share/shared-canvas.tsx`.

**Implementation notes.** D14: the graph is one `jsonb` column, so both features are fields on it
and save atomically. Decide deliberately whether additive optional fields need a `GRAPH_VERSION`
bump (`src/lib/workflow/graph.ts`); read `CONTRACT.md` → *Workflow / node / edge JSON* first. Test
the redaction the way Phase 20 learned to: **assert the note's text does not appear, not its key**.

**Validation steps.** Notes and disabled nodes round-trip losslessly through save and load. A run
containing a disabled node behaves exactly as `CONTRACT.md` says, on the deployed URL. The share
page withholds note text. The diff shows note and disabled changes. In a real browser, both themes.

**Completion criteria.** All of the above, deployed.

**Documentation updates.** `CONTRACT.md` (graph shape, disabled semantics), `DESIGN.md` (the note,
the disabled look), `SECURITY.md` (what a share page now withholds), `PROGRESS.md`.

**Commit.** `feat: complete phase 30 sticky notes and disabled nodes`

---

## Phase 31 — Canvas III — the test loop: pinned data and partial runs

**Objective.** An author can build a workflow step by step — fix one node's output, run one node,
run up to a node — without firing the whole thing every time.

**Dependencies.** Phase 30.

**Tasks.**
1. **Pin a node's output** from a step of a past run ("pin this output"), or as typed JSON. Stored on
   the node and **size-capped** — versions snapshot the whole graph (50 kept), so pinned data is
   multiplied by up to 50 in Neon's 0.5 GB. **Pinned data is never published on a share link** and
   is withheld or truncated when a graph is sent to a model.
2. **Run one node, or run up to here.** Execute a single node, or the path from the trigger to it,
   seeding upstream outputs from pinned data or from the last run's recorded steps. Reuse the
   cursor's frontier idea (D79) rather than writing a second engine. **An integration node really
   executes** — confirm before a partial run reaches a node that writes somewhere ("This will post
   to Slack").
3. **Test runs are labelled** and visible in history, and **excluded from analytics**. Decide
   deliberately whether one counts for onboarding's "a successful run" step.
4. **A manual-trigger input form.** `core.manual_trigger` may declare input fields (name, type,
   required), and the inspector renders a form instead of a raw JSON box. Raw JSON stays available
   as an advanced option.

**Primary files.** `src/lib/engine/{execute,run,cursor,types}.ts`,
`src/app/api/workflows/[id]/runs/route.ts`, `src/lib/nodes/core/manual-trigger.ts`,
`src/components/canvas/{inspector,run-panel,trigger-panel}.tsx`, `src/lib/analytics/*`.

**Implementation notes.** **Pinned data applies to manual and test runs only.** A webhook or
schedule run executes every node for real, because a pinned node silently not running in production
is the worst failure this feature could have. Say so in the inspector. The D16 bounds apply to
partial runs unchanged. A config field added to the manual trigger grows the generation prompt, so
check the budget (D112).

**Validation steps.** On the deployed URL: pin an HTTP node's output and run a downstream transform
alone, with the result checked by hand; run-to-here on a four-node graph; the manual form refuses a
missing required field. Analytics unchanged by test runs, recomputed from SQL the way
`verify-observability.mjs` does. A browser walk, both themes.

**Completion criteria.** All of the above, deployed.

**Documentation updates.** `CONTRACT.md` (pinned data, partial runs, the test label), `docs/nodes.md`
(regenerated), `PROGRESS.md`.

**Commit.** `feat: complete phase 31 pinned data and partial runs`

---

## Phase 32 — Library — organising workflows

**Objective.** A workspace with fifty workflows stays navigable, and a workflow can leave and enter
the product as a file.

**Dependencies.** Phase 28.

**Tasks.**
1. **Tags**, workspace-scoped: add, rename, delete, filter by. Editor and above may tag.
2. **Favourites**, per user: a *Starred* filter, and the ⌘K palette ranks starred workflows first.
3. **Duplicate** — a server-side clone of the current graph as a new workflow, which mints its own
   webhook token (D41).
4. **Export** a workflow as JSON in a versioned envelope (a format name and a format version).
   Credentials are referenced by kind and never exported — they never live in the graph, and a test
   proves no secret can appear.
5. **Import** from a file or a paste: validated by the same `validateGraph`, refusing a newer
   format version and naming any unknown node types rather than dropping them (D39's honesty).
6. **The list's view state in the URL** — search, filters, sort, tag — so it is linkable and
   survives a reload. Today it is plain component state.
7. **Folders are not built.** Tags cover the need with less structure. Record that as a decision.

**Primary files.** `src/db/schema.ts` and a migration, `src/lib/workflow/{store,list}.ts`,
`src/components/workflows/{workflow-list,actions}.tsx`, `src/app/api/workflows/*`,
`src/components/shell/command-palette.tsx`, `docs/api.md`.

**Implementation notes.** D69: the list is filtered in the browser over the whole list, so tags and
favourites must **ride along on the list query** — one statement, not one per card. Every new route
goes through the one role funnel (D93), and visibility (D101) applies to duplicates and exports.
`POST /api/workflows` already accepts a graph, so import is largely validation and messaging.

**Validation steps.** On the deployed URL, in a browser, both themes: tag and filter by tag through
a pasted URL; star; duplicate and run the duplicate; export, then import into another workspace and
run. Import refusals for a malformed file and an unknown node type. A viewer refused (403 naming the
role). `verify-api.mjs` extended.

**Completion criteria.** All of the above, deployed.

**Documentation updates.** `CONTRACT.md` (the export envelope), `docs/api.md`, `PRD.md`,
`PROGRESS.md`.

**Commit.** `feat: complete phase 32 workflow library`

---

## Phase 33 — Runs — history and recovery

**Objective.** Every run that ever happened can be found, opened, understood and retried. **Today
the run APIs exist and no screen calls them.**

**Dependencies.** Phase 31 (test runs are labelled), Phase 26 (the daily sweep).

**Tasks.**
1. **Run history on the canvas.** Recent runs with status, trigger, version and duration; opening
   one paints its statuses onto the canvas read-only.
2. **A workspace-wide `/runs` page.** Filter by status, trigger, workflow and date. **Paginate on
   the server** (keyset on start time and id) — unlike the workflow list (D69), this one grows
   without bound.
3. **A run detail page, `/runs/[id]`.** The graph at the version the run executed (D86) with that
   run's statuses, plus every step with its input, output, logs and error. A live run attaches to
   the stream (D27, D28). **Analytics failures link here.**
4. **Re-run and retry.** Re-run with the same input, as a new run (decide and label which version it
   runs). Retry from the failed step, seeding the frontier from the recorded upstream outputs
   (D79) so finished steps are not executed again. The new run links to the original.
5. **Retention.** Keep the last N days or K runs per workflow — choose the numbers from the measured
   bytes per run against Neon's 0.5 GB. **Pruned by Phase 26's daily sweep, never by a new
   schedule.** Shown in *Settings → Workspace*.

**Primary files.** new `src/app/runs/*`, `src/app/api/runs/*`, `src/lib/engine/{run,cursor,recorder}.ts`,
`src/components/canvas/run-panel.tsx`, `src/app/analytics/page.tsx`, `src/lib/analytics/*`,
`src/lib/triggers/tick.ts`.

**Implementation notes.** A viewer can read runs; a private workflow's runs are 404 to everybody it
is hidden from (D101). Load step bodies lazily — an HTTP node's output can be large. Measure the new
queries in milliseconds of database time, the way Phase 22 did.

**Validation steps.** On the deployed URL, in a browser, both themes: filter and paginate; open a
failed run from analytics; fix the config and **retry from the failed step**, then assert the
upstream steps were not re-executed (count the steps). A retention dry run reports what it would
delete, then deletes in a throwaway workspace.

**Completion criteria.** All of the above, deployed.

**Documentation updates.** `CONTRACT.md` (run links, retention), `docs/api.md`, `OPERATIONS.md`
(retention and storage), `PROGRESS.md`.

**Commit.** `feat: complete phase 33 run history and recovery`

---

## Phase 34 — Generator at scale — catalogue selection and evals

**Objective.** Generation stops sending the whole node catalogue on every call, so the registry can
grow again — and generation quality is measured rather than eyeballed.

**Dependencies.** Phase 33. **Gates Phases 35–40** (D112).

**Tasks.**
1. **Per-request catalogue selection.** Always send a compact index — one line per node; send full
   definitions (config schema, `outputShape`, docs) only for the nodes chosen for this request. Two
   candidate selectors: a first, cheap model call that picks from the index, or deterministic
   retrieval over labels, descriptions and docs. **Measure both against the eval set and choose.**
   A deterministic selector spends no quota.
2. **Re-base the budget test.** Replace the whole-catalogue 26,000-character assertion
   (`src/lib/nodes/registry.test.ts`) with per-request budgets: the index per node, and the worst
   case of a full selection. **D112 is lifted when this lands.**
3. **An eval set.** About twenty fixture prompts in the repository, each with expectations: a valid
   graph, the node types that must appear, ones that must not, and `unsupported` where it applies.
   An **offline** mode replays recorded model responses so CI needs no network; a **live** mode runs
   against the free tier, sparingly (once per session — the quota rule).
4. **Report which attempt succeeded.** Generation makes up to two attempts, feeding validation errors
   back; log and count which one produced the graph.

**Primary files.** `src/lib/generate/{prompt,generate,schema}.ts`, `src/lib/nodes/{index,registry.test}.ts`,
a new `scripts/eval-generate.mjs`, `docs/agents.md`.

**Implementation notes.** "A valid graph can still be the wrong graph": **the eval set is how the
selector is proved not to drop a node the request needed.** D38, D39, D40 and D57 all still hold. The
agent's tool list (`src/lib/ai/tools.ts`) is a separate consumer of the registry — measure its size
too, because a registry of 40 nodes will reach it next.

**Validation steps.** The eval pass rate before and after, recorded — selection must not lower it.
The prompt size, measured. Five eval prompts generated on the deployed URL in a browser and run.

**Completion criteria.** Selection is live, the budget test is re-based, the eval set runs in CI
offline, and D112 is marked lifted.

**Documentation updates.** `docs/agents.md`, `ARCHITECTURE.md` (*Generation as built*), `CONTRACT.md`
(*Generation request/response*, if it moved), `DECISIONS.md`, `PROGRESS.md`.

**Commit.** `feat: complete phase 34 generator catalogue selection and evals`

---

## Phase 35 — Copilot I — edit a workflow by conversation

**Objective.** "Also post the urgent ones to Slack" changes the workflow on the canvas — shown as a
diff the user accepts, never applied behind their back. Today generation can only *create*.

**Dependencies.** Phase 34 (the catalogue), Phase 29 (undo), Phase 18's diff mode.

**Tasks.**
1. **A copilot panel on the canvas.** Decide its place with measurements at 1440 px: Phase 16 spent
   itself winning back canvas width (D73), and a permanent third column would undo that — a drawer
   or a shared rail is likelier to be right.
2. **An edit request.** The current graph plus the instruction go to the model, which returns a full
   proposed graph. It is validated exactly like a generated one, and `unsupported` is reported
   honestly (D39).
3. **The proposal is shown in diff mode** — the union graph and the ribbons Phase 18 built — with
   Accept, Reject and *refine* ("no, to #alerts").
4. **Accept is one undoable step** (Phase 29) and leaves the graph dirty rather than auto-saving;
   the save makes it a version.
5. **Unchanged nodes keep their ids and positions**, or the diff reads as remove-plus-add; validate
   by id. Only new nodes are placed by `layout()`.
6. **The conversation is client state** for this canvas session — no table and no Neon cost unless a
   later phase earns one.

**Primary files.** `src/lib/generate/*` (an edit mode), a new copilot route under
`src/app/api/workflows/[id]/`, a new `src/components/canvas/copilot-panel.tsx`,
`src/components/canvas/diff/*`, `src/lib/canvas/changes.ts`.

**Implementation notes.** The model can propose only registry nodes, and nothing is applied without a
person pressing Accept — that is the security boundary, and `SECURITY.md` should say so. A viewer
cannot use it (403 naming the role). The user's own key pays, so a quota or key failure reaches the
user with a `details.recovery` door (Phase 25).

**Validation steps.** On the deployed URL, in a browser, both themes, on a generated workflow, five
requests: add a node, change a config value, remove a branch, rename, and something impossible (→
`unsupported`). Accept, undo, redo, save — a version is created. Reject leaves the graph untouched.

**Completion criteria.** All of the above, deployed.

**Documentation updates.** `docs/agents.md`, `CONTRACT.md`, `SECURITY.md`, `README.md`, `PRD.md`,
`PROGRESS.md`.

**Commit.** `feat: complete phase 35 copilot edits by conversation`

---

## Phase 36 — Copilot II — explain and repair

**Objective.** The copilot can explain what a workflow does, and say why a run failed and how to fix
it.

**Dependencies.** Phase 35, Phase 33 (the run detail page).

**Tasks.**
1. **Explain this workflow** — a plain-language walkthrough that cites nodes by label; selecting a
   sentence highlights its node.
2. **Why did this run fail?** — from `/runs/[id]` and the canvas's run panel. It sends the failed
   step's error, its config, upstream outputs **truncated**, and the graph, and returns a diagnosis
   plus, where it can, **a proposed fix as a diff** through Phase 35's Accept flow.
3. **Retry after the fix** — straight into Phase 33's retry-from-failed-step.

**Primary files.** `src/lib/generate/*`, the copilot route, `src/components/canvas/copilot-panel.tsx`,
`src/app/runs/[id]/*`.

**Implementation notes.** **Run data is untrusted.** A webhook payload sitting in an upstream output
can contain instructions, so the diagnosis prompt treats run data as data, and the worst it can
produce is a *proposal* a person must accept. Model output renders as text, never as HTML. Assert
that no credential material can reach the prompt — none should be in run records, and a test should
prove it.

**Validation steps.** On the deployed URL: three induced failure classes (a bad config value, an
external 4xx, a failed assert) each diagnosed correctly; a proposed fix accepted and the run retried
to `succeeded`. In a browser, both themes.

**Completion criteria.** All of the above, deployed.

**Documentation updates.** `docs/agents.md`, `SECURITY.md` (prompt injection, stated plainly),
`PROGRESS.md`.

**Commit.** `feat: complete phase 36 copilot explain and repair`

---

## Phase 37 — Workflows I — when things go wrong

**Objective.** A failure can be planned for inside a workflow, and someone hears about it when it
was not.

**Dependencies.** Phase 34 (this phase adds a node), Phase 33.

**Tasks.**
1. **Per-node on-error policy** beside retries and timeout in `policy` (D81): `stop` (today's
   behaviour), `continue` (the step records its failure and the run continues with the error as the
   output), or `route` (the node takes an **error** output). Handles come from the registry (D21,
   D23), so decide how a policy-dependent handle is drawn without breaking that — for example, a
   declared optional `error` output drawn only when the policy is `route`. Decide what a run that
   *handled* an error reports, and keep the status tables distinct (D75).
2. **An error trigger, `core.error_trigger`** — "when another workflow in this workspace fails" —
   receiving the workflow, the run id, the failed step and the error. Wired to Slack, Discord or
   Gmail, it **is** the failure alert. Bound it: an error workflow failing must not trigger itself
   or cascade.
3. **An in-app inbox.** A header bell with a count; entries for failed runs of workflows the reader
   can see (and Phase 38's approvals); read and unread per person. **Written in the same path as the
   failure** — the run has already woken the database — **and read on page load, never polled.**
   Pruned by the daily sweep.

**Primary files.** `src/lib/engine/{execute,policy}.ts`, a new `src/lib/nodes/core/error-trigger.ts`,
`src/lib/nodes/types.ts`, `src/db/schema.ts` and a migration, `src/components/shell/app-header.tsx`
and a new inbox component, `src/lib/canvas/status.ts`, `src/components/canvas/{policy-form,workflow-node}.tsx`.

**Implementation notes.** The error trigger is a new node: the five registry obligations apply.
Visibility (D101) decides whose inbox a failure reaches.

**Validation steps.** On the deployed URL: `continue` and `route` behave exactly as `CONTRACT.md`
says; an error workflow posts a **real** Slack or Discord message when another workflow fails; the
inbox shows it and marks it read; the network panel shows **no interval requests**. In a browser,
both themes.

**Completion criteria.** All of the above, deployed.

**Documentation updates.** `CONTRACT.md` (policy, run status, inbox), `docs/nodes.md`, `DESIGN.md`
(the inbox, the error handle), `PRD.md`, `PROGRESS.md`.

**Commit.** `feat: complete phase 37 error handling and failure alerts`

---

## Phase 38 — Workflows II — human in the loop

**Objective.** A workflow can stop and ask a person, then carry on with their answer — hours or days
later.

**Dependencies.** Phase 37 (the inbox), Phase 26 (`waiting` and timers).

**Tasks.**
1. **`core.approval`.** It pauses the run in `waiting` and creates an approval request: who may
   decide (any editor and above, or named members), and a message built with `{{ }}` lookup only
   (D17). Outputs: static `approved` and `rejected` handles (D23-friendly), plus the decision, the
   decider and a comment.
2. **Three ways to decide.** In the inbox and on the canvas. Through a **signed, single-use link** the
   author sends with any notification node they already use — hashed at rest (D95's pattern),
   expiring, and opening a confirmation page: **a GET changes nothing**, because a chat app's link
   preview must not approve anything. And by **timeout** — a Phase 26 timer with a configured
   outcome (reject, approve, or fail).
3. **Resume** through Cloud Tasks from the cursor.

**Primary files.** a new `src/lib/nodes/core/approval.ts`, `src/lib/engine/{run,lease,cursor}.ts`, new
`src/app/api/approvals/*`, a new public decision page, `src/db/schema.ts` and a migration, the inbox
components, `scripts/verify-security.mjs`.

**Implementation notes.** **A new unauthenticated surface**: enumerated by `verify-security.mjs` and
written into `SECURITY.md` in this phase. The decision is a POST carrying the token in its body.
`agentCallable` is **false** — an approval is a guard an author places, the reasoning D36 used for
`core.assert`. A waiting run holds no lease.

**Validation steps.** On the deployed URL: a run pauses; the approval link goes to a **real** Discord
or Slack channel; approving from a **signed-out** browser resumes the run down the approved path.
Reject works. Timeout works. A used link is dead. A bare GET — what a link preview does — changes
nothing (asserted).

**Completion criteria.** All of the above, deployed.

**Documentation updates.** `CONTRACT.md`, `SECURITY.md`, `docs/nodes.md`, `docs/api.md`, `PRD.md`,
`PROGRESS.md`.

**Commit.** `feat: complete phase 38 human approval steps`

---

## Phase 39 — Workflows III — composition: sub-workflows, workflow tools, merge

**Objective.** Workflows can be built from other workflows, an agent can call a workflow as a tool,
and a diamond-shaped graph joins properly.

**Dependencies.** Phase 34, Phase 26 (durable children).

**Tasks.**
1. **`core.call_workflow`.** Calls another workflow in the same workspace — visibility applies
   (D101) — with mapped input, waits for its result, and returns the child's output. Parent and
   child runs link both ways. Bound it: a maximum depth, a cycle refused at save **and** at run
   time, and the child counted against the parent's budgets — extend D16 rather than invent a new
   family. Decide whether a long child runs durably and resumes its parent.
2. **Workflows as agent tools.** A workflow can be marked *callable by agents* with a name, a
   description and an input shape; `ai.agent`'s tool list gains it (opt-in, in D19's spirit), and
   the tool call becomes a child run. This is the most *agentic* feature in the chapter.
3. **`core.merge`.** Wait for all incoming branches, or take the first to arrive, and run **once**.
   It closes the row `ARCHITECTURE.md` → *What is intentionally simplified* has carried since
   Chapter 1: "a diamond's merge point runs once per arriving branch". That row also notes the
   cursor makes it expressible.

**Primary files.** new `src/lib/nodes/core/{call-workflow,merge}.ts`,
`src/lib/engine/{execute,cursor,validate}.ts`, `src/lib/ai/tools.ts`, `src/lib/workflow/store.ts`,
`src/components/canvas/inspector.tsx`.

**Implementation notes.** Two new nodes, so five obligations each. The tool list's size (measured in
Phase 34) matters again once workflows join it. `"agent"` is already reserved in `TRIGGER_KINDS`
(`src/lib/engine/types.ts`) and never used — decide whether a child run is that trigger kind.

**Validation steps.** On the deployed URL: a parent calls a child and the output flows back; a cycle
is refused; the depth bound holds; an agent calls a workflow tool and the child run is visible on
its own; a diamond with `core.merge` runs the join once with both inputs. In a browser, both themes.

**Completion criteria.** All of the above, deployed.

**Documentation updates.** `CONTRACT.md` (execution semantics, run links), `ARCHITECTURE.md` (the
join row closed), `docs/agents.md`, `docs/nodes.md`, `PRD.md`, `PROGRESS.md`.

**Commit.** `feat: complete phase 39 sub-workflows agent workflow tools and merge`

---

## Phase 40 — Workflows IV — public entry points: forms and webhook responses

**Objective.** A workflow can start from a form a stranger fills in, and a webhook can answer its
caller with real data.

**Dependencies.** Phase 34, Phase 28 (a public page in both themes).

**Tasks.**
1. **`core.form_trigger`.** The node declares fields (label; type — text, long text, email, number,
   select, checkbox, date; required; options). A hosted public page renders the form in Toybox at an
   unguessable, rotatable URL (D41's pattern), validates **server-side** against the same schema,
   and starts a run. A honeypot field, a body-size cap, and per-token rate limiting. The success and
   failure messages are configurable.
2. **`core.respond` — respond to the webhook.** It sets the status (an allowlisted range), a JSON
   body built by lookup only (D17) and an allowlisted header set. The webhook route answers with it
   instead of the run summary. Only valid in a workflow with a webhook or form trigger — validation
   enforces it.

**Primary files.** new `src/lib/nodes/core/{form-trigger,respond}.ts`, a new public form page and
its route, `src/app/api/webhook/[token]/route.ts`, `src/lib/triggers/*`, `scripts/verify-security.mjs`,
`SECURITY.md`.

**Implementation notes.** **Two new unauthenticated surfaces**, enumerated and documented in this
phase. Rate limiting is in memory and therefore per instance (`max-instances 3`) — say so rather
than imply more. The form page is public and has no session, so it follows the visitor's theme
preference if the browser holds one, and Light otherwise (D110).

**Validation steps.** On the deployed URL: the form submitted signed out, at phone width, in both
themes, and the run succeeds; a missing required field is refused; the rate limit and the honeypot
both act; `curl` against a webhook gets the custom response. `verify-security.mjs` covers both new
surfaces in both directions.

**Completion criteria.** All of the above, deployed.

**Documentation updates.** `CONTRACT.md` (*Trigger shapes*), `SECURITY.md`, `docs/nodes.md`,
`docs/api.md`, `PRD.md`, `PROGRESS.md`.

**Commit.** `feat: complete phase 40 form trigger and webhook responses`

---

## Phase 41 — Public API — personal access tokens

**Objective.** Everything a person can do with workflows and runs in the browser, a script can do
with a token.

**Dependencies.** Phase 33 (the run routes worth exposing exist).

**Tasks.**
1. **Personal access tokens.** Created in *Settings*, **shown once**, stored only as a hash (D95).
   A recognisable prefix so a leaked one is easy to find. Scoped to one workspace and a role ceiling
   no higher than the creator's — **re-checked on every request**, so a demoted member's token loses
   power with them. Expiry required. Revocable. A last-used time written at most once per few
   minutes, not once per request (Neon).
2. **Bearer auth through the one funnel.** `requireScope` in `src/lib/api.ts` accepts
   `Authorization: Bearer` for an **allowlisted** set of routes — workflows, runs, starting a run,
   generation — and **never** for token management, credentials, members or the vault.
3. **Rate limiting per token**, in memory, documented as per instance.
4. **Documentation that cannot rot.** `docs/api.md` gains authentication and `curl` examples, and
   `docs:check` keeps covering every route. An OpenAPI document only if it can be **generated** from
   the route schemas — a hand-written one is a second source of truth (the Phase 24 rule).

**Primary files.** `src/lib/api.ts`, `src/db/schema.ts` and a migration, new token routes under
`src/app/api/`, a new settings panel in `src/components/settings/`, `docs/api.md`,
`scripts/build-docs.mjs`, `scripts/verify-security.mjs`, `SECURITY.md`.

**Implementation notes.** A bearer request carries no cookie, so no CSRF surface — but a token is a
credential: never logged (Phase 22's logging must be checked for it), never returned again after
creation. Another workspace's resource is still 404 (D20).

**Validation steps.** On the deployed URL with `curl`: create a token, list workflows, start a run;
revoke it and get 401; a viewer token cannot write; a token for workspace A cannot see B; demote
the creator and the token's writes are refused. Grep Cloud Logging for the token: absent.

**Completion criteria.** All of the above, deployed.

**Documentation updates.** `docs/api.md`, `SECURITY.md`, `CONTRACT.md`, `README.md`, `PROGRESS.md`.

**Commit.** `feat: complete phase 41 public api and personal access tokens`

---

## Phase 42 — Chapter 3 launch polish

**Objective.** The last pass over everything Chapter 3 added, with a stranger in mind — in both
themes.

**Dependencies.** Phases 26–41.

**Tasks.**
1. **Accessibility in both themes.** `verify-a11y.mjs`, plus keyboard walks of every new surface:
   undo and paste, the copilot, the inbox, the approval page, the form page, token settings.
2. **Security review** of every new unauthenticated surface — the form, approval links, bearer
   tokens, the share page with notes — with `verify-security.mjs` complete in both directions, and
   `SECURITY.md` → *What we do not claim* updated.
3. **Performance.** The canvas bundle after undo and the copilot (React Flow alone is 455 KB),
   measured; Core Web Vitals on the new pages, cold, in both themes.
4. **Onboarding** updated for the product Chapter 3 built. Every new screen's empty state designed,
   with an action.
5. **Who can sign in.** The OAuth consent screen is in *Testing*, so **only listed test users can
   sign in to the hosted app** — a stranger cannot. Find out what publishing would take with
   sign-in's identity-only scopes, given the separate Sheets and Gmail scopes (D46)
   (`UNKNOWN — VERIFY` against Google's current rules). It may need a `MANUAL ACTION REQUIRED`
   block, and it may honestly stay a stated limitation.
6. **Documentation.** `README.md` features and both-theme screenshots; `docs/` (nodes regenerated,
   api, agents); ADRs for Chapter 3's load-bearing decisions — timers on Cloud Tasks, three themes,
   catalogue selection, the copilot's diff-and-accept boundary.

**Validation steps.** Both audits ALL PASSED on the deployed URL. A brand-new workspace taken from
nothing to a successful run, then edited by the copilot, in a browser, in both themes.

**Completion criteria.** Audits clean or every exception recorded with a reason; documentation
reconciled; `PROGRESS.md` marks Chapter 3 complete.

**Documentation updates.** All, reconciled.

**Commit.** `feat: complete phase 42 chapter 3 launch polish`

---

## After Phase 42

Chapter 3 deliberately stops short of:

- internationalisation and voice input (deferred since Chapter 1)
- a plugin marketplace with external publishing
- real-time multiplayer editing
- mobile apps
- billing
- SSO beyond Google
- parallel node execution
- folders (tags instead — Phase 32)
- new third-party integrations — after Phase 34 they are additive again, and the cheapest
  contribution the architecture allows (`CONTRIBUTING.md`)

When Phase 42 is done, **re-plan rather than extend this ladder by reflex — and bring numbers.**
