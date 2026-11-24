/* eslint-env node */
/* eslint-disable no-undef, no-console */
// Seed test users + sample data for Playwright E2E suite.
// Idempotent: re-running upserts test users without duplicating.
// Usage: node apps/api/scripts/seed-e2e.mjs
//
// SAFETY GUARD: refuses to run unless NODE_ENV=test OR explicit opt-in via
// ALLOW_E2E_SEED=1. This is a footgun guard — the script creates 6 admin/
// recruiter/coordinator/readonly users with a password hard-coded in the
// repository (`E2E-Test-Pass-2026!`). Running it against production would
// publicly expose those credentials. CI sets NODE_ENV=test so the gate is
// transparent there; local devs running against a dev branch must either
// set NODE_ENV=test or accept the risk with ALLOW_E2E_SEED=1.

if (process.env.NODE_ENV !== 'test' && process.env.ALLOW_E2E_SEED !== '1') {
  console.error('FATAL: seed-e2e refuses to run.');
  console.error('  Reason: NODE_ENV is "' + (process.env.NODE_ENV ?? 'unset') + '" (expected "test").');
  console.error('  This script creates accounts with a password committed in the repo.');
  console.error('  To override (acknowledging the target is NOT production): ALLOW_E2E_SEED=1 node apps/api/scripts/seed-e2e.mjs');
  process.exit(1);
}

import 'dotenv/config';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

const TEST_PASSWORD = 'E2E-Test-Pass-2026!';
const TEST_USERS = [
  { email: 'e2e-admin@crm.test', firstName: 'E2E', lastName: 'Admin', role: 'admin' },
  { email: 'e2e-recruiter@crm.test', firstName: 'E2E', lastName: 'Recruiter', role: 'recruiter' },
  { email: 'e2e-recruiter2@crm.test', firstName: 'E2E', lastName: 'Recruiter2', role: 'recruiter' },
  { email: 'e2e-coordinator@crm.test', firstName: 'E2E', lastName: 'Coordinator', role: 'coordinator' },
  { email: 'e2e-coordinator2@crm.test', firstName: 'E2E', lastName: 'Coordinator2', role: 'coordinator' },
  { email: 'e2e-readonly@crm.test', firstName: 'E2E', lastName: 'Readonly', role: 'readonly' },
];

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL,
});

const userIds = {};

try {
  const hash = await bcrypt.hash(TEST_PASSWORD, 12);

  for (const u of TEST_USERS) {
    const result = await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, true, now(), now())
       ON CONFLICT (email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         first_name = EXCLUDED.first_name,
         last_name = EXCLUDED.last_name,
         role = EXCLUDED.role,
         is_active = true,
         failed_login_attempts = 0,
         locked_until = NULL,
         updated_at = now()
       RETURNING id`,
      [randomUUID(), u.email, hash, u.firstName, u.lastName, u.role]
    );
    userIds[u.email] = result.rows[0].id;
    console.log(`  ✓ ${u.role.padEnd(11)} ${u.email}`);
  }

  console.log('\nTest users seeded. Password for all:', TEST_PASSWORD);

  // Auto-accept all required documents for each test user so PendingAcceptancesModal
  // doesn't block UI navigation in E2E. Skip if document_acceptances table isn't present.
  try {
    const docs = await pool.query(
      `SELECT id, version FROM documents WHERE requires_acceptance = true AND deleted_at IS NULL AND published_at IS NOT NULL`
    );
    if (docs.rows.length) {
      let accepted = 0;
      for (const uid of Object.values(userIds)) {
        for (const d of docs.rows) {
          const r = await pool.query(
            `INSERT INTO document_acceptances (document_id, version, user_id, accepted_at)
             VALUES ($1, $2, $3, now())
             ON CONFLICT (document_id, version, user_id) DO NOTHING
             RETURNING id`,
            [d.id, d.version, uid]
          );
          if (r.rowCount) accepted++;
        }
      }
      console.log(`  ✓ Auto-accepted ${accepted} document(s) across test users`);
    } else {
      console.log('  (no required documents to auto-accept)');
    }
  } catch (e) {
    console.log(`  (could not seed acceptances: ${e.message})`);
  }

  console.log(JSON.stringify(userIds, null, 2));
} catch (err) {
  console.error('Seed failed:', err);
  process.exit(1);
} finally {
  await pool.end();
}
