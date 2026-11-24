CREATE INDEX IF NOT EXISTS "consents_withdrawn_at_idx" ON "consents" USING btree ("withdrawn_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidates_freelancer_id_idx" ON "candidates" USING btree ("freelancer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidates_consent_id_idx" ON "candidates" USING btree ("consent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_assigned_recruiter_id_idx" ON "leads" USING btree ("assigned_recruiter_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dismissals_recorded_by_id_idx" ON "dismissals" USING btree ("recorded_by_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "placements_coordinator_id_idx" ON "placements" USING btree ("coordinator_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vacancies_created_by_id_idx" ON "vacancies" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_templates_created_by_id_idx" ON "message_templates" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_template_id_idx" ON "messages" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_sent_by_id_idx" ON "messages" USING btree ("sent_by_id");