import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  MessageTemplate,
  CreateMessageTemplateInput,
  UpdateMessageTemplateInput,
  ListMessageTemplatesQuery,
  ListMessageTemplatesResponse,
  BulkSendInput,
  BulkSendResponse,
  ConsentCampaignInput,
  ConsentCampaignResponse,
  PreviewRecipientsResponse,
  CommunicationsHistoryResponse,
  CandidateStatus,
  CandidateSource,
} from '@crm/shared';
import { apiFetch } from '@/lib/http';

// ---- Templates ----

export function useTemplates(query: Partial<ListMessageTemplatesQuery> = {}) {
  return useQuery({
    queryKey: ['templates', 'list', query],
    queryFn: () =>
      apiFetch<ListMessageTemplatesResponse>('/communications/templates', {
        method: 'GET',
        query: query as Record<string, unknown>,
      }),
  });
}

export function useTemplate(id: string | undefined) {
  return useQuery({
    queryKey: ['templates', 'detail', id],
    queryFn: () => apiFetch<MessageTemplate>(`/communications/templates/${id}`),
    enabled: !!id,
  });
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMessageTemplateInput) =>
      apiFetch<MessageTemplate>('/communications/templates', {
        method: 'POST',
        body: input,
      }),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}

export function useUpdateTemplate(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateMessageTemplateInput) =>
      apiFetch<MessageTemplate>(`/communications/templates/${id}`, {
        method: 'PATCH',
        body: input,
      }),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<null>(`/communications/templates/${id}`, { method: 'DELETE' }),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}

// ---- Bulk Send ----

export function useBulkSend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BulkSendInput) =>
      apiFetch<BulkSendResponse>('/communications/send-bulk', {
        method: 'POST',
        body: input,
      }),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['comms-history'] });
    },
  });
}

// ---- Consent (re-permission) campaign ----
//
// Sends an email asking candidates who never opted in to confirm consent. The
// caller (ConsentCampaignModal) handles every error at the call site (specific
// message for the missing-{{consentConfirmUrl}} case, generic otherwise), so
// this hook opts out of the global MutationCache toast via meta.errorHandled.
export function useConsentCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ConsentCampaignInput) =>
      apiFetch<ConsentCampaignResponse>('/communications/consent-campaign', {
        method: 'POST',
        body: input,
      }),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['comms-history'] });
    },
  });
}

export function usePreviewRecipients(filters: {
  status?: CandidateStatus;
  source?: CandidateSource;
  recruiterId?: string;
}) {
  return useQuery({
    queryKey: ['comms-preview', filters],
    queryFn: () =>
      apiFetch<PreviewRecipientsResponse>('/communications/preview-recipients', {
        method: 'GET',
        query: filters as Record<string, unknown>,
      }),
    enabled: false, // Manual trigger only
  });
}

// ---- History ----

export function useCommunicationsHistory() {
  return useQuery({
    queryKey: ['comms-history'],
    queryFn: () => apiFetch<CommunicationsHistoryResponse>('/communications/history'),
  });
}
