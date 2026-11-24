-- 2026-07-04 — SMS-marketing consent can be keyed on the PHONE, not just email.
--
-- Before this, `consents.candidate_email` was NOT NULL and the sms_marketing
-- lookup matched on email only, so a phone-only applicant could never opt into
-- SMS (the exact channel that needs only a phone). This migration:
--   * adds a nullable candidate_phone (the SMS identity);
--   * drops NOT NULL on candidate_email (email now optional);
--   * indexes candidate_phone for the sms_marketing bulk-send lookup;
--   * adds a CHECK so every consent still carries at least one identifier.
--
-- Backward-compatible: every existing row has candidate_email set, so the CHECK
-- holds and old code paths (which only set candidate_email) keep working.

ALTER TABLE "consents" ADD COLUMN IF NOT EXISTS "candidate_phone" text;
--> statement-breakpoint
ALTER TABLE "consents" ALTER COLUMN "candidate_email" DROP NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consents_candidate_phone_idx" ON "consents" USING btree ("candidate_phone");
--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_email_or_phone" CHECK ("candidate_email" IS NOT NULL OR "candidate_phone" IS NOT NULL);
