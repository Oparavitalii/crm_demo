import { Button, Group, Paper, Table, Title, Stack, Text } from '@mantine/core';
import { BarChart3, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { CoordinatorKpiItem, WorkforceMetrics } from '@opushr/shared';
import { DaysAvgValue, DaysTotalValue, formatPercent, numCol, pct, rateColor } from './kpi-helpers';
import { SortableTh, sortRows, useColumnSort } from './SortableTh';

interface CoordinatorKpiTableProps {
  coordinators: CoordinatorKpiItem[];
}

type SortKey =
  | 'coordinated'
  | 'housed'
  | 'employed'
  | 'working'
  | 'dismissed'
  | 'avgFinished'
  | 'avgWorking'
  | 'avgAll'
  | 'totalDays'
  | 'rate';

const SORT_GETTERS: Record<SortKey, (r: CoordinatorKpiItem) => number | null> = {
  coordinated: (r) => r.candidatesCoordinated,
  housed: (r) => r.currentlyHoused,
  employed: (r) => r.workforce?.employedInPeriod ?? null,
  working: (r) => r.workforce?.workingCount ?? null,
  dismissed: (r) => r.workforce?.dismissedCount ?? null,
  avgFinished: (r) => r.workforce?.avgDaysFinished ?? null,
  avgWorking: (r) => r.workforce?.avgDaysWorking ?? null,
  avgAll: (r) => r.workforce?.avgDaysAll ?? null,
  totalDays: (r) => r.workforce?.totalDaysInPeriod ?? null,
  rate: (r) =>
    !r.workforce || r.workforce.workingCount + r.workforce.dismissedCount === 0
      ? null
      : r.workforce.retentionRate,
};

// Mirrors RecruiterKpiTable structure: 2026-07-10 both KPI tabs show the same
// unified six-metric workforce block as the retention tables (client request).
// Coordinator metrics are grouped by the EPISODE coordinator
// (employment_periods.coordinator_id) — history stays attributed to whoever
// coordinated it. Rows expose two explicit buttons — "Clients" deep-links into
// /clients?coordinatorId=…, "Stats" opens the per-user analytics drill-down.
export function CoordinatorKpiTable({ coordinators }: CoordinatorKpiTableProps) {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const { sort, toggle } = useColumnSort<SortKey>();

  if (coordinators.length === 0) {
    return (
      <Paper withBorder p="lg" radius="md" shadow="sm" data-reveal>
        <Stack gap="xs">
          <Title order={4}>{t('coordinatorKpi.title')}</Title>
          <Text c="dimmed" size="sm">
            {t('coordinatorKpi.empty')}
          </Text>
        </Stack>
      </Paper>
    );
  }

  const showPeopleBtn = t('coordinatorKpi.showPeopleBtn');
  const showStatsBtn = t('coordinatorKpi.showStatsBtn');
  const rows = sortRows(coordinators, sort, SORT_GETTERS);
  const th = (key: SortKey, label: string) => (
    <SortableTh label={label} active={sort?.col === key ? sort.dir : null} onSort={() => toggle(key)} />
  );

  function workforceCells(wf: WorkforceMetrics | null) {
    if (!wf) {
      return (
        <>
          {Array.from({ length: 7 }).map((_, i) => (
            <Table.Td key={i} style={numCol}>—</Table.Td>
          ))}
          <Table.Td style={numCol} c="dimmed">—</Table.Td>
        </>
      );
    }
    const total = wf.workingCount + wf.dismissedCount;
    return (
      <>
        <Table.Td style={numCol}>{wf.employedInPeriod}</Table.Td>
        <Table.Td style={numCol}>{wf.workingCount}</Table.Td>
        <Table.Td style={numCol}>{wf.dismissedCount}</Table.Td>
        <Table.Td style={numCol}>
          <DaysAvgValue value={wf.avgDaysFinished} count={wf.avgDaysFinishedCnt} />
        </Table.Td>
        <Table.Td style={numCol}>
          <DaysAvgValue value={wf.avgDaysWorking} count={wf.avgDaysWorkingCnt} />
        </Table.Td>
        <Table.Td style={numCol}>
          <DaysAvgValue value={wf.avgDaysAll} count={wf.avgDaysAllCnt} />
        </Table.Td>
        <Table.Td style={numCol}>
          <DaysTotalValue value={wf.totalDaysInPeriod} />
        </Table.Td>
        <Table.Td style={numCol} c={rateColor(wf.retentionRate, total > 0)} fw={600}>
          {total === 0 ? '—' : pct(wf.retentionRate)}
        </Table.Td>
      </>
    );
  }

  return (
    <Paper withBorder p="lg" radius="md" shadow="sm" data-reveal>
      <Stack gap="xs">
        <Title order={4}>{t('coordinatorKpi.title')}</Title>
        <Table.ScrollContainer minWidth={1400}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('coordinatorKpi.fullName')}</Table.Th>
                {th('coordinated', t('coordinatorKpi.coordinated'))}
                {th('housed', t('coordinatorKpi.currentlyHoused'))}
                {th('employed', t('retentionCat.employed'))}
                {th('working', t('retention.working'))}
                {th('dismissed', t('retention.dismissed'))}
                {th('avgFinished', t('retentionCat.avgDaysFinished'))}
                {th('avgWorking', t('retentionCat.avgDaysWorking'))}
                {th('avgAll', t('retentionCat.avgDaysAll'))}
                {th('totalDays', t('retentionCat.totalDays'))}
                {th('rate', t('retention.rate'))}
                <Table.Th>{t('coordinatorKpi.actions')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((row) => (
                <Table.Tr key={row.userId}>
                  <Table.Td>{row.fullName}</Table.Td>
                  <Table.Td style={numCol}>{row.candidatesCoordinated}</Table.Td>
                  <Table.Td style={numCol}>
                    {row.currentlyHoused} ({formatPercent(row.housingUtilizationPercent)})
                  </Table.Td>
                  {workforceCells(row.workforce ?? null)}
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      <Button
                        size="xs"
                        variant="light"
                        color="gray"
                        leftSection={<Users size={14} />}
                        onClick={() => navigate(`/clients?coordinatorId=${row.userId}`)}
                      >
                        {showPeopleBtn}
                      </Button>
                      <Button
                        size="xs"
                        variant="light"
                        color="blue"
                        leftSection={<BarChart3 size={14} />}
                        onClick={() => navigate(`/analytics/users/${row.userId}`)}
                      >
                        {showStatsBtn}
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Stack>
    </Paper>
  );
}
