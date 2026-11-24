import { useQuery } from '@tanstack/react-query';
import type {
  ListDismissalsQuery,
  ListEnrichedDismissalsResponse,
} from '@opushr/shared';
import { apiFetch } from '@/lib/http';

export function useDismissalRegistry(query: Partial<ListDismissalsQuery> = {}) {
  return useQuery({
    queryKey: ['dismissals', 'registry', query],
    queryFn: () =>
      apiFetch<ListEnrichedDismissalsResponse>('/dismissals/registry', {
        method: 'GET',
        query: query as Record<string, unknown>,
      }),
  });
}
