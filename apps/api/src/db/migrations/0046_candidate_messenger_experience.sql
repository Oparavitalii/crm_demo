-- 2026-06-12 — Add two free-text candidate fields requested by the recruiters.
--
--   * messenger   — single column holding TG/WA/Viber handle or any other
--                   messenger contact (e.g. "TG: @ivan" or "WA: +48123…").
--                   Single text column on purpose: format C was rejected in
--                   favor of one free-form field so recruiters can type
--                   whatever the candidate gave them without picking a type.
--   * experience  — free-form work-history description ("Досвід роботи").
--                   Rendered as an autosizing <Textarea> on the form, up to
--                   ~5000 chars (matches `notes` cap).
--
-- Both columns are nullable — every existing row is back-compatible (NULL =
-- "not captured yet"). No indexes — they aren't filter/search keys today.

ALTER TABLE "candidates" ADD COLUMN "messenger" text;
ALTER TABLE "candidates" ADD COLUMN "experience" text;
