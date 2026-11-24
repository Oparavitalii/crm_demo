-- 2026-07-10 — admin-configurable retention channel grouping. Adds a nullable
-- `group_key` to status_lookups so admins can assign each SOURCE to a retention
-- channel (social / jobBoards / website / formRecruiter / other) from
-- /admin/settings/statuses, instead of the classification being hardcoded in
-- the analytics code. Only meaningful for type='sources'; null for other types.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + backfill UPDATEs are safe to re-run.
ALTER TABLE "status_lookups" ADD COLUMN IF NOT EXISTS "group_key" text;

-- Backfill the known seeded sources to their channel so existing data keeps its
-- current grouping after the code switches to the lookup-driven classification.
UPDATE "status_lookups" SET "group_key" = 'social'
  WHERE "type" = 'sources' AND "code" IN ('facebook', 'instagram', 'telegram');
UPDATE "status_lookups" SET "group_key" = 'jobBoards'
  WHERE "type" = 'sources' AND "code" IN ('work_ua', 'flagma', 'olx');
UPDATE "status_lookups" SET "group_key" = 'website'
  WHERE "type" = 'sources' AND "code" = 'website';
UPDATE "status_lookups" SET "group_key" = 'formRecruiter'
  WHERE "type" = 'sources' AND "code" = 'form_recruiter';
UPDATE "status_lookups" SET "group_key" = 'other'
  WHERE "type" = 'sources' AND "code" = 'referral';
