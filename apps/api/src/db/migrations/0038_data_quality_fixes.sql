-- 2026-06-10 data-quality cleanup batch. Three independent fixes that align
-- existing rows with the lookup catalogs they reference:
--
-- 1. `source = 'manual'` rows (461 candidates) — `manual` was renamed to
--    `unknown` in the lookup back on 2026-05-29 but the existing rows kept
--    the old code. Frontend rendered them italic-dimmed (unknown-code fallback).
--    Drift now zeroed.
--
-- 2. `nationality.bia_oruskie` — typo. Two candidate rows carry it (one as
--    `bia_oruskie`, one as `by`). Lookup row also typoed. Both fixed to
--    `bialoruskie` so they line up with the PL/UA labels.
--
-- 3. `reconciliation_period` formats — the spec calls for `'YYYY-MM'`. The
--    Excel import wrote `'YYYY-MM-DD 00:00:00'` (89 rows) and a handful of
--    free-text strings (`'01.04 -160 часов'`). Normalize the timestamps and
--    null the un-parseable ones — losing free text is fine here, the same
--    candidates still carry the period note in their `notes` field.

-- (1) source drift
UPDATE "candidates" SET "source" = 'unknown' WHERE "source" = 'manual';

-- (2) nationality typo + lookup row
UPDATE "candidates" SET "nationality" = 'bialoruskie'
  WHERE "nationality" IN ('bia_oruskie', 'by');

-- Replace the typoed lookup code. Soft-delete the bad one first so the
-- unique-active index doesn't collide with the rename. Then upsert the
-- canonical row. ON CONFLICT path keeps re-runs safe.
UPDATE "status_lookups" SET "deleted_at" = now()
  WHERE "type" = 'nationality' AND "code" = 'bia_oruskie' AND "deleted_at" IS NULL;

INSERT INTO "status_lookups" ("type", "code", "label_pl", "label_ua", "sort_order", "is_system") VALUES
  ('nationality', 'bialoruskie', 'Białoruskie', 'Білоруське', 40, false)
ON CONFLICT ("type", "code") WHERE "deleted_at" IS NULL DO NOTHING;

-- (3) reconciliation_period normalization
-- '2026-05-01 00:00:00'   → '2026-05'    (truncate to YYYY-MM)
-- '2026-05'               → unchanged
-- '01.04 -160 часов' etc. → NULL         (un-parseable, free text lost)
UPDATE "candidates"
SET "reconciliation_period" = LEFT("reconciliation_period", 7)
WHERE "reconciliation_period" ~ '^\d{4}-\d{2}-\d{2}';

UPDATE "candidates"
SET "reconciliation_period" = NULL
WHERE "reconciliation_period" IS NOT NULL
  AND "reconciliation_period" !~ '^\d{4}-\d{2}$';
