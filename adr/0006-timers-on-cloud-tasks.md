# 0006 — Schedules fire from Cloud Tasks timers, not from a polling cron

**Status:** Accepted · **Date:** 2026-10-06 · **Phase:** 26 · **Decisions:** D114–D119

## Context

Schedules were fired by a Cloud Scheduler job ticking every 15 minutes, asking the database whether
anything was due. On Neon's free tier that tick alone woke the database about 2,920 times a month —
roughly 61 of the 100 CU-hours the plan allows — to learn, almost always, that nothing was due. And
pausing the job to save the hours meant nothing fired at all.

A run that must *wait* (a delay of two days, later an approval) has the same shape: something has to
happen at a chosen time, and nothing should be awake in between.

## Decision

A schedule arms **one Cloud Tasks task per slot**, scheduled for the slot's exact due time, which
calls `POST /api/cron/fire`. A delay over ten seconds suspends the run as `waiting` and wakes it the
same way. The Scheduler job stays, as a **daily safety sweep** that re-arms anything lost.

**The task is a prompt, never the guard.** A delivery fires only by claiming
`WHERE scheduleNextAt = <its slot> AND active AND due`; a timer for a slot that moved, was switched
off or already fired is declined. Correctness does not depend on the queue delivering once, or on time.

## Consequences

The idle product costs about 0.6 CU-hours a month in sweeps. Nothing in the app keeps a clock, so
nothing needs a long-lived process. The cost: Cloud Tasks cannot schedule more than 30 days out, so a
longer wait re-arms in steps, and a task body is stored by Google — hence the per-slot HMAC token
(D115), which authorises one slot of one workflow and nothing else.

## Alternatives

- **Keep the 15-minute tick.** Simple, and exhausts the free database in under two months.
- **A longer tick (hourly).** Cuts the cost and makes every schedule up to an hour late.
- **An in-process timer.** Cloud Run scales to zero; there is no process to hold it.
