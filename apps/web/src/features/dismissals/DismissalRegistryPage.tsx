import { useMemo } from 'react';
import { Box, Button, Group, Paper, Stack, Title } from '@mantine/core';
import { DataTable } from 'mantine-datatable';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';
import { useDismissalRegistry } from './api';
import { MobileDismissalCardList } from './MobileDismissalCardList';
import { DismissalRegistryFilters } from './DismissalRegistryFilters';
import { buildDismissalColumns, DISMISSAL_ALWAYS_SHOW } from './columns';
import { useExportDismissals } from './use-export-dismissals';
import { useAuthStore } from '@/lib/auth-store';
import { useStatusLookup } from '@/features/admin-statuses/useStatusLookup';
import { useIsMobile } from '@/lib/use-is-mobile';
import { PaginationBar } from '@/components/PaginationBar';
import { ColumnVisibilityPopover } from '@/components/ColumnVisibilityPopover';
import { filterColumnsByData } from '@/lib/filter-columns-by-data';
import { useHiddenColumns } from '@/lib/use-hidden-columns';

const PAGE_SIZE = 50;
const HIDDEN_COLS_STORAGE_KEY = 'dismissalsList:hiddenColumns';

export function DismissalRegistryPage() {
  const { t, i18n } = useTranslation('operations');
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const isMobile = useIsMobile();
  const { run: exportXlsx, isExporting } = useExportDismissals();

  const { data: sourcesLookup } = useStatusLookup('sources');
  const { data: reasonLookup } = useStatusLookup('dismissal_reason');

  const [filters, setFilters] = useQueryStates(
    {
      preset: parseAsString.withDefault('all'),
      from: parseAsString,
      to: parseAsString,
      q: parseAsString.withDefault(''),
      reason: parseAsString.withDefault(''),
      reasonCode: parseAsString,
      source: parseAsString,
      projectId: parseAsString,
      recruiterId: parseAsString,
      coordinatorId: parseAsString,
      page: parseAsInteger.withDefault(1),
    },
    { history: 'replace' },
  );

  const { data, isPending } = useDismissalRegistry({
    page: filters.page,
    pageSize: PAGE_SIZE,
    q: filters.q || undefined,
    source: filters.source ?? undefined,
    reason: filters.reason || undefined,
    reasonCode: filters.reasonCode || undefined,
    projectId: filters.projectId || undefined,
    recruiterId: filters.recruiterId || undefined,
    coordinatorId: filters.coordinatorId || undefined,
    preset: (filters.preset as never) || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  const sourceLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of sourcesLookup ?? []) m.set(r.code, i18n.language === 'pl' ? r.labelPl : r.labelUa);
    return m;
  }, [sourcesLookup, i18n.language]);
  const reasonLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of reasonLookup ?? []) m.set(r.code, i18n.language === 'pl' ? r.labelPl : r.labelUa);
    return m;
  }, [reasonLookup, i18n.language]);

  const allColumns = useMemo(
    () => buildDismissalColumns(t, { sourceLabels, reasonLabels }),
    [t, sourceLabels, reasonLabels],
  );

  const { hiddenCols, toggle: toggleColumn, showAll } = useHiddenColumns(HIDDEN_COLS_STORAGE_KEY);

  // Auto-hide columns with no data on the current page (except whitelist), then
  // apply the user's manual hidden-set on top.
  const dataDrivenColumns = useMemo(
    () => filterColumnsByData(allColumns, items, DISMISSAL_ALWAYS_SHOW),
    [allColumns, items],
  );
  const columns = dataDrivenColumns.filter((c) => !hiddenCols.has(String(c.accessor)));

  return (
    <Stack>
      <Group justify="space-between" data-reveal>
        <Title order={2}>{t('dismissalsRegistry.title')}</Title>
        <Group>
          {!isMobile && (
            <ColumnVisibilityPopover
              columns={dataDrivenColumns}
              hiddenCols={hiddenCols}
              onToggle={toggleColumn}
              onShowAll={showAll}
            />
          )}
          {(role === 'admin' || role === 'coordinator') && (
            <Button
              variant="light"
              leftSection={<Download size={16} />}
              onClick={() => exportXlsx(filters)}
              loading={isExporting}
              disabled={isExporting || items.length === 0}
            >
              {t('dismissals.export', { defaultValue: 'Eksportuj Excel' })}
            </Button>
          )}
        </Group>
      </Group>

      <DismissalRegistryFilters
        value={{
          q: filters.q,
          source: filters.source,
          reason: filters.reason,
          reasonCode: filters.reasonCode,
          projectId: filters.projectId,
          recruiterId: filters.recruiterId,
          coordinatorId: filters.coordinatorId,
          preset: filters.preset,
          from: filters.from,
          to: filters.to,
        }}
        onChange={(next) => setFilters(next)}
      />

      <Paper withBorder radius="md" shadow="sm" data-reveal>
        {isMobile ? (
          <Box p="sm">
            <MobileDismissalCardList items={items} isLoading={isPending} />
          </Box>
        ) : (
          <Box style={{ overflowX: 'auto' }}>
            <DataTable
              records={items}
              columns={columns}
              fetching={isPending}
              noRecordsText={items.length > 0 ? '' : t('dismissalsRegistry.empty')}
              noRecordsIcon={<></>}
              minHeight={items.length > 0 ? undefined : 200}
              onRowClick={({ record }) => navigate(`/candidates/${record.candidateId}`)}
              highlightOnHover
              striped
              scrollAreaProps={{ type: 'auto' }}
              storeColumnsKey="dismissalsList:cols"
              defaultColumnProps={{ resizable: true, ellipsis: true }}
            />
          </Box>
        )}
        <PaginationBar
          page={filters.page}
          pageSize={PAGE_SIZE}
          total={total}
          onChange={(p) => setFilters({ page: p })}
        />
      </Paper>
    </Stack>
  );
}
