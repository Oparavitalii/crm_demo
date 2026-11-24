import { useQuery } from '@tanstack/react-query';
import { routes } from '@opushr/shared';
import { api } from '@/lib/http';

// Read-only directory used to populate the freelancer Select in the candidate
// list filter row. Whole team is small (~50 max) so a single fetch with the
// default cap (limit=200) covers every recruiter's needs without pagination.
// Stays cached at the TanStack level so the dropdown opens instantly after
// the first list render.
export function useFreelancers(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['freelancers', 'directory'],
    queryFn: () => api(routes.freelancers.list),
    enabled: options.enabled ?? true,
    // Names rarely change — let the cache stay warm for 5 min before refetching
    // on a stale window focus. Avoids hammering /freelancers on every nav.
    staleTime: 5 * 60 * 1000,
  });
}
