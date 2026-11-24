-- 2026-06-10 Excel-import prep: add 4 new optional candidate fields and seed
-- the two new lookup types (`position`, `legal_status`) that drive the
-- inline-editable dropdowns on the candidate edit form.
--
-- - `position`           — text, nullable, dropdown from status_lookups
-- - `legal_status`       — text, nullable, dropdown from status_lookups
-- - `work_hours_summary` — text, nullable, free input
-- - `reconciliation_period` — text, nullable, free input
--
-- IF NOT EXISTS / ON CONFLICT guards make the migration safe to re-apply.

ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "position" text;
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "legal_status" text;
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "work_hours_summary" text;
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "reconciliation_period" text;

-- Seed the two new lookup types with real values from the client's Excel.
-- is_system=false so admins can soft-delete / hard-delete via the admin UI
-- (the seeded position/legal_status rows are domain data, not contract).
INSERT INTO "status_lookups" ("type", "code", "label_pl", "label_ua", "sort_order", "is_system") VALUES
  ('position', 'magazynier',     'Magazynier',        'Магазинер',         10, false),
  ('position', 'magazynier_udt', 'Magazynier z UDT',  'Магазинер з UDT',   20, false),

  ('legal_status', 'status_ukr',         'Status UKR',              'Статус УКР',                10, false),
  ('legal_status', 'bezviz',             'Bezwiz',                  'Безвіз',                    20, false),
  ('legal_status', 'karta_pobytu',       'Karta Pobytu',            'Карта Побуту',              30, false),
  ('legal_status', 'podacha_na_kp',      'Podanie na KP',           'Подача на КП',              40, false),
  ('legal_status', 'viza',               'Wiza',                    'Віза',                      50, false),
  ('legal_status', 'prodluzhennye_doki', 'Przedłużone dokumenty',   'Продовжені документи',      60, false)
ON CONFLICT ("type", "code") WHERE "deleted_at" IS NULL DO NOTHING;
