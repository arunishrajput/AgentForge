---
description: Verify the deployed AgentForge system end to end and report a ship-readiness verdict
---

Verify the **deployed** AgentForge system. Exit codes are not evidence — check behaviour.

Read `PROGRESS.md` → *Deployed State* for the URL and region, and `DEPLOYMENT.md` → *Verification*
for the authoritative command list. If nothing is deployed yet, say so and stop.

Check, in order, and report each as PASS / FAIL / NOT APPLICABLE YET (with the phase that introduces it):

1. **Service** — right revision serving, and `min-instances` as expected.
2. **Health** — `curl -fsS "$APP_BASE_URL/api/health"` from outside, including its database check.
3. **Logs** — recent logs contain no startup or request errors.
4. **Database** — a real query against the production database; expected tables present.
5. **Auth** (Phase 2+) — report whether production sign-in was confirmed and when. This needs a
   browser, so state plainly if it is unverified rather than assuming it works.
6. **Realtime** (Phase 5+) — a run on the deployed URL streams per-node events incrementally.
7. **Full workflow** (Phase 3+) — one complete workflow executed end to end on the deployed system.
8. **Demo path** (Phase 11+) — run the `DEMO.md` path and report any beat that was not clean.
9. **Secrets** — nothing sensitive committed; no secret values in logs.
10. **Docs vs reality** — `PROGRESS.md` matches what you actually found. Correct it if not.

Finish with an explicit verdict: **SHIP-READY** or **NOT SHIP-READY**, and if not, the shortest list
of things that must change. Do not fix anything unless asked — this is a check.
