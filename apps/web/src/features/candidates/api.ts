import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  routes,
  type AdminSetConsentInput,
  type AdminSetConsentResponse,
  type BulkConsentRequestInput,
  type BulkConsentRequestResponse,
  type CancelCandidateInput,
  type CreateCandidateInput,
  type DismissCandidateInput,
  type EmploymentPeriod,
  type HireCandidateInput,
  type ListCandidatesQuery,
  type RehireCandidateInput,
  type SendConsentRequestResponse,
  type UpdateCandidateInput,
} from '@crm/shared';
import { api, apiFetch, downloadFile } from '@/lib/http';

export function useCandidates(
  query: Partial<ListCandidatesQuery>,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: ['candidates', 'list', query],
    queryFn: () => api(routes.candidates.list, { query: query as Record<string, unknown> }),
    enabled: options.enabled ?? true,
  });
}

export function useCandidate(id: string | undefined) {
  return useQuery({
    queryKey: ['candidates', 'detail', id],
    queryFn: () => api(routes.candidates.detail(id as string)),
    enabled: !!id,
  });
}

export function useCreateCandidate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input, force }: { input: CreateCandidateInput; force?: boolean }) =>
      api(routes.candidates.create, {
        body: input,
        ...(force ? { query: { force: 'true' } } : {}),
      }),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['candidates'] });
    },
  });
}

export function useUpdateCandidate(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateCandidateInput) =>
      api(routes.candidates.update(id), { body: input }),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['candidates'] });
    },
  });
}

// Generic update mutation — id is supplied per call. Used by list-level
// inline-edit cells where one mutation needs to cover N rows.
export function useUpdateCandidateById() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateCandidateInput }) =>
      api(routes.candidates.update(id), { body: patch }),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['candidates'] });
    },
  });
}

export function useDeleteCandidate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(routes.candidates.remove(id)),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['candidates'] });
    },
  });
}

export interface AnonymizeResult {
  alreadyAnonymized: boolean;
  anonymizedAt: string | null;
}

export function useAnonymizeCandidate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(routes.adminCandidates.anonymize(id)),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['candidates'] });
    },
  });
}

// 2026-07-14 consent actions on an EXISTING candidate. These endpoints live
// outside the typed `routes` registry (that lives in @crm/shared), so they
// call `apiFetch` directly with the shared response types. `apiFetch` keeps the
// 401-refresh-retry contract, same as `api()`. All three set
// `meta.errorHandled` — every call site attaches its own onError handler.
//
// System mints a token and emails the candidate a confirm/manage link — the
// operator never sees it, so they cannot self-approve. 400 VALIDATION with
// reason `candidate_has_no_email` when the candidate has no email address.
export function useSendConsentRequest(id: string) {
  return useMutation({
    mutationFn: () =>
      apiFetch<SendConsentRequestResponse>(`/candidates/${id}/send-consent-request`, {
        method: 'POST',
      }),
    meta: { errorHandled: true },
  });
}

// ADMIN-ONLY override: set the email/sms marketing consent directly (on or off).
// Every change is audit-logged server-side. Invalidates the candidate query so
// the freshly-computed emailConsent/smsConsent flags refresh on the card.
export function useAdminSetConsent(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AdminSetConsentInput) =>
      apiFetch<AdminSetConsentResponse>(`/candidates/${id}/admin-consent`, {
        method: 'POST',
        body: input,
      }),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['candidates'] });
    },
  });
}

// Bulk: email a confirm/manage link to many selected candidates at once
// (1..100 ids). Best-effort per recipient; candidates without an email are
// skipped and reported in the response summary.
export function useBulkConsentRequest() {
  return useMutation({
    mutationFn: (input: BulkConsentRequestInput) =>
      apiFetch<BulkConsentRequestResponse>('/candidates/consent-requests', {
        method: 'POST',
        body: input,
      }),
    meta: { errorHandled: true },
  });
}

// 2026-06-01 lifecycle mutations. Each one wraps a server-side orchestration
// (status flip + employment_periods write + audit) — the client just submits.
export function useHireCandidate(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: HireCandidateInput) =>
      api(routes.candidates.hire(id), { body: input }),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['candidates'] });
    },
  });
}

export function useRehireCandidate(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RehireCandidateInput) =>
      api(routes.candidates.rehire(id), { body: input }),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['candidates'] });
    },
  });
}

export function useDismissCandidate(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DismissCandidateInput) =>
      api(routes.candidates.dismiss(id), { body: input }),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['candidates'] });
      // 2026-06-02: dismiss endpoint now also writes to dismissals table,
      // so the retention list + per-candidate dismissals tab must refresh.
      void qc.invalidateQueries({ queryKey: ['dismissals'] });
    },
  });
}

export function useCancelCandidate(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CancelCandidateInput) =>
      api(routes.candidates.cancel(id), { body: input }),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['candidates'] });
    },
  });
}

export function useEmploymentPeriods(id: string | undefined) {
  return useQuery({
    queryKey: ['candidates', 'employment-periods', id],
    queryFn: () => api(routes.candidates.employmentPeriods(id as string)),
    enabled: !!id,
    select: (data) => data.items as (EmploymentPeriod & { projectName: string | null })[],
  });
}

// Browser save dialog for RODO JSON export. Uses downloadFile so the auth
// Bearer header is honored without round-tripping through the SPA router.
export async function downloadCandidateExport(id: string): Promise<void> {
  await downloadFile(routes.adminCandidates.exportCandidate(id).path, `candidate-${id}.json`);
}
