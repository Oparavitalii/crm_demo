import { useQuery } from '@tanstack/react-query';
import type { DirectoryQuery, ListDirectoryResponse } from '@crm/shared';
import { apiFetch } from '@/lib/http';

// Lightweight read-only directory of users (id+name+role+isActive). Auth required
// but no admin gate — recruiters use this to pick a coordinator at promotion.
// Pass `includeInactive: true` to include deactivated users in the response
// (used by the candidate form so admins can reassign to an inactive owner).
export function useDirectoryUsers(query: Partial<DirectoryQuery> = {}) {
  return useQuery({
    queryKey: ['users-directory', query],
    queryFn: () =>
      apiFetch<ListDirectoryResponse>('/users-directory', {
        method: 'GET',
        query: query as Record<string, unknown>,
      }),
    staleTime: 5 * 60 * 1000,
  });
}
