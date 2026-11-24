import { afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client';

// Tables touched by integration tests. TRUNCATE ... CASCADE wipes child
// rows in dependent tables automatically, so this list only needs the
// "anchor" tables you actually seed into. Add new entries as new test
// suites land — adding here is cheap, missing one is not.
const TABLES = [
  'audit_log',
  'employment_periods',
  'dismissals',
  'candidate_comments',
  'document_acceptances',
  'documents',
  'duplicate_ignores',
  'candidates',
  'tasks',
  'sessions',
  'invitations',
  'projects',
  'users',
];

beforeEach(async () => {
  await db.execute(
    sql.raw(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`),
  );
  // TRUNCATE users also wipes the system actor row that migration
  // 0058_system_actor_user.sql creates in every environment. Put it back so
  // each test starts from the same baseline a freshly migrated database has —
  // the retention cron and consent withdrawal write its id into audit_log.
  await db.execute(sql`
    INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_active)
    VALUES ('00000000-0000-0000-0000-000000000000', 'system@system.invalid', '!',
            'System', 'Actor', 'readonly', false)
    ON CONFLICT DO NOTHING
  `);
});

afterAll(async () => {
  // The Node-postgres pool keeps idle sockets around; close it so vitest
  // can exit cleanly instead of dangling for `idleTimeoutMillis`.
  await db.$client.end();
});
