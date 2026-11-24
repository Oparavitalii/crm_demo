-- Drop the Vacancies (Wakaty) subsystem. The Projekt field on candidates
-- already covers the "which job opening" concept; separate vacancy tracking
-- with start_date / location / slot reservations is no longer in scope.
--
-- Order matters: vacancy_slots has FK to vacancies; candidates.submitted_to_vacancy_id
-- has FK to vacancies; facebook_lead_forms.vacancy_id has FK to vacancies — drop
-- those FKs / columns first.

ALTER TABLE "candidates" DROP COLUMN IF EXISTS "submitted_to_vacancy_id";
ALTER TABLE "facebook_lead_forms" DROP COLUMN IF EXISTS "vacancy_id";
DROP TABLE IF EXISTS "vacancy_slots";
DROP TABLE IF EXISTS "vacancies";
