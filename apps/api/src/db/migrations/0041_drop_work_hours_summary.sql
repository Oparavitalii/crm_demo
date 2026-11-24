-- 2026-06-10 — drop unused `work_hours_summary` text column (6/464 = 1% coverage).
-- Operations team confirmed it's not actually used; recruiters track hours in
-- the external xlsx the reconciliation workflow consumes, not in this column.

ALTER TABLE "candidates" DROP COLUMN IF EXISTS "work_hours_summary" CASCADE;
