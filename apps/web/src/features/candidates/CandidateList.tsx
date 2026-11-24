import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActionIcon, Badge, Box, Button, Checkbox, Drawer, Group, Paper, Popover, ScrollArea, Select, SegmentedControl, Stack, TextInput, Title, Tooltip } from '@mantine/core';
import { DataTable, type DataTableColumn } from 'mantine-datatable';
import { Columns3, Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useNavigate } from 'react-router-dom';
import { parseAsBoolean, parseAsString, parseAsInteger, parseAsStringEnum, useQueryStates } from 'nuqs';
import { notifications } from '@mantine/notifications';
import { useCandidates, useUpdateCandidateById } from './api';
import { useFailedCandidates } from '@/features/failed-candidates/api';
import { useApiErrorMessage } from '@/lib/useApiErrorMessage';
import { HireModal } from './HireModal';
import { DismissModal } from './DismissModal';
import { CancelModal } from './CancelModal';
import { useProjects } from '@/features/projects/api';
import { useAdminUsers } from '@/features/admin-users/api';
import { useFreelancers } from '@/features/freelancers/api';
import { useAuthStore } from '@/lib/auth-store';
import { buildColumns } from './columns';
import { hiddenFieldsForRole } from './roleFieldVisibility';
import { useStatusLookup } from '@/features/admin-statuses/useStatusLookup';
import { CandidateKanban } from './CandidateKanban';
import { PaginationBar } from '@/components/PaginationBar';
import { QueryErrorState } from '@/components/QueryErrorState';
import { TableTopScrollbar } from '@/components/TableTopScrollbar';
import { useExcelStickyHeader } from '@/lib/useExcelStickyHeader';
import { DateRangeFilter, type DateRangePresetValue } from '@/components/DateRangeFilter';
import { DuplicateManagerModal } from '@/features/duplicates/DuplicateManagerModal';
import { SendToSelectedModal } from '@/features/communications/SendToSelectedModal';
import { BulkActionsBar } from './BulkActionsBar';
import { useIsMobile } from '@/lib/use-is-mobile';
import { MobileCandidateCardList } from './MobileCandidateCardList';
import {
  CANDIDATE_STATUSES,
  type Candidate,
  type CandidateSource,
  type CandidateStatus,
  type CandidateKind,
} from '@crm/shared';

// The six «work» columns from BLOCK 2 in columns.tsx — hidden by default on
// /candidates (pre-employment rows), visible on /clients and /people.
const WORK_BLOCK_COLUMNS = [
  'workStartDate',
  'workEndDate',
  'retention',
  'workOutcome',
  'workEndReason',
  'reasonNote',
] as const;

// Column builder signature — matches `buildColumns` from ./columns. Kept as an
// optional override prop; in practice every list view (candidates, clients,
// people) uses the default `buildColumns`, so the consent column etc. appear
// everywhere. Uses the generic DataTableColumn type so an alternate builder
// need not share the exact same column set.
type ColumnsBuilder = (
  t: TFunction<'candidates'>,
  opts: {
    onShowDuplicates: (c: Candidate) => void;
    duplicatesLabel: string;
    sourceLabels?: Map<string, string>;
    statusLabels?: Map<string, string>;
    positionLabels?: Map<string, string>;
    legalStatusLabels?: Map<string, string>;
    workOutcomeLabels?: Map<string, string>;
    payoutStatusLabels?: Map<string, string>;
    paymentStatusLabels?: Map<string, string>;
    retentionLabels?: Map<string, string>;
    dismissalReasonLabels?: Map<string, string>;
    onInlineUpdate?: (c: Candidate, patch: import('@crm/shared').UpdateCandidateInput) => void;
  },
) => DataTableColumn<Candidate>[];

interface CandidateListProps {
  // FAZA 19: when set, list is filtered to one kind. /candidates -> 'candidate'
  // (still excludes promoted clients); /clients -> 'client'. Undefined = both
  // (legacy behavior, kept for back-compat with existing analytics drill-downs).
  kind?: CandidateKind;
  // FAZA 19.5: optional alternate column builder. When omitted (the default for
  // ALL list views, including /clients), uses `buildColumns`.
  columnsBuilder?: ColumnsBuilder;
  // 2026-06-11: when set to 'failed-candidates' the list is fed by
  // `useFailedCandidates` (`/reports/failed-candidates`) instead of
  // `useCandidates` (`/candidates`). Same response shape, so all other UI
  // (columns, filters, kanban, mobile cards) is unchanged. Undefined keeps the
  // current /candidates and /clients behavior intact.
  reportSource?: 'failed-candidates';
  // Optional extra toolbar slot rendered before the "Колонки" popover button —
  // used by the failed-candidates page to surface its CSV export action.
  extraToolbarSlot?: ReactNode;
  // Optional title override. When omitted the title is derived from `kind`
  // (candidates vs clients) like before.
  titleOverride?: string;
}

export function CandidateList({
  kind,
  columnsBuilder,
  reportSource,
  extraToolbarSlot,
  titleOverride,
}: CandidateListProps = {}) {
  const { t, i18n } = useTranslation(['candidates', 'duplicates', 'communications']);
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [dupAnchor, setDupAnchor] = useState<Candidate | null>(null);
  const [selected, setSelected] = useState<Candidate[]>([]);
  const [sendOpen, setSendOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useQueryStates({
    q: parseAsString.withDefault(''),
    status: parseAsString.withDefault(''),
    source: parseAsString.withDefault(''),
    // 2026-06-10 Excel-import filters. position + legalStatus are lookup codes
    // (Select); reconciliationPeriod is free text (TextInput).
    position: parseAsString.withDefault(''),
    legalStatus: parseAsString.withDefault(''),
    reconciliationPeriod: parseAsString.withDefault(''),
    // 2026-07-14 — active marketing-consent filter (email / sms / any / none).
    consentStatus: parseAsString.withDefault(''),
    page: parseAsInteger.withDefault(1),
    pageSize: parseAsInteger.withDefault(20),
    view: parseAsStringEnum(['list', 'kanban']).withDefault('list'),
    preset: parseAsString.withDefault('all'),
    from: parseAsString,
    to: parseAsString,
    freelancerId: parseAsString,
    projectId: parseAsString,
    recruiterId: parseAsString,
    coordinatorId: parseAsString,
    hasEmail: parseAsBoolean,
    hasPhone: parseAsBoolean,
    duplicatesOnly: parseAsBoolean.withDefault(false),
  });

  const hasEmailBool = filters.hasEmail ?? undefined;
  const hasPhoneBool = filters.hasPhone ?? undefined;
  const duplicatesOnlyBool = filters.duplicatesOnly || undefined;

  // 2026-06-11 — both hooks return ListCandidatesResponse (same shape) so the
  // rest of this component is data-source-agnostic. Failed-candidates view
  // hits the report endpoint which already applies its own server-side filter
  // (workEndDate not null, workOutcome in ['no_show','left_early']).
  const candidateQuery = useCandidates(
    {
      q: filters.q || undefined,
      status: (filters.status as CandidateStatus) || undefined,
      // 2026-06-12: replaced the kind-driven filter with a status-bucket
      // filter. `/candidates` view passes 'candidate' → backend returns
      // rows whose status is in the first four (new, in_progress,
      // documents_submitted, cancelled). `/clients` passes 'client' →
      // last four (employed, re_employed, dismissed, blacklist). When a
      // user flips a row's status via the "Change info" Select, the row
      // hops between the two views automatically.
      //
      // 2026-06-15: when a user-specific filter (recruiterId, coordinatorId,
      // or freelancerId) is present in the URL the bucket filter is
      // suppressed — viewing one person's roster, the operator wants ALL
      // their people regardless of current status. This is what the
      // analytics drawer "Open full list" link relies on so a recruiter's
      // 9 employed + 7 dismissed candidates remain visible alongside the
      // 4 new ones.
      statusBucket:
        filters.recruiterId || filters.coordinatorId || filters.freelancerId
          ? undefined
          : kind === 'client'
            ? ('client' as const)
            : kind === 'candidate'
              ? ('candidate' as const)
              : undefined,
      source: (filters.source as CandidateSource) || undefined,
      position: filters.position || undefined,
      legalStatus: filters.legalStatus || undefined,
      reconciliationPeriod: filters.reconciliationPeriod || undefined,
      consentStatus:
        (filters.consentStatus as 'rodo' | 'email' | 'sms' | 'any' | 'none') || undefined,
      page: filters.page,
      pageSize: filters.pageSize,
      preset: (filters.preset as DateRangePresetValue) || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
      freelancerId: filters.freelancerId || undefined,
      projectId: filters.projectId || undefined,
      recruiterId: filters.recruiterId || undefined,
      coordinatorId: filters.coordinatorId || undefined,
      hasEmail: hasEmailBool,
      hasPhone: hasPhoneBool,
      duplicatesOnly: duplicatesOnlyBool,
    },
    { enabled: reportSource === undefined },
  );
  const failedQuery = useFailedCandidates(
    {
      q: filters.q || undefined,
      page: filters.page,
      pageSize: filters.pageSize,
      preset: (filters.preset as DateRangePresetValue) || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
      projectId: filters.projectId || undefined,
      recruiterId: filters.recruiterId || undefined,
    },
    { enabled: reportSource === 'failed-candidates' },
  );
  const { data, isPending, isError, refetch } =
    reportSource === 'failed-candidates' ? failedQuery : candidateQuery;

  const { data: projectsData } = useProjects({ isActive: true, pageSize: 500 });
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin';
  // 2026-07-08 — accounting fields scoped by role (see roleFieldVisibility.ts).
  // Applied to columns, the «Колонки» popover, filters and mobile cards below.
  const roleHiddenFields = useMemo(() => hiddenFieldsForRole(role), [role]);
  // pageSize capped at 100 — listUsersQuerySchema inherits common paginationSchema
  // max (100). Team is 20 users so this is more than enough.
  const { data: usersData } = useAdminUsers({ pageSize: 100 }, { enabled: isAdmin });
  // Lightweight freelancer directory — drives the Freelancer filter Select on
  // the same filter row as Recruiter. Available to all auth roles (not just
  // admin) so coordinators can also narrow by recruiting partner.
  const { data: freelancersData } = useFreelancers();

  const { data: sourcesLookup } = useStatusLookup('sources');
  const sourceLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of sourcesLookup ?? []) {
      m.set(r.code, i18n.language === 'pl' ? r.labelPl : r.labelUa);
    }
    return m;
  }, [sourcesLookup, i18n.language]);

  const { data: statusLookup } = useStatusLookup('candidate_status');
  const statusLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of statusLookup ?? []) {
      m.set(r.code, i18n.language === 'pl' ? r.labelPl : r.labelUa);
    }
    return m;
  }, [statusLookup, i18n.language]);

  // 2026-06-10 Excel-import lookups. Mirror the sourceLabels pattern — Map of
  // code → localized label. Falls back to dimmed italic raw code in columns.tsx.
  const { data: positionLookup } = useStatusLookup('position');
  const positionLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of positionLookup ?? []) {
      m.set(r.code, i18n.language === 'pl' ? r.labelPl : r.labelUa);
    }
    return m;
  }, [positionLookup, i18n.language]);

  const { data: legalStatusLookup } = useStatusLookup('legal_status');
  const legalStatusLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of legalStatusLookup ?? []) {
      m.set(r.code, i18n.language === 'pl' ? r.labelPl : r.labelUa);
    }
    return m;
  }, [legalStatusLookup, i18n.language]);

  // 2026-06-10 Block 7 reconciliation lookups — same Map(code → localized label)
  // pattern as position/legalStatus. Unknown codes render italic-dimmed in
  // columns.tsx so soft-deleted lookups don't break the row.
  const { data: workOutcomeLookup } = useStatusLookup('work_outcome');
  const workOutcomeLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of workOutcomeLookup ?? []) m.set(r.code, i18n.language === 'pl' ? r.labelPl : r.labelUa);
    return m;
  }, [workOutcomeLookup, i18n.language]);
  const { data: payoutStatusLookup } = useStatusLookup('payout_status');
  const payoutStatusLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of payoutStatusLookup ?? []) m.set(r.code, i18n.language === 'pl' ? r.labelPl : r.labelUa);
    return m;
  }, [payoutStatusLookup, i18n.language]);
  const { data: paymentStatusLookup } = useStatusLookup('payment_status');
  const paymentStatusLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of paymentStatusLookup ?? []) m.set(r.code, i18n.language === 'pl' ? r.labelPl : r.labelUa);
    return m;
  }, [paymentStatusLookup, i18n.language]);
  const { data: retentionLookup } = useStatusLookup('retention');
  const retentionLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of retentionLookup ?? []) m.set(r.code, i18n.language === 'pl' ? r.labelPl : r.labelUa);
    return m;
  }, [retentionLookup, i18n.language]);
  const { data: dismissalReasonLookup } = useStatusLookup('dismissal_reason');
  const dismissalReasonLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of dismissalReasonLookup ?? []) m.set(r.code, i18n.language === 'pl' ? r.labelPl : r.labelUa);
    return m;
  }, [dismissalReasonLookup, i18n.language]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.status) n++;
    if (filters.source) n++;
    if (filters.position) n++;
    if (filters.legalStatus) n++;
    if (filters.reconciliationPeriod) n++;
    if (filters.consentStatus) n++;
    if (filters.projectId) n++;
    if (filters.recruiterId) n++;
    if (filters.freelancerId) n++;
    if (filters.hasEmail !== null && filters.hasEmail !== undefined) n++;
    if (filters.hasPhone !== null && filters.hasPhone !== undefined) n++;
    if (filters.duplicatesOnly) n++;
    if (filters.preset && filters.preset !== 'all') n++;
    return n;
  }, [
    filters.status,
    filters.source,
    filters.position,
    filters.legalStatus,
    filters.reconciliationPeriod,
    filters.consentStatus,
    filters.projectId,
    filters.recruiterId,
    filters.freelancerId,
    filters.hasEmail,
    filters.hasPhone,
    filters.duplicatesOnly,
    filters.preset,
  ]);

  const inlineUpdate = useUpdateCandidateById();
  const apiErrorMessage = useApiErrorMessage();

  // Modal-triggering statuses can't be set via plain PATCH — they require
  // additional data (housing for hire, reason for dismiss/cancel). The inline
  // Status select hands off to the proper modal flow.
  const [hireTarget, setHireTarget] = useState<{ candidate: Candidate; mode: 'hire' | 'rehire' } | null>(null);
  const [dismissTarget, setDismissTarget] = useState<Candidate | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Candidate | null>(null);

  const onInlineUpdate = (c: Candidate, patch: import('@crm/shared').UpdateCandidateInput) => {
    // Status changes that need extra data → open the matching modal instead of
    // plain PATCH. Backend would reject these without reason/housing anyway.
    if (patch.status && patch.status !== c.status) {
      if (patch.status === 'employed') {
        setHireTarget({ candidate: c, mode: 'hire' });
        return;
      }
      if (patch.status === 're_employed') {
        setHireTarget({ candidate: c, mode: 'rehire' });
        return;
      }
      if (patch.status === 'dismissed') {
        setDismissTarget(c);
        return;
      }
      if (patch.status === 'cancelled' || patch.status === 'blacklist') {
        setCancelTarget(c);
        return;
      }
    }
    inlineUpdate.mutate(
      { id: c.id, patch },
      {
        onError: (err: unknown) => {
          notifications.show({ color: 'red', message: apiErrorMessage(err), autoClose: 8000 });
        },
      },
    );
  };

  const builder = columnsBuilder ?? buildColumns;
  const allColumns = builder(t, {
    onShowDuplicates: (c) => setDupAnchor(c),
    duplicatesLabel: t('duplicates:button'),
    sourceLabels,
    statusLabels,
    positionLabels,
    legalStatusLabels,
    workOutcomeLabels,
    payoutStatusLabels,
    paymentStatusLabels,
    retentionLabels,
    dismissalReasonLabels,
    onInlineUpdate,
  });
  // Role scoping happens BEFORE the user's own hidden-set: fields a role must
  // not see never reach the table nor the «Колонки» popover, so they can't be
  // re-enabled and need no localStorage migration.
  const roleColumns = allColumns.filter((c) => !roleHiddenFields.has(String(c.accessor)));

  // 2026-06-02: Excel-like column visibility. Hidden-set persists per kind
  // (separate storage for /candidates vs /clients so each can have its own
  // preferred view). Stored as JSON array in localStorage.
  const storageKey = `candidateList:hiddenColumns:${kind ?? 'all'}`;
  // 2026-06-11 — six work-block columns hidden by default on /candidates.
  // Detail page, kanban, mobile cards and the API are untouched; users can
  // re-enable any of these via the "Колонки" popover.
  // 2026-07-06 — /people (kind === undefined) shows the work block by default,
  // same as /clients: client asked for work dates visible right in the search
  // results. Only /candidates keeps it hidden — those rows are pre-employment,
  // the block is noise there.
  const defaultHiddenForKind = useMemo<readonly string[]>(() => {
    // 2026-06-12 — `messenger` + `experience` are new free-text columns;
    // hidden by default everywhere to keep the row height predictable.
    // Users can re-enable via "Колонки".
    const sharedHidden = ['messenger', 'experience'];
    if (kind === 'candidate') {
      return [...sharedHidden, ...WORK_BLOCK_COLUMNS];
    }
    return sharedHidden;
  }, [kind]);
  // Tracks whether the per-kind default has already been written to
  // localStorage. Without this, existing users (who already have an empty
  // hidden-set persisted) would never see the new defaults.
  const defaultsAppliedKey = `${storageKey}:defaultsApplied:v1`;
  // 2026-07-06 — one-shot unhide of the work block on /people. The v1 defaults
  // already wrote those six keys into existing users' persisted hidden-set, so
  // changing defaultHiddenForKind alone would never surface the columns for
  // them. Runs once per browser; manual hides of OTHER columns are preserved.
  const workBlockUnhideKey = `${storageKey}:workBlockUnhidden:v2`;
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set(defaultHiddenForKind);
    try {
      const alreadyApplied = window.localStorage.getItem(defaultsAppliedKey) === '1';
      const raw = window.localStorage.getItem(storageKey);
      const stored = new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
      if (!alreadyApplied) {
        for (const k of defaultHiddenForKind) stored.add(k);
        return stored;
      }
      if (kind === undefined && window.localStorage.getItem(workBlockUnhideKey) !== '1') {
        for (const k of WORK_BLOCK_COLUMNS) stored.delete(k);
      }
      return stored;
    } catch {
      return new Set(defaultHiddenForKind);
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(defaultsAppliedKey, '1');
      window.localStorage.setItem(workBlockUnhideKey, '1');
    } catch {
      // localStorage quota / sandbox — defaults will reapply next visit, harmless.
    }
  }, [defaultsAppliedKey, workBlockUnhideKey]);
  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify([...hiddenCols]));
    } catch {
      // localStorage quota or sandbox — silently degrade.
    }
  }, [hiddenCols, storageKey]);
  // 2026-07-08 — new default column order: the six key columns (project, legal
  // status, status, work dates, end reason) now sit right after the name column.
  // mantine-datatable pins the user's column order under
  // `${colsStoreKey}-columns-order`, so existing users would keep the OLD order
  // unless it's cleared once. Done in a useState initializer (runs synchronously
  // during THIS render, before the child DataTable mounts and reads the key) so
  // the new order shows on first paint. Column widths + visibility are untouched.
  // v2 — bumped after swapping the 2nd column from documentsSubmittedAt to
  // legalStatus so anyone who already ran v1 gets one more clean reset.
  useState(() => {
    if (typeof window === 'undefined') return true;
    try {
      const key = `candidateList:cols:${kind ?? 'all'}`;
      const resetFlag = `${key}:orderReset:v2`;
      if (window.localStorage.getItem(resetFlag) !== '1') {
        window.localStorage.removeItem(`${key}-columns-order`);
        window.localStorage.setItem(resetFlag, '1');
      }
    } catch {
      // localStorage quota / sandbox — order falls back to the array default.
    }
    return true;
  });
  const toggleColumn = (key: string) => {
    setHiddenCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const columns = roleColumns.filter((c) => !hiddenCols.has(String(c.accessor)));

  // mantine-datatable persists resized widths under `${storeColumnsKey}-columns-width`
  // (plus -order, -toggle). Reset clears them and reloads so DataTable re-reads
  // its initial widths. Without reload the hook keeps the in-memory cached map.
  const colsStoreKey = `candidateList:cols:${kind ?? 'all'}`;
  const resetColumnWidths = () => {
    try {
      window.localStorage.removeItem(`${colsStoreKey}-columns-width`);
      window.localStorage.removeItem(`${colsStoreKey}-columns-order`);
      window.localStorage.removeItem(`${colsStoreKey}-columns-toggle`);
    } catch {
      // localStorage quota / sandbox — nothing we can do.
    }
    window.location.reload();
  };

  // 2026-07-06 — Excel-style frozen header: the table keeps its full height
  // (the page scrolls as before), the thead is pinned below the sticky top
  // scrollbar strip while scrolling. Client explicitly rejected bounding the
  // table height to the viewport.
  // `active` mirrors the render branches below: the DataTable mounts only on
  // desktop, outside kanban view (reports have no kanban) and outside the
  // error state — the effect must re-attach whenever the table remounts.
  const tableViewportRef = useRef<HTMLDivElement | null>(null);
  const stickyHeaderActive =
    !isMobile && !isError && (filters.view !== 'kanban' || reportSource !== undefined);
  const tableRef = useExcelStickyHeader(stickyHeaderActive);

  const titleLabel =
    titleOverride ?? (kind === 'client' ? t('list.titleClients') : t('list.title'));
  const addLabel = kind === 'client' ? t('list.addClient') : t('list.add');
  // Failed-candidates is a read-only report — hide "Add" button + kanban toggle.
  const isReport = reportSource !== undefined;

  const filtersBody = (
    <Stack gap="sm">
      <Group wrap="wrap">
        <TextInput
          leftSection={<Search size={14} />}
          placeholder={t('list.search')}
          value={filters.q}
          onChange={(e) => setFilters({ q: e.currentTarget.value, page: 1 })}
          w={260}
        />
        {filters.view === 'list' && (
          <Select
            placeholder={t('list.filters.allStatuses')}
            data={CANDIDATE_STATUSES.map((s) => ({
              value: s,
              label: statusLabels.get(s) ?? t(`status.${s}`),
            }))}
            value={filters.status || null}
            onChange={(v) => setFilters({ status: v ?? '', page: 1 })}
            clearable
            w={200}
          />
        )}
        {!roleHiddenFields.has('source') && (
          <Select
            placeholder={t('list.filters.allSources')}
            data={(sourcesLookup ?? []).map((r) => ({
              value: r.code,
              label: i18n.language === 'pl' ? r.labelPl : r.labelUa,
            }))}
            value={filters.source || null}
            onChange={(v) => setFilters({ source: v ?? '', page: 1 })}
            clearable
            w={200}
          />
        )}
        <Select
          placeholder={t('list.filters.allPositions')}
          data={(positionLookup ?? []).map((r) => ({
            value: r.code,
            label: i18n.language === 'pl' ? r.labelPl : r.labelUa,
          }))}
          value={filters.position || null}
          onChange={(v) => setFilters({ position: v ?? '', page: 1 })}
          clearable
          searchable
          w={200}
        />
        <Select
          placeholder={t('list.filters.allLegalStatuses')}
          data={(legalStatusLookup ?? []).map((r) => ({
            value: r.code,
            label: i18n.language === 'pl' ? r.labelPl : r.labelUa,
          }))}
          value={filters.legalStatus || null}
          onChange={(v) => setFilters({ legalStatus: v ?? '', page: 1 })}
          clearable
          searchable
          w={200}
        />
        {!roleHiddenFields.has('reconciliationPeriod') && (
          <TextInput
            placeholder={t('list.filters.reconciliationPeriodPlaceholder')}
            value={filters.reconciliationPeriod}
            onChange={(e) => setFilters({ reconciliationPeriod: e.currentTarget.value, page: 1 })}
            w={220}
          />
        )}
        <Select
          placeholder={t('list.filters.consentAll')}
          data={[
            { value: 'rodo', label: t('list.filters.consentRodo') },
            { value: 'email', label: t('list.filters.consentEmail') },
            { value: 'sms', label: t('list.filters.consentSms') },
            { value: 'any', label: t('list.filters.consentAny') },
            { value: 'none', label: t('list.filters.consentNone') },
          ]}
          value={filters.consentStatus || null}
          onChange={(v) => setFilters({ consentStatus: v ?? '', page: 1 })}
          clearable
          w={200}
        />
        <Select
          placeholder={t('list.filters.allProjects')}
          data={(projectsData?.items ?? []).map((p) => ({ value: p.id, label: p.name }))}
          value={filters.projectId || null}
          onChange={(v) => setFilters({ projectId: v ?? null, page: 1 })}
          clearable
          searchable
          w={200}
        />
        {isAdmin && (
          <Select
            placeholder={t('list.filters.allRecruiters', { defaultValue: 'Wszyscy rekruterzy' })}
            data={(usersData?.items ?? [])
              .filter((u) => u.role === 'recruiter' || u.role === 'admin')
              .map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}`.trim() }))}
            value={filters.recruiterId || null}
            onChange={(v) => setFilters({ recruiterId: v ?? null, page: 1 })}
            clearable
            searchable
            w={200}
          />
        )}
        <Select
          placeholder={t('list.filters.freelancerAll', { defaultValue: 'Wszyscy freelancerzy' })}
          data={(freelancersData?.items ?? []).map((f) => ({
            value: f.id,
            label: `${f.firstName} ${f.lastName}`.trim(),
          }))}
          value={filters.freelancerId || null}
          onChange={(v) => setFilters({ freelancerId: v ?? null, page: 1 })}
          clearable
          searchable
          w={200}
        />
        <Select
          placeholder={t('list.filters.hasEmail')}
          data={[
            { value: 'true', label: t('list.filters.yes') },
            { value: 'false', label: t('list.filters.no') },
          ]}
          value={filters.hasEmail === null ? null : String(filters.hasEmail)}
          onChange={(v) =>
            setFilters({ hasEmail: v === null ? null : v === 'true', page: 1 })
          }
          clearable
          w={180}
        />
        <Select
          placeholder={t('list.filters.hasPhone')}
          data={[
            { value: 'true', label: t('list.filters.yes') },
            { value: 'false', label: t('list.filters.no') },
          ]}
          value={filters.hasPhone === null ? null : String(filters.hasPhone)}
          onChange={(v) =>
            setFilters({ hasPhone: v === null ? null : v === 'true', page: 1 })
          }
          clearable
          w={180}
        />
        <Checkbox
          label={t('list.filters.duplicatesOnly')}
          checked={filters.duplicatesOnly}
          onChange={(e) =>
            setFilters({ duplicatesOnly: e.currentTarget.checked, page: 1 })
          }
        />
      </Group>
      <DateRangeFilter
        preset={filters.preset}
        from={filters.from}
        to={filters.to}
        onChange={(next) =>
          setFilters({
            preset: next.preset,
            from: next.from,
            to: next.to,
            page: 1,
          })
        }
      />
    </Stack>
  );

  const projectName = filters.projectId
    ? projectsData?.items.find((p) => p.id === filters.projectId)?.name ?? filters.projectId
    : null;
  const recruiter = filters.recruiterId
    ? usersData?.items.find((u) => u.id === filters.recruiterId)
    : null;
  const recruiterName = recruiter
    ? `${recruiter.firstName} ${recruiter.lastName}`.trim()
    : filters.recruiterId ?? null;
  const freelancer = filters.freelancerId
    ? freelancersData?.items.find((f) => f.id === filters.freelancerId)
    : null;
  const freelancerName = freelancer
    ? `${freelancer.firstName} ${freelancer.lastName}`.trim()
    : filters.freelancerId ?? null;

  const consentStatusLabels: Record<string, string> = {
    rodo: t('list.filters.consentRodo'),
    email: t('list.filters.consentEmail'),
    sms: t('list.filters.consentSms'),
    any: t('list.filters.consentAny'),
    none: t('list.filters.consentNone'),
  };

  type ActiveChip = { key: string; label: string; clear: () => void };
  const activeChips: ActiveChip[] = [
    filters.status
      ? {
          key: 'status',
          label: statusLabels.get(filters.status) ?? filters.status,
          clear: () => {
            void setFilters({ status: '', page: 1 });
          },
        }
      : null,
    filters.source
      ? {
          key: 'source',
          label: sourceLabels.get(filters.source) ?? filters.source,
          clear: () => {
            void setFilters({ source: '', page: 1 });
          },
        }
      : null,
    filters.position
      ? {
          key: 'position',
          label: positionLabels.get(filters.position) ?? filters.position,
          clear: () => {
            void setFilters({ position: '', page: 1 });
          },
        }
      : null,
    filters.legalStatus
      ? {
          key: 'legalStatus',
          label: legalStatusLabels.get(filters.legalStatus) ?? filters.legalStatus,
          clear: () => {
            void setFilters({ legalStatus: '', page: 1 });
          },
        }
      : null,
    filters.reconciliationPeriod
      ? {
          key: 'reconciliationPeriod',
          label: filters.reconciliationPeriod,
          clear: () => {
            void setFilters({ reconciliationPeriod: '', page: 1 });
          },
        }
      : null,
    filters.consentStatus
      ? {
          key: 'consentStatus',
          label: consentStatusLabels[filters.consentStatus] ?? filters.consentStatus,
          clear: () => {
            void setFilters({ consentStatus: '', page: 1 });
          },
        }
      : null,
    filters.projectId && projectName
      ? {
          key: 'project',
          label: projectName,
          clear: () => {
            void setFilters({ projectId: null, page: 1 });
          },
        }
      : null,
    filters.recruiterId && recruiterName
      ? {
          key: 'recruiter',
          label: recruiterName,
          clear: () => {
            void setFilters({ recruiterId: null, page: 1 });
          },
        }
      : null,
    filters.freelancerId && freelancerName
      ? {
          key: 'freelancer',
          label: freelancerName,
          clear: () => {
            void setFilters({ freelancerId: null, page: 1 });
          },
        }
      : null,
    filters.hasEmail !== null && filters.hasEmail !== undefined
      ? {
          key: 'hasEmail',
          label: `${t('list.filters.hasEmail')}: ${filters.hasEmail ? t('list.filters.yes') : t('list.filters.no')}`,
          clear: () => {
            void setFilters({ hasEmail: null, page: 1 });
          },
        }
      : null,
    filters.hasPhone !== null && filters.hasPhone !== undefined
      ? {
          key: 'hasPhone',
          label: `${t('list.filters.hasPhone')}: ${filters.hasPhone ? t('list.filters.yes') : t('list.filters.no')}`,
          clear: () => {
            void setFilters({ hasPhone: null, page: 1 });
          },
        }
      : null,
    filters.duplicatesOnly
      ? {
          key: 'duplicatesOnly',
          label: t('list.filters.duplicatesOnly'),
          clear: () => {
            void setFilters({ duplicatesOnly: false, page: 1 });
          },
        }
      : null,
    filters.preset && filters.preset !== 'all'
      ? {
          key: 'preset',
          label: filters.preset,
          clear: () => {
            void setFilters({ preset: 'all', from: null, to: null, page: 1 });
          },
        }
      : null,
  ].filter((c): c is ActiveChip => c !== null);

  return (
    <Stack>
      <Group justify="space-between" data-reveal>
        <Title order={2}>{titleLabel}</Title>
        <Group>
          <BulkActionsBar
            selected={selected}
            onEmailClick={() => setSendOpen(true)}
            onAfterBulkOp={() => setSelected([])}
            onClear={() => setSelected([])}
          />
          {!isReport && (
            <Box visibleFrom="md">
              <SegmentedControl
                value={filters.view}
                onChange={(v) => setFilters({ view: v as 'list' | 'kanban' })}
                data={[
                  { value: 'list', label: t('list.viewToggle.list') },
                  { value: 'kanban', label: t('list.viewToggle.kanban') },
                ]}
              />
            </Box>
          )}
          {extraToolbarSlot}
          {filters.view === 'list' && (
            <Box visibleFrom="md">
            <Popover position="bottom-end" shadow="md" withinPortal>
              <Popover.Target>
                <Tooltip label={t('list.columns', { defaultValue: 'Колонки' })}>
                  <ActionIcon variant="default" size="lg" aria-label="columns">
                    <Columns3 size={18} />
                  </ActionIcon>
                </Tooltip>
              </Popover.Target>
              <Popover.Dropdown p="sm">
                <Stack gap={6}>
                  {roleColumns.map((col) => {
                    const key = String(col.accessor);
                    const title =
                      typeof col.title === 'string'
                        ? col.title
                        : (col.title as React.ReactNode) ?? key;
                    return (
                      <Checkbox
                        key={key}
                        label={title}
                        checked={!hiddenCols.has(key)}
                        onChange={() => toggleColumn(key)}
                      />
                    );
                  })}
                  {hiddenCols.size > 0 && (
                    <Button size="compact-xs" variant="subtle" onClick={() => setHiddenCols(new Set())}>
                      {t('list.showAllColumns', { defaultValue: 'Показати всі' })}
                    </Button>
                  )}
                  <Button size="compact-xs" variant="subtle" color="gray" onClick={resetColumnWidths}>
                    {t('list.resetColumnWidths', { defaultValue: 'Скинути ширину колонок' })}
                  </Button>
                </Stack>
              </Popover.Dropdown>
            </Popover>
            </Box>
          )}
          {!isReport && (
            <Button leftSection={<Plus size={16} />} onClick={() => navigate('/candidates/new')}>
              {addLabel}
            </Button>
          )}
        </Group>
      </Group>
      <Paper withBorder radius="md" p="md" shadow="xs" data-reveal>
        {isMobile ? (
          <Stack gap="sm">
            <Group wrap="nowrap">
              <TextInput
                leftSection={<Search size={14} />}
                placeholder={t('list.search')}
                value={filters.q}
                onChange={(e) => setFilters({ q: e.currentTarget.value, page: 1 })}
                style={{ flex: 1 }}
              />
              <Button
                variant="default"
                leftSection={<SlidersHorizontal size={16} />}
                onClick={() => setFiltersOpen(true)}
              >
                {t('list.filters.openButton', { defaultValue: 'Filtry' })}
                {activeFilterCount > 0 && (
                  <Badge size="xs" color="brand" ml={6}>
                    {activeFilterCount}
                  </Badge>
                )}
              </Button>
            </Group>
            {activeChips.length > 0 && (
              <ScrollArea type="never" scrollbarSize={0} style={{ maxWidth: '100%' }}>
                <Group gap="xs" wrap="nowrap" pt="xs">
                  {activeChips.map((chip) => (
                    <Badge
                      key={chip.key}
                      variant="light"
                      rightSection={
                        <ActionIcon size="xs" variant="transparent" onClick={chip.clear}>
                          <X size={10} />
                        </ActionIcon>
                      }
                    >
                      {chip.label}
                    </Badge>
                  ))}
                </Group>
              </ScrollArea>
            )}
          </Stack>
        ) : (
          filtersBody
        )}
      </Paper>
      <Drawer
        opened={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        position="bottom"
        title={t('list.filters.drawerTitle', { defaultValue: 'Filtry' })}
        size="85%"
        styles={{ body: { paddingBottom: 'calc(var(--mantine-spacing-md) + env(safe-area-inset-bottom))' } }}
      >
        {filtersBody}
        <Group grow mt="md">
          <Button
            variant="default"
            onClick={() => {
              setFilters({
                status: '',
                source: '',
                position: '',
                legalStatus: '',
                reconciliationPeriod: '',
                consentStatus: '',
                projectId: null,
                recruiterId: null,
                freelancerId: null,
                hasEmail: null,
                hasPhone: null,
                duplicatesOnly: false,
                preset: 'all',
                from: null,
                to: null,
                page: 1,
              });
            }}
          >
            {t('list.filters.clearAll', { defaultValue: 'Wyczyść' })}
          </Button>
          <Button onClick={() => setFiltersOpen(false)}>
            {t('list.filters.apply', { defaultValue: 'Zastosuj' })}
          </Button>
        </Group>
      </Drawer>
      {filters.view === 'kanban' && !isReport ? (
        <CandidateKanban />
      ) : isError ? (
        // Failed load must NOT look like an empty roster — show why + retry.
        <Paper withBorder radius="md" shadow="sm" data-reveal>
          <QueryErrorState
            message={t('errors.loadFailed')}
            retryLabel={t('errors.retry')}
            onRetry={() => void refetch()}
          />
        </Paper>
      ) : (
        <Paper withBorder radius="md" shadow="sm" data-reveal>
          {isMobile ? (
            <Box p="sm">
              <MobileCandidateCardList
                items={data?.items ?? []}
                isLoading={isPending}
                sourceLabels={sourceLabels}
                statusLabels={statusLabels}
                workOutcomeLabels={workOutcomeLabels}
                payoutStatusLabels={payoutStatusLabels}
                paymentStatusLabels={paymentStatusLabels}
                retentionLabels={retentionLabels}
                hiddenFields={roleHiddenFields}
                selected={selected}
                onSelectedChange={setSelected}
              />
            </Box>
          ) : (
            <Box>
              <TableTopScrollbar viewportRef={tableViewportRef} />
              <DataTable
                records={data?.items ?? []}
                columns={columns}
                fetching={isPending}
                noRecordsText={data?.items && data.items.length > 0 ? '' : t('list.empty')}
                noRecordsIcon={<></>}
                minHeight={data?.items && data.items.length > 0 ? undefined : 200}
                tableRef={(instance) => {
                  tableRef.current = instance;
                }}
                onRowClick={({ record }) => navigate(`/candidates/${record.id}`)}
                highlightOnHover
                striped
                scrollViewportRef={tableViewportRef}
                scrollAreaProps={{ type: 'auto' }}
                selectedRecords={selected}
                onSelectedRecordsChange={setSelected}
                storeColumnsKey={colsStoreKey}
                defaultColumnProps={{ resizable: true, ellipsis: true }}
              />
            </Box>
          )}
          <PaginationBar
            page={filters.page}
            pageSize={filters.pageSize}
            total={data?.total ?? 0}
            onChange={(p) => setFilters({ page: p })}
          />
        </Paper>
      )}
      <DuplicateManagerModal
        opened={dupAnchor !== null}
        onClose={() => setDupAnchor(null)}
        entityType="candidate"
        anchorId={dupAnchor?.id ?? null}
        anchorName={dupAnchor?.name ?? ''}
      />
      <SendToSelectedModal
        opened={sendOpen}
        onClose={() => {
          setSendOpen(false);
          setSelected([]);
        }}
        entityType="candidate"
        recipientIds={selected.map((c) => c.id)}
      />
      {hireTarget && (
        <HireModal
          opened
          onClose={() => setHireTarget(null)}
          candidateId={hireTarget.candidate.id}
          mode={hireTarget.mode}
        />
      )}
      {dismissTarget && (
        <DismissModal
          opened
          onClose={() => setDismissTarget(null)}
          candidateId={dismissTarget.id}
        />
      )}
      {cancelTarget && (
        <CancelModal
          opened
          onClose={() => setCancelTarget(null)}
          candidateId={cancelTarget.id}
        />
      )}
    </Stack>
  );
}
