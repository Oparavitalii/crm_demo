import { useQuery } from '@tanstack/react-query';
import type {
  ListAuditLogQuery,
  ListAuditLogResponse,
  ListConsentHistoryQuery,
  ListConsentHistoryResponse,
} from '@crm/shared';
import { apiFetch } from '@/lib/http';

export function useAuditLog(query: Partial<ListAuditLogQuery>) {
  return useQuery({
    queryKey: ['audit-log', 'list', query],
    queryFn: () =>
      apiFetch<ListAuditLogResponse>('/admin/audit-log', {
        method: 'GET',
        query: query as Record<string, unknown>,
      }),
    staleTime: 10_000,
  });
}

export function useConsentHistory(query: Partial<ListConsentHistoryQuery>) {
  return useQuery({
    queryKey: ['audit-log', 'consents', query],
    queryFn: () =>
      apiFetch<ListConsentHistoryResponse>('/admin/audit-log/consents', {
        method: 'GET',
        query: query as Record<string, unknown>,
      }),
    staleTime: 10_000,
  });
}
