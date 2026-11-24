-- 2026-07-14 — onboarding auto-send flag on message templates.
--
-- Marks a single email template as the welcome/onboarding message that the
-- system auto-sends to every newly created candidate (manual create + public
-- form). Newest flagged template wins if several are set. When the body carries
-- {{consentConfirmUrl}}, the auto-send also mints an opt-in token so the welcome
-- doubles as a lawful re-consent ask. Additive + backward-compatible: existing
-- templates default to false (no auto-send), so nothing changes until an admin
-- opts a template in.

ALTER TABLE "message_templates" ADD COLUMN IF NOT EXISTS "auto_send_on_create" boolean DEFAULT false NOT NULL;
