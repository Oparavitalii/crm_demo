-- 2026-06-10 (part 2) — promote `nationality` from a free-text TextInput to
-- a user-extendable LookupSelect, and add `no_show_reason` / `sources` to
-- the list of types any authenticated user can extend inline from the
-- candidate form. The status_lookups table already supports any string type,
-- so this migration only seeds the new `nationality` rows (the type list is
-- enforced in Zod, not the DB).
--
-- Idempotent: re-running is safe thanks to ON CONFLICT DO NOTHING and the
-- partial unique index (`type`, `code`) WHERE deleted_at IS NULL.

INSERT INTO "status_lookups" ("type", "code", "label_pl", "label_ua", "sort_order", "is_system") VALUES
  ('nationality', 'ua', 'Ukraińskie', 'Українське', 10, false),
  ('nationality', 'pl', 'Polskie',    'Польське',   20, false),
  ('nationality', 'md', 'Mołdawskie', 'Молдавське', 30, false)
ON CONFLICT ("type", "code") WHERE "deleted_at" IS NULL DO NOTHING;
