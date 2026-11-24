/* eslint-env node */
/* eslint-disable no-undef, no-console */
// Delete the 6 E2E test users (e2e-*@crm.test). FK cleanup is automatic
// via the schema's ON DELETE cascade/SET NULL rules:
//   sessions, document_acceptances → cascade
//   audit_log, candidates, leads, dismissals, … → SET NULL
//
// Per project rule "Delete: audit BEFORE remove", one bulk audit_log row is
// written first, attributed to a surviving admin (NOT one of the e2e admins).
//
// Two-step usage:
//   1. node apps/api/scripts/delete-e2e-users.mjs           (dry-run, prints plan)
//   2. node apps/api/scripts/delete-e2e-users.mjs --confirm (executes in a tx)

import 'dotenv/config';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

const CONFIRM = process.argv.includes('--confirm');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL,
});

const client = await pool.connect();

async function rows(label, sql, params = []) {
  const r = await client.query(sql, params);
  console.log(`  ${label}:`, JSON.stringify(r.rows));
}

async function count(label, sql, params = []) {
  const r = await client.query(sql, params);
  console.log(`  ${label}: ${r.rows[0].count}`);
}

try {
  await client.query('BEGIN');

  console.log('\n=== E2E USERS (to delete) ===');
  await rows(
    'targets',
    `SELECT id, email, role, is_active FROM users
     WHERE email LIKE 'e2e-%@crm.test'
     ORDER BY email`,
  );

  console.log('\n=== DEPENDENCIES OWNED BY E2E USERS ===');
  await count('audit_log rows (actorId → e2e)', `
    SELECT COUNT(*) FROM audit_log
    WHERE actor_id IN (SELECT id FROM users WHERE email LIKE 'e2e-%@crm.test')`);
  await count('candidates (recruiterId → e2e)', `
    SELECT COUNT(*) FROM candidates
    WHERE recruiter_id IN (SELECT id FROM users WHERE email LIKE 'e2e-%@crm.test')`);
  await count('candidates (coordinatorId → e2e)', `
    SELECT COUNT(*) FROM candidates
    WHERE coordinator_id IN (SELECT id FROM users WHERE email LIKE 'e2e-%@crm.test')`);
  await count('leads (assignedRecruiterId → e2e)', `
    SELECT COUNT(*) FROM leads
    WHERE assigned_recruiter_id IN (SELECT id FROM users WHERE email LIKE 'e2e-%@crm.test')`);
  await count('sessions (user_id → e2e) [will cascade]', `
    SELECT COUNT(*) FROM sessions
    WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'e2e-%@crm.test')`);
  await count('document_acceptances (user_id → e2e) [will cascade]', `
    SELECT COUNT(*) FROM document_acceptances
    WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'e2e-%@crm.test')`);
  await count('invitations (invitedBy → e2e)', `
    SELECT COUNT(*) FROM invitations
    WHERE invited_by_id IN (SELECT id FROM users WHERE email LIKE 'e2e-%@crm.test')`);

  console.log('\n=== SURVIVING ADMIN ===');
  // Pick a real admin (non-e2e) as the actor for the audit log entry. If none
  // exists we ABORT — RODO requires a traceable actor for mutations.
  const adminRes = await client.query(`
    SELECT id, email FROM users
    WHERE role = 'admin' AND is_active = true
      AND email NOT LIKE 'e2e-%@crm.test'
    ORDER BY created_at ASC
    LIMIT 1`);
  if (adminRes.rows.length === 0) {
    throw new Error('SAFETY ABORT: no surviving non-e2e admin found. Refusing to delete.');
  }
  const actorId = adminRes.rows[0].id;
  console.log(`  actor for audit: ${adminRes.rows[0].email} (${actorId})`);

  if (!CONFIRM) {
    console.log('\n⚠ DRY-RUN. Re-run with --confirm to execute.');
    await client.query('ROLLBACK');
    process.exit(0);
  }

  // Fetch target IDs + emails for the audit payload (before delete).
  const targets = await client.query(`
    SELECT id, email, role FROM users
    WHERE email LIKE 'e2e-%@crm.test'
    ORDER BY email`);
  const targetCount = targets.rows.length;
  if (targetCount === 0) {
    console.log('\nℹ Nothing to delete — no e2e users present.');
    await client.query('COMMIT');
    process.exit(0);
  }

  // Per project rule: audit BEFORE remove.
  await client.query(
    `INSERT INTO audit_log (id, actor_id, action, entity_type, entity_id, old_value, new_value, ip, user_agent, created_at)
     VALUES ($1, $2, 'bulk_delete_e2e_users', 'user', NULL, $3::jsonb, NULL, NULL, 'cleanup-script', now())`,
    [
      randomUUID(),
      actorId,
      JSON.stringify({
        deletedCount: targetCount,
        deletedUsers: targets.rows.map((r) => ({ id: r.id, email: r.email, role: r.role })),
      }),
    ],
  );
  console.log(`\n  ✓ audit_log entry written (action=bulk_delete_e2e_users)`);

  console.log('\n=== DELETING ===');
  const r = await client.query(`DELETE FROM users WHERE email LIKE 'e2e-%@crm.test'`);
  console.log(`  users (e2e): ${r.rowCount}`);

  console.log('\n=== AFTER ===');
  await count('users (total)', 'SELECT COUNT(*) FROM users');
  await count('  └ admin',       `SELECT COUNT(*) FROM users WHERE role='admin'`);
  await count('e2e users remaining', `SELECT COUNT(*) FROM users WHERE email LIKE 'e2e-%@crm.test'`);

  await client.query('COMMIT');
  console.log('\n✓ Committed.');
} catch (err) {
  await client.query('ROLLBACK');
  console.error('\n✗ Rolled back. Error:', err);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
