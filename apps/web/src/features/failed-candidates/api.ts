import { useQuery } from '@tanstack/react-query';
import type { ListCandidatesQuery, ListCandidatesResponse } from '@crm/shared';
import { apiFetch } from '@/lib/http';

export function useFailedCandidates(
  query: Partial<ListCandidatesQuery> = {},
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: ['reports', 'failed-candidates', query],
    queryFn: () =>
      apiFetch<ListCandidatesResponse>('/reports/failed-candidates', {
        method: 'GET',
        query: query as Record<string, unknown>,
      }),
    enabled: options.enabled ?? true,
  });
}
