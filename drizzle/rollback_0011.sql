-- Rollback for 0011_hesitant_ozymandias.sql — Phase 25, first-run onboarding.
--
-- **Safe, and genuinely symmetric**, like `rollback_0010.sql` and unlike
-- `rollback_0009.sql` (which can destroy every credential if run too soon).
--
-- 0011 adds one nullable column and backfills nothing. Dropping it:
--
--   • touches no credential, no ciphertext, no workflow and no run — nothing else
--     references this column;
--   • loses exactly one preference per workspace: whether it had finished or skipped the
--     onboarding guide. A workspace that had dismissed the guide will see it again on the
--     next page load, with its progress read live and almost certainly complete, and can
--     dismiss it again in one click. That is the whole user-visible consequence;
--   • is readable by a pre-25 revision immediately, because that revision never selected
--     this column.
--
-- Run it only to reverse a deploy.

ALTER TABLE "workspace" DROP COLUMN IF EXISTS "onboardedAt";
