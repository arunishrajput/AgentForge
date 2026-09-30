-- Rollback for 0009_jazzy_alex_power.sql — Phase 21, credential vault and rotation.
--
-- ############################################################################
-- #  STOP. THIS SCRIPT DESTROYS EVERY ENVELOPED CREDENTIAL IF RUN TOO SOON.  #
-- ############################################################################
--
-- 0009 is purely additive, so applying it was safe with the previous revision still
-- serving. **Reversing it is not symmetric**, and the asymmetry is the whole of this
-- comment.
--
-- After a re-key, a credential's `ciphertext` is encrypted under a per-credential data
-- key, and that data key exists in exactly one place: the `wrappedKey` column this
-- script drops. Dropping it discards the only copy of the key. The ciphertext survives
-- and is then permanently unreadable — by this revision, by the previous one, and by
-- anybody with the root key.
--
-- So the rollback is TWO steps and the first one is not optional:
--
--   1.  Convert every credential back to the Chapter 1 single-layer shape, encrypted
--       directly under ENCRYPTION_KEY, which a pre-Phase-21 revision can read:
--
--           node --import ./scripts/test-register.mjs scripts/rekey.mjs --to-legacy
--
--       It prints a count per credential and verifies each row decrypts after it is
--       written. Confirm `converted` equals the number of credentials and `failures` is
--       empty before going further.
--
--   2.  Verify no row still holds an envelope. This must return 0:
--
--           select count(*) from credential where "wrappedKey" is not null;
--
--   3.  Only then run this script.
--
-- If step 1 cannot be run — the root key is unreachable, say — then DO NOT run this
-- script. Shift Cloud Run traffic to the previous revision instead and leave the schema
-- alone: the added columns are invisible to a revision that does not know about them, so
-- the old code serves correctly against the new schema. That is the real rollback path,
-- and this file is only for removing the columns afterwards.
--
-- Dropping `credential_event` loses the audit history and nothing else; no other table
-- references it.

-- Refuses to run while any credential would be destroyed by it. `raise` inside a DO
-- block aborts the whole script, so nothing below executes.
DO $$
DECLARE enveloped integer;
BEGIN
  -- The table name is quoted so `scripts/rehearse-0009.mjs` can point this guard at its
  -- throwaway copy. Unquoted, it resolves through `search_path` to `public` and the
  -- rehearsal silently checks the wrong table — which would leave the one statement in this
  -- file that protects the data as the one statement never actually exercised.
  SELECT count(*) INTO enveloped FROM "credential" WHERE "wrappedKey" IS NOT NULL;
  IF enveloped > 0 THEN
    RAISE EXCEPTION
      'Refusing to roll back: % credential row(s) are still enveloped and would become permanently unreadable. Run scripts/rekey.mjs --to-legacy first.',
      enveloped;
  END IF;
END $$;
--> statement-breakpoint

DROP TABLE IF EXISTS "credential_event";
--> statement-breakpoint

ALTER TABLE "credential" DROP COLUMN IF EXISTS "wrappedKey";
--> statement-breakpoint
ALTER TABLE "credential" DROP COLUMN IF EXISTS "wrapIv";
--> statement-breakpoint
ALTER TABLE "credential" DROP COLUMN IF EXISTS "wrapAuthTag";
--> statement-breakpoint
ALTER TABLE "credential" DROP COLUMN IF EXISTS "keyVersion";
--> statement-breakpoint
ALTER TABLE "credential" DROP COLUMN IF EXISTS "rotatedAt";
--> statement-breakpoint
ALTER TABLE "credential" DROP COLUMN IF EXISTS "rotationCount";
--> statement-breakpoint

ALTER TABLE "workflow" DROP COLUMN IF EXISTS "webhookTokenRotatedAt";
