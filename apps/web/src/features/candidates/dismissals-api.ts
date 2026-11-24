import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateDismissalInput,
  Dismissal,
  ListDismissalsResponse,
  UpdateDismissalInput,
} from '@opushr/shared';
import { apiFetch } from '@/lib/http';

export function useDismissals(candidateId: string) {
  return useQuery({
    queryKey: ['dismissals', 'list', candidateId],
    queryFn: () =>
      apiFetch<ListDismissalsResponse>('/dismissals', {
        method: 'GET',
        query: { candidateId, pageSize: 100 } as Record<string, unknown>,
      }),
    enabled: !!candidateId,
  });
}

export function useCreateDismissal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDismissalInput) =>
      apiFetch<Dismissal>('/dismissals', { method: 'POST', body: input }),
    meta: { errorHandled: true },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['dismissals', 'list', vars.candidateId] });
    },
  });
}

export function useUpdateDismissal(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ patch, candidateId: _candidateId }: { patch: UpdateDismissalInput; candidateId: string }) =>
      apiFetch<Dismissal>(`/dismissals/${id}`, { method: 'PATCH', body: patch }),
    meta: { errorHandled: true },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['dismissals', 'list', vars.candidateId] });
    },
  });
}

export function useDeleteDismissal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; candidateId: string }) =>
      apiFetch<null>(`/dismissals/${id}`, { method: 'DELETE' }),
    meta: { errorHandled: true },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['dismissals', 'list', vars.candidateId] });
    },
  });
}
