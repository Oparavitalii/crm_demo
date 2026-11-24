import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdminUser,
  CreateUserInput,
  CreateInvitationInput,
  CreateInvitationResponse,
  CreateUserResponse,
  ListPendingInvitationsResponse,
  ListUsersQuery,
  ListUsersResponse,
  UpdateUserInput,
  UserProfileStats,
} from '@opushr/shared';
import { apiFetch } from '@/lib/http';

export function useAdminUsers(query: Partial<ListUsersQuery>, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin-users', 'list', query],
    queryFn: () =>
      apiFetch<ListUsersResponse>('/admin/users', {
        method: 'GET',
        query: query as Record<string, unknown>,
      }),
    enabled: options?.enabled ?? true,
  });
}

export function useAdminUser(id: string | undefined) {
  return useQuery({
    queryKey: ['admin-users', 'detail', id],
    queryFn: () => apiFetch<AdminUser>(`/admin/users/${id}`),
    enabled: !!id,
  });
}

export function useCreateAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUserInput) =>
      apiFetch<CreateUserResponse>('/admin/users', { method: 'POST', body: input }),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });
}

export function useInviteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInvitationInput) =>
      apiFetch<CreateInvitationResponse>('/admin/invitations', { method: 'POST', body: input }),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });
}

export function useUpdateAdminUser(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateUserInput) =>
      apiFetch<AdminUser>(`/admin/users/${id}`, { method: 'PATCH', body: input }),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });
}

export function useResetAdminUserPassword() {
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ emailSent: boolean }>(`/admin/users/${id}/reset-password`, { method: 'POST' }),
    meta: { errorHandled: true },
  });
}

export function useForceLogoutAdminUser() {
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ sessionsDeleted: number }>(`/admin/users/${id}/force-logout`, { method: 'POST' }),
    meta: { errorHandled: true },
  });
}

export function useDeleteAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/admin/users/${id}`, { method: 'DELETE' }),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });
}

export function useResendInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch<{ userId: string; email: string; inviteUrl: string; emailSent: boolean }>(
        `/admin/users/${userId}/resend-invite`,
        { method: 'POST' },
      ),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
      void qc.invalidateQueries({ queryKey: ['admin-invitations'] });
    },
  });
}

export function useInvitations(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin-invitations', 'list'],
    queryFn: () =>
      apiFetch<ListPendingInvitationsResponse>('/admin/invitations', { method: 'GET' }),
    enabled: options?.enabled ?? true,
  });
}

export function useRevokeInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: true }>(`/admin/invitations/${id}`, { method: 'DELETE' }),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-invitations'] });
    },
  });
}

// Per-user analytics drill-down. Cached 60s — these aggregates change with
// every candidate update, but the page is a glance-tool not a live monitor.
export function useUserStats(userId: string | undefined) {
  return useQuery({
    queryKey: ['admin-users', 'stats', userId],
    queryFn: () => apiFetch<UserProfileStats>(`/admin/users/${userId}/stats`),
    enabled: !!userId,
    staleTime: 60_000,
  });
}

// External-freelancer analytics drill-down. Same response shape as
// useUserStats, different endpoint. Admin-only on the backend.
export function useFreelancerStats(freelancerId: string | undefined) {
  return useQuery({
    queryKey: ['freelancers', 'stats', freelancerId],
    queryFn: () => apiFetch<UserProfileStats>(`/freelancers/${freelancerId}/stats`),
    enabled: !!freelancerId,
    staleTime: 60_000,
  });
}

export function useResendInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ id: string; email: string; inviteUrl: string | null; emailSent: boolean }>(
        `/admin/invitations/${id}/resend`,
        { method: 'POST' },
      ),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-invitations'] });
    },
  });
}
