-- 2026-06-12 — seed three additional popular nationalities. The /apply/:slug
-- form renders this list as a Select; recruiters often see candidates from
-- Georgia, Romania and Turkey on top of the existing UA/PL/MD/BY set.
--
-- Codes follow the descriptive Polish-noun convention introduced by
-- migration 0038 ('bialoruskie') rather than the older 2-letter ISO style
-- ('ua', 'pl', 'md') — keeps the labels and codes self-documenting at the
-- DB level, and matches what coordinators see in the dropdown.
--
-- Sort orders extend the existing sequence (10/20/30/40 → 50/60/70). Same
-- ON CONFLICT pattern as 0034 / 0038 — safe to re-run.

INSERT INTO "status_lookups" ("type", "code", "label_pl", "label_ua", "sort_order", "is_system") VALUES
  ('nationality', 'gruzinskie', 'Gruzińskie', 'Грузинське', 50, false),
  ('nationality', 'rumunskie',  'Rumuńskie',  'Румунське',  60, false),
  ('nationality', 'tureckie',   'Tureckie',   'Турецьке',   70, false)
ON CONFLICT ("type", "code") WHERE "deleted_at" IS NULL DO NOTHING;
