/* eslint-env node */
/* eslint-disable no-undef, no-console */
// Seed projects + candidates for the Playwright E2E suite.
// Idempotent: re-running upserts deterministically (no duplicates).
// Requires `seed-e2e.mjs` to have been run first (test users must exist).
//
// Usage: node apps/api/scripts/seed-e2e-data.mjs
//
// SAFETY GUARD: mirrors seed-e2e.mjs — refuses to run unless NODE_ENV=test
// OR ALLOW_E2E_SEED=1. This script inserts deterministic test rows that
// would pollute production data with sentinel UUIDs derived from
// "candidate:test-candidate-XX" slugs; harmless in isolation, but if the
// guard is missing here while it's on seed-e2e.mjs, the asymmetric gate
// is the worst kind (one script protected, the other not).

if (process.env.NODE_ENV !== 'test' && process.env.ALLOW_E2E_SEED !== '1') {
  console.error('FATAL: seed-e2e-data refuses to run.');
  console.error('  Reason: NODE_ENV is "' + (process.env.NODE_ENV ?? 'unset') + '" (expected "test").');
  console.error('  To override (acknowledging the target is NOT production): ALLOW_E2E_SEED=1 node apps/api/scripts/seed-e2e-data.mjs');
  process.exit(1);
}

import 'dotenv/config';
import { Pool } from 'pg';
import { createHash } from 'node:crypto';

// Deterministic UUID v4 derived from a slug. SHA-1 the slug, slice 32 hex chars,
// stamp version (4) + variant (8/9/a/b) nibbles, and hyphenate. Lets us insert
// stable IDs without storing a manual map.
function deterministicUuid(seed) {
  const h = createHash('sha1').update(seed).digest('hex').slice(0, 32);
  const v = '4' + h.slice(13, 16);
  const variantNibble = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  const r = variantNibble + h.slice(17, 20);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${v}-${r}-${h.slice(20, 32)}`;
}

// 8 projects (admin.spec.ts asserts ≥ 7) — first 7 are canonical names matched
// by the regex `northwind|contoso|fabrikam|tailspin|adventure|litware|proseware`. The 8th is
// an explicitly closed project so list/filter UIs have at least one is_active=false row.
const PROJECTS = [
  { name: 'Northwind Logistics Wrocław',  isActive: true,  headcountNeeded: 12, startDate: '2026-01-15' },
  { name: 'Contoso Foods Poznań',          isActive: true,  headcountNeeded: 8,  startDate: '2026-02-01' },
  { name: 'Fabrikam Packaging Legnica',          isActive: true,  headcountNeeded: 6,  startDate: '2026-03-10' },
  { name: 'Tailspin Parcel Hub Łódź',          isActive: true,  headcountNeeded: 10, startDate: '2026-03-20' },
  { name: 'Adventure Works Opole',       isActive: true,  headcountNeeded: 20, startDate: '2026-04-01' },
  { name: 'Litware Cold Store Gliwice',         isActive: true,  headcountNeeded: 5,  startDate: '2026-04-15' },
  { name: 'Proseware Print Katowice',        isActive: true,  headcountNeeded: 15, startDate: '2026-05-01' },
  { name: 'E2E-Closed-Proj', isActive: false, headcountNeeded: 0,  startDate: null },
];

// Candidate fixtures — names are explicitly ANON-able and avoid PII strings.
// Statuses chosen to cover: ui-flows.spec.ts status-transition starts, rodo.spec.ts
// (needs a non-anonymized candidate), rbac.recruiter.spec.ts (recruiter scope).
// Assignment to recruiter is resolved at run time from users table.
const CANDIDATES = [
  // Assigned to e2e-recruiter so RBAC recruiter scope returns at least one row.
  { slug: 'e2e-cand-01', name: 'Test Candidate 01', status: 'new',                kind: 'candidate', source: 'website',  project: 'Northwind Logistics Wrocław', recruiter: 'e2e-recruiter@opushr.test' },
  { slug: 'e2e-cand-02', name: 'Test Candidate 02', status: 'in_progress',        kind: 'candidate', source: 'workua',   project: 'Contoso Foods Poznań',        recruiter: 'e2e-recruiter@opushr.test' },
  { slug: 'e2e-cand-03', name: 'Test Candidate 03', status: 'documents_submitted',kind: 'candidate', source: 'facebook', project: 'Adventure Works Opole',     recruiter: 'e2e-recruiter@opushr.test' },
  // Unassigned + later-stage statuses (recruiter scope: recruiterId IS NULL also visible)
  { slug: 'e2e-cand-04', name: 'Test Candidate 04', status: 'employed',           kind: 'client',    source: 'referral', project: 'Litware Cold Store Gliwice',       recruiter: null },
  { slug: 'e2e-cand-05', name: 'Test Candidate 05', status: 're_employed',        kind: 'client',    source: 'website',  project: 'Proseware Print Katowice',      recruiter: null },
  { slug: 'e2e-cand-06', name: 'Test Candidate 06', status: 'dismissed',          kind: 'client',    source: 'flagma',   project: 'Fabrikam Packaging Legnica',        recruiter: null,
    workEndReason: 'employee_resigned', reasonNote: 'E2E seed dismissed candidate' },
];

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL,
});

try {
  // 1. Verify required test users exist (created by seed-e2e.mjs).
  const requiredEmails = ['e2e-admin@opushr.test', 'e2e-recruiter@opushr.test'];
  const userLookup = await pool.query(
    `SELECT id, email FROM users WHERE email = ANY($1)`,
    [requiredEmails],
  );
  const userIdByEmail = Object.fromEntries(userLookup.rows.map((r) => [r.email, r.id]));
  const missing = requiredEmails.filter((e) => !userIdByEmail[e]);
  if (missing.length) {
    console.error(
      `Missing required test users: ${missing.join(', ')}\n` +
        `Run \`node apps/api/scripts/seed-e2e.mjs\` first to seed test users.`,
    );
    process.exit(1);
  }

  // 2. Upsert projects. Stable IDs via deterministicUuid(slug) so re-runs are idempotent
  // both by id and by the unique projects_name_idx.
  const projectIdByName = {};
  for (const p of PROJECTS) {
    const id = deterministicUuid(`project:${p.name}`);
    const result = await pool.query(
      `INSERT INTO projects (id, name, is_active, headcount_needed, start_date, headcount_reset_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, now(), now(), now())
       ON CONFLICT (name) DO UPDATE SET
         is_active = EXCLUDED.is_active,
         headcount_needed = EXCLUDED.headcount_needed,
         start_date = EXCLUDED.start_date,
         updated_at = now()
       RETURNING id, name`,
      [id, p.name, p.isActive, p.headcountNeeded, p.startDate],
    );
    projectIdByName[p.name] = result.rows[0].id;
    console.log(`  ✓ project: ${p.name}${p.isActive ? '' : ' (closed)'}`);
  }

  // 3. Upsert candidates. There is no natural unique key on candidates other
  // than the primary id (email/phone have plain indexes, not UNIQUE), so we
  // pin the id from a deterministic slug and ON CONFLICT (id) UPDATE.
  // 'unknown' source / placeholder e2e-cand-NN@opushr.test emails are intentional
  // — these are test fixtures, not real PII.
  let candCount = 0;
  for (const c of CANDIDATES) {
    const id = deterministicUuid(`candidate:${c.slug}`);
    const recruiterId = c.recruiter ? userIdByEmail[c.recruiter] ?? null : null;
    const projectId = projectIdByName[c.project] ?? null;
    const email = `${c.slug}@opushr.test`;
    // Deterministic phone derived from slug so re-runs don't drift.
    const phoneTail = createHash('sha1').update(c.slug).digest('hex').slice(0, 9);
    const phone = `+48${parseInt(phoneTail, 16).toString().padStart(9, '0').slice(0, 9)}`;

    await pool.query(
      `INSERT INTO candidates (
         id, name, email, phone, status, kind, source,
         project_id, recruiter_id, work_end_reason, reason_note,
         created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         email = EXCLUDED.email,
         phone = EXCLUDED.phone,
         status = EXCLUDED.status,
         kind = EXCLUDED.kind,
         source = EXCLUDED.source,
         project_id = EXCLUDED.project_id,
         recruiter_id = EXCLUDED.recruiter_id,
         work_end_reason = EXCLUDED.work_end_reason,
         reason_note = EXCLUDED.reason_note,
         updated_at = now()`,
      [
        id,
        c.name,
        email,
        phone,
        c.status,
        c.kind,
        c.source,
        projectId,
        recruiterId,
        c.workEndReason ?? null,
        c.reasonNote ?? null,
      ],
    );
    candCount++;
    const assignee = c.recruiter ?? 'unassigned';
    console.log(`  ✓ candidate: ${c.name.padEnd(20)} status=${c.status.padEnd(20)} recruiter=${assignee}`);
  }

  console.log(`\nSeeded ${PROJECTS.length} projects, ${candCount} candidates.`);
} catch (err) {
  console.error('Seed-e2e-data failed:', err);
  process.exit(1);
} finally {
  await pool.end();
}
