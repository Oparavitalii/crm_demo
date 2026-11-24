-- Admin-editable lookup table for the 4 dynamic status lists:
--   - 'sources'           — shared between leads.source and candidates.source
--   - 'lead_status'       — leads.status (no transition logic)
--   - 'dismissal_reason'  — dismissals.reasonCode
--   - 'no_show_reason'    — candidates.noShowReason
--
-- Soft-delete only (deletedAt). Existing data referencing a code stays intact
-- after delete; frontend falls back to raw code when label is missing.
-- `is_system=true` rows are protected from hard-delete (can be soft-deleted).
CREATE TABLE IF NOT EXISTS "status_lookups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "type" text NOT NULL,
  "code" text NOT NULL,
  "label_pl" text NOT NULL,
  "label_ua" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_system" boolean DEFAULT false NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by_id" uuid
);

DO $$ BEGIN
  ALTER TABLE "status_lookups" ADD CONSTRAINT "status_lookups_created_by_id_users_id_fk"
    FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Partial unique: a code can be reused after soft-delete.
CREATE UNIQUE INDEX IF NOT EXISTS "status_lookups_active_code_idx"
  ON "status_lookups" USING btree ("type", "code")
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "status_lookups_type_sort_idx"
  ON "status_lookups" USING btree ("type", "sort_order", "label_pl");

CREATE INDEX IF NOT EXISTS "status_lookups_deleted_idx"
  ON "status_lookups" USING btree ("deleted_at")
  WHERE "deleted_at" IS NOT NULL;

-- Seed defaults. Idempotent — safe to re-apply. is_system=true protects
-- these rows from hard-delete (soft-delete still allowed if admin wants to
-- hide one). Codes match existing values present in candidates/leads/
-- dismissals rows so existing DB data renders with proper labels.
INSERT INTO "status_lookups" ("type", "code", "label_pl", "label_ua", "sort_order", "is_system") VALUES
  -- sources (shared by leads + candidates)
  ('sources', 'facebook',  'Facebook',          'Facebook',          10, true),
  ('sources', 'instagram', 'Instagram',         'Instagram',         20, true),
  ('sources', 'website',   'Strona internetowa', 'Веб-сайт',          30, true),
  ('sources', 'work_ua',   'Work.ua',           'Work.ua',           40, true),
  ('sources', 'flagma',    'Flagma',            'Flagma',            50, true),
  ('sources', 'referral',  'Polecenie',         'Рекомендація',       60, true),
  ('sources', 'unknown',   'Nieznane',          'Невідомо',           70, true),

  -- lead_status
  ('lead_status', 'new',          'Nowy',           'Новий',           10, true),
  ('lead_status', 'contacted',    'Skontaktowano',  'Зв''язалися',     20, true),
  ('lead_status', 'qualified',    'Zakwalifikowany', 'Кваліфікований',  30, true),
  ('lead_status', 'disqualified', 'Zdyskwalifikowany', 'Дискваліфікований', 40, true),
  ('lead_status', 'converted',    'Skonwertowany',  'Конвертований',   50, true),

  -- dismissal_reason
  ('dismissal_reason', 'employee_resigned',   'Pracownik zrezygnował',        'Працівник звільнився',          10, true),
  ('dismissal_reason', 'returned_home',       'Wrócił do domu',                'Повернувся додому',             20, true),
  ('dismissal_reason', 'found_other_job',     'Znalazł inną pracę',            'Знайшов іншу роботу',           30, true),
  ('dismissal_reason', 'low_performance',     'Niska wydajność',               'Низька продуктивність',         40, true),
  ('dismissal_reason', 'absenteeism',         'Absencja',                      'Відсутність на роботі',         50, true),
  ('dismissal_reason', 'misconduct',          'Naruszenie dyscypliny',         'Порушення дисципліни',          60, true),
  ('dismissal_reason', 'contract_ended',      'Koniec kontraktu',              'Закінчення контракту',          70, true),
  ('dismissal_reason', 'health_issues',       'Problemy zdrowotne',            'Проблеми зі здоров''ям',        80, true),
  ('dismissal_reason', 'conflict',            'Konflikt',                      'Конфлікт',                       90, true),
  ('dismissal_reason', 'other',               'Inne',                          'Інше',                          100, true),

  -- no_show_reason
  ('no_show_reason', 'lost_contact',             'Stracony kontakt',                  'Втрачений контакт',              10, true),
  ('no_show_reason', 'personal_reasons',         'Przyczyny osobiste',                'Особисті причини',               20, true),
  ('no_show_reason', 'unsuitable_conditions',    'Nieodpowiednie warunki',            'Неприйнятні умови',              30, true),
  ('no_show_reason', 'client_no_longer_needs',   'Klient nie potrzebuje',             'Клієнт більше не потребує',       40, true),
  ('no_show_reason', 'blacklist',                'Czarna lista',                       'Чорний список',                  50, true),
  ('no_show_reason', 'legalization_rejected',    'Odmowa legalizacji',                 'Відмова в легалізації',          60, true),
  ('no_show_reason', 'legalization_problem',     'Problem z legalizacją',              'Проблеми з легалізацією',        70, true),
  ('no_show_reason', 'other',                    'Inne',                               'Інше',                           80, true)
ON CONFLICT ("type", "code") WHERE "deleted_at" IS NULL DO NOTHING;
