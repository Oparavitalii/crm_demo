-- System actor row for machine-initiated writes.
--
-- cron/retention.ts (RODO inactivity sweep) and consents.service.ts (public
-- consent withdrawal) call anonymizeCandidate() with the synthetic actor
-- 00000000-0000-0000-0000-000000000000, and anonymizeCandidate writes that id
-- into audit_log.actor_id inside the same transaction as the scrub. The column
-- has the FK audit_log_actor_id_users_id_fk, so without a matching users row
-- the audit insert fails and the whole anonymization rolls back: the sweep and
-- the withdrawal silently do nothing on any database built from migrations
-- (fresh environments, the nightly demo reset, CI).
--
-- Existing deployments that already hold this row as data are untouched
-- (ON CONFLICT DO NOTHING). The account cannot sign in: is_active = false is
-- rejected by auth before any password check, and '!' is not a bcrypt hash.
-- Least-privilege role; the in-memory actor object carries the role the code
-- needs, this row only satisfies the foreign key.
INSERT INTO "users" ("id", "email", "password_hash", "first_name", "last_name", "role", "is_active")
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'system@system.invalid',
  '!',
  'System',
  'Actor',
  'readonly',
  false
)
ON CONFLICT DO NOTHING;
