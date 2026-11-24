CREATE TABLE IF NOT EXISTS "facebook_cron_runs" (
	"job_name" text PRIMARY KEY NOT NULL,
	"last_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "facebook_lead_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" text NOT NULL,
	"form_name" text NOT NULL,
	"vacancy_id" uuid,
	"default_recruiter_id" uuid,
	"last_polled_at" timestamp with time zone NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facebook_lead_forms_form_id_unique" UNIQUE("form_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "facebook_rejected_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" text NOT NULL,
	"leadgen_id" text NOT NULL,
	"reason" text NOT NULL,
	"raw_data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facebook_rejected_leads_leadgen_id_unique" UNIQUE("leadgen_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "facebook_token_status" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"is_valid" boolean NOT NULL,
	"expires_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "facebook_lead_forms" ADD CONSTRAINT "facebook_lead_forms_vacancy_id_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "facebook_lead_forms" ADD CONSTRAINT "facebook_lead_forms_default_recruiter_id_users_id_fk" FOREIGN KEY ("default_recruiter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "facebook_lead_forms_form_id_idx" ON "facebook_lead_forms" USING btree ("form_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "facebook_lead_forms_is_active_idx" ON "facebook_lead_forms" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "facebook_rejected_leads_leadgen_id_idx" ON "facebook_rejected_leads" USING btree ("leadgen_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "facebook_rejected_leads_created_at_idx" ON "facebook_rejected_leads" USING btree ("created_at");