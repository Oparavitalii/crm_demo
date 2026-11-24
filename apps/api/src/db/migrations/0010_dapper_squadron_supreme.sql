CREATE TYPE "public"."document_category" AS ENUM('regulamin', 'rodo', 'procedura', 'polityka', 'inne');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"category" "document_category" NOT NULL,
	"content_md" text,
	"file_key" text,
	"file_mime" text,
	"file_size_bytes" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"requires_acceptance" boolean DEFAULT false NOT NULL,
	"visible_to_roles" "user_role"[] DEFAULT ARRAY['admin','recruiter','coordinator','readonly']::user_role[] NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "documents_slug_unique" UNIQUE("slug"),
	CONSTRAINT "documents_content_xor" CHECK (("documents"."content_md" IS NOT NULL AND "documents"."file_key" IS NULL) OR ("documents"."content_md" IS NULL AND "documents"."file_key" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_acceptances" ADD CONSTRAINT "document_acceptances_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_acceptances" ADD CONSTRAINT "document_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_slug_idx" ON "documents" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_category_idx" ON "documents" USING btree ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_requires_acceptance_idx" ON "documents" USING btree ("requires_acceptance");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_acceptances_doc_ver_user_uniq" ON "document_acceptances" USING btree ("document_id","version","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_acceptances_user_idx" ON "document_acceptances" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_acceptances_doc_version_idx" ON "document_acceptances" USING btree ("document_id","version");