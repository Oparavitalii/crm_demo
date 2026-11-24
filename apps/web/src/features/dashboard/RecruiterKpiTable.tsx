import { Badge, Button, Group, Paper, Table, Title, Stack, Text } from '@mantine/core';
import { BarChart3, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { RecruiterKpiItem, FreelancerKpiItem, WorkforceMetrics } from '@opushr/shared';
import { DaysAvgValue, DaysTotalValue, SourceBadges, numCol, pct, rateColor } from './kpi-helpers';
import { SortableTh, sortRows, useColumnSort } from './SortableTh';

interface RecruiterKpiTableProps {
  recruiters: RecruiterKpiItem[];
  freelancers: FreelancerKpiItem[];
}

type Row = {
  id: string;
  // userId only present for staff recruiters (the freelancer table uses a
  // separate `freelancerId` from a different table). Drill-down to the per-user
  // stats page only makes sense for rows with a real users.id. freelancerId is
  // populated only for rows that came from the freelancers table — used by the
  // "Users" button to deep-link into /candidates?freelancerId=X.
  userId: string | null;
  freelancerId: string | null;
  kind: 'recruiter' | 'freelancer';
  fullName: string;
  candidatesOwned: number;
  sourceBreakdown: Record<string, number>;
  // 2026-07-10 — unified six-metric block (client request: this tab reads the
  // same as the retention tables). Null for external freelancer-table rows,
  // which have no employment-period attribution.
  workforce: WorkforceMetrics | null;
  commissionRate: number | null;
};

type SortKey =
  | 'recruited'
  | 'employed'
  | 'working'
  | 'dismissed'
  | 'avgFinished'
  | 'avgWorking'
  | 'avgAll'
  | 'totalDays'
  | 'rate';

const SORT_GETTERS: Record<SortKey, (r: Row) => number | null> = {
  recruited: (r) => r.candidatesOwned,
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

export function RecruiterKpiTable({ recruiters, freelancers }: RecruiterKpiTableProps) {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const { sort, toggle } = useColumnSort<SortKey>();

  // Some people exist BOTH as a user account with isFreelancer=true AND as a
  // separate entry in the `freelancers` table — they show up twice. Prefer the
  // user-account row (richer data: workforce metrics, real userId for the
  // Stats button) and skip the freelancers-table duplicate. Match is by
  // normalized fullName since freelancers table has no user FK.
  const freelancerFlaggedUserNames = new Set(
    recruiters
      .filter((r) => r.isFreelancer)
      .map((r) => r.fullName.trim().toLowerCase()),
  );
  const uniqueFreelancers = freelancers.filter(
    (f) => !freelancerFlaggedUserNames.has(f.fullName.trim().toLowerCase()),
  );

  const rows: Row[] = sortRows(
    [
      // "Тип" comes from users.isFreelancer (editable in /admin/users), not from
      // which list the row arrived in. A user with role='recruiter' AND
      // isFreelancer=true renders as "Фрілансер"; the rest as "Штатний".
      ...recruiters.map((r): Row => ({
        id: `r:${r.userId}`,
        userId: r.userId,
        freelancerId: null,
        kind: r.isFreelancer ? 'freelancer' : 'recruiter',
        fullName: r.fullName,
        candidatesOwned: r.candidatesOwned,
        sourceBreakdown: r.sourceBreakdown,
        workforce: r.workforce ?? null,
        commissionRate: null,
      })),
      ...uniqueFreelancers.map((f): Row => ({
        id: `f:${f.freelancerId}`,
        userId: null,
        freelancerId: f.freelancerId,
        kind: 'freelancer',
        fullName: f.fullName,
        candidatesOwned: f.candidatesOwned,
        sourceBreakdown: f.sourceBreakdown,
        workforce: null,
        commissionRate: f.commissionRate,
      })),
    ],
    sort,
    SORT_GETTERS,
  );

  if (rows.length === 0) {
    return (
      <Paper withBorder p="lg" radius="md" shadow="sm" data-reveal>
        <Stack gap="xs">
          <Title order={4}>{t('recruiterKpi.title')}</Title>
          <Text c="dimmed" size="sm">
            {t('recruiterKpi.empty')}
          </Text>
        </Stack>
      </Paper>
    );
  }

  const showPeopleBtn = t('recruiterKpi.showPeopleBtn');
  const showStatsBtn = t('recruiterKpi.showStatsBtn');
  const th = (key: SortKey, label: string) => (
    <SortableTh label={label} active={sort?.col === key ? sort.dir : null} onSort={() => toggle(key)} />
  );

  function openPeople(row: Row) {
    // Deep-link into /clients with the ownership pre-filter. When any
    // user-scope filter is present CandidateList suppresses its bucket filter,
    // so the full roster (retention, work outcome, payout, etc.) renders.
    if (row.userId) {
      navigate(`/clients?recruiterId=${row.userId}`);
    } else if (row.freelancerId) {
      navigate(`/clients?freelancerId=${row.freelancerId}`);
    }
  }

  // Six-metric cell block — identical columns/wording to the retention tables
  // (client request 2026-07-10): Працевлаштовано · Працюють · Звільнені ·
  // Сер. стаж ×2 · Відпрацьовано · Утримання.
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
        <Title order={4}>{t('recruiterKpi.title')}</Title>
        <Table.ScrollContainer minWidth={1500}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('recruiterKpi.fullName')}</Table.Th>
                <Table.Th>{t('recruiterKpi.kind')}</Table.Th>
                {th('recruited', t('recruiterKpi.recruited'))}
                {th('employed', t('retentionCat.employed'))}
                {th('working', t('retention.working'))}
                {th('dismissed', t('retention.dismissed'))}
                {th('avgFinished', t('retentionCat.avgDaysFinished'))}
                {th('avgWorking', t('retentionCat.avgDaysWorking'))}
                {th('avgAll', t('retentionCat.avgDaysAll'))}
                {th('totalDays', t('retentionCat.totalDays'))}
                {th('rate', t('retention.rate'))}
                <Table.Th>{t('recruiterKpi.sources')}</Table.Th>
                <Table.Th>{t('recruiterKpi.actions')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((row) => (
                <Table.Tr key={row.id}>
                  <Table.Td>{row.fullName}</Table.Td>
                  <Table.Td>
                    {row.kind === 'recruiter' ? (
                      <Badge variant="light" color="blue">
                        {t('recruiterKpi.kindRecruiter')}
                      </Badge>
                    ) : (
                      <Badge variant="light" color="grape">
                        {t('recruiterKpi.kindFreelancer')}
                        {row.commissionRate !== null ? ` · ${row.commissionRate}%` : ''}
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td style={numCol}>{row.candidatesOwned}</Table.Td>
                  {workforceCells(row.workforce)}
                  <Table.Td>
                    <SourceBadges sources={row.sourceBreakdown} />
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      <Button
                        size="xs"
                        variant="light"
                        color="gray"
                        leftSection={<Users size={14} />}
                        onClick={() => openPeople(row)}
                        disabled={!row.userId && !row.freelancerId}
                      >
                        {showPeopleBtn}
                      </Button>
                      {row.userId ? (
                        <Button
                          size="xs"
                          variant="light"
                          color="blue"
                          leftSection={<BarChart3 size={14} />}
                          onClick={() => navigate(`/analytics/users/${row.userId}`)}
                        >
                          {showStatsBtn}
                        </Button>
                      ) : row.freelancerId ? (
                        // External freelancer (freelancers table — no user
                        // account). Stats page is the same shape, served by
                        // a different endpoint (/freelancers/:id/stats).
                        <Button
                          size="xs"
                          variant="light"
                          color="blue"
                          leftSection={<BarChart3 size={14} />}
                          onClick={() => navigate(`/analytics/freelancers/${row.freelancerId}`)}
                        >
                          {showStatsBtn}
                        </Button>
                      ) : null}
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
