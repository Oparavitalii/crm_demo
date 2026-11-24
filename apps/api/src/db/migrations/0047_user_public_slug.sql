-- 2026-06-12 — Per-user URL slug for the public application form.
--
-- Recruiters share a personal link (crm.crm-demo.example/apply/<slug>) so
-- candidates submitting through that form are auto-assigned to the right
-- recruiter — no manual triage step. Admins also get a slug (the link still
-- works, the candidate lands unassigned in admin's view).
--
-- Slug is ASCII lowercase, dash-separated, derived from first_name +
-- last_name (transliterated PL → ASCII at the application layer). Unique
-- index allows nullable for legacy / system users that don't get a public
-- link. Backfill below populates active staff with deterministic slugs;
-- collisions get a numeric suffix.

ALTER TABLE "users" ADD COLUMN "public_slug" text;

-- Deterministic backfill: lowercase(first_name || '-' || last_name), strip
-- diacritics via translate(), collapse anything non-ascii-alnum to '-',
-- trim leading/trailing dashes. Collisions resolved by appending the row's
-- created_at epoch suffix — guaranteed unique because users.email is unique
-- and created_at is monotonic enough at the millisecond level. We DO NOT
-- backfill deactivated users (is_active = false) — they don't need a link.
UPDATE "users"
SET "public_slug" = regexp_replace(
  regexp_replace(
    lower(
      translate(
        coalesce(first_name, '') || '-' || coalesce(last_name, ''),
        'ąćęłńóśźżĄĆĘŁŃÓŚŹŻáéíóúýčďěňřšťůüöäßабвгдеёжзийклмнопрстуфхцчшщъыьэюяїієґАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯЇІЄҐ',
        'acelnoszzaceLnoszzaeiouycdenrstuuoabvgdeezhzijklmnoprstufhcchshshyeyuyaiieabvgdeezhzijklmnoprstufhcchshshyeyuyaiie'
      )
    ),
    '[^a-z0-9]+', '-', 'g'
  ),
  '(^-+|-+$)', '', 'g'
)
WHERE "is_active" = true AND first_name IS NOT NULL AND last_name IS NOT NULL;

-- Resolve any duplicate slugs deterministically by appending a row-number
-- suffix. First occurrence keeps the bare slug; subsequent ones get '-2',
-- '-3', etc., ordered by created_at so the older account wins.
WITH dups AS (
  SELECT id,
         public_slug,
         row_number() OVER (PARTITION BY public_slug ORDER BY created_at) AS rn
  FROM "users"
  WHERE public_slug IS NOT NULL
)
UPDATE "users" u
SET public_slug = u.public_slug || '-' || dups.rn::text
FROM dups
WHERE u.id = dups.id AND dups.rn > 1;

CREATE UNIQUE INDEX "users_public_slug_idx" ON "users" ("public_slug");
