import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateEmployerInquiryInput,
  EmployerInquiry,
  ListEmployerInquiriesQuery,
  ListEmployerInquiriesResponse,
  UpdateEmployerInquiryInput,
} from '@crm/shared';
import { apiFetch } from '@/lib/http';

export function useEmployerInquiries(query: Partial<ListEmployerInquiriesQuery> = {}) {
  return useQuery({
    queryKey: ['employer-inquiries', 'list', query],
    queryFn: () =>
      apiFetch<ListEmployerInquiriesResponse>('/employer-inquiries', {
        method: 'GET',
        query: query as Record<string, unknown>,
      }),
  });
}

export function useEmployerInquiry(id: string | undefined) {
  return useQuery({
    queryKey: ['employer-inquiries', 'detail', id],
    queryFn: () => apiFetch<EmployerInquiry>(`/employer-inquiries/${id}`),
    enabled: !!id,
  });
}

export function useCreateEmployerInquiry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEmployerInquiryInput) =>
      apiFetch<EmployerInquiry>('/employer-inquiries', { method: 'POST', body: input }),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['employer-inquiries'] });
    },
  });
}

export function useUpdateEmployerInquiry(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateEmployerInquiryInput) =>
      apiFetch<EmployerInquiry>(`/employer-inquiries/${id}`, { method: 'PATCH', body: input }),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['employer-inquiries'] });
    },
  });
}

export function useDeleteEmployerInquiry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<null>(`/employer-inquiries/${id}`, { method: 'DELETE' }),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['employer-inquiries'] });
    },
  });
}
