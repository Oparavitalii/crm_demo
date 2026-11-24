import { Fragment, useState } from 'react';
import { ActionIcon, Box, Group, Paper, Stack, Table, Text, Title } from '@mantine/core';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RetentionCategoryChild, RetentionCategoryItem } from '@crm/shared';
import { pickLabel, useStatusLookup } from '@/features/admin-statuses/useStatusLookup';
import { DaysAvgValue, DaysTotalValue, pct, rateColor } from './kpi-helpers';
import { SortableTh, sortRows, useColumnSort } from './SortableTh';

interface Props {
  title: string;
  hint: string;
  data: RetentionCategoryItem[] | undefined;
  // Maps a category key ('staff' / 'social' / ...) to a localized label.
  categoryLabel: (key: string) => string;
}

type SortKey =
  | 'employed'
  | 'working'
  | 'dismissed'
  | 'avgFinished'
  | 'avgWorking'
  | 'avgAll'
  | 'totalDays'
  | 'rate';

// Shared value getters for both category rows and children — a rate on an
// empty row sorts as null (always last) rather than as a misleading 0%.
type MetricRow = Pick<
  RetentionCategoryChild,
  | 'employedInPeriod'
  | 'workingCount'
  | 'dismissedCount'
  | 'avgDaysFinished'
  | 'avgDaysWorking'
  | 'avgDaysAll'
  | 'totalDaysInPeriod'
  | 'retentionRate'
>;
const SORT_GETTERS: Record<SortKey, (r: MetricRow) => number | null> = {
  employed: (r) => r.employedInPeriod ?? 0,
  working: (r) => r.workingCount,
  dismissed: (r) => r.dismissedCount,
  avgFinished: (r) => r.avgDaysFinished ?? null,
  avgWorking: (r) => r.avgDaysWorking ?? null,
  avgAll: (r) => r.avgDaysAll ?? null,
  totalDays: (r) => r.totalDaysInPeriod ?? 0,
  rate: (r) => (r.workingCount + r.dismissedCount === 0 ? null : r.retentionRate),
};

// Generic expandable retention table — rendered once per orthogonal view
// (by recruiter type, by acquisition channel). Category totals come from the
// backend; source-based child labels are localized via status_lookups.
export function RetentionCategoryTable({ title, hint, data, categoryLabel }: Props) {
  const { t, i18n } = useTranslation('dashboard');
  const { data: sourceLookup } = useStatusLookup('sources');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const { sort, toggle } = useColumnSort<SortKey>();

  const rows = sortRows(data ?? [], sort, SORT_GETTERS);
  const th = (key: SortKey, label: string) => (
    <SortableTh label={label} active={sort?.col === key ? sort.dir : null} onSort={() => toggle(key)} />
  );

  const childLabel = (c: RetentionCategoryChild): string => {
    if (c.code) {
      const { label, missing } = pickLabel(sourceLookup, c.code, i18n.language);
      if (!missing) return label;
      return c.label || c.code;
    }
    return c.label || t('retention.unknownSource');
  };

  return (
    <Paper withBorder p="lg" radius="md" shadow="sm" data-reveal>
      <Stack gap="xs">
        <Title order={4}>{title}</Title>
        <Text c="dimmed" size="xs">{hint}</Text>
        <Table.ScrollContainer minWidth={1000}>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('retentionCat.category')}</Table.Th>
              {th('employed', t('retentionCat.employed'))}
              {th('working', t('retention.working'))}
              {th('dismissed', t('retention.dismissed'))}
              {th('avgFinished', t('retentionCat.avgDaysFinished'))}
              {th('avgWorking', t('retentionCat.avgDaysWorking'))}
              {th('avgAll', t('retentionCat.avgDaysAll'))}
              {th('totalDays', t('retentionCat.totalDays'))}
              {th('rate', t('retention.rate'))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((cat) => {
              const total = cat.workingCount + cat.dismissedCount;
              // Expand only when there's more than one position to reveal.
              const canExpand = cat.children.length > 1;
              const isOpen = canExpand && (expanded[cat.key] ?? false);
              return (
                <Fragment key={cat.key}>
                  <Table.Tr
                    style={{ cursor: canExpand ? 'pointer' : undefined }}
                    onClick={
                      canExpand ? () => setExpanded((s) => ({ ...s, [cat.key]: !isOpen })) : undefined
                    }
                  >
                    <Table.Td>
                      <Group gap="xs" wrap="nowrap">
                        {canExpand ? (
                          <ActionIcon variant="subtle" size="sm" color="gray" aria-label="expand">
                            {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </ActionIcon>
                        ) : (
                          <Box w={22} />
                        )}
                        <Text fw={600} c={total === 0 ? 'dimmed' : undefined}>
                          {categoryLabel(cat.key)}
                        </Text>
                      </Group>
                    </Table.Td>
                    <Table.Td ta="right">{cat.employedInPeriod ?? 0}</Table.Td>
                    <Table.Td ta="right">{cat.workingCount}</Table.Td>
                    <Table.Td ta="right">{cat.dismissedCount}</Table.Td>
                    <Table.Td ta="right">
                      <DaysAvgValue value={cat.avgDaysFinished} count={cat.avgDaysFinishedCnt} size="md" />
                    </Table.Td>
                    <Table.Td ta="right">
                      <DaysAvgValue value={cat.avgDaysWorking} count={cat.avgDaysWorkingCnt} size="md" />
                    </Table.Td>
                    <Table.Td ta="right">
                      <DaysAvgValue value={cat.avgDaysAll} count={cat.avgDaysAllCnt} size="md" />
                    </Table.Td>
                    <Table.Td ta="right">
                      <DaysTotalValue value={cat.totalDaysInPeriod} size="md" />
                    </Table.Td>
                    <Table.Td ta="right" c={rateColor(cat.retentionRate, total > 0)} fw={600}>
                      {total === 0 ? '—' : pct(cat.retentionRate)}
                    </Table.Td>
                  </Table.Tr>
                  {isOpen &&
                    sortRows(cat.children, sort, SORT_GETTERS).map((c, i) => {
                      const childTotal = c.workingCount + c.dismissedCount;
                      return (
                        <Table.Tr key={`${cat.key}-${i}`}>
                          <Table.Td pl={44}>
                            <Text size="sm" c="dimmed">{childLabel(c)}</Text>
                          </Table.Td>
                          <Table.Td ta="right">
                            <Text size="sm">{c.employedInPeriod ?? 0}</Text>
                          </Table.Td>
                          <Table.Td ta="right">
                            <Text size="sm">{c.workingCount}</Text>
                          </Table.Td>
                          <Table.Td ta="right">
                            <Text size="sm">{c.dismissedCount}</Text>
                          </Table.Td>
                          <Table.Td ta="right">
                            <DaysAvgValue value={c.avgDaysFinished} count={c.avgDaysFinishedCnt} />
                          </Table.Td>
                          <Table.Td ta="right">
                            <DaysAvgValue value={c.avgDaysWorking} count={c.avgDaysWorkingCnt} />
                          </Table.Td>
                          <Table.Td ta="right">
                            <DaysAvgValue value={c.avgDaysAll} count={c.avgDaysAllCnt} />
                          </Table.Td>
                          <Table.Td ta="right">
                            <DaysTotalValue value={c.totalDaysInPeriod} />
                          </Table.Td>
                          <Table.Td ta="right" c={rateColor(c.retentionRate, childTotal > 0)}>
                            <Text size="sm" fw={500}>{childTotal === 0 ? '—' : pct(c.retentionRate)}</Text>
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                </Fragment>
              );
            })}
          </Table.Tbody>
        </Table>
        </Table.ScrollContainer>
      </Stack>
    </Paper>
  );
}
