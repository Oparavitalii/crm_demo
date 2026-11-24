-- 2026-06-10 — drop 9 candidate columns that the operations team doesn't
-- want on the list view or detail card. Service-side lifecycle stamping
-- moves to using `work_start_date` / `work_end_date` (which the form
-- already drives explicitly) instead of the auto-stamped sister columns.
--
-- Functional impact (handled in the same PR):
--   * candidates.service.ts — strip status→timestamp stamping for
--     employed_at/re_employed_at/dismissed_at/blacklisted_at/cancelled_at;
--     cancel flow now requires `reason_note` instead of `cancel_reason_code`.
--   * retention auto-compute on the list (columns.tsx + MobileCandidateCardList)
--     switches to `work_start_date` → `work_end_date` / now.
--   * Detail page lifecycle section + LifecycleChecklist drop the affected
--     timestamps and the arrival_status indicator.
--   * Tests/fixtures updated.
--   * FailedCandidatesReport keeps working — `no_show_reason` filter falls
--     back to `work_end_reason` (same `dismissal_reason` lookup pool).
--
-- All DROP COLUMN CASCADE — there are no FK references but cascade keeps
-- the migration safe to re-apply if rerun against an already-dropped table.

ALTER TABLE "candidates" DROP COLUMN IF EXISTS "employed_at" CASCADE;
ALTER TABLE "candidates" DROP COLUMN IF EXISTS "re_employed_at" CASCADE;
ALTER TABLE "candidates" DROP COLUMN IF EXISTS "dismissed_at" CASCADE;
ALTER TABLE "candidates" DROP COLUMN IF EXISTS "blacklisted_at" CASCADE;
ALTER TABLE "candidates" DROP COLUMN IF EXISTS "cancelled_at" CASCADE;
ALTER TABLE "candidates" DROP COLUMN IF EXISTS "expected_departure_date" CASCADE;
ALTER TABLE "candidates" DROP COLUMN IF EXISTS "arrival_status" CASCADE;
ALTER TABLE "candidates" DROP COLUMN IF EXISTS "no_show_reason" CASCADE;
ALTER TABLE "candidates" DROP COLUMN IF EXISTS "cancel_reason_code" CASCADE;
ALTER TABLE "candidates" DROP COLUMN IF EXISTS "cancel_reason_note" CASCADE;
