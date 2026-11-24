import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { DashboardFilters, DashboardResponse } from '@crm/shared';

export function useDashboard(filters: DashboardFilters) {
  const query: Record<string, unknown> = { preset: filters.preset };
  if (filters.preset === 'custom') {
    if (filters.from) query.from = filters.from;
    if (filters.to) query.to = filters.to;
  }
  return useQuery({
    queryKey: ['dashboard', filters],
    queryFn: () =>
      apiFetch<DashboardResponse>('/analytics/dashboard', {
        method: 'GET',
        query,
      }),
    staleTime: 60_000,
  });
}
