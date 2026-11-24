import { useQuery } from '@tanstack/react-query';
import type { HousingSummary } from '@opushr/shared';
import { apiFetch } from '@/lib/http';

export function useHousingSummary() {
  return useQuery({
    queryKey: ['accommodations', 'summary'],
    queryFn: () =>
      apiFetch<HousingSummary>('/accommodations/summary', { method: 'GET' }),
  });
}
