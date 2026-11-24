-- Project headcount metrics for client staffing dashboard. Yana needs to see
-- per project (Adventure Works Opole, Northwind Logistics Wrocław, ...): how many people the client
-- requires (headcount_needed) and when the project starts on site (start_date).
-- The "found / missing / percent" metrics are computed on read from the
-- candidates table; only the manually entered values live here.

ALTER TABLE "projects" ADD COLUMN "headcount_needed" integer NOT NULL DEFAULT 0;
ALTER TABLE "projects" ADD COLUMN "start_date" date;
