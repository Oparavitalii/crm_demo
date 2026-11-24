-- Seed the 11-stage candidate pipeline statuses into status_lookups for admin
-- visibility. All marked is_system=true (block hard-delete). NOTE: these are
-- READ-ONLY in spirit — the actual pipeline transition logic, auto-promotion
-- (kind='client' on employed), STATUS_RANK, and lifecycle stamping are all
-- hardcoded to these codes. Editing labels here only affects display (rare),
-- but deleting or renaming a code does NOT affect the app — services use the
-- shared CANDIDATE_STATUSES array, not this table.

INSERT INTO "status_lookups" ("type", "code", "label_pl", "label_ua", "sort_order", "is_system") VALUES
  ('candidate_status', 'new',                 'Nowy',                  'Новий',                  10, true),
  ('candidate_status', 'in_progress',         'W trakcie',             'В роботі',               20, true),
  ('candidate_status', 'documents_submitted', 'Dokumenty wysłane',     'Документи подано',       30, true),
  ('candidate_status', 'arrived',             'Dojechał',              'Доїхав',                  40, true),
  ('candidate_status', 'no_show',             'Nie dojechał',          'Не доїхав',               50, true),
  ('candidate_status', 'our_housing',         'Nasze mieszkanie',      'Наше житло',              60, true),
  ('candidate_status', 'own_housing',         'Własne mieszkanie',     'Власне житло',            70, true),
  ('candidate_status', 'employed',            'Pracuje',               'Працевлаштований',        80, true),
  ('candidate_status', 're_employed',         'Powtórnie zatrudniony', 'Повторно працевлаштов.',  90, true),
  ('candidate_status', 'dismissed',           'Zwolniony',             'Звільнений',             100, true),
  ('candidate_status', 'blacklist',           'Czarna lista',          'Чорний список',          110, true)
ON CONFLICT ("type", "code") WHERE "deleted_at" IS NULL DO NOTHING;
