import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AcceptDocumentInput,
  CreateDocumentMdInput,
  Document,
  DocumentAcceptanceWithUser,
  ListDocumentsQuery,
  ListDocumentsResponse,
  PendingAcceptance,
  UpdateDocumentInput,
} from '@crm/shared';
import { apiFetch, downloadFile } from '@/lib/http';

// Fetches the presigned R2 URL for a document file via authenticated JSON,
// then opens it in a new tab. window.open is preferred over <a href> because
// the presigned URL is single-use within its TTL and shouldn't be cached.
export async function openDocumentFile(id: string): Promise<void> {
  const { url } = await apiFetch<{ url: string }>(`/documents/${id}/file`);
  window.open(url, '_blank', 'noopener,noreferrer');
}

export async function downloadAcceptancesCsv(documentId: string): Promise<void> {
  await downloadFile(
    `/admin/documents/${documentId}/acceptances.csv`,
    `acceptances-${documentId}.csv`,
  );
}

export function useAdminDocument(id: string | undefined) {
  return useQuery({
    queryKey: ['documents', 'admin-detail', id],
    queryFn: () => apiFetch<Document>(`/admin/documents/${id}`),
    enabled: !!id,
  });
}

export function useDocuments(query: Partial<ListDocumentsQuery> = {}) {
  return useQuery({
    queryKey: ['documents', 'list', query],
    queryFn: () =>
      apiFetch<ListDocumentsResponse>('/documents', {
        method: 'GET',
        query: query as Record<string, unknown>,
      }),
  });
}

export function useDocument(slug: string | undefined) {
  return useQuery({
    queryKey: ['documents', 'detail', slug],
    queryFn: () => apiFetch<Document>(`/documents/${slug}`),
    enabled: !!slug,
  });
}

export function usePendingAcceptances() {
  return useQuery({
    queryKey: ['documents', 'pending'],
    queryFn: () => apiFetch<{ items: PendingAcceptance[] }>('/me/pending-acceptances'),
  });
}

export function useMyAcceptances() {
  return useQuery({
    queryKey: ['documents', 'my-acceptances'],
    queryFn: () =>
      apiFetch<{
        items: Array<{
          id: string;
          documentId: string;
          documentSlug: string;
          documentTitle: string;
          version: number;
          acceptedAt: string;
          ip: string | null;
          userAgent: string | null;
        }>;
      }>('/me/acceptances'),
  });
}

export function useAcceptDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      apiFetch(`/documents/${id}/accept`, {
        method: 'POST',
        body: { version } as AcceptDocumentInput,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['documents'] });
    },
  });
}

export function useCreateMarkdownDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDocumentMdInput) =>
      apiFetch<Document>('/admin/documents/markdown', { method: 'POST', body: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['documents'] });
    },
  });
}

export function useCreateFileDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { meta: Record<string, unknown>; file: File }) => {
      const fd = new FormData();
      fd.append('meta', JSON.stringify(input.meta));
      fd.append('file', input.file);
      return apiFetch<Document>('/admin/documents/file', { method: 'POST', body: fd });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['documents'] });
    },
  });
}

export function useUpdateDocument(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateDocumentInput) =>
      apiFetch<Document>(`/admin/documents/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['documents'] });
    },
  });
}

export function usePublishDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<Document>(`/admin/documents/${id}/publish`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['documents'] });
    },
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<null>(`/admin/documents/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['documents'] });
    },
  });
}

export function useDocumentAcceptances(id: string | undefined) {
  return useQuery({
    queryKey: ['documents', 'acceptances', id],
    queryFn: () =>
      apiFetch<{ items: DocumentAcceptanceWithUser[] }>(`/admin/documents/${id}/acceptances`),
    enabled: !!id,
  });
}
