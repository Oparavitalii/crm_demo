import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DuplicatesResponse,
  DuplicateEntityType,
  IgnoreDuplicateInput,
} from '@crm/shared';
import { apiFetch } from '@/lib/http';

export function useDuplicatesOf(
  entityType: DuplicateEntityType,
  id: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: ['duplicates', entityType, id],
    queryFn: () =>
      apiFetch<DuplicatesResponse>(
        `/candidates/${id}/duplicates`,
      ),
    enabled: enabled && id !== null,
  });
}

export function useMarkNotDuplicate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: IgnoreDuplicateInput) =>
      apiFetch<{ ok: true }>('/duplicates/ignore', { method: 'POST', body: input }),
    meta: { errorHandled: true },
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['duplicates', vars.entityType] });
      // Also invalidate the list — duplicate highlight may need to disappear.
      void qc.invalidateQueries({
        queryKey: ['candidates'],
      });
    },
  });
}
