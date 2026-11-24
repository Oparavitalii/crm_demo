-- Drop the `commute_type` column from candidates and employment_periods.
-- The "Dojazd" (Свій / Наш) selector is no longer part of the lifecycle —
-- removed end-to-end from UI, services, shared schemas, and DB on 2026-06-09.
--
-- IF EXISTS guards make this idempotent for dev/CI databases.

ALTER TABLE "candidates" DROP COLUMN IF EXISTS "commute_type";
ALTER TABLE "employment_periods" DROP COLUMN IF EXISTS "commute_type";
