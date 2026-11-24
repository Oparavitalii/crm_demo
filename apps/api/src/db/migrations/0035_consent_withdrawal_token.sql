-- 2026-06-10 — RODO art. 7 ust. 3 (right to withdraw consent as easily as it
-- was given). Adds the `withdrawal_token` column used by the new
-- `POST /public/consents/withdraw` endpoint.
--
-- Three-step add so existing rows (if any) survive the NOT NULL transition:
--   1. add as nullable
--   2. backfill with fresh random UUIDs (each row gets a unique token)
--   3. flip to NOT NULL + add unique index
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + WHERE IS NULL backfill + IF NOT EXISTS
-- on the index. Re-running on an already-migrated DB is a no-op.

ALTER TABLE "consents"
  ADD COLUMN IF NOT EXISTS "withdrawal_token" uuid;

UPDATE "consents"
  SET "withdrawal_token" = gen_random_uuid()
  WHERE "withdrawal_token" IS NULL;

ALTER TABLE "consents"
  ALTER COLUMN "withdrawal_token" SET DEFAULT gen_random_uuid(),
  ALTER COLUMN "withdrawal_token" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "consents_withdrawal_token_idx"
  ON "consents" ("withdrawal_token");
