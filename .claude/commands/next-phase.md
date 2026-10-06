---
description: Determine the next incomplete phase from repository state and begin implementing it
---

Start the next phase of AgentForge. Follow the session start protocol exactly — do not ask what to
work on unless the repository genuinely cannot determine it.

1. Inspect the repository.
2. Run `git status` and `git log --oneline -5`. Check for uncommitted or unpushed work. If a previous
   session ended mid-phase, follow `CLAUDE.md` → *Recovering from an incomplete session* before
   starting anything new.
3. Read `CLAUDE.md`, `PROGRESS.md`, `BUILD_PLAN.md`. **The current work is Chapter 3, phases
   26–42.** Phases 0–25 (Chapters 1 and 2) are closed history and are never reopened; their
   definitions and evidence live in `archive/`.
4. Read only the further docs the next phase actually needs — its own *Documentation updates* and
   *Implementation notes* name them — and search `DECISIONS.md` for the decisions that cover the
   area you are about to change.
5. **Verify the actual state — do not trust the docs.** As applicable:
   - `gcloud run services describe agentforge --region asia-southeast1 --format='value(status.url,status.latestReadyRevisionName)'`
   - `curl -fsS https://agentforge-733000675212.asia-southeast1.run.app/api/health` (the service
     scales to zero, so a first request takes several seconds)
   - the expected database tables and migrations exist (`node --env-file=.env scripts/verify-schema.mjs`)
   - the build passes (`npm run check`)
6. Determine: current phase, whether the previous phase genuinely completed, what remains, blockers,
   branch, deployment state. Reconcile any discrepancy with `PROGRESS.md` and say so.
7. Summarise that understanding briefly.
8. Begin implementing the **next incomplete phase** — exactly one phase. If it is too large for one
   session, split it deliberately and record the split in `BUILD_PLAN.md`, as Chapter 2 did with
   19 and 23.

Then follow the end-of-phase protocol in `CLAUDE.md`:

- verify — on the deployed service, and in a real browser **in both Light and Dark** for any UI claim
  from Phase 28 onward
- inspect the diff
- update `PROGRESS.md` (*Current Phase*, the Chapter 3 table, *Deployed State*, *Notes*), the
  `← START HERE` marker in `BUILD_PLAN.md`, `DECISIONS.md` for any new binding decision, and any
  docs the phase invalidated
- confirm no secrets are staged
- commit and push, and confirm the push succeeded **and that CI actually ran**
- report the completion summary, and stop

Do not begin the following phase in the same session.
