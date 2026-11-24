-- 2026-07-14 — email-marketing consent + re-consent (double opt-in) plumbing.
--
-- Two additive changes, both backward-compatible:
--   * consents.source — nullable provenance of each consent ('apply_form',
--     're_consent_email', 'manual_verbal', 'manual_paper', 'import', ...).
--     RODO accountability: we must be able to prove HOW a consent was obtained,
--     not merely that a row exists. Existing rows stay NULL (unknown provenance).
--   * consent_optin_tokens — one-shot tokens mailed in "consent campaign" emails.
--     The candidate clicks `${APP_URL}/consent/confirm/${token}` and confirms;
--     the public confirm endpoint turns the token into active email_marketing /
--     sms_marketing rows in `consents` (source='re_consent_email'). Contact
--     identifiers are snapshot at send time so a later email/phone edit can't
--     retarget an outstanding token. FK cascades on candidate delete.
--
-- No behavioural change to existing sends until the email consent gate + the
-- confirm flow ship in application code alongside this migration.

ALTER TABLE "consents" ADD COLUMN IF NOT EXISTS "source" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consent_optin_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"candidate_email" text,
	"candidate_phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "consent_optin_tokens_email_or_phone" CHECK ("candidate_email" IS NOT NULL OR "candidate_phone" IS NOT NULL)
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "consent_optin_tokens" ADD CONSTRAINT "consent_optin_tokens_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "consent_optin_tokens_token_idx" ON "consent_optin_tokens" USING btree ("token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consent_optin_tokens_candidate_id_idx" ON "consent_optin_tokens" USING btree ("candidate_id");
