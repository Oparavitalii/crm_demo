-- 2026-06-10 — drop three candidate columns and the partial unique index that
-- backed `external_id`. Per product feedback the «External ID», «CV» and
-- «Фото» columns surface no value on the operations dashboard, so they're
-- gone everywhere — DB, list, detail card.
--
-- Implications addressed elsewhere in this migration's PR:
--   * anonymize.service.ts no longer tries to R2-delete cv_url / photo_url
--   * audit oldValue stops emitting hadCvUrl / hadPhotoUrl
--   * the shared `candidateSchema` drops the matching three fields
--   * UI: columns.tsx + CandidateDetailPage.tsx system section pruned
--   * i18n keys cvUrl / photoUrl / externalId left in place (harmless leftover,
--     not referenced after this migration)
--
-- Re-import upserts that previously matched by `external_id = 'xlsx:…'`
-- become pure name+project matches. The xlsx-backfill helper script is
-- removed in the same PR so nothing references the column at write-time.

DROP INDEX IF EXISTS "candidates_external_id_idx";
ALTER TABLE "candidates" DROP COLUMN IF EXISTS "external_id";
ALTER TABLE "candidates" DROP COLUMN IF EXISTS "cv_url";
ALTER TABLE "candidates" DROP COLUMN IF EXISTS "photo_url";
