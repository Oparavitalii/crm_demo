import { asc, desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { freelancers, type Freelancer } from '../db/tables/freelancers';

// Lightweight directory shape — only the fields needed to render a Select
// in the candidate list filter. Email/phone/commissionRate/notes stay
// internal to the freelancers table; no PII leakage to the picker payload.
export interface FreelancerDirectoryRow {
  id: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
}

// Returns up to `limit` freelancers, ordered: active first, then alphabetical.
// Recruiters scrolling the dropdown hit the live team before any retired
// accounts. The agency has <50 freelancers — a single fetch with a generous
// cap (default 200) covers the whole team.
export async function listDirectory(limit: number): Promise<FreelancerDirectoryRow[]> {
  return db
    .select({
      id: freelancers.id,
      firstName: freelancers.firstName,
      lastName: freelancers.lastName,
      isActive: freelancers.isActive,
    })
    .from(freelancers)
    .orderBy(desc(freelancers.isActive), asc(freelancers.firstName), asc(freelancers.lastName))
    .limit(limit);
}

// Single-row lookup by id. Returns the full row (includes email, commissionRate
// etc.) — caller decides which fields to expose. Used by the freelancer stats
// drill-down (`/analytics/freelancers/:id`).
export async function findById(id: string): Promise<Freelancer | undefined> {
  const rows = await db
    .select()
    .from(freelancers)
    .where(eq(freelancers.id, id))
    .limit(1);
  return rows[0];
}
