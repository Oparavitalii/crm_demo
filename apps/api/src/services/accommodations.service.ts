import * as analyticsRepo from '../repositories/analytics.repo';
import type { HousingSummary, HousingCandidate, UserRole } from '@opushr/shared';

// The address-book module was removed; this service now serves the housing
// dashboard at /accommodations/summary. Counts and candidate lists come from
// candidates.status + candidates.housing_type — see analyticsRepo.housingCandidates.

interface Actor {
  id: string;
  role: UserRole;
}

// 2026-06-12 — own-only scoping. A recruiter sees the housing rows for
// candidates they own; a coordinator sees the rows for clients assigned to
// them. Admin / readonly see everyone. Mirrors the dashboard's behaviour
// (analytics.service.ts:getDashboard).
export async function getHousingSummary(actor: Actor): Promise<HousingSummary> {
  const scope = {
    scopeRecruiterId: actor.role === 'recruiter' ? actor.id : undefined,
    scopeCoordinatorId: actor.role === 'coordinator' ? actor.id : undefined,
  };
  const rows = await analyticsRepo.housingCandidates(scope);
  const our: HousingCandidate[] = [];
  const own: HousingCandidate[] = [];
  for (const r of rows) {
    const entry: HousingCandidate = {
      id: r.id,
      name: r.name,
      status: r.status as HousingCandidate['status'],
      updatedAt: r.updatedAt.toISOString(),
    };
    if (r.housingType === 'our') our.push(entry);
    else if (r.housingType === 'own') own.push(entry);
  }
  return {
    ourHousing: { count: our.length, candidates: our },
    ownHousing: { count: own.length, candidates: own },
  };
}
