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
29  Canvas I — editing ergonomics                          ✅
30  Canvas II — sticky notes and disabled nodes            ✅
31  Canvas III — the test loop: pinned data and partial runs  ✅
32  Library — organising workflows                         ✅
33  Runs — history and recovery                            ✅
34  Generator at scale — catalogue selection and evals      ✅
35  Copilot I — edit a workflow by conversation             ✅
36  Copilot II — explain and repair                         ✅
37  Workflows I — when things go wrong                      ✅
38  Workflows II — human in the loop                        ✅
39  Workflows III — composition: sub-workflows, workflow tools, merge  ✅
40  Workflows IV — public entry points: forms and webhook responses  ✅
41  Public API — personal access tokens  ← START HERE
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
- **~~No new registry node before Phase 34 (D112)~~ — lifted by Phase 34 (D156).** Phases 26–33
  extended existing nodes or added things that are not nodes, because the whole catalogue went into
  every generation prompt. Since Phase 34 a request gets full definitions only for the nodes
  selected for it, and a new node costs every request one index line (~116 characters). **A new
  node must be selectable**: `select.test.ts` asserts that naming any node's label selects it, and
  the eval set (`src/lib/generate/eval/`) should gain a case that needs it
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
   version and leaving diff mode clear the history. *(Built: loading and restoring clear it;
   **leaving diff mode does not** — diff mode never touches the editing graph, so clearing would
   only discard the undo of work done before comparing. D128.)*
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
   Platform-aware labels. *(Built with one exception: **⌘S saves from a field** — it means
   nothing there, and the alternative is the browser's "Save page as". D130.)*
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

**Status: COMPLETE, 2026-10-07 — deployed as `agentforge-00071-k5m` and verified there in a real
browser in Light and Toybox Night.** Five deploys, `00067-rxt` to `00071-k5m`: the first shipped the
phase, and each later one carried what the deployed canvas found. What was built:

- **Undo / redo** — `lib/canvas/history.ts` (pure, 19 tests) and `use-history.ts`, which records the
  graph from before every structural change by watching the canvas rather than instrumenting each
  edit (D128). A drag is one step however long; a field is one step until 1.5 s of quiet. Loading
  and restoring clear it; **leaving diff mode does not** (D128 — the plan said it should). Forms
  holding drafts remount on every undo, so a field never shows text Undo just replaced
- **Copy, cut, paste, duplicate** — `lib/canvas/clipboard.ts` (23 tests) and `use-clipboard.ts`: the
  `agentforge/nodes` envelope on the system clipboard as plain text (`CONTRACT.md`, D129). Ids kept
  where free, edges re-pointed, `{{steps.<id>}}` references between pasted nodes rewritten, a second
  trigger left out with a note, a paste of far-away nodes landed in the middle of the screen
- **Multi-select** — ⌘A, Shift-click (`multiSelectionKeyCode` gains Shift), and the *N nodes
  selected* inspector: Duplicate, Copy, a four-way Move pad, Delete, and the list
- **Auto-arrange** — the generator's `layout()` (D40, its types narrowed to what it reads)
- **Shortcuts** — one table, `lib/canvas/shortcuts.ts`, drives the key handler and the `?` card
  (D130); platform-aware labels (`lib/ui/keys.ts`, `ui/kbd.tsx`); ⌘S the one key that works while
  typing. Undo, Redo, Auto-arrange and `?` live in the canvas's control stack, not the toolbar (D131)
- **Find on canvas** — every node is a ⌘K command (`canvas-commands.ts`, 6 tests), and a found node
  takes focus

**Found on the deployed canvas, all fixed and re-verified:**

- **A click and an immediate ⌘D acted on the previous selection.** The selection was state set
  from React Flow's `onSelectionChange`, which runs a render after the click; it is read off the
  nodes now (D132)
- **A viewer could never select a node** — since Phase 20, not this phase: withholding
  `onNodesChange` also dropped the selection. `readOnlyChanges` (D132). *Unit-tested only*: no
  viewer membership exists, and seeing it would have meant reading another account's workspace,
  which was declined
- **The Move pad's buttons overlapped**, squeezed by the caption beside them
- **The keycaps were monospace and too small to read the ⌘ glyph** — a `<kbd>` inside a `<kbd>`
  takes the browser's monospace
- **After *find a node* focus went back to the ⌘K button**, thirty tab stops from the node
- **⌘K printed a heading twice** when the ranking interleaved two groups (`keepGroupsTogether`)
- **The D124 gate caught `stroke-icon`** before it shipped — Tailwind read it as a stroke colour

**Verified in a real browser on the deployed service**: a generated six-node graph took **twenty
mixed edits** — drags, a label, a select, typing, add, delete, duplicates, arrange, the Move pad, bulk
duplicate (trigger left out, with the note), bulk delete, Shift-click delete, cut, paste, arrow nudges
— and **twenty ⌘Z returned a canvas snapshot-identical to the generated graph, reading "Saved · v1"**;
twenty ⇧⌘Z/⌘Y returned the end state exactly, with Redo then disabled. A selection copied with ⌘C
and pasted with ⌘V into another workflow (ids kept, the edge between them, selected); the trigger
refused into its own workflow; duplicate; bulk delete; a generated graph disturbed, auto-arranged
back to exactly its generated layout, and undone exactly; the `?` card; ⌘K finding a node by label;
`/`, F and ⌘S; ⌘Z after a save. **Keyboard only**: ⌘A, ⌘C, ⌘V, ⌘Z, ⌘K to a node that took focus, the
arrows, ⌘D, Delete, ⌘Z ×3 back to clean, ⌘K to the card. The audit
(`scripts/contrast-audit.browser.js`, extended to measure the `aria-hidden` keycaps and hints) was
**clean in both themes** on the canvas, the selection inspector, the card (35 caps), ⌘K with canvas
results, and an error toast; at 375 px in Night the toolbar is still two rows and the stack fits.

**What the browser could not do, said plainly.** The paste into a *second tab* was not driven: a tab
the extension opens sits hidden, and a hidden tab takes no input. It is the same `paste` event on the
same system clipboard as the cross-workflow paste that was driven. Shift was held by a dispatched
keydown, because the tool's click modifier sets `shiftKey` without pressing the key. **Safari** was
not tested — copy is written from the key press precisely so it does not depend on Safari's `copy`
event, but that is reasoning, not a run.

**The battery, on `00069-nsh`**: `verify-security` 68, `verify-a11y` 92, `verify-api` 404 / 4 skipped
(the fourth runs only while Google is *dis*connected), `verify-templates` 47, `verify-postgres` 65,
`verify-providers` 55, `verify-vault` 62, `verify-observability` 68 / 1 structural skip,
`verify-integrations` 60 / 2 skipped (Notion, Airtable), `verify-timers` 34, `verify-durable all` —
**0 failed**. On the final `00071-k5m`, `verify-a11y` 92 and `verify-security` 68 again. 1165 tests;
coverage 89.09 / 91.59 / 82.25.

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

**Status: COMPLETE, 2026-10-08 — deployed as `agentforge-00075-566` and verified there in a real
browser in Light and Toybox Night.** Two sessions (the first stopped on a usage limit with the work
deployed as `00072-n8v` and committed as WIP, `b9da4ac`); four deploys, `00072` to `00075`. What was
built:

- **The contract first** — `CONTRACT.md` → *Disabled nodes* was written before the engine code (D133):
  a switched-off node passes its input straight through its default output; Branch, Switch and Loop,
  which have none, stop their path; the trigger cannot be switched off (`disabled_trigger`, naming the
  Active switch); the run records a `disabled` step — its own status, not `skipped` — with no
  timestamps and its input as its output; resume rehydrates it; a switched-off node's config is not
  validated but its structure is. 15 engine tests, one per clause
- **The graph** — `disabled: true` (never `false`) and `notes` (written only while there is one), no
  `GRAPH_VERSION` bump, one id space for nodes and notes refused at the schema (D134). Undo coalesces
  typing in a note (`note:<id>`) and a resize (a gesture); the clipboard envelope carries notes as an
  optional field at version 1 (`CONTRACT.md`); diffs report notes (`added` … `unchanged`, fields
  `text`/`tone`/`size`) and the off switch as a named field
- **The share page** withholds a note's text and counts it, and publishes the off switch (D135); the
  test searches for the note's *words*. **The generator** drops both (D136) — dropped, not refused,
  against the plan's wording
- **The canvas** — notes as a second React Flow node type in their own list (D137), behind the nodes,
  edited by double-click or from the inspector, resized by their corners, five tones that are existing
  `-pop` fills; *Run this node* in the inspector with a hint per node kind, *Switch off / on* for a
  selection, **D** and **N**; the switched-off look joins the status table — "Switched off", `⊘`,
  dotted, recessed — and the lit path runs through it

**Found in the real browser, all fixed and re-verified:** the resize handles were clipped by the note's
`overflow-hidden`, so a note could not be resized; below `lg` the inspector drawer covered a note being
typed into; the hint on a Branch that is on read as if it were off; and the contrast audit found four
dimmed or mis-inked labels — the inspector header's node id (`opacity-70`, **3.26:1** in Night), the
diff bar's *moved* count (`accent-ink` on `surface`, **1.06:1** in Night, since Phase 18), the moved
ribbon's matching pair, and the Run label dimmed while running. A first finding — a new note not
opening for typing — was the background window, not the code: re-run in front, it opens at 1920 and
at 600 px.

**Verified in a real browser on the deployed service**, Light and Night: a note added, typed into
(three edits one step of undo, undone to "Saved · v1"), double-clicked and typed into with real keys,
dragged under a node (it sits behind nodes and edges), resized from a corner and undone in one step,
recoloured; the keyboard path — a note focused by its accessible name ("Sticky note: …"), Enter into
the inspector, the arrows, one ⌘Z; copy and paste of a note; D on a node, the inspector switch, D on
the trigger (refused with the Active-switch message); a save read back exactly from the API; a run
with input whose switched-off nodes recorded "Switched off" with their line and whose branch targets
were skipped, the path lit through the switched-off nodes; version history counting notes, and diffs
v3→v4 and v1→v4 with *Changed · switched off*, *Added* and *Moved* ribbons and the bar's counts; the
share page; the 600 px drawer. **The contrast audit is clean** on the editor, the run panel, the node
and note inspectors, the selection inspector, both diffs and the share page, **in both themes**,
including the `aria-hidden` glyphs.

**The battery, on `00075-566`:** `verify-security` 68, `verify-a11y` 92, `verify-api` 425 / 3 skipped
(a stored key, a free-tier rate limit on one probe, Google connected) — its new Phase 30 block of 15
included — `verify-templates` 47, `verify-postgres` 65, `verify-providers` 55, `verify-vault` 62,
`verify-observability` 68 / 1 structural skip, `verify-integrations` 60 / 2 skipped (Notion,
Airtable), `verify-timers` 34, `verify-durable all` — **0 failed**. `smoke.mjs` **CLEAN**. 1222 tests;
coverage 89.36 / 91.72 / 82.74.

**Not driven, said plainly:** a *viewer* reading a note (no viewer membership exists — the standing
Known Issue), and Safari.

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

**Status: COMPLETE, 2026-10-08 — deployed as `agentforge-00077-wtm` and verified there, on the API and
in a real browser in Light and Toybox Night.** Two deploys: `00076-pv6` shipped the phase, `00077-wtm`
what the browser walk found. What was built:

- **Pinned output** — `pinned: { output }` on a node, optional and additive with no `GRAPH_VERSION`
  bump, capped at 32 KB a pin and 128 KB a workflow at the graph schema (D138). Only a node with a
  default output can hold one a run honours. Carried by copy and paste, versioned, named in a diff;
  dropped by a share link and by the generator
- **Only a test run honours a pin** (D139): `run.test`, migration `0013`, set at creation and read by
  the engine off the row. A webhook, schedule or agent run is never a test, so a pinned node runs for
  real — proved on the deployed service with a pinned HTTP node to an unresolvable host
- **The `pinned` step status** (D140) — never executed, input recorded, output the pin; rehydrated on
  resume; a raised card with `◆`, and a *Pinned* chip on any node holding a pin
- **Partial runs** (D141) — `target: { scope: "node" | "path", nodeId }`. *Test this node* seeds the
  target from pins, pass-through and the latest succeeded outputs of the workflow's last 20 runs,
  and refuses with what to do when nothing upstream has a value; *test up to here* runs the
  trigger's way to the target and stops. The target always executes; sync only; no waits; nothing
  recorded outside the scope; a test needs only what it executes to be well configured. One engine:
  the frontier starts at the target, and `follow` narrows the edges (`lib/engine/partial.ts`)
- **Test runs are labelled and kept out of analytics** (D142) — every figure filters `test is null`,
  a fourth statement counts them and the page says how many; onboarding's "successful run" step
  does not count one
- **The confirmation** (D143) — `effect` on seven integrations and the agent, data read off the
  stored config; the canvas lists what a partial run would really do and asks
- **The manual trigger's `fields`** (D143) — `{ name, type, required }`, enforced by the trigger at
  run time (`checkManualInput`) and by the editor first; a *Run with* form that edits the one JSON
  input, *Edit as JSON* one click away. The prompt grew 39 characters (25,081). A generic **`rows`
  editor** renders it — and collected Postgres's `where`, which Phase 23C left waiting for one
- **The canvas** — the node's test loop in its own panel (`node-test-panel.tsx`): *Test this node*,
  *Test up to here*, the node's output with *Pin this output*, and the pin with *Edit* / *Unpin*;
  a `◇ Test · …` chip in the run panel; the pins named beside the Run input

**Verified on the deployed service**: `verify-api` 444 passed / 2 skipped, its 18 new Phase 31 checks
included — the pinned HTTP node not called in a test and called for real by a webhook, a node tested
alone fed from the pin, up-to-here stopping at its target, analytics unchanged by three test runs and
counting them, a malformed test refused rather than run whole, a 33 KB pin refused, the share link
never carrying the pin's words, a missing required field failing the trigger. The battery on
`00076-pv6` — `verify-security` 68, `verify-a11y` 92, `verify-templates` 47, `verify-integrations` 60 /
2 skipped (Notion, Airtable), `verify-timers` 34, `verify-postgres` 65, `verify-providers` 55,
`verify-vault` 62, `verify-observability` 69 / 1 structural skip (its new check: test runs counted on
their own), `verify-durable all` — **0 failed**. `smoke.mjs`: beats 1–6 clean (generation, edit,
webhook, the live stream); **beats 7–8 stopped on the free-tier Gemini quota** the battery had spent
("retry in 18h") — a model call, not this phase's code.

**Walked in a real browser on the deployed canvas**, Light and Night, on a five-node workflow
(manual trigger with a required `topic` → HTTP GET to the GitHub API → Set → Discord → Log): Run
refused with `topic` empty, naming the field; *Test this node* on the HTTP node refused with what to
do; *Test up to here* ran two steps; *Pin this output* pinned 11.6 KB, and the card wore *Succeeded* and
*Pinned*; *Test this node* on the Set node was fed from the pin, showed `repo` and `stars` resolving
empty because the response nests under `json`, and — references fixed in the form — gave
`arunishrajput/AgentForge`, `0`, `launch week`, checked by hand against the pin; *Test up to here* on
Discord opened the confirmation, cancelled; *Pin JSON…* refused half-typed JSON; Run with both writers
pinned recorded both `pinned` and sent nothing, the run panel reading *◇ Test · pinned data*; the
trigger's `fields` row editor added a boolean field that appeared in the form at once, undone in two
steps back to *Saved · v4*; analytics read "6 test runs are not counted" — the walk's six; 600 px in a
same-origin iframe, the drawer 368 px with both test buttons and the form unclipped, no sideways
scroll. **The contrast audit was clean on every state in both themes**, with and without the
`aria-hidden` glyphs.

**Found in the browser, fixed in `00077-wtm`, re-checked in both themes:**

- **The run form was out of reach from a node's Test section.** *Test up to here* runs the trigger,
  and with a node selected the *Run with* form was in the workflow panel, not on screen; it now sits
  under the test buttons when the trigger declares fields
- **The lit path went dark after a pinned node.** An edge lit only when its source *succeeded* or was
  *switched off*; the rule is now `edgeRunLook` in `status.ts`, with a test that fails on the old rule
- **The dialog's grammar** ("one step … act"), and its advice to pin when the only writer listed was the
  node being tested, which always runs

**One real Discord message was posted by mistake during the walk** — Run pressed before a pin had
landed (the *Pin* button moved up as the JSON error cleared, so the click missed). The product did what
it says: an unpinned Discord node runs on Run. It is message `1557623006375968789` in
`#agentforge-demo`. 1271 tests; coverage 89.67 / 91.84 / 83.46.

**Not driven, said plainly:** a *viewer* opening the test panel (it shows the output and the pin
read-only and no buttons — reasoned, not driven, the standing Known Issue), and Safari.

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

**Status: COMPLETE, 2026-10-08 — deployed as `agentforge-00080-xwm` and verified there, on the API and
in a real browser in Light and Toybox Night.** Three deploys: `00078-ktw` shipped the phase, `00079-p99`
and `00080-xwm` what the browser walk found. Migration `0014` — three new tables, nothing altered. What
was built:

- **Tags** (D144) — `tag` and `workflow_tag`, unique per workspace ignoring case by an index on
  `lower(name)`; create, rename, delete and assign at `editor`; assigning replaces the set in one
  statement whose tags are selected through the workspace. Tagging writes no version and does not
  move `updatedAt`. Managed from *Manage tags* on the list and *Tags…* on each row; a tag on a card is
  a button that filters by it
- **Stars** (D148) — `workflow_star`, per person, and a `viewer` may star. A *Starred* filter, and ⌘K
  lists starred workflows first in a group of their own — winning a tie, losing to a better match
- **Tags and stars ride along on the list query** (D69, D148) — two correlated subqueries, written as
  literal qualified SQL (`library-sql.ts`) because drizzle renders a column unqualified in a select
  list; only the list carries them
- **Duplicate** (D147) — server-side, through `createWorkflow`: its own webhook token, the graph with
  pins, the original's visibility and tags, no stars, **switched off when its trigger runs by itself**,
  version 1 labelled with its source
- **Export** (D146) — `agentforge/workflow` version 1: name, description, graph, built field by field;
  no id, token, owner or workspace, and no credential can be in it (a test searches for sentinels in
  every secret-shaped column). **Pins only on request** — the list asks, in a dialog, when a workflow
  holds one
- **Import** (D146) — the envelope as the body, 2 MB at most; format and version read before the
  shape; a newer version refused as newer; a clipboard of nodes pointed at the canvas; a malformed
  workflow refused with the failing paths; **an unknown node type refuses the whole file, naming every
  type** (422); any other problem imports `runnable: false`. Switched off when it runs by itself. From
  a file or a paste, in the list's *Import* dialog
- **The view in the URL** (D149) — `q`, `status`, `trigger`, `tag` (a name, ignoring case), `starred`,
  `sort`, parsed forgivingly on the server and written back with `replaceState(null, …)`; a URL naming
  a tag that does not exist says so
- **Folders not built** (D145)

**Verified on the deployed service**: `verify-api` **480 passed / 3 skipped** on `00078-ktw` — a Phase 32
section of 41 checks (tags, the case-insensitive clash, a foreign tag refused with nothing written,
tagging not a version, stars idempotent, a duplicate's token, graph, tags, label and run, a webhook
duplicate switched off and its webhook refusing 409, visibility inherited, an export free of every
token and id, pins out by default and in on request, an import into a second workspace equal to the
graph and run there, and six refusals that created nothing) plus ten matrix rows, every role below
the bar refused and a viewer told which role a duplicate needs. The third skip is Discord's
end-to-end post, left to the smoke walk. `verify-security` 78 (the seven new routes, ten methods,
all 401 without a session; the exception table unchanged at 11), `verify-templates` 47,
`verify-integrations` 60 / 2 skipped, `verify-timers` 34, `verify-postgres` 65, `verify-providers` 55,
`verify-vault` 62, `verify-observability` 69 / 1 structural skip, `verify-durable all` — **0 failed**.
**`smoke.mjs` clean, all eight beats** — which closes Phase 31's re-run note. On `00080-xwm`: the Phase 32
checks 41 / 41, `verify-a11y` 92, `verify-security` 78, `verify-templates` 47.

**Walked in a real browser on the deployed list**, Light and Night, with two probe workflows (a trigger
and a log — nothing that writes anywhere): a pasted `?q=` opened searched; starred (the count moved);
two tags created and saved from *Tags…*; a tag chip filtered the list and wrote `?tag=`; a pasted
`?tag=…&starred=1&sort=name` opened exactly that view; the webhook probe duplicated, opened switched
off with its note, and ran; *Export as JSON…* asked about the pin, unticked, and the file — captured in
the page rather than saved to disk — held no pin and no id, and with the box ticked held the pin; a
second workspace was made, the export imported there (refused first as not JSON, then naming
`integration.trello` and `core.merge`), opened with its pin and note, and ran as a test; ⌘K led with
*Starred*, and a starred match won the tie; *Manage tags* renamed and deleted. **The contrast audit
was clean on every state in both themes**, with and without the `aria-hidden` glyphs; at 375 px in a
same-origin iframe nothing scrolled sideways and every target was at least 24 px.

**Found in verification, fixed, re-checked:**

- **Every card's tags read back empty** — drizzle renders an interpolated column unqualified in a select
  list, so the correlation was `"workflowId" = "id"`, bound to the tag. Found by the Phase 32 checks
  against a local build before the first deploy; literal SQL now, and a test that renders the query
- **A tag clash quoted what was typed**, not the tag that holds the name — now the stored spelling, on
  the server and in the dialog
- **The file input had no accessible name** (`verify-a11y` 91 / 1 on `00078-ktw`) — the hidden-input-
  behind-a-button pattern is now the input inside a label that wears its focus ring
- **`?tag=BILLING` filtered the list and the select read *Any tag*** — a `<select>` given a value no
  option has shows its first; it is given the matched tag's name (`tagSelectValue`)
- **The export dialog reopened still ticked** — dialogs reset on every opening, not only for a new
  workflow; the tags dialog's Cancel had the same flaw (`lib/ui/subject.ts`)
- **An error under a tag field pushed *Add* below the field** — the error sits under the row now
- **The address bar fell back to the loaded URL after any refresh** — a renamed tag kept a link to its
  old name. Next 16's patched `replaceState` ignores a call carrying its own `__NA` state, which
  `window.history.state` is; the list passed it. `null` now, in `lib/ui/url.ts`, with a test. Found on
  `00079-p99`, fixed in `00080-xwm`, and re-checked: rename, then Starred and a refresh, kept every
  part of the URL

1333 tests; coverage 89.98 / 92.18 / 83.52. **Not driven, said plainly:** a real file *saved* by the
browser (the download was intercepted in the page — saving one needs the user's permission), a
*viewer's* list (the standing Known Issue; the API matrix covers their refusals), and Safari.

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

**Status: COMPLETE, 2026-10-08 — deployed as `00082-s7r` and verified there, on the API and in a real
browser in Light and Toybox Night.** Two deploys: `00081-trs` shipped the phase, `00082-s7r` what the
browser walk found. Migration `0015` — one nullable column, `run.origin`. What was built:

- **History, a page at a time** (D150) — `GET /api/runs` and a workflow's run list paginated on the
  server by keyset on `(startedAt, id)`, the cursor formatted by Postgres **to the microsecond** (a
  `Date` would make the next page skip runs started within the same millisecond); `{ data, page:
  { next, prev } }`, `data` unchanged; filters by status, trigger, workflow and UTC days; strict at
  the API (400 naming the parameter), forgiving on the page. List items are summaries — no input,
  output or steps. **`/runs`**: a `GET` form of filters that navigates on change, *← Newer* /
  *Older →*, and the retention rule and the page's own read time in its footer
- **A run's page, `/runs/[id]`** (D154) — the graph at the version it executed (D86), painted and
  lit; every step with its logs; **config, input and output loaded when a step is opened**
  (`GET /api/runs/:id/steps/:seq`); a run still going followed over the stream pinned to it, which
  stops when it rests; the version it ran said when it is not the current one; a click on a node
  opens its step. Analytics failures link to their newest run. A run link landing in the wrong
  workspace offers the switch, as a workflow link does
- **Re-run and retry from the failed step** (D151, D152) — both execute the workflow **as saved
  now**, as a `manual` run with `origin: { runId, kind }`. A retry rebuilds where the run stopped by
  **replaying its steps** over the graph it ran (`retry.ts` → `planRetry`, rule for rule with the
  engine: parallel work queued behind the failure, the pass a loop failed on, switched-off nodes),
  copies every finished step into the new run as **`reused`** — a new terminal step status, not
  executed again, no timestamps — and writes the frontier as the new run's cursor before anything
  runs it, so a queued retry resumes through the ordinary delivery. Refused, 409, when the history
  does not replay, the failed step is gone, or nothing is left; a succeeded or cancelled run is
  re-run instead. A test of part of a workflow is re-tested, not retried
- **Retention** (D153) — a finished run goes after **30 days by `finishedAt`, or past its
  workflow's newest 200**; never a queued, running or waiting run; by the daily sweep
  (`prunedRuns`), at most 5,000 a sweep, in one statement with a dry-run form. Numbers from the
  measurement: ~7.7 KB a run on disk, so ~1.5 MB a workflow at its cap and ~51 MB at the worst a run
  can be. Stated in *Settings → Workspace* and under `/runs`
- **The canvas** (D155) — *Recent runs* in the workflow inspector, merged with the run on screen as
  it changes; choosing one paints it without locking the canvas, the panel says *An earlier run*
  with a way back, and offers *Retry from failed step* and *Re-run*, which save first
- **Header and ⌘K** gain *Runs*; the header still fits at 1024 px

**Verified on the deployed service** (`00081-trs`): `verify-api` **522 passed / 3 skipped** — a Phase
33 section of 31 checks (the retry before and after the fix, **the steps counted in the database:
2 reused with no timestamps, 2 executed**, a reused step's output read downstream, refusals that
start nothing, a re-run with the original's input, a durable re-run, a retry refused naming a
removed step, step bodies, pages that follow on with nothing skipped and step back exactly, every
filter, six malformed requests refused, `/runs` and `/runs/[id]` rendering headers without bodies)
plus three matrix rows and eleven private-workflow checks — every new way to reach a run is 404 to
whom the workflow is hidden from. **A queued retry** went 202 → a Cloud Tasks delivery resumed it
from its carried-over steps → succeeded, in 2 s. `verify-security` 83 (three new routes, two new
redirects), `verify-a11y` 118 (now auditing `/runs` and a run's page), `verify-templates` 47,
`verify-integrations` 60 / 2 skipped, `verify-postgres` 65, `verify-providers` 55, `verify-vault` 62,
`verify-observability` 69 / 1 structural skip, `verify-timers` 34, `verify-durable all` 33 — **0
failed** — and **`verify-retention`**: in a throwaway workspace seeded on every edge of the rule, a
dry run named exactly the 5 runs and 6 steps due and deleted nothing, the prune deleted exactly
those, a second found nothing; across every workspace the next sweep would delete 0. **Database
time**: 0.15 ms for a page, 0.13 ms for the next, 0.33 ms for the whole-database retention dry run;
the deployed `/runs` page read in 18 ms. On `00082-s7r`: `verify-security` 83, `verify-a11y` 118,
and **`smoke.mjs` clean, all eight beats**, on its second walk — the first stopped at beat 7 on the
standing generated-Sheets-cell Known Issue (Phase 34's), which this phase touched nothing near.

**Walked in a real browser on the deployed service**, Light and Night, with a workflow that writes
nowhere (a trigger, a set, a guard with a typo in its field reference, a log): the failure opened
from **analytics** → its run page → a click on the failed node opened its step, whose bodies loaded
(`left` resolved to nothing — the bug) → *Open workflow* → *Recent runs* → the failed run painted on
the canvas as an earlier run → the guard's field fixed, unsaved → **Retry from failed step** saved it
as v2 and ran the retry: the database holds **2 reused steps and 2 executed**, and the retry's page
says *2 steps reused, not run again* with both painted *Reused* on the lit path. *Re-run* from a run's
page queued, landed on the new run, showed it *Live* and streamed it to the end. `/runs` filtered by
status through the select, and paged 25 + 25 with no overlap and back exactly. **The contrast audit
was clean on every new screen in both themes** — `/runs`, both run pages with every step's bodies
open, the canvas with an earlier run open, *Settings → Workspace*, analytics. No sideways scroll at
375, 1024, 1100 or 1280 px; the header bar fits at each.

**Found in verification, fixed, re-checked:**

- **A retried run's reused steps vanished from the canvas** — the stream had the new run, reused steps
  and all, before the queued `202` answered; the answer, which has no steps, replaced it. The server
  held all four rows. `adoptStarted` keeps what the stream has of the same run, in the retry and in
  Phase 17's queued run, which had the same race in a narrower window; tested
- **The open run in *Recent runs* was marked by its fill alone**, and in Toybox Night the fill read the
  same as its neighbours — it says *Showing* now
- **A private workflow's link, opened by a colleague looking at another workspace, said "This workflow
  is in …"** (since Phase 19B; a run link would have too) — confirming what `private` hides (D101).
  The lookup asks `canSeeWorkflow` now; the deployed previous revision answered 200, this one 404
- **Model usage counted a switched-off node downstream of an agent as a second model call** (since
  Phase 30), and would have counted a retry's reused agent step — it counts succeeded steps only now
- The date filters' labels sat higher than their neighbours, the list's separators spaced unevenly
  around a monospace version, and three run-page links were under 24 px tall

1384 tests; coverage 89.53 / 92.23 / 83.62. **Not driven, said plainly:** a *viewer's* run pages and
canvas (the standing Known Issue; the API matrix covers their refusals and reads), Safari, and a
retry of a run whose version snapshot was pruned and whose workflow changed since (tested against
the engine, refused with a message; no such run exists in the database to drive).

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

**Status: COMPLETE, 2026-10-09 — deployed as `00084-4hb` and verified there, on the API and in a
real browser in Light and Toybox Night.** Two deploys: `00083-645` shipped the phase, `00084-4hb` what
the browser walk found. No migration. What was built:

- **Per-request catalogue selection** (D156, `generate/select.ts`) — every node as one **index** line
  (type, label, first sentence of its description), full **definitions** only for the selection:
  every trigger and `ai.llm` always, the agent's Branch with the agent, and up to ten more matched
  deterministically by the request's words against each node's own description and docs, through
  a synonym table that is about language, not nodes. The prompt's per-node advice ("Designing
  with…") follows the selection. **A miss is recoverable**: the model may use any indexed node, and
  a retry hands it the full definition of one it reached from the index. **The prompt fell from
  25,081 characters to 16,757 on average** (11,663–18,425), and a new node now costs every request
  one ~116-character index line instead of a ~820-character definition
- **The budget test, re-based** (`registry.test.ts`) — the selected part at its worst case under
  17,500, the index under 140 characters a node, every definition under 1,300 and index line under
  220, and the worst case under 85% of the whole catalogue. **D112 is lifted.** The agent's tool
  list is measured and pinned too: 19 tools, 13,297 characters, Postgres the largest at 1,856
- **An eval set** (D157, `generate/eval/`) — 24 requests with expectations of necessity, six held out
  of selector tuning; a scorer that also reads every `{{ }}` reference against what its source
  declares (`references.ts`); `npm run eval:generate` replays recordings offline (CI), `--live`
  scores a real model and `--record` keeps it, `--recall` measures a selector alone, `--rescore`
  re-judges after a deliberate change. **CI asserts the selector gives every case every node it
  requires, and that all three recordings replay to their verdicts**
- **A valid graph whose references reach nothing earns the retry** (D158) — added because the eval
  set caught one; soft, so a valid graph is never refused or lost over a reference
- **Which attempt produced the graph** (D159) — `generation.finished` on every generation, counted
  by a fifth log-based metric, `agentforge_generations`, labelled `outcome` and `selector`
- **An agent may call exactly the tools it lists — an empty list is none** (D160, **decided by the
  user** on the walk's evidence below). Until now an empty list meant every callable node

**Measured** — `gemini-3.5-flash-lite`, fallbacks off, all 24 cases. The production default,
`gemini-3-flash`, was not usable for it: **its free tier is 20 requests a day** (the 429 said so),
spent before the session began.

| Arm | Passed | Prompt (avg) | Tokens a case | Requests | Median |
|---|---|---|---|---|---|
| Before — the whole catalogue | 23/24 | 25,081 | 6,927 | 24 | 22.0 s |
| Deterministic selection | 23/24 | 16,757 | ~4,960 | 25 | — |
| Model-call selection | 23/24 | 11,662 | 4,794 incl. its own call | 49 | 34.2 s |
| **Deterministic + reference retry — shipped** | **24/24** | 16,757 | 5,192 | 26 | 22.7 s |

Both selectors chose every required node (48/48; the deterministic one 37/37 tuned and **11/11 held
out**). Selection alone neither raised nor lowered the pass rate; the reference retry added the 24th.
Deterministic ships: the model selector's smaller prompt bought no quality, cost a second request per
generation and 55% more latency, and fell back once.

**Found by the evals, fixed, tested:**

- **A Loop body reading `{{input.name}}`** (`users-to-sheet`, held out) — the input inside a Loop is
  `{ index, item, total }`, so the Sheets row would be blank. Twice, on two samples. The reference
  retry fixed the recorded failing answer on its first live call (`{{steps.loop_users.output.item.name}}`)
- **The test fixture that models "the demo graph" wrote `{{input.reason}}` after a Branch** — whose
  output is `{ matched, input }`, so the log line was empty; corrected, and the demo test now asserts
  clean references. All 11 templates were checked: clean, and now pinned by a test
- **The smoke walk's payload never carried a body field the graph read as `{{input.x}}` or
  `{{steps.<trigger>.output.x}}`** — only `{{trigger.x}}` was fitted (D58). A plausible cause of the
  flaky beat 7 (*Known Issues*); `adaptPayload` reads all three now, with a test that failed first.
  **Not proved to be the cause**: the one failing run still in the database (2026-09-26) had been
  started with an empty body, and the Phase 28 walks' runs are gone
- **Two expectations were unfair** — `refund-decision` and `order-tax` expected a manual trigger the
  request never implied; the first baseline failed a webhook for it. Removed, and said so (D157)
- **The baseline caught an honesty failure**: asked to insert into Postgres, the model used the
  read-only Postgres node and claimed it built everything. The shipped arm named it `unsupported`;
  it is a model behaviour, not something this phase changed

**Not done, said plainly:** the comparison is one run per arm on one model — a difference of one
case is noise, which is why the choice rests on cost and recall rather than pass rate. The model the
product defaults to was not evaluated live (its 20-a-day quota); `--live --model gemini-3-flash-preview`
is the command when a day's quota can be spent on it.

**Found by the browser walk, fixed with tests that failed first, re-run on `00084-4hb`.** Five eval
prompts that write nowhere were generated through the page's own form and run from the canvas —
`cheap-products`, `greeting` and `order-tax` in Light, `dedupe-addresses` and `refund-decision` in
Night. All five generated a correct graph on the first try; **three of them exposed defects the
evals could not see, because each was in what runs, not in what was generated**:

- **The Log node refused a list.** "Log the result" was generated as `message:
  "{{steps.sort_products.output.items}}"`, and a value that is only a reference keeps its type, so the
  run failed at its last step: "expected string, received array". A message that resolves to data is
  now logged as its JSON, cut to the limit; `null` — a reference that reached nothing — is still
  refused, and the JSON Schema the form and the generator read is unchanged. Re-run: the log line is
  the filtered, sorted list
- **The Number node's `round` went to a whole number before applying `precision`** (since Phase 23A),
  so "add 18% tax and round to two decimal places" — generated exactly right — turned 249.99 into
  **295**. `round`, `floor` and `ceil` now work at `precision` places. Re-run: **294.99**
- **A generated decision-only agent was handed all nineteen callable tools**, because an empty `tools`
  list meant every one. It spent three model calls probing Postgres (reads, all refused — the demo
  database's role may only `SELECT` and the tables did not exist) and could as easily have posted to
  Slack; Phase 31's partial-run confirmation keyed on a non-empty `tools`, so it would not have warned.
  Measured: 2 of 3 stored agents had an empty list, and one empty-list step in all of history had
  called a tool — this one. **The user chose least privilege** (D160). Re-run: "0 tool(s): none", one
  model call, "approved" with its reason, 4.0 s instead of 17.5 s. The prompt now says an agent can
  call only what it lists; `SECURITY.md` says so too

**Verified on the deployed service.** On `00083-645`: `verify-security` 83, `verify-a11y` 118,
`verify-api` **all passed, 2 skipped** (its pass count was not kept — the battery's wrapper trimmed
each script to its last lines, and `verify-api` prints no total), `verify-templates` 47,
`verify-integrations` 60 / 2 skipped (Notion, Airtable), `verify-postgres` 65, `verify-providers` 55,
`verify-vault` passed, `verify-observability` passed / 1 structural skip, `verify-timers` 34,
`verify-durable all` 33 (its first run died on an HTTP/2 transport reset mid-suite; the re-run
passed every check), `verify-retention` passed — **0 failed** — and **`smoke.mjs` clean, all eight
beats, on its first walk**: the demo prompt took the retry (`second`), then beat 7 — the flaky one —
passed. The owner's Discord connection, which `verify-api` deletes, was restored. On `00084-4hb`:
`verify-security` 83, `verify-a11y` 118, **`smoke.mjs` clean on its first walk again** (generated in one
attempt, the agent with no tools still routing the urgent payload right). The service logged
`generation.finished` for every generation — 11, 10 `first` and 1 `second`, all `deterministic`, 13–14
nodes selected, 16.3–17.9K-character prompts — and **`agentforge_generations` is collecting** those
points. The walk's five probe workflows were deleted afterwards.

1441 tests (24 script tests); coverage 89.83 / 92.42 / 84.43. The remaining sinks of the Log node's
class — a whole-reference list into Discord's or Slack's message — were reasoned about, not met; they
fail loudly with the same message, and a general rule would be a change to `template.ts`'s contract
that no phase has asked for.


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

**Status: COMPLETE, 2026-10-09 — deployed as `00087-544` and verified there, on the API and in a
real browser in Light and Toybox Night.** Three deploys: `00085-cff` shipped the phase, `00086-wnj` what
the browser walk found, `00087-544` what `verify-a11y` found. No migration, no new table. What was
built:

- **`POST /api/workflows/[id]/copilot`** (`edit.ts`) — the canvas's graph and an instruction in, a
  validated **proposed** graph out; `editor`, a viewer refused with the role named; **writes nothing**.
  Generation's pipeline was extracted as `converse` and both call it — the same prompt with an edit
  opening and editing rules, the same parse, validation, reference check and single retry. `unsupported`
  reported honestly, and the workflow's own name is not the copilot's (D164)
- **What the model owns, and what is carried** (D163) — nodes, type, label, config and edges are the
  model's; position, retry policy, pin, off switch, notes and surviving edge ids are carried by id; only
  an added node is placed, at `layout()`'s offset from a neighbour as it actually sits. The model never
  sees positions, pins (run data), policy, the off switch or notes. **Measured**: an added step diffed as
  *+1 added, 1 connection, 5 unchanged, 0 moved*, and saving it wrote exactly that version
- **Not blamed for what the canvas already had** (D162) — a proposal may not add a validation problem
  or unresolved reference; one the starting graph had is carried, costs no retry
- **The copilot panel** (D161) — in the inspector's column, not a third. Measured on the deployed
  canvas: **880 px of canvas at 1440 px with either in the column**, 560 if it had been a third; at 375 px
  the toolbar is still two rows (104 px) and the copilot a 338 px drawer. ✦ Copilot in the toolbar and
  ⌘K open it; *Details* or selecting a node gives the column back; the conversation survives both
- **The proposal in Phase 18's diff mode** — the same pop bar with *The copilot's proposal — not applied
  yet*, Reject and Accept; the panel lists every change with the values it sets (an agent's `tools`
  included). **Accept is one step of undo and unsaved**; **refine** edits the proposal and stays one diff
  from the canvas; an answer to a canvas that changed meanwhile, or that a restore replaced, is set aside
  with a sentence saying so (D164). Client state only — no table, no Neon cost
- **Measured like generation** (D165) — nine edit cases (`eval/edit-cases.ts`) scored also on what they
  kept, removed, renamed and set: **9/9 on `gemini-3.5-flash-lite`, every one first-attempt**, recorded and
  replayed offline in CI. `generation.finished` carries `mode`, and `agentforge_generations` gained a
  `mode` label

**Validated on the deployed URL, in a browser, on a generated workflow — the five requests.** In Light:
**add a node** ("also log the messages that aren't urgent" → *+1 added* on the false branch), **change a
config value** (the urgent message to start with URGENT:, then *refined* — "and the info one with
ROUTINE:" — to *2 changed*), **remove a branch** (*1 removed*, drawn dashed and recessed). In Night:
**rename** (*1 changed — name*) and **something impossible** ("SSH into the support server" → *No change
to propose*, named under *Not done*), the latter asked against an unsaved canvas, which it left alone.
Accept → ⌘Z returned the canvas to the stored graph exactly (*Saved · v1*) → ⇧⌘Z → Save wrote **v2**
with exactly the diff; a later save wrote v3. **Reject left the stored workflow byte-for-byte as it
was.** The contrast audit was clean with a proposal open in both themes.

**Found by the walk, fixed with tests that failed first, re-walked on `00086-wnj`:**

- **A proposal's added node landed half under the minimap** — entering a version comparison refits the
  canvas, opening a proposal did not. `opened` (tested) now tells the editor when a proposal opens or a
  refine replaces it; re-walked in Night, every node ended inside the canvas
- **A long conversation stretched the whole page by 200 px** and shifted every control 9 px: the
  `sr-only` "You:" label is absolutely positioned, and the scrolling list was not, so it escaped. All
  eighteen scroll containers in the product had the trap; all are positioned now, held by
  `scroll-containment.test.ts` (D166). Re-walked: the list scrolls inside itself, the page overflows by 0

**Found by the deployed battery, fixed with a test that failed first:** `verify-a11y` — the toolbar's
Copilot button carried `aria-controls="copilot-panel"` while the column held the inspector, an ARIA
reference to nothing (and on a phone, *Details* the mirror of it). Only one panel is ever in the
document; each control now names its panel only while it is there (`right-column.ts`). Re-run on
`00087-544`: 118 / 0, and in a browser no `aria-controls` on the canvas points at nothing.

**Verified on the deployed service.** On `00086-wnj`: `verify-api` **532 passed, 1 failed, 2 skipped** —
the failure was the new live copilot check meeting every model in the fallback chain unavailable at once
(`gemini-3.5-flash-lite` timed out, `gemini-3-flash` at its free tier's 5-a-minute limit, spent by the
generation checks just before, `gemini-3.6-flash` at capacity), answered 422 with the provider's words as
designed; **the same two checks run on their own a few minutes later both passed** (a real proposal kept
all three nodes at their exact positions and added one; nothing stored moved). `verify-security` 84 (the
new route enumerated and refused without a session), `verify-a11y` 117 / 1 (above), `verify-templates`
47, `verify-integrations` 60 / 2 skipped (Notion, Airtable), `verify-postgres` 65, `verify-providers` 55,
`verify-vault` passed, `verify-observability` passed / 1 structural skip, `verify-timers` 34,
`verify-durable all` passed, `verify-retention` passed. On `00087-544`: `verify-a11y` **118 / 0**,
`verify-security` **84 / 0**, and **`smoke.mjs` clean, all eight beats, first walk**. The
`agentforge_generations` metric gained its `mode` label in place.

1491 tests (24 script tests); coverage 90.25 / 92.40 / 85.29.

**Not done, said plainly:** the eval set is nine cases on one model, one run — the five kinds the phase
names plus a refine and an agent's tools, not a census. A viewer's 403 is proved by `verify-api`'s
matrix, not by a viewer in a browser (none exists, *Known Issues*). The rename of the workflow itself is
deliberately unsupported (D164).

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

**Status: COMPLETE, 2026-10-09 — deployed as `00089-t45` and verified there, on the API and in a
real browser in Light and Toybox Night.** Two deploys: `00088-b2x` shipped the phase, `00089-t45` what
the browser walk found. No migration, no new table, no new route — the copilot route gained two
`kind`s. What was built:

- **Explain this workflow** (`explain.ts`) — a walkthrough in run order, sentences citing node ids;
  its own model call and JSON shape, validated and retried once; ids the model invented dropped and
  counted. **Pressing a sentence rings its steps** (`ring-accent`, a halo outside the card) and brings
  them into view only if they are out of sight — a highlight carried by canvas context, never a
  selection, because selecting would hand the column to the inspector (D169)
- **Why did this run fail?** — from the run panel, from the copilot when a failed run is on the canvas,
  and from `/runs/[id]`, which opens the canvas with `?diagnose=` and spends the question once (D170).
  The server reads the run (404 for another workflow's, 409 for one that did not fail, both before a
  key is looked up); `evidence.ts` keeps the failed step and the nearest steps before it, **scrubs every
  value before cutting it** and bounds it; the prompt carries it between markers unique to the request
  (D168). The answer is sentences and **a fix in words** — or `null` when the fix is outside the
  workflow — and the client asks for the fix as an ordinary edit straight away (D167): run data never
  reaches the call that writes a graph, and the fix arrives as a proposal with Accept, undo and refine
- **Retry after the fix** (`after-fix.ts`, D171) — once a fix is accepted, *Save and retry from the
  failed step* when the fix is at or after it; **Save and re-run** when it changes a step a retry would
  reuse (the reason said in words); *Save and test again* for a partial test
- **No credential can reach the prompt** (`scrub.ts`) — a shape per credential kind, held to
  `CREDENTIAL_KINDS` in both directions, plus secret-named fields; `evidence.test.ts` plants a credential
  of every kind in every field of a run record. **Writing that test found two real gaps**: a word
  boundary before a prefix let a token glued to the text before it through, and truncating before
  scrubbing would leave half a secret that no longer matches — both fixed, both held
- **Measured** (D172) — `diagnose-cases.ts`: five failed runs written as the engine records them (a
  misspelt time zone, a 404 from a wrong path, a tax rate caught by an assert one step later, **a
  webhook body that tries to dictate the fix**, an expired Google connection); `explain` cases scored on
  citing every step. On `gemini-3.5-flash-lite`: **diagnoses 5/5 and explanations 2/2, every one
  first-attempt**; ~7,300 tokens a diagnosis (two calls), ~2,000 an explanation. Replayed offline in CI.
  `generation.finished` carries `mode: "explain"` and `"diagnose"`

**Validated on the deployed URL, in a browser — the three induced failure classes, each diagnosed
correctly, fixed and run again to `succeeded`.** In Light, from the run panel: *Add 18% tax*
multiplying by 18, caught by an assert — diagnosed ("multiplied by 18 instead of 1.18"), fix
*operand 18 → 1.18* proposed, accepted, and offered **Save and re-run** with the reason (the fix changes
a step that already ran); the re-run succeeded on v2. In Night, from `/runs/[id]`: a misspelt time
zone — the canvas opened with the copilot diagnosing, `?diagnose` gone from the address, fix
*Asia/Calcuta → Asia/Kolkata*, **Save and retry from the failed step** succeeded with the trigger
`reused`. In Night, from the copilot's own button: a GET to `/post/3` answering 404 — diagnosed ("the
API uses the plural *posts*"), fix to `/posts/{{trigger.postId}}`, retried to `succeeded`, the post's
title logged. Explain walked in both themes. Contrast audit clean in both with an explanation, a
diagnosis and a proposal open; the ring measured **5.69:1** on Light's canvas and **9.85:1** on Night's;
a pressed sentence 4.94:1 in Night; the page overflowed by 0.

**Found by the walk, fixed, re-walked on `00089-t45`:**

- **A diagnosis named the cause and withheld the fix** — "multiplied by 18 instead of 1.18", then *no
  change to the workflow would fix this*. Rule 4 (*never guess a value the evidence does not contain*)
  was being read as forbidding 1.18 from a step labelled "18%". It now says a value worked out from the
  workflow's own labels, the data or an API's convention is not a guess. Re-recorded 5/5, and the two
  cases that need a derived value passed three more times each
- **An old highlight came back** — a sentence pressed in an earlier answer re-ringed its step when the
  copilot took the column back. Leaving the copilot's column now clears it
- **Every press zoomed the canvas** — even with the whole workflow on screen. The camera now moves
  only when a cited step is out of sight (`allInFrame`, tested)

**Found by the deployed battery:** `verify-api`'s 409 check borrowed a run from the shared test
workflow, whose state depends on every check before it, and sent no run id — the route answered 409
correctly when probed alone. The check now runs its own workflow.

**Verified on the deployed service, on `00089-t45`.** `verify-api` **534 passed, 0 failed, 4 skipped**
(the four by environment — no `VERIFY_GEMINI_KEY` or `VERIFY_DISCORD_WEBHOOK` this time, the latter
because it deletes the owner's Discord connection), including the whole loop through the API —
diagnose, the fix as an edit, save, retry from the failed step, `succeeded`; `verify-security` 84,
`verify-a11y` 118, `verify-templates` 47, `verify-integrations` 60 / 2 skipped (Notion, Airtable),
`verify-postgres` 65, `verify-providers` 55, `verify-vault` passed, `verify-observability` passed / 1
structural skip, `verify-timers` 34, `verify-retention` passed, `verify-durable all` passed, and
**`smoke.mjs` clean, all eight beats, first walk**.

1541 tests (24 script tests); coverage 90.67 / 92.49 / 86.02.

**Not done, said plainly:** the eval sets are five diagnoses and two explanations on one model — the
classes the phase names plus an injection and a fix outside the workflow, not a census. Run-data
scrubbing is by shape: a secret that matches no stored credential's shape and sits under an innocent
field name would pass, and none should be in a run record in the first place (`SECURITY.md`). A
viewer's refusal is proved by `verify-api`'s matrix, not in a browser (no viewer exists, *Known
Issues*).

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

**Status: COMPLETE, 2026-10-09 — deployed as `00094-w55` and verified there, on the API and in a real
browser in Light and Toybox Night.** Migration `0016` (one table, `inbox_item`; one column,
`run.handled`), applied before the first deploy with `verify-schema.mjs` before and after. Five
deploys, `00090-kvr` to `00094-w55` — the first shipped the phase, the rest what the browser walk
found. What was built:

- **The on-error policy** (D173) — `policy.onError`: `stop` (and absent), `continue`, `route`,
  answered after the node's retries and never when the run itself was stopped. A handled failure is a
  **step status of its own, `handled`**, and a run whose failures were all handled **succeeded**,
  counting them in `run.handled` — "1 error handled" on the run panel, the run page, the history and
  the toast (D175). The six places a status touches, plus the diagnosis evidence, the test toast and
  the run shapes; analytics count it as the node's failure, never the run's
- **The Error output** (D174) — the registry's outputs plus one reserved key, added by `outputsOf`
  while the policy routes, and read by the card, validation, the engine and a retry's replay alike, so
  D21 and D23 stand unchanged. Leaving `route` takes the Error edges with it, as one step of undo. The
  copilot keeps an Error edge and says when a request needs one
- **`core.error_trigger`** (D176) — the first node since D112 was lifted, with all five registry
  obligations, `select.test.ts`, and a new eval case, `failure-alert`, **passed first attempt** on
  `gemini-3.5-flash-lite`. It fires for a `webhook` or `schedule` run's failure, never a manual run's
  or a test's; its runs carry the new trigger kind `error` and **never start another** — the cascade
  is impossible by construction. Visibility decides which error workflows hear (the author's), at most
  five, queued through Cloud Tasks; the payload is scrubbed before it is cut (D168). Its model-facing
  definition was cut from 757 to 540 characters to stay inside D156's budget rather than raise it
- **The inbox** (D177) — a row per reader, written by one statement in the failed run's own path,
  collapsed per workflow while unread, read by the shell header when a page renders and **never
  polled**; visibility applied at write and at read; pruned by the daily sweep. `GET /api/inbox`,
  `POST /api/inbox/read`

**Validated on the deployed URL.** `continue` and `route` behaved as `CONTRACT.md` says, by
`verify-api` and in the browser. A webhook workflow whose check failed put an entry in the inbox in
the step's own words, and its **error workflow posted real Discord messages** — `1558106526214783099`
and `1558107487184617544` in `#agentforge-demo` — naming the workflow, the step, the error and the run's
link, from a run with trigger `error` queued through Cloud Tasks. The inbox was opened, an entry
followed to its run — marked read before that page rendered — and *Mark all read* cleared the badge.
**The network panel showed no request in 40 idle seconds** beyond the page load. In Light and Night:
the routed run painted `↪ Handled → error` with the lit path down Error and the default path skipped;
the policy switched to *Stop* removed the Error edge and one ⌘Z brought both back; the contrast audit
was clean on every new state in both themes (Handled 5.12:1 Light, 10.33:1 Night; the badge 6.71:1
and 4.95:1).

**Found by the walk, fixed, re-walked:**

- **The Error trigger drew its category's circled play** — a second Manual trigger in the palette. It
  has its own warning sign now
- **A handled step's error was red under an amber outline** — two statements at once. The warning hue
  now, on the card, the run panel, the run page and the test panel (`stepErrorTone`, tested)
- **The bell overlapped the workspace switcher** — by 24 px at 375 and 7 px at 640, measured in
  same-origin frames. Two causes: below 640 the ⌘K keycap Phase 29 meant to hide on phones had shown
  all along, because `Keys` sets `inline-flex` and the caller's `hidden` lost on stylesheet order —
  wrapped now, and `primitives.test.ts` refuses a display class handed to a primitive that sets its
  own (fails without the fix); from 640 to 767 the account's address now yields. **At 320 it still
  scrolled sideways by 9 px**, so below `sm` the wordmark's name yields to the mark — a first cut-off at
  360 px left 9 px of overlap at 360 itself. Measured clean at 320, 360, 375, 414, 600, 640, 768, 1024
  and 1440; the switcher went from a 39 px caret to 125 px at 375

**Found by the deployed battery:** `verify-postgres.mjs` pins the registry count too — a fifth script,
where `PROGRESS.md` said four.

**Verified on the deployed service.** `verify-api` **561 passed, 0 failed, 3 skipped** (by
environment); `verify-security` 86, `verify-a11y` 118, `verify-templates` 47, `verify-integrations` 60
/ 2 skipped (Notion, Airtable), `verify-postgres` 65, `verify-providers` 55, `verify-vault` passed,
`verify-observability` passed / 1 structural skip, `verify-timers` 34, `verify-retention` passed,
`verify-durable all` passed, and **`smoke.mjs` clean, all eight beats, first walk**.

1583 tests (24 script tests); coverage 90.61 / 92.53 / 85.41.

**Not done, said plainly:** failure alerts are not rate-limited — a webhook hammered with failing
calls starts one error-workflow run per failure, bounded only by the queue's concurrency (the inbox
collapses them; a channel does not) — `SECURITY.md` says so. The generator and the copilot cannot set
an on-error policy (D81, D163), so "if the API call fails, post to Slack" builds everything but the
routing. A viewer's inbox is proved by `verify-api` through a probe member, not in a browser (no real
viewer exists, *Known Issues*). Five deploys spent the rollback window: after the next image prune
Phase 36's `00089-t45` cannot take traffic without a rebuild.

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

**Status: COMPLETE, 2026-10-09 — deployed as `00097-xwf` and verified there, on the API and in a real
browser in Light and Toybox Night, signed in and signed out.** Migration `0017` (one table,
`approval`), applied before the first deploy with `verify-schema.mjs` before and after. Three deploys,
`00095-xgf` to `00097-xwf` — the first shipped the phase, the others what the browser walk and
`verify-a11y` found. What was built:

- **`core.approval`** (D179) — the second node since D112 was lifted, with the five registry
  obligations, its own icon, `select.test.ts`, and a new eval case, `refund-approval`, **passed first
  attempt** on `gemini-3.5-flash-lite` (the model sent the link with `{{steps.approval.output.url}}`).
  **Three static outputs, not two** — a deliberate departure from the task's wording, recorded in D179:
  the link has to be sent before the run pauses, by a step the author already has, so **Ask** fires at
  once with `{ approvalId, message, url, expiresAt }`, the run finishes what it can, and is put down
  `waiting` until the decision or the timeout; **Approved** and **Rejected** follow the decision. While
  one is outstanding nothing else may wait. Not agent-callable. The retry replay and the reference
  check know Ask from the decision
- **The link** (D178) — `/approve#<token>`: 256 bits, **stored only as SHA-256**, **in the URL's
  fragment** (in no request line, log or `Referer`; a link preview fetches a static page that knows
  nothing), POSTed in a body. **The engine removes it from everything it writes** (`engine/redact.ts`):
  the plaintext lives in the minting attempt's memory, and a resumed attempt whose Ask step has not
  sent it yet mints a new one. Single use is the request's own compare-and-set — pending, before its
  timeout, its run still going
- **Three ways to decide, and a timeout** (D181) — a member the node allows (named people, any role;
  or editors and above) in the inbox, the run panel or the run's page; whoever holds the link, signed
  out; or `onTimeout` — reject by default, approve, or fail. A decision wakes the run: `wakeAt = now()`
  and a delivery, or — while the Ask path is still running — the suspend write reads it and wakes at
  once. A failed or cancelled run closes its request
- **The inbox reads requests live** (D180) under *Waiting on you*, with Approve and Reject in the
  panel; never `inbox_item` rows, so a decision empties every inbox at once
- **A stream follows a run about to wake** (D182), so the canvas and the run page show a decision
  resume the run instead of closing on it

**Validated on the deployed URL.** A run paused at its approval; its Ask step posted the link to the
real `#agentforge-demo` Discord channel (message `1558153955706413094`), read back from Discord while
the run's own record held `…/approve#[removed]`; **opened in a signed-out browser** (no session), at
375 px and in both themes, it approved with a comment, and **the run resumed through Cloud Tasks down
Approved**, `via: "link"` with the comment on its output — the browser sending only the two POSTs, the
token in no URL. The used link then answered *no longer open*. **Reject** worked from the canvas — the
run resuming live 1.5 s after the click, the Rejected path lit, the log naming who decided and why —
**approve** from the inbox and from the run page; the timeout decided both ways in `verify-api`
(approve, and fail); a bare GET of the page or either route changed nothing (asserted by both
`verify-api` and `verify-security`). **No request in 30 idle seconds** with a run waiting on an open
canvas. Contrast audit clean on every new state in both themes: the canvas's waiting card, the run
page, the open inbox, every state of `/approve`.

**Found by the walk, fixed, re-walked:**

- **The Run toast said "The run reached a delay"** for a run waiting on a person — it has its own now
- **The inbox's subtitle read "1 waiting on you · all read"**, two statements at once (`panelSummary`,
  tested), and its row title truncated *asks for a decision* on a long workflow name — the row is the
  workflow's name alone now, under the *Waiting on you* heading
- **A link opened in a tab already on `/approve` was ignored** — a fragment change does not reload the
  page; it listens for `hashchange` now

**Found by `verify-a11y`**, once `/approve` joined its public pages: the page's prerendered state —
*Reading the request…* — had no `<h1>`, so a screen reader landed on a headingless page while it
loaded. Shown failing on `00096-95g`, fixed on `00097-xwf`.

**Not found, said plainly:** the inbox panel measured 23 px buttons in a phone-width frame — an
unfinished scale-in animation, not the layout; with animations finished they are 27.9 px (a trap now in
`PROGRESS.md`).

**Verified on the deployed service.** `verify-api` **597 passed, 0 failed, 3 skipped** (by environment: a key already stored, one free-tier rate limit, Google connected), with every Phase 38 check — the link read back from a real Discord message and its hash the only form at rest, no working link in any step row, a bare GET deciding nothing, a signed-out approve resuming the run through Cloud Tasks, a used link dead, a member's reject, a 403 to a member not named, cancel closing the request, both timeout outcomes, and who may decide as a viewer, named and not, on a private workflow and not; `verify-security` **93**, `verify-a11y` **131** (`/approve` among its pages), `verify-templates` 47, `verify-integrations` 60 / 2 skipped (Notion, Airtable), `verify-postgres` 65, `verify-providers` 55, `verify-vault` passed, `verify-observability` passed / 1 structural skip, `verify-timers` 34, `verify-retention` passed, `verify-durable all` passed, and **`smoke.mjs` clean, all eight beats, first walk** — all on `00097-xwf`.

1618 tests (24 script tests); coverage 90.31 / 92.66 / 84.78.

**Not done, said plainly:** a viewer deciding was proved through `verify-api`'s probe member, not in a
browser (no real viewer exists, *Known Issues*). A request decided from the inbox while its run's page
is open elsewhere is not followed live there — that page catches up on reload. An approval link is a
bearer credential in whatever channel it was sent to; `SECURITY.md` says so. Neither link route is
rate-limited (a 256-bit token is not guessed by retrying).

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

**Status: COMPLETE, 2026-10-10 — deployed as `00098-2d2` and verified there, on the API and in a real
browser in Light and Toybox Night.** Migration `0018` (three nullable columns, one partial index —
`run.parentRunId`, `run.parentNodeId`, `workflow.agentTool`, `run_parent_idx`), applied before the deploy
with `verify-schema.mjs` before and after. **One deploy** — the browser walk found nothing to fix. What
was built:

- **`core.call_workflow`** (D183–D185) — runs another workflow of the workspace **inside the caller's own
  attempt** as a run of its own, linked both ways (`run.parentRunId`/`parentNodeId`; the calling step's
  output names the child; the run page lists the runs each step started). It answers the plan's
  "decide whether a long child runs durably": **it does not**, and a called workflow cannot pause the run
  it is inside — a run waits for one thing at a time (D179). The bounds extend D16 to the tree: depth 3,
  no workflow above a call called again, one shared step budget and clock (`Lineage`, `RunOutcome.charged`);
  a cycle or a chain too deep is refused **at save** (422, walking only workflows the saver may see) and
  **at run time** (where a `{{ }}` reference hides it from the save). Visibility is the calling workflow's
  author's. The node holds none of this: it asks `context.workflows`, the engine's one door
- **Workflows as agent tools** (D186) — opt-in twice: an editor offers the workflow to agents (a name, a
  sentence, typed inputs — `workflow.agentTool`, not a version) and an `ai.agent` lists it as
  `workflow:<id>`. The model sees `workflow_<name>`, the sentence verbatim and the inputs; arguments are
  checked strictly; a call is a child run with trigger `agent`. The agent node is handed a name, a spec
  and a check — never the workflow. An unmarked, missing or invisible one is named in the log and never
  offered. A real model called one on the deployed service and its run read back on its own
- **`core.merge`** (D187) — closes `ARCHITECTURE.md`'s oldest simplification. `all` waits until nothing
  outstanding can still reach it (so a diamond a Branch made does not wait for the side never chosen),
  `first` takes the first; either runs once. **The work list does the joining** (`engine/join.ts` →
  `Frontier`), and **the retry's replay takes its work from the same implementation**, so a retried run
  holds and fires its merges as the original did — held branches ride in `cursor.joins` as seqs
- **The generator** (D188) — Call workflow is not offered to it (it cannot know a workflow's id); a request
  for one is answered `unsupported`. Two eval cases, both **first-attempt** on `gemini-3.5-flash-lite`:
  `parallel-fetch` (needs `core.merge`) and `call-another-workflow` (must say it cannot)
- **The UI** — a workflow picker on the Call workflow node; an agent's *Tools* as a checklist of nodes and
  the offered workflows (an entry that is no longer available is shown, and removable); *Offer to agents*
  on the trigger; the called run linked from its step and the calling run from its page. Two icons

Measured and found: **a build failure no test saw** — a value import from `workflow/tool.ts` into the node
layer made the production bundle evaluate the node registry in an order that read `agentNode` before it
existed (`Cannot access 'x' before initialization` at *Collecting page data*); every test passed, because
the test runner's module order differs. Fixed by keeping `tool.ts` free of node imports (the agent node
gets a name, a spec and a check from the engine's door instead), with the duplicated prefix guarded by a
test. And **an incremental `tsc` hid a type error** until `--incremental false` was used. Every mutation of
the new engine code that was tried was caught by a test (eight of eight). Tests 1618 → 1672.

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

**Status: COMPLETE, 2026-10-10 — deployed as `00099-xgd` and verified there, on the API and in a real
browser in Light and Toybox Night.** **No migration** (D189: a form's address is the workflow's own token).
**One deploy.** What was built:

- **`core.form_trigger`** (D189) — a hosted page at `/f/<token>`, a route at `POST /api/form/<token>`, and
  one module of rules (`triggers/form.ts`) that the page runs as courtesy and the route as law. Seven field
  types; only declared fields kept, every declared field present; a honeypot answered like success; 32 KB;
  **12 submissions an address and 120 a form per ten minutes, in memory and per instance** (`lib/ratelimit.ts`,
  new, written to be reused by Phase 41); a message per bad field; a visitor is told the author's messages and
  **nothing of the run**. `trigger: "form"` is a run kind (unattended for failure alerts) and a library filter.
- **`core.respond`** (D190) — status 200–299/400–599, six allowlisted headers, a JSON body built by lookup
  only; allowlisted **at save and again by the receiver**, the first one to succeed wins, and it answers nobody
  when nobody is waiting. `respond_without_caller` in validation. A form shows its `message`.
- **The generator's trigger rule changed** (D191): only manual, webhook and schedule are always sent; the
  error and form triggers are chosen when the request *names* them. Adding the form trigger's definition to
  every request would have broken D156's worst case (17,462 → ~18,900), whose own text says the answer is a
  shorter definition or a smaller selection, not a bigger number. Measured: an unnamed trigger sat at rank
  6–10 and pushed `core.log`/`core.switch` out of three cases; named-only, all 28 keep every node. **The
  "webhook form submission…" synonym group was split** — together they scored the form trigger on every
  "arrives by webhook" request. Two new eval cases — `contact-form` (never says "form") and `webhook-reply` —
  **passed first attempt** on `gemini-3.5-flash-lite` and are recorded.
- **UI**: the trigger panel shows the form's link beside the webhook's (copy, rotate with a confirm, switched
  off said); the field list is the row editor; a form run by hand asks for its fields. Palette icons for both.
- **Verified**: `verify-forms.mjs` (new) **55 passed** on the deployed service — page and POST signed out,
  nothing about the workflow reaching a visitor, refusals writing no run, honeypot, 409 and a closed page for
  an off form, rotation killing the old link, a failing workflow telling the visitor only the author's message,
  a webhook's `curl` getting its status, headers and body, a branch not taken answering the summary, a Respond
  refused under a manual trigger and for a redirect / cookie / line-break header, and a 429 with `Retry-After`
  after 13 submissions. `verify-security` **100 passed** (the form route, its page and its missing GET added),
  `verify-api` 598 passed / 0 failed / 5 skipped, `verify-a11y`, `verify-templates`, `verify-integrations`,
  `verify-postgres` passed, `verify-observability` passed / 1 structural skip, `smoke.mjs` clean on its second
  walk (the first met the known null-cell flake in beat 8). In a real browser: the form at 390 px in Light and
  Night, errors and the sent state, and the canvas's trigger inspector and Respond inspector in both themes —
  **contrast audit empty on every state**. Four deliberate mutations of the new rules were each caught.

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
