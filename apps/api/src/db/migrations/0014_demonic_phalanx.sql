CREATE TABLE IF NOT EXISTS "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "submitted_to_vacancy_id" uuid;--> statement-breakpoint
ALTER TABLE "vacancies" ADD COLUMN "project_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "projects_name_idx" ON "projects" USING btree ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_is_active_idx" ON "projects" USING btree ("is_active");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "candidates" ADD CONSTRAINT "candidates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "candidates" ADD CONSTRAINT "candidates_submitted_to_vacancy_id_vacancies_id_fk" FOREIGN KEY ("submitted_to_vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidates_project_id_idx" ON "candidates" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidates_submitted_to_vacancy_id_idx" ON "candidates" USING btree ("submitted_to_vacancy_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vacancies_project_id_idx" ON "vacancies" USING btree ("project_id");--> statement-breakpoint
-- Seed 7 client projects (demo names). Idempotent via UNIQUE(name).
INSERT INTO "projects" ("name") VALUES
  ('Northwind Logistics Wrocław'),
  ('Contoso Foods Poznań'),
  ('Fabrikam Packaging Legnica'),
  ('Tailspin Parcel Hub Łódź'),
  ('Adventure Works Opole'),
  ('Litware Cold Store Gliwice'),
  ('Proseware Print Katowice')
ON CONFLICT ("name") DO NOTHING;