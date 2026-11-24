CREATE TYPE "public"."employer_inquiry_source" AS ENUM('web', 'manual');--> statement-breakpoint
CREATE TYPE "public"."employer_inquiry_status" AS ENUM('new', 'contacted', 'accepted', 'rejected', 'archived');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employer_inquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_name" text NOT NULL,
	"contact_person" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"message" text NOT NULL,
	"privacy_accepted" boolean DEFAULT false NOT NULL,
	"status" "employer_inquiry_status" DEFAULT 'new' NOT NULL,
	"source" "employer_inquiry_source" DEFAULT 'web' NOT NULL,
	"assigned_to_id" uuid,
	"internal_notes" text,
	"contacted_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "employer_inquiries" ADD CONSTRAINT "employer_inquiries_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employer_inquiries_status_idx" ON "employer_inquiries" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employer_inquiries_email_idx" ON "employer_inquiries" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employer_inquiries_assigned_to_idx" ON "employer_inquiries" USING btree ("assigned_to_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employer_inquiries_created_at_idx" ON "employer_inquiries" USING btree ("created_at");