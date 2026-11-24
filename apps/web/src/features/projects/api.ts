import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateProjectInput,
  ListProjectsQuery,
  ListProjectsResponse,
  Project,
  UpdateProjectInput,
} from '@opushr/shared';
import { apiFetch } from '@/lib/http';

export function useProjects(query: Partial<ListProjectsQuery> = {}) {
  return useQuery({
    queryKey: ['projects', 'list', query],
    queryFn: () =>
      apiFetch<ListProjectsResponse>('/projects', {
        method: 'GET',
        query: query as Record<string, unknown>,
      }),
    staleTime: 5 * 60 * 1000,
  });
}

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: ['projects', 'detail', id],
    queryFn: () => apiFetch<Project>(`/projects/${id}`),
    enabled: !!id,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) =>
      apiFetch<Project>('/projects', { method: 'POST', body: input }),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function useUpdateProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProjectInput) =>
      apiFetch<Project>(`/projects/${id}`, { method: 'PATCH', body: input }),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<null>(`/projects/${id}`, { method: 'DELETE' }),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}
