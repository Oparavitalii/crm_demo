import type { UserRole } from '@crm/shared';

/**
 * For features where recruiters should only see/edit their own records.
 * Returns a Drizzle WHERE clause modifier or true (full access).
 */
export function shouldScopeToRecruiter(role: UserRole): boolean {
  return role === 'recruiter';
}

/**
 * FAZA 20: coordinators should only see clients assigned to them. Used on
 * candidate lists where `kind = 'client'` and the coordinator is the
 * responsible party (recruiter scope still applies for `kind = 'candidate'`).
 */
export function shouldScopeToCoordinator(role: UserRole): boolean {
  return role === 'coordinator';
}

export function canManage(role: UserRole): boolean {
  return role === 'admin' || role === 'recruiter';
}

export function isAdmin(role: UserRole): boolean {
  return role === 'admin';
}
