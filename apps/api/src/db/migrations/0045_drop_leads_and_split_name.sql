-- 2026-06-12 — Phase 1 of the leads-removal refactor.
--
-- Two coordinated changes:
--   1. candidates.first_name + candidates.last_name → single candidates.name
--      column. Backfill = trim(concat_ws(' ', first_name, last_name)); empty
--      results coerced to '—' so NOT NULL holds (shouldn't happen because the
--      old columns were both NOT NULL, but the guard is cheap).
--   2. The leads table is wiped entirely. The product never used the
--      lead-conversion flow in production — all public-form submissions now
--      land directly in `candidates` with status='new', source='website' or
--      whatever the form payload provides. Public URL POST /public/leads stays
--      mounted as an alias to the new candidate-submit handler (PHP form +
--      Make.com both still POST there).
--
-- Ordering matters: backfill the new column BEFORE dropping the old ones, so
-- no candidate name is lost. The `leads` table drop is independent and runs
-- afterwards, along with the `status_lookups` rows of type='lead_status'.

-- 1. Backfill new `name` column on candidates BEFORE dropping the source columns.
ALTER TABLE "candidates" ADD COLUMN "name" text;
UPDATE "candidates" SET "name" = NULLIF(trim(concat_ws(' ', "first_name", "last_name")), '');
UPDATE "candidates" SET "name" = '—' WHERE "name" IS NULL;
ALTER TABLE "candidates" ALTER COLUMN "name" SET NOT NULL;
ALTER TABLE "candidates" DROP COLUMN "first_name";
ALTER TABLE "candidates" DROP COLUMN "last_name";

-- 2. Wipe leads from status_lookups (admin-managed codes referencing the
--    retired entity) and drop the leads table. CASCADE removes the
--    `messages.lead_id` FK and the FK on `leads.converted_to_candidate_id` /
--    `leads.assigned_recruiter_id` automatically.
DELETE FROM "status_lookups" WHERE "type" = 'lead_status';
DROP TABLE IF EXISTS "leads" CASCADE;

-- 3. Drop messages.lead_id column (was nullable; the CASCADE above already
--    removed its FK but the column itself stays unless we DROP it explicitly).
ALTER TABLE "messages" DROP COLUMN IF EXISTS "lead_id";
