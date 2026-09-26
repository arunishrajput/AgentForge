---
description: Determine the next incomplete phase from repository state and begin implementing it
---

Start the next phase of AgentForge. Follow the session start protocol exactly — do not ask what to
work on unless the repository genuinely cannot determine it.

1. Inspect the repository.
2. Run `git status` and `git log --oneline -5`. Check for uncommitted or unpushed work. If a previous
   session ended mid-phase, follow `CLAUDE.md` → *Recovering from an incomplete session* before
   starting anything new.
3. Read `CLAUDE.md`, `PROGRESS.md`, `BUILD_PLAN.md`. **The current work is Chapter 2, phases
   13–25.** Phases 0–12 are closed history and are never reopened.
4. Read only the further docs the next phase actually needs.
5. **Verify the actual state — do not trust the docs.** As applicable:
   - `gcloud run services describe agentforge --region "$GCP_REGION" --format='value(status.url,status.latestReadyRevisionName)'`
   - `curl -fsS "$APP_BASE_URL/api/health"`
   - the expected database tables exist
   - the build passes
6. Determine: current phase, whether the previous phase genuinely completed, what remains, blockers,
   branch, deployment state. Reconcile any discrepancy with `PROGRESS.md` and say so.
7. Summarise that understanding briefly.
8. Begin implementing the **next incomplete phase** — exactly one phase.

Then follow the end-of-phase protocol in `CLAUDE.md`: verify (deployed, from Phase 2 onward), inspect
the diff, update `PROGRESS.md` and any docs the phase invalidated, confirm no secrets are staged,
commit, push, confirm the push succeeded, report the completion summary, and stop.

Do not begin the following phase in the same session.
