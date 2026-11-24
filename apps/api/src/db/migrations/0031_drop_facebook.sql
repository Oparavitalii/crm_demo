-- Drop the in-house Facebook Lead Ads polling subsystem.
-- Lead ingestion is now handled by Make.com → POST /public/leads with
-- Authorization: Bearer <MAKE_WEBHOOK_SECRET>. The polling cron, admin UI for
-- per-form mappings, and the supporting tables are no longer needed.
--
-- IF EXISTS guards make this idempotent — local/dev databases that never had
-- the tables (or already dropped them) won't fail.

DROP TABLE IF EXISTS "facebook_cron_runs";
DROP TABLE IF EXISTS "facebook_token_status";
DROP TABLE IF EXISTS "facebook_rejected_leads";
DROP TABLE IF EXISTS "facebook_lead_forms";
