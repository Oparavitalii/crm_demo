import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateTaskInput,
  ListTasksQuery,
  ListTasksResponse,
  Task,
  UpdateTaskInput,
} from '@crm/shared';
import { apiFetch } from '@/lib/http';

// F16 — tasks/reminders. Backend endpoints live under /tasks. Cache invalidation
// is intentionally broad (`['tasks']`) — any mutation should refresh both the
// per-candidate tab and the dashboard "Moje zadania" widget.

export function useTasks(query: Partial<ListTasksQuery>) {
  return useQuery({
    queryKey: ['tasks', 'list', query],
    queryFn: () =>
      apiFetch<ListTasksResponse>('/tasks', {
        method: 'GET',
        query: query as Record<string, unknown>,
      }),
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTaskInput) =>
      apiFetch<Task>('/tasks', { method: 'POST', body: input }),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useUpdateTask(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTaskInput) =>
      apiFetch<Task>(`/tasks/${id}`, { method: 'PATCH', body: input }),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<null>(`/tasks/${id}`, { method: 'DELETE' }),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

// Convenience wrapper — flip doneAt between null and now(). The id is passed at
// call time so a single hook instance can toggle any row in the list.
export function useToggleTaskDone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, doneAt }: { id: string; doneAt: string | null }) =>
      apiFetch<Task>(`/tasks/${id}`, {
        method: 'PATCH',
        body: { doneAt: doneAt ? null : new Date().toISOString() } as UpdateTaskInput,
      }),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

// 2026-06-02 — set status directly (new | in_work | completed | cancelled).
// Backend syncs doneAt automatically.
export function useSetTaskStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: UpdateTaskInput['status'] }) =>
      apiFetch<Task>(`/tasks/${id}`, {
        method: 'PATCH',
        body: { status } as UpdateTaskInput,
      }),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}
