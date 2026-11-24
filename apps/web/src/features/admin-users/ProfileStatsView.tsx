import {
  Badge,
  Button,
  Container,
  Grid,
  Group,
  Paper,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { UserProfileStats } from '@crm/shared';
import { KpiTile } from '@/features/dashboard/KpiTile';
import { StatusFunnel } from '@/features/dashboard/StatusFunnel';
import { SourceBreakdown } from '@/features/dashboard/SourceBreakdown';
import { LegendItem } from '@/features/dashboard/LegendItem';
import { percentOf } from '@/lib/format';
import { pickLabel, useStatusLookup } from '@/features/admin-statuses/useStatusLookup';

// Shared rendering of per-user analytics — used by both UserStatsPage
// (/analytics/users/:userId) and FreelancerStatsPage
// (/analytics/freelancers/:id). The two pages differ only in:
//   - where the data comes from (different API hooks)
//   - the back-link target
// Everything else (KPI tiles, funnel, dismissal table, recent candidates)
// is identical, so it lives here.

type Role = UserProfileStats['user']['role'];

// Coordinator gets housing tiles; everyone else (recruiter, freelancer) gets
// candidate-funnel + retention tiles. ROLE_COLORS in columns.tsx only covers
// users.role values, so we map freelancer separately here.
const ROLE_BADGE_COLOR: Record<Role, string> = {
  recruiter: 'blue',
  coordinator: 'teal',
  freelancer: 'grape',
};

function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function formatDays(d: number | null, t: (k: string) => string): string {
  if (d === null) return t('userStats.noData');
  return `${d.toFixed(1)} ${t('userStats.daysShort')}`;
}

function FunnelAsStatusFunnel({ stats }: { stats: UserProfileStats }) {
  const data = (
    [
      'new',
      'in_progress',
      'documents_submitted',
      'cancelled',
      'employed',
      're_employed',
      'dismissed',
      'blacklist',
    ] as const
  ).map((status) => ({ status, count: stats.funnel[status] }));
  return <StatusFunnel data={data} />;
}

function HousingUtilizationCard({ stats }: { stats: UserProfileStats }) {
  const { t } = useTranslation('admin');
  const h = stats.housingUtilization;
  if (!h) return null;
  const empty = h.totalHoused === 0;
  return (
    <Paper withBorder p="lg" radius="md" shadow="sm" data-reveal>
      <Stack gap="sm">
        <Title order={4}>{t('userStats.housingTitle')}</Title>
        {empty ? (
          <Text c="dimmed" size="sm">{t('userStats.empty')}</Text>
        ) : (
          <Stack gap={6}>
            <LegendItem
              color="#43aa8b"
              label={t('userStats.currentlyEmployed')}
              value={h.currentlyEmployed}
              percent={percentOf(h.currentlyEmployed, h.totalHoused)}
            />
            <LegendItem
              color="#868e96"
              label={t('userStats.notEmployed')}
              value={h.totalHoused - h.currentlyEmployed}
              percent={percentOf(h.totalHoused - h.currentlyEmployed, h.totalHoused)}
            />
            <Text size="xs" c="dimmed" mt="xs">
              {t('userStats.utilizationHint', { rate: formatPercent(h.rate) })}
            </Text>
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}

function DismissalReasonsCard({ stats }: { stats: UserProfileStats }) {
  const { t, i18n } = useTranslation('admin');
  const { data: reasonLookup } = useStatusLookup('dismissal_reason');
  const entries = Object.entries(stats.dismissalReasons).sort((a, b) => b[1] - a[1]);
  return (
    <Paper withBorder p="lg" radius="md" shadow="sm" data-reveal>
      <Stack gap="sm">
        <Title order={4}>{t('userStats.dismissalReasonsTitle')}</Title>
        {entries.length === 0 ? (
          <Text c="dimmed" size="sm">{t('userStats.noDismissals')}</Text>
        ) : (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('userStats.reason')}</Table.Th>
                <Table.Th ta="right">{t('userStats.count')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {entries.map(([reason, count]) => {
                const { label, missing } = pickLabel(reasonLookup, reason, i18n.language);
                const display = missing ? reason : label;
                return (
                  <Table.Tr key={reason}>
                    <Table.Td>{display}</Table.Td>
                    <Table.Td ta="right">{count}</Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </Paper>
  );
}

function RecentCandidatesCard({ stats }: { stats: UserProfileStats }) {
  const { t } = useTranslation('admin');
  const { t: tCand } = useTranslation('candidates');
  const navigate = useNavigate();
  return (
    <Paper withBorder p="lg" radius="md" shadow="sm" data-reveal>
      <Stack gap="sm">
        <Title order={4}>{t('userStats.recentTitle')}</Title>
        {stats.recentCandidates.length === 0 ? (
          <Text c="dimmed" size="sm">{t('userStats.empty')}</Text>
        ) : (
          <Table highlightOnHover striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('userStats.name')}</Table.Th>
                <Table.Th>{t('userStats.status')}</Table.Th>
                <Table.Th>{t('userStats.createdAt')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {stats.recentCandidates.map((c) => (
                <Table.Tr
                  key={c.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/candidates/${c.id}`)}
                >
                  <Table.Td>{c.name}</Table.Td>
                  <Table.Td>
                    <Badge variant="light">{tCand(`status.${c.status}`)}</Badge>
                  </Table.Td>
                  <Table.Td>{new Date(c.createdAt).toLocaleDateString()}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </Paper>
  );
}

export interface ProfileStatsViewProps {
  stats: UserProfileStats;
  // Where the "back" arrow should go. UserStatsPage points to /admin/users;
  // FreelancerStatsPage points to /analytics?tab=admin (recruiters tab).
  backHref: string;
  backLabel: string;
}

export function ProfileStatsView({ stats, backHref, backLabel }: ProfileStatsViewProps) {
  const { t } = useTranslation('admin');
  const navigate = useNavigate();
  const isCoordinator = stats.user.role === 'coordinator';
  return (
    <Container size="lg">
      <Group justify="space-between" mb="md" wrap="wrap">
        <Group gap="sm">
          <Button variant="subtle" leftSection={<ArrowLeft size={16} />} onClick={() => navigate(backHref)}>
            {backLabel}
          </Button>
          <Title order={2} data-reveal>
            {stats.user.lastName} {stats.user.firstName}
          </Title>
          <Badge color={ROLE_BADGE_COLOR[stats.user.role]} variant="light">
            {t(`users.role.${stats.user.role}`)}
          </Badge>
        </Group>
      </Group>

      <Grid mb="md">
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <KpiTile
            title={isCoordinator ? t('userStats.totalHoused') : t('userStats.totalCandidates')}
            value={isCoordinator ? stats.housingUtilization?.totalHoused ?? 0 : stats.funnel.total}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <KpiTile
            title={isCoordinator ? t('userStats.currentlyEmployed') : t('userStats.employed')}
            value={
              isCoordinator
                ? stats.housingUtilization?.currentlyEmployed ?? 0
                : stats.funnel.employed + stats.funnel.re_employed
            }
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <KpiTile
            title={isCoordinator ? t('userStats.housingUtilization') : t('userStats.retentionRate')}
            value={formatPercent(
              isCoordinator ? stats.housingUtilization?.rate ?? 0 : stats.retention.rate,
            )}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <KpiTile
            title={t('userStats.avgTimeToHire')}
            value={formatDays(stats.avgTimeToHireDays, t)}
          />
        </Grid.Col>
      </Grid>

      <Grid>
        <Grid.Col span={{ base: 12, md: 8 }}>
          <FunnelAsStatusFunnel stats={stats} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          {isCoordinator ? (
            <HousingUtilizationCard stats={stats} />
          ) : (
            <SourceBreakdown
              data={Object.entries(stats.sourceBreakdown ?? {}).map(([source, count]) => ({
                source,
                count,
              }))}
            />
          )}
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 8 }}>
          <RecentCandidatesCard stats={stats} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <DismissalReasonsCard stats={stats} />
        </Grid.Col>
      </Grid>
    </Container>
  );
}
