# 0007 — Three themes, Light the default, every one held to the same gates

**Status:** Accepted · **Date:** 2026-10-06 · **Phase:** 27–28 · **Decisions:** D110, D121–D127

## Context

Toybox — saturated colour, thick dark outlines, chunky offset shadows — was designed light-first,
and a dark mode was the most requested thing a daily-use product lacks. A dark theme made by
inverting a bright one reads as a dark IDE, which the product's identity rejects, and one made
without gates drifts into unreadable text.

## Decision

Three themes: **Light** (the default and the reference), **Dark** ("Toybox Night") and **System**.
The preference lives in `<html data-theme>`, `localStorage` keeps it, and a blocking inline script
applies it before first paint. The stylesheet — not JavaScript — resolves System, so a device that
switches at sunset takes the page with it. **Light is the default even on a dark device.**

Night is not an inversion: it has its own palette, with the outline, shadow and fill roles redefined,
and **every contrast gate runs once per theme** (`tokens.test.ts`). A rendered audit
(`scripts/contrast-audit.browser.js`) runs in a real browser in both, because tokens passing says
nothing about whether a screen uses them. From Phase 28 every UI claim is verified in both.

## Consequences

A new screen cannot ship in one theme. Night's amber fill is bronze, by design: a fill has to sit at
about 0.24 luminance there, where yellow cannot be bright. There is no Content-Security-Policy that
restricts scripts, partly because the theme script is inline (see [0010](./0010-security-headers-without-script-src.md)).

## Alternatives

- **Dark only, or follow the OS only.** Overrides a reader who chose Light on a dark device.
- **Invert the palette.** Fails the gates and loses the identity.
- **A theme library.** One script and one attribute do the job with no dependency.
