-- 2026-07-08 — register `form_recruiter` as a first-class source in
-- status_lookups. This code is set automatically by candidates.service.ts when
-- a lead arrives through a recruiter's personal form link (?recruiterSlug=...),
-- but it was never seeded, so every dashboard widget (SourceBreakdown donut,
-- RetentionBySource table, recruiter KPI badges) bucketed it as "Unknown" and
-- the retention panel even surfaced the raw `source.form_recruiter` key.
--
-- `manual` is intentionally NOT added — it was renamed to `unknown` per client
-- feedback 2026-05-29 (FAZA 24a); legacy `manual`/`none` rows keep bucketing as
-- Unknown, which is the desired behaviour.
--
-- Idempotent: re-running is safe thanks to ON CONFLICT DO NOTHING and the
-- partial unique index (`type`, `code`) WHERE deleted_at IS NULL.
INSERT INTO "status_lookups" ("type", "code", "label_pl", "label_ua", "sort_order", "is_system") VALUES
  ('sources', 'form_recruiter', 'Formularz rekrutera', 'Форма рекрутера', 35, true)
ON CONFLICT ("type", "code") WHERE "deleted_at" IS NULL DO NOTHING;
