-- Rollback for 0010_worthless_baron_zemo.sql — Phase 23D, the second LLM provider.
--
-- **Safe, and genuinely symmetric**, which is not true of every rollback in this directory
-- (compare `rollback_0009.sql`, which can destroy every credential if run too soon).
--
-- 0010 adds one nullable column and backfills nothing. Dropping it:
--
--   • touches no credential, no ciphertext and no wrapped key — a provider key lives in
--     `credential` and is not referenced here;
--   • loses exactly one preference per workspace: which of the two providers it had chosen.
--     A workspace that had chosen Groq reverts to Google on the next resolve, because the
--     code reads an absent choice as "the first provider you hold a key for". Its Groq
--     credential is still stored and still works the moment the column comes back;
--   • is readable by a pre-23D revision immediately, because that revision never selected
--     this column.
--
-- Run it only to reverse a deploy, and note the one user-visible consequence above so
-- nobody is surprised that a workspace changed provider.

ALTER TABLE "workspace" DROP COLUMN IF EXISTS "llmProvider";
