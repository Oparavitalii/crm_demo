import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateStatusLookupInput,
  StatusLookup,
  StatusLookupType,
  UpdateStatusLookupInput,
} from '@opushr/shared';
import { apiFetch } from '@/lib/http';

interface ListResponse {
  items: StatusLookup[];
}

interface UsageResponse {
  type: StatusLookupType;
  code: string;
  count: number;
}

const STALE_5MIN = 5 * 60 * 1000;

interface AllResponse {
  items: Record<string, StatusLookup[]>;
}

// Stable identity: returning a fresh `[]` from `select` on every render would
// hand each consumer a new array reference and re-run the useMemo label maps
// in CandidateList/CandidateDetailPage on every render.
const EMPTY: StatusLookup[] = [];

// Public read hook — used by any authenticated page to populate selects/badges.
//
// One shared query for the whole taxonomy; each call selects its own slice.
// CandidateList mounts nine of these and CandidateDetailPage nine more, and as
// nine separate requests each one cost a requireAuth session lookup plus its
// own pg connection — on a page that already fires ~39 requests against a pool
// of 25. The hook signature is unchanged, so no call site needed touching.
export function useStatusLookup(type: StatusLookupType) {
  return useQuery({
    queryKey: ['status-lookups', 'all'],
    queryFn: () => apiFetch<AllResponse>('/status-lookups/all'),
    staleTime: STALE_5MIN,
    select: (data) => data.items[type] ?? EMPTY,
  });
}

// Admin read hook — can include deleted rows.
export function useAdminStatusLookups(
  type: StatusLookupType,
  includeDeleted = false,
) {
  return useQuery({
    queryKey: ['status-lookups', 'admin', type, { includeDeleted }],
    queryFn: () =>
      apiFetch<ListResponse>('/admin/status-lookups', {
        method: 'GET',
        query: { type, includeDeleted },
      }),
    select: (data) => data.items,
  });
}

export function useTrashedStatusLookups() {
  return useQuery({
    queryKey: ['status-lookups', 'admin', 'trash'],
    queryFn: () => apiFetch<ListResponse>('/admin/status-lookups/trash'),
    select: (data) => data.items,
  });
}

export function useStatusLookupUsage(id: string | undefined) {
  return useQuery({
    queryKey: ['status-lookups', 'admin', 'usage', id],
    queryFn: () => apiFetch<UsageResponse>(`/admin/status-lookups/${id}/usage`),
    enabled: !!id,
  });
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['status-lookups'] });
}

export function useCreateStatusLookup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStatusLookupInput) =>
      apiFetch<StatusLookup>('/admin/status-lookups', {
        method: 'POST',
        body: input,
      }),
    meta: { errorHandled: true },
    onSuccess: () => invalidateAll(qc),
  });
}

export function useUpdateStatusLookup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateStatusLookupInput }) =>
      apiFetch<StatusLookup>(`/admin/status-lookups/${id}`, {
        method: 'PATCH',
        body: patch,
      }),
    meta: { errorHandled: true },
    onSuccess: () => invalidateAll(qc),
  });
}

export function useSoftDeleteStatusLookup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ row: StatusLookup; usageCount: number }>(
        `/admin/status-lookups/${id}`,
        { method: 'DELETE' },
      ),
    meta: { errorHandled: true },
    onSuccess: () => invalidateAll(qc),
  });
}

export function useRestoreStatusLookup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<StatusLookup>(`/admin/status-lookups/${id}/restore`, {
        method: 'POST',
      }),
    meta: { errorHandled: true },
    onSuccess: () => invalidateAll(qc),
  });
}

export function useHardDeleteStatusLookup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/admin/status-lookups/${id}/hard`, { method: 'DELETE' }),
    meta: { errorHandled: true },
    onSuccess: () => invalidateAll(qc),
  });
}

// Picks the right localized label for a code; returns the raw code if not
// found in the active list (e.g. soft-deleted lookup row).
export function pickLabel(
  items: StatusLookup[] | undefined,
  code: string | null | undefined,
  language: string,
): { label: string; missing: boolean } {
  if (!code) return { label: '', missing: false };
  const row = items?.find((r) => r.code === code);
  if (!row) return { label: code, missing: true };
  return {
    label: language === 'pl' ? row.labelPl : row.labelUa,
    missing: false,
  };
}
